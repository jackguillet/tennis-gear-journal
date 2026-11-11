import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/server.js";
import { rainAt, indoorSwap, outdoorCourt, outdoorPlan, speedBucket, speedSummary, suggestRequests, shareText, zonedToUtc } from "../public/courts.js";

// Rain check, how fast courts go, suggested requests and the text sent to a partner.
let app;
before(async () => { delete process.env.NEON_AUTH_BASE_URL; app = await startServer({ port: 3964 }); });
after(() => app.close());
const LA = "America/Los_Angeles";

test("rain over an outdoor court time, and an indoor court to switch to", () => {
  const forecast = { hourly: { time: ["2026-11-13T13:00", "2026-11-13T14:00", "2026-11-13T15:00", "2026-11-13T16:00"], precipitation_probability: [10, 40, 80, 90], temperature_2m: [9, 10, 11, 12] } };
  const start = zonedToUtc("2026-11-13", "14:15", LA);
  assert.deepEqual(rainAt(forecast, start, 75, LA), { prob: 80, temp: 11 }, "2 and 3 pm cover 2:15 to 3:30");
  assert.equal(rainAt(forecast, zonedToUtc("2026-11-20", "14:15", LA), 75, LA), null, "past the forecast");
  assert.ok(outdoorCourt("Court 3") && outdoorCourt("Court 10") && !outdoorCourt("Court 15") && !outdoorCourt(null));
  assert.ok(outdoorPlan({ area: "outdoor" }) && !outdoorPlan({ area: "any" }) && !outdoorPlan({ area: "outdoor", court: "Court 17" }));
  const sheet = [{ date: "2026-11-13", courts: [{ c: "Court 3", i: "16", cells: [[855, 75, "o"]] }, { c: "Court 15", i: "9", cells: [[855, 75, "o"]] }] }];
  assert.equal(indoorSwap(sheet, start, { now: zonedToUtc("2026-11-12", "12:00", LA) }).court, "Court 15");
});

test("how fast a weekly time goes", () => {
  assert.equal(speedBucket(-1), null); assert.equal(speedBucket(30 * 60000), "1h"); assert.equal(speedBucket(2 * 86400000), "3d"); assert.equal(speedBucket(9 * 86400000), null);
  const row = (bucket, open, seen, area = "indoor") => ({ dow: 2, t: 1080, area, bucket, open, seen });
  assert.equal(speedSummary([row("1h", 1, 6)], { dow: 2, time: "18:00", area: "indoor" }), null, "too few scans");
  assert.equal(speedSummary([row("1h", 0, 6), row("1d", 0, 6)], { dow: 2, time: "18:00", area: "indoor" }), "Usually all taken within an hour of opening");
  assert.equal(speedSummary([row("1h", 4, 6), row("1d", 0, 6)], { dow: 2, time: "18:00" }), "Usually all taken within a day of opening");
  assert.equal(speedSummary([row("1h", 5, 6), row("3d", 4, 6)], { dow: 2, time: "18:00" }), "Usually still easy to get 3 days after it opens");
  assert.equal(speedSummary([row("1h", 5, 6), row("1d", 2, 6)], { dow: 2, time: "18:00" }), "About 33% of courts still open a day after it opens");
  assert.equal(speedSummary([row("1h", 0, 6), row("1d", 0, 6)], { dow: 3, time: "18:00" }), null, "another day");
});

test("suggested requests come from times booked in different weeks", () => {
  const now = zonedToUtc("2026-11-11", "12:00", LA);
  const b = (d, t, court) => ({ start: zonedToUtc(d, t, LA), min: 75, court });
  const bookings = [b("2026-10-23", "14:15", "Court 17"), b("2026-10-30", "14:15", "Court 17"), b("2026-11-06", "14:15", "Court 15"), b("2026-11-04", "09:00", "Court 3"), b("2026-09-01", "18:00", "Court 1"), b("2026-08-25", "18:00", "Court 1")];
  const s = suggestRequests(bookings, [], { now });
  assert.deepEqual(s.map((x) => [x.dow, x.time, x.court, x.count]), [[5, "14:15", "Court 17", 3]]);
  assert.equal(s[0].area, "indoor");
  assert.equal(suggestRequests(bookings, [{ dow: 5, time: "14:00" }], { now }).length, 0, "a request already covers it");
});

test("the text for a partner", () => {
  const t = shareText({ start: zonedToUtc("2026-11-13", "14:15", LA), min: 75, court: "Court 17" });
  assert.equal(t, "Tennis Friday, Nov 13, 2:15 PM to 3:30 PM, Court 17 at Seattle Tennis Club, 922 McGilvra Blvd E, Seattle, WA 98112. Check in at the Pro Shop; mostly-white clothing.");
});

test("scans build up how fast courts go, and suggestions reach the app", async () => {
  const jar = new Map();
  const call = async (path, body) => {
    const res = await fetch(app.origin + path, { method: "POST", headers: { "content-type": "application/json", origin: app.origin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body: JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    return res.json();
  };
  await call("/api/auth/sign-up/email", { name: "Jack", email: "jack-extras@example.com", password: "forehand-winner" });
  const key = (await call("/api/tokens", { scope: "gametime" })).token.secret;
  const day = new Date(Date.now() + 3 * 864e5).toLocaleDateString("en-CA", { timeZone: LA });
  const grid = [{ c: "Court 15", i: "9", cells: [[1080, 75, "b"], [1155, 75, "o"], [600, 60, "l"]] }, { c: "Court 14", i: "8", cells: [[1080, 75, "o"]] }];
  const send = () => fetch(app.origin + "/api/gametime", { method: "POST", headers: { "content-type": "text/plain", origin: "https://stc.gametime.net" }, body: JSON.stringify({ key, open: { at: Date.now(), days: [{ date: day, grid }] } }) }).then((r) => r.json());
  assert.equal((await send()).saved, 1);
  await send(); // the same scan again counts once
  const state = await call("/api/sync", { ops: [] });
  const dow = new Date(day + "T12:00:00Z").getUTCDay();
  const at6 = state.courtStats.filter((r) => r.t === 1080);
  assert.deepEqual(at6.map((r) => [r.dow, r.area, r.open, r.seen]), [[dow, "indoor", 1, 2]]);
  assert.equal(state.courtStats.filter((r) => r.t === 600).length, 0, "lesson time isn't counted");
  assert.deepEqual(state.suggestions, []);
});
