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

test("each coming Tuesday opens exactly a week before it ends, and booked ones are marked", () => {
  const now = zonedToUtc("2026-11-02", "12:00", LA); // a Monday
  const win = { days: 7 };
  const booked = [{ start: zonedToUtc("2026-11-03", "18:15", LA), min: 75 }];
  const o = planOpenings([TUE6], win, booked, { now, weeks: 2 });
  assert.deepEqual(o.map((x) => x.date), ["2026-11-03", "2026-11-10", "2026-11-17"]);
  assert.equal(o[0].booked, true); assert.equal(o[1].booked, false);
  // 6 to 7:15 pm on Nov 10 opens at 7:15 pm on Nov 3.
  assert.equal(new Date(o[1].opensAt).toISOString(), new Date(zonedToUtc("2026-11-03", "19:15", LA)).toISOString());
  // Jack's Friday 2:15 pm (75 min) on Nov 6 opened at 3:30 pm on Oct 30, across the clock change.
  const fri = planOpenings([{ ...TUE6, dow: 5, time: "14:15" }], win, [], { now: zonedToUtc("2026-10-30", "15:17", LA), weeks: 1 });
  assert.equal(fri[0].date, "2026-11-06"); assert.equal(fri[0].open, false);
  assert.equal(new Date(fri[0].opensAt).toISOString(), new Date(zonedToUtc("2026-10-30", "15:30", LA)).toISOString());
  assert.equal(o[1].open, false);
  assert.equal(planTitle(TUE6), "Tue 6 pm court (Court 15)");
  assert.equal(planLink(TUE6, "2026-11-10"), "https://stc.gametime.net/scheduling/index/book/sport/2/court/9/date/2026-11-10/time/1080");
  assert.equal(planLink({ ...TUE6, court: null }, "2026-11-10"), "https://stc.gametime.net/scheduling/index/index/sport/2");
  const ics = toIcs([], { now, openings: o.filter((x) => !x.booked) });
  assert.match(ics, /SUMMARY:Book: Tue\\, Nov 10 6 pm court \(Court 15\)/);
  assert.match(ics, /TRIGGER:PT0M/);
  assert.match(ics, /UID:open-p1-2026-11-10@stringbed-meter/);
  // Backup courts get their own links; a paused routine makes no alerts.
  const withBackups = toIcs([], { now, openings: planOpenings([{ ...TUE6, backups: "Court 14" }], win, [], { now, weeks: 1 }) });
  assert.match(withBackups.replace(/\r\n /g, ""), /If taken\\, Court 14: https:\/\/stc\.gametime\.net\/scheduling\/index\/book\/sport\/2\/court\/8\//);
  assert.equal(planOpenings([{ ...TUE6, paused: true }], win, [], { now }).length, 0);
});

test("the button finds the bookable day, the best court, GameTime's refusal text and the opening time", () => {
  // Monday noon: tomorrow's 6 pm is open, next Tuesday's opens tomorrow at 7:15 pm.
  const tue = gt.planDays(TUE6, "2026-11-02", 12 * 60);
  assert.equal(tue.bookable, "2026-11-03"); assert.equal(tue.next, "2026-11-10");
  assert.deepEqual({ ...tue.opens }, { date: "2026-11-03", min: 19 * 60 + 15 });
  // Friday Oct 30 at 3:17 pm: next Friday's 2:15 pm opens at 3:30 pm today; at 3:30 it's bookable.
  const fri = { ...TUE6, dow: 5, time: "14:15" };
  assert.equal(gt.planDays(fri, "2026-10-30", 15 * 60 + 17).bookable, null);
  assert.deepEqual({ ...gt.planDays(fri, "2026-10-30", 15 * 60 + 17).opens }, { date: "2026-10-30", min: 15 * 60 + 30 });
  assert.equal(gt.planDays(fri, "2026-10-30", 15 * 60 + 30).bookable, "2026-11-06");
  // Today's slot already started: the next week's, open since an hour after it started.
  assert.equal(gt.planDays({ ...TUE6, dow: 1 }, "2026-11-02", 19 * 60 + 15).bookable, "2026-11-09");
  const slots = [
    { court: "Court 14", courtId: "8", start: 1080 }, { court: "Court 15", courtId: "9", start: 1155 },
    { court: "Court 16", courtId: "10", start: 1005 }, { court: "Court 17", courtId: "11", start: 1305 },
  ];
  assert.deepEqual([...gt.pickSlots(slots, 1080, "Court 15").map((x) => x.court)], ["Court 15", "Court 14", "Court 16"]);
  assert.deepEqual([...gt.pickSlots(slots, 1080, null).map((x) => x.court)], ["Court 14", "Court 15", "Court 16"]);
  // Favourite taken: backups in the order given, then the rest.
  assert.deepEqual([...gt.pickSlots(slots, 1080, "Court 17", 90, "Court 16, Court 15").map((x) => x.court)], ["Court 16", "Court 15", "Court 14"]);
  assert.equal(gt.bookError('<div id="body"> Back to booking grid <h2>Booking Not Available</h2> <p>You can only book 7 days in advance.</p> Court Time: Tue'), "You can only book 7 days in advance.");
  assert.equal(gt.bookError("<p>Book this court</p>"), null);
  // The page Jack got on 2026-10-30.
  const page = '<h2>Booking Not Available</h2><p>JACKSON GUILLET (Resident Joint Active) is not allowed to book more than 7 days in advance. Please wait for 12 minute(s). [R.2]</p><p>Time: October 30, 2026 3:17:43 pm</p>';
  const said = gt.bookError(page);
  assert.equal(said, "JACKSON GUILLET (Resident Joint Active) is not allowed to book more than 7 days in advance. Please wait for 12 minute(s). [R.2]");
  assert.deepEqual({ ...gt.bookLimit(said) }, { days: 7, wait: 12 });
  assert.equal(gt.bookLimit("The court time is in the past."), null);
});

test("the grid marks each court and time open, taken, yours, a lesson or a club event; saved slots carry no names", () => {
  const sheet = { e: [
    { n: "Court 15", i: "9", t: [{ t: 1080, d: 150, i: 75 }], b: [{ t: 1080, d: 75, bkId: 1, e: 18578, p: [{ n: "JACK G", u: 18578 }] }] },
    { n: "Court 14", i: "8", t: [{ t: 1080, d: 150, i: 75 }], b: [{ t: 1155, d: 75, bkId: 2, j: "SCOTT (PRO) MOORE" }] },
    { n: "Court 16", i: "10", t: [{ t: 1155, d: 75, i: 75 }], b: [{ t: 1155, d: 75, bkId: 3, m: 8300, p: [{ n: "PAT LEE", u: 1 }] }] },
  ] };
  const g = gt.sheetGrid([sheet, sheet], "18578");
  assert.deepEqual([...g.courts.map((c) => c.name)], ["Court 14", "Court 15", "Court 16"], "each court once, in order");
  assert.deepEqual([...g.rows.map((r) => r.start)], [1080, 1155]);
  assert.deepEqual([...g.rows[0].cells.map((c) => c.state)], ["open", "mine", "closed"]);
  assert.deepEqual([...g.rows[1].cells.map((c) => c.state)], ["lesson", "open", "event"]);
  const free = gt.freeSlots([sheet]);
  assert.deepEqual(JSON.parse(JSON.stringify(free)), [{ c: "Court 14", i: "8", t: 1080, d: 75 }, { c: "Court 15", i: "9", t: 1155, d: 75 }]);
  assert.ok(!JSON.stringify(free).includes("PAT"));
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
  assert.deepEqual(state.window, { days: 7, set: false });
  // Someone else can't change or remove it.
  await other.call("POST", "/api/sync", { ops: [{ op: "plan.put", ...TUE6, time: "06:00" }, { op: "plan.delete", id: "p1" }] });
  state = (await jack.call("POST", "/api/sync", { ops: [] })).data;
  assert.equal(state.plans[0].time, "18:00");
  // Bad values are refused.
  const bad = (await jack.call("POST", "/api/sync", { ops: [{ op: "plan.put", ...TUE6, id: "p2", dow: 9 }, { op: "window.put", days: 0 }] })).data;
  assert.equal(bad.refused.length, 2);

  const cal = (await jack.call("POST", "/api/tokens", { scope: "calendar" })).data.token.secret;
  const ics = await (await fetch(app.origin + "/api/calendar/" + cal + ".ics")).text();
  assert.match(ics, /SUMMARY:Book: Tue\\, /);

  const key = (await jack.call("POST", "/api/tokens", { scope: "gametime" })).data.token.secret;
  const send = (body) => fetch(app.origin + "/api/gametime", { method: "POST", headers: { "content-type": "text/plain", origin: "https://stc.gametime.net" }, body: JSON.stringify({ key, ...body }) }).then((r) => r.json());
  const out = await send({ days: [], bookings: [] });
  assert.equal(out.plans.length, 1); assert.equal(out.window.set, false);
  assert.deepEqual((await send({ window: { days: 8 } })).window, { days: 8, set: true });
  assert.deepEqual((await send({ window: { days: 7 } })).window, { days: 7, set: true });
  await jack.call("POST", "/api/sync", { ops: [{ op: "plan.delete", id: "p1" }] });
  assert.equal((await jack.call("POST", "/api/sync", { ops: [] })).data.plans.length, 0);
});

test("open courts from the button reach a chat assistant, with links to book; it can manage regular times", async () => {
  const jack = browser();
  await jack.call("POST", "/api/auth/sign-up/email", { name: "Jack", email: "jack-open@example.com", password: "forehand-winner" });
  const key = (await jack.call("POST", "/api/tokens", { scope: "gametime" })).data.token.secret;
  const mcp = (await jack.call("POST", "/api/tokens", {})).data.token.secret;
  const day = new Date(Date.now() + 2 * 864e5).toLocaleDateString("en-CA", { timeZone: LA });
  const res = await fetch(app.origin + "/api/gametime", { method: "POST", headers: { "content-type": "text/plain", origin: "https://stc.gametime.net" },
    body: JSON.stringify({ key, open: { at: Date.now(), days: [{ date: day, slots: [{ c: "Court 15", i: "9", t: 1080, d: 75 }, { c: "Court 3", i: "16", t: 1140, d: 75 }, { c: "<b>", i: "x", t: 5, d: 75 }] }] } }) });
  assert.equal((await res.json()).saved, 1);
  let id = 0;
  const tool = async (name, args) => (await (await fetch(app.origin + "/api/mcp/" + mcp, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
  const found = await tool("find_open_courts", { date: day, after: "17:00", area: "indoor" });
  assert.equal(found.structuredContent.days[0].open.length, 1);
  assert.equal(found.structuredContent.days[0].open[0].book, `https://stc.gametime.net/scheduling/index/book/sport/2/court/9/date/${day}/time/1080`);
  const all = await tool("find_open_courts", { date: day });
  assert.equal(all.structuredContent.days[0].open.length, 2, "the bad slot was dropped");
  const near = await tool("court_booking_link", { date: day, time: "19:15" });
  assert.equal(near.structuredContent.court, "Court 3"); assert.match(near.structuredContent.link, /court\/16\//);
  const exact = await tool("court_booking_link", { date: day, time: "18:00", court: "Court 17" });
  assert.equal(exact.structuredContent.open, false); assert.match(exact.structuredContent.link, /court\/11\/.*time\/1080$/);
  const added = await tool("add_regular_time", { day: "Tuesday", time: "18:00", area: "indoor", note: "Marc" });
  assert.ok(!added.isError);
  const listed = await tool("list_regular_times", {});
  assert.equal(listed.structuredContent.regular_times.length, 1);
  assert.equal(listed.structuredContent.regular_times[0].minutes, 75);
  assert.ok(listed.structuredContent.regular_times[0].next.date);
  // Jack's Friday routine: change it, add backups, pause and resume it.
  const pid = added.structuredContent.id;
  const changed = await tool("update_regular_time", { id: pid, day: "Friday", time: "14:15", court: "Court 17", backups: "15, ct 14" });
  assert.ok(!changed.isError, JSON.stringify(changed));
  assert.equal(changed.structuredContent.backups, "Court 15, Court 14"); assert.equal(changed.structuredContent.note, "Marc");
  assert.equal(changed.structuredContent.dow, 5);
  assert.equal((await tool("update_regular_time", { id: pid, paused: true })).structuredContent.paused, true);
  const paused = (await tool("list_regular_times", {})).structuredContent.regular_times[0];
  assert.equal(paused.paused, true); assert.equal(paused.next, null);
  assert.equal((await tool("update_regular_time", { id: pid, paused: false, backups: "" })).structuredContent.backups, null);
  assert.ok((await tool("update_regular_time", { id: "nope", paused: true })).isError);
  assert.ok((await tool("update_regular_time", { id: pid, backups: "1,2,3,4,5,6,7" })).isError);
  assert.ok(!(await tool("remove_regular_time", { id: pid })).isError);
  assert.equal((await tool("list_regular_times", {})).structuredContent.regular_times.length, 0);
});
