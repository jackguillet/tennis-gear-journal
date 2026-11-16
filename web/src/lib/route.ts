// Pages inside /next/, kept in the URL hash so Back and Home Screen reopen where you were:
// #/ (Today), #/gear, #/racket/<id>, #/racket/<id>/edit.
import { useSyncExternalStore } from "react"

export type Route = { page: "today" } | { page: "gear" } | { page: "racket"; id: string; edit: boolean }

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent)
  if (parts[0] === "gear") return { page: "gear" }
  if (parts[0] === "racket" && parts[1]) return { page: "racket", id: parts[1], edit: parts[2] === "edit" }
  return { page: "today" }
}
const subscribe = (l: () => void) => { addEventListener("hashchange", l); return () => removeEventListener("hashchange", l) }
export const useRoute = (): Route => parse(useSyncExternalStore(subscribe, () => location.hash))
export function go(path: string, replace = false) {
  const url = "#" + path, oldURL = location.href
  if (replace) history.replaceState(null, "", url)
  else history.pushState(null, "", url)
  dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: location.href }))
  scrollTo(0, 0)
}

// Where the racket page's back button goes: the page you came from inside the app, else Gear.
let previous: Route | null = null
if (typeof window !== "undefined") addEventListener("hashchange", (e) => {
  const was = parse(new URL((e as HashChangeEvent).oldURL || location.href).hash), now = parse(location.hash)
  if (!(was.page === "racket" && now.page === "racket" && was.id === now.id)) previous = was // opening or closing Edit isn't a move
})
export const cameFrom = (): Route | null => previous
