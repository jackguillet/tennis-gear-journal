import { test } from "node:test";
import assert from "node:assert/strict";
import { minutesBetween, currentJob, stringStats } from "../public/stringjobs.js";

const plays = [{ d: "2026-09-30", min: 60 }, { d: "2026-10-01", min: 90 }, { d: "2026-10-10", min: 60 }, { d: "2026-10-11", min: 30 }];

test("a job's hours run from the day it went in to the day before it came out", () => {
  assert.equal(minutesBetween(plays, "2026-10-01", "2026-10-11"), 150);
  assert.equal(minutesBetween(plays, "2026-10-11", null), 30); // restring day counts toward the new strings
});

test("the current strings become a job only when their Strung on date is known", () => {
  const r = { strungOn: "2026-10-01", stringName: "ALU Power", material: "poly", gauge: 1.25, strungKg: 22.7 };
  assert.deepEqual(currentJob(r, "j1", "2026-10-11", "broke"), { id: "j1", from: "2026-10-01", to: "2026-10-11", reason: "broke", stringName: "ALU Power", material: "poly", gauge: 1.25, strungKg: 22.7 });
  assert.equal(currentJob({ ...r, strungOn: null }, "j1", "2026-10-11", "broke"), null);
});

test("strings are compared across rackets, longest-lasting first", () => {
  const rackets = {
    a: { plays, jobs: [{ from: "2026-10-01", to: "2026-10-11", reason: "broke", stringName: "ALU Power", material: "poly", gauge: 1.25 }] },
    b: { plays: [{ d: "2026-09-02", min: 600 }], jobs: [
      { from: "2026-09-01", to: "2026-09-20", reason: "dead", stringName: "alu power ", material: "poly", gauge: 1.25 },
      { from: "2026-09-20", to: "2026-09-21", reason: "routine", stringName: "", material: "multi", gauge: 1.3 },
    ] },
  };
  assert.deepEqual(stringStats(rackets), [
    { string: "ALU Power 1.25 mm", jobs: 2, avgHours: 6.3, minHours: 2.5, maxHours: 10, broke: 1, dead: 1 },
    { string: "Unnamed multi 1.30 mm", jobs: 1, avgHours: 0, minHours: 0, maxHours: 0, broke: 0, dead: 0 },
  ]);
});
