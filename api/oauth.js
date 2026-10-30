import { db } from "../lib/db.js";
import { ensureSchema } from "../lib/schema.js";
import { currentUser } from "../lib/auth.js";
import { ensureUser } from "../lib/users.js";
import { serializeSetCookie } from "@neondatabase/auth/server";
import { OAuthError, checkAuthorize, exchange, issueCode, redirectWith, registerClient, resourceMetadata, serverMetadata } from "../lib/oauth.js";
import { readJson } from "../lib/http.js";

// Every OAuth route in one function (vercel.json rewrites each to /api/oauth?op=...):
//   GET  /.well-known/oauth-protected-resource      op=resource
//   GET  /.well-known/oauth-authorization-server    op=server
//   POST /oauth/register                            op=register   (RFC 7591)
//   GET  /oauth/authorize                           op=authorize  -> the app's "Allow?" screen
//   POST /oauth/authorize { request, allow, access, timezone }    (the app, signed in) -> { redirect }
//   POST /oauth/token                               op=token
// See lib/oauth.js.

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization, mcp-protocol-version" };
const out = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...extra } });
const oauthError = (e) => out({ error: e.code, error_description: e.message }, e.status || 400, e.status === 401 ? { "www-authenticate": "Basic" } : {});

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const errorPage = (msg) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Can't connect</title>
<body style="font:17px/1.45 system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px"><h1 style="font-size:22px">Can't connect to Tennis Hub</h1><p>${esc(msg)}</p></body>`,
  { status: 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const originOf = (request) => new URL(request.url).origin;
const opOf = (url) => url.searchParams.get("op") || ({ "/oauth/register": "register", "/oauth/authorize": "authorize", "/oauth/token": "token" })[url.pathname]
  || (url.pathname.startsWith("/.well-known/oauth-protected-resource") ? "resource" : url.pathname.startsWith("/.well-known/oauth-authorization-server") || url.pathname.startsWith("/.well-known/openid-configuration") ? "server" : null);

// The query string with op (added by the rewrite) taken out.
function authorizeParams(url) {
  const p = new URLSearchParams(url.search); p.delete("op"); return p;
}

export async function GET(request) {
  const url = new URL(request.url), origin = originOf(request), op = opOf(url);
  if (op === "resource") return out(resourceMetadata(origin));
  if (op === "server") return out(serverMetadata(origin));
  if (op !== "authorize") return out({ error: "not_found" }, 404);
  const store = db();
  try {
    await ensureSchema(store);
    const params = authorizeParams(url);
    await checkAuthorize(store, params, origin);
    // The app signs the player in (if needed) and asks them; see "connect" in public/index.html.
    return new Response(null, { status: 302, headers: { location: origin + "/?connect=" + encodeURIComponent(params.toString()), "cache-control": "no-store" } });
  } catch (e) {
    if (!(e instanceof OAuthError)) { console.error(e); return errorPage("The server isn't ready. Try again in a minute."); }
    if (!e.redirect) return errorPage(e.message);
    return new Response(null, { status: 302, headers: { location: redirectWith(e.redirect, { error: e.code, error_description: e.message, state: e.state }) } });
  }
}

async function consent(request, store, origin) {
  // Only the app itself may answer, with the player's session cookie.
  if (request.headers.get("origin") !== origin) return out({ error: "Open this from the Tennis Hub app." }, 403);
  const cookies = [];
  let user;
  try { user = await currentUser(request, cookies); }
  catch (e) { console.error(e); return out({ error: "Sign-in isn't set up on the server yet." }, 503); }
  if (!user) return out({ error: "Sign in first." }, 401);
  const headers = {};
  const reply = (body, status = 200) => {
    const r = out(body, status, headers);
    for (const c of cookies) r.headers.append("set-cookie", serializeSetCookie(c));
    return r;
  };
  const body = await readJson(request, 8192);
  let req;
  try { req = await checkAuthorize(store, new URLSearchParams(String(body.request || "")), origin); }
  catch (e) {
    if (!(e instanceof OAuthError)) throw e;
    if (!e.redirect) return reply({ error: e.message }, 400);
    return reply({ redirect: redirectWith(e.redirect, { error: e.code, error_description: e.message, state: e.state }) });
  }
  if (body.describe) return reply({ client: req.client.name, access: req.access, to: new URL(req.redirectUri).host || new URL(req.redirectUri).protocol });
  if (!body.allow) return reply({ redirect: redirectWith(req.redirectUri, { error: "access_denied", error_description: "The player said no.", state: req.state }) });
  await ensureUser(store, user, { timezone: body.timezone });
  return reply({ redirect: await issueCode(store, user.id, req, body.access, origin) });
}

export async function POST(request) {
  const url = new URL(request.url), origin = originOf(request), op = opOf(url);
  const store = db();
  try {
    await ensureSchema(store);
    if (op === "register") return out(await registerClient(store, await readJson(request, 16384)), 201);
    if (op === "token") {
      const text = await request.text();
      const type = request.headers.get("content-type") || "";
      const form = type.includes("application/json") ? new URLSearchParams(Object.entries(JSON.parse(text || "{}")).map(([k, v]) => [k, String(v)])) : new URLSearchParams(text);
      return out(await exchange(store, form, request.headers.get("authorization")));
    }
    if (op === "authorize") return await consent(request, store, origin);
    return out({ error: "not_found" }, 404);
  } catch (e) {
    if (e instanceof OAuthError) return oauthError(e);
    if (e.status) return out({ error: "invalid_request", error_description: e.message }, e.status);
    console.error(e);
    return out({ error: "server_error", error_description: "The server couldn't do that. Try again." }, 500);
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
