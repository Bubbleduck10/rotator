// Formatting, and one round as HTML. Pure: everything it needs comes in through
// `ctx`, so a round can be rendered from fixtures as easily as from the chain.

import { STOCKS, XSTOCK_DECIMALS, solscan } from "./config.js";

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** raw token units of stock i → shares, through Backed's multiplier */
export const toUi = (raw, i, ctx) => (Number(raw) / 10 ** XSTOCK_DECIMALS) * (ctx.multipliers[i] ?? 1);

export function fmtShares(x) {
  if (!x) return "0";
  if (x >= 100) return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (x >= 1) return x.toFixed(4);
  return x.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function fmtUsd(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e4) return `$${(x / 1e3).toFixed(1)}K`;
  if (x >= 1) return `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (x >= 0.01) return `$${x.toFixed(4)}`;
  return `$${x.toPrecision(3)}`;
}

export function fmtSol(lamports) {
  const s = Number(lamports) / 1e9;
  return s >= 1 ? s.toFixed(3) : s >= 0.001 ? s.toFixed(4) : s.toPrecision(2);
}

export function mmss(secs) {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ago(unix, nowSecs) {
  const d = Math.max(0, nowSecs - unix);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(unix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const txLink = (sig, label) => `<a href="${solscan("tx", sig)}" target="_blank" rel="noopener noreferrer">${label}</a>`;

/** ctx: { prices, multipliers, now } */
export function roundHtml(r, ctx) {
  const i = STOCKS.findIndex((s) => s.mint === (r.mint ?? r.other?.mint));
  const s = STOCKS[i];
  const shares = (raw) => fmtShares(toUi(raw, i, ctx));
  const when = `<div class="when" title="${esc(new Date(r.time * 1000).toLocaleString())}">${ago(r.time, ctx.now)}</div>`;

  if (r.other) {
    const e = r.other;
    const what = e.kind === "in"
      ? `${shares(e.amount)} ${s.symbol} arrived from outside. Not a round.`
      : `${shares(e.amount)} ${s.symbol} left the wallet with SOL coming back. Not a payout.`;
    return `<div class="round other"><div class="chip">${s.symbol}</div><div class="what">${what}<div class="meta">${txLink(e.signature, "transaction")}</div></div>${when}</div>`;
  }

  const n = r.recipients.size;
  const holders = `${n} holder${n === 1 ? "" : "s"}`;
  const px = ctx.prices[i];
  const usd = px ? ` ≈ ${fmtUsd(toUi(r.buy ? r.buy.amount : r.paid, i, ctx) * px)}` : "";
  const bought = r.buy && `Bought <b>${shares(r.buy.amount)} ${s.symbol}</b> for ${fmtSol(r.buy.spent)} SOL`;

  let what;
  if (r.buy && r.pays.length && r.paid >= r.buy.amount) what = `${bought}, paid to <b>${holders}</b>`;
  else if (r.buy && r.pays.length) what = `${bought}, <b>${holders}</b> paid so far`;
  else if (r.buy) what = ctx.now - r.time < 600 ? `${bought}, paying holders now` : `${bought}. No payment found yet.`;
  else what = `Paid <b>${shares(r.paid)} ${s.symbol}</b> to <b>${holders}</b>`;

  const links = [
    r.buy ? txLink(r.buy.signature, "swap") : "swap older than shown",
    ...r.pays.map((p, k) => txLink(p.signature, r.pays.length === 1 ? "payout" : `payout ${k + 1}`)),
  ].join(" · ");

  const who = n
    ? `<details><summary>who was paid</summary><div class="who">${[...r.recipients]
        .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
        .map(([o, amt]) => `<span><a href="${solscan("account", o)}" target="_blank" rel="noopener noreferrer">${short(o)}</a></span><span>${shares(amt)} ${s.symbol}</span>`)
        .join("")}</div></details>`
    : "";

  return `<div class="round"><div class="chip" style="--c:${s.accent}">${s.symbol}</div>
    <div class="what">${what}<span class="num">${usd}</span><div class="meta">${links}</div></div>${when}${who}</div>`;
}
