// Derived, display-ready values. Everything here is computed from the pool
// account plus a timestamp — no extra RPC calls.
import { SCALE, activeSlot, buyX, sellX } from "./math.js";
export const LAMPORTS_PER_SOL = 1_000_000_000;
/**
 * `symbols` must be in the same order as the feeds passed at initialize —
 * the program only stores feed addresses, not tickers.
 */
export function viewPool(pool, symbols, nowTs, xDecimals = 6) {
    const now = BigInt(Math.floor(nowTs));
    const n = pool.nStocks;
    const scheduled = activeSlot(now, pool.startTs, pool.rotateSecs, n);
    const elapsed = now > pool.startTs ? now - pool.startTs : 0n;
    const windowsDone = pool.rotateSecs > 0n ? elapsed / pool.rotateSecs : 0n;
    const nextRotationTs = Number(pool.startTs + (windowsDone + 1n) * pool.rotateSecs);
    const index = Number(pool.indexQ) / Number(SCALE);
    // price per base unit = Rq * I / Rx, scaled to whole X and to SOL
    const perBaseUnit = pool.reserveX === 0n ? 0 : (Number(pool.reserveQ) * index) / Number(pool.reserveX);
    const priceSol = (perBaseUnit * Math.pow(10, xDecimals)) / LAMPORTS_PER_SOL;
    return {
        activeSlot: pool.active,
        activeSymbol: symbols[pool.active] ?? `slot ${pool.active}`,
        scheduledSlot: scheduled,
        scheduledSymbol: symbols[scheduled] ?? `slot ${scheduled}`,
        needsRotation: scheduled !== pool.active,
        nextRotationTs,
        secondsUntilRotation: Math.max(0, nextRotationTs - Math.floor(nowTs)),
        index,
        priceSol,
        reserveXWhole: Number(pool.reserveX) / Math.pow(10, xDecimals),
        reserveSol: Number(pool.reserveQ) / LAMPORTS_PER_SOL,
        feeBps: pool.feeBps,
    };
}
function impact(out, amountIn, spotOut) {
    if (out === null || spotOut <= 0)
        return 0;
    const got = Number(out);
    const ideal = spotOut * Number(amountIn);
    return ideal <= 0 ? 0 : Math.max(0, (ideal - got) / ideal);
}
export function quoteBuy(pool, lamportsIn, slippageBps = 100) {
    const out = buyX(pool.reserveX, pool.reserveQ, pool.indexQ, lamportsIn, pool.feeBps);
    // marginal rate at zero size, for impact only
    const unit = buyX(pool.reserveX, pool.reserveQ, pool.indexQ, 1000000n, pool.feeBps);
    const spot = unit === null ? 0 : Number(unit) / 1_000_000;
    return {
        out,
        minOut: out === null ? 0n : (out * BigInt(10_000 - slippageBps)) / 10000n,
        priceImpact: impact(out, lamportsIn, spot),
    };
}
export function quoteSell(pool, xIn, slippageBps = 100) {
    const out = sellX(pool.reserveX, pool.reserveQ, pool.indexQ, xIn, pool.feeBps);
    const unit = sellX(pool.reserveX, pool.reserveQ, pool.indexQ, 1000000n, pool.feeBps);
    const spot = unit === null ? 0 : Number(unit) / 1_000_000;
    return {
        out,
        minOut: out === null ? 0n : (out * BigInt(10_000 - slippageBps)) / 10000n,
        priceImpact: impact(out, xIn, spot),
    };
}
