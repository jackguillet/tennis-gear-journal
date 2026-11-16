import { useEffect, useState } from "react"
import { currentShoe } from "@models/shoes.js"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DURS, KINDS, dur, today } from "@/lib/format"
import { useStore, type PlayKind } from "@/lib/store"

const chip = "h-11 rounded-full border border-input bg-card px-4 text-[15px] font-semibold text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"

export interface LogChoice { racketId: string; kind: PlayKind; min: number; d: string }

// "Something else": pick the racket, type of play, how long and the day.
export function LogDrawer({ open, onOpenChange, racketId, kind, min, onLog }: {
  open: boolean; onOpenChange: (o: boolean) => void; racketId: string; kind: PlayKind; min: number; onLog: (c: LogChoice) => void
}) {
  const rackets = useStore((s) => s.rackets)
  const shoes = useStore((s) => s.shoes)
  const [rid, setRid] = useState(racketId), [k, setK] = useState<PlayKind>(kind), [m, setM] = useState(String(min)), [other, setOther] = useState(""), [d, setD] = useState(today())
  useEffect(() => { if (open) { setRid(racketId); setK(kind); setM(DURS.some(([v]) => v === min) ? String(min) : "0"); setOther(DURS.some(([v]) => v === min) ? "" : String(min)); setD(today()) } }, [open, racketId, kind, min])
  const minutes = m === "0" ? Math.round(Number(other)) : Number(m)
  const ok = rid && minutes >= 5 && minutes <= 600 && d && d <= today()
  const shoe = currentShoe(shoes)
  const ids = Object.keys(rackets).sort((a, b) => rackets[a].name.localeCompare(rackets[b].name))

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-xl">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="font-display text-3xl font-bold uppercase">Log play</DrawerTitle>
          <DrawerDescription>{shoe ? `Counts toward your ${shoe.name} too.` : "Counts toward the racket's strings."}</DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-5 overflow-y-auto px-4">
          {ids.length > 1 && (
            <section className="grid gap-2">
              <Label className="text-xs tracking-widest text-muted-foreground uppercase">Racket</Label>
              <ToggleGroup type="single" spacing={2} className="flex-wrap" value={rid} onValueChange={(v) => v && setRid(v)}>
                {ids.map((id) => <ToggleGroupItem key={id} value={id} className={chip}>{rackets[id].name}</ToggleGroupItem>)}
              </ToggleGroup>
            </section>
          )}
          <section className="grid gap-2">
            <Label className="text-xs tracking-widest text-muted-foreground uppercase">Type</Label>
            <ToggleGroup type="single" spacing={2} className="flex-wrap" value={k} onValueChange={(v) => v && setK(v as PlayKind)}>
              {KINDS.map(([v, label]) => <ToggleGroupItem key={v} value={v} className={chip}>{label}</ToggleGroupItem>)}
            </ToggleGroup>
          </section>
          <section className="grid gap-2">
            <Label className="text-xs tracking-widest text-muted-foreground uppercase">Time</Label>
            <ToggleGroup type="single" spacing={2} className="flex-wrap" value={m} onValueChange={(v) => v && setM(v)}>
              {DURS.map(([v, label]) => <ToggleGroupItem key={v} value={String(v)} className={chip}>{label}</ToggleGroupItem>)}
              <ToggleGroupItem value="0" className={chip}>Other</ToggleGroupItem>
            </ToggleGroup>
            {m === "0" && (
              <div className="flex items-center gap-2">
                <Input type="number" inputMode="numeric" min={5} max={600} placeholder="75" value={other} onChange={(e) => setOther(e.target.value)} className="h-11 w-28 text-base" aria-label="Minutes" />
                <span className="text-muted-foreground">minutes</span>
              </div>
            )}
          </section>
          <section className="grid gap-2">
            <Label htmlFor="log-day" className="text-xs tracking-widest text-muted-foreground uppercase">Day</Label>
            <Input id="log-day" type="date" max={today()} value={d} onChange={(e) => setD(e.target.value)} className="h-11 w-48 text-base" />
          </section>
        </div>
        <DrawerFooter>
          <Button size="lg" className="h-14 text-lg font-semibold" disabled={!ok} onClick={() => onLog({ racketId: rid, kind: k, min: minutes, d })}>
            {ok ? `Log ${dur(minutes)} of ${KINDS.find(([v]) => v === k)![1].toLowerCase()}` : "Pick a time between 5 min and 10 h"}
          </Button>
          <DrawerClose asChild><Button variant="ghost">Cancel</Button></DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
