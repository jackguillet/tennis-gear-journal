import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { startServer } from "../scripts/server.js";
import { planOpenings, planLink, planTitle, toIcs, zonedToUtc } from "../public/courts.js";

// Regular weekly court times: saved in the app, a "book now" calendar alert when each one opens,
// and the GameTime button's one-tap pick for the next one.
let app, gt;
before(async () => {
  delete process.env.NEON_AUTH_BASE_URL; app = await startServer({ port: 3961 });
  const sandbox = {}; sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile(new URL("../public/stc.js", import.meta.url), "utf8"), sandbox);
  gt = sandbox.SBM_GT;
});
after(() => app.close());

const TUE6 = { id: "p1", dow: 2, time: "18:00", min: 75, area: "indoor", court: "Court 15", kind: "singles", note: "Marc" };
const LA = "America/Los_Angeles";

test("each coming Tuesday opens a week ahead at the set time, and booked ones are marked", () => {
  const now = zonedToUtc("2026-11-02", "12:00", LA); // a Monday
  const win = { days: 7, time: "07:00" };
  const booked = [{ start: zonedToUtc("2026-11-03", "18:15", LA), min: 75 }];
  const o = planOpenings([TUE6], win, booked, { now, weeks: 2 });
  assert.deepEqual(o.map((x) => x.date), ["2026-11-03", "2026-11-10", "2026-11-17"]);
  assert.equal(o[0].booked, true); assert.equal(o[1].booked, false);
  assert.equal(new Date(o[1].opensAt).toISOString(), new Date(zonedToUtc("2026-11-03", "07:00", LA)).toISOString());
  assert.equal(o[1].open, false);
  assert.equal(planTitle(TUE6), "Tue 6 pm court (Court 15)");
  assert.equal(planLink(TUE6, "2026-11-10"), "https://stc.gametime.net/scheduling/index/book/sport/2/court/9/date/2026-11-10/time/1080");
  assert.equal(planLink({ ...TUE6, court: null }, "2026-11-10"), "https://stc.gametime.net/scheduling/index/index/sport/2");
  const ics = toIcs([], { now, openings: o.filter((x) => !x.booked) });
  assert.match(ics, /SUMMARY:Book: Tue\\, Nov 10 6 pm court \(Court 15\)/);
  assert.match(ics, /TRIGGER:PT0M/);
  assert.match(ics, /UID:open-p1-2026-11-10@stringbed-meter/);
});

test("the button finds the bookable day, the best court, GameTime's refusal text and the opening time", () => {
  assert.deepEqual({ ...gt.planDays(TUE6, "2026-11-02", "2026-11-09") }, { bookable: "2026-11-03", next: "2026-11-10" });
  assert.deepEqual({ ...gt.planDays({ ...TUE6, dow: 5 }, "2026-11-02", "2026-11-05") }, { bookable: null, next: "2026-11-06" });
  // Today's slot already started: the next week's.
  assert.equal(gt.planDays({ ...TUE6, dow: 1 }, "2026-11-02", "2026-11-09", 19 * 60).bookable, "2026-11-09");
  const slots = [
    { court: "Court 14", courtId: "8", start: 1080 }, { court: "Court 15", courtId: "9", start: 1155 },
    { court: "Court 16", courtId: "10", start: 1005 }, { court: "Court 17", courtId: "11", start: 1305 },
  ];
  assert.deepEqual([...gt.pickSlots(slots, 1080, "Court 15").map((x) => x.court)], ["Court 15", "Court 14", "Court 16"]);
  assert.deepEqual([...gt.pickSlots(slots, 1080, null).map((x) => x.court)], ["Court 14", "Court 15", "Court 16"]);
  assert.equal(gt.bookError('<div id="body"> Back to booking grid <h2>Booking Not Available</h2> <p>You can only book 7 days in advance.</p> Court Time: Tue'), "You can only book 7 days in advance.");
  assert.equal(gt.bookError("<p>Book this court</p>"), null);
  const seen = [{ day: "2026-11-02", min: 400, ahead: 6 }, { day: "2026-11-02", min: 425, ahead: 6 }, { day: "2026-11-02", min: 440, ahead: 7 }, { day: "2026-11-03", min: 1000, ahead: 7 }];
  assert.deepEqual({ ...gt.learnWindowFrom(seen) }, { days: 7, time: "07:15" });
  assert.deepEqual({ ...gt.learnWindowFrom(seen.slice(2)) }, { days: 7, time: null });
});

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

test("regular times sync, show in the calendar and reach the GameTime button; the button can set the window", async () => {
  const jack = browser(), other = browser();
  assert.equal((await jack.call("POST", "/api/auth/sign-up/email", { name: "Jack", email: "jack-plans@example.com", password: "forehand-winner" })).status, 200);
  assert.equal((await other.call("POST", "/api/auth/sign-up/email", { name: "Sam", email: "sam-plans@example.com", password: "forehand-winner" })).status, 200);
  let state = (await jack.call("POST", "/api/sync", { ops: [{ op: "plan.put", ...TUE6 }] })).data;
  assert.equal(state.plans.length, 1); assert.equal(state.plans[0].court, "Court 15");
  assert.deepEqual(state.window, { days: 7, time: "07:00", set: false });
  // Someone else can't change or remove it.
  await other.call("POST", "/api/sync", { ops: [{ op: "plan.put", ...TUE6, time: "06:00" }, { op: "plan.delete", id: "p1" }] });
  state = (await jack.call("POST", "/api/sync", { ops: [] })).data;
  assert.equal(state.plans[0].time, "18:00");
  // Bad values are refused.
  const bad = (await jack.call("POST", "/api/sync", { ops: [{ op: "plan.put", ...TUE6, id: "p2", dow: 9 }, { op: "window.put", days: 7, time: "7am" }] })).data;
  assert.equal(bad.refused.length, 2);

  const cal = (await jack.call("POST", "/api/tokens", { scope: "calendar" })).data.token.secret;
  const ics = await (await fetch(app.origin + "/api/calendar/" + cal + ".ics")).text();
  assert.match(ics, /SUMMARY:Book: Tue\\, /);

  const key = (await jack.call("POST", "/api/tokens", { scope: "gametime" })).data.token.secret;
  const send = (body) => fetch(app.origin + "/api/gametime", { method: "POST", headers: { "content-type": "text/plain", origin: "https://stc.gametime.net" }, body: JSON.stringify({ key, ...body }) }).then((r) => r.json());
  const out = await send({ days: [], bookings: [] });
  assert.equal(out.plans.length, 1); assert.equal(out.window.set, false);
  const learned = await send({ window: { days: 8, time: "08:00" } });
  assert.deepEqual(learned.window, { days: 8, time: "08:00", set: true });
  // A days-only finding keeps the known time.
  assert.deepEqual((await send({ window: { days: 7 } })).window, { days: 7, time: "08:00", set: true });
  await jack.call("POST", "/api/sync", { ops: [{ op: "plan.delete", id: "p1" }] });
  assert.equal((await jack.call("POST", "/api/sync", { ops: [] })).data.plans.length, 0);
});
