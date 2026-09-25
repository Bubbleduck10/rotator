// Minimal base58 so the decoder has no dependencies. Bitcoin alphabet, which
// is what Solana uses.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP = {};
for (let i = 0; i < ALPHABET.length; i++)
    MAP[ALPHABET[i]] = i;
export function encodeBase58(bytes) {
    if (bytes.length === 0)
        return "";
    const digits = [0];
    for (const byte of bytes) {
        let carry = byte;
        for (let i = 0; i < digits.length; i++) {
            carry += digits[i] << 8;
            digits[i] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let out = "";
    // leading zero bytes become leading '1's
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++)
        out += ALPHABET[0];
    for (let i = digits.length - 1; i >= 0; i--)
        out += ALPHABET[digits[i]];
    return out;
}
export function decodeBase58(str) {
    if (str.length === 0)
        return new Uint8Array(0);
    const bytes = [0];
    for (const ch of str) {
        const value = MAP[ch];
        if (value === undefined)
            throw new Error(`invalid base58 character: ${ch}`);
        let carry = value;
        for (let i = 0; i < bytes.length; i++) {
            carry += bytes[i] * 58;
            bytes[i] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    let leading = 0;
    for (let i = 0; i < str.length && str[i] === ALPHABET[0]; i++)
        leading++;
    return new Uint8Array([...new Array(leading).fill(0), ...bytes.reverse()]);
}
