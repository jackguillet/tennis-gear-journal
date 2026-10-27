// A local server that behaves like the Vercel deployment: static files from public/, the
// functions in api/, an in-memory Postgres (PGlite) and, unless NEON_AUTH_BASE_URL is set,
// a local Better Auth standing in for Neon Auth. Used by `npm run dev` and the tests.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { setDb, pgliteDb } from "../lib/db.js";
import { resetSchemaCache } from "../lib/schema.js";
import { createLocalAuth } from "./local-auth.js";

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const root = new URL("../public/", import.meta.url).pathname;

async function toRequest(req, origin) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  return new Request(new URL(req.url, origin), { method: req.method, headers, body });
}
async function send(res, out) {
  const headers = {}; for (const [k, v] of out.headers) if (k !== "set-cookie") headers[k] = v;
  const cookies = out.headers.getSetCookie(); if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(out.status, headers);
  res.end(Buffer.from(await out.arrayBuffer()));
}

export async function startServer({ port = 3000, useDatabaseUrl = false } = {}) {
  const origin = `http://localhost:${port}`;
  if (!useDatabaseUrl) { setDb(pgliteDb(new PGlite())); resetSchemaCache(); }
  let localAuth = null;
  if (!process.env.NEON_AUTH_BASE_URL) {
    localAuth = createLocalAuth({ origin });
    process.env.NEON_AUTH_BASE_URL = origin + localAuth.basePath;
  }
  process.env.NEON_AUTH_COOKIE_SECRET ||= "local-cookie-secret-local-cookie-secret-0123";
  const routes = { "/api/sync": await import("../api/sync.js") };
  const authRoute = await import("../api/auth.js");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (localAuth && url.pathname.startsWith(localAuth.basePath + "/")) return send(res, await localAuth.handler(await toRequest(req, origin)));
      const mod = url.pathname.startsWith("/api/auth/") ? authRoute : routes[url.pathname];
      if (mod) {
        const handler = mod[req.method];
        if (!handler) { res.writeHead(405).end(); return; }
        return send(res, await handler(await toRequest(req, origin)));
      }
      const path = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));
      if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
      res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" }).end(await readFile(path));
    } catch (e) {
      if (e.code === "ENOENT") { res.writeHead(404).end("Not found"); return; }
      console.error(e); res.writeHead(500).end("Server error");
    }
  });
  await new Promise((r) => server.listen(port, r));
  return { origin, close: () => new Promise((r) => server.close(r)), localAuth: !!localAuth };
}
