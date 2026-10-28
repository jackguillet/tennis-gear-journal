import { test } from "node:test";
import assert from "node:assert/strict";
import { restringAdvice, lifeHours } from "../public/restring.js";
import { tensionKg } from "../public/tension.js";

const TODAY = "2026-10-28";
const racket = (over = {}) => ({ name: "v8", head: 98, gauge: 1.25, material: "poly", pattern: "16x19", strungKg: 22.68, strungOn: "2026-10-20", calib: 1, calibAt: null, readings: [], plays: [], ...over });
const play = (d, hours, kind = "singles") => ({ id: d + kind, d, min: hours * 60, kind });

test("fresh strings with little play are fine", () => {
  const a = restringAdvice(racket({ plays: [play("2026-10-22", 2)] }), {}, TODAY);
  assert.equal(a.status, "good");
  assert.equal(a.hours_on_strings, 2);
  assert.ok(a.restring_by > TODAY);
});

test("polyester goes dead long before nylon, gut lasts longest", () => {
  const h = (material) => lifeHours(racket({ material }), {}).play;
  assert.ok(h("poly") < h("multi") && h("multi") < h("gut"));
  const plays = [play("2026-10-21", 8), play("2026-10-25", 8)];
  assert.equal(restringAdvice(racket({ plays }), {}, TODAY).status, "now");
  assert.equal(restringAdvice(racket({ plays, material: "multi" }), {}, TODAY).status, "good");
});

test("thin gauge, open pattern, heavy spin and low tension all shorten break life", () => {
  const b = (over, profile = {}) => lifeHours(racket(over), profile).break;
  assert.ok(b({ gauge: 1.20 }) < b({}) && b({}) < b({ gauge: 1.30 }));
  assert.ok(b({ pattern: "16x18" }) < b({}) && b({}) < b({ pattern: "18x20" }));
  assert.ok(b({ head: 110 }) < b({}));
  assert.ok(b({ strungKg: 20 }) < b({ strungKg: 26 }));
  assert.ok(b({}, { style: "heavy_spin" }) < b({}, { style: "flat" }));
  assert.ok(b({}, { level: "5.0" }) < b({}, { level: "3.5" }));
});

test("a heavy-spin 4.5 player in thin multi is told to restring for breakage", () => {
  const a = restringAdvice(racket({ material: "multi", gauge: 1.20, plays: [play("2026-10-21", 6), play("2026-10-26", 6)] }), { level: "4.5", style: "heavy_spin" }, TODAY);
  assert.equal(a.reason, "break");
  assert.equal(a.status, "now");
});

test("drills count for more wear than doubles", () => {
  const drills = restringAdvice(racket({ plays: [play("2026-10-22", 4, "drills")] }), {}, TODAY);
  const doubles = restringAdvice(racket({ plays: [play("2026-10-22", 4, "doubles")] }), {}, TODAY);
  assert.ok(drills.life_used_pct > doubles.life_used_pct);
  assert.equal(drills.hours_on_strings, doubles.hours_on_strings);
});

test("old strings need replacing even unplayed", () => {
  const a = restringAdvice(racket({ strungOn: "2026-06-20" }), {}, TODAY);
  assert.equal(a.status, "now");
  assert.equal(a.reason, "age");
  assert.equal(a.days_since_strung, 130);
});

test("measured tension loss since a calibrated restring", () => {
  const r = racket({ calib: 1.1, calibAt: Date.parse("2026-10-20T18:00:00Z") });
  // find the pitch that reads a given machine tension on this racket
  const hzFor = (kg) => { let lo = 200, hi = 1200; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (tensionKg(m, r) < kg) lo = m; else hi = m; } return lo; };
  const reading = (d, kg) => ({ id: d, t: Date.parse(d + "T18:00:00Z"), hz: hzFor(kg) });
  let a = restringAdvice({ ...r, readings: [reading("2026-10-27", 22.68 * 0.9)] }, {}, TODAY);
  assert.equal(a.tension_loss_pct, 10);
  assert.equal(a.status, "good");
  a = restringAdvice({ ...r, readings: [reading("2026-10-27", 22.68 * 0.72)] }, {}, TODAY);
  assert.equal(a.reason, "tension");
  assert.equal(a.status, "now");
});

test("with two uncalibrated readings, loss is measured from the first", () => {
  const r = racket();
  const a = restringAdvice({ ...r, readings: [{ t: Date.parse("2026-10-20T20:00:00Z"), hz: 560 }, { t: Date.parse("2026-10-27T20:00:00Z"), hz: 560 * Math.sqrt(0.85) }] }, {}, TODAY);
  assert.equal(a.tension_loss_pct, 15);
});

test("no strung date and no play gives no estimate", () => {
  const a = restringAdvice(racket({ strungOn: null }), {}, TODAY);
  assert.equal(a.status, "unknown");
});

test("your own breaks move the break estimate toward your record", async () => {
  const { personalBreak, restringAdvice, lifeHours } = await import("../public/restring.js");
  const base = { head: 98, gauge: 1.25, material: "poly", pattern: "16x19", strungKg: 23, readings: [] };
  const profile = { level: "4.0", style: "heavy_spin" };
  const expected = lifeHours(base, profile).break;
  assert.deepEqual(personalBreak({ a: { ...base, plays: [], jobs: [] } }, profile), { factor: 1, breaks: 0 });
  // Two sets that broke after a quarter of the expected hours (singles counts 1:1).
  const min = Math.round(expected * 60 / 4);
  const plays = [{ d: "2026-09-02", min, kind: "singles" }, { d: "2026-09-12", min, kind: "singles" }];
  const jobs = [
    { from: "2026-09-01", to: "2026-09-10", reason: "broke", material: "poly", gauge: 1.25, strungKg: 23 },
    { from: "2026-09-10", to: "2026-09-20", reason: "broke", material: "poly", gauge: 1.25, strungKg: 23 },
    { from: "2026-08-01", to: "2026-09-01", reason: "dead", material: "poly", gauge: 1.25, strungKg: 23 }, // not a break
  ];
  const p = personalBreak({ a: { ...base, plays, jobs } }, profile);
  assert.equal(p.breaks, 2);
  assert.ok(Math.abs(p.factor - Math.pow(0.25, 2 / 3)) < 0.01, String(p.factor)); // shrunk toward 1: (1 x 0.25 x 0.25)^(1/3)
  const r = { ...base, strungOn: "2026-10-01", plays: [], jobs };
  const mine = restringAdvice(r, profile, "2026-10-02", p), plain = restringAdvice(r, profile, "2026-10-02");
  assert.ok(Math.abs(mine.expected_hours.break / plain.expected_hours.break - p.factor) < 0.01);
  assert.match(mine.factors.find((f) => f.factor === "break").note, /from your 2 logged breaks/);
  assert.equal(personalBreak({ a: { ...base, plays: [], jobs: [jobs[0]] } }, profile).breaks, 0, "a break with no play logged teaches nothing");
});
