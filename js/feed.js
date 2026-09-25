// The rounds feed: what the keeper actually did, read from the chain.
//
// Nothing here trusts the keeper's own log. Each of the five stocks has one
// token account owned by the payout wallet, and every round touches exactly one
// of them: the swap fills it, then the payout batches drain it into holders'
// wallets. Reading the history of those five accounts gives every buy and every
// payment, and nothing else. Fee deposits and ops sweeps never touch them.
//
// Pure functions over parsed transactions (getTransaction, jsonParsed), so
// test/feed.test.mjs can run them on real mainnet transactions.

import { WSOL_MINT } from "./solana.js";

const keyOf = (k) => (typeof k === "string" ? k : k.pubkey);

/**
 * One transaction → the stock movements it made for `payout`.
 *
 *   buy  the payout wallet's stock went UP and SOL left the wallet. `spent` is
 *        that SOL, network fee included, native and wrapped together, because
 *        Jupiter wraps SOL on the way in.
 *   pay  its stock went DOWN and no SOL came back. `recipients` are the other
 *        owners whose balance of the same stock went up.
 *   in / out   stock moved without the SOL moving the way a round moves it:
 *        stock arriving for free (anyone can send tokens to any account), or
 *        stock leaving while SOL comes back, which is a sale. The keeper does
 *        neither. Calling them "bought" or "paid" would be false, so they are
 *        reported as what they are.
 */
export function readTx(tx, payout, stocks) {
  if (!tx?.meta || tx.meta.err) return [];
  const keys = tx.transaction.message.accountKeys.map(keyOf);
  const pi = keys.indexOf(payout);
  if (pi < 0) return [];
  const native = BigInt(tx.meta.postBalances[pi]) - BigInt(tx.meta.preBalances[pi]);

  // Balances are keyed by account index. An account opened in this transaction
  // has no "pre" entry, and one closed in it has no "post" entry. Both count as
  // zero on the missing side.
  const byIndex = new Map();
  const add = (list, side) => {
    for (const b of list ?? []) {
      const e = byIndex.get(b.accountIndex) ?? { mint: b.mint, owner: b.owner, pre: 0n, post: 0n };
      e[side] = BigInt(b.uiTokenAmount.amount);
      e.owner ??= b.owner;
      byIndex.set(b.accountIndex, e);
    }
  };
  add(tx.meta.preTokenBalances, "pre");
  add(tx.meta.postTokenBalances, "post");

  let wsol = 0n;
  // Rent in token accounts the wallet opened for ITSELF here, such as its own
  // stock account on the first buy, or an intermediate one on a Jupiter route.
  // The wallet still owns that SOL, as an account it can close. Counting it as
  // spent would make every first buy of a stock look overpriced. The keeper's
  // own safety check draws the same line.
  let kept = 0n;
  for (const [i, e] of byIndex) {
    if (e.owner !== payout) continue;
    if (e.mint === WSOL_MINT) wsol += e.post - e.pre;
    const opened = !(tx.meta.preTokenBalances ?? []).some((b) => b.accountIndex === i);
    if (opened) {
      const lamports = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
      // a wrapped-SOL account holds its balance as lamports too; only the rest is rent
      kept += lamports - (e.mint === WSOL_MINT ? e.post : 0n);
    }
  }

  const events = [];
  for (const stock of stocks) {
    let mine = 0n;
    const recipients = new Map();
    for (const e of byIndex.values()) {
      if (e.mint !== stock.mint) continue;
      const d = e.post - e.pre;
      if (e.owner === payout) mine += d;
      else if (d > 0n) recipients.set(e.owner, (recipients.get(e.owner) ?? 0n) + d);
    }
    const base = { symbol: stock.symbol, mint: stock.mint, signature: tx.transaction.signatures[0], slot: tx.slot, time: tx.blockTime };
    const solOut = -(native + wsol);
    if (mine > 0n) {
      events.push(solOut > 0n ? { ...base, kind: "buy", amount: mine, spent: solOut - kept } : { ...base, kind: "in", amount: mine });
    } else if (mine < 0n) {
      events.push(
        solOut >= 0n
          ? { ...base, kind: "pay", amount: -mine, cost: solOut, recipients: [...recipients].map(([owner, amount]) => ({ owner, amount })) }
          : { ...base, kind: "out", amount: -mine },
      );
    }
  }
  return events;
}

/**
 * Events, any order → rounds, newest first.
 *
 * A round is a buy and the payments of that stock that follow it. The keeper
 * finishes one round before it starts the next (its journal enforces that), so
 * "the latest buy of this stock" is the round a payment belongs to, even when a
 * batch lands late. A payment whose buy is older than the loaded history makes
 * a round with no buy. It is shown, not dropped.
 *
 * "in" and "out" events are not rounds. They come back as `{ other: event }`
 * entries, in time order among the rounds.
 */
export function groupRounds(events) {
  const sorted = [...events].sort(
    (a, b) => a.slot - b.slot || (a.kind === b.kind ? 0 : a.kind === "buy" ? -1 : 1),
  );
  const rounds = [];
  const open = new Map();
  for (const e of sorted) {
    if (e.kind === "in" || e.kind === "out") {
      rounds.push({ other: e, slot: e.slot, time: e.time });
      continue;
    }
    let r = open.get(e.mint);
    if (e.kind === "buy" || !r) {
      r = { symbol: e.symbol, mint: e.mint, time: e.time, slot: e.slot, buy: null, pays: [] };
      rounds.push(r);
      open.set(e.mint, r);
    }
    if (e.kind === "buy") r.buy = e;
    else r.pays.push(e);
  }
  for (const r of rounds) {
    if (r.other) continue;
    r.paid = r.pays.reduce((n, p) => n + p.amount, 0n);
    const who = new Map();
    for (const p of r.pays) for (const x of p.recipients) who.set(x.owner, (who.get(x.owner) ?? 0n) + x.amount);
    r.recipients = who;
  }
  return rounds.reverse();
}

/**
 * Signatures from several accounts' histories, merged newest first, cut at the
 * point where one account's fetched history runs out.
 *
 * Each history is `{ signatures, more }`: what getSignaturesForAddress returned
 * so far, and whether its last page came back full, meaning there is older
 * history not yet fetched. Merging past the oldest fetched entry of such an
 * account would skip its older rounds, and they would silently vanish from the
 * middle of the feed. So everything older than that point is withheld, and
 * `complete` says whether anything was.
 */
export function mergeSignatures(histories) {
  let floor = -Infinity;
  for (const h of histories) {
    if (h.more && h.signatures.length) floor = Math.max(floor, h.signatures[h.signatures.length - 1].slot);
  }
  const seen = new Set();
  const out = [];
  for (const { signatures } of histories) {
    for (const s of signatures) {
      if (s.err || seen.has(s.signature) || s.slot < floor) continue;
      seen.add(s.signature);
      out.push(s);
    }
  }
  out.sort((a, b) => b.slot - a.slot);
  return { signatures: out, complete: floor === -Infinity };
}
