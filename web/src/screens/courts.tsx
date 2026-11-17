import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CalendarPlus, ChevronDown, EllipsisVertical, Plus } from "lucide-react"
import {
  DAY_NAMES, WAITLIST_URL, bookUrl, bookingTitle, cancelBy, indoorSwap, outdoorCourt, outdoorPlan, planLink, planTitle, rainAt,
  shareText, speedSummary, toIcs, courtArea, type Status,
} from "@models/courts.js"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eyebrow } from "@/components/eyebrow"
import { TitleBar } from "@/components/title-bar"
import { toneBadge } from "@/components/tone"
import { TZ, clockMin, clubToday, comingUpRows, ct, dateLabel, planWhere, soonAt, temp, toMinutes, useForecast, whenDay, whenTime, type Row } from "@/lib/courts"
import { KIND_NAME, dur } from "@/lib/format"
import type { Tone } from "@/lib/racket"
import {
  acceptSuggestion, addPlay, getState, putPlan, removeBooking, removePlan, removePlay, setPrefs, setWindow, syncSoon, useStore,
  type Booking, type Plan,
} from "@/lib/store"
import { cn } from "@/lib/utils"
import { BookingDrawer, RequestDrawer } from "./court-forms"
import { CourtGrid } from "./court-grid"
import { LogDrawer } from "./log-drawer"

const ext = { target: "_blank", rel: "noopener" }
type Forecast = ReturnType<typeof useForecast>

export function Courts() {
  const bookings = useStore((s) => s.bookings)
  const plans = useStore((s) => s.plans)
  const waitlist = useStore((s) => s.waitlist)
  const courtSheet = useStore((s) => s.courtSheet)
  const win = useStore((s) => s.window)
  const forecast = useForecast()
  const [bookOpen, setBookOpen] = useState(false)
  const [req, setReq] = useState<{ open: boolean; plan: Plan | null }>({ open: false, plan: null })
  const [, tick] = useState(0)
  // Coming back to the app (for example from GameTime) picks up the newest sheet, and chips stay current.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60000)
    const v = () => { if (document.visibilityState === "visible") syncSoon(0) }
    document.addEventListener("visibilitychange", v)
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v) }
  }, [])

  const now = Date.now()
  const { rows, resting } = comingUpRows({ bookings, plans, waitlist, courtSheet, window: win }, now)
  const past = bookings.filter((b) => !b.cancelled && b.start + b.min * 60000 <= now).reverse()
  const editPlan = (plan: Plan) => setReq({ open: true, plan })

  return (
    <>
      <TitleBar title="Courts" />
      <HowWasIt />
      <Suggestions />

      <section className="grid gap-2" aria-labelledby="h-coming">
        <Eyebrow as="h2" className="ml-1"><span id="h-coming">Coming up</span></Eyebrow>
        {rows.length + resting.length > 0 ? (
          <Card className="gap-0 py-1">
            {[...rows, ...resting].map((r, i) => (
              <div key={r.type === "booking" ? r.booking.id : r.plan.id} className={cn("px-4 py-3.5", i > 0 && "border-t")}>
                {r.type === "booking" ? <BookingRow row={r} now={now} forecast={forecast} onEdit={editPlan} /> : <RequestRow plan={r.plan} st={r.status} now={now} forecast={forecast} onEdit={editPlan} />}
              </div>
            ))}
          </Card>
        ) : (
          <Card className="border-2 border-dashed border-primary/40 shadow-none">
            <CardContent className="text-[15px] text-muted-foreground">Nothing booked or requested. Bookings go in your court calendar and are logged on your racket once they end. A request shows when GameTime opens it and the court to book.</CardContent>
          </Card>
        )}
        <div className="flex flex-wrap gap-2">
          <Button className="rounded-full" onClick={() => setReq({ open: true, plan: null })}><Plus />Request a court</Button>
          <Button variant="outline" className="rounded-full" onClick={() => setBookOpen(true)}><CalendarPlus />Add a booking</Button>
        </div>
        {past.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="group ml-1 flex items-center gap-1 py-1 text-sm font-semibold text-muted-foreground">
              Last two weeks ({past.length})<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-1 gap-0 py-1">
                {past.map((b, i) => (
                  <div key={b.id} className={cn("px-4 py-3", i > 0 && "border-t")}><BookingRow row={{ type: "booking", start: b.start, booking: b, plan: null, next: null }} now={now} forecast={null} onEdit={editPlan} /></div>
                ))}
              </Card>
            </CollapsibleContent>
          </Collapsible>
        )}
      </section>

      <CourtGrid />
      <OpeningRule days={win.days} />
      <p className="px-1 text-sm text-muted-foreground">The GameTime button and your court calendar link are in <a href="/?tab=settings" className="font-semibold text-primary">Settings</a>.</p>

      <BookingDrawer open={bookOpen} onOpenChange={setBookOpen} />
      <RequestDrawer open={req.open} onOpenChange={(open) => setReq({ ...req, open })} plan={req.plan} />
    </>
  )
}

function Chip({ tone = "none", children }: { tone?: Tone; children: React.ReactNode }) {
  return <Badge className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", toneBadge[tone])}>{children}</Badge>
}

// A rain chip for an outdoor court time and, when rain is likely, an indoor court open at that time.
function Weather({ start, min, now, forecast }: { start: number; min: number; now: number; forecast: Forecast }) {
  const sheet = useStore((s) => s.courtSheet), days = useStore((s) => s.window.days)
  const w = rainAt(forecast, start, min, TZ)
  if (!w) return null
  const swap = w.prob >= 50 ? indoorSwap(sheet, start, { now, days, tz: TZ }) : null
  return (
    <>
      <Chip tone={w.prob >= 60 ? "bad" : w.prob >= 35 ? "warn" : "good"}>{(w.prob >= 35 ? "☂ " : "☀ ") + w.prob + "% rain" + (w.temp != null ? " · " + temp(w.temp) + "°" : "")}</Chip>
      {swap && <a {...ext} className="text-xs font-semibold text-primary" href={bookUrl(swap.id, new Date(start).toLocaleDateString("en-CA", { timeZone: TZ }), swap.start)}>{ct(swap.court)} indoor is open</a>}
    </>
  )
}

function Line({ when, sub, extra, children, menu }: { when: string; sub: string; extra?: React.ReactNode; children?: React.ReactNode; menu: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div>
          <p className="font-semibold">{when}</p>
          <p className="text-sm text-muted-foreground">{sub}</p>
          {extra}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      {menu}
    </div>
  )
}
const Menu = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="-mr-2 shrink-0" aria-label={label}><EllipsisVertical /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">{children}</DropdownMenuContent>
  </DropdownMenu>
)

// The menu items a weekly request has: skip its next date (or take a skip back) and pause.
function planItems(p: Plan, next: string | undefined, booked: boolean) {
  const first = clubToday()
  const skipped = (p.skips || []).filter((d) => d >= first)
  const save = (q: Plan) => putPlan(q)
  return (
    <>
      {skipped.length > 0 && <DropdownMenuItem onSelect={() => save({ ...p, skips: p.skips.filter((d) => d !== skipped[0] && d >= first) })}>Play {dateLabel(skipped[0])} after all</DropdownMenuItem>}
      {next && !p.paused && !booked && <DropdownMenuItem onSelect={() => { save({ ...p, skips: p.skips.filter((d) => d >= first).concat([next]) }); toast(`Skipped ${dateLabel(next)}.`) }}>Skip {dateLabel(next)}</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => save({ ...p, paused: !p.paused })}>{p.paused ? "Resume" : "Pause"}</DropdownMenuItem>
    </>
  )
}
function removeRequest(p: Plan) {
  const undo = removePlan(p)
  toast(`Removed ${planTitle(p)}.`, { action: { label: "Undo", onClick: undo } })
}

function BookingRow({ row, now, forecast, onEdit }: { row: Extract<Row, { type: "booking" }>; now: number; forecast: Forecast; onEdit: (p: Plan) => void }) {
  const rackets = useStore((s) => s.rackets)
  const { booking: b, plan, next } = row
  const tz = b.tz || TZ, done = b.start + b.min * 60000 <= now, cut = cancelBy(b)
  const sub = [bookingTitle(b).replace(/^Tennis: /, ""), dur(b.min), b.racketId && rackets[b.racketId]?.name, done ? (b.playId ? "logged" : "logs on next sync") : null].filter(Boolean).join(" · ")
  function remove() {
    const undo = removeBooking(b)
    toast("Removed from the app and your court calendar. It isn't cancelled with the club; do that in GameTime.", { action: { label: "Undo", onClick: undo } })
  }
  return (
    <Line when={`${whenDay(b.start, tz)} · ${whenTime(b.start, tz)}`} sub={sub}
      extra={plan && <p className="text-sm text-muted-foreground">{plan.date ? "Your request" : "Every week"}{next ? ` · next one opens ${soonAt(next.opensAt, now)}` : ""}</p>}
      menu={
        <Menu label="More for this booking">
          {!done && <DropdownMenuItem onSelect={() => share(b)}>Send to partner</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => downloadIcs(b)}>Add to calendar</DropdownMenuItem>
          {plan && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => onEdit(plan)}>Edit request</DropdownMenuItem>{!plan.date && planItems(plan, undefined, true)}</>}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={remove}>Remove booking</DropdownMenuItem>
        </Menu>
      }>
      {!done && <>
        <Chip tone="good">Booked</Chip>
        {cut && <Chip tone={cut <= now ? "bad" : cut - now < 864e5 ? "warn" : "none"}>{cut > now ? "Cancel by " + soonAt(cut, now) : "Too late to cancel"}</Chip>}
        {outdoorCourt(b.court) && <Weather start={b.start} min={b.min} now={now} forecast={forecast} />}
      </>}
    </Line>
  )
}

// A request not booked yet: where its next date stands and the one thing to do about it.
function RequestRow({ plan: p, st, now, forecast, onEdit }: { plan: Plan; st: Status; now: number; forecast: Forecast; onEdit: (p: Plan) => void }) {
  const stats = useStore((s) => s.courtStats)
  const resting = st.state === "paused" || st.state === "done" || !st.start
  const when = resting ? (p.date ? dateLabel(p.date) : "Every " + DAY_NAMES[p.dow]) + " · " + clockMin(toMinutes(p.time)) : `${whenDay(st.start!)} · ${whenTime(st.start!)}`
  const speed = speedSummary(stats, { dow: p.dow, time: p.time, area: p.court ? courtArea(p.court) : p.area || "any" })
  const late = st.best && st.best.start !== toMinutes(p.time) ? " · " + clockMin(st.best.start) : ""
  return (
    <Line when={when} sub={[planWhere(p), dur(p.min), p.backups ? "if taken: " + p.backups : null].filter(Boolean).join(" · ")}
      extra={speed && !resting && <p className="text-sm text-muted-foreground">{speed}.</p>}
      menu={
        <Menu label="More for this request">
          <DropdownMenuItem onSelect={() => onEdit(p)}>Edit</DropdownMenuItem>
          {!p.date && planItems(p, st.date, false)}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => removeRequest(p)}>Remove request</DropdownMenuItem>
        </Menu>
      }>
      {st.state === "paused" ? <Chip>Paused</Chip>
        : st.state === "done" ? <Chip>No dates left</Chip>
          : st.state === "waitlist" ? <Chip tone="warn">On the waitlist</Chip>
            : st.state === "soon" ? <Chip>Opens {soonAt(st.opensAt!, now)}</Chip>
              : st.state === "open" ? <><Chip tone="good">Open now</Chip><Button asChild size="sm" className="rounded-full"><a {...ext} href={bookUrl(st.best!.id, st.date!, st.best!.start)}>Book {ct(st.best!.court)}{late}</a></Button></>
                : st.state === "unknown" ? <><Chip tone="good">Open now</Chip><Button asChild size="sm" className="rounded-full"><a {...ext} href={planLink(p, st.date!)}>Book</a></Button></>
                  : st.state === "taken" ? <><Chip tone="bad">Taken</Chip><Button asChild size="sm" variant="outline" className="rounded-full"><a {...ext} href={WAITLIST_URL}>Join the waitlist</a></Button></>
                    : null}
      {!resting && outdoorPlan(p) && <Weather start={st.start!} min={p.min} now={now} forecast={forecast} />}
    </Line>
  )
}

// Weekly times booked lately that no request covers: make them a weekly request in one tap.
function Suggestions() {
  const suggestions = useStore((s) => s.suggestions)
  const hidden = (useStore((s) => s.prefs.suggestNo) as string[] | undefined) || []
  const list = suggestions.filter((x) => !hidden.includes(x.dow + "@" + x.time)).slice(0, 2)
  if (!list.length) return null
  return (
    <Card className="gap-0 py-1">
      {list.map((x, i) => (
        <div key={x.dow + "@" + x.time} className={cn("grid gap-2 px-4 py-3.5", i > 0 && "border-t")}>
          <p className="text-[15px]">You've booked <b>{DAY_NAMES[x.dow]} {clockMin(toMinutes(x.time))}</b>{x.court ? ` (${x.court})` : ""} {x.count} weeks lately. Make it a weekly request?</p>
          <div className="flex gap-2">
            <Button size="sm" className="rounded-full" onClick={() => { const p = acceptSuggestion(x); toast(`Added ${planTitle(p)} every week.`) }}>Make it weekly</Button>
            <Button size="sm" variant="ghost" onClick={() => setPrefs({ suggestNo: hidden.concat([x.dow + "@" + x.time]).slice(-20) })}>Not now</Button>
          </div>
        </div>
      ))}
    </Card>
  )
}

// A booking that just ended is logged as play by itself; this asks once whether that was right.
function HowWasIt() {
  const bookings = useStore((s) => s.bookings)
  const rackets = useStore((s) => s.rackets)
  const ok = (useStore((s) => s.prefs.playedOk) as string[] | undefined) || []
  const [fix, setFix] = useState(false)
  const now = Date.now()
  const ask = new URLSearchParams(location.search).get("played")
  const done = bookings.filter((b) => b.playId && b.start + b.min * 60000 <= now && now - (b.start + b.min * 60000) < 2 * 864e5 && !ok.includes(b.id))
  const b = (ask && done.find((x) => x.id === ask)) || done[done.length - 1]
  const found = b && Object.entries(rackets).map(([rid, r]) => [rid, (r.plays || []).find((p) => p.id === b.playId)] as const).find(([, p]) => p)
  if (!b || !found) return null
  const [rid, play] = found as [string, NonNullable<(typeof found)[1]>]
  const close = () => setPrefs({ playedOk: ok.concat([b.id]).slice(-30) })
  return (
    <Card className="border-primary/30 bg-secondary">
      <CardContent className="grid gap-3">
        <Eyebrow as="h2">How was it?</Eyebrow>
        <p className="text-[15px]">{whenDay(b.start, b.tz || TZ)} {whenTime(b.start, b.tz || TZ)}{b.court ? " on " + b.court : ""}: logged {dur(play.min)} of {KIND_NAME[play.kind].toLowerCase()} on {rackets[rid].name}.</p>
        <div className="flex flex-wrap gap-2">
          <Button className="rounded-full" onClick={close}>Looks right</Button>
          <Button variant="outline" className="rounded-full" onClick={() => setFix(true)}>Change</Button>
          <Button variant="ghost" className="text-bad" onClick={() => { close(); removePlay(play.id); toast("Session removed.") }}>Didn't play</Button>
        </div>
      </CardContent>
      <LogDrawer open={fix} onOpenChange={setFix} racketId={rid} kind={play.kind} min={play.min} day={play.d}
        onLog={(c) => { close(); removePlay(play.id); addPlay(c.racketId, { d: c.d, min: c.min, kind: c.kind }); setFix(false); toast(`Changed to ${dur(c.min)} of ${KIND_NAME[c.kind].toLowerCase()} on ${getState().rackets[c.racketId]?.name}.`) }} />
    </Card>
  )
}

// GameTime opens each court time this many days before it ends.
function OpeningRule({ days }: { days: number }) {
  const [v, setV] = useState(String(days)), [err, setErr] = useState("")
  useEffect(() => setV(String(days)), [days])
  function save() {
    const n = Math.round(+v)
    if (!(n >= 1 && n <= 30)) return setErr("Booking opens 1 to 30 days before a court time ends.")
    setErr(""); if (n !== days) setWindow(n)
  }
  return (
    <Collapsible>
      <CollapsibleTrigger className="group ml-1 flex items-center gap-1 py-1 text-sm font-semibold text-muted-foreground">
        When GameTime opens booking<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-1 gap-3 px-4 py-4">
          <p className="text-[15px]">GameTime opens each court time {days === 7 ? "exactly a week" : days + " days"} before it ends, so a 2:15 to 3:30 pm court opens at 3:30 pm {days === 7 ? "the same day a week earlier" : days + " days earlier"}. Your "Book now" alerts go off at that minute.</p>
          <div className="grid w-40 gap-1.5"><Label htmlFor="win-days">Days before it ends</Label><Input id="win-days" type="number" inputMode="numeric" min={1} max={30} className="h-11 text-base" value={v} onChange={(e) => setV(e.target.value)} onBlur={save} /></div>
          {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        </Card>
      </CollapsibleContent>
    </Collapsible>
  )
}

function downloadIcs(b: Booking) {
  const blob = new Blob([toIcs([b], { name: "Tennis courts", method: "PUBLISH" })], { type: "text/calendar" })
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tennis-" + new Date(b.start).toISOString().slice(0, 10) + ".ics"
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}
// The share sheet with the time, place and a calendar file; else the text on the clipboard.
async function share(b: Booking) {
  const text = shareText(b, b.tz || TZ)
  const file = new File([toIcs([b], { name: "Tennis", method: "PUBLISH" })], "tennis.ics", { type: "text/calendar" })
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ text, files: [file] }); return }
    if (navigator.share) { await navigator.share({ text }); return }
  } catch (e) { if ((e as Error)?.name === "AbortError") return }
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it into a message to your partner.") } catch { toast(text) }
}
