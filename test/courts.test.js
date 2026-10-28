import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/server.js";
import { zonedToUtc, localDate, toIcs } from "../public/courts.js";

// Court bookings: saved from the app or a chat assistant, shown in a subscribed calendar,
// and logged as play once they end.
let app;
before(async () => { delete process.env.NEON_AUTH_BASE_URL; app = await startServer({ port: 3919 }); });
after(() => app.close());

function browser() {
  const jar = new Map();
  return {
    async call(method, path, body) {
      const res = await fetch(app.origin + path, {
        method,
        headers: { "content-type": "application/json", origin: app.origin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";"); const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
        if (/max-age=0/i.test(c) || value === "") jar.delete(name); else jar.set(name, value);
      }
      const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {}
      return { status: res.status, data };
    },
  };
}
let rpcId = 0;
async function tool(url, name, args) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  return (await res.json()).result;
}
const racket = (name, strungOn) => ({ name, head: 98, gauge: 1.25, material: "poly", pattern: "16x19", weight: 305, stringName: "ALU Power", strungKg: 22.68, strungOn, calib: 1, calibAt: null });
const HOUR = 3600000;

test("Seattle wall-clock times convert across daylight saving", () => {
  assert.equal(new Date(zonedToUtc("2026-07-01", "18:30", "America/Los_Angeles")).toISOString(), "2026-07-02T01:30:00.000Z"); // PDT
  assert.equal(new Date(zonedToUtc("2026-12-01", "18:30", "America/Los_Angeles")).toISOString(), "2026-12-02T02:30:00.000Z"); // PST
  assert.equal(localDate(Date.parse("2026-07-02T01:30:00Z"), "America/Los_Angeles"), "2026-07-01");
});

test("calendar files escape text and fold long lines", () => {
  const ics = toIcs([{ id: "b1", start: Date.parse("2026-11-01T02:00:00Z"), min: 90, kind: "doubles", court: "Court 3, indoor", note: "With Sam; and Alex. ".repeat(6) }], { now: Date.parse("2026-10-28T00:00:00Z") });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261101T020000Z\r\nDTEND:20261101T033000Z/);
  assert.match(ics, /SUMMARY:Tennis: Doubles · Court 3\\, indoor/);
  assert.match(ics, /LOCATION:Seattle Tennis Club/);
  assert.ok(ics.split("\r\n").every((l) => l.length <= 75), "no line over 75 characters");
  assert.match(ics, /TRIGGER:-PT60M/);
  // STC's 6-hour cancellation rule: a reminder an hour before the cut-off, and the club's address.
  assert.match(ics, /TRIGGER:-PT7H/);
  assert.match(ics, /Last chance to cancel Doubles/);
  assert.match(ics, /LOCATION:Seattle Tennis Club\\, 922 McGilvra Blvd E/);
});

test("bookings elsewhere get no club rules", () => {
  const ics = toIcs([{ id: "b2", start: Date.parse("2026-11-01T02:00:00Z"), min: 60, kind: "singles", location: "Amy Yee Tennis Center" }]);
  assert.match(ics, /LOCATION:Amy Yee Tennis Center/);
  assert.doesNotMatch(ics, /PT7H|six hours|6 hours/);
});

const jack = browser(), sam = browser();
let mcpUrl, calUrl;

test("setup: player, rackets and links", async () => {
  assert.equal((await jack.call("POST", "/api/auth/sign-up/email", { name: "Jack", email: "jack@example.com", password: "forehand-winner" })).status, 200);
  assert.equal((await sam.call("POST", "/api/auth/sign-up/email", { name: "Sam", email: "sam@example.com", password: "drop-shot-123" })).status, 200);
  await jack.call("POST", "/api/sync", { ops: [
    { op: "racket.put", id: "c-v8", data: racket("Wilson Blade 98 v8", "2026-10-11") },
    { op: "racket.put", id: "c-v9", data: racket("Wilson Blade 98 v9", "2026-06-20") },
    { op: "play.add", id: "c-p1", racketId: "c-v8", d: "2026-10-20", min: 60, kind: "singles" },
  ] });
  await sam.call("POST", "/api/sync", { ops: [{ op: "racket.put", id: "c-pure", data: racket("Pure Aero", "2026-10-01") }] });
  const m = await jack.call("POST", "/api/tokens", {});
  mcpUrl = app.origin + "/api/mcp/" + m.data.token.secret;
  const c = await jack.call("POST", "/api/tokens", { scope: "calendar" });
  assert.equal(c.data.token.scope, "calendar");
  calUrl = app.origin + "/api/calendar/" + c.data.token.secret + ".ics";
  assert.equal((await jack.call("POST", "/api/tokens", { scope: "admin" })).status, 400);
});

test("a calendar link only opens the calendar, and a connector link only the connector", async () => {
  const calSecret = calUrl.split("/").pop().replace(".ics", ""), mcpSecret = mcpUrl.split("/").pop();
  const viaMcp = await fetch(app.origin + "/api/mcp/" + calSecret, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(viaMcp.status, 401);
  assert.equal((await fetch(app.origin + "/api/calendar/" + mcpSecret + ".ics")).status, 404);
  const cal = await fetch(calUrl);
  assert.equal(cal.status, 200);
  assert.match(cal.headers.get("content-type"), /text\/calendar/);
});

test("a booking from the app shows in the calendar and is logged as play once it ends", async () => {
  const start = Date.now() - 3 * HOUR; // ended two hours ago
  let res = await jack.call("POST", "/api/sync", { ops: [{ op: "booking.put", id: "bk1", start, min: 60, tz: "America/Los_Angeles", kind: "doubles", court: "Court 2", racketId: "c-v9" }] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.refused, []);
  const b = res.data.bookings.find((x) => x.id === "bk1");
  assert.ok(b.playId, "logged");
  const play = res.data.rackets["c-v9"].plays.find((p) => p.id === b.playId);
  assert.equal(play.min, 60); assert.equal(play.kind, "doubles"); assert.equal(play.d, localDate(start, "America/Los_Angeles"));
  // A second sync doesn't log it again.
  res = await jack.call("POST", "/api/sync", { ops: [] });
  assert.equal(Object.values(res.data.rackets).flatMap((r) => r.plays).filter((p) => p.id === b.playId).length, 1);
  assert.equal(res.data.rackets["c-v9"].plays.length, 1);
  const ics = await (await fetch(calUrl)).text();
  assert.match(ics, /UID:bk1@stringbed-meter/);
  assert.match(ics, /SUMMARY:Tennis: Doubles · Court 2/);
});

test("an upcoming booking isn't logged yet; without a racket it goes to the most recently played one", async () => {
  const res = await jack.call("POST", "/api/sync", { ops: [
    { op: "booking.put", id: "bk2", start: Date.now() + 24 * HOUR, min: 90, kind: "singles" },
    { op: "booking.put", id: "bk3", start: Date.now() - 4 * HOUR, min: 90, kind: "singles" },
  ] });
  const by = Object.fromEntries(res.data.bookings.map((b) => [b.id, b]));
  assert.equal(by.bk2.playId, null);
  assert.equal(by.bk2.tz, "America/Los_Angeles");
  assert.ok(by.bk3.playId);
  // v9 has the most recent play (bk1, today), so bk3 goes there.
  assert.ok(res.data.rackets["c-v9"].plays.some((p) => p.id === by.bk3.playId));
});

test("cancelling keeps the event in the feed as cancelled and out of the app", async () => {
  const res = await jack.call("POST", "/api/sync", { ops: [{ op: "booking.cancel", id: "bk2" }] });
  assert.ok(!res.data.bookings.some((b) => b.id === "bk2"));
  const ics = await (await fetch(calUrl)).text();
  const ev = ics.split("BEGIN:VEVENT").find((e) => e.includes("UID:bk2@"));
  assert.match(ev, /STATUS:CANCELLED/);
});

test("bad bookings are refused and someone else's can't be changed", async () => {
  let res = await jack.call("POST", "/api/sync", { ops: [
    { op: "booking.put", id: "bad1", start: Date.now(), min: 5, kind: "singles" },
    { op: "booking.put", id: "bad2", start: Date.now(), min: 60, kind: "squash" },
    { op: "booking.put", id: "bad3", start: Date.now(), min: 60, kind: "singles", tz: "Mars/Olympus" },
  ] });
  assert.equal(res.data.refused.length, 3);
  // Sam tries to overwrite and cancel Jack's booking, and to link Jack's racket.
  res = await sam.call("POST", "/api/sync", { ops: [
    { op: "booking.put", id: "bk1", start: Date.now() + HOUR, min: 30, kind: "serves" },
    { op: "booking.cancel", id: "bk3" },
    { op: "booking.put", id: "sam1", start: Date.now() + HOUR, min: 60, kind: "singles", racketId: "c-v8" },
  ] });
  assert.equal(res.data.bookings.find((b) => b.id === "sam1").racketId, null);
  assert.ok(!res.data.bookings.some((b) => b.id === "bk1"));
  res = await jack.call("POST", "/api/sync", { ops: [] });
  const bk1 = res.data.bookings.find((b) => b.id === "bk1");
  assert.equal(bk1.kind, "doubles"); assert.equal(bk1.min, 60);
  assert.ok(res.data.bookings.some((b) => b.id === "bk3"));
});

test("chat assistant saves a booking from a confirmation email, once per booking number", async () => {
  const day = new Date(Date.now() + 3 * 24 * HOUR).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  let out = await tool(mcpUrl, "add_court_booking", { date: day, start_time: "18:30", minutes: 90, kind: "singles", court: "Court 5", ref: "GT-123456", racket: "v8" });
  assert.ok(!out.isError, out.content[0].text);
  assert.match(out.content[0].text, /Saved Tennis: Singles · Court 5/);
  assert.equal(new Date(out.structuredContent.starts_at).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }), "6:30 PM");
  const id = out.structuredContent.booking_id;
  out = await tool(mcpUrl, "add_court_booking", { date: day, start_time: "19:00", minutes: 60, court: "Court 5", ref: "GT-123456" });
  assert.equal(out.structuredContent.booking_id, id);
  assert.equal(out.structuredContent.updated, true);
  out = await tool(mcpUrl, "list_court_bookings", {});
  const mine = out.structuredContent.bookings.filter((b) => b.ref === "GT-123456");
  assert.equal(mine.length, 1); assert.equal(mine[0].minutes, 60); assert.equal(mine[0].status, "upcoming");
  out = await tool(mcpUrl, "add_court_booking", { date: day, start_time: "25:00", minutes: 60 });
  assert.ok(out.isError);
  out = await tool(mcpUrl, "cancel_court_booking", { ref: "GT-123456" });
  assert.ok(!out.isError);
  out = await tool(mcpUrl, "list_court_bookings", {});
  assert.ok(!out.structuredContent.bookings.some((b) => b.ref === "GT-123456"));
});

test("a past booking added by chat is logged right away", async () => {
  const yesterday = new Date(Date.now() - 24 * HOUR).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const out = await tool(mcpUrl, "add_court_booking", { date: yesterday, start_time: "10:00", minutes: 120, kind: "drills", racket: "v8" });
  assert.match(out.content[0].text, /already ended/);
  const s = await tool(mcpUrl, "list_sessions", { racket: "v8" });
  assert.ok(s.structuredContent.sessions.some((p) => p.date === yesterday && p.hours === 2 && p.kind === "drills"));
});
