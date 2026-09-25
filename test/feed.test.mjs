// The rounds feed, run on real transactions.
//
// rehearsal-devnet.json holds two rounds made by the keeper's own code in the
// devnet rehearsal: payout batches built by packPayouts, preceded by the
// rehearsal's stand-in swap. Their true figures are in the keeper's round log,
// copied below. stonkblends-mainnet.json holds two mainnet transactions from
// another project's wallet that moved stock but were NOT rounds: stock swept in
// from elsewhere, and stock sold into a pool. The first version of the decoder
// called them a buy and a payment.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readTx, groupRounds, mergeSignatures } from "../js/feed.js";
import { STOCKS } from "../js/config.js";

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const dev = load("rehearsal-devnet.json");
const main = load("stonkblends-mainnet.json");

const PAYER = "wQwH4wnuzrEJf3dCNf6j1gt99Z1TWyXBTfcVtZfi7Zh";
// The rehearsal's fake stocks: whatever the payer received in each swap.
const mintBought = (tx) => tx.meta.postTokenBalances.find((b) => b.owner === PAYER).mint;
const FAKE = [
  { symbol: "FAKE1", mint: mintBought(dev.swap0) },
  { symbol: "FAKE2", mint: mintBought(dev.swap1) },
];

// From rotation/state-devnet/rounds.jsonl — what the keeper recorded.
const LOG = [
  { lamportsIn: 130972465n, stockOut: 130972465000n, payees: 5 },
  { lamportsIn: 107687789n, stockOut: 107687789000n, payees: 6 },
];

test("a swap reads as a buy: the stock received, and exactly the SOL swapped plus the fee", () => {
  for (const [i, tx] of [dev.swap0, dev.swap1].entries()) {
    const [e, ...rest] = readTx(tx, PAYER, FAKE);
    assert.equal(rest.length, 0);
    assert.equal(e.kind, "buy");
    assert.equal(e.symbol, FAKE[i].symbol);
    assert.equal(e.amount, LOG[i].stockOut);
    // The first swap also opened the payer's own stock account. Its rent stays in
    // the wallet, so it must not show up as spent.
    assert.equal(e.spent, LOG[i].lamportsIn + BigInt(tx.meta.fee), `round ${i}`);
  }
});

test("a payout batch reads as a payment to exactly the holders the keeper paid", () => {
  for (const [i, tx] of [dev.batch0, dev.batch1].entries()) {
    const [e] = readTx(tx, PAYER, FAKE);
    assert.equal(e.kind, "pay");
    assert.equal(e.amount, LOG[i].stockOut, "the whole swap output was paid out");
    assert.equal(e.recipients.length, LOG[i].payees);
    assert.equal(e.recipients.reduce((n, r) => n + r.amount, 0n), e.amount, "what left the wallet is what holders got");
    assert.ok(!e.recipients.some((r) => r.owner === PAYER), "the payer never pays itself");
    assert.ok(e.cost > 0n);
  }
});

test("rounds group a buy with its payments, newest first, whatever order they arrive in", () => {
  const events = [dev.batch1, dev.swap0, dev.swap1, dev.batch0].flatMap((t) => readTx(t, PAYER, FAKE));
  const rounds = groupRounds(events);
  assert.deepEqual(rounds.map((r) => r.symbol), ["FAKE2", "FAKE1"]);
  for (const [j, r] of rounds.entries()) {
    const i = 1 - j;
    assert.equal(r.buy.amount, LOG[i].stockOut);
    assert.equal(r.pays.length, 1);
    assert.equal(r.paid, LOG[i].stockOut);
    assert.equal(r.recipients.size, LOG[i].payees);
  }
});

test("a payment whose buy is older than the loaded history is kept, with no buy", () => {
  const rounds = groupRounds(readTx(dev.batch0, PAYER, FAKE));
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].buy, null);
  assert.equal(rounds[0].paid, LOG[0].stockOut);
});

test("stock swept in from elsewhere is not a buy, and stock sold into a pool is not a payment", () => {
  const W = "EMePgPUz4Srs3tARuh47r9yWNQAisw615LVLVQATFgKa";
  const swept = readTx(main.sweepIn, W, STOCKS);
  assert.deepEqual(swept.map((e) => [e.symbol, e.kind]), [["AAPL", "in"], ["AMZN", "in"]]);
  const sold = readTx(main.sell, W, STOCKS);
  assert.deepEqual(sold.map((e) => [e.symbol, e.kind, e.amount]), [["AAPL", "out", 1081791n]]);
  const rounds = groupRounds([...swept, ...sold]);
  assert.ok(rounds.every((r) => r.other), "none of them is a round");
});

test("failed transactions, and ones the wallet isn't in, produce nothing", () => {
  const failed = structuredClone(dev.swap0);
  failed.meta.err = { InstructionError: [0, "Custom"] };
  assert.deepEqual(readTx(failed, PAYER, FAKE), []);
  assert.deepEqual(readTx(dev.swap0, "11111111111111111111111111111111", FAKE), []);
  assert.deepEqual(readTx(null, PAYER, FAKE), []);
});

// ---- cases the fixtures don't reach, built by editing the real transactions ------

/** Add a token account to a parsed transaction, with its lamports and balances. */
function withAccount(tx, { owner, mint, pre, post, lamportsPre = 0, lamportsPost = 0, payerDelta = 0 }) {
  const t = structuredClone(tx);
  const i = t.transaction.message.accountKeys.length;
  t.transaction.message.accountKeys.push({ pubkey: `Synthetic${i}`, signer: false, writable: true });
  t.meta.preBalances.push(lamportsPre);
  t.meta.postBalances.push(lamportsPost);
  t.meta.postBalances[0] += payerDelta;
  const bal = (amount) => ({ accountIndex: i, mint, owner, uiTokenAmount: { amount: String(amount), decimals: 8 } });
  if (pre !== undefined) t.meta.preTokenBalances.push(bal(pre));
  if (post !== undefined) t.meta.postTokenBalances.push(bal(post));
  return t;
}

test("wrapped SOL left in a newly opened account is still the wallet's: neither it nor its rent is spent", () => {
  const WSOL = "So11111111111111111111111111111111111111112";
  const rent = 2_039_280, wrapped = 5_000_000;
  const tx = withAccount(dev.swap0, {
    owner: PAYER, mint: WSOL, post: wrapped, lamportsPost: rent + wrapped, payerDelta: -(rent + wrapped),
  });
  const [e] = readTx(tx, PAYER, FAKE);
  assert.equal(e.spent, LOG[0].lamportsIn + BigInt(tx.meta.fee));
});

test("an account of the same stock that went DOWN in a payout is not a recipient", () => {
  const tx = withAccount(dev.batch0, { owner: "SomeoneElse111111111111111111111111111111111", mint: FAKE[0].mint, pre: 100, post: 50 });
  const [e] = readTx(tx, PAYER, FAKE);
  assert.equal(e.recipients.length, LOG[0].payees);
  assert.ok(!e.recipients.some((r) => r.owner.startsWith("SomeoneElse")));
});

test("the same stock bought again starts a new round, not a rewrite of the last one", () => {
  const later = (tx, by) => ({ ...structuredClone(tx), slot: tx.slot + by, blockTime: tx.blockTime + by });
  const txs = [dev.swap0, dev.batch0, later(dev.swap0, 1500), later(dev.batch0, 1500)];
  const rounds = groupRounds(txs.flatMap((t) => readTx(t, PAYER, FAKE)));
  assert.equal(rounds.length, 2);
  for (const r of rounds) {
    assert.ok(r.buy);
    assert.equal(r.pays.length, 1);
  }
  assert.ok(rounds[0].slot > rounds[1].slot);
});

test("merged signatures stop where a full page ran out, so no round goes missing from the middle", () => {
  const s = (slot, id = `s${slot}`) => ({ signature: id, slot, err: null });
  // A has older history not yet fetched, and what was fetched reaches back only
  // to slot 50. B's history is complete.
  const a = { signatures: [s(90), s(70), s(50)], more: true };
  const b = { signatures: [s(95), s(60), s(40), s(10)], more: false };
  const { signatures, complete } = mergeSignatures([a, b]);
  assert.deepEqual(signatures.map((x) => x.slot), [95, 90, 70, 60, 50]);
  assert.equal(complete, false);

  const all = mergeSignatures([
    { signatures: [s(5), { ...s(4), err: {} }], more: false },
    { signatures: [s(5), s(3)], more: false },
  ]);
  assert.deepEqual(all.signatures.map((x) => x.slot), [5, 3], "deduplicated, failures dropped");
  assert.equal(all.complete, true);

  const none = mergeSignatures([{ signatures: [], more: true }, { signatures: [s(7)], more: false }]);
  assert.deepEqual(none.signatures.map((x) => x.slot), [7], "an empty history bounds nothing");
});
