import { db } from "../lib/db.js";
import { isSignedIn } from "../lib/auth.js";
import { applyOps, getState } from "../lib/store.js";
import { ensureSchema } from "../lib/schema.js";
import { json, readJson } from "../lib/http.js";

// POST /api/sync  { ops: [...] }  ->  { rackets: {...} }
// Applies the phone's pending changes, then returns everything. An empty ops list is a plain fetch.
export async function POST(request) {
  if (!isSignedIn(request)) return json({ error: "Sign in to sync." }, 401);
  try {
    const body = await readJson(request);
    const store = db();
    await ensureSchema(store);
    await applyOps(store, body.ops || []);
    return json(await getState(store));
  } catch (e) {
    if (e.status) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The server couldn't save your changes. They're kept on your phone and will retry." }, 500);
  }
}
