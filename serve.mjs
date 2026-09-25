// Static server for the ROTATOR site. Dev only.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const PORT = 8796;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel.endsWith("/")) rel += "index.html";

    // A URL pathname only ever uses forward slashes, so stripping those is
    // enough to stop the join from treating it as absolute.
    const path = join(root, normalize(rel.replace(/^\/+/, "")));

    // Normalise first, then check: "/../secrets" only becomes visible as an
    // escape after normalisation.
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }

    const body = await readFile(path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => console.log(`ROTATOR site on http://localhost:${PORT}/`));
