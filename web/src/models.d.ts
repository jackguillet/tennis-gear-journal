// Types for the shared models in public/ (plain JavaScript, also used by the current app and the API).
declare module "@models/tension.js" {
  export const LB: number
  export function readingKg(x: { t: number; hz: number; s?: unknown }, r: unknown): number
  export function machineKg(hz: number, r: unknown): number
}
declare module "@models/restring.js" {
  export interface Advice {
    factors: { factor: string; life_used_pct: number; note: string }[]
    status: "now" | "soon" | "good" | "unknown"; label: string; summary: string; life_used_pct: number
    reason: "dead" | "break" | "tension" | "age"; hours_left: number | null; restring_by: string | null; days_since_strung: number | null
  }
  export function restringAdvice(r: unknown, profile: unknown, today?: string, personal?: unknown): Advice
  export function personalBreak(rackets: unknown, profile: unknown): { factor: number; breaks: number }
}
declare module "@models/shoes.js" {
  export function shoeWear(shoe: unknown, rackets: unknown): { hours: number; life: number; used: number; status: "retired" | "now" | "soon" | "good"; label: string; left: number }
  export function currentShoe<T>(shoes: T[]): T | null
}
declare module "@models/stringjobs.js" {
  export const REASON_NAMES: Record<string, string>
  export function onCurrentStrings<P>(r: { plays: P[] }): P[]
  export function minutesBetween(plays: unknown[], from: string | null, to: string | null): number
  export function stringStats(rackets: unknown): { string: string; jobs: number; avgHours: number; minHours: number; maxHours: number; broke: number; dead: number }[]
}
declare module "@models/courts.js" {
  type B = { id: string; start: number; min: number; tz?: string; kind?: string; court?: string | null; location?: string | null; cancelled?: boolean }
  type P = { id: string; dow: number; date: string | null; time: string; min: number; area: string; court: string | null; backups: string | null; paused: boolean; skips: string[] }
  type Day = { date: string; at: number; courts: { c: string; i: number; cells: [number, number, string][] }[] }
  type Win = { days: number }
  export interface Opening { plan: P; date: string; start: number; opensAt: number; booked: boolean; open: boolean }
  export interface Best { court: string; id: number; start: number; minutes: number }
  export type CellState = "open" | "soon" | "taken" | "mine" | "lesson" | "event" | "past" | "closed"
  export interface Grid { courts: { name: string; id: number; area: string; first: boolean }[]; rows: { start: number; cells: { state: CellState; minutes?: number; opensAt?: number }[] }[] }
  export interface Status { state: "paused" | "done" | "booked" | "waitlist" | "soon" | "open" | "unknown" | "taken"; date?: string; start?: number; opensAt?: number; best?: Best }
  export const DEFAULT_TZ: string
  export const DAY_NAMES: string[]
  export const AREA_NAMES: Record<string, string>
  export const AREA_ORDER: string[]
  export const WAITLIST_URL: string
  export const SHEET_URL: string
  export const CANCEL_HOURS: number
  export function planTitle(p: unknown): string
  export function planLink(p: unknown, date: string, court?: string | null): string
  export function bookingTitle(b: unknown): string
  export function cancelBy(b: unknown): number | null
  export function zonedToUtc(date: string, time: string, tz: string): number
  export function localDate(t: number, tz?: string): string
  export function courtArea(name: string | null | undefined): string
  export function planOpenings(plans: P[], win: Win, bookings?: B[], o?: { now?: number; weeks?: number; tz?: string }): Opening[]
  export function gridDay(day: Day | undefined, o?: { areas?: string[]; part?: string; now?: number; days?: number; bookings?: B[]; tz?: string }): Grid
  export function bestCourt(day: Day | undefined, plan: unknown, o?: { within?: number; now?: number; days?: number; tz?: string }): Best | null
  export function bookUrl(courtId: number, date: string, start: number): string
  export function requestStatus(plan: P, o?: { bookings?: B[]; waitlist?: unknown[]; sheet?: Day[]; win?: Win; now?: number; tz?: string }): Status
  export function outdoorCourt(court: string | null | undefined): boolean
  export function outdoorPlan(plan: unknown): boolean
  export function rainAt(forecast: unknown, start: number, min: number, tz?: string): { prob: number; temp: number | null } | null
  export function indoorSwap(sheet: Day[], start: number, o?: { now?: number; days?: number; tz?: string }): Best | null
  export function speedSummary(stats: unknown[], o: { dow: number; time: string; area?: string }): string | null
  export function shareText(b: unknown, tz?: string): string
  export function toIcs(bookings: unknown[], o?: { name?: string; method?: string }): string
  export function forecastUrl(): string
}
