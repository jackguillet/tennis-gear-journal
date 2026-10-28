import { db } from "../lib/db.js";
import { currentUser } from "../lib/auth.js";
import { serializeSetCookie } from "@neondatabase/auth/server";
import { applyOps, claimUnowned, getState } from "../lib/store.js";
import { ensureSchema } from "../lib/schema.js";
import { logFinishedBookings } from "../lib/bookings.js";
import { json, readJson } from "../lib/http.js";

// POST /api/sync  { ops: [...] }  ->  { user, rackets: {...}, profile, bookings: [...], refused: [...] }
// Applies the signed-in user's pending changes, then returns all of that user's rackets.
// A malformed change is skipped and listed in `refused` rather than failing the others.
// An empty ops list is a plain fetch. Court bookings that have ended are logged as play first.
export async function POST(request) {
  const cookies = [];
  let user;
  try { user = await currentUser(request, cookies); }
  catch (e) { console.error(e); return json({ error: "Sign-in isn't set up on the server yet." }, 503); }
  if (!user) return json({ error: "Sign in to sync." }, 401);
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", serializeSetCookie(c));
  try {
    const body = await readJson(request);
    const store = db();
    await ensureSchema(store);
    await claimUnowned(store, user);
    const refused = await applyOps(store, user.id, body.ops || [], { skipInvalid: true });
    await logFinishedBookings(store, user.id);
    const state = await getState(store, user.id);
    return new Response(JSON.stringify({ user, ...state, refused }), { status: 200, headers });
  } catch (e) {
    if (e.status) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The server couldn't save your changes. They're kept on your phone and will retry." }, 500);
  }
}
