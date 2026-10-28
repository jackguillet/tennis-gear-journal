import { db } from "../lib/db.js";
import { ensureSchema } from "../lib/schema.js";
import { userForToken } from "../lib/tokens.js";
import { TOOLS, callTool } from "../lib/assistant.js";
import { json } from "../lib/http.js";

// A remote MCP server (Streamable HTTP, stateless, JSON responses) so chat assistants can
// log play and read string wear. Add it as a custom connector with the player's link:
//   https://<site>/api/mcp/<secret>
// (vercel.json rewrites that to /api/mcp?token=<secret>). Clients that send headers can use
// https://<site>/api/mcp with "Authorization: Bearer <secret>" instead.

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = "Stringbed Meter keeps a tennis player's rackets, string tension readings and play sessions. "
  + "When the person says they played (for example 'I played an hour of singles'), call log_play. "
  + "For questions about string wear or when to restring, call restring_advice. "
  + "When the person shares a court booking confirmation (for example a Seattle Tennis Club / GameTime email), call add_court_booking; "
  + "finished bookings are logged as play automatically, so don't also call log_play for them. Pass dates in the person's local time.";

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
        serverInfo: { name: "stringbed-meter", title: "Stringbed Meter", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS });
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
  if (!user) return json(rpcError(null, -32001, "This connector link isn't valid. Make a new one in the Stringbed Meter app."), 401);
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
