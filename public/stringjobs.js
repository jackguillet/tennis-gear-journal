// String jobs: every set of strings a racket has had. Shared by the page (public/index.html) and
// the chat connector (lib/assistant.js).
//
// The racket itself holds the current strings (strungOn, stringName, material, gauge, strungKg).
// When it is restrung, those go into a job record with the day they came out and why, and the
// racket takes the new strings. Hours on a job are counted from the play log: sessions on or after
// the day it was strung and before the day it came out (a session on restring day counts toward
// the new strings, as it does in the rest of the app).

export const REASONS = ["broke", "dead", "routine"];
export const REASON_NAMES = { broke: "broke", dead: "went dead", routine: "routine restring" };

// The day the strings in the racket now count from: Strung on, or, with no date (for example after
// "Strings broke"), the day the last set came out, so older play isn't counted again. Null when unknown.
export function currentSince(r) {
  if (r.strungOn) return r.strungOn;
  const ends = (r.jobs || []).map((j) => j.to).sort();
  return ends.length ? ends[ends.length - 1] : null;
}
export const onCurrentStrings = (r) => { const since = currentSince(r); return (r.plays || []).filter((p) => !since || p.d >= since); };

// Minutes played on strings in place from `from` (YYYY-MM-DD) up to, not including, `to` (null = still in).
export function minutesBetween(plays, from, to) {
  return (plays || []).filter((p) => (!from || p.d >= from) && (!to || p.d < to)).reduce((a, p) => a + p.min, 0);
}

// The job record for the strings in the racket now, ended on `endedOn` for `reason`.
// Null when nothing is known about them (no Strung on date).
export function currentJob(r, id, endedOn, reason) {
  if (!r.strungOn) return null;
  return {
    id, from: r.strungOn, to: endedOn < r.strungOn ? r.strungOn : endedOn, reason,
    stringName: r.stringName || null, material: r.material, gauge: r.gauge, strungKg: r.strungKg ?? null,
  };
}

// Groups past jobs from every racket by string, so a player can see which string lasts.
// Returns [{ string, jobs, avgHours, minHours, maxHours, broke, dead }], longest-lasting first.
export function stringStats(rackets) {
  const by = new Map();
  for (const r of Object.values(rackets || {})) {
    for (const j of r.jobs || []) {
      const name = (j.stringName || "").trim() || `Unnamed ${j.material}`;
      const key = name.toLowerCase() + "|" + j.gauge;
      const hours = minutesBetween(r.plays, j.from, j.to) / 60;
      const s = by.get(key) || { string: name + " " + Number(j.gauge).toFixed(2) + " mm", hours: [], broke: 0, dead: 0 };
      s.hours.push(hours);
      if (j.reason === "broke") s.broke++;
      if (j.reason === "dead") s.dead++;
      by.set(key, s);
    }
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  return [...by.values()].map((s) => ({
    string: s.string, jobs: s.hours.length,
    avgHours: r1(s.hours.reduce((a, b) => a + b, 0) / s.hours.length),
    minHours: r1(Math.min(...s.hours)), maxHours: r1(Math.max(...s.hours)),
    broke: s.broke, dead: s.dead,
  })).sort((a, b) => b.avgHours - a.avgHours);
}
