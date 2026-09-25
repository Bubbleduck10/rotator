// Reading the pool. Two ways in: with a web3.js Connection, or with nothing but
// `fetch` against an RPC URL — the latter is handy for a server, a worker, or a
// page that doesn't want web3.js in its bundle.
import { decodePool } from "./layout.js";
import { poolAddress } from "./pda.js";
export async function fetchPool(connection, programId, mint) {
    const address = poolAddress(programId, mint);
    const account = await connection.getAccountInfo(address);
    if (!account)
        throw new Error(`no pool at ${address.toBase58()} — is it initialized?`);
    if (!account.owner.equals(programId)) {
        throw new Error(`account ${address.toBase58()} is not owned by the rotator program`);
    }
    return decodePool(account.data);
}
/**
 * Dependency-free read. `poolAddress58` is the pool PDA in base58 — derive it
 * once with `poolAddress()` and hard-code it, or pass it in from config.
 */
export async function fetchPoolByUrl(rpcUrl, poolAddress58, expectedOwner58) {
    const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [poolAddress58, { encoding: "base64", commitment: "confirmed" }],
        }),
    });
    if (!res.ok)
        throw new Error(`RPC ${res.status}: ${await res.text()}`);
    const body = (await res.json());
    if (body.error)
        throw new Error(`RPC error: ${body.error.message}`);
    const value = body.result?.value;
    if (!value)
        throw new Error(`no pool at ${poolAddress58} — is it initialized?`);
    if (expectedOwner58 && value.owner !== expectedOwner58) {
        throw new Error(`account ${poolAddress58} is not owned by the rotator program`);
    }
    const bytes = Uint8Array.from(atob(value.data[0]), (c) => c.charCodeAt(0));
    return decodePool(bytes);
}
