import { db } from "../lib/db.js";
import { ensureSchema } from "../lib/schema.js";
import { userForToken } from "../lib/tokens.js";
import { importBookings } from "../lib/gametime.js";
import { logFinishedBookings } from "../lib/bookings.js";

// POST /api/gametime  (text/plain JSON { key, days, bookings })
// Called by the GameTime button (public/stc.js) from the member's own GameTime page, so it answers
// cross-site. text/plain avoids a CORS preflight; the key is a "gametime" link that can only
// save court bookings.
function cors(request) {
  const origin = request.headers.get("origin") || "";
  return /^https:\/\/([a-z0-9-]+\.)*gametime\.net$/.test(origin) ? { "access-control-allow-origin": origin, vary: "origin" } : {};
}
const reply = (request, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors(request) } });

export async function POST(request) {
  const raw = await request.text();
  if (raw.length > 100000) return reply(request, { error: "Too much data." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return reply(request, { error: "Not valid JSON." }, 400); }
  try {
    const store = db();
    await ensureSchema(store);
    const user = await userForToken(store, body && body.key, "gametime");
    if (!user) return reply(request, { error: "This button's link isn't valid any more. Make a new GameTime button in Stringbed Meter." }, 401);
    const out = await importBookings(store, user.id, body);
    await logFinishedBookings(store, user.id);
    const parts = [`${out.saved} booking${out.saved === 1 ? "" : "s"} in Stringbed Meter and your court calendar`];
    if (out.cancelled) parts.push(`${out.cancelled} cancelled one${out.cancelled === 1 ? "" : "s"} removed`);
    return reply(request, { ...out, message: parts.join(", ") + "." });
  } catch (e) {
    if (e.status) return reply(request, { error: e.message }, e.status);
    console.error(e);
    return reply(request, { error: "The server couldn't save them. Try again." }, 500);
  }
}

export function OPTIONS(request) {
  return new Response(null, { status: 204, headers: { ...cors(request), "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
}
