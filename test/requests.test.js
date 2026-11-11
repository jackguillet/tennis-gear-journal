import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { startServer } from "../scripts/server.js";
import { requestStatus, planOpenings, planTitle, zonedToUtc } from "../public/courts.js";

// Requests: one-off or weekly court requests, skipped weeks, and the player's own waitlist places.
let app, gt;
before(async () => {
  delete process.env.NEON_AUTH_BASE_URL; app = await startServer({ port: 3963 });
  const sandbox = {}; sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile(new URL("../public/stc.js", import.meta.url), "utf8"), sandbox);
  gt = sandbox.SBM_GT;
});
after(() => app.close());
const LA = "America/Los_Angeles";
const TUE6 = { id: "p1", dow: 2, time: "18:00", min: 75, area: "indoor", court: "Court 15" };
const SHEET = [{ date: "2026-11-17", at: 0, courts: [{ c: "Court 15", i: "9", cells: [[1080, 75, "b"]] }, { c: "Court 14", i: "8", cells: [[1080, 75, "o"]] }] }];

test("one-off requests have one date, weekly ones skip the weeks asked", () => {
  const now = zonedToUtc("2026-11-09", "12:00", LA); // a Monday
  const once = { ...TUE6, id: "o1", date: "2026-11-24" };
  assert.deepEqual(planOpenings([once], { days: 7 }, [], { now, weeks: 3 }).map((o) => o.date), ["2026-11-24"]);
  assert.deepEqual(planOpenings([{ ...once, date: "2026-11-03" }], { days: 7 }, [], { now }).length, 0);
  assert.deepEqual(planOpenings([{ ...TUE6, skips: ["2026-11-17"] }], { days: 7 }, [], { now, weeks: 2 }).map((o) => o.date), ["2026-11-10", "2026-11-24"]);
  assert.equal(planTitle(once), "Tue, Nov 24 6 pm court (Court 15)");
  // The button: the one-off isn't bookable until it opens; a skipped week is passed over.
  assert.deepEqual({ ...gt.planDays(once, "2026-11-09", 720) }.bookable, null);
  assert.equal(gt.planDays(once, "2026-11-17", 19 * 60 + 15).bookable, "2026-11-24");
  assert.equal(gt.planDays({ ...once, date: "2026-11-02" }, "2026-11-09", 0).next, null);
  assert.equal(gt.planDays({ ...TUE6, skips: ["2026-11-10"] }, "2026-11-09", 720).next, "2026-11-17");
});

test("a request says where it stands", () => {
  const plan = { ...TUE6, skips: ["2026-11-10"], backups: "Court 14" };
  const st = (now, extra = {}) => requestStatus(plan, { now: zonedToUtc(...now, LA), sheet: SHEET, ...extra });
  assert.equal(st(["2026-11-10", "12:00"]).state, "soon");
  const open = st(["2026-11-10", "20:00"]);
  assert.equal(open.state, "open"); assert.equal(open.best.court, "Court 14");
  assert.equal(st(["2026-11-10", "20:00"], { sheet: [{ ...SHEET[0], courts: [SHEET[0].courts[0]] }] }).state, "taken");
  assert.equal(st(["2026-11-10", "20:00"], { sheet: [] }).state, "unknown");
  assert.equal(st(["2026-11-10", "20:00"], { waitlist: [{ date: "2026-11-17", start: 1080, minutes: 75 }] }).state, "waitlist");
  assert.equal(st(["2026-11-10", "20:00"], { bookings: [{ start: zonedToUtc("2026-11-17", "18:00", LA), min: 75 }] }).state, "booked");
  assert.equal(requestStatus({ ...plan, paused: true }).state, "paused");
  assert.equal(requestStatus({ ...plan, date: "2026-11-03" }, { now: zonedToUtc("2026-11-10", "12:00", LA) }).state, "done");
});

test("the button picks out only the member's own waitlist rows, without other names", () => {
  const rows = [
    { date: "2026-11-17", start: 1080, minutes: 75, players: ["JACKSON GUILLET", "MARC SMITH"], courts: ["14", "15"] },
    { date: "2026-11-18", start: 600, minutes: 75, players: ["PAT LEE"], courts: ["3"] },
  ];
  const mine = JSON.parse(JSON.stringify(gt.myWaitlist(rows, "Jackson  Guillet")));
  assert.deepEqual(mine, [{ date: "2026-11-17", start: 1080, minutes: 75, courts: ["14", "15"] }]);
  assert.deepEqual([...gt.myWaitlist(rows, null)], []);
});

test("requests and waitlist places sync; a chat assistant can make one-offs and skip weeks", async () => {
  const jar = new Map();
  const call = async (path, body) => {
    const res = await fetch(app.origin + path, { method: "POST", headers: { "content-type": "application/json", origin: app.origin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body: JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    return res.json();
  };
  await call("/api/auth/sign-up/email", { name: "Jack", email: "jack-req@example.com", password: "forehand-winner" });
  const day = new Date(Date.now() + 3 * 864e5).toLocaleDateString("en-CA", { timeZone: LA });
  let state = await call("/api/sync", { ops: [{ op: "plan.put", ...TUE6, id: "o1", date: day, skips: [] }, { op: "plan.put", ...TUE6, skips: ["2026-12-01", "2026-11-24", "2026-11-24"] }] });
  const once = state.plans.find((p) => p.id === "o1"), weekly = state.plans.find((p) => p.id === "p1");
  assert.equal(once.date, day); assert.equal(once.dow, new Date(day + "T12:00:00Z").getUTCDay(), "the day follows the date");
  assert.deepEqual(weekly.skips, ["2026-11-24", "2026-12-01"]); assert.equal(weekly.date, null);
  const bad = await call("/api/sync", { ops: [{ op: "plan.put", ...TUE6, id: "x1", date: "soon" }, { op: "plan.put", ...TUE6, id: "x2", skips: ["nope"] }] });
  assert.equal(bad.refused.length, 2);

  const key = (await call("/api/tokens", { scope: "gametime" })).token.secret;
  const send = (body) => fetch(app.origin + "/api/gametime", { method: "POST", headers: { "content-type": "text/plain", origin: "https://stc.gametime.net" }, body: JSON.stringify({ key, ...body }) }).then((r) => r.json());
  assert.equal((await send({ waitlist: [{ date: day, start: 1080, minutes: 75, courts: ["14", "15"] }, { date: "bad", start: 1, minutes: 75 }] })).saved, 1);
  state = await call("/api/sync", { ops: [] });
  assert.deepEqual(state.waitlist.map((w) => [w.date, w.start, w.courts]), [[day, 1080, "14, 15"]]);
  assert.equal((await send({ waitlist: [] })).saved, 0);
  assert.equal((await call("/api/sync", { ops: [] })).waitlist.length, 0, "a new read replaces the old one");

  const mcp = (await call("/api/tokens", {})).token.secret;
  let id = 0;
  const tool = async (name, args) => (await (await fetch(app.origin + "/api/mcp/" + mcp, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
  const added = await tool("add_regular_time", { date: day, time: "07:30", area: "outdoor" });
  assert.ok(!added.isError, JSON.stringify(added)); assert.doesNotMatch(added.content[0].text, /every week/);
  const skipped = await tool("update_regular_time", { id: "p1", skip: "2026-12-08", unskip: "2026-11-24" });
  assert.deepEqual(skipped.structuredContent.skips, ["2026-12-01", "2026-12-08"]);
  const listed = await tool("list_regular_times", {});
  assert.equal(listed.structuredContent.regular_times.find((p) => p.id === added.structuredContent.id).once, day);
});
