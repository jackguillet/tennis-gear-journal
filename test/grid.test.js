import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { startServer } from "../scripts/server.js";
import { gridDay, bestCourt, comingUp, opensAt, courtArea, zonedToUtc } from "../public/courts.js";

// The court grid in the app: the GameTime button sends the whole sheet (no names), the app draws it.
let app, gt;
before(async () => {
  delete process.env.NEON_AUTH_BASE_URL; app = await startServer({ port: 3962 });
  const sandbox = {}; sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile(new URL("../public/stc.js", import.meta.url), "utf8"), sandbox);
  gt = sandbox.SBM_GT;
});
after(() => app.close());
const LA = "America/Los_Angeles";
const plain = (x) => JSON.parse(JSON.stringify(x));

const DAY = {
  date: "2026-11-17", at: 0,
  courts: [
    { c: "Court 3", i: "16", cells: [[1080, 75, "o"], [1155, 75, "b"]] },
    { c: "Court 15", i: "9", cells: [[1080, 75, "b"], [1155, 75, "o"]] },
    { c: "Court 14", i: "8", cells: [[1080, 75, "o"], [1155, 75, "l"]] },
    { c: "Court 10", i: "3", cells: [[540, 60, "e"]] },
  ],
};

test("courts are grouped indoor, outdoor, pro & clay; cells not open yet, past and yours are marked", () => {
  assert.equal(courtArea("Court 15"), "indoor"); assert.equal(courtArea("Court 3"), "outdoor"); assert.equal(courtArea("Court 10"), "clay");
  // Tue Nov 17 6 to 7:15 pm opens Tue Nov 10 at 7:15 pm.
  assert.equal(opensAt("2026-11-17", 1080, 75, 7, LA), zonedToUtc("2026-11-10", "19:15", LA));
  const now = zonedToUtc("2026-11-10", "19:30", LA); // 6 pm is bookable, 7:15 pm isn't yet
  const g = gridDay(DAY, { now, areas: ["indoor", "outdoor", "clay"] });
  assert.deepEqual(g.courts.map((c) => c.name), ["Court 14", "Court 15", "Court 3", "Court 10"]);
  assert.deepEqual(g.courts.map((c) => c.first), [true, false, true, true]);
  assert.deepEqual(g.rows.map((r) => r.start), [540, 1080, 1155]);
  assert.deepEqual(g.rows[1].cells.map((c) => c.state), ["open", "taken", "open", "closed"]);
  assert.deepEqual(g.rows[2].cells.map((c) => c.state), ["lesson", "soon", "taken", "closed"]);
  assert.ok(g.rows[2].cells[1].opensAt > now);
  // Evening, indoor only; Jack's own booking on Court 15 shows as his even before the next scan.
  const mine = [{ start: zonedToUtc("2026-11-17", "18:00", LA), min: 75, court: "Court 15" }];
  const e = gridDay(DAY, { now, areas: ["indoor"], part: "evening", bookings: mine });
  assert.deepEqual(e.courts.map((c) => c.name), ["Court 14", "Court 15"]);
  assert.deepEqual(e.rows.map((r) => r.cells.map((c) => c.state)), [["open", "mine"], ["lesson", "soon"]]);
  // On the day, times already started drop off.
  const later = gridDay(DAY, { now: zonedToUtc("2026-11-17", "18:30", LA) });
  assert.deepEqual(later.rows.map((r) => r.start), [1155]);
});

test("the best court for a regular time: favourite, then backups, then the area", () => {
  const now = zonedToUtc("2026-11-16", "20:00", LA); // everything on the 17th is bookable
  const plan = { time: "18:00", area: "indoor", court: "Court 15", backups: "Court 14" };
  assert.equal(bestCourt(DAY, plan, { now }).court, "Court 14", "favourite taken at 6, backup open at 6");
  assert.equal(bestCourt(DAY, { ...plan, time: "19:15" }, { now }).court, "Court 15");
  assert.equal(bestCourt(DAY, { time: "18:00", area: "outdoor" }, { now }).court, "Court 3");
  assert.equal(bestCourt(DAY, { time: "12:00", area: "any" }, { now }), null);
});

test("coming up lists bookings and regular times not booked yet, by start", () => {
  const now = zonedToUtc("2026-11-16", "12:00", LA); // Monday
  const plans = [{ id: "p1", dow: 2, time: "18:00", min: 75, area: "indoor" }, { id: "p2", dow: 5, time: "14:15", min: 75, court: "Court 17" }];
  const bookings = [{ id: "b1", start: zonedToUtc("2026-11-20", "14:15", LA), min: 75, court: "Court 17" }, { id: "b2", start: zonedToUtc("2026-11-15", "10:00", LA), min: 60 }];
  const list = comingUp(bookings, plans, { days: 7 }, { now, tz: LA });
  assert.deepEqual(list.map((x) => x.type), ["plan", "booking"]);
  assert.equal(list[0].opening.date, "2026-11-17"); assert.equal(list[0].opening.open, true);
  assert.equal(list[1].booking.id, "b1", "the Friday booked counts for the Friday routine, the past one is left out");
});

test("the button sends the whole sheet without names; the app gets it back from sync", async () => {
  const sheet = { e: [
    { n: "Court 15", i: "9", t: [{ t: 1080, d: 150, i: 75 }], b: [{ t: 1080, d: 75, bkId: 1, e: 18578, p: [{ n: "JACK G", u: 18578 }] }] },
    { n: "Court 14", i: "8", t: [{ t: 1080, d: 150, i: 75 }], b: [{ t: 1155, d: 75, bkId: 2, j: "SCOTT (PRO) MOORE" }, { t: 1080, d: 75, bkId: 3, p: [{ n: "PAT LEE", u: 1 }] }] },
  ] };
  const cells = plain(gt.sheetCells([sheet], "18578"));
  assert.deepEqual(cells, [
    { c: "Court 14", i: "8", cells: [[1080, 75, "b"], [1155, 75, "l"]] },
    { c: "Court 15", i: "9", cells: [[1080, 75, "m"], [1155, 75, "o"]] },
  ]);
  assert.ok(!/PAT|SCOTT|JACK/.test(JSON.stringify(cells)));

  const jar = new Map();
  const call = async (path, body) => {
    const res = await fetch(app.origin + path, { method: "POST", headers: { "content-type": "application/json", origin: app.origin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body: JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    return res.json();
  };
  await call("/api/auth/sign-up/email", { name: "Jack", email: "jack-grid@example.com", password: "forehand-winner" });
  const key = (await call("/api/tokens", { scope: "gametime" })).token.secret;
  const day = new Date(Date.now() + 2 * 864e5).toLocaleDateString("en-CA", { timeZone: LA });
  const old = new Date(Date.now() - 3 * 864e5).toLocaleDateString("en-CA", { timeZone: LA });
  const bad = [{ c: "Court 1", i: "x", cells: [[1, 60, "o"]] }, { c: "Court 2", i: "15", cells: [[1080, 60, "z"], [99999, 60, "o"], [600, 60, "o"]] }];
  const res = await fetch(app.origin + "/api/gametime", { method: "POST", headers: { "content-type": "text/plain", origin: "https://stc.gametime.net" },
    body: JSON.stringify({ key, open: { at: Date.now(), days: [{ date: day, grid: [...cells, ...bad] }, { date: old, grid: cells }] } }) });
  assert.equal((await res.json()).saved, 2);
  const state = await call("/api/sync", { ops: [] });
  assert.equal(state.courtSheet.length, 1, "past days aren't sent back");
  assert.equal(state.courtSheet[0].date, day);
  assert.deepEqual(state.courtSheet[0].courts.map((c) => c.c), ["Court 14", "Court 15", "Court 2"]);
  assert.deepEqual(state.courtSheet[0].courts[2].cells, [[600, 60, "o"]], "bad cells and courts are dropped");
  // A day sent with only a grid still gives a chat assistant its open slots.
  const mcp = (await call("/api/tokens", {})).token.secret;
  const found = await (await fetch(app.origin + "/api/mcp/" + mcp, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find_open_courts", arguments: { date: day } } }) })).json();
  assert.deepEqual(found.result.structuredContent.days[0].open.map((x) => x.court + " " + x.start), ["Court 2 10:00", "Court 15 19:15"]);
});
