// Local preview that behaves like Vercel: static files from public/, functions from api/,
// and an in-memory Postgres (PGlite) instead of Neon. Data is lost when it stops.
//   npm run dev            -> http://localhost:3000  (passcode: dev, unless APP_PASSCODE is set)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { setDb } from "../lib/db.js";

process.env.APP_PASSCODE ||= "dev";
const pg = new PGlite();
setDb({
  query: async (t, p = []) => (await pg.query(t, p)).rows,
  transaction: (list) => pg.transaction(async (tx) => { const out = []; for (const [t, p] of list) out.push((await tx.query(t, p || [])).rows); return out; }),
});

const routes = { "/api/sync": await import("../api/sync.js"), "/api/login": await import("../api/login.js") };
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const root = new URL("../public/", import.meta.url).pathname;
const port = Number(process.env.PORT) || 3000;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const mod = routes[url.pathname];
  if (mod) {
    const handler = mod[req.method];
    if (!handler) { res.writeHead(405).end(); return; }
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
    const out = await handler(new Request(url, { method: req.method, headers: req.headers, body }));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  const path = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" }).end(await readFile(path)); }
  catch { res.writeHead(404).end("Not found"); }
}).listen(port, () => console.log(`Stringbed Meter on http://localhost:${port} (passcode: ${process.env.APP_PASSCODE})`));
