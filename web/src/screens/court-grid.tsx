import { useState } from "react"
import { SlidersHorizontal } from "lucide-react"
import { AREA_ORDER, SHEET_URL, WAITLIST_URL, bookUrl, gridDay, type CellState } from "@models/courts.js"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Eyebrow } from "@/components/eyebrow"
import { AREA_LABEL, TZ, addDay, clockMin, clubToday, soonAt } from "@/lib/courts"
import { ago } from "@/lib/format"
import { setPrefs, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { chip } from "./restrung"

const PARTS: [string, string][] = [["all", "All day"], ["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"]]
const CELL: Record<CellState, string> = {
  open: "bg-good text-white", soon: "bg-good-soft text-good", taken: "bg-muted", mine: "bg-primary text-primary-foreground",
  lesson: "bg-warn-soft text-warn", event: "bg-warn-soft text-warn", past: "", closed: "",
}
const TXT: Partial<Record<CellState, string>> = { mine: "You", lesson: "L", event: "E" }
const NAME: Partial<Record<CellState, string>> = { soon: "not open yet", taken: "taken", mine: "your booking", lesson: "lesson time", event: "club event" }
const ext = { target: "_blank", rel: "noopener" }

// The court sheet the GameTime button last read, one day at a time: tap an open time to book it on GameTime.
export function CourtGrid() {
  const sheet = useStore((s) => s.courtSheet)
  const prefs = useStore((s) => s.prefs)
  const bookings = useStore((s) => s.bookings)
  const win = useStore((s) => s.window)
  const [filters, setFilters] = useState(false)
  const [pick, setPick] = useState<{ date: string; court: string; id: number; start: number; state: CellState; opensAt?: number } | null>(null)
  const now = Date.now(), first = clubToday(now)
  const days = Array.from({ length: 8 }, (_, i) => addDay(first, i))
  const day = days.includes(prefs.gridDay as string) ? (prefs.gridDay as string) : first
  const areas = Array.isArray(prefs.gridAreas) && prefs.gridAreas.length ? (prefs.gridAreas as string[]).filter((a) => AREA_ORDER.includes(a)) : ["indoor", "outdoor"]
  const part = PARTS.some(([p]) => p === prefs.gridPart) ? (prefs.gridPart as string) : "all"
  const sheetDay = sheet.find((x) => x.date === day)
  const latest = sheet.reduce((m, x) => Math.max(m, x.at || 0), 0)
  const g = gridDay(sheetDay, { areas, part, now, days: win.days, bookings, tz: TZ })
  const label = (d: string, i: number) => i === 0 ? "Today" : i === 1 ? "Tmrw" : new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
  // Each area's name spans its courts.
  const span = (i: number) => { let n = 1; while (g.courts[i + n] && !g.courts[i + n].first) n++; return n }
  const filterLine = areas.map((a) => AREA_LABEL[a]).join(", ") + " · " + PARTS.find(([p]) => p === part)![1]

  return (
    <section className="grid min-w-0 gap-2" aria-labelledby="h-grid">
      <div className="ml-1 flex items-baseline justify-between gap-2">
        <Eyebrow as="h2"><span id="h-grid">Open courts</span></Eyebrow>
        {latest > 0 && <a {...ext} href={SHEET_URL} className="text-sm font-semibold text-primary" title="Open GameTime and tap your STC courts button to read the latest sheet">{sheetDay ? `Seen ${ago(sheetDay.at)} · refresh` : "Refresh on GameTime"}</a>}
      </div>
      <Card className="min-w-0 gap-3 px-3 py-3">
        <ToggleGroup type="single" spacing={1} value={day} aria-label="Day to show" className="-mx-1 w-auto justify-start overflow-x-auto px-1 pb-1"
          onValueChange={(d) => { if (d) { setPrefs({ gridDay: d }); setPick(null) } }}>
          {days.map((d, i) => (
            <ToggleGroupItem key={d} value={d} aria-label={i < 2 ? label(d, i) : new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
              className={cn("h-14 min-w-12 shrink-0 flex-col gap-0 rounded-xl px-2 text-[13px] font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground", !sheet.some((x) => x.date === d) && "opacity-60")}>
              {label(d, i)}<span className="text-base leading-none font-bold">{+d.slice(8)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button variant="outline" size="sm" className="w-fit rounded-full" onClick={() => setFilters(true)}><SlidersHorizontal />{filterLine}</Button>

        {g.rows.length ? (
          <>
            <div className="-mx-3 overflow-x-auto px-3">
              <table className="w-full border-separate border-spacing-0.5 text-center text-xs">
                <thead>
                  <tr>
                    <th />
                    {g.courts.map((c, i) => c.first && (
                      <th key={c.name} colSpan={span(i)}
                        className={cn("pb-0.5 text-left text-[10px] font-semibold tracking-wider text-muted-foreground uppercase", i > 0 && "pl-2")}>{AREA_LABEL[c.area]}</th>
                    ))}
                  </tr>
                  <tr>
                    <th />
                    {g.courts.map((c, i) => <th key={c.name} scope="col" className={cn("font-semibold text-muted-foreground", c.first && i > 0 && "pl-2")}>{c.name.replace(/^Court\s*/i, "")}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.start}>
                      <th scope="row" className="pr-1 text-right font-semibold whitespace-nowrap text-muted-foreground">{clockMin(r.start)}</th>
                      {r.cells.map((cell, i) => {
                        const c = g.courts[i], sel = pick && pick.date === day && pick.court === c.name && pick.start === r.start
                        const cls = cn("grid h-8 min-w-7 place-items-center rounded-md text-[10px] font-bold", CELL[cell.state], sel && "ring-2 ring-foreground")
                        return (
                          <td key={c.name} className={cn(c.first && i > 0 && "pl-2")}>
                            {cell.state === "open" ? <a {...ext} href={bookUrl(c.id, day, r.start)} className={cls} aria-label={`Book ${c.name} at ${clockMin(r.start)}, ${cell.minutes} minutes`} />
                              : cell.state === "past" || cell.state === "closed" ? <span className={cls} />
                                : <button type="button" className={cls} aria-label={`${c.name} at ${clockMin(r.start)}: ${NAME[cell.state]}`}
                                  onClick={() => setPick({ date: day, court: c.name, id: c.id, start: r.start, state: cell.state, opensAt: cell.opensAt })}>{TXT[cell.state] || ""}</button>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
              <span><i className="mr-1 inline-block size-3 rounded-sm bg-good align-[-2px]" />open, tap to book</span>
              <span><i className="mr-1 inline-block size-3 rounded-sm bg-good-soft align-[-2px]" />not open yet</span>
              <span><i className="mr-1 inline-block size-3 rounded-sm bg-muted align-[-2px]" />taken</span>
              <span><i className="mr-1 inline-block size-3 rounded-sm bg-primary align-[-2px]" />yours</span>
              <span>L lesson · E event</span>
            </p>
            {pick && pick.date === day && <Picked {...pick} />}
          </>
        ) : (
          <p className="px-2 py-3 text-[15px] text-muted-foreground">
            {!latest ? <>Courts show up here once your STC courts button has read GameTime. Open <a {...ext} href={SHEET_URL} className="font-semibold text-primary">GameTime</a>, sign in and tap the button. <a href="/?tab=settings" className="font-semibold text-primary">Set up the button</a></>
              : !sheetDay ? "The button hasn't read this day yet. Tap it on GameTime to fill in the week."
                : `No court times left ${part === "all" ? "that day" : "in the " + part} on these courts.`}
          </p>
        )}
      </Card>

      <Drawer open={filters} onOpenChange={setFilters}>
        <DrawerContent className="mx-auto max-w-xl">
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="font-display text-3xl font-bold uppercase">Filters</DrawerTitle>
            <DrawerDescription>Which courts and what time of day the grid shows.</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-4 px-4">
            <div className="grid gap-2">
              <Label className="text-xs tracking-widest text-muted-foreground uppercase">Courts</Label>
              <ToggleGroup type="multiple" spacing={2} className="flex-wrap" value={areas} onValueChange={(v) => v.length && setPrefs({ gridAreas: v })}>
                {AREA_ORDER.map((a) => <ToggleGroupItem key={a} value={a} className={chip}>{AREA_LABEL[a]}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs tracking-widest text-muted-foreground uppercase">Time of day</Label>
              <ToggleGroup type="single" spacing={2} className="flex-wrap" value={part} onValueChange={(v) => v && setPrefs({ gridPart: v })}>
                {PARTS.map(([p, l]) => <ToggleGroupItem key={p} value={p} className={chip}>{l}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
          </div>
          <DrawerFooter><DrawerClose asChild><Button size="lg" className="h-12 text-base">Done</Button></DrawerClose></DrawerFooter>
        </DrawerContent>
      </Drawer>
    </section>
  )
}

// What a tapped cell means, and what can be done about it.
function Picked({ date, court, id, start, state, opensAt }: { date: string; court: string; id: number; start: number; state: CellState; opensAt?: number }) {
  const when = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) + " " + clockMin(start)
  const a = "font-semibold text-primary"
  return (
    <p role="status" className="rounded-xl bg-secondary px-3 py-2 text-sm text-secondary-foreground">
      <b>{court} · {when}: </b>
      {state === "soon" ? <>open, but GameTime only takes it from {soonAt(opensAt || 0)}. <a {...ext} className={a} href={bookUrl(id, date, start)}>Its booking form</a></>
        : state === "taken" ? <>taken. If it's cancelled, GameTime offers it to the first group on its waitlist. <a {...ext} className={a} href={WAITLIST_URL}>Join the waitlist</a></>
          : state === "mine" ? "your booking."
            : state === "lesson" ? <>lesson time a pro is holding. The Pro Shop can say if it's free: <a className={a} href="tel:+12063245454">(206) 324-5454</a>.</>
              : "a club event or clinic."}
    </p>
  )
}
