import { useStore } from "@/lib/store"

const initials = (u: { name?: string | null; email: string } | null) => {
  const s = (u?.name || u?.email || "").trim(), p = s.split(/[\s@._-]+/).filter(Boolean)
  return ((p[0] || "?")[0] + (u?.name && p.length > 1 ? p[1][0] : "")).toUpperCase()
}

// Each tab opens with a large title; your initials (top right) open Settings.
export function TitleBar({ title, kicker }: { title: string; kicker?: string }) {
  const user = useStore((s) => s.user)
  const sync = useStore((s) => (s.signedIn === false ? "Signed out" : !s.online ? (s.outbox.length ? s.outbox.length + " waiting" : "Offline") : null))
  return (
    <header className="flex items-end justify-between gap-3 pt-2 pb-1">
      <div>
        {kicker && <p className="text-[15px] text-muted-foreground">{kicker}</p>}
        <h1 className="font-display text-[40px] leading-none font-bold uppercase tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {sync && <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">{sync}</span>}
        <a href="/?tab=settings" aria-label="Settings" className="grid size-11 place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground">
          {initials(user)}
        </a>
      </div>
    </header>
  )
}
