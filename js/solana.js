// The few pieces of Solana the page needs, with no dependencies.
//
// The browser can't ask the public RPC "which token accounts does this wallet
// own" (getTokenAccountsByOwner needs a paid key), so it derives the addresses
// instead: an associated token account is a PDA of (owner, token program, mint).
// Deriving a PDA takes SHA-256, which the browser has, and an ed25519 "is this on
// the curve" test, which is below. test/solana.test.mjs checks both against
// web3.js on thousands of inputs. A wrong curve test here would not throw. It
// would derive a plausible-looking address that nobody owns and report a zero
// balance.

export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

// ---- base58 ---------------------------------------------------------------------

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = Object.fromEntries([...ALPHABET].map((c, i) => [c, BigInt(i)]));

export function encodeBase58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** 32 bytes, or null if `s` is not a base58 public key. */
export function decodePubkey(s) {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return null;
  let n = 0n;
  for (const c of s) {
    const v = INDEX[c];
    if (v === undefined) return null;
    n = n * 58n + v;
  }
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  if (n !== 0n) return null; // more than 32 bytes' worth
  // Leading '1's are leading zero bytes, and must match exactly, or two strings
  // would decode to the same key.
  let ones = 0;
  while (s[ones] === "1") ones++;
  let zeros = 0;
  while (zeros < 32 && bytes[zeros] === 0) zeros++;
  if (ones !== zeros) return null;
  return bytes;
}

// ---- ed25519: is a 32-byte string a point on the curve? -------------------------

const P = 2n ** 255n - 19n;
const mod = (a) => {
  const r = a % P;
  return r >= 0n ? r : r + P;
};
function pow(b, e) {
  let r = 1n;
  b = mod(b);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return r;
}
// Computed rather than pasted: a transcription error in a 77-digit constant
// would pass every test that happens not to hit it.
const D = mod(-121665n * pow(121666n, P - 2n));

/**
 * Mirrors web3.js, which asks @noble/curves to decode the point and treats a
 * throw as "off curve". Decoding fails when y ≥ p, when x² = (y²−1)/(dy²+1) has
 * no square root, or when x = 0 but the sign bit says negative.
 */
export function isOnCurve(bytes) {
  if (bytes.length !== 32) return false;
  const signBit = bytes[31] & 0x80;
  let y = BigInt(bytes[31] & 0x7f);
  for (let i = 30; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n); // never zero: d is not a square
  if (u === 0n) return signBit === 0; // x = 0
  const x2 = (u * pow(v, P - 2n)) % P;
  return pow(x2, (P - 1n) / 2n) === 1n; // Euler: x² is a square
}

// ---- program addresses ------------------------------------------------------------

const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function findProgramAddress(seeds, programId) {
  const program = decodePubkey(programId);
  const parts = [...seeds, null, program, PDA_MARKER];
  for (let bump = 255; bump >= 0; bump--) {
    parts[seeds.length] = Uint8Array.of(bump);
    const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      buf.set(p, o);
      o += p.length;
    }
    const hash = await sha256(buf);
    if (!isOnCurve(hash)) return [encodeBase58(hash), bump];
  }
  throw new Error("no viable bump");
}

export async function associatedTokenAddress(owner, mint, tokenProgram = TOKEN_2022_PROGRAM) {
  const [address] = await findProgramAddress(
    [decodePubkey(owner), decodePubkey(tokenProgram), decodePubkey(mint)],
    ATA_PROGRAM,
  );
  return address;
}

// ---- rpc ----------------------------------------------------------------------------

/**
 * A small client for a public endpoint: few requests in flight, and a retry on
 * 429 with backoff. publicnode answers two dozen parallel reads fine, but refuses
 * more than one getTransaction per batch request, so they go as separate calls.
 */
export function rpcClient(url, { concurrency = 6 } = {}) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || !queue.length) return;
    active++;
    const job = queue.shift();
    job().finally(() => {
      active--;
      next();
    });
  };
  const limited = (fn) =>
    new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject));
      next();
    });

  async function once(method, params) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
      return body.result;
    }
  }

  return (method, params) => limited(() => once(method, params));
}

/**
 * getMultipleAccounts in chunks of ten. publicnode refuses an eleventh key with
 * a bare "Request blocked" (HTTP 403), which looks exactly like an outage.
 */
export async function getAccounts(rpc, keys, config) {
  const chunks = [];
  for (let i = 0; i < keys.length; i += 10) chunks.push(keys.slice(i, i + 10));
  const parts = await Promise.all(chunks.map((c) => rpc("getMultipleAccounts", [c, config])));
  return parts.flatMap((p) => p.value);
}
