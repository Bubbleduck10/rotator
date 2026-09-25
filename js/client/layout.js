// Pool account decoder. Offsets mirror `programs/rotator/src/state.rs` exactly
// and are pinned by `test/decode.test.ts` against a fixture dumped from the
// real program. If you change one side, regenerate the fixture and run the test
// — a silent offset drift here shows wrong prices with no error anywhere.
import { encodeBase58 } from "./base58.js";
export const POOL_LEN = 408;
export const MAX_STOCKS = 5;
export const POOL_SEED = "pool";
export const SOL_VAULT_SEED = "sol_vault";
/**
 * Where a leg's prices come from. The stock leg and the SOL quote leg are
 * configured independently, because Pyth sells equity and crypto data as
 * separate entitlements — a pool can read a signature-verified SOL/USD feed
 * while its stock prices are published by a key the operator holds.
 */
export const OracleMode = {
    /** accounts the rotator program owns, written by its publisher */
    SelfPublished: 0,
    /** accounts owned by the Pyth receiver — signature verified */
    Pyth: 1,
};
// Field offsets, in the order state.rs packs them.
const OFF_INITIALIZED = 0;
const OFF_BUMP = 1;
const OFF_ACTIVE = 2;
const OFF_N_STOCKS = 3;
const OFF_FEE_BPS = 4;
const OFF_STOCK_ORACLE = 6;
const OFF_SOL_ORACLE = 7;
const OFF_AUTHORITY = 8;
const OFF_X_MINT = 40;
const OFF_X_VAULT = 72;
const OFF_SOL_VAULT = 104;
const OFF_SOL_FEED = 136;
const OFF_STOCK_FEEDS = 168;
const OFF_START_TS = 328;
const OFF_ROTATE_SECS = 336;
const OFF_RESERVE_X = 344;
const OFF_RESERVE_Q = 352;
const OFF_INDEX_Q = 360;
const OFF_S0_NUM = 376;
const OFF_S0_DEN = 392;
function u128LE(dv, offset) {
    const lo = dv.getBigUint64(offset, true);
    const hi = dv.getBigUint64(offset + 8, true);
    return (hi << 64n) | lo;
}
function pubkey(data, offset) {
    return encodeBase58(data.subarray(offset, offset + 32));
}
export function decodePool(data) {
    if (data.length < POOL_LEN) {
        throw new Error(`pool account too short: ${data.length} < ${POOL_LEN}`);
    }
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const stockFeeds = [];
    for (let i = 0; i < MAX_STOCKS; i++) {
        stockFeeds.push(pubkey(data, OFF_STOCK_FEEDS + i * 32));
    }
    return {
        isInitialized: data[OFF_INITIALIZED] !== 0,
        bump: data[OFF_BUMP],
        active: data[OFF_ACTIVE],
        nStocks: data[OFF_N_STOCKS],
        feeBps: dv.getUint16(OFF_FEE_BPS, true),
        stockOracle: data[OFF_STOCK_ORACLE],
        solOracle: data[OFF_SOL_ORACLE],
        authority: pubkey(data, OFF_AUTHORITY),
        xMint: pubkey(data, OFF_X_MINT),
        xVault: pubkey(data, OFF_X_VAULT),
        solVault: pubkey(data, OFF_SOL_VAULT),
        solFeed: pubkey(data, OFF_SOL_FEED),
        stockFeeds,
        startTs: dv.getBigInt64(OFF_START_TS, true),
        rotateSecs: dv.getBigInt64(OFF_ROTATE_SECS, true),
        reserveX: dv.getBigUint64(OFF_RESERVE_X, true),
        reserveQ: dv.getBigUint64(OFF_RESERVE_Q, true),
        indexQ: u128LE(dv, OFF_INDEX_Q),
        s0Num: u128LE(dv, OFF_S0_NUM),
        s0Den: u128LE(dv, OFF_S0_DEN),
    };
}
