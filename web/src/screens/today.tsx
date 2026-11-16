import { useState } from "react"
import { toast } from "sonner"
import { ChevronRight, X } from "lucide-react"
import { currentShoe, shoeWear } from "@models/shoes.js"
import { DEFAULT_TZ, planTitle } from "@models/courts.js"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { LifeRing } from "@/components/life-ring"
import { TitleBar } from "@/components/title-bar"
import { toneBadge, toneBar, toneDot, toneText } from "@/components/tone"
import { KIND_NAME, ago, dayName, dur, hrs, shortDate, today, unitFor, weight } from "@/lib/format"
import { baseline, kgOf, latestReading, racketState } from "@/lib/racket"
import { addPlay, mainRacketId, makeMain, removePlay, restorePlay, useStore, type Play, type PlayKind } from "@/lib/store"
import { cn } from "@/lib/utils"
import { LogDrawer, type LogChoice } from "./log-drawer"

const Eyebrow = ({ children, className }: { children: React.ReactNode; className?: string }) =>
  <p className={cn("text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase", className)}>{children}</p>

export function Today() {
  const rackets = useStore((s) => s.rackets)
  const prefs = useStore((s) => s.prefs)
  const profile = useStore((s) => s.profile)
  const shoes = useStore((s) => s.shoes)
  const bookings = useStore((s) => s.bookings)
  const plans = useStore((s) => s.plans)
  const [logOpen, setLogOpen] = useState(false)
  const day = today(), unit = unitFor(prefs)
  const mainId = mainRacketId({ rackets, prefs })
  const usualKind: PlayKind = prefs.lastKind || prefs.kind || "singles"
  const usualMin = prefs.lastMin || (prefs.dur && prefs.dur > 0 ? prefs.dur : 90)

  function log(c: LogChoice) {
    const r = rackets[c.racketId]; if (!r) return
    const p = addPlay(c.racketId, { d: c.d, min: c.min, kind: c.kind })
    setLogOpen(false)
    toast(`Logged ${dur(c.min)} of ${KIND_NAME[c.kind].toLowerCase()}${c.d !== day ? " on " + shortDate(c.d) : ""} on ${r.name}.`, { action: { label: "Undo", onClick: () => removePlay(p.id) } })
  }
  function remove(racketId: string, p: Play) {
    removePlay(p.id)
    toast("Session removed.", { action: { label: "Undo", onClick: () => restorePlay(racketId, p) } })
  }

  const kicker = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
  if (!mainId) {
    return (
      <>
        <TitleBar title="Today" kicker={kicker} />
        <Card className="border-2 border-dashed border-primary/40 shadow-none">
          <CardContent className="grid gap-3">
            <p className="text-xl font-bold">Set up your racket</p>
            <p className="text-muted-foreground">Add its name, string, tension and the day it was strung, and Today shows how much life is left in the strings.</p>
            <Button asChild size="lg" className="w-fit"><a href="/?tab=gear">Set up my racket</a></Button>
          </CardContent>
        </Card>
      </>
    )
  }

  const main = rackets[mainId]
  const st = racketState(main, rackets, profile, day)
  const others = Object.keys(rackets).filter((id) => id !== mainId).sort((a, b) => rackets[a].name.localeCompare(rackets[b].name))
  const shoe = currentShoe(shoes), wear = shoe ? shoeWear(shoe, rackets) : null
  const wearTone = wear ? ({ good: "good", soon: "warn", now: "bad", retired: "none" } as const)[wear.status] : "none"
  const lastR = latestReading(main), base = baseline(main)
  const loss = lastR && base && lastR.t > base.t ? (1 - kgOf(lastR, main) / kgOf(base, main)) * 100 : null
  const now = Date.now()
  const next = bookings.filter((b) => !b.cancelled && b.start + b.min * 60000 > now).sort((a, b) => a.start - b.start)[0]
  const tz = next?.tz || DEFAULT_TZ
  const recent = Object.entries(rackets).flatMap(([id, r]) => (r.plays || []).map((p) => [id, p] as const)).sort((a, b) => b[1].d.localeCompare(a[1].d)).slice(0, 4)

  return (
    <>
      <TitleBar title="Today" kicker={kicker} />

      {/* String life of the racket you play with */}
      <a href="/?tab=gear" aria-label={`${main.name}: ${st.label}. ${st.line}`} className="block rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <Card className="flex-row items-center gap-5 px-5 py-5">
          <LifeRing left={st.left} tone={st.tone} />
          <div className="grid min-w-0 gap-1">
            <Badge className={cn("text-[11px] font-bold tracking-wider uppercase", toneBadge[st.tone])}>{st.label}</Badge>
            <p className="truncate text-xl font-bold">{main.name}</p>
            <p className="text-[15px] leading-snug text-muted-foreground">{st.line}</p>
          </div>
        </Card>
      </a>

      {others.length > 0 && (
        <Card className="gap-0 py-1">
          {others.map((id, i) => {
            const s = racketState(rackets[id], rackets, profile, day)
            return (
              <div key={id} className={cn("flex items-center gap-3 px-5 py-3", i > 0 && "border-t")}>
                <span className={cn("size-2.5 shrink-0 rounded-full", toneDot[s.tone])} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{rackets[id].name}</span>
                  <span className="block text-sm text-muted-foreground">{s.left === null ? s.label : `${s.left}% left · ${hrs(s.minutes)} h`}</span>
                </span>
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => { makeMain(id); toast(`${rackets[id].name} is your main racket. Today and one-tap logging follow it.`) }}>Make main</Button>
              </div>
            )
          })}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <a href="/?tab=gear" className="block rounded-xl">
          <Card className="h-full gap-2 px-5 py-4">
            <Eyebrow>Shoes</Eyebrow>
            {shoe && wear ? (
              <>
                <p className="font-display text-4xl leading-none font-bold">{wear.hours}<small className="ml-1 text-lg text-muted-foreground">/ {wear.life} h</small></p>
                <Progress value={Math.min(100, wear.used * 100)} className={cn("h-2 bg-secondary", toneBar[wearTone])} aria-label="Shoe wear" />
                <p className={cn("text-sm", wear.status === "good" ? "text-muted-foreground" : toneText[wearTone])}>{wear.status === "good" ? shoe.name : `${wear.label}: ${shoe.name}`}</p>
              </>
            ) : (
              <>
                <p className="font-display text-4xl leading-none font-bold">Add</p>
                <p className="text-sm text-muted-foreground">the pair you play in</p>
              </>
            )}
          </Card>
        </a>
        <a href="/?tab=measure" className="block rounded-xl">
          <Card className="h-full gap-2 px-5 py-4">
            <Eyebrow>Tension</Eyebrow>
            {lastR ? (
              <>
                <p className="font-display text-4xl leading-none font-bold">{weight(kgOf(lastR, main), unit)}<small className="ml-1 text-lg text-muted-foreground">{unit}</small></p>
                <p className={cn("text-sm", loss !== null && loss >= 20 ? "text-bad" : loss !== null && loss >= 10 ? "text-warn" : "text-muted-foreground")}>
                  {loss !== null ? `${loss >= 0 ? "−" : "+"}${Math.abs(loss).toFixed(0)}% since ${shortDate(new Date(base!.t).toLocaleDateString("en-CA"))}` : `saved ${ago(lastR.t)}`}
                </p>
                <p className="text-sm text-muted-foreground">{loss !== null ? `last ${ago(lastR.t)}` : main.strungKg ? `strung at ${weight(main.strungKg, unit)}` : ""}</p>
              </>
            ) : (
              <>
                <p className="font-display text-4xl leading-none font-bold text-muted-foreground" aria-label="None">—</p>
                <p className="text-sm text-muted-foreground">No reading yet. Tap to measure.</p>
              </>
            )}
          </Card>
        </a>
      </div>

      <a href="/?tab=courts" className="block rounded-xl">
        <Card className="gap-3 px-5 py-4">
          <Eyebrow>Next court</Eyebrow>
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-[52px] shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
              {next ? (
                <span className="text-center leading-none">
                  <small className="block text-[11px] font-bold uppercase">{new Date(next.start).toLocaleDateString(undefined, { timeZone: tz, weekday: "short" })}</small>
                  <b className="font-display text-2xl">{new Date(next.start).toLocaleDateString(undefined, { timeZone: tz, day: "numeric" })}</b>
                </span>
              ) : "–"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{next ? `${next.start <= now ? "On now · " : ""}${new Date(next.start).toLocaleTimeString(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" })}${next.court ? " · " + next.court : ""}` : "No court booked"}</span>
              <span className="block text-sm text-muted-foreground">
                {next ? `${new Date(next.start).toLocaleDateString(undefined, { timeZone: tz, month: "short", day: "numeric" })} · ${KIND_NAME[next.kind || "singles"] || "Tennis"} · ${dur(next.min)}`
                  : plans.filter((p) => !p.paused).length ? "Requests: " + plans.filter((p) => !p.paused).slice(0, 2).map((p) => (p.date ? "" : "every ") + planTitle(p)).join(", ") : "Add a booking or request a court"}
              </span>
            </span>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
        </Card>
      </a>

      <section className="grid gap-2" aria-label="Log a session">
        <Eyebrow className="ml-1">Log a session</Eyebrow>
        <div className="grid grid-cols-2 gap-3">
          <Button className="h-auto flex-col items-start gap-0.5 rounded-xl px-5 py-4 text-left whitespace-normal"
            aria-label={`Log ${dur(usualMin)} of ${KIND_NAME[usualKind].toLowerCase()} today on ${main.name}`}
            onClick={() => log({ racketId: mainId, kind: usualKind, min: usualMin, d: day })}>
            <span className="text-lg font-bold">{KIND_NAME[usualKind]} {dur(usualMin)}</span>
            <span className="text-sm font-normal opacity-85">{prefs.lastKind ? "same as last time" : "log today"} · {main.name}</span>
          </Button>
          <Button variant="outline" className="h-auto flex-col items-start gap-0.5 rounded-xl border-2 border-primary px-5 py-4 text-left whitespace-normal text-primary" onClick={() => setLogOpen(true)}>
            <span className="text-lg font-bold">Something else</span>
            <span className="text-sm font-normal">type, time, day</span>
          </Button>
        </div>
      </section>

      <Card className="gap-2 px-5 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Recent sessions</h2>
        </div>
        {recent.length ? (
          <ol className="divide-y">
            {recent.map(([id, p]) => (
              <li key={p.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{KIND_NAME[p.kind] || p.kind}</span>
                  <span className="block text-sm text-muted-foreground">{dayName(p.d)}{Object.keys(rackets).length > 1 ? " · " + rackets[id].name : ""}</span>
                </span>
                <span className="font-semibold tabular-nums">{dur(p.min)}</span>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${KIND_NAME[p.kind]} on ${dayName(p.d)}`} onClick={() => remove(id, p)}><X /></Button>
              </li>
            ))}
          </ol>
        ) : <p className="py-2 text-muted-foreground">No sessions yet. Log one above after you play.</p>}
      </Card>

      <LogDrawer open={logOpen} onOpenChange={setLogOpen} racketId={mainId} kind={usualKind} min={usualMin} onLog={log} />
    </>
  )
}
