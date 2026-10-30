import { db } from "../lib/db.js";
import { ensureSchema } from "../lib/schema.js";
import { userForToken } from "../lib/tokens.js";
import { toolsFor, callTool } from "../lib/assistant.js";
import { json } from "../lib/http.js";

// A remote MCP server (Streamable HTTP, stateless, JSON responses) so chat assistants can
// log play and read string wear. Three ways in:
//   https://<site>/api/mcp with OAuth: claude.ai and other clients find the sign-in through the
//     401's WWW-Authenticate header and lib/oauth.js; the player allows them in the app.
//   https://<site>/api/mcp with "Authorization: Bearer <API token>" (Claude Code, the Claude API).
//   https://<site>/api/mcp/<API token>, the older connector link, for clients that can do neither
//     (vercel.json rewrites it to /api/mcp?token=<token>).
// A read-only token only lists and runs the tools that read.

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = "Tennis Hub (formerly Stringbed Meter) keeps a tennis player's rackets, string tension readings and play sessions. "
  + "When the person says they played (for example 'I played an hour of singles'), call log_play. "
  + "For questions about string wear or when to restring, call restring_advice. "
  + "When the person shares a court booking confirmation (for example a Seattle Tennis Club / GameTime email), call add_court_booking; "
  + "finished bookings are logged as play automatically, so don't also call log_play for them. Pass dates in the person's local time. "
  + "To help book a court, use find_open_courts or court_booking_link and give the person the GameTime link: you can't finish a booking yourself, "
  + "because GameTime makes the person complete it (it has a robot check). For weekly courts they want to claim, use add_regular_time and list_regular_times.";

function secretFrom(request) {
  const url = new URL(request.url);
  const fromPath = url.pathname.startsWith("/api/mcp/") ? decodeURIComponent(url.pathname.slice("/api/mcp/".length)) : null;
  const auth = request.headers.get("authorization") || "";
  return fromPath || url.searchParams.get("token") || (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null);
}

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function answer(msg, store, user) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg && msg.id, -32600, "Invalid request.");
  const isNote = msg.id === undefined || msg.id === null;
  const ok = (result) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params && msg.params.protocolVersion;
      return ok({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "stringbed-meter", title: "Tennis Hub", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: toolsFor(user.access) });
    case "tools/call": {
      const p = msg.params || {};
      return ok(await callTool(store, user, p.name, p.arguments));
    }
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return isNote ? null : rpcError(msg.id, -32601, `Method ${msg.method} is not supported.`);
  }
}

export async function POST(request) {
  const store = db();
  let user;
  try {
    await ensureSchema(store);
    user = await userForToken(store, secretFrom(request));
  } catch (e) { console.error(e); return json(rpcError(null, -32603, "The server isn't ready."), 503); }
  if (!user) {
    // Tells OAuth clients where to sign in (RFC 9728); a token that was sent but no longer works is invalid_token, so they refresh.
    const origin = new URL(request.url).origin, sent = secretFrom(request);
    const challenge = `Bearer ${sent ? 'error="invalid_token", ' : ""}resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
    return json(rpcError(null, -32001, sent ? "This token or connector link isn't valid any more. Make a new one in the Tennis Hub app, or connect again." : "Sign in to Tennis Hub to use this connector."), 401, { "www-authenticate": challenge });
  }
  let body;
  try { body = JSON.parse(await request.text()); } catch { return json(rpcError(null, -32700, "Parse error."), 400); }
  try {
    const batch = Array.isArray(body);
    const replies = (await Promise.all((batch ? body : [body]).slice(0, 20).map((m) => answer(m, store, user)))).filter(Boolean);
    if (!replies.length) return new Response(null, { status: 202 });
    return json(batch ? replies : replies[0]);
  } catch (e) {
    console.error(e);
    return json(rpcError(body && body.id, -32603, "The server couldn't do that. Try again."), 500);
  }
}

// Stateless server: no server-to-client stream and no sessions to end.
const notAllowed = () => new Response(null, { status: 405, headers: { allow: "POST" } });
export const GET = notAllowed, DELETE = notAllowed;
