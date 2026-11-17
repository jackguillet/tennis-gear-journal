import { cn } from "@/lib/utils"

// The small spaced capitals over a card or section ("SHOES", "NEXT COURT").
export const Eyebrow = ({ children, className, as: Tag = "p" }: { children: React.ReactNode; className?: string; as?: "p" | "h2" | "h3" }) =>
  <Tag className={cn("text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase", className)}>{children}</Tag>
