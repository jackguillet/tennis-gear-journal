import { db } from "../lib/db.js";
import { currentUser } from "../lib/auth.js";
import { serializeSetCookie } from "@neondatabase/auth/server";
import { ensureSchema } from "../lib/schema.js";
import { vapidKeys, saveSubscription, removeSubscription, subscriptionCount, notify } from "../lib/push.js";
import { json, readJson } from "../lib/http.js";

// Restring reminders for the signed-in player (session cookie required).
//   GET    /api/push                               -> { publicKey, phones }
//   POST   /api/push { subscription, timezone }    -> { phones }      turn reminders on for this phone
//   POST   /api/push { test: true }                -> { sent }        send a test notification
//   DELETE /api/push { endpoint }                  -> { phones }      turn them off for this phone
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
    if (request.method === "GET") return reply({ publicKey: (await vapidKeys(store)).publicKey, phones: await subscriptionCount(store, user.id) });
    const body = await readJson(request, 8192);
    if (request.method === "DELETE") {
      await removeSubscription(store, user.id, body.endpoint);
      return reply({ phones: await subscriptionCount(store, user.id) });
    }
    if (body.test) {
      const sent = await notify(store, user.id, { title: "Tennis Hub", body: "Reminders are on. You'll hear from the app when a racket needs restringing.", tag: "test", url: "./" });
      return reply({ sent });
    }
    await saveSubscription(store, user.id, body.subscription, body.timezone);
    return reply({ phones: await subscriptionCount(store, user.id) });
  } catch (e) {
    if (e.status) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The server couldn't do that. Try again." }, 500);
  }
}

export const GET = handle, POST = handle, DELETE = handle;
