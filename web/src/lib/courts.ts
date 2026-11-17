// Courts: one list of what's coming up (bookings and requests together) and the club-clock words for it.
import { useEffect, useState } from "react"
import { DEFAULT_TZ, forecastUrl, planOpenings, requestStatus, type Status } from "@models/courts.js"
import { localDate } from "@models/courts.js"
import type { Booking, Plan, State } from "./store"

export const TZ = DEFAULT_TZ
export const toMinutes = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5)
export const clockMin = (m: number) => { const h = Math.floor(m / 60) % 24, mi = m % 60; return ((h % 12) || 12) + (mi ? ":" + String(mi).padStart(2, "0") : "") + (h < 12 ? " am" : " pm") }
export const addDay = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
export const clubToday = (now = Date.now()) => localDate(now, TZ)
export const ct = (court: string) => court.replace(/^Court\s*/i, "Ct ")
// "Sat, Nov 21", "6:30 pm", and "Tue 7:15 pm" (weekday only when it isn't within a day).
export const whenDay = (t: number, tz = TZ) => new Date(t).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" })
export const whenTime = (t: number, tz = TZ) => new Date(t).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).toLowerCase()
export const soonAt = (t: number, now = Date.now()) => (t - now > 864e5 ? new Date(t).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" }) + " " : "") + whenTime(t)
export const dateLabel = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
export const AREA_LABEL: Record<string, string> = { indoor: "Indoor", outdoor: "Outdoor", clay: "Pro & clay" }
export const COURTS: [string, number[]][] = [["Indoor", [14, 15, 16, 17, 18, 19]], ["Outdoor", [1, 2, 3, 4, 5, 6, 7, 8]], ["Pro & clay", [9, 10, 11, 12, 13]]]

// One row of "Coming up": a booking (with the weekly request it fills, if any) or a request not booked yet.
export type Row =
  | { type: "booking"; start: number; booking: Booking; plan: Plan | null; next: { start: number; opensAt: number } | null }
  | { type: "request"; start: number; plan: Plan; status: Status }

// Every booking still to come, and every request once: at its next date when that isn't booked yet, or on
// the booking that fills it (with when the week after opens). Paused and finished requests go last.
export function comingUpRows(s: Pick<State, "bookings" | "plans" | "waitlist" | "courtSheet" | "window">, now = Date.now()): { rows: Row[]; resting: Row[] } {
  const live = s.bookings.filter((b) => !b.cancelled && b.start + b.min * 60000 > now)
  const rows: Row[] = live.map((b) => ({ type: "booking", start: b.start, booking: b, plan: null, next: null }))
  const resting: Row[] = []
  const first = clubToday(now)
  for (const p of s.plans) {
    if (p.date && p.date < first) continue
    const status = requestStatus(p, { bookings: s.bookings, waitlist: s.waitlist, sheet: s.courtSheet, win: s.window, now, tz: TZ })
    if (status.state === "booked") {
      const row = rows.find((r) => r.type === "booking" && !r.plan && Math.abs(r.booking.start - (status.start || 0)) <= 90 * 60000)
      if (row && row.type === "booking") {
        row.plan = p
        if (!p.date) {
          const o = planOpenings([p], s.window, s.bookings, { now, weeks: 3, tz: TZ }).find((x) => !x.booked)
          row.next = o ? { start: o.start, opensAt: o.opensAt } : null
        }
        continue
      }
    }
    if (status.state === "paused" || status.state === "done" || !status.start) resting.push({ type: "request", start: Infinity, plan: p, status })
    else rows.push({ type: "request", start: status.start, plan: p, status })
  }
  rows.sort((a, b) => a.start - b.start)
  return { rows, resting }
}

// "Every week · Court 15 · with Marc" for a request.
export function planWhere(p: Plan) {
  const where = p.court || (p.area && p.area !== "any" ? { indoor: "Indoor", outdoor: "Outdoor", clay: "Pro & clay" }[p.area] : "Any court")
  return [p.date ? "Once" : "Every week", where, p.note ? "with " + p.note : null].filter(Boolean).join(" · ")
}

// "15, ct 14" -> "Court 15, Court 14"; false when it can't be read.
export function courtList(v: string): string | null | false {
  const list = String(v || "").split(/[,;/]+/).map((x) => x.trim()).filter(Boolean)
    .map((x) => { const n = /^(?:court|ct\.?)?\s*(\d{1,2})$/i.exec(x); return n ? "Court " + Number(n[1]) : x })
  if (list.length > 6 || list.some((x) => x.length > 20)) return false
  return list.length ? list.join(", ") : null
}

// Open-Meteo's hourly forecast for the club, kept for an hour on this phone (shared with the current app).
type Forecast = { hourly?: unknown } | null
export function useForecast(): Forecast {
  const [f, setF] = useState<Forecast>(() => { try { return JSON.parse(localStorage.getItem("sbm-forecast") || "null")?.data ?? null } catch { return null } })
  useEffect(() => {
    let saved: { at: number } | null = null
    try { saved = JSON.parse(localStorage.getItem("sbm-forecast") || "null") } catch { /* none */ }
    if ((saved && Date.now() - saved.at < 3600e3) || !navigator.onLine) return
    let live = true
    fetch(forecastUrl()).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d?.hourly || !live) return
      setF(d)
      try { localStorage.setItem("sbm-forecast", JSON.stringify({ at: Date.now(), data: d })) } catch { /* private mode */ }
    }).catch(() => {})
    return () => { live = false }
  }, [])
  return f
}
// °C from the forecast, in °F for a US phone.
export const temp = (c: number) => Math.round(/^en-US$/i.test(navigator.language) ? c * 9 / 5 + 32 : c)
