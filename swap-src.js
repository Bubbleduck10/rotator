// Everything a swap needs, and nothing the rest of the page needs.
//
// This is the only file that pulls in web3.js, which is why it is bundled
// separately and imported lazily. The page reads the pool, renders the pairing
// and quotes trades with none of it.
//
// The wallet is the injected provider directly — no wallet-adapter. Phantom,
// Solflare and Backpack all expose `signAndSendTransaction`, and a modal
// library for one button would be more code than the button.

import { Connection, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { swapInstruction, Side, TOKEN_PROGRAM_ID } from "./.build/client/instructions.js";
import { poolAddress, solVaultAddress } from "./.build/client/pda.js";

export { Side, poolAddress, solVaultAddress, PublicKey };

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** The provider the user actually has, or null. */
export function getWallet() {
  const w = globalThis.window;
  if (!w) return null;
  // Phantom injects window.phantom.solana; others use window.solana. Checking
  // isPhantom on window.solana alone misses wallets that set only their own
  // namespace, and misses Phantom when another wallet has taken window.solana.
  return w.phantom?.solana ?? (w.solana?.isPhantom || w.solana?.isSolflare || w.solana ? w.solana : null);
}

export async function connect() {
  const wallet = getWallet();
  if (!wallet) throw new Error("No Solana wallet found. Install Phantom, Solflare or Backpack.");
  const res = await wallet.connect();
  return (res?.publicKey ?? wallet.publicKey).toBase58();
}

/** Deterministic ATA derivation — avoids a dependency on @solana/spl-token. */
export function associatedTokenAddress(mint, owner) {
  const [addr] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return addr;
}

function createAtaInstruction(payer, ata, owner, mint) {
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.alloc(0),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  };
}

/**
 * Build, sign and send a swap.
 *
 * `nowTs` is passed through to the instruction builder rather than left to
 * default: the program picks the feeds from ITS clock, and a browser whose
 * clock is off by a window would name the wrong pair of feeds and be rejected.
 * The caller passes the chain's time, read from the cluster.
 */
export async function sendSwap({ rpcUrl, programId, pool, side, amountIn, minOut, nowTs }) {
  const wallet = getWallet();
  if (!wallet) throw new Error("No Solana wallet found.");
  const owner = wallet.publicKey ?? (await wallet.connect()).publicKey;

  const connection = new Connection(rpcUrl, "confirmed");
  const pid = new PublicKey(programId);
  const mint = new PublicKey(pool.xMint);
  const userX = associatedTokenAddress(mint, owner);

  const tx = new Transaction();

  // A first-time buyer has no X account yet. Creating it in the same
  // transaction is one approval instead of two, and a swap into a missing
  // account fails with an error nobody can act on.
  const existing = await connection.getAccountInfo(userX);
  if (!existing) {
    if (side === Side.SellX) throw new Error("You have no X token account, so there is nothing to sell.");
    tx.add(createAtaInstruction(owner, userX, owner, mint));
  }

  tx.add(
    swapInstruction({
      programId: pid,
      pool,
      user: owner,
      userX,
      side,
      amountIn,
      minOut,
      nowTs,
    }),
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner;

  const { signature } = await wallet.signAndSendTransaction(tx);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}
