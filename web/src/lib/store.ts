// The player's data on this device and its sync with the server, for the new front end.
//
// It reads and writes the same on-device copy as the current app (localStorage keys "sbm-…:<user id>")
// and sends the same changes to /api/sync, so either app can be used on a phone during the move.
// Changes go into the "outbox" first and are applied locally straight away, so the app works with no
// signal and catches up when it's back online.
import { useSyncExternalStore } from "react"

export type PlayKind = "singles" | "doubles" | "hitting" | "drills" | "ball_machine" | "serves"
export interface Play { id: string; d: string; min: number; kind: PlayKind }
export interface Reading { id: string; t: number; hz: number; s?: Record<string, unknown> }
export interface Job { id: string; from: string; to: string; reason: string; stringName?: string | null; material?: string; gauge?: number; strungKg?: number | null }
export interface Racket {
  name: string; head: number; gauge: number; material: string; pattern?: string; weight?: number | null
  stringName?: string | null; strungKg?: number | null; strungOn?: string | null; calib?: number; calibAt?: number | null
  readings: Reading[]; plays: Play[]; jobs: Job[]
}
export interface Shoe { id: string; name: string; startedOn: string; retiredOn?: string | null; lifeHours?: number }
export interface Booking {
  id: string; start: number; min: number; tz?: string; kind?: PlayKind; court?: string | null; location?: string | null
  note?: string | null; ref?: string | null; racketId?: string | null; playId?: string | null; cancelled?: boolean
}
// A court request: every week on `dow`, or once on `date`.
export interface Plan {
  id: string; dow: number; date: string | null; skips: string[]; time: string; min: number; area: string; court: string | null
  kind: PlayKind; note: string | null; backups: string | null; paused: boolean
}
// What the GameTime button last saw (no names): a day of the court sheet, the player's waitlist places,
// how fast courts go, and weekly times booked lately that no request covers.
export interface SheetDay { date: string; at: number; courts: { c: string; i: number; cells: [number, number, string][] }[] }
export interface Waitlist { date: string; start: number; minutes: number }
export interface Suggestion { dow: number; time: string; min: number; court: string | null; area: string; count: number }
export interface User { id: string; email: string; name?: string | null }
export interface Profile { level: string | null; style: string | null }
export interface Prefs { unit?: "kg" | "lb"; racket?: string; main?: string; lastKind?: PlayKind; lastMin?: number; kind?: PlayKind; dur?: number; [k: string]: unknown }
type Op = { op: string; [k: string]: unknown }

export interface State {
  user: User | null
  signedIn: boolean | null
  online: boolean
  lastSync: number
  rackets: Record<string, Racket>
  profile: Profile
  shoes: Shoe[]
  bookings: Booking[]
  plans: Plan[]
  window: { days: number; set: boolean }
  courtSheet: SheetDay[]
  waitlist: Waitlist[]
  courtStats: unknown[]
  suggestions: Suggestion[]
  outbox: Op[]
  prefs: Prefs
}

const lsGet = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v) } catch { return d } }
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12))

// An older model kept a fixed opening time; that copy is replaced by the default (7 days before it ends).
const win = (w: { days?: number; set?: boolean; time?: unknown } | null) => (w && w.days && !w.time ? { days: w.days, set: !!w.set } : { days: 7, set: false })
function load(): State {
  const user = lsGet<User | null>("sbm-user", null)
  const key = (n: string) => "sbm-" + n + ":" + (user ? user.id : "none")
  return {
    user, signedIn: null, online: navigator.onLine !== false, lastSync: lsGet(key("last-sync"), 0),
    rackets: lsGet(key("rackets"), {}), profile: lsGet(key("profile"), { level: null, style: null }),
    shoes: lsGet(key("shoes"), []), bookings: lsGet(key("bookings"), []), plans: lsGet(key("plans"), []),
    window: win(lsGet(key("window"), null)), courtSheet: lsGet(key("sheet"), []), waitlist: lsGet(key("waitlist"), []),
    courtStats: lsGet(key("stats"), []), suggestions: lsGet(key("suggest"), []),
    outbox: lsGet(key("outbox"), []), prefs: lsGet("sbm-prefs", {}),
  }
}

let state = load()
const listeners = new Set<() => void>()
function set(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((l) => l()) }
const key = (n: string) => "sbm-" + n + ":" + (state.user ? state.user.id : "none")
function save() {
  if (!state.user) return
  lsSet(key("rackets"), state.rackets); lsSet(key("outbox"), state.outbox); lsSet(key("profile"), state.profile)
  lsSet(key("shoes"), state.shoes); lsSet(key("bookings"), state.bookings); lsSet(key("plans"), state.plans)
  lsSet(key("window"), state.window); lsSet(key("sheet"), state.courtSheet); lsSet(key("waitlist"), state.waitlist)
  lsSet(key("stats"), state.courtStats); lsSet(key("suggest"), state.suggestions)
}
export function setPrefs(patch: Partial<Prefs>) { const prefs = { ...lsGet<Prefs>("sbm-prefs", {}), ...patch }; lsSet("sbm-prefs", prefs); set({ prefs }) }

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => pick(state))
}
export const getState = () => state

// Apply one change to the copy on this device (the same rules as the server).
function applyLocal(s: State, op: Op): State {
  const rackets = { ...s.rackets }
  const edit = (id: unknown, f: (r: Racket) => Racket) => { const r = rackets[id as string]; if (r) rackets[id as string] = f(r) }
  const all = (f: (r: Racket) => Racket) => { for (const id of Object.keys(rackets)) rackets[id] = f(rackets[id]) }
  switch (op.op) {
    case "racket.put": { const old = rackets[op.id as string]; rackets[op.id as string] = { ...(op.data as Racket), readings: old?.readings || [], plays: old?.plays || [], jobs: old?.jobs || [] }; break }
    case "racket.delete": delete rackets[op.id as string]; break
    case "play.add": edit(op.racketId, (r) => (r.plays || []).some((p) => p.id === op.id) ? r : { ...r, plays: [...(r.plays || []), { id: op.id as string, d: op.d as string, min: op.min as number, kind: op.kind as PlayKind }] }); break
    case "play.delete": all((r) => ({ ...r, plays: (r.plays || []).filter((p) => p.id !== op.id) })); break
    case "reading.add": edit(op.racketId, (r) => r.readings.some((x) => x.id === op.id) ? r : { ...r, readings: [...r.readings, { id: op.id as string, t: op.t as number, hz: op.hz as number, ...(op.s ? { s: op.s as Record<string, unknown> } : {}) }] }); break
    case "reading.delete": all((r) => ({ ...r, readings: r.readings.filter((x) => x.id !== op.id) })); break
    case "job.add": { const { op: _o, racketId, ...j } = op; edit(racketId, (r) => (r.jobs || []).some((x) => x.id === j.id) ? r : { ...r, jobs: [...(r.jobs || []), j as unknown as Job] }); break }
    case "job.delete": all((r) => ({ ...r, jobs: (r.jobs || []).filter((x) => x.id !== op.id) })); break
    case "shoe.put": return { ...s, shoes: [...s.shoes.filter((x) => x.id !== op.id), { id: op.id as string, ...(op.data as Omit<Shoe, "id">) }] }
    case "shoe.delete": return { ...s, shoes: s.shoes.filter((x) => x.id !== op.id) }
    case "booking.put": { const { op: _o, ...b } = op; return { ...s, bookings: [...s.bookings.filter((x) => x.id !== b.id), { ...(b as unknown as Booking), playId: null }].sort((a, c) => a.start - c.start) } }
    case "booking.cancel": return { ...s, bookings: s.bookings.filter((x) => x.id !== op.id) }
    case "plan.put": { const { op: _o, ...p } = op; return { ...s, plans: [...s.plans.filter((x) => x.id !== p.id), p as unknown as Plan].sort((a, c) => ((a.dow + 6) % 7) - ((c.dow + 6) % 7) || a.time.localeCompare(c.time)) } }
    case "plan.delete": return { ...s, plans: s.plans.filter((x) => x.id !== op.id) }
    case "window.put": return { ...s, window: { days: op.days as number, set: true } }
    default: return s
  }
  return { ...s, rackets }
}
function queue(op: Op) {
  const next = applyLocal(state, op)
  // A newer edit of the same racket replaces the queued one in place, so it still goes before that racket's other changes.
  const i = op.op === "racket.put" ? state.outbox.findIndex((o) => o.op === "racket.put" && o.id === op.id) : -1
  const outbox = i >= 0 ? state.outbox.map((o, k) => (k === i ? op : o)) : [...state.outbox, op]
  set({ ...next, outbox }); save(); syncSoon()
  return op
}
// Undo: drop queued changes that haven't been sent yet, then re-send what they removed (safe to send twice).
function undo(drop: Op[], resend: Op[]) {
  set({ outbox: state.outbox.filter((o) => !drop.includes(o)) })
  resend.forEach(queue)
}

// ---------- sync ----------
let syncing = false, again = false, timer: ReturnType<typeof setTimeout> | undefined
export function syncSoon(ms = 800) { clearTimeout(timer); timer = setTimeout(sync, ms) }
export async function sync() {
  if (!state.user) return
  if (syncing) { again = true; return }
  syncing = true
  const sent = state.outbox.slice(0, 400), forUser = state.user.id
  try {
    const res = await fetch("/api/sync", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops: sent, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) })
    if (!state.user || state.user.id !== forUser) return
    if (res.status === 401) { set({ signedIn: false, online: true }); return }
    const body = await res.json().catch(() => ({}))
    if (res.status === 400) {
      // The whole batch was refused. Keep a copy and move on, so one bad change can't block syncing.
      lsSet(key("refused"), { at: Date.now(), error: body.error, ops: sent })
      set({ outbox: state.outbox.filter((o) => !sent.includes(o)), online: true }); save(); again = true
      return
    }
    if (!res.ok) throw new Error(body.error || "HTTP " + res.status)
    if (body.refused?.length) lsSet(key("refused"), { at: Date.now(), refused: body.refused })
    const user = body.user ? { ...state.user, ...body.user } : state.user
    if (body.user) lsSet("sbm-user", user)
    let next: State = {
      ...state, user, signedIn: true, online: true, lastSync: Date.now(),
      outbox: state.outbox.filter((o) => !sent.includes(o)),
      rackets: body.rackets || {}, profile: body.profile || state.profile, shoes: body.shoes || state.shoes,
      bookings: body.bookings || state.bookings, plans: body.plans || state.plans,
      window: body.window ? win(body.window) : state.window, courtSheet: body.courtSheet || state.courtSheet, waitlist: body.waitlist || state.waitlist,
      courtStats: body.courtStats || state.courtStats, suggestions: body.suggestions || state.suggestions,
    }
    next = next.outbox.reduce(applyLocal, next) // changes made while this request was out
    set(next); lsSet(key("last-sync"), next.lastSync); save()
    if (next.outbox.length) again = true
  } catch {
    set({ online: false })
  } finally {
    syncing = false
    if (again) { again = false; syncSoon() }
  }
}
if (typeof window !== "undefined") {
  addEventListener("online", () => { set({ online: true }); sync() })
  addEventListener("offline", () => set({ online: false }))
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync() })
  setInterval(() => { if (state.outbox.length || Date.now() - state.lastSync > 5 * 60000) sync() }, 60000)
}

// ---------- the racket you play with ----------
// Today and one-tap logging follow your main racket: the one you picked with "Make main", or else the
// one you logged play on most recently. (The current app used the last racket page you opened, which
// sent one-tap logs to a racket you had only looked at.)
export function mainRacketId(s: Pick<State, "rackets" | "prefs">): string | null {
  const ids = Object.keys(s.rackets)
  if (!ids.length) return null
  if (s.prefs.main && s.rackets[s.prefs.main]) return s.prefs.main
  let best: string | null = null, bestDay = ""
  for (const id of ids) for (const p of s.rackets[id].plays || []) if (p.d > bestDay) { bestDay = p.d; best = id }
  if (best) return best
  if (s.prefs.racket && s.rackets[s.prefs.racket]) return s.prefs.racket
  return ids.sort((a, b) => s.rackets[a].name.localeCompare(s.rackets[b].name))[0]
}
export const makeMain = (id: string) => setPrefs({ main: id })

// ---------- play ----------
export function addPlay(racketId: string, p: Omit<Play, "id">): Play {
  const play = { ...p, id: uid() }
  queue({ op: "play.add", id: play.id, racketId, d: play.d, min: play.min, kind: play.kind })
  setPrefs({ lastKind: play.kind, lastMin: play.min })
  return play
}
export function removePlay(id: string) { queue({ op: "play.delete", id }) }
export function restorePlay(racketId: string, p: Play) {
  undo(state.outbox.filter((o) => o.op === "play.delete" && o.id === p.id), [{ op: "play.add", id: p.id, racketId, d: p.d, min: p.min, kind: p.kind }])
}

// ---------- rackets ----------
const racketData = (r: Partial<Racket>) => ({
  name: r.name, head: r.head, gauge: r.gauge, material: r.material, pattern: r.pattern || "16x19",
  weight: r.weight ?? null, stringName: r.stringName ?? null, strungKg: r.strungKg ?? null,
  strungOn: r.strungOn ?? null, calib: r.calib || 1, calibAt: r.calibAt ?? null,
})
export function putRacket(id: string, patch: Partial<Racket>) {
  const r = { ...(state.rackets[id] || {}), ...patch }
  queue({ op: "racket.put", id, data: racketData(r) })
}
export function addRacket(): string {
  const id = uid()
  putRacket(id, { name: "Racket " + (Object.keys(state.rackets).length + 1), head: 100, gauge: 1.25, material: "poly", pattern: "16x19", calib: 1, calibAt: null })
  return id
}
const racketOps = (id: string, r: Racket): Op[] => [
  { op: "racket.put", id, data: racketData(r) },
  ...r.readings.map((x) => ({ op: "reading.add", id: x.id, racketId: id, t: x.t, hz: x.hz, ...(x.s ? { s: x.s } : {}) })),
  ...(r.plays || []).map((p) => ({ op: "play.add", id: p.id, racketId: id, d: p.d, min: p.min, kind: p.kind })),
  ...(r.jobs || []).map((j) => ({ op: "job.add", racketId: id, ...j })),
]
// Returns an undo.
export function deleteRacket(id: string): () => void {
  const gone = state.rackets[id]
  const del = queue({ op: "racket.delete", id })
  return () => undo([del], racketOps(id, gone))
}
export function removeReading(racketId: string, x: Reading): () => void {
  const del = queue({ op: "reading.delete", id: x.id })
  return () => undo([del], [{ op: "reading.add", id: x.id, racketId, t: x.t, hz: x.hz, ...(x.s ? { s: x.s } : {}) }])
}

// ---------- strings ----------
// The strings in the racket now, as a history record that ended on `endedOn` (null when Strung on isn't set).
function currentJob(r: Racket, endedOn: string, reason: string): Job | null {
  if (!r.strungOn) return null
  return { id: uid(), from: r.strungOn, to: endedOn < r.strungOn ? r.strungOn : endedOn, reason, stringName: r.stringName || null, material: r.material, gauge: r.gauge, strungKg: r.strungKg ?? null }
}
// "Strings broke": the set goes to the history as broken and the racket waits for a restring.
export function stringsBroke(id: string, today: string): (() => void) | null {
  const r = state.rackets[id]; const job = r && currentJob(r, today, "broke")
  if (!r || !job) return null
  const was = r.strungOn
  const add = queue({ op: "job.add", racketId: id, ...job })
  putRacket(id, { strungOn: null })
  return () => { undo([add], [{ op: "job.delete", id: job.id }]); putRacket(id, { strungOn: was }) }
}
export interface Restring { day: string; reason: string; stringName: string | null; gauge: number; material: string; strungKg: number | null }
// "Restrung": the strings coming out go to the history (unless this corrects a restring made the same day).
export function restrung(id: string, x: Restring): Job | null {
  const r = state.rackets[id]; if (!r) return null
  const job = r.strungOn !== x.day ? currentJob(r, x.day, x.reason) : null
  if (job) queue({ op: "job.add", racketId: id, ...job })
  putRacket(id, { strungOn: x.day, stringName: x.stringName, gauge: x.gauge, material: x.material, strungKg: x.strungKg })
  return job
}
export function removeJob(racketId: string, j: Job): () => void {
  const del = queue({ op: "job.delete", id: j.id })
  return () => undo([del], [{ op: "job.add", racketId, ...j }])
}

// ---------- shoes ----------
const shoeData = (x: Shoe) => ({ name: x.name, startedOn: x.startedOn, retiredOn: x.retiredOn || null, lifeHours: x.lifeHours || 60 })
export const putShoe = (x: Shoe) => queue({ op: "shoe.put", id: x.id, data: shoeData(x) })
// A new pair goes into use; the pair worn until then is retired that day.
export function newPair(name: string, startedOn: string, lifeHours: number, current: Shoe | null) {
  if (current) putShoe({ ...current, retiredOn: startedOn })
  putShoe({ id: uid(), name, startedOn, retiredOn: null, lifeHours })
}
export function removeShoe(x: Shoe): () => void {
  const del = queue({ op: "shoe.delete", id: x.id })
  return () => undo([del], [{ op: "shoe.put", id: x.id, data: shoeData(x) }])
}

// ---------- courts ----------
export const addBooking = (b: Omit<Booking, "id">) => queue({ op: "booking.put", id: uid(), ...b })
// Takes a booking out of the app and the court calendar (not out of GameTime). Returns an undo.
export function removeBooking(b: Booking): () => void {
  const del = queue({ op: "booking.cancel", id: b.id })
  const { playId: _p, cancelled: _c, ...rest } = b
  return () => undo([del], [{ op: "booking.put", ...rest }])
}
export const putPlan = (p: Plan) => queue({ op: "plan.put", ...p })
export function removePlan(p: Plan): () => void {
  const del = queue({ op: "plan.delete", id: p.id })
  return () => undo([del], [{ op: "plan.put", ...p }])
}
export const setWindow = (days: number) => queue({ op: "window.put", days })
// "Make it weekly": the suggestion becomes a request and leaves the list.
export function acceptSuggestion(x: Suggestion): Plan {
  const p: Plan = { id: uid(), dow: x.dow, date: null, skips: [], time: x.time, min: x.min || 75, area: x.area && x.area !== "other" ? x.area : "any", court: x.court || null, kind: "singles", note: null, backups: null, paused: false }
  putPlan(p); set({ suggestions: state.suggestions.filter((y) => y !== x) }); save()
  return p
}
