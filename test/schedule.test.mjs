// The page and the keeper must name the same stock for the same moment, and the
// page's stock list must be the keeper's, in the keeper's order.
//
// Imports the keeper's TypeScript source directly (Node strips the types), so
// there is no build output to go stale. The site is published from its own
// repository, where the keeper is absent; there the test skips rather than fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { windowAt } from "../js/schedule.js";
import { STOCKS } from "../js/config.js";

const keeperSrc = fileURLToPath(new URL("../../rotation/src/", import.meta.url));
const skip = !existsSync(keeperSrc + "schedule.ts") && "keeper source not alongside the site";

test("same window as the keeper, across launch, boundaries and years", { skip }, async () => {
  const keeper = await import(new URL("../../rotation/src/schedule.ts", import.meta.url));
  const t0 = 1_790_000_000;
  const moments = [t0 - 1000, t0 - 1, t0, t0 + 1, t0 + 299, t0 + 300, t0 + 301, t0 + 1499, t0 + 1500];
  for (let i = 0; i < 5000; i++) moments.push(t0 + Math.floor(Math.random() * 400_000_000));
  for (const now of moments) {
    assert.deepEqual(windowAt(now, t0, STOCKS.length), keeper.windowAt(now, t0, STOCKS.length), `at ${now}`);
  }
});

test("same five mints, in the same order", { skip }, async () => {
  const keeper = await import(new URL("../../rotation/src/stocks.ts", import.meta.url));
  assert.deepEqual(
    STOCKS.map((s) => [s.symbol, s.mint]),
    keeper.STOCKS.map((s) => [s.symbol, s.mint]),
  );
});
