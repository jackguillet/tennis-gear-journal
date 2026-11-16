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
export interface Booking { id: string; start: number; min: number; tz?: string; kind?: PlayKind; court?: string | null; cancelled?: boolean }
export interface Plan { id: string; dow: number; time: string; min: number; court?: string | null; date?: string | null; paused?: boolean; area?: string }
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
  outbox: Op[]
  prefs: Prefs
}

const lsGet = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v) } catch { return d } }
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12))

function load(): State {
  const user = lsGet<User | null>("sbm-user", null)
  const key = (n: string) => "sbm-" + n + ":" + (user ? user.id : "none")
  return {
    user, signedIn: null, online: navigator.onLine !== false, lastSync: lsGet(key("last-sync"), 0),
    rackets: lsGet(key("rackets"), {}), profile: lsGet(key("profile"), { level: null, style: null }),
    shoes: lsGet(key("shoes"), []), bookings: lsGet(key("bookings"), []), plans: lsGet(key("plans"), []),
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
  switch (op.op) {
    case "play.add": edit(op.racketId, (r) => (r.plays || []).some((p) => p.id === op.id) ? r : { ...r, plays: [...(r.plays || []), { id: op.id as string, d: op.d as string, min: op.min as number, kind: op.kind as PlayKind }] }); break
    case "play.delete": for (const id of Object.keys(rackets)) rackets[id] = { ...rackets[id], plays: (rackets[id].plays || []).filter((p) => p.id !== op.id) }; break
    default: return s
  }
  return { ...s, rackets }
}
function queue(op: Op) { const next = applyLocal(state, op); set({ ...next, outbox: [...state.outbox, op] }); save(); syncSoon() }

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
  // Undo: drop the delete if it hasn't been sent yet, and send the session again (safe to send twice).
  set({ outbox: state.outbox.filter((o) => !(o.op === "play.delete" && o.id === p.id)) })
  queue({ op: "play.add", id: p.id, racketId, d: p.d, min: p.min, kind: p.kind })
}
