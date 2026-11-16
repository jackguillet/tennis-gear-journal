import { Activity, CalendarDays, House } from "lucide-react"
import { cn } from "@/lib/utils"

// Racket icon, drawn like the current app's.
const Racket = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" {...p}>
    <ellipse cx="10" cy="9" rx="6" ry="7" transform="rotate(-40 10 9)" /><path d="M14.5 13.5l6 7M6.5 5.5l7 7M5 9.5l5.5-5.5M9 13.5l5.5-5.5" />
  </svg>
)
// Only Today is in the new app so far; the other tabs open in the current app.
const TABS = [
  { id: "today", label: "Today", Icon: House, href: "/next/" },
  { id: "measure", label: "Measure", Icon: Activity, href: "/?tab=measure" },
  { id: "courts", label: "Courts", Icon: CalendarDays, href: "/?tab=courts" },
  { id: "gear", label: "Gear", Icon: Racket, href: "/?tab=gear" },
]

export function TabBar({ active }: { active: string }) {
  return (
    <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-xl grid-cols-4">
        {TABS.map(({ id, label, Icon, href }) => (
          <a key={id} href={href} aria-current={id === active ? "page" : undefined}
            className={cn("flex flex-col items-center gap-1 py-2.5 text-xs font-semibold text-muted-foreground", id === active && "text-primary")}>
            <Icon className="size-6" aria-hidden="true" />{label}
          </a>
        ))}
      </div>
    </nav>
  )
}
