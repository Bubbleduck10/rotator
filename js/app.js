// ROTATOR: which stock is being paid, what has been paid, and to whom.
//
// Everything here is read from public sources: the schedule is arithmetic, the
// rounds are the payout wallet's own transactions, balances are token accounts,
// prices are Pyth and DexScreener. No wallet connects and nothing is signed.

import { CONFIG, STOCKS, EXCLUDED, solscan } from "./config.js";
import { windowAt, PERIOD_SECS } from "./schedule.js";
import { rpcClient, getAccounts, associatedTokenAddress, decodePubkey, isOnCurve, TOKEN_2022_PROGRAM } from "./solana.js";
import { readTx, groupRounds, mergeSignatures } from "./feed.js";
import { esc, short, toUi, fmtShares, fmtUsd, fmtSol, mmss, roundHtml } from "./view.js";

const $ = (id) => document.getElementById(id);
const N = STOCKS.length;

// ---- configuration, with overrides for local testing only ----------------------
//
// On localhost, ?payout= / ?mint= / ?t0= point the page at another wallet, so the
// feed and stats can be exercised before launch. Never on the public site: there
// a URL someone sends you must not be able to make the page vouch for a
// different wallet.

const cfg = { ...CONFIG };
let overridden = false;
if (["localhost", "127.0.0.1"].includes(location.hostname)) {
  const q = new URLSearchParams(location.search);
  for (const k of ["payout", "mint"]) if (q.get(k)) { cfg[k] = q.get(k); overridden = true; }
  if (q.get("t0")) { cfg.t0 = Number(q.get("t0")); overridden = true; }
}
const launched = !!cfg.mint && cfg.t0 > 0;
const feedOn = launched || (overridden && !!cfg.payout);
const rpc = rpcClient(cfg.rpc);

// ---- clock -------------------------------------------------------------------------
//
// The keeper runs on a server with a synced clock. A visitor's clock can be
// minutes off, which would name the wrong stock. The chain's clock is read with
// the prices, and used when the two disagree by more than a few seconds.

let clockOffset = 0;
const now = () => Date.now() / 1000 + clockOffset;
const t0 = () => (cfg.t0 > 0 ? cfg.t0 : 0); // before launch: a preview on the epoch

// ---- the rotation: hero, slots, strip ------------------------------------------

let shownRound = null; // the window currently drawn

function current() {
  const t = now();
  if (launched && t < cfg.t0) return { prestart: true, w: windowAt(t, cfg.t0, N), left: cfg.t0 - t };
  const w = windowAt(t, t0(), N);
  return { prestart: false, w, left: w.endsAt - t };
}

function buildSlots() {
  $("slots").innerHTML = STOCKS.map((s, i) => `
    <div class="slot" id="slot${i}" style="--slot-accent:${s.accent}">
      <div class="tick">${s.symbol}</div>
      <div class="co">${s.name}</div>
      <div class="px" id="px${i}">—</div>
      <div class="state" id="st${i}"></div>
      <div class="bar" id="bar${i}"></div>
    </div>`).join("");
}

function renderClock() {
  const { prestart, w, left } = current();
  const slot = w.slot;
  const stock = STOCKS[slot];
  const next = STOCKS[(slot + 1) % N];
  const frac = prestart ? 0 : 1 - left / PERIOD_SECS;

  const turned = shownRound !== w.round;
  if (turned) {
    shownRound = w.round;
    document.documentElement.style.setProperty("--accent", stock.accent);
    const em = $("hero-sym");
    em.textContent = stock.symbol;
    em.classList.remove("swap");
    void em.offsetWidth;
    em.classList.add("swap");
    $("s-now").textContent = stock.symbol;
    $("s-now-sub").textContent = `${stock.name} xStock`;
    $("strip-now").textContent = stock.symbol;
  }

  $("cd").textContent = mmss(left);
  $("cd-label").textContent = prestart ? "rotation starts in" : "next rotation in";
  $("cd-next").textContent = prestart ? stock.symbol : next.symbol;
  // A new window starts the bars from empty. Without switching the transition
  // off for that one step they would visibly run backwards from full.
  const snap = (el, prop, value) => {
    if (turned) el.style.transition = "none";
    el.style[prop] = value;
    if (turned) {
      el.getBoundingClientRect();
      el.style.transition = "";
    }
  };
  snap($("cd-fill"), "width", `${(frac * 100).toFixed(2)}%`);
  $("strip-next").textContent = prestart ? "first round" : next.symbol;
  $("strip-cd").textContent = mmss(left);

  STOCKS.forEach((s, i) => {
    const k = (i - slot + N) % N;
    $(`slot${i}`).className = "slot" + (k === 0 ? " active" : k === 1 ? " next" : "");
    $(`st${i}`).textContent = k === 0 ? (prestart ? "first" : "paying now") : `in ${mmss(left + (k - 1) * PERIOD_SECS)}`;
    $(`bar${i}`).style.width = k === 0 ? `${(frac * 100).toFixed(2)}%` : "0";
  });

  if (launched) {
    $("strip-state").textContent = prestart ? "LAUNCHED · ROTATION STARTS SOON" : `LIVE · ROUND ${w.round.toLocaleString("en-US")}`;
  }
}

// ---- market: chain clock, Pyth prices, xStock multipliers, ROTATOR's token program ---

const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const market = { prices: [], multipliers: [], rotatorProgram: null };

/**
 * Pyth price accounts (PriceUpdateV2). verification_level is a variable-width
 * Borsh enum: Full is one byte, Partial is two, and everything after offset 40
 * shifts on it.
 */
function pythPrice(b64) {
  const d = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dv = new DataView(d.buffer);
  const base = d[40] === 1 ? 41 : 42;
  return Number(dv.getBigInt64(base + 32, true)) * 10 ** dv.getInt32(base + 48, true);
}

/** Backed rescales balances for dividends and splits; the multiplier turns tokens into shares. */
function multiplierOf(mintAccount) {
  const ext = mintAccount?.data?.parsed?.info?.extensions?.find((e) => e.extension === "scaledUiAmountConfig");
  if (!ext) return 1;
  const s = ext.state;
  const m = now() >= Number(s.newMultiplierEffectiveTimestamp) ? s.newMultiplier : s.multiplier;
  return Number(m) || 1;
}

async function readMarket() {
  const keys = [CLOCK, ...STOCKS.map((s) => s.pyth), ...STOCKS.map((s) => s.mint)];
  if (cfg.mint) keys.push(cfg.mint);
  try {
    const value = await getAccounts(rpc, keys, { encoding: "jsonParsed", commitment: "confirmed" });
    const chainTs = Number(value[0]?.data?.parsed?.info?.unixTimestamp);
    if (chainTs) {
      const off = chainTs - Date.now() / 1000;
      clockOffset = Math.abs(off) > 5 ? off : 0;
    }
    STOCKS.forEach((_, i) => {
      const p = value[1 + i];
      if (p && Array.isArray(p.data)) market.prices[i] = pythPrice(p.data[0]);
      market.multipliers[i] = multiplierOf(value[1 + N + i]);
    });
    if (cfg.mint) market.rotatorProgram = value[1 + 2 * N]?.owner ?? null;
    STOCKS.forEach((_, i) => {
      const px = market.prices[i];
      $(`px${i}`).textContent = px ? fmtUsd(px) : "—";
    });
  } catch {
    // Prices are a nicety. The schedule does not depend on them.
  }
}

// ---- DexScreener ----------------------------------------------------------------------

async function readDex() {
  if (!cfg.mint) return;
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${cfg.mint}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pairs = (await res.json()).filter((p) => p.baseToken?.address === cfg.mint);
    if (!pairs.length) {
      for (const id of ["s-price", "s-mcap", "s-vol"]) setStat(id, "not indexed yet", "", true);
      return;
    }
    const p = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const ch = p.priceChange?.h24;
    setStat("s-price", fmtUsd(Number(p.priceUsd)), ch == null ? "" : `${ch > 0 ? "+" : ""}${ch.toFixed(1)}% 24h`);
    setStat("s-mcap", fmtUsd(p.marketCap ?? p.fdv), p.dexId ? `on ${p.dexId}` : "");
    setStat("s-vol", fmtUsd(p.volume?.h24), p.txns?.h24 ? `${(p.txns.h24.buys + p.txns.h24.sells).toLocaleString("en-US")} trades` : "");
    if (p.url) $("s-price-sub").innerHTML += ` · <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">chart</a>`;
  } catch {
    // leave the last good numbers in place
  }
}

function setStat(id, text, sub, quiet = false) {
  $(id).textContent = text;
  $(id).className = quiet ? "quiet" : "";
  $(`${id}-sub`).innerHTML = sub ? esc(sub) : "&nbsp;";
}

// ---- rounds feed -------------------------------------------------------------------------

const PAGE = 100; // signatures per account per request
const SHOW_STEP = 40; // transactions fetched per "load older"
const feed = { atas: [], histories: [], txs: new Map(), show: SHOW_STEP, rounds: [], complete: true, busy: false };

async function loadHistory(i, before) {
  const got = await rpc("getSignaturesForAddress", [feed.atas[i], { limit: PAGE, ...(before ? { before } : {}) }]);
  const h = feed.histories[i];
  const have = new Set(h.signatures.map((s) => s.signature));
  h.signatures.push(...got.filter((s) => !have.has(s.signature)));
  h.signatures.sort((a, b) => b.slot - a.slot);
  if (before || !h.loaded) h.more = got.length === PAGE;
  h.loaded = true;
}

async function fetchTxs(signatures) {
  await Promise.all(
    signatures
      .filter((s) => !feed.txs.has(s.signature))
      .map(async (s) => {
        const tx = await rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
        if (tx) feed.txs.set(s.signature, readTx(tx, cfg.payout, STOCKS));
      }),
  );
}

async function syncFeed({ older = false } = {}) {
  if (feed.busy) return;
  feed.busy = true;
  try {
    if (!feed.atas.length) {
      feed.atas = await Promise.all(STOCKS.map((s) => associatedTokenAddress(cfg.payout, s.mint, TOKEN_2022_PROGRAM)));
      feed.histories = STOCKS.map(() => ({ signatures: [], more: false, loaded: false }));
    }
    if (older) {
      feed.show += SHOW_STEP;
      const sofar = mergeSignatures(feed.histories);
      if (sofar.signatures.length < feed.show && !sofar.complete) {
        await Promise.all(feed.histories.map((h, i) => (h.more ? loadHistory(i, h.signatures.at(-1).signature) : null)));
      }
    } else {
      await Promise.all(feed.histories.map((_, i) => loadHistory(i)));
    }
    const merged = mergeSignatures(feed.histories);
    const wanted = merged.signatures.slice(0, feed.show);
    await fetchTxs(wanted);
    feed.complete = merged.complete && wanted.length === merged.signatures.length;
    feed.rounds = groupRounds(wanted.flatMap((s) => feed.txs.get(s.signature) ?? []));
    renderFeed();
    renderLookup();
    $("rounds-meta").textContent = `updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (e) {
    $("rounds-meta").textContent = /429|rate/i.test(e.message) ? "RPC busy, retrying" : "could not reach the chain, retrying";
  } finally {
    feed.busy = false;
  }
}

function renderFeed() {
  const rounds = feed.rounds;
  const list = $("rounds-list");
  const real = rounds.filter((r) => !r.other);
  if (!rounds.length) {
    list.innerHTML = `<div class="empty"><b>No rounds yet.</b> The first one runs within five minutes of the first fees arriving. Each round appears here as soon as it lands, read from the payout wallet's transactions.</div>`;
  } else {
    list.innerHTML = rounds.map((r) => roundHtml(r, viewCtx())).join("");
  }
  $("rounds-more").hidden = feed.complete;

  // stats: what these loaded rounds paid
  const spent = real.reduce((n, r) => n + (r.buy?.spent ?? 0n), 0n);
  const wallets = new Set(real.flatMap((r) => [...r.recipients.keys()]));
  if (real.length) {
    setStat("s-paid", `${fmtSol(spent)} SOL`, `${real.length} round${real.length === 1 ? "" : "s"} · ${wallets.size} wallet${wallets.size === 1 ? "" : "s"} shown`);
  } else if (launched || overridden) {
    setStat("s-paid", "nothing yet", "", true);
  }
}

const viewCtx = () => ({ prices: market.prices, multipliers: market.multipliers, now: now() });

// ---- wallet lookup ----------------------------------------------------------------------

let lookupAddr = null;
let lookupBalances = null;

async function onLookup(ev) {
  ev.preventDefault();
  const v = $("lookup-input").value.trim();
  lookupAddr = v;
  lookupBalances = null;
  const out = $("lookup-out");
  const bytes = decodePubkey(v);
  if (!bytes) {
    out.innerHTML = `<div class="verdict err">That isn't a Solana address. Paste the wallet address, 32 to 44 characters.</div>`;
    return;
  }
  if (EXCLUDED[v] || (cfg.payout === v)) {
    out.innerHTML = `<div class="verdict no">This is ${esc(EXCLUDED[v] ?? "the payout wallet")}. It is never paid, whatever it holds.</div>`;
    return;
  }
  if (!isOnCurve(bytes)) {
    out.innerHTML = `<div class="verdict no">This address is owned by a program: a pool, a vault, a token account or a locker. Those are never paid. If it's your token account, paste your wallet's address instead.</div>`;
    return;
  }
  out.innerHTML = `<div class="verdict">Reading…</div>`;
  try {
    const accts = await Promise.all(STOCKS.map((s) => associatedTokenAddress(v, s.mint, TOKEN_2022_PROGRAM)));
    if (cfg.mint && market.rotatorProgram) accts.push(await associatedTokenAddress(v, cfg.mint, market.rotatorProgram));
    const value = await getAccounts(rpc, accts, { encoding: "jsonParsed", commitment: "confirmed" });
    if (lookupAddr !== v) return; // a newer lookup started
    // uiAmount from the RPC already applies each xStock's multiplier
    lookupBalances = value.map((a) => Number(a?.data?.parsed?.info?.tokenAmount?.uiAmountString ?? 0));
    renderLookup();
  } catch (e) {
    out.innerHTML = `<div class="verdict err">Couldn't read the chain just now (${esc(e.message)}). Try again in a moment.</div>`;
  }
}

function renderLookup() {
  if (!lookupAddr || !lookupBalances) return;
  const v = lookupAddr;
  const received = STOCKS.map(() => 0n);
  for (const r of feed.rounds) {
    if (r.other) continue;
    const got = r.recipients.get(v);
    if (got) received[STOCKS.findIndex((s) => s.mint === r.mint)] += got;
  }
  const rotator = cfg.mint && market.rotatorProgram ? lookupBalances[N] : null;

  let verdict;
  if (!launched && !overridden) {
    verdict = `<div class="verdict">A valid wallet, and it will be counted once $ROTATOR launches. Before then nobody is paid.</div>`;
  } else if (rotator === null) {
    verdict = `<div class="verdict">A valid wallet. Every round, its ROTATOR balance is counted.</div>`;
  } else if (rotator > 0) {
    verdict = `<div class="verdict">Holding <b>${rotator.toLocaleString("en-US", { maximumFractionDigits: 0 })} ROTATOR</b>. This wallet is counted every round.</div>`;
  } else {
    verdict = `<div class="verdict no">This wallet holds no ROTATOR now, so it isn't earning. Anything it already earned is still paid when it reaches the minimum.</div>`;
  }

  const rows = STOCKS.map((s, i) => {
    const bal = lookupBalances[i];
    const usd = market.prices[i] && bal ? fmtUsd(bal * market.prices[i]) : "";
    const got = received[i] ? `<div class="g">+${fmtShares(toUi(received[i], i, market))} in rounds shown</div>` : "";
    return `<div class="h" style="--c:${s.accent}"><span class="s">${s.symbol}</span><span>${s.name}${got}</span>
      <span class="v"><b>${fmtShares(bal)}</b>${usd}</span></div>`;
  }).join("");

  $("lookup-out").innerHTML = `${verdict}<div class="holdings">${rows}</div>
    <div class="foot">Balances include stock from anywhere, not just ROTATOR. "In rounds shown" counts only the rounds loaded on the left. <a href="${solscan("account", v)}" target="_blank" rel="noopener noreferrer">${short(v)} on Solscan</a></div>`;
}

// ---- static parts --------------------------------------------------------------------------

function renderStatic() {
  const notice = $("notice");
  if (overridden) {
    notice.className = "notice pre";
    $("notice-tag").textContent = "local test";
    $("notice-body").innerHTML = `This page is pointed at <code>${esc(cfg.payout)}</code> by the URL. Local testing only. The public site ignores these parameters.`;
    $("strip-state").textContent = "LOCAL OVERRIDE";
  } else if (!launched) {
    notice.className = "notice pre";
    $("notice-tag").textContent = "not launched";
    $("notice-body").innerHTML =
      `<b>$ROTATOR hasn't launched yet.</b> It will launch on StonkFun, paired with SOL. Until then the rotation above ` +
      `runs on a preview clock and nobody is being paid. The official mint address will be posted here. Until it is, ` +
      `any token calling itself ROTATOR is not this one.`;
  } else {
    notice.className = "notice";
    $("notice-tag").textContent = "live";
    $("notice-body").innerHTML =
      `<b>Live.</b> Mint <code>${esc(cfg.mint)}</code>. Terminals will always show the pair as ROTATOR / SOL, because ` +
      `StonkFun fixes it at launch. The rotation is in what holders are paid, and every round is below.`;
    $("dot").classList.add("live");
  }
  if (cfg.stonkfun) Object.assign($("nav-buy"), { href: cfg.stonkfun, hidden: false });
  if (cfg.x) Object.assign($("nav-x"), { href: cfg.x, hidden: false });

  const link = (addr) => `<a href="${solscan("account", addr)}" target="_blank" rel="noopener noreferrer">${addr}</a>`;
  const rows = [
    ["$ROTATOR mint", cfg.mint ? link(cfg.mint) : `<em>posted here at launch</em>`],
    ["Payout wallet (pays holders)", link(cfg.payout)],
    ["Ops wallet (5% cut)", link(cfg.ops)],
    ...STOCKS.map((s) => [`${s.name} xStock (${s.symbol}x)`, link(s.mint)]),
  ];
  $("addr-list").innerHTML = rows.map(([k, v]) => `<div class="a"><span>${k}</span>${v}</div>`).join("");

  if (!feedOn) {
    $("rounds-list").innerHTML =
      `<div class="empty"><b>No rounds yet.</b> They start at launch. Each round will appear here as it lands: ` +
      `the stock bought, what it cost, and every wallet it was paid to, read straight from the payout wallet's transactions.</div>`;
    $("rounds-meta").textContent = "starts at launch";
  }
}

// ---- start ------------------------------------------------------------------------------------

buildSlots();
renderStatic();
renderClock();
setInterval(renderClock, 1000);

$("lookup-form").addEventListener("submit", onLookup);
$("rounds-more").addEventListener("click", async () => {
  $("rounds-more").disabled = true;
  await syncFeed({ older: true });
  $("rounds-more").disabled = false;
});

readMarket().then(() => {
  renderClock();
  if (feed.rounds.length) renderFeed();
});
setInterval(readMarket, 30_000);
readDex();
setInterval(readDex, 30_000);
if (feedOn) {
  syncFeed();
  setInterval(syncFeed, 45_000);
}
