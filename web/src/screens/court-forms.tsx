import { useEffect, useState } from "react"
import { toast } from "sonner"
import { planTitle, zonedToUtc } from "@models/courts.js"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { OptionSelect } from "@/components/material-select"
import { COURTS, TZ, addDay, clubToday, courtList } from "@/lib/courts"
import { KINDS, dur } from "@/lib/format"
import { addBooking, getState, putPlan, uid, useStore, type Plan, type PlayKind } from "@/lib/store"
import { chip } from "./restrung"

const field = "grid gap-1.5"
const BOOK_LENS: [string, string][] = [["60", "1 h"], ["90", "1 h 30"], ["120", "2 h"], ["30", "30 min"], ["45", "45 min"], ["180", "3 h"]]
const PLAN_LENS = [60, 75, 90, 120]
const DOWS: [string, string][] = [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"], ["6", "Saturday"], ["0", "Sunday"]]
const AREAS: [string, string][] = [["any", "Any"], ["indoor", "Indoor (14–19)"], ["outdoor", "Outdoor (1–8)"], ["clay", "Pro & clay (9–13)"]]

// STC's courts by area; an older free-text court that isn't one of them is kept as its own option.
function CourtSelect({ id, value, onChange, none }: { id: string; value: string; onChange: (v: string) => void; none: string }) {
  const known = COURTS.some(([, ns]) => ns.some((n) => "Court " + n === value))
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full text-base">
      <NativeSelectOption value="">{none}</NativeSelectOption>
      {value && !known && <NativeSelectOption value={value}>{value}</NativeSelectOption>}
      {COURTS.map(([area, ns]) => (
        <NativeSelectOptGroup key={area} label={area}>{ns.map((n) => <NativeSelectOption key={n} value={"Court " + n}>Court {n}</NativeSelectOption>)}</NativeSelectOptGroup>
      ))}
    </NativeSelect>
  )
}

function Sheet({ open, onOpenChange, title, desc, onSubmit, children, submit }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; desc: string; onSubmit: () => void; children: React.ReactNode; submit: string
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="flex min-h-0 flex-col">
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="font-display text-3xl font-bold uppercase">{title}</DrawerTitle>
            <DrawerDescription>{desc}</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-4 overflow-y-auto px-4 pb-2">{children}</div>
          <DrawerFooter>
            <Button type="submit" size="lg" className="h-12 text-base">{submit}</Button>
            <DrawerClose asChild><Button type="button" variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}

// A court booked somewhere else (or before the GameTime button was set up), typed in by hand.
export function BookingDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const rackets = useStore((s) => s.rackets)
  const [f, setF] = useState({ d: "", t: "18:00", len: "90", kind: "singles", court: "", racket: "" })
  const [err, setErr] = useState("")
  useEffect(() => { if (open) { setF({ d: clubToday(), t: "18:00", len: "90", kind: getState().prefs.lastKind || "singles", court: "", racket: "" }); setErr("") } }, [open])
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v })
  function save() {
    if (!f.d || !/^\d{2}:\d{2}/.test(f.t)) return setErr("Pick the day and start time.")
    const start = zonedToUtc(f.d, f.t.slice(0, 5), TZ)
    addBooking({ start, min: +f.len, tz: TZ, kind: f.kind as PlayKind, court: f.court || null, location: null, note: null, ref: null, racketId: f.racket || null })
    onOpenChange(false)
    toast("Booking saved. It's in your court calendar, and the time is logged on your racket once it ends.")
  }
  const ids = Object.keys(rackets).sort((a, b) => rackets[a].name.localeCompare(rackets[b].name))
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add a booking" submit="Save booking" onSubmit={save}
      desc="Bookings made with the GameTime button come in by themselves. Add one here that it didn't see.">
      <div className="grid grid-cols-2 gap-3">
        <div className={field}><Label htmlFor="bk-day">Day</Label><Input id="bk-day" type="date" className="h-11 text-base" value={f.d} onChange={(e) => set("d")(e.target.value)} /></div>
        <div className={field}><Label htmlFor="bk-time">Start</Label><Input id="bk-time" type="time" step={900} className="h-11 text-base" value={f.t} onChange={(e) => set("t")(e.target.value)} /></div>
        <div className={field}><Label htmlFor="bk-len">Length</Label><OptionSelect id="bk-len" value={f.len} onChange={set("len")} options={BOOK_LENS} /></div>
        <div className={field}><Label htmlFor="bk-kind">Type of play</Label><OptionSelect id="bk-kind" value={f.kind} onChange={set("kind")} options={KINDS} /></div>
        <div className={field}><Label htmlFor="bk-court">Court</Label><CourtSelect id="bk-court" value={f.court} onChange={set("court")} none="Not sure" /></div>
        <div className={field}><Label htmlFor="bk-racket">Racket</Label><OptionSelect id="bk-racket" value={f.racket} onChange={set("racket")} options={[["", "Most recently used"], ...ids.map((id) => [id, rackets[id].name] as [string, string])]} /></div>
      </div>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
    </Sheet>
  )
}

type PF = { repeat: string; date: string; dow: string; time: string; min: string; area: string; court: string; kind: string; backups: string; note: string }
const toForm = (p: Plan | null): PF => ({
  repeat: p?.date ? "once" : "weekly", date: p?.date || addDay(clubToday(), 7), dow: String(p ? p.dow : 1), time: p?.time || "18:00",
  min: String(p?.min || 75), area: p?.area || "any", court: p?.court || "", kind: p?.kind || "singles", backups: p?.backups || "", note: p?.note || "",
})

// A court you want, every week or once. Editing keeps its id, so it changes in place.
export function RequestDrawer({ open, onOpenChange, plan }: { open: boolean; onOpenChange: (o: boolean) => void; plan: Plan | null }) {
  const [f, setF] = useState<PF>(() => toForm(plan))
  const [err, setErr] = useState("")
  useEffect(() => { if (open) { setF(toForm(plan)); setErr("") } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof PF) => (v: string) => setF({ ...f, [k]: v })
  const once = f.repeat === "once"
  const lens = PLAN_LENS.includes(+f.min) ? PLAN_LENS : [...PLAN_LENS, +f.min].sort((a, b) => a - b)
  function save() {
    if (!/^\d{2}:\d{2}/.test(f.time)) return setErr("Pick a start time.")
    if (once && !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return setErr("Pick the date.")
    if (once && f.date < clubToday()) return setErr("That date has passed.")
    const backups = courtList(f.backups)
    if (backups === false) return setErr("Backup courts: up to 6, like 15, 14, 16.")
    const p: Plan = {
      id: plan?.id || uid(), dow: once ? new Date(f.date + "T12:00:00Z").getUTCDay() : +f.dow, date: once ? f.date : null,
      skips: once ? [] : plan?.skips || [], time: f.time.slice(0, 5), min: +f.min, area: f.area, court: f.court || null,
      kind: f.kind as PlayKind, note: f.note.trim() || null, backups, paused: plan ? plan.paused : false,
    }
    putPlan(p)
    onOpenChange(false)
    toast(plan ? "Request saved." : `Requested ${(p.date ? "" : "every ") + planTitle(p)}. Your court calendar reminds you the minute GameTime opens it.`)
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={plan ? "Change request" : "Request a court"} submit={plan ? "Save changes" : "Save request"} onSubmit={save}
      desc="It shows when it opens, the court to book once it's open, and the waitlist if it's taken.">
      <ToggleGroup type="single" spacing={2} value={f.repeat} onValueChange={(v) => v && set("repeat")(v)} aria-label="Repeat">
        <ToggleGroupItem value="weekly" className={chip}>Every week</ToggleGroupItem>
        <ToggleGroupItem value="once" className={chip}>Just once</ToggleGroupItem>
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-3">
        {once
          ? <div className={field}><Label htmlFor="pl-date">Date</Label><Input id="pl-date" type="date" className="h-11 text-base" min={clubToday()} value={f.date} onChange={(e) => set("date")(e.target.value)} /></div>
          : <div className={field}><Label htmlFor="pl-dow">Day</Label><OptionSelect id="pl-dow" value={f.dow} onChange={set("dow")} options={DOWS} /></div>}
        <div className={field}><Label htmlFor="pl-time">Start</Label><Input id="pl-time" type="time" step={900} className="h-11 text-base" value={f.time} onChange={(e) => set("time")(e.target.value)} /></div>
        <div className={field}><Label htmlFor="pl-len">Length</Label><OptionSelect id="pl-len" value={f.min} onChange={set("min")} options={lens.map((m) => [String(m), dur(m)])} /></div>
        <div className={field}><Label htmlFor="pl-kind">Type of play</Label><OptionSelect id="pl-kind" value={f.kind} onChange={set("kind")} options={KINDS.slice(0, 4)} /></div>
        <div className={field}><Label htmlFor="pl-area">Courts</Label><OptionSelect id="pl-area" value={f.area} onChange={set("area")} options={AREAS} /></div>
        <div className={field}><Label htmlFor="pl-court">Favourite court</Label><CourtSelect id="pl-court" value={f.court} onChange={set("court")} none="Any open court" /></div>
      </div>
      <div className={field}><Label htmlFor="pl-backups">If it's taken, try (in order)</Label><Input id="pl-backups" className="h-11 text-base" maxLength={120} placeholder="e.g. 15, 14, 16" value={f.backups} onChange={(e) => set("backups")(e.target.value)} /></div>
      <div className={field}><Label htmlFor="pl-note">With (optional)</Label><Input id="pl-note" className="h-11 text-base" maxLength={120} placeholder="e.g. Marc" value={f.note} onChange={(e) => set("note")(e.target.value)} /></div>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
    </Sheet>
  )
}
