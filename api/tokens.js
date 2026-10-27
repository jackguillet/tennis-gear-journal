import { db } from "../lib/db.js";
import { currentUser } from "../lib/auth.js";
import { serializeSetCookie } from "@neondatabase/auth/server";
import { ensureSchema } from "../lib/schema.js";
import { createToken, listTokens, revokeToken } from "../lib/tokens.js";
import { json, readJson } from "../lib/http.js";

// Connector links for the signed-in player (session cookie required).
//   GET    /api/tokens                          -> { tokens: [...] }
//   POST   /api/tokens { label?, timezone? }    -> { token: { id, secret, label }, tokens }  (secret shown once)
//   DELETE /api/tokens { id }                   -> { tokens }
async function handle(request) {
  const cookies = [];
  let user;
  try { user = await currentUser(request, cookies); }
  catch (e) { console.error(e); return json({ error: "Sign-in isn't set up on the server yet." }, 503); }
  if (!user) return json({ error: "Sign in first." }, 401);
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", serializeSetCookie(c));
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
  try {
    const store = db();
    await ensureSchema(store);
    if (request.method === "POST") {
      const body = await readJson(request, 4096);
      const token = await createToken(store, user.id, body);
      return reply({ token, tokens: await listTokens(store, user.id) });
    }
    if (request.method === "DELETE") {
      const body = await readJson(request, 4096);
      await revokeToken(store, user.id, body.id);
    }
    return reply({ tokens: await listTokens(store, user.id) });
  } catch (e) {
    if (e.status) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The server couldn't do that. Try again." }, 500);
  }
}

export const GET = handle, POST = handle, DELETE = handle;
