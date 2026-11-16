import type { Tone } from "@/lib/racket"

// Status colours as Tailwind classes: soft badge, strong text, bar fill.
export const toneBadge: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  none: "bg-muted text-muted-foreground",
}
export const toneText: Record<Tone, string> = { good: "text-good", warn: "text-warn", bad: "text-bad", none: "text-muted-foreground" }
export const toneBar: Record<Tone, string> = {
  good: "[&>[data-slot=progress-indicator]]:bg-good",
  warn: "[&>[data-slot=progress-indicator]]:bg-warn",
  bad: "[&>[data-slot=progress-indicator]]:bg-bad",
  none: "[&>[data-slot=progress-indicator]]:bg-muted-foreground",
}
export const toneDot: Record<Tone, string> = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", none: "bg-muted-foreground/40" }
