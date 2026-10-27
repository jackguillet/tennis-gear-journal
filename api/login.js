import { passcodeMatches, sessionCookie, clearCookie, isSignedIn } from "../lib/auth.js";
import { json, readJson } from "../lib/http.js";

// GET /api/login     -> { signedIn }
// POST /api/login    { passcode } -> sets the session cookie
// DELETE /api/login  -> signs out
export async function GET(request) {
  return json({ signedIn: isSignedIn(request) });
}

export async function POST(request) {
  let body;
  try { body = await readJson(request, 4096); } catch (e) { return json({ error: e.message }, e.status || 400); }
  if (typeof body.passcode !== "string" || !passcodeMatches(body.passcode)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return json({ error: "That passcode isn't right." }, 401);
  }
  return json({ signedIn: true }, 200, { "set-cookie": sessionCookie() });
}

export async function DELETE() {
  return json({ signedIn: false }, 200, { "set-cookie": clearCookie() });
}
