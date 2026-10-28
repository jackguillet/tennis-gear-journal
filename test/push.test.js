import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/server.js";
import { db } from "../lib/db.js";
import { runReminders } from "../lib/push.js";

// Restring reminders: subscribe through the API, then run the daily check with a stand-in for the
// push service (the real one needs a phone).
let app;
before(async () => { delete process.env.NEON_AUTH_BASE_URL; delete process.env.CRON_SECRET; app = await startServer({ port: 3941 }); });
after(() => app.close());

function browser() {
  const jar = new Map();
  return async (method, path, body) => {
    const res = await fetch(app.origin + path, { method, headers: { "content-type": "application/json", origin: app.origin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const jack = browser();
const sub = { endpoint: "https://push.example.com/phone-1", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };
const sent = [];
const send = async (s, body) => { if (s.endpoint.endsWith("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 }); sent.push({ to: s.endpoint, ...JSON.parse(body) }); };
const racket = (strungOn) => ({ name: "Blade v8", head: 98, gauge: 1.25, material: "poly", pattern: "16x19", strungKg: 22.7, strungOn, calib: 1, calibAt: null });

test("reminders need a signed-in player", async () => {
  assert.equal((await browser()("GET", "/api/push")).status, 401);
});

test("a phone turns reminders on and gets a test notification", async () => {
  assert.equal((await jack("POST", "/api/auth/sign-up/email", { name: "Jack", email: "jack@example.com", password: "forehand-winner" })).status, 200);
  const key = await jack("GET", "/api/push");
  assert.match(key.data.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal((await jack("GET", "/api/push")).data.publicKey, key.data.publicKey, "the key is made once");
  assert.equal((await jack("POST", "/api/push", { subscription: { endpoint: "http://insecure" } })).status, 400);
  assert.equal((await jack("POST", "/api/push", { subscription: sub, timezone: "America/Los_Angeles" })).data.phones, 1);
  assert.equal((await jack("POST", "/api/push", { subscription: sub, timezone: "America/Los_Angeles" })).data.phones, 1, "same phone twice");
});

test("the daily check sends one reminder per stage per set of strings", async () => {
  const now = new Date("2026-10-28T17:00:00Z");
  // 60 days old polyester: the age limit says restring now.
  await jack("POST", "/api/sync", { ops: [{ op: "racket.put", id: "rm-v8", data: racket("2026-08-29") }, { op: "racket.put", id: "rm-v9", data: racket("2026-10-25") }] });
  let out = await runReminders(db(), { send, now });
  assert.deepEqual(out.map((x) => [x.racketId, x.status]), [["rm-v8", "now"]]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, "Restring Blade v8");
  assert.match(sent[0].body, /days old/);
  assert.equal((await runReminders(db(), { send, now })).length, 0, "not again the next day");
  // Restrung: the new strings are fine, so nothing; a new set starts the count again.
  await jack("POST", "/api/sync", { ops: [{ op: "racket.put", id: "rm-v8", data: racket("2026-10-27") }] });
  assert.equal((await runReminders(db(), { send, now })).length, 0);
  // 50 days in: soon (75% of 60 days), then now at 60.
  out = await runReminders(db(), { send, now: new Date("2026-12-16T17:00:00Z") });
  assert.deepEqual(out.map((x) => [x.racketId, x.status]).sort(), [["rm-v8", "soon"], ["rm-v9", "soon"]]);
  assert.equal((await runReminders(db(), { send, now: new Date("2026-12-17T17:00:00Z") })).length, 0);
  out = await runReminders(db(), { send, now: new Date("2026-12-27T17:00:00Z") });
  assert.deepEqual(out.map((x) => x.status), ["now", "now"]);
});

test("a phone that turned notifications off is dropped", async () => {
  await jack("POST", "/api/push", { subscription: { ...sub, endpoint: "https://push.example.com/gone" } });
  assert.equal((await jack("GET", "/api/push")).data.phones, 2);
  await jack("POST", "/api/sync", { ops: [{ op: "racket.put", id: "rm-v7", data: racket("2026-08-01") }] });
  await runReminders(db(), { send, now: new Date("2026-10-28T17:00:00Z") });
  assert.equal((await jack("GET", "/api/push")).data.phones, 1);
  assert.equal((await jack("DELETE", "/api/push", { endpoint: sub.endpoint })).data.phones, 0);
});

test("the cron route runs the check, and CRON_SECRET locks it", async () => {
  assert.equal((await fetch(app.origin + "/api/reminders")).status, 200);
  process.env.CRON_SECRET = "s3cret";
  assert.equal((await fetch(app.origin + "/api/reminders")).status, 401);
  assert.equal((await fetch(app.origin + "/api/reminders", { headers: { authorization: "Bearer s3cret" } })).status, 200);
  delete process.env.CRON_SECRET;
});
