import test from "node:test";
import assert from "node:assert/strict";
import { bedKg, machineKg, tensionKg, readingKg, oldModelKg, snap, analyseRecording, MODEL_2_AT, G } from "../public/tension.js";

// Published check: Cross & Bower, "Measurements of string tension in a tennis racket",
// Sports Engineering 4 (2001). Load cell inside a strung racket vs the bed's pitch.
test("bed tension matches Cross & Bower's load-cell measurement", () => {
  // 1.30 mm polyester, 595 cm^2 head, 622 Hz; load cell read 17.24 kg per string.
  const r = { head: 595 / 6.4516, gauge: 1.30, material: "poly", pattern: "16x19" };
  const kg = bedKg(622, r);
  assert.ok(Math.abs(kg / 17.24 - 1) < 0.04, `got ${kg.toFixed(2)} kg`);
});

test("nylon rackets from the same paper land near their pull tension", () => {
  // Volkl, 630 cm^2, 1.42 mm nylon. Pull tension -> measured pitch (Table 1).
  const r = { head: 630 / 6.4516, gauge: 1.42, material: "multi", pattern: "16x19" };
  for (const [pull, hz] of [[18.0, 504], [21.0, 549], [23.0, 565], [25.2, 599], [28.4, 645]]) {
    const est = machineKg(hz, r);
    assert.ok(Math.abs(est / pull - 1) < 0.08, `${hz} Hz -> ${est.toFixed(1)} kg, strung at ${pull}`);
  }
});

test("a fresh 98 sq in poly bed at 50 lb rings in the expected range", () => {
  const r = { head: 98, gauge: 1.25, material: "poly", pattern: "16x19" };
  const hz = Math.sqrt(22.7 / machineKg(1, r));
  assert.ok(hz > 500 && hz < 620, `${hz.toFixed(0)} Hz`);
});

test("a calibration saved on the old formula keeps reading the same", () => {
  const r = { head: 98, gauge: 1.25, material: "poly", pattern: "18x20", calib: 0.9, calibAt: MODEL_2_AT - 864e5 };
  const before = oldModelKg(540, r) * 0.9;
  assert.ok(Math.abs(tensionKg(540, r) - before) < 1e-9);
  // and old readings that carry that calibration too
  const x = { t: MODEL_2_AT - 3600e3, hz: 540, s: { head: 98, gauge: 1.25, material: "poly", pattern: "18x20", calib: 0.9 } };
  assert.ok(Math.abs(readingKg(x, r) - before) < 1e-9);
  // a reading saved now stores the converted factor, so it reads the same too
  const y = { t: MODEL_2_AT + 3600e3, hz: 540, s: snap(r) };
  assert.ok(Math.abs(readingKg(y, r) - before) < 1e-3);
  // a calibration made with the new formula is used as is
  const n = { ...r, calib: 1.1, calibAt: MODEL_2_AT + 1 };
  assert.ok(Math.abs(tensionKg(540, n) - machineKg(540, n) * 1.1) < 1e-9);
});

// ---------- pitch ----------
function tap({ f = 540, sr = 48000, amp = 0.3, taps = [0.3, 1.1, 1.9], overtone = 0, thump = 0, noise = 0.001, tau = 0.08, odd = [] } = {}) {
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const x = new Float32Array(Math.round(sr * 2.6));
  for (let i = 0; i < x.length; i++) x[i] = noise * rnd();
  taps.forEach((t0, k) => {
    const fk = odd.includes(k) ? f * 1.12 : f, i0 = Math.round(t0 * sr);
    let lp = 0;
    for (let i = 0; i < 0.6 * sr && i0 + i < x.length; i++) {
      const t = i / sr;
      let v = Math.exp(-t / tau) * Math.sin(2 * Math.PI * fk * t) + overtone * Math.exp(-t / tau) * Math.sin(2 * Math.PI * fk * 1.49 * t);
      if (t < 0.015) { lp = lp * 0.9 + rnd() * 0.2; v += thump * lp; }    // the thud of a palm
      x[i0 + i] += amp * v;
    }
  });
  for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i]));
  return x;
}

test("finds the pitch of clean taps to within 0.2%", () => {
  for (const f of [300, 420, 540, 690, 850]) {
    const r = analyseRecording(tap({ f }), 48000);
    assert.ok(!r.error, r.error);
    assert.equal(r.taps, 3);
    assert.ok(Math.abs(r.hz / f - 1) < 0.002, `${f} -> ${r.hz}`);
  }
});

test("an off-centre tap whose overtone is louder still reads the fundamental", () => {
  const r = analyseRecording(tap({ f: 520, overtone: 1.6 }), 48000);
  assert.ok(Math.abs(r.hz / 520 - 1) < 0.003, `${r.hz}`);
});

test("a quiet fingertip tap is still heard", () => {
  const r = analyseRecording(tap({ amp: 0.002, noise: 0.0008 }), 48000);
  assert.ok(!r.error, r.error);
  assert.ok(Math.abs(r.hz / 540 - 1) < 0.003, `${r.hz}`);
});

test("a hard palm tap that clips still reads right and asks for more distance", () => {
  const r = analyseRecording(tap({ amp: 2.5, thump: 4 }), 48000);
  assert.ok(Math.abs(r.hz / 540 - 1) < 0.003, `${r.hz}`);
  assert.equal(r.clipped, true);
});

test("a stray tap at a different pitch is left out of the median", () => {
  const r = analyseRecording(tap({ taps: [0.2, 0.8, 1.4, 2.0], odd: [1] }), 48000);
  assert.equal(r.taps, 3);
  assert.equal(r.dropped, 1);
  assert.ok(Math.abs(r.hz / 540 - 1) < 0.002);
});

test("silence is reported, not read", () => {
  const r = analyseRecording(new Float32Array(48000), 48000);
  assert.ok(r.error);
});

test("units line up: bed kg times g is newtons", () => {
  const r = { head: 100, gauge: 1.25, material: "poly", pattern: "16x19" };
  assert.ok(bedKg(500, r) * G > 50 && bedKg(500, r) * G < 200);
});
