// When to restring. Shared by the page (public/index.html) and the chat connector
// (lib/assistant.js), so both give the same answer.
//
// Strings are done for one of four reasons, and the app watches all four:
//   1. They go dead: they lose resilience ("snapback") and control well before they break.
//      Polyester goes first (players report 2-20 hours, TWU "Strings going dead"); nylon,
//      multifilament and gut keep their playability far longer.
//   2. They are about to break: strings rub on each other and notch. Thin gauges, open patterns,
//      big heads, low tension, heavy spin and harder hitting all speed this up (more string
//      movement), while polyester and aramid resist it best.
//   3. They have lost tension: a measured drop from fresh means a looser, less controlled bed.
//   4. They are old: strings lose tension and elasticity just sitting in the bag. Polyester
//      should be cut out "at least every couple of months" even when barely used.
// Each one is turned into a share of the strings' life used up, and the largest one decides.
//
// Sources: Cross & Bower (Sports Engineering 2001) and TWU's dead-string and tension-loss tests
// for how fast each material relaxes; USRSA and TWU guidance on gauge, pattern and spin for
// breakage. The hour figures below are typical values for a 4.0 player with moderate topspin,
// not lab constants: the trend from your own readings, when you have them, outranks them.
import { readingKg } from "./tension.js";

// Hours of play before the strings stop playing like new (reference player).
export const PLAY_LIFE = { poly: 15, kevlar: 15, hybrid: 22, multi: 25, syngut: 25, gut: 35 };
// Hours before a likely break at 1.25 mm, 16x19, 100 sq in, 23 kg (about 50 lb).
export const BREAK_LIFE = { poly: 70, kevlar: 90, hybrid: 40, multi: 25, syngut: 30, gut: 20 };
// Drop from fresh tension (stringing-machine terms) that marks a bed as worn.
export const LOSS_LIMIT = { poly: 0.25, kevlar: 0.25, hybrid: 0.22, multi: 0.2, syngut: 0.2, gut: 0.15 };
// Days before age alone says restring.
export const SHELF_DAYS = { poly: 60, kevlar: 75, hybrid: 90, multi: 120, syngut: 120, gut: 150 };

// How hard an hour of each kind of play is on strings, compared with singles.
export const INTENSITY = { singles: 1, doubles: 0.7, hitting: 1.1, drills: 1.2, ball_machine: 1.25, serves: 0.8 };
// Harder hitters wear strings faster and notice dead strings sooner.
export const LEVEL_FACTOR = { "2.0": 1.6, "2.5": 1.45, "3.0": 1.3, "3.5": 1.15, "4.0": 1, "4.5": 0.9, "5.0": 0.8, "5.5": 0.75, "6.0": 0.7, "7.0": 0.6 };
// Spin moves the mains across the crosses: the main cause of notching and of poly losing snapback.
export const STYLE_PLAY = { heavy_spin: 0.85, moderate_spin: 1, flat: 1.1, all_court: 1.05, serve_volley: 1.1, counter: 1 };
export const STYLE_BREAK = { heavy_spin: 0.55, moderate_spin: 1, flat: 1.4, all_court: 1.15, serve_volley: 1.3, counter: 1.1 };
// Open patterns let strings slide more; dense ones last longer.
export const PATTERN_BREAK = { "16x18": 0.85, "16x19": 1, "18x19": 1.15, "18x20": 1.3 };

const MATERIAL_NAME = { poly: "polyester", kevlar: "aramid", hybrid: "hybrid", multi: "multifilament", syngut: "synthetic gut", gut: "natural gut" };
const DAY = 864e5;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
const dayNum = (d) => Date.parse(d + "T00:00:00Z") / DAY;
const addDays = (d, n) => new Date((dayNum(d) + n) * DAY).toISOString().slice(0, 10);

// Hours of play each component allows, for this racket and player.
export function lifeHours(r, profile = {}) {
  const m = PLAY_LIFE[r.material] ? r.material : "poly";
  const level = LEVEL_FACTOR[profile.level] || 1;
  const play = PLAY_LIFE[m] * level * (STYLE_PLAY[profile.style] || 1);
  const gauge = Math.pow((r.gauge || 1.25) / 1.25, 2);                   // cross-section left to wear through
  const head = 100 / clamp(r.head || 100, 85, 125);                      // longer strings move more
  const tension = r.strungKg ? clamp(Math.sqrt(r.strungKg / 23), 0.85, 1.15) : 1; // looser beds move more
  const brk = BREAK_LIFE[m] * gauge * (PATTERN_BREAK[r.pattern] || 1) * head * tension * level * (STYLE_BREAK[profile.style] || 1);
  return { play, break: brk };
}

// Measured tension loss since these strings went in, or null when there is nothing to compare.
export function tensionLoss(r) {
  const since = r.strungOn ? dayNum(r.strungOn) * DAY : -Infinity;
  const rs = (r.readings || []).filter((x) => x.t >= since).sort((a, b) => a.t - b.t);
  if (!rs.length) return null;
  const last = rs[rs.length - 1], lastKg = readingKg(last, r);
  const m = LOSS_LIMIT[r.material] ? r.material : "poly";
  let base, from, limit = LOSS_LIMIT[m];
  const calibrated = r.calib && r.calib !== 1 && r.calibAt && r.calibAt >= since;
  if (r.strungKg && calibrated) { base = r.strungKg; from = "strung"; }
  else if (rs.length >= 2) {
    base = readingKg(rs[0], r); from = "first";
    // The first day takes most of the early drop; a later first reading has already lost it.
    if (r.strungOn && rs[0].t - since > 2 * DAY) limit -= 0.05;
  } else if (r.strungKg) { base = r.strungKg; from = "strung"; limit += 0.05; } // uncalibrated estimate: allow for its error
  else return null;
  const loss = 1 - lastKg / base;
  return { loss: Math.max(0, loss), limit, baseKg: base, lastKg, from, at: last.t, estimate: !calibrated };
}

// The advice for one racket. `today` is YYYY-MM-DD in the player's time zone.
export function restringAdvice(r, profile = {}, today = new Date().toISOString().slice(0, 10)) {
  const m = PLAY_LIFE[r.material] ? r.material : "poly";
  const plays = (r.plays || []).filter((p) => !r.strungOn || p.d >= r.strungOn);
  const minutes = plays.reduce((a, p) => a + p.min, 0);
  const effHours = plays.reduce((a, p) => a + p.min * (INTENSITY[p.kind] || 1), 0) / 60;
  const life = lifeHours(r, profile);
  const loss = tensionLoss(r);
  const age = r.strungOn ? Math.max(0, dayNum(today) - dayNum(r.strungOn)) : null;

  const parts = [
    { key: "dead", used: effHours / life.play, text: `${MATERIAL_NAME[m]} goes dead after about ${Math.round(life.play)} h for your game` },
    { key: "break", used: effHours / life.break, text: `likely to break after about ${Math.round(life.break)} h (gauge, pattern, spin)` },
  ];
  if (loss) parts.push({ key: "tension", used: loss.loss / loss.limit, text: `tension down ${Math.round(loss.loss * 100)}% from ${loss.from === "strung" ? "the tension you strung at" : "your first reading"} (restring at about ${Math.round(loss.limit * 100)}%)` });
  if (age !== null) parts.push({ key: "age", used: age / SHELF_DAYS[m], text: `${age} days old (${MATERIAL_NAME[m]} goes stale after about ${SHELF_DAYS[m]} days even unplayed)` });
  parts.sort((a, b) => b.used - a.used);
  const main = parts[0];
  const used = main.used;
  const status = !r.strungOn && !plays.length && !loss ? "unknown" : used >= 1 ? "now" : used >= 0.75 ? "soon" : "good";

  // When: play hours left at the recent pace (last 4 weeks), or the age limit, whichever is first.
  const hoursLeft = Math.max(0, Math.min(life.play, life.break) - effHours);
  const window = Math.max(7, Math.min(28, age ?? 28));
  const recent = plays.filter((p) => dayNum(p.d) > dayNum(today) - window).reduce((a, p) => a + p.min * (INTENSITY[p.kind] || 1), 0) / 60;
  const perDay = recent / window;
  const byPlay = perDay > 0 ? hoursLeft / perDay : Infinity;
  const byAge = age !== null ? SHELF_DAYS[m] - age : Infinity;
  let byTension = Infinity;
  if (loss && loss.loss > 0.02 && r.strungOn) {
    // Tension falls fast at first and then slowly (roughly with log time), so a straight-line
    // projection would be too early; only use it once it is close.
    if (loss.loss / loss.limit >= 0.8 && age > 0) byTension = Math.max(0, (loss.limit - loss.loss) / (loss.loss / age));
  }
  const daysLeft = status === "now" ? 0 : Math.min(byPlay, byAge, byTension);
  const dueBy = Number.isFinite(daysLeft) ? addDays(today, Math.ceil(daysLeft)) : null;

  const label = { now: "Restring now", soon: "Restring soon", good: "Strings are fine", unknown: "Set Strung on" }[status];
  let summary;
  if (status === "unknown") summary = "Set the Strung on date (and log play) to get a restring estimate.";
  else if (status === "now") summary = `${label}: ${main.text}.`;
  else summary = `${label}: about ${Math.round((1 - used) * 100)}% of their life left` + (Number.isFinite(hoursLeft) && main.key !== "age" && main.key !== "tension" ? ` (about ${r1(hoursLeft)} h of play)` : "") + (dueBy ? `, restring by about ${dueBy}` : "") + `. Closest limit: ${main.text}.`;

  return {
    status, label, summary,
    life_used_pct: Math.round(used * 100),
    reason: main.key,
    hours_on_strings: r1(minutes / 60),
    weighted_hours: r1(effHours),
    hours_left: status === "unknown" ? null : r1(hoursLeft),
    restring_by: dueBy,
    days_since_strung: age,
    tension_loss_pct: loss ? Math.round(loss.loss * 100) : null,
    tension_limit_pct: loss ? Math.round(loss.limit * 100) : null,
    expected_hours: { dead: r1(life.play), break: r1(life.break) },
    factors: parts.map((p) => ({ factor: p.key, life_used_pct: Math.round(p.used * 100), note: p.text })),
  };
}
