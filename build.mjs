// Makes site/ self-contained: a static directory with no build step at the far end.
//
// Two bundles, deliberately separate:
//
//   js/client/*.js   the PURE client modules — decode, math, view, fetch. No
//                    web3.js, no dependencies, copied straight from the client's
//                    compiled output so the page cannot drift from the package
//                    whose quote math is pinned to the chain by 392 vectors.
//
//   js/swap.js       web3.js + the instruction builders, bundled. Only this
//                    needs a bundler, and only a swap needs it — so it is
//                    loaded lazily. If it fails, the page still shows live pool
//                    state and quotes; only the button stops working.

import { mkdir, copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "client/dist/src");

// These are the ones with no runtime web3.js import. Verified, not assumed:
// importing index.js instead would pull in instructions.js and break the page.
const PURE = ["base58.js", "layout.js", "math.js", "view.js", "fetch.js"];

await mkdir(join(here, "js/client"), { recursive: true });

const available = await readdir(dist);
for (const f of PURE) {
  if (!available.includes(f)) throw new Error(`${f} missing from ${dist} — run \`npm run build\` in client/`);
  const src = await readFile(join(dist, f), "utf8");
  if (src.includes("@solana/web3.js")) {
    throw new Error(`${f} now imports web3.js — it can no longer be served raw to the page`);
  }
  await copyFile(join(dist, f), join(here, "js/client", f));
}
console.log(`copied ${PURE.length} pure client modules`);

// The web3-dependent modules are staged OUTSIDE js/, into .build/, for two
// reasons. They must never be served raw — a browser import of instructions.js
// would 404 on "@solana/web3.js". And staging them here makes esbuild resolve
// web3.js from site/node_modules for both them and swap-src.js, so the bundle
// contains ONE copy. Two copies would define two PublicKey classes, and the
// `instanceof` checks inside web3.js would start failing on objects that look
// completely correct in a debugger.
const stage = join(here, ".build/client");
await mkdir(stage, { recursive: true });
for (const f of available) {
  if (f.endsWith(".js")) await copyFile(join(dist, f), join(stage, f));
}

await run("npx", ["--yes", "esbuild", "swap-src.js",
  "--bundle", "--format=esm", "--platform=browser", "--target=es2022",
  "--define:global=globalThis",
  "--outfile=js/swap.js",
], { cwd: here, shell: true });

const bundled = await readFile(join(here, "js/swap.js"), "utf8");
console.log(`bundled js/swap.js (${(bundled.length / 1024).toFixed(0)} KB)`);

// One copy, or the instanceof failures above.
//
// The zero case throws too, and that is the point: the first version of this
// check matched /class PublicKey/, which esbuild never emits — it counted 0
// every time and would have waved a genuine duplicate straight through. A
// guard that cannot fail is worse than no guard, because it reads as evidence.
const copies = (bundled.match(/var PublicKey = class/g) ?? []).length;
if (copies === 0) {
  throw new Error(
    "could not find the PublicKey class in the bundle — this duplicate check has stopped working. " +
      "Fix the pattern rather than removing the check.",
  );
}
if (copies > 1) {
  throw new Error(
    `bundle contains ${copies} PublicKey classes — web3.js was included more than once, and the ` +
      "instanceof checks inside it will fail on objects that look correct.",
  );
}
console.log("web3.js: one copy in the bundle");
