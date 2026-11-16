import { useEffect, useState } from "react"
import { toast } from "sonner"
import { LB } from "@models/tension.js"
import { minutesBetween } from "@models/stringjobs.js"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MaterialSelect } from "@/components/material-select"
import { hrs, shortDate, today, weight } from "@/lib/format"
import { getState, restrung, type Racket } from "@/lib/store"

export const chip = "h-11 rounded-full border border-input bg-card px-4 text-[15px] font-semibold text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"

// Tension typed in the app's unit, as kg; null when empty. Throws a message when out of range.
export function parseTension(v: string, unit: "kg" | "lb"): number | null {
  const t = parseFloat(v)
  if (!Number.isFinite(t) || t <= 0) return null
  const kg = +(unit === "lb" ? t / LB : t).toFixed(2)
  if (kg < 10 || kg > 36) throw new Error(`Tension ${t} ${unit} looks out of range. Strung tensions are usually 18–30 kg (40–65 lb).`)
  return kg
}

// "Restrung": the strings coming out go to the history; the form starts with the current strings.
export function RestrungDrawer({ open, onOpenChange, id, r, unit }: { open: boolean; onOpenChange: (o: boolean) => void; id: string; r: Racket; unit: "kg" | "lb" }) {
  const [why, setWhy] = useState("routine"), [d, setD] = useState(today()), [kg, setKg] = useState(""), [name, setName] = useState(""), [gauge, setGauge] = useState(""), [mat, setMat] = useState("poly")
  const [err, setErr] = useState("")
  // Start from the strings in the racket now, each time the drawer opens.
  useEffect(() => {
    if (open) { setWhy("routine"); setD(today()); setKg(r.strungKg ? weight(r.strungKg, unit) : ""); setName(r.stringName || ""); setGauge(String(r.gauge)); setMat(r.material); setErr("") }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  function save(e: React.FormEvent) {
    e.preventDefault()
    if (d > today()) return setErr("That day hasn't happened yet.")
    if (r.strungOn && d < r.strungOn) return setErr(`That's before the current strings went in (${shortDate(r.strungOn)}).`)
    let strungKg: number | null
    try { strungKg = parseTension(kg, unit) } catch (x) { return setErr((x as Error).message) }
    const g = parseFloat(gauge)
    if (!(g >= 1.05 && g <= 1.45)) return setErr("Gauge should be between 1.05 and 1.45 mm.")
    const job = restrung(id, { day: d, reason: why, stringName: name.trim() || null, gauge: g, material: mat, strungKg })
    onOpenChange(false)
    const plays = getState().rackets[id]?.plays || []
    toast((job ? `Old strings saved to the history (${hrs(minutesBetween(plays, job.from, job.to))} h). ` : "Restring saved. ") + "Tap the new strings on Measure to calibrate them.")
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-xl">
        <form onSubmit={save} className="flex min-h-0 flex-col">
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="font-display text-3xl font-bold uppercase">Restrung</DrawerTitle>
            <DrawerDescription>The strings coming out go to the history. Change what's different about the new ones.</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-4 overflow-y-auto px-4">
            {r.strungOn && (
              <section className="grid gap-2">
                <Label className="text-xs tracking-widest text-muted-foreground uppercase">Old strings came out because</Label>
                <ToggleGroup type="single" spacing={2} className="flex-wrap" value={why} onValueChange={(v) => v && setWhy(v)}>
                  <ToggleGroupItem value="broke" className={chip}>They broke</ToggleGroupItem>
                  <ToggleGroupItem value="dead" className={chip}>Went dead</ToggleGroupItem>
                  <ToggleGroupItem value="routine" className={chip}>Routine</ToggleGroupItem>
                </ToggleGroup>
              </section>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="rs-day">Restrung on</Label><Input id="rs-day" type="date" className="h-11 text-base" max={today()} value={d} onChange={(e) => setD(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="rs-kg">Tension ({unit})</Label><Input id="rs-kg" type="number" inputMode="decimal" step={0.5} className="h-11 text-base" value={kg} onChange={(e) => setKg(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="rs-name">New string</Label><Input id="rs-name" className="h-11 text-base" maxLength={40} placeholder="e.g. ALU Power" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="rs-gauge">Gauge (mm)</Label><Input id="rs-gauge" type="number" inputMode="decimal" step={0.01} min={1.05} max={1.45} className="h-11 text-base" value={gauge} onChange={(e) => setGauge(e.target.value)} /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="rs-mat">String type</Label><MaterialSelect id="rs-mat" value={mat} onChange={setMat} /></div>
            {err && <p role="alert" className="text-sm text-bad">{err}</p>}
          </div>
          <DrawerFooter>
            <Button type="submit" size="lg" className="h-12 text-base">Save restring</Button>
            <DrawerClose asChild><Button type="button" variant="ghost">Cancel</Button></DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
