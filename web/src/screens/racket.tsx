import { lazy, Suspense, useState } from "react"
import { toast } from "sonner"
import { Activity, ChevronDown, ChevronLeft, Pencil, RotateCw, Unplug, X } from "lucide-react"
import { restringAdvice, personalBreak } from "@models/restring.js"
import { REASON_NAMES, minutesBetween } from "@models/stringjobs.js"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Eyebrow } from "@/components/eyebrow"
import { toneBadge, toneBar } from "@/components/tone"
import { KIND_NAME, dayName, dur, hrs, shortDate, today, unitFor, weight } from "@/lib/format"
import { baseline, kgOf, racketState, stringDesc } from "@/lib/racket"
import { cameFrom, go } from "@/lib/route"
import { removeJob, removePlay, removeReading, restorePlay, setPrefs, stringsBroke, useStore, type Job, type Play, type Racket, type Reading } from "@/lib/store"
import { cn } from "@/lib/utils"
import { EditRacketDrawer } from "./racket-edit"
import { RestrungDrawer } from "./restrung"

// The chart library is big, so it loads only when the Tension tab opens.
const TensionChart = lazy(() => import("./tension-chart").then((m) => ({ default: m.TensionChart })))

const BACK_NAME = { today: "Today", gear: "Gear", racket: "Back" } as const

export function RacketPage({ id, edit }: { id: string; edit: boolean }) {
  const rackets = useStore((s) => s.rackets)
  const profile = useStore((s) => s.profile)
  const prefs = useStore((s) => s.prefs)
  const [restrungOpen, setRestrungOpen] = useState(false)
  const r = rackets[id]
  const day = today(), unit = unitFor(prefs)
  const from = cameFrom(), back = from && from.page !== "racket" ? from : { page: "gear" as const }

  if (!r) {
    return (
      <div className="grid gap-4 pt-6">
        <p className="text-muted-foreground">This racket isn't on this phone (it may have been deleted).</p>
        <Button asChild variant="outline" className="w-fit"><a href="#/gear">Go to Gear</a></Button>
      </div>
    )
  }

  const st = racketState(r, rackets, profile, day)
  const a = restringAdvice(r, profile, day, personalBreak(rackets, profile))
  const specs = [stringDesc(r, unit), r.strungOn ? "strung " + shortDate(r.strungOn) : "", (r.pattern || "16x19").replace("x", " × "), r.head + " sq in", r.weight ? r.weight + " g" : ""].filter(Boolean).join(" · ")
  const since = r.strungOn ? shortDate(r.strungOn) : null
  const sessions = (r.plays || []).filter((p) => !r.strungOn || p.d >= r.strungOn).length

  function broke() {
    const undo = stringsBroke(id, day)
    if (undo) toast(`Marked ${r.name}'s strings as broken. Press Restrung when new ones go in.`, { action: { label: "Undo", onClick: undo } })
  }

  return (
    <>
      <header className="grid gap-1 pt-2">
        <a href={back.page === "today" ? "#/" : "#/gear"} className="-ml-1 flex w-fit items-center text-[17px] font-semibold text-primary"><ChevronLeft className="size-5" />{BACK_NAME[back.page]}</a>
        <h1 className="font-display text-[40px] leading-none font-bold uppercase tracking-tight">{r.name}</h1>
        <p className="text-[15px] text-muted-foreground">{specs}</p>
      </header>

      <Card className="gap-3 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Strings</Eyebrow>
          <Badge className={cn("text-[11px] font-bold tracking-wider uppercase", toneBadge[st.tone])}>{st.label}</Badge>
        </div>
        <div className="flex items-baseline gap-3">
          <p className="font-display text-5xl leading-none font-bold">{hrs(st.minutes)}<small className="ml-0.5 text-xl text-muted-foreground">h</small></p>
          <p className="text-[15px] text-muted-foreground">{sessions ? `${sessions} ${sessions === 1 ? "session" : "sessions"}` : "No sessions yet"}{since ? ` since ${since}` : (r.jobs || []).length ? ". Press Restrung when new strings go in." : ". Add the Strung on date under Edit."}</p>
        </div>
        {st.left !== null && <Progress value={100 - st.left} className={cn("h-2.5 bg-secondary", toneBar[st.tone])} aria-label="String life used" />}
        <p className="text-[15px]">{st.left !== null && st.label !== "Broken" ? `${st.left}% of string life left.${a.restring_by && a.status !== "now" ? ` Restring by about ${shortDate(a.restring_by)}.` : ""}` : st.line}</p>
        {a.status !== "unknown" && (
          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-semibold text-muted-foreground">What this is based on<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" /></CollapsibleTrigger>
            <CollapsibleContent className="grid gap-2 pt-2 text-sm text-muted-foreground">
              <ul className="grid gap-1.5">
                {a.factors.map((f) => <li key={f.factor} className="flex gap-3"><b className="w-11 shrink-0 text-right text-foreground tabular-nums">{f.life_used_pct}%</b><span>{f.note}</span></li>)}
              </ul>
              <p>The estimate takes the largest of these limits. Hours are weighted by type of play: drills and ball machine wear strings faster than doubles. Your level and style (Settings) and every break you log refine it.</p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </Card>

      <div className="grid grid-cols-4 gap-2">
        <Action icon={<Activity />} label="Measure" href="/?tab=measure" onClick={() => setPrefs({ racket: id })} />
        <Action icon={<RotateCw />} label="Restrung" onClick={() => setRestrungOpen(true)} />
        <Action icon={<Unplug />} label="Strings broke" onClick={broke} disabled={!r.strungOn} />
        <Action icon={<Pencil />} label="Edit" onClick={() => go(`/racket/${id}/edit`)} />
      </div>

      <Tabs defaultValue="timeline" className="gap-3">
        <TabsList className="grid h-11 w-full grid-cols-3 rounded-xl">
          <TabsTrigger value="timeline" className="rounded-lg">Timeline</TabsTrigger>
          <TabsTrigger value="tension" className="rounded-lg">Tension</TabsTrigger>
          <TabsTrigger value="strings" className="rounded-lg">Strings</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline"><Timeline id={id} r={r} unit={unit} /></TabsContent>
        <TabsContent value="tension"><Readings id={id} r={r} unit={unit} /></TabsContent>
        <TabsContent value="strings"><StringHistory id={id} r={r} unit={unit} /></TabsContent>
      </Tabs>

      <RestrungDrawer open={restrungOpen} onOpenChange={setRestrungOpen} id={id} r={r} unit={unit} />
      <EditRacketDrawer open={edit} onOpenChange={(o) => { if (!o) go(`/racket/${id}`, true) }} id={id} r={r} unit={unit} />
    </>
  )
}

function Action({ icon, label, onClick, href, disabled }: { icon: React.ReactNode; label: string; onClick?: () => void; href?: string; disabled?: boolean }) {
  const cls = "h-auto flex-col gap-1.5 rounded-xl bg-card px-1 py-3.5 text-[13px] leading-tight font-semibold whitespace-normal text-foreground shadow-sm [&_svg:not([class*='size-'])]:size-6"
  if (href) return <Button asChild variant="outline" className={cls}><a href={href} onClick={onClick}>{icon}{label}</a></Button>
  return <Button variant="outline" className={cls} onClick={onClick} disabled={disabled}>{icon}{label}</Button>
}

const Row = ({ title, sub, value, onRemove, removeLabel, dot }: { title: string; sub?: string; value?: string; onRemove?: () => void; removeLabel?: string; dot?: string }) => (
  <li className="flex items-center gap-3 py-3">
    {dot && <span className={cn("size-2.5 shrink-0 rounded-full", dot)} aria-hidden="true" />}
    <span className="min-w-0 flex-1"><span className="block font-medium">{title}</span>{sub && <span className="block text-sm text-muted-foreground">{sub}</span>}</span>
    {value && <span className="font-semibold tabular-nums">{value}</span>}
    {onRemove ? <Button variant="ghost" size="icon-sm" aria-label={removeLabel} onClick={onRemove}><X /></Button> : <span className="w-8" />}
  </li>
)

const OUT_NAME: Record<string, string> = { broke: "Strings broke", dead: "Strings went dead", routine: "Old strings out" }

// Everything on this racket, newest first: sessions, readings and restrings.
function Timeline({ id, r, unit }: { id: string; r: Racket; unit: "kg" | "lb" }) {
  const [shown, setShown] = useState(20)
  type Ev = { key: string; t: number; title: string; sub: string; value?: string; dot: string; remove?: () => void; label?: string }
  const ev: Ev[] = []
  for (const p of r.plays || []) ev.push({ key: "p" + p.id, t: Date.parse(p.d + "T12:00:00"), title: KIND_NAME[p.kind] || p.kind, sub: dayName(p.d), value: dur(p.min), dot: "bg-primary", label: "Remove this session", remove: () => { removePlay(p.id); toast("Session removed.", { action: { label: "Undo", onClick: () => restorePlay(id, p as Play) } }) } })
  for (const x of r.readings) ev.push({ key: "r" + x.id, t: x.t, title: "Tension reading", sub: new Date(x.t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + ` · ${Math.round(x.hz)} Hz`, value: `${weight(kgOf(x, r), unit)} ${unit}`, dot: "bg-optic", label: "Remove this reading", remove: () => dropReading(id, x) })
  for (const j of r.jobs || []) ev.push({ key: "j" + j.id, t: Date.parse(j.to + "T00:00:00"), title: OUT_NAME[j.reason] || "Old strings out", sub: `${stringDesc(j, unit)} · lasted ${hrs(minutesBetween(r.plays, j.from, j.to))} h`, dot: j.reason === "broke" ? "bg-bad" : "bg-warn", label: "Remove these strings from the history", remove: () => dropJob(id, j) })
  if (r.strungOn) ev.push({ key: "strung", t: Date.parse(r.strungOn + "T00:00:01"), title: "Strung: " + stringDesc(r, unit), sub: dayName(r.strungOn), dot: "bg-good" })
  ev.sort((a, b) => b.t - a.t)
  return (
    <Card className="gap-0 px-5 py-1">
      {ev.length ? (
        <ol className="divide-y">{ev.slice(0, shown).map((e) => <Row key={e.key} title={e.title} sub={e.sub} value={e.value} dot={e.dot} onRemove={e.remove} removeLabel={e.label} />)}</ol>
      ) : <p className="py-4 text-muted-foreground">Sessions, readings and restrings for this racket show up here.</p>}
      {ev.length > shown && <Button variant="link" className="w-fit px-0" onClick={() => setShown(shown + 20)}>Show older</Button>}
    </Card>
  )
}

function dropReading(id: string, x: Reading) {
  const undo = removeReading(id, x)
  toast("Reading removed.", { action: { label: "Undo", onClick: undo } })
}
function dropJob(id: string, j: Job) {
  const undo = removeJob(id, j)
  toast("Strings removed from the history.", { action: { label: "Undo", onClick: undo } })
}

function Readings({ id, r, unit }: { id: string; r: Racket; unit: "kg" | "lb" }) {
  const rs = r.readings.slice().sort((a, b) => b.t - a.t), base = baseline(r)
  return (
    <Card className="gap-3 px-5 py-4">
      {rs.length >= 2 ? <Suspense fallback={<div className="h-48" />}><TensionChart r={r} unit={unit} /></Suspense> : <p className="text-muted-foreground">{rs.length ? "One reading saved. Save another to see the trend." : "No saved readings for this racket yet. Tap it on Measure, then press Save."}</p>}
      {rs.length > 0 && (
        <ol className="divide-y border-t">
          {rs.map((x) => {
            const kg = kgOf(x, r), loss = base && x.t > base.t ? (1 - kg / kgOf(base, r)) * 100 : null, d = new Date(x.t)
            return <Row key={x.id} title={`${weight(kg, unit)} ${unit}`} sub={d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) + " · " + (loss !== null ? `${loss >= 0 ? "−" : "+"}${Math.abs(loss).toFixed(0)}% since the first reading` : `${Math.round(x.hz)} Hz`)} onRemove={() => dropReading(id, x)} removeLabel="Remove this reading" />
          })}
        </ol>
      )}
      <p className="text-sm text-muted-foreground">{r.calib && r.calib !== 1 ? "Readings are calibrated to your stringer." : "Readings are estimates. Calibrate on Measure right after a restring to match your stringer."}</p>
    </Card>
  )
}

function StringHistory({ id, r, unit }: { id: string; r: Racket; unit: "kg" | "lb" }) {
  const past = (r.jobs || []).slice().sort((a, b) => b.to.localeCompare(a.to))
  return (
    <Card className="gap-0 px-5 py-1">
      <ol className="divide-y">
        {r.strungOn && <Row title={`Now: ${stringDesc(r, unit)}`} sub={`since ${shortDate(r.strungOn)}`} value={`${hrs(minutesBetween(r.plays, r.strungOn, null))} h`} dot="bg-good" />}
        {past.map((j) => <Row key={j.id} title={stringDesc(j, unit)} sub={`${shortDate(j.from)} – ${shortDate(j.to)} · ${REASON_NAMES[j.reason]}`} value={`${hrs(minutesBetween(r.plays, j.from, j.to))} h`} dot={j.reason === "broke" ? "bg-bad" : "bg-warn"} onRemove={() => dropJob(id, j)} removeLabel="Remove these strings from the history" />)}
      </ol>
      {!past.length && <p className="py-4 text-muted-foreground">Each time you restring, press Restrung above. The old strings are kept here with the hours they lasted and why they came out.</p>}
    </Card>
  )
}
