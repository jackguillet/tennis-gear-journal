// Stringbed Meter: pitch of a tapped string bed -> tension. Shared by the page (public/index.html)
// and the chat connector (lib/assistant.js), so both always read the same number.
//
// Physics. A string bed rings like a drum skin. For an oval bed of area A, strings with mass per
// metre mu and tension T (each string), the fundamental f gives
//     T = K_BED * mu * A * f^2
// K_BED = 8 * pi^2 / lambda1, where lambda1 * A is the first eigenvalue of a clamped ellipse.
// For a head 1.28 times longer than wide that is 18.67, so K_BED = 4.23 (a circle gives 4.35, a
// square 4.00). Cross & Bower (Sports Engineering, 2001) checked this against a load cell in a
// strung racket: 622 Hz on a 595 cm^2 polyester bed gave 17.2 kg per string on the load cell,
// which is K = 4.24. Their nylon rackets (630 cm^2, 1.80 g/m) also fit: 565 Hz -> about 15 kg.
//
// That is the tension left in the strung racket ("string-bed tension", what RacquetTune shows).
// It is well below the tension set on the stringing machine: Cross & Bower measured about 30%
// less for nylon and 40% less for polyester straight after stringing. To give a number in the
// same terms you ask your stringer for, the app divides by the share that is typically left
// (SETTLE). Calibrating a racket replaces that typical share with the real one.

export const G = 9.80665;
export const LB = 2.20462;
export const SQIN = 6.4516e-4; // m^2 per square inch

// String density in kg/m^3 (Cross: nylon 1.14, polyester and gut about 1.34 g/cm^3;
// Cross & Bower's 1.30 mm polyester weighed 1.80 g/m, which is 1.36).
export const DENSITY = { poly: 1360, multi: 1140, syngut: 1140, gut: 1300, hybrid: 1250, kevlar: 1440 };
// A strung string is about 3-4% longer than off the reel, so it is lighter per metre
// (Cross & Bower corrected their polyester by 3.8%).
export const STRETCH = 0.965;
export const K_BED = 4.23;
// Share of the machine tension still in the bed right after stringing. Nylon and polyester are
// Cross & Bower's measurements; the others are estimates between the two.
export const SETTLE = { poly: 0.60, multi: 0.70, syngut: 0.70, gut: 0.70, hybrid: 0.65, kevlar: 0.65 };

export const massPerMetre = r => (DENSITY[r.material] || DENSITY.poly) * Math.PI * Math.pow(r.gauge / 2000, 2) * STRETCH;
// Tension in each string of the strung racket, in kg.
export const bedKg = (hz, r) => K_BED * massPerMetre(r) * r.head * SQIN * hz * hz / G;
// The same bed in stringing-machine terms, before calibration.
export const machineKg = (hz, r) => bedKg(hz, r) / (SETTLE[r.material] || SETTLE.poly);

// Before 28 Oct 2026 the app used a rougher formula, and calibrations were saved as a factor on
// it. Those are converted so a calibrated racket keeps reading what it read before.
export const MODEL_2_AT = Date.parse("2026-10-28T00:00:00Z");
const OLD_PATTERN = { "16x19": 1, "18x20": 1.06, "16x18": 0.98, "18x19": 1.03 };
export function oldModelKg(hz, r) {
  const area = r.head * SQIN, b = Math.sqrt(area / (Math.PI * 1.28)), a = 1.28 * b;
  const oldDensity = { poly: 1380, multi: 1140, syngut: 1140, gut: 1300, hybrid: 1260, kevlar: 1440 };
  const mu = (oldDensity[r.material] || 1380) * Math.PI * Math.pow(r.gauge / 2000, 2), pat = OLD_PATTERN[r.pattern] || 1;
  return 1.55 * 8 * mu * hz * hz / (1 / (4 * a * a) + 1 / (4 * b * b)) / (pat * pat) / G;
}
// A calibration factor made at time `t`, expressed on the current formula.
export function calibNow(calib, t, setup) {
  if (!calib || calib === 1) return 1;
  return t != null && t >= MODEL_2_AT ? calib : calib * oldModelKg(1, setup) / machineKg(1, setup);
}
// The racket's own calibration, on the current formula.
export const racketCalib = r => calibNow(r.calib, r.calibAt, r);
export const tensionKg = (hz, r) => machineKg(hz, r) * racketCalib(r);
// A saved reading keeps the setup (and calibration) it was taken with, so a restring or a new
// calibration never rewrites old history.
export const snap = r => ({ head: r.head, gauge: r.gauge, material: r.material, pattern: r.pattern, calib: +racketCalib(r).toFixed(5) });
export function readingKg(x, r) {
  if (!x.s) return tensionKg(x.hz, r);
  const s = { ...r, ...x.s };
  return machineKg(x.hz, s) * calibNow(x.s.calib, x.t, s);
}
export const readingBedKg = (x, r) => bedKg(x.hz, x.s ? { ...r, ...x.s } : r);

// ---------- pitch ----------
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Search band. A 85-125 sq in bed strung 15-35 kg rings at roughly 330-800 Hz; the margin covers
// worn-out and very tight beds. The racket frame's own modes sit lower (about 100-200 Hz).
export const LO = 280, HI = 1000;

// Band-pass (RBJ biquad) used only to find taps: it ignores rumble, handling noise and the thud
// of a palm, so a quiet ring still stands out. Returns a stateful filter for live use.
export function bandpass(sr, f0 = 560, q = 0.8) {
  const w = 2 * Math.PI * f0 / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return v => { const y = b0 * v + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; return y; };
}

// Analyse one tap whose ring starts at sample `start`.
export function analyseTap(x, sr, start, end) {
  const s = start + Math.round(0.010 * sr);             // skip the knock of the impact itself
  const len = Math.min(Math.round(0.25 * sr), (end || x.length) - s - Math.round(0.005 * sr));
  if (len < 0.05 * sr) return null;
  const N = 32768;
  const re = new Float64Array(N), im = new Float64Array(N);
  // The ring is loudest at the start and dies away, so the window opens fast (4 ms) and closes
  // slowly. A symmetric (Hann) window would throw away the loudest part of the ring.
  const rise = Math.round(0.004 * sr);
  for (let i = 0; i < len; i++) {
    const up = i < rise ? 0.5 - 0.5 * Math.cos(Math.PI * i / rise) : 1;
    const down = Math.cos(0.5 * Math.PI * i / len);
    re[i] = x[s + i] * up * down * down;
  }
  fft(re, im);
  const binHz = sr / N, b0 = Math.floor(LO / binHz), b1 = Math.ceil(HI / binHz);
  const mag = new Float64Array(b1 - b0 + 1);
  let top = 0;
  for (let k = b0; k <= b1; k++) { mag[k - b0] = Math.hypot(re[k], im[k]); if (mag[k - b0] > mag[top]) top = k - b0; }
  const sorted = Array.from(mag).sort((p, q) => p - q), median = sorted[sorted.length >> 1] || 1e-12;
  // The bed's higher modes ring 1.5x, 1.7x and 2x above the fundamental, and an off-centre tap can
  // make one of them the loudest. So take the lowest clear peak, not simply the loudest.
  let best = top;
  for (let i = 2; i < top; i++) {
    if (mag[i] >= mag[i - 1] && mag[i] > mag[i + 1] && mag[i] >= 0.35 * mag[top] && mag[i] > 10 * median
        && mag[i] >= Math.max(...mag.subarray(Math.max(0, i - 20), i + 21))) { best = i; break; }
  }
  const clarity = mag[best] / median;
  let off = 0;
  if (best > 0 && best < mag.length - 1) {
    const l = Math.log(mag[best - 1] + 1e-12), c = Math.log(mag[best] + 1e-12), r = Math.log(mag[best + 1] + 1e-12);
    off = 0.5 * (l - r) / (l - 2 * c + r || 1);
  }
  return { hz: (b0 + best + off) * binHz, clarity, mag, binHz, b0 };
}

// Find every tap in a recording and return the median result.
export function analyseRecording(x, sr) {
  const bp = bandpass(sr), hop = Math.round(0.005 * sr), env = [];
  let rawPeak = 0, clipped = 0;
  for (let i = 0; i + hop <= x.length; i += hop) {
    let m = 0;
    for (let j = i; j < i + hop; j++) {
      const a = Math.abs(x[j]); if (a > rawPeak) rawPeak = a; if (a > 0.985) clipped++;
      m = Math.max(m, Math.abs(bp(x[j])));
    }
    env.push(m);
  }
  if (!env.length) return { error: "The recording is too short. Record 3 or 4 taps." };
  const peak = Math.max(...env);
  const floor = env.slice().sort((p, q) => p - q)[Math.floor(env.length * 0.2)] || 0;
  if (rawPeak < 0.0005 || peak < 0.0004) return { error: "The recording is almost silent. Check the microphone is allowed, hold the phone's bottom edge 10–20 cm from the strings and tap firmly." };
  const taps = [], gap = Math.round(0.2 * sr / hop), thr = Math.max(peak * 0.12, floor * 5);
  for (let i = 1; i < env.length; i++) {
    if (env[i] > thr && env[i] > env[i - 1] * 1.5 && (!taps.length || i - taps[taps.length - 1] > gap)) taps.push(i);
  }
  if (!taps.length) taps.push(env.indexOf(peak));
  // a tap's ring starts a little before the band-passed envelope peaks
  const res = taps.map((t, k) => analyseTap(x, sr, Math.max(0, (t - 1) * hop), k + 1 < taps.length ? (taps[k + 1] - 1) * hop : x.length))
    .filter(r => r && r.clarity > 6);
  if (!res.length) {
    const quiet = peak < floor * 8 || peak < 0.003;
    return { error: quiet
      ? "The tap was too quiet to hear over the room. Tap firmly with the heel of your palm and hold the phone's bottom edge closer."
      : "No clear ring found. Tap the centre of the strings, not the frame, and let go straight away so the strings can ring." };
  }
  res.sort((p, q) => p.hz - q.hz);
  let mid = res[res.length >> 1];
  // drop taps more than 4% off the median (a frame hit, a double tap) before taking the median
  const kept = res.filter(r => Math.abs(r.hz / mid.hz - 1) <= 0.04);
  mid = kept[kept.length >> 1];
  const spread = kept.length > 1 ? (kept[kept.length - 1].hz - kept[0].hz) / mid.hz : 0;
  return { ...mid, taps: kept.length, dropped: res.length - kept.length, spread, clipped: clipped > 3, quiet: peak < floor * 20 };
}
