import { cn } from "@/lib/utils"
import type { Tone } from "@/lib/racket"
import { toneText } from "./tone"

// How much life is left in the strings, as a ring with the percentage inside.
export function LifeRing({ left, tone, className }: { left: number | null; tone: Tone; className?: string }) {
  return (
    <span className={cn("relative grid size-[84px] shrink-0 place-items-center", toneText[tone], className)}>
      <svg viewBox="0 0 84 84" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="42" cy="42" r="36" fill="none" strokeWidth="9" className="stroke-secondary" />
        {left ? <circle cx="42" cy="42" r="36" fill="none" strokeWidth="9" strokeLinecap="round" pathLength={100} strokeDasharray={`${left} 100`} stroke="currentColor" /> : null}
      </svg>
      <b className="font-display text-[26px] leading-none font-bold text-foreground">{left === null ? "–" : left + "%"}</b>
    </span>
  )
}
