import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { weight } from "@/lib/format"
import { kgOf } from "@/lib/racket"
import type { Racket } from "@/lib/store"

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })

// Tension over time. Each set of strings is its own line, with a dashed "restrung" mark where a new
// set went in, so the chart never joins two sets with a fake jump.
export function TensionChart({ r, unit }: { r: Racket; unit: "kg" | "lb" }) {
  const rs = r.readings.slice().sort((a, b) => a.t - b.t)
  const t0 = rs[0].t, t1 = rs[rs.length - 1].t
  const changes = [...new Set([...(r.jobs || []).flatMap((j) => [j.from, j.to]), r.strungOn].filter((d): d is string => !!d))]
    .map((d) => Date.parse(d + "T00:00:00")).filter((t) => t > t0 && t <= t1).sort((a, b) => a - b)
  const setOf = (t: number) => changes.filter((c) => c <= t).length
  const sets = [...new Set(rs.map((x) => setOf(x.t)))]
  const data = rs.map((x) => ({ t: x.t, ["s" + setOf(x.t)]: +weight(kgOf(x, r), unit) }))
  const config = Object.fromEntries(sets.map((s) => ["s" + s, { label: `Tension (${unit})`, color: "var(--primary)" }])) satisfies ChartConfig
  return (
    <ChartContainer config={config} className="aspect-auto h-48 w-full" aria-label={`Tension over time, ${unit}`}>
      <LineChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={day} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis domain={["dataMin - 1", "dataMax + 1"]} tickFormatter={(v: number) => v.toFixed(0)} tickLine={false} axisLine={false} width={44} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => day(p?.[0]?.payload?.t ?? 0)} />} />
        {changes.map((t) => <ReferenceLine key={t} x={t} stroke="var(--warn)" strokeDasharray="3 4" label={{ value: "restrung", position: "insideTopLeft", fill: "var(--warn)", fontSize: 11 }} />)}
        {sets.map((s) => <Line key={s} dataKey={"s" + s} type="monotone" stroke={`var(--color-s${s})`} strokeWidth={2} dot={{ r: 3, fill: "var(--primary)" }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />)}
      </LineChart>
    </ChartContainer>
  )
}
