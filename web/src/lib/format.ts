// Words and numbers as the app says them: 1 h 30, Wed, Nov 18, 22.7 kg or 50.0 lb.
import { LB } from "@models/tension.js"
import type { PlayKind, Prefs } from "./store"

export const KINDS: [PlayKind, string][] = [["singles", "Singles"], ["doubles", "Doubles"], ["hitting", "Hitting"], ["drills", "Lesson / drills"], ["ball_machine", "Ball machine"], ["serves", "Serves"]]
export const KIND_NAME = Object.fromEntries(KINDS) as Record<PlayKind, string>
export const DURS: [number, string][] = [[30, "30 min"], [45, "45 min"], [60, "1 h"], [90, "1 h 30"], [120, "2 h"], [180, "3 h"]]
export const MAT_NAME: Record<string, string> = { poly: "Polyester", multi: "Multifilament", syngut: "Synthetic gut", gut: "Natural gut", hybrid: "Hybrid", kevlar: "Aramid" }

export const dur = (min: number) => min < 60 ? min + " min" : Math.floor(min / 60) + " h" + (min % 60 ? " " + String(min % 60).padStart(2, "0") : "")
export const hrs = (min: number) => String(Math.round(min / 6) / 10)
export const today = () => new Date().toLocaleDateString("en-CA")
const noon = (d: string) => new Date(d + "T12:00:00")
export const shortDate = (d: string) => noon(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.slice(0, 4) === today().slice(0, 4) ? undefined : "numeric" })
export const dayName = (d: string) => noon(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
export function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) === 1 ? "yesterday" : Math.round(m / 1440) + " days ago"
}

// Pounds in the countries that string in pounds, kilograms elsewhere, until the player picks.
const LB_REGIONS = new Set(["US", "LR", "MM", "PR"])
export function unitFor(prefs: Prefs): "kg" | "lb" {
  if (prefs.unit === "kg" || prefs.unit === "lb") return prefs.unit
  try { return LB_REGIONS.has(new Intl.Locale(navigator.language).maximize().region || "") ? "lb" : "kg" } catch { return "kg" }
}
export const weight = (kg: number, unit: "kg" | "lb") => (unit === "kg" ? kg : kg * LB).toFixed(1)
