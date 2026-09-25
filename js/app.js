// ROTATOR — live pool state, quotes, and a swap.
//
// The read path deliberately has no dependencies: decode, math and view come
// from the client package's compiled output, which is the same code the program
// is pinned to by 392 generated vectors. web3.js is only pulled in when someone
// actually trades, so a failure to load it costs the button and nothing else.

import { CONFIG, SYMBOLS, ACCENTS, explorerUrl } from "./config.js";
import { decodePool } from "./client/layout.js";
import { viewPool, quoteBuy, quoteSell, LAMPORTS_PER_SOL } from "./client/view.js";

const $ = (id) => document.getElementById(id);
const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111";

const state = {
  pool: null,
  view: null,
  /** the CLUSTER's time, not the browser's — see readChain() */
  chainTs: 0,
  /** ms of performance.now() when chainTs was read, so it can be advanced locally */
  chainAt: 0,
  side: "buy",
  wallet: null,
  swap: null, // lazily imported module
  pythPrices: {},
  rpcTrouble: false,
};

const nowTs = () =>
  state.chainTs ? state.chainTs + Math.floor((performance.now() - state.chainAt) / 1000) : Math.floor(Date.now() / 1000);

// ---- rpc ------------------------------------------------------------------

async function rpc(method, params) {
  const res = await fetch(CONFIG.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (res.status === 429) throw new Error("rate-limited");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result;
}

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Pool and clock in ONE request.
 *
 * The chain's time matters, not the browser's: the program chooses which pair
 * of oracle feeds a swap must carry from its own clock. A machine whose clock
 * is a few minutes fast would name the next window's feed, and the program
 * would reject the transaction with nothing on screen to explain why. Reading
 * the Clock sysvar costs nothing extra here and removes the whole class of bug.
 */
async function readChain() {
  const res = await rpc("getMultipleAccounts", [
    [CONFIG.pool, CLOCK_SYSVAR],
    { encoding: "base64", commitment: "confirmed" },
  ]);
  const [poolAcct, clockAcct] = res.value;
  if (!poolAcct) throw new Error(`no pool at ${CONFIG.pool} — is it initialized?`);
  if (poolAcct.owner !== CONFIG.programId) {
    throw new Error("that account is not owned by the rotator program");
  }

  const clockBytes = b64(clockAcct.data[0]);
  const unixTs = Number(new DataView(clockBytes.buffer).getBigInt64(32, true));

  state.pool = decodePool(b64(poolAcct.data[0]));
  state.chainTs = unixTs;
  state.chainAt = performance.now();
}

// ---- pyth (mainnet reference only) ----------------------------------------

const PYTH = {
  AAPL: "D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW",
  TSLA: "FQB8c4zB8Emrp9W8bmyk6GanCLq4aRytHYPDAnaEpq9z",
  NVDA: "5VETJ8h3p4JrESYrzhjTDAWPEjDjfcnduqe9CjxgqBNd",
  MSFT: "EKhrgXYwqsjgxF71Gxznui1zdoeqgxJzzPzfefEmm5un",
  AMZN: "4eT5d4SJ7GjD8HMpMysSNoPV7RBVTBGzoSEkynmPLMPS",
};

/**
 * These are MAINNET feeds. The deployed pool is on devnet in test-oracle mode,
 * so these prices are not what is moving its index — they are what a mainnet
 * pool would read. Shown because they make the rotation legible; labelled
 * because showing them unlabelled would imply a link that does not exist.
 */
async function readPyth() {
  try {
    const res = await fetch("https://solana-rpc.publicnode.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getMultipleAccounts",
        params: [Object.values(PYTH), { encoding: "base64", commitment: "confirmed" }],
      }),
    });
    const body = await res.json();
    if (body.error || !body.result) return;
    const syms = Object.keys(PYTH);
    body.result.value.forEach((acct, i) => {
      if (!acct) return;
      const d = b64(acct.data[0]);
      const dv = new DataView(d.buffer);
      // verification_level is a variable-width Borsh enum: Full is 1 byte,
      // Partial is 2, and everything after offset 40 shifts on it.
      const tag = d[40];
      const base = tag === 1 ? 41 : 42;
      const price = Number(dv.getBigInt64(base + 32, true));
      const expo = dv.getInt32(base + 48, true);
      state.pythPrices[syms[i]] = price * 10 ** expo;
    });
  } catch {
    // Reference prices are a nicety. Losing them must not disturb the page.
  }
}

// ---- render ---------------------------------------------------------------

function setAccent(symbol) {
  document.documentElement.style.setProperty("--accent", ACCENTS[symbol] ?? "#6f8a45");
}

function renderSlots() {
  const v = state.view;
  const el = $("slots");
  el.innerHTML = "";
  SYMBOLS.forEach((sym, i) => {
    const div = document.createElement("div");
    const isActive = i === v.activeSlot;
    const isNext = i === v.scheduledSlot && !isActive;
    div.className = "slot" + (isActive ? " active" : isNext ? " next" : "");
    div.style.setProperty("--slot-accent", ACCENTS[sym]);
    const px = state.pythPrices[sym];
    div.innerHTML =
      `<div class="tick">${sym}</div>` +
      `<div class="px">${px ? "$" + px.toFixed(2) : "—"}</div>` +
      `<div class="state">${isActive ? "paired" : isNext ? "scheduled" : ""}</div>` +
      (isActive ? `<div class="bar" id="slot-bar"></div>` : "");
    el.appendChild(div);
  });
}

function renderPool() {
  const v = state.view;
  setAccent(v.activeSymbol);

  $("paired").textContent = v.activeSymbol;
  $("hero-sym").textContent = v.activeSymbol;
  $("index").textContent = v.index.toFixed(6);
  $("price").textContent = v.priceSol.toExponential(4) + " SOL";
  $("reserves").textContent =
    `${v.reserveXWhole.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${CONFIG.xSymbol} / ${v.reserveSol.toFixed(3)} SOL`;
  $("fee").textContent = (v.feeBps / 100).toFixed(2) + "%";

  $("pool-state").textContent = v.needsRotation ? `on ${v.activeSymbol}, ${v.scheduledSymbol} scheduled` : "in sync";
  renderSlots();
  renderCountdown();
}

function renderCountdown() {
  const v = state.view;
  if (!v) return;
  const total = Number(state.pool.rotateSecs);
  const left = Math.max(0, v.nextRotationTs - nowTs());
  const pct = total > 0 ? ((total - left) / total) * 100 : 0;
  $("cd-fill").style.width = pct.toFixed(1) + "%";
  const bar = $("slot-bar");
  if (bar) bar.style.width = pct.toFixed(1) + "%";

  $("cd-text").textContent = `${left}s until the pairing moves to ${v.scheduledSymbol === v.activeSymbol ? nextSymbol() : v.scheduledSymbol}`;
  $("cd-next").textContent = v.needsRotation ? "needs a crank" : "in sync";
}

function nextSymbol() {
  const v = state.view;
  return SYMBOLS[(v.activeSlot + 1) % SYMBOLS.length];
}

function renderNotice() {
  const test = CONFIG.oracleMode === "test";
  $("oracle-badge").textContent = test ? "test oracle" : "pyth";
  $("notice-body").innerHTML = test
    ? `<b>This pool is on devnet, running on mock oracle feeds.</b> Its index is moved by ` +
      `prices published for testing, not by Pyth. The dollar prices on the five stocks above are ` +
      `live Pyth mainnet feeds shown for reference — they are what a mainnet pool would read, and ` +
      `they are <b>not</b> what is moving this pool. The rotation, the curve, the quotes and the ` +
      `swap are all real and running on chain.`
    : `<b>Live on ${CONFIG.cluster}, indexed to Pyth.</b> The pairing rotates every ` +
      `${state.pool ? Number(state.pool.rotateSecs) : 300} seconds.`;
}

// ---- quoting --------------------------------------------------------------

function parseAmount(text, decimals) {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (!/^\d*\.?\d*$/.test(t)) return null;
  const [whole = "0", frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
  } catch {
    return null;
  }
}

const fmtUnits = (v, decimals, dp = 6) => (Number(v) / 10 ** decimals).toFixed(dp);

function renderQuote() {
  const buy = state.side === "buy";
  const decimals = buy ? 9 : CONFIG.xDecimals;
  const amount = parseAmount($("amount").value, decimals);

  if (!state.pool || amount === null || amount === 0n) {
    $("q-out").textContent = "—";
    $("q-min").textContent = "—";
    $("q-impact").textContent = "—";
    $("q-out").className = "";
    setButton();
    return;
  }

  const q = buy ? quoteBuy(state.pool, amount, 100) : quoteSell(state.pool, amount, 100);

  // `out === null` means the curve cannot honour this trade — the program will
  // reject it. Showing 0, or silently capping, is the exact failure the program
  // was changed to avoid: it would take the payment and hand back short.
  if (q.out === null) {
    $("q-out").textContent = "too large — size down";
    $("q-out").className = "warn";
    $("q-min").textContent = "—";
    $("q-impact").textContent = "—";
    setButton("Amount exceeds what the pool can fill");
    return;
  }

  $("q-out").className = "";
  $("q-out").textContent = buy
    ? `${fmtUnits(q.out, CONFIG.xDecimals, 4)} ${CONFIG.xSymbol}`
    : `${fmtUnits(q.out, 9, 6)} SOL`;
  $("q-min").textContent = buy
    ? `${fmtUnits(q.minOut, CONFIG.xDecimals, 4)} ${CONFIG.xSymbol}`
    : `${fmtUnits(q.minOut, 9, 6)} SOL`;
  $("q-impact").textContent = (q.priceImpact * 100).toFixed(2) + "%";
  setButton();
}

function setButton(disabledReason) {
  const btn = $("go");
  if (!state.wallet) {
    btn.textContent = "Connect wallet";
    btn.disabled = false;
    return;
  }
  if (disabledReason) {
    btn.textContent = disabledReason;
    btn.disabled = true;
    return;
  }
  const decimals = state.side === "buy" ? 9 : CONFIG.xDecimals;
  const amount = parseAmount($("amount").value, decimals);
  btn.disabled = !amount || amount === 0n;
  btn.textContent = state.side === "buy" ? `Buy ${CONFIG.xSymbol}` : `Sell ${CONFIG.xSymbol}`;
}

function setSide(side) {
  state.side = side;
  $("tab-buy").setAttribute("aria-pressed", String(side === "buy"));
  $("tab-sell").setAttribute("aria-pressed", String(side === "sell"));
  $("in-label").textContent = "You pay";
  $("in-unit").textContent = side === "buy" ? "SOL" : CONFIG.xSymbol;
  $("amount").value = "";
  renderQuote();
}

// ---- swap -----------------------------------------------------------------

function msg(text, kind = "") {
  $("msg").className = "msg " + kind;
  $("msg").innerHTML = text;
}

async function loadSwap() {
  if (state.swap) return state.swap;
  try {
    state.swap = await import("./swap.js");
    return state.swap;
  } catch (err) {
    throw new Error(`Could not load the trading module: ${err.message}`);
  }
}

async function onGo() {
  try {
    const swap = await loadSwap();

    if (!state.wallet) {
      msg("Approve the connection in your wallet…");
      state.wallet = await swap.connect();
      $("wallet-state").textContent = state.wallet.slice(0, 4) + "…" + state.wallet.slice(-4);
      msg("");
      setButton();
      return;
    }

    const decimals = state.side === "buy" ? 9 : CONFIG.xDecimals;
    const amount = parseAmount($("amount").value, decimals);
    if (!amount) return;

    const q = state.side === "buy" ? quoteBuy(state.pool, amount, 100) : quoteSell(state.pool, amount, 100);
    if (q.out === null) {
      msg("That trade is larger than the pool can fill. Size down.", "err");
      return;
    }

    $("go").disabled = true;
    msg("Confirm in your wallet…");

    // Re-read immediately before building: the pairing may have rotated while
    // the amount was being typed, and a swap that names last window's feeds is
    // rejected. This is the cheapest possible guard against it.
    await readChain();
    state.view = viewPool(state.pool, SYMBOLS, nowTs(), CONFIG.xDecimals);
    renderPool();

    const sig = await swap.sendSwap({
      rpcUrl: CONFIG.rpcUrl,
      programId: CONFIG.programId,
      pool: state.pool,
      side: state.side === "buy" ? swap.Side.BuyX : swap.Side.SellX,
      amountIn: amount,
      minOut: q.minOut,
      nowTs: nowTs(),
    });

    msg(`Filled. <a href="${explorerUrl("tx", sig)}" target="_blank" rel="noopener noreferrer">View transaction</a>`, "ok");
    $("amount").value = "";
    await refresh();
  } catch (err) {
    const m = String(err?.message ?? err);
    msg(/User rejected|rejected the request/i.test(m) ? "Cancelled in the wallet." : m, "err");
  } finally {
    setButton();
  }
}

// ---- loop -----------------------------------------------------------------

async function refresh() {
  try {
    await readChain();
    state.view = viewPool(state.pool, SYMBOLS, nowTs(), CONFIG.xDecimals);
    state.rpcTrouble = false;
    renderPool();
    renderNotice();
    renderQuote();
  } catch (err) {
    // Devnet's public endpoint rate-limits freely. Say the reading is stale
    // rather than blanking numbers that were correct a moment ago.
    state.rpcTrouble = true;
    $("pool-state").textContent = /rate-limited/.test(err.message) ? "rate-limited, retrying" : `error: ${err.message}`;
  }
}

async function main() {
  $("cluster").textContent = CONFIG.cluster;
  $("pool-link").textContent = `pool ${CONFIG.pool.slice(0, 4)}…${CONFIG.pool.slice(-4)}`;
  $("pool-link").href = explorerUrl("address", CONFIG.pool);
  $("f-program").href = explorerUrl("address", CONFIG.programId);
  $("f-pool").href = explorerUrl("address", CONFIG.pool);
  $("f-mint").href = explorerUrl("address", CONFIG.mint);
  $("f-note").textContent = "liquidity is locked — the program has no withdraw";

  $("tab-buy").addEventListener("click", () => setSide("buy"));
  $("tab-sell").addEventListener("click", () => setSide("sell"));
  $("amount").addEventListener("input", renderQuote);
  $("go").addEventListener("click", onGo);

  await Promise.all([refresh(), readPyth()]);
  renderSlots();

  // Pool every 6s; the countdown ticks locally off the chain clock in between,
  // so the display stays smooth without hammering a public endpoint.
  setInterval(refresh, 6000);
  setInterval(renderCountdown, 1000);
  setInterval(readPyth, 30000);
}

main().catch((e) => {
  $("notice-body").innerHTML = `<b>Could not start:</b> ${e.message}`;
});
