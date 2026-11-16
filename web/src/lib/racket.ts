// One racket's string state for Today and the gear list, from the shared restring model.
import { restringAdvice, personalBreak } from "@models/restring.js"
import { onCurrentStrings } from "@models/stringjobs.js"
import { readingKg } from "@models/tension.js"
import { MAT_NAME, hrs, shortDate } from "./format"
import type { Profile, Racket, Reading } from "./store"

export type Tone = "good" | "warn" | "bad" | "none"
const TONE: Record<string, Tone> = { good: "good", soon: "warn", now: "bad", unknown: "none" }

export interface RacketState { label: string; tone: Tone; left: number | null; minutes: number; line: string }

export function racketState(r: Racket, rackets: Record<string, Racket>, profile: Profile, today: string): RacketState {
  const a = restringAdvice(r, profile, today, personalBreak(rackets, profile))
  const lastJob = (r.jobs || []).slice().sort((x, y) => x.to.localeCompare(y.to)).pop()
  const minutes = onCurrentStrings(r).reduce((s, p) => s + p.min, 0)
  if (!r.strungOn && lastJob?.reason === "broke") return { label: "Broken", tone: "bad", left: 0, minutes, line: `Strings broke on ${shortDate(lastJob.to)}. Mark them restrung when they're replaced.` }
  if (a.status === "unknown") return { label: "Not set up", tone: "none", left: null, minutes, line: "Add the day it was strung to see how much life the strings have left." }
  const left = Math.max(0, Math.min(100, 100 - a.life_used_pct))
  const what = r.stringName || MAT_NAME[r.material] || "these strings"
  const due = a.restring_by && a.status !== "now" ? `restring by ${shortDate(a.restring_by)}` : null
  // Say what is using up the strings, so "0 h but 60% used" doesn't read as a mistake.
  const why = a.reason === "age" ? `strung ${a.days_since_strung} days ago`
    : a.reason === "tension" ? "tension has dropped"
    : a.hours_left ? `about ${a.hours_left} h left` : null
  const line = a.status === "now" ? `${hrs(minutes)} h on ${what}. Time for new strings.`
    : [`${hrs(minutes)} h on ${what}`, why, due].filter(Boolean).join(" · ")
  return { label: a.label, tone: TONE[a.status], left, minutes, line }
}

export const latestReading = (r: Racket): Reading | null => r.readings.slice().sort((x, y) => y.t - x.t)[0] || null
export const kgOf = (x: Reading, r: Racket) => readingKg(x, r)
// The first reading on the current strings (and since the last calibration): the reference for loss %.
export function baseline(r: Racket): Reading | null {
  const since = Math.max(r.strungOn ? Date.parse(r.strungOn + "T00:00:00") : 0, r.calibAt || 0)
  return r.readings.filter((x) => x.t >= since).sort((a, b) => a.t - b.t)[0] || null
}
