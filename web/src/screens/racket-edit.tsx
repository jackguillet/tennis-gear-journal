import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MaterialSelect, OptionSelect, PATTERNS } from "@/components/material-select"
import { weight } from "@/lib/format"
import { go } from "@/lib/route"
import { deleteRacket, putRacket, type Racket } from "@/lib/store"
import { parseTension } from "./restrung"

type Form = { name: string; stringName: string; material: string; gauge: string; strungKg: string; strungOn: string; pattern: string; head: string; weight: string }
const toForm = (r: Racket, unit: "kg" | "lb"): Form => ({
  name: r.name, stringName: r.stringName || "", material: r.material, gauge: String(r.gauge), strungKg: r.strungKg ? weight(r.strungKg, unit) : "",
  strungOn: r.strungOn || "", pattern: r.pattern || "16x19", head: String(r.head), weight: r.weight ? String(r.weight) : "",
})

// Edit a racket's name, strings and frame; calibration and Delete live here too.
export function EditRacketDrawer({ open, onOpenChange, id, r, unit }: { open: boolean; onOpenChange: (o: boolean) => void; id: string; r: Racket; unit: "kg" | "lb" }) {
  const [f, setF] = useState<Form>(() => toForm(r, unit))
  const [err, setErr] = useState("")
  useEffect(() => { if (open) { setF(toForm(r, unit)); setErr("") } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof Form) => (e: { target: { value: string } } | string) => setF({ ...f, [k]: typeof e === "string" ? e : e.target.value })
  const calibrated = !!r.calib && r.calib !== 1

  function save(e: React.FormEvent) {
    e.preventDefault()
    const name = f.name.trim(), gauge = parseFloat(f.gauge), head = parseInt(f.head, 10), w = f.weight ? parseInt(f.weight, 10) : null
    if (!name) return setErr("Give the racket a name.")
    if (!(gauge >= 1.05 && gauge <= 1.45)) return setErr("Gauge should be between 1.05 and 1.45 mm.")
    if (!(head >= 85 && head <= 125)) return setErr("Head size should be between 85 and 125 sq in.")
    if (w !== null && !(w >= 200 && w <= 400)) return setErr("Weight should be between 200 and 400 g.")
    let strungKg: number | null
    try { strungKg = parseTension(f.strungKg, unit) } catch (x) { return setErr((x as Error).message) }
    putRacket(id, { name, stringName: f.stringName.trim() || null, material: f.material, gauge, strungKg, strungOn: f.strungOn || null, pattern: f.pattern, head, weight: w })
    onOpenChange(false)
  }
  function remove() {
    const undo = deleteRacket(id)
    onOpenChange(false); go("/gear", true)
    toast(`${r.name} deleted.`, { action: { label: "Undo", onClick: undo } })
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-xl">
        <form onSubmit={save} className="flex min-h-0 flex-col">
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="font-display text-3xl font-bold uppercase">Edit racket</DrawerTitle>
            <DrawerDescription>{calibrated ? "Readings are calibrated to your stringer." : "Readings are estimates until you calibrate right after a restring."}</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-4 overflow-y-auto px-4 pb-2">
            <div className="grid gap-1.5"><Label htmlFor="r-name">Name</Label><Input id="r-name" className="h-11 text-base" maxLength={40} value={f.name} onChange={set("name")} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="r-string">String</Label><Input id="r-string" className="h-11 text-base" maxLength={40} placeholder="e.g. ALU Power" value={f.stringName} onChange={set("stringName")} /></div>
              <div className="grid gap-1.5"><Label htmlFor="r-mat">String type</Label><MaterialSelect id="r-mat" value={f.material} onChange={set("material")} /></div>
              <div className="grid gap-1.5"><Label htmlFor="r-gauge">Gauge (mm)</Label><Input id="r-gauge" type="number" inputMode="decimal" step={0.01} className="h-11 text-base" value={f.gauge} onChange={set("gauge")} /></div>
              <div className="grid gap-1.5"><Label htmlFor="r-strung">Strung at ({unit})</Label><Input id="r-strung" type="number" inputMode="decimal" step={0.5} className="h-11 text-base" value={f.strungKg} onChange={set("strungKg")} /></div>
              <div className="grid gap-1.5"><Label htmlFor="r-strungon">Strung on</Label><Input id="r-strungon" type="date" className="h-11 text-base" value={f.strungOn} onChange={set("strungOn")} /></div>
              <div className="grid gap-1.5"><Label htmlFor="r-pattern">Pattern</Label><OptionSelect id="r-pattern" value={f.pattern} onChange={set("pattern")} options={PATTERNS} /></div>
              <div className="grid gap-1.5"><Label htmlFor="r-head">Head (sq in)</Label><Input id="r-head" type="number" inputMode="numeric" className="h-11 text-base" value={f.head} onChange={set("head")} /></div>
              <div className="grid gap-1.5"><Label htmlFor="r-weight">Weight (g)</Label><Input id="r-weight" type="number" inputMode="numeric" className="h-11 text-base" value={f.weight} onChange={set("weight")} /></div>
            </div>
            {err && <p role="alert" className="text-sm text-bad">{err}</p>}
            {calibrated && <Button type="button" variant="outline" className="w-fit" onClick={() => { putRacket(id, { calib: 1, calibAt: null }); toast("Calibration removed. Readings are estimates again.") }}>Remove calibration</Button>}
          </div>
          <DrawerFooter className="flex-row justify-between">
            <AlertDialog>
              <AlertDialogTrigger asChild><Button type="button" variant="ghost" className="text-bad">Delete racket</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {r.name}?</AlertDialogTitle>
                  <AlertDialogDescription>Its sessions, readings and string history go too, on every device. You can undo for a few seconds.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep</AlertDialogCancel>
                  <AlertDialogAction className="bg-bad text-white hover:bg-bad/90" onClick={remove}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button type="submit" size="lg" className="h-12 px-8 text-base">Save</Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
