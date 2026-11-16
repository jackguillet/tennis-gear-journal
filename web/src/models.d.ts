// Types for the shared models in public/ (plain JavaScript, also used by the current app and the API).
declare module "@models/tension.js" {
  export const LB: number
  export function readingKg(x: { t: number; hz: number; s?: unknown }, r: unknown): number
}
declare module "@models/restring.js" {
  export interface Advice {
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
  export function onCurrentStrings<P>(r: { plays: P[] }): P[]
}
declare module "@models/courts.js" {
  export const DEFAULT_TZ: string
  export function planTitle(p: unknown): string
}
