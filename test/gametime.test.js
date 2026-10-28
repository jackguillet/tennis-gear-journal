import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { startServer } from "../scripts/server.js";

// The GameTime button: reading the club's court sheet (public/stc.js) and saving the member's
// own bookings (api/gametime.js).

// Shaped like GameTime's jsoncourtdata reply (times are minutes after midnight). Names are made up.
const SHEET = {
  q: 330, c: 1305,
  e: [
    { n: "Court 14", mn: "14", i: "8",
      t: [{ t: 330, d: 225, i: 75 }, { t: 555, d: 150, i: 75, e: "Peak" }],
      b: [{ t: 405, d: 75, bkId: 1001, c: 9001, u: 1, p: [{ n: "PAT LEE", u: 111 }, { n: "SAM KIM", u: 222 }] }] },
    { n: "Court 15", mn: "15", i: "9",
      t: [{ t: 330, d: 225, i: 75 }, { t: 555, d: 150, i: 75, e: "Peak" }],
      b: [
        { t: 330, d: 120, m: 8300, u: 0, bkId: 1002 },                                   // club event, overlaps two slots
        { t: 555, d: 75, bkId: 1003, f: 542013, e: 18578, p: [{ n: "JACK G", u: 18578 }, { n: "ALEX P", u: 333 }] },
        { t: 630, d: 75, bkId: 1004, c: 9004, p: [{ n: "A", u: 1 }, { n: "B", u: 2 }, { n: "JACK G", u: 18578 }, { n: "C", u: 3 }] },
      ] },
    { n: "Court 16", mn: "16", i: "10", t: [{ t: 480, d: 60, i: 60 }],
      b: [{ t: 480, d: 60, bkId: 1005, j: "SCOTT (PRO) MOORE", e: 18578, f: 777 }] },
  ],
};

let gt;
before(async () => {
  const sandbox = {}; sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile(new URL("../public/stc.js", import.meta.url), "utf8"), sandbox);
  gt = sandbox.SBM_GT;
});

test("open slots skip booked and overlapping times", () => {
  const slots = [...gt.openSlots(SHEET).map((s) => `${s.court}@${s.start}`)];
  assert.deepEqual(slots, ["Court 14@330", "Court 14@480", "Court 15@480", "Court 14@555", "Court 14@630"]);
  assert.ok(gt.openSlots(SHEET).find((s) => s.court === "Court 14" && s.start === 555).peak);
  assert.ok(!gt.openSlots(SHEET).some((s) => s.court === "Court 15" && s.start === 405), "the club event blocks 5:30 to 7:30");
});

test("open slots before now are left out", () => {
  assert.deepEqual([...gt.openSlots(SHEET, { nowMin: 600 }).map((s) => s.start)], [630]);
});

test("only the member's own bookings are picked out, with type and partners", () => {
  const mine = gt.myBookings(SHEET, "2026-10-29", 18578);
  assert.equal(mine.length, 3);
  const [singles, doubles, lesson] = mine.sort((a, b) => a.bkId.localeCompare(b.bkId));
  assert.deepEqual({ ...singles }, { bkId: "1003", ref: "542013", date: "2026-10-29", time: "09:15", minutes: 75, court: "Court 15", kind: "singles", note: "With ALEX P" });
  assert.equal(doubles.kind, "doubles"); assert.equal(doubles.time, "10:30");
  assert.equal(lesson.kind, "drills"); assert.match(lesson.note, /SCOTT/);
  assert.equal(gt.myBookings(SHEET, "2026-10-29", 99999).length, 0);
});

// Shaped like /account/jsonlistupcoming. Names are made up.
const UPCOMING = { Response: { Response_Code: 200, Total: 3, Results: [
  { type: "booking", date: "Thursday Oct 29, 2026", time: "1:00pm - 2:15pm", activity: "Tennis", place: "Court 17", booking_id: 776881, conf_id: 542013, sport_id: 2, players: "JACKSON GUILLET, MARC  POPPY" },
  { type: "booking", date: "Saturday Oct 31, 2026", time: "11:45am - 1:00pm", activity: "Tennis", place: "Court 14", booking_id: 776801, conf_id: 542223, sport_id: 2, players: "ANA B, JACKSON GUILLET, CY D, EVE F" },
  { type: "booking", date: "Sunday Nov 1, 2026", time: "9:00am - 10:00am", activity: "Pickleball", place: "Court 3", booking_id: 9, conf_id: 10, sport_id: 4, players: "JACKSON GUILLET" },
] } };

test("GameTime's upcoming list becomes bookings, tennis only, without the member in the partner list", () => {
  const { bookings, complete } = gt.parseUpcoming(UPCOMING, "JACKSON");
  assert.equal(complete, true);
  assert.equal(bookings.length, 2);
  assert.deepEqual({ ...bookings[0] }, { bkId: "776881", ref: "542013", date: "2026-10-29", time: "13:00", minutes: 75, court: "Court 17", kind: "singles", note: "With MARC POPPY" });
  assert.equal(bookings[1].time, "11:45"); assert.equal(bookings[1].kind, "doubles"); assert.equal(bookings[1].note, "With ANA B, CY D, EVE F");
  assert.equal(gt.parseUpcoming({ Response: { Total: 9, Results: UPCOMING.Response.Results } }).complete, false);
});

test("classes the member signed up for come in as lesson time; waitlist places don't", () => {
  const feed = { Response: { Total: 2, Results: [
    { type: "class", date: "Wednesday Nov 4, 2026", time: "6:00pm - 7:00pm", activity: "TENNIS 102 - WEDNESDAYS", place: "", event_instance_id: 13998 },
    { type: "booking", status: "WAITLIST", date: "Thursday Nov 5, 2026", time: "6:00pm - 7:15pm", sport_id: 2, booking_id: 5, players: "JACKSON GUILLET" },
  ] } };
  const { bookings } = gt.parseUpcoming(feed, "JACKSON");
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].kind, "drills"); assert.equal(bookings[0].bkId, "13998"); assert.equal(bookings[0].minutes, 60);
  assert.equal(bookings[0].note, "TENNIS 102 - WEDNESDAYS");
});

// Shaped like /cne/index/listdata?startDay=..&endDay=..&availType=AVAILABLE.
const EVENTS = { Response: { Results: [
  { event_instance_id: 1, title: { link: "/cne/event/view/instanceid/1", text: "CARDIO TENNIS WITH SCOTT &amp; LISA" }, year: "2026", month: "11", date: "3", hour: "13", minute: "30", duration: "1h 30m", participants: { text: "2/16" }, eventStatus: "Select", instructors: "MOORE, SCOTT (PRO)<br>MENTI, LISA (PRO)", cancelled: 0 },
  { event_instance_id: 2, title: { text: "TENNIS 102 - WEDNESDAYS" }, year: "2026", month: "11", date: "4", hour: "18", minute: "0", duration: "1h", participants: { text: "8/8" }, eventStatus: "Full", cancelled: 0 },
  { event_instance_id: 3, title: { text: "FALL - Green Ball 1 (Ages 9-12)" }, year: "2026", month: "11", date: "4", hour: "17", minute: "0", duration: "1h", participants: { text: "1/8" }, cancelled: 0 },
  { event_instance_id: 4, title: { text: "MEN'S NIGHT" }, year: "2026", month: "11", date: "5", hour: "19", minute: "0", duration: "2h", participants: { text: "0/24" }, cancelled: 1 },
] } };

test("events: adult ones only, cancelled left out, spots and pros read", () => {
  const ev = gt.parseEvents(EVENTS);
  assert.deepEqual([...ev.map((e) => e.id)], ["1", "2"]);
  assert.equal(ev[0].title, "CARDIO TENNIS WITH SCOTT & LISA");
  assert.equal(ev[0].date, "2026-11-03"); assert.equal(ev[0].start, 810); assert.equal(ev[0].minutes, 90);
  assert.equal(ev[0].spotsLeft, 14); assert.equal(ev[0].full, false); assert.equal(ev[0].pros, "MOORE, SCOTT (PRO), MENTI, LISA (PRO)");
  assert.equal(ev[1].full, true); assert.equal(ev[1].spotsLeft, 0);
  assert.equal(gt.parseEvents(EVENTS, { adultOnly: false }).length, 3);
});

// Shaped like GameTime's Available Partners list (note the double space in one div). Made-up people.
const row = (name, phone, email, notes) => `<div class="row even">
  <div class="name"><img src='/r/img/core/default.jpg'><div><label style="display: block;">${name}</label><label style="padding-top: 10px;"></label></div></div>
  <div><p style="font-size: 15px;">${phone}</p><p style="font-size: 15px;">${email}<br></p></div>
  <div  style="font-size: 15px;">${notes}</div>
</div>`;
const PARTNERS = `<div><span class="headTitle1">Available Partners</span></div><div id="availabilityTable">`
  + row("PAT LEE", "(206) 5550101", "pat@example.com", "3.0/3.5 player, doubles or singles") + row("SAM KIM", "", "sam@example.com", "4.0 singles, mornings")
  + row("ALEX P", "2065550199", "", "Weekdays after 4pm") + "</div>";

test("partners: names, contact, level range and singles/doubles from the notes", () => {
  const p = gt.parsePartners(PARTNERS);
  assert.equal(p.length, 3);
  assert.deepEqual({ ...p[0], level: [...p[0].level] }, { name: "PAT LEE", level: [3, 3.5], notes: "3.0/3.5 player, doubles or singles", email: "pat@example.com", phone: "(206) 5550101", singles: true, doubles: true });
  assert.deepEqual([...p[1].level], [4, 4]); assert.equal(p[1].phone, null); assert.equal(p[1].doubles, false);
  assert.equal(p[2].level, null); assert.equal(p[2].email, null);
  assert.deepEqual([...gt.levelRange("2.5 to 3.0 doubles")], [2.5, 3]);
  assert.deepEqual([...gt.levelRange("3-3.5 player")], [3, 3.5]);
  assert.equal(gt.levelRange("available 5:45 AM"), null);
});

test("booking links go to GameTime's own form", () => {
  assert.equal(gt.bookUrl("11", "2026-10-29", 780), "/scheduling/index/book/sport/2/court/11/date/2026-10-29/time/780");
  assert.equal(gt.clock(780), "1 pm"); assert.equal(gt.clock(555), "9:15 am");
});

// ---------- the import endpoint ----------
let app;
before(async () => { delete process.env.NEON_AUTH_BASE_URL; app = await startServer({ port: 3921 }); });
after(() => app && app.close());

function browser() {
  const jar = new Map();
  return {
    async call(method, path, body) {
      const res = await fetch(app.origin + path, {
        method, headers: { "content-type": "application/json", origin: app.origin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
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
const send = (body, origin = "https://stc.gametime.net") =>
  fetch(app.origin + "/api/gametime", { method: "POST", headers: { "content-type": "text/plain", origin }, body: JSON.stringify(body) });
const dayIn = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

const jack = browser();
let key, mcpKey;
test("setup: player and a GameTime button key", async () => {
  assert.equal((await jack.call("POST", "/api/auth/sign-up/email", { name: "Jack", email: "jack-gt@example.com", password: "forehand-winner" })).status, 200);
  await jack.call("POST", "/api/sync", { ops: [{ op: "racket.put", id: "gt-v8", data: { name: "Blade v8", head: 98, gauge: 1.25, material: "poly", pattern: "16x19", calib: 1 } }] });
  key = (await jack.call("POST", "/api/tokens", { scope: "gametime" })).data.token.secret;
  mcpKey = (await jack.call("POST", "/api/tokens", {})).data.token.secret;
});

test("the button's bookings are saved, with CORS for GameTime only", async () => {
  const d1 = dayIn(2), d2 = dayIn(3);
  const res = await send({ key, days: [d1, d2], bookings: [
    { bkId: "1003", ref: "542013", date: d1, time: "13:00", minutes: 75, court: "Court 17", kind: "singles", note: "With ALEX P" },
    { bkId: "1004", ref: "9004", date: d2, time: "10:30", minutes: 75, court: "Court 15", kind: "doubles" },
  ] });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://stc.gametime.net");
  const out = await res.json();
  assert.equal(out.saved, 2); assert.equal(out.added, 2);
  const state = (await jack.call("POST", "/api/sync", { ops: [] })).data;
  const b = state.bookings.find((x) => x.ref === "542013");
  assert.equal(b.court, "Court 17"); assert.equal(b.min, 75);
  assert.equal(new Date(b.start).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }), "1:00 PM");
  const evil = await send({ key, days: [], bookings: [] }, "https://evil.example");
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
});

test("sending again updates, keeps the racket picked in the app, and cancels bookings gone from GameTime", async () => {
  const d1 = dayIn(2), d2 = dayIn(3);
  let state = (await jack.call("POST", "/api/sync", { ops: [] })).data;
  const b = state.bookings.find((x) => x.ref === "542013");
  await jack.call("POST", "/api/sync", { ops: [{ op: "booking.put", ...b, racketId: "gt-v8" }] });
  const out = await (await send({ key, days: [d1, d2], bookings: [
    { bkId: "1003", ref: "542013", date: d1, time: "14:15", minutes: 75, court: "Court 17", kind: "singles" },
  ] })).json();
  assert.equal(out.added, 0); assert.equal(out.cancelled, 1);
  state = (await jack.call("POST", "/api/sync", { ops: [] })).data;
  const mine = state.bookings.filter((x) => x.id.startsWith("gt-"));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].racketId, "gt-v8");
  assert.equal(new Date(mine[0].start).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }), "2:15 PM");
});

test("a booking first saved from a confirmation email is matched by its number, not duplicated", async () => {
  const d = dayIn(4);
  await jack.call("POST", "/api/sync", { ops: [{ op: "booking.put", id: "typed-1", start: Date.now() + 4 * 864e5, min: 60, kind: "singles", ref: "555111" }] });
  await send({ key, days: [d], bookings: [{ bkId: "2001", ref: "555111", date: d, time: "18:00", minutes: 75, court: "Court 2", kind: "singles" }] });
  const state = (await jack.call("POST", "/api/sync", { ops: [] })).data;
  const hits = state.bookings.filter((x) => x.ref === "555111");
  assert.equal(hits.length, 1); assert.equal(hits[0].id, "typed-1"); assert.equal(hits[0].court, "Court 2");
});

test("only a GameTime key works, and bad data is refused", async () => {
  assert.equal((await send({ key: mcpKey, days: [], bookings: [] })).status, 401);
  assert.equal((await send({ key: "sbm_nope", days: [], bookings: [] })).status, 401);
  assert.equal((await send({ key, days: [], bookings: [{ bkId: "x", date: "soon", time: "25:00", minutes: 75 }] })).status, 400);
  assert.equal((await send({ key, days: [], bookings: [{ bkId: "1", date: dayIn(1), time: "10:00", minutes: 5 }] })).status, 400);
  const pre = await fetch(app.origin + "/api/gametime", { method: "OPTIONS", headers: { origin: "https://stc.gametime.net" } });
  assert.equal(pre.status, 204);
});

test("an edited booking (new GameTime booking id, same confirmation) updates the same row", async () => {
  const d = dayIn(5);
  await send({ key, days: [d], bookings: [{ bkId: "3001", ref: "600001", date: d, time: "09:00", minutes: 75, court: "Court 1", kind: "singles" }] });
  const out = await (await send({ key, days: [d], bookings: [{ bkId: "3002", ref: "600001", date: d, time: "10:15", minutes: 75, court: "Court 2", kind: "singles" }] })).json();
  assert.equal(out.added, 0); assert.equal(out.cancelled, 0);
  const state = (await jack.call("POST", "/api/sync", { ops: [] })).data;
  const hits = state.bookings.filter((x) => x.ref === "600001");
  assert.equal(hits.length, 1); assert.equal(hits[0].court, "Court 2");
});
