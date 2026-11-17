import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ChevronRight, EllipsisVertical, Plus } from "lucide-react"
import { currentShoe, shoeWear } from "@models/shoes.js"
import { stringStats } from "@models/stringjobs.js"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Eyebrow } from "@/components/eyebrow"
import { TitleBar } from "@/components/title-bar"
import { toneBadge, toneBar, toneDot, toneText } from "@/components/tone"
import { hrs, shortDate, today, unitFor, weight } from "@/lib/format"
import { kgOf, latestReading, racketState, stringDesc } from "@/lib/racket"
import { go } from "@/lib/route"
import { addRacket, newPair, putShoe, removeShoe, useStore, type Shoe } from "@/lib/store"
import { cn } from "@/lib/utils"

const WEAR_TONE = { good: "good", soon: "warn", now: "bad", retired: "none" } as const

export function Gear() {
  const rackets = useStore((s) => s.rackets)
  const profile = useStore((s) => s.profile)
  const prefs = useStore((s) => s.prefs)
  const shoes = useStore((s) => s.shoes)
  const [pairOpen, setPairOpen] = useState(false)
  const [lifeOpen, setLifeOpen] = useState(false)
  const day = today(), unit = unitFor(prefs)
  const ids = Object.keys(rackets).sort((a, b) => rackets[a].name.localeCompare(rackets[b].name))
  const cur = currentShoe(shoes), wear = cur ? shoeWear(cur, rackets) : null
  const past = shoes.filter((x) => x !== cur).sort((a, b) => b.startedOn.localeCompare(a.startedOn))
  const stats = stringStats(rackets)

  function remove(x: Shoe) {
    const undo = removeShoe(x)
    toast(`${x.name} removed.`, { action: { label: "Undo", onClick: undo } })
  }

  return (
    <>
      <TitleBar title="Gear" />

      <section className="grid gap-2" aria-labelledby="h-rackets">
        <Eyebrow as="h2" className="ml-1"><span id="h-rackets">Rackets</span></Eyebrow>
        {ids.length > 0 && (
          <Card className="gap-0 py-1">
            {ids.map((id, i) => {
              const r = rackets[id], s = racketState(r, rackets, profile, day), last = latestReading(r)
              return (
                <a key={id} href={`#/racket/${id}`} className={cn("flex items-center gap-3 px-5 py-3.5", i > 0 && "border-t")}>
                  <span className={cn("size-2.5 shrink-0 rounded-full", toneDot[s.tone])} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {[s.left === null ? s.label : `${s.left}% left`, `${hrs(s.minutes)} h`, stringDesc(r, unit), last ? `last ${weight(kgOf(last, r), unit)} ${unit}` : ""].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </a>
              )
            })}
          </Card>
        )}
        <Button variant="outline" className="w-fit rounded-full" onClick={() => go(`/racket/${addRacket()}/edit`)}><Plus />Add a racket</Button>
      </section>

      <section className="grid gap-2" aria-labelledby="h-shoes">
        <Eyebrow as="h2" className="ml-1"><span id="h-shoes">Shoes</span></Eyebrow>
        <Card className="gap-3 px-5 py-4">
          {cur && wear ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <Eyebrow>Pair in use</Eyebrow>
                <div className="flex items-center gap-1">
                  <Badge className={cn("text-[11px] font-bold tracking-wider uppercase", toneBadge[WEAR_TONE[wear.status]])}>{wear.label}</Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${cur.name}`}><EllipsisVertical /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setLifeOpen(true)}>Change expected life</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => remove(cur)}>Remove (added by mistake)</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <p className="font-display text-5xl leading-none font-bold">{wear.hours}<small className="ml-1 text-xl text-muted-foreground">/ {wear.life} h</small></p>
              <Progress value={Math.min(100, wear.used * 100)} className={cn("h-2.5 bg-secondary", toneBar[WEAR_TONE[wear.status]])} aria-label="Shoe life used" />
              <p className={cn("text-[15px]", wear.status === "now" ? toneText.bad : "text-muted-foreground")}>
                {cur.name}, since {shortDate(cur.startedOn)}. {wear.status === "now" ? "Past their expected life: check the outsole at the big toe." : `About ${wear.left} h left of ${wear.life}.`}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Add the pair you play in. Every session you log, on any racket, counts toward it, and you'll see when the outsoles are due.</p>
          )}
          {past.length > 0 && (
            <ol className="divide-y border-t">
              {past.map((x) => (
                <li key={x.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 text-sm">{x.name}<span className="block text-muted-foreground">{shortDate(x.startedOn)} – {x.retiredOn ? shortDate(x.retiredOn) : "now"}</span></span>
                  <span className="font-semibold tabular-nums">{shoeWear(x, rackets).hours} h</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${x.name}`}><EllipsisVertical /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => remove(x)}>Remove this pair</DropdownMenuItem></DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ol>
          )}
          <Button variant="outline" className="w-fit rounded-full" onClick={() => setPairOpen(true)}><Plus />New pair</Button>
        </Card>
      </section>

      <section className="grid gap-2" aria-labelledby="h-strings">
        <Eyebrow as="h2" className="ml-1"><span id="h-strings">Strings</span></Eyebrow>
        <Card className="gap-2 px-5 py-4">
          <p className="font-semibold">How long each string lasts you</p>
          {stats.length ? (
            <ul className="divide-y">
              {stats.map((st) => (
                <li key={st.string} className="flex items-baseline gap-3 py-2.5">
                  <b className="w-16 shrink-0 font-display text-2xl">{st.avgHours} h</b>
                  <span className="text-sm text-muted-foreground">
                    <span className="block font-medium text-foreground">{st.string}</span>
                    average over {st.jobs} {st.jobs === 1 ? "set" : "sets"}{st.jobs > 1 ? ` (${st.minHours}–${st.maxHours} h)` : ""}{st.broke ? `, broke ${st.broke}×` : ""}{st.dead ? `, went dead ${st.dead}×` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted-foreground">Once you record a restring, this compares every string you've used: average hours and how often it broke.</p>}
        </Card>
      </section>

      <NewPairDrawer open={pairOpen} onOpenChange={setPairOpen} current={cur} shoes={shoes} />
      {cur && wear && <LifeDrawer open={lifeOpen} onOpenChange={setLifeOpen} shoe={cur} life={wear.life} />}
    </>
  )
}

// A new pair's expected life: what your retired pairs actually lasted, once there are some.
function typicalLife(shoes: Shoe[], rackets: Parameters<typeof shoeWear>[1]) {
  const done = shoes.filter((x) => x.retiredOn).map((x) => shoeWear(x, rackets).hours).filter((h) => h >= 10)
  return done.length ? Math.round(done.reduce((a, b) => a + b, 0) / done.length / 5) * 5 : 60
}

function NewPairDrawer({ open, onOpenChange, current, shoes }: { open: boolean; onOpenChange: (o: boolean) => void; current: Shoe | null; shoes: Shoe[] }) {
  const rackets = useStore((s) => s.rackets)
  const [name, setName] = useState(""), [from, setFrom] = useState(today()), [life, setLife] = useState("")
  const [err, setErr] = useState("")
  useEffect(() => { if (open) { setName(""); setFrom(today()); setLife(String(typicalLife(shoes, rackets))); setErr("") } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  function save(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim(), l = parseInt(life, 10)
    if (!n) return setErr("Name the shoes, for example NB 996v6 2E.")
    if (from > today()) return setErr("That day hasn't happened yet.")
    if (current && from < current.startedOn) return setErr(`That's before ${current.name} went into use (${shortDate(current.startedOn)}).`)
    newPair(n, from, Number.isFinite(l) ? Math.min(500, Math.max(10, l)) : 60, current)
    onOpenChange(false)
    toast(current ? `${current.name} retired after ${shoeWear(current, rackets).hours} h. ${n} are in use.` : `${n} added. Every session you log counts toward them.`)
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-xl">
        <form onSubmit={save}>
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="font-display text-3xl font-bold uppercase">New pair</DrawerTitle>
            <DrawerDescription>{current ? `${current.name} is retired on the day the new pair goes into use.` : "Every session you log, on any racket, counts toward this pair."}</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-4 px-4">
            <div className="grid gap-1.5"><Label htmlFor="sh-name">Shoes</Label><Input id="sh-name" className="h-11 text-base" maxLength={60} placeholder="e.g. NB 996v6 2E" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="sh-from">In use from</Label><Input id="sh-from" type="date" className="h-11 text-base" max={today()} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="sh-life">Expected life (h)</Label><Input id="sh-life" type="number" inputMode="numeric" className="h-11 text-base" min={10} max={500} step={5} value={life} onChange={(e) => setLife(e.target.value)} /></div>
            </div>
            {err && <p role="alert" className="text-sm text-bad">{err}</p>}
          </div>
          <DrawerFooter>
            <Button type="submit" size="lg" className="h-12 text-base">Save pair</Button>
            <DrawerClose asChild><Button type="button" variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}

function LifeDrawer({ open, onOpenChange, shoe, life }: { open: boolean; onOpenChange: (o: boolean) => void; shoe: Shoe; life: number }) {
  const [v, setV] = useState(String(life))
  useEffect(() => { if (open) setV(String(life)) }, [open, life])
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); const n = parseInt(v, 10); putShoe({ ...shoe, lifeHours: Number.isFinite(n) ? Math.min(500, Math.max(10, n)) : 60 }); onOpenChange(false) }}>
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="font-display text-3xl font-bold uppercase">Expected life</DrawerTitle>
            <DrawerDescription>How many hours of play {shoe.name} should last before the outsoles are done.</DrawerDescription>
          </DrawerHeader>
          <div className="flex items-center gap-2 px-4">
            <Input type="number" inputMode="numeric" min={10} max={500} step={5} className="h-11 w-28 text-base" value={v} onChange={(e) => setV(e.target.value)} aria-label="Expected life in hours" autoFocus />
            <span className="text-muted-foreground">hours</span>
          </div>
          <DrawerFooter>
            <Button type="submit" size="lg" className="h-12 text-base">Save</Button>
            <DrawerClose asChild><Button type="button" variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
