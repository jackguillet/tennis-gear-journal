import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/server.js";
import { db } from "../lib/db.js";
import { runReminders } from "../lib/push.js";
import { shoeWear, currentShoe } from "../public/shoes.js";

// Shoes (hours from the play log, sync, reminders) and the quick-log link.
let app;
before(async () => { delete process.env.NEON_AUTH_BASE_URL; app = await startServer({ port: 3951 }); });
after(() => app.close());

function browser() {
  const jar = new Map();
  return async (method, path, body) => {
    const res = await fetch(app.origin + path, { method, headers: { "content-type": "application/json", origin: app.origin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const jack = browser(), sam = browser();
const racket = { name: "Blade v8", head: 98, gauge: 1.25, material: "poly", pattern: "16x19", strungKg: 22.7, strungOn: "2026-10-20", calib: 1, calibAt: null };

test("a pair counts every session on any racket while it's in use", () => {
  const rackets = { a: { plays: [{ d: "2026-09-30", min: 600 }, { d: "2026-10-01", min: 60 }, { d: "2026-10-10", min: 90 }] }, b: { plays: [{ d: "2026-10-05", min: 30 }, { d: "2026-10-20", min: 60 }] } };
  const old = { id: "s1", name: "Old", startedOn: "2026-10-01", retiredOn: "2026-10-20", lifeHours: 60 };
  const now = { id: "s2", name: "NB 996v6", startedOn: "2026-10-20", retiredOn: null, lifeHours: 1.2 };
  assert.equal(shoeWear(old, rackets).hours, 3); // 60 + 90 + 30 min; the 20th belongs to the new pair
  assert.equal(shoeWear(old, rackets).status, "retired");
  assert.deepEqual([shoeWear(now, rackets).hours, shoeWear(now, rackets).status], [1, "soon"]);
  assert.equal(currentShoe([old, now]), now);
  assert.equal(currentShoe([old]), null);
});

test("shoes sync per player and bad ones are refused", async () => {
  await jack("POST", "/api/auth/sign-up/email", { name: "Jack", email: "jack@example.com", password: "forehand-winner" });
  await sam("POST", "/api/auth/sign-up/email", { name: "Sam", email: "sam@example.com", password: "drop-shot-123" });
  let res = await jack("POST", "/api/sync", { ops: [
    { op: "racket.put", id: "sh-v8", data: racket },
    { op: "shoe.put", id: "shoe-1", data: { name: "NB 996v6 2E", startedOn: "2026-10-20", retiredOn: null, lifeHours: 10 } },
    { op: "shoe.put", id: "shoe-bad", data: { name: "Backwards", startedOn: "2026-10-20", retiredOn: "2026-10-01" } },
    { op: "shoe.put", id: "shoe-bad2", data: { name: "", startedOn: "2026-10-20" } },
    { op: "shoe.put", id: "shoe-bad3", data: { name: "Short life", startedOn: "2026-10-20", lifeHours: 2 } },
  ] });
  assert.deepEqual(res.data.shoes, [{ id: "shoe-1", name: "NB 996v6 2E", startedOn: "2026-10-20", retiredOn: null, lifeHours: 10 }]);
  assert.equal(res.data.refused.length, 3);
  res = await sam("POST", "/api/sync", { ops: [{ op: "shoe.put", id: "shoe-1", data: { name: "Hijack", startedOn: "2026-10-01" } }, { op: "shoe.delete", id: "shoe-1" }] });
  assert.deepEqual(res.data.shoes, []);
  assert.equal((await jack("POST", "/api/sync", { ops: [] })).data.shoes[0].name, "NB 996v6 2E");
});

let quick;
test("a quick-log link logs a session from a Shortcut, a form or the page, and can undo it", async () => {
  const made = await jack("POST", "/api/tokens", { scope: "log", timezone: "America/Los_Angeles" });
  assert.equal(made.data.token.label, "Quick log");
  quick = `${app.origin}/api/log/${made.data.token.secret}`;
  const page = await fetch(quick);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Log it/);
  assert.match(html, /Blade v8|name="kind"/);
  // iPhone Shortcut: JSON in, one line of text out.
  let res = await fetch(quick, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "singles", minutes: 90, date: "2026-10-27" }) });
  let text = await res.text();
  assert.equal(res.status, 200, text);
  assert.match(res.headers.get("content-type"), /text\/plain/);
  assert.match(text, /^Logged 1.5 h of singles on Blade v8 for Oct 27, 2026\. That's 1.5 h on these strings/);
  assert.match(text, /Shoes \(NB 996v6 2E\): 1.5 of about 10 h\./);
  // The page's form: a page back, with an Undo button carrying the session id.
  res = await fetch(quick, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "kind=doubles&minutes=60&date=2026-10-27" });
  text = await res.text();
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(text, /Logged 1 h of doubles/);
  const undo = /name="undo" value="([^"]+)"/.exec(text)[1];
  res = await fetch(quick, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "undo=" + encodeURIComponent(undo) });
  assert.match(await res.text(), /Deleted 1 h of doubles/);
  res = await fetch(quick, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "singles", minutes: 2 }) });
  assert.equal(res.status, 400);
  const plays = (await jack("POST", "/api/sync", { ops: [] })).data.rackets["sh-v8"].plays;
  assert.deepEqual(plays.map((p) => [p.kind, p.min]), [["singles", 90]]);
});

test("a quick-log link opens nothing else, and other links don't open it", async () => {
  const secret = quick.split("/").pop();
  assert.equal((await fetch(`${app.origin}/api/mcp/${secret}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).status, 401);
  const mcp = await jack("POST", "/api/tokens", {});
  assert.equal((await fetch(`${app.origin}/api/log/${mcp.data.token.secret}`)).status, 404);
  assert.equal((await fetch(`${app.origin}/api/log/sbm_${"x".repeat(43)}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
});

test("worn-out shoes get one reminder per stage", async () => {
  await jack("POST", "/api/push", { subscription: { endpoint: "https://push.example.com/jack", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } }, timezone: "America/Los_Angeles" });
  const sent = [], send = async (s, body) => { sent.push(JSON.parse(body)); };
  const now = new Date("2026-10-28T17:00:00Z");
  const out = await runReminders(db(), { send, now }); // 1.5 h of 10 h: not yet
  assert.deepEqual(out.filter((x) => x.racketId.startsWith("shoe:")), []);
  await fetch(quick, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "hitting", minutes: 450, date: "2026-10-28" }) }); // 9 h of 10: wearing out
  await runReminders(db(), { send, now });
  const shoe = sent.filter((m) => m.tag === "restring-shoe:shoe-1");
  assert.equal(shoe.length, 1);
  assert.equal(shoe[0].title, "NB 996v6 2E are wearing out");
  assert.match(shoe[0].body, /About 1 h left/);
  await runReminders(db(), { send, now });
  assert.equal(sent.filter((m) => m.tag === "restring-shoe:shoe-1").length, 1);
});

test("the chat connector lists shoes", async () => {
  const mcp = await jack("POST", "/api/tokens", {});
  const res = await fetch(`${app.origin}/api/mcp/${mcp.data.token.secret}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_shoes", arguments: {} } }) });
  const body = await res.json();
  assert.deepEqual(body.result.structuredContent.shoes.map((x) => [x.name, x.hours, x.status]), [["NB 996v6 2E", 9, "soon"]]);
});
