// The page's dependency-free Solana helpers, checked against web3.js — the
// implementation every wallet and the keeper itself uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  encodeBase58, decodePubkey, isOnCurve, findProgramAddress, associatedTokenAddress,
  ATA_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM,
} from "../js/solana.js";
import { STOCKS } from "../js/config.js";

test("base58 round-trips and matches web3.js, leading zero bytes included", () => {
  const cases = [new Uint8Array(32), Uint8Array.of(0, 0, ...randomBytes(30))];
  for (let i = 0; i < 500; i++) cases.push(new Uint8Array(randomBytes(32)));
  for (const b of cases) {
    const s = new PublicKey(b).toBase58();
    assert.equal(encodeBase58(b), s);
    assert.deepEqual(decodePubkey(s), b);
  }
});

test("addresses that are not 32 bytes of base58 are refused", () => {
  const ok = Keypair.generate().publicKey.toBase58();
  for (const bad of ["", "hello", ok + "1", ok.slice(0, -1) + "0", ok.replace(/./, "l"), "1" + ok, 42, null]) {
    assert.equal(decodePubkey(bad), null, String(bad));
  }
});

test("a leading '1' is a zero byte: adding or dropping one names a different key", () => {
  // Both strings below carry the same big number as a real key; only the count
  // of leading '1's differs. Accepting them would make two spellings of one key.
  let short;
  while (!short || short.length > 43) short = Keypair.generate().publicKey.toBase58();
  assert.equal(decodePubkey("1" + short), null, "extra leading 1");

  const zeroLed = new PublicKey(Uint8Array.of(0, ...randomBytes(31))).toBase58();
  assert.equal(zeroLed[0], "1");
  assert.ok(decodePubkey(zeroLed));
  assert.equal(decodePubkey(zeroLed.slice(1)), null, "leading 1 dropped");
});

test("isOnCurve agrees with web3.js on random bytes and on real keys", () => {
  let on = 0;
  for (let i = 0; i < 4000; i++) {
    const b = new Uint8Array(randomBytes(32));
    const expected = PublicKey.isOnCurve(b);
    assert.equal(isOnCurve(b), expected, encodeBase58(b));
    if (expected) on++;
  }
  // About half of random strings decode. Far from half means one side is broken
  // in a way that happens to agree — say, both always false.
  assert.ok(on > 1700 && on < 2300, `${on}/4000 on curve`);
  for (let i = 0; i < 200; i++) assert.equal(isOnCurve(Keypair.generate().publicKey.toBytes()), true);
});

test("isOnCurve agrees with web3.js on the edge cases random bytes never reach", () => {
  const le = (n) => {
    const b = new Uint8Array(32);
    for (let i = 0; i < 32; i++) { b[i] = Number(n & 0xffn); n >>= 8n; }
    return b;
  };
  const p = 2n ** 255n - 19n;
  const cases = [
    le(0n), le(1n), le(p - 1n), le(p), le(p + 1n), le(2n ** 255n - 1n),
    // y = 1 is the point x = 0: valid with the sign bit clear, invalid with it set
    (() => { const b = le(1n); b[31] |= 0x80; return b; })(),
    (() => { const b = le(p - 1n); b[31] |= 0x80; return b; })(),
  ];
  for (const b of cases) assert.equal(isOnCurve(b), PublicKey.isOnCurve(b), encodeBase58(b));
});

test("PDAs and associated token accounts match web3.js exactly", async () => {
  const program = new PublicKey(ATA_PROGRAM);
  for (let i = 0; i < 300; i++) {
    const owner = Keypair.generate().publicKey;
    const stock = STOCKS[i % STOCKS.length].mint;
    const tokenProgram = i % 7 === 0 ? TOKEN_PROGRAM : TOKEN_2022_PROGRAM;
    const [expected, bump] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(stock).toBuffer()],
      program,
    );
    assert.equal(await associatedTokenAddress(owner.toBase58(), stock, tokenProgram), expected.toBase58());
    const [addr, b] = await findProgramAddress(
      [owner.toBytes(), new PublicKey(tokenProgram).toBytes(), new PublicKey(stock).toBytes()],
      ATA_PROGRAM,
    );
    assert.equal(addr, expected.toBase58());
    assert.equal(b, bump);
  }
});
