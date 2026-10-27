import { proxyAuth } from "../lib/auth.js";
import { json } from "../lib/http.js";

// /api/auth/* -> Neon Auth (vercel.json rewrites /api/auth/<path> here as ?path=<path>).
// The browser calls Better Auth's endpoints through this, for example
//   POST /api/auth/sign-up/email   { name, email, password }
//   POST /api/auth/sign-in/email   { email, password }
//   POST /api/auth/sign-out
//   GET  /api/auth/get-session
async function handle(request) {
  const url = new URL(request.url);
  let path = url.pathname.startsWith("/api/auth/") ? url.pathname.slice("/api/auth/".length) : url.searchParams.get("path") || "";
  path = path.replace(/^\/+/, "");
  if (!/^[a-z0-9\-/]+$/i.test(path) || path.includes("..")) return json({ error: "Not found." }, 404);
  // Drop the rewrite's own ?path= so it isn't forwarded upstream.
  url.searchParams.delete("path");
  url.pathname = "/api/auth/" + path;
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  const forwarded = new Request(url, { method: request.method, headers: request.headers, body });
  try {
    return await proxyAuth(forwarded, path);
  } catch (e) {
    console.error(e);
    return json({ error: "Sign-in isn't set up on the server yet." }, 503);
  }
}

export const GET = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle;
