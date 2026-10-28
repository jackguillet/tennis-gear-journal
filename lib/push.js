import webpush from "web-push";
import { getState } from "./store.js";
import { validTimezone } from "./tokens.js";
import { restringAdvice, personalBreak } from "../public/restring.js";
import { localDate } from "../public/courts.js";

// Restring reminders by Web Push. A phone that turns them on sends its push subscription; once a
// day (a Vercel cron, see vercel.json) every subscribed player's rackets are checked, and a player
// gets one notification when a racket reaches "Restring soon" and one more at "Restring now", per
// set of strings. iPhones get Web Push for web apps added to the Home Screen (iOS 16.4 and later).

const SUBJECT = () => process.env.VAPID_SUBJECT || "mailto:stringbed-meter@example.com";

// The VAPID key pair: from the environment if set, otherwise made once and kept in the database.
let keys = null;
export async function vapidKeys(db) {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return (keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY });
  const made = webpush.generateVAPIDKeys();
  await db.query(`insert into app_keys (name, value) values ('vapid', $1) on conflict (name) do nothing`, [JSON.stringify(made)]);
  const [row] = await db.query(`select value from app_keys where name = 'vapid'`);
  return (keys = JSON.parse(row.value));
}
export function resetVapidCache() { keys = null; }

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

export async function saveSubscription(db, userId, sub, timezone) {
  if (!sub || typeof sub !== "object" || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) throw bad("That isn't a push subscription.");
  if (!sub.keys || typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string" || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) throw bad("The push subscription has no keys.");
  const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  await db.query(
    `insert into push_subs (endpoint, user_id, sub, timezone) values ($1, $2, $3::jsonb, $4)
     on conflict (endpoint) do update set user_id = excluded.user_id, sub = excluded.sub, timezone = excluded.timezone`,
    [clean.endpoint, userId, JSON.stringify(clean), validTimezone(timezone)]);
}

export async function removeSubscription(db, userId, endpoint) {
  await db.query(`delete from push_subs where endpoint = $1 and user_id = $2`, [String(endpoint || ""), userId]);
}

export async function subscriptionCount(db, userId) {
  const [{ n }] = await db.query(`select count(*)::int as n from push_subs where user_id = $1`, [userId]);
  return n;
}

// Sends one notification to every phone of a player. Phones that turned notifications off or
// removed the app answer 404/410; those subscriptions are dropped. Returns how many were delivered.
export async function notify(db, userId, message, send = defaultSend) {
  const subs = await db.query(`select endpoint, sub from push_subs where user_id = $1`, [userId]);
  const vapid = await vapidKeys(db);
  let sent = 0;
  for (const { endpoint, sub } of subs) {
    try {
      await send(typeof sub === "string" ? JSON.parse(sub) : sub, JSON.stringify(message), vapid);
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await db.query(`delete from push_subs where endpoint = $1`, [endpoint]);
      else console.error("push failed", e && (e.statusCode || e.message));
    }
  }
  return sent;
}
function defaultSend(sub, body, vapid) {
  return webpush.sendNotification(sub, body, { vapidDetails: { subject: SUBJECT(), publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 12 * 3600, urgency: "normal" });
}

// The daily check. Returns [{ userId, racketId, status }] for the reminders sent.
export async function runReminders(db, { send = defaultSend, now = new Date() } = {}) {
  const users = await db.query(`select user_id, max(timezone) as timezone from push_subs group by user_id`);
  const out = [];
  for (const { user_id: userId, timezone } of users) {
    const today = localDate(now.getTime(), timezone || "America/Los_Angeles");
    const { rackets, profile } = await getState(db, userId);
    const personal = personalBreak(rackets, profile);
    const sentRows = await db.query(`select racket_id, strung_on, status from reminders_sent where user_id = $1`, [userId]);
    const already = new Map(sentRows.map((r) => [r.racket_id, r]));
    for (const [racketId, r] of Object.entries(rackets)) {
      if (!r.strungOn) continue;
      const a = restringAdvice(r, profile, today, personal);
      if (a.status !== "soon" && a.status !== "now") continue;
      const prev = already.get(racketId);
      if (prev && prev.strung_on === r.strungOn && (prev.status === a.status || prev.status === "now")) continue;
      const delivered = await notify(db, userId, {
        title: a.status === "now" ? `Restring ${r.name}` : `${r.name}: restring soon`,
        body: a.summary.replace(/^Restring (now|soon): /, ""),
        tag: "restring-" + racketId, url: "./",
      }, send);
      if (!delivered) continue;
      await db.query(
        `insert into reminders_sent (user_id, racket_id, strung_on, status) values ($1, $2, $3, $4)
         on conflict (user_id, racket_id) do update set strung_on = excluded.strung_on, status = excluded.status, sent_at = now()`,
        [userId, racketId, r.strungOn, a.status]);
      out.push({ userId, racketId, status: a.status });
    }
  }
  return out;
}
