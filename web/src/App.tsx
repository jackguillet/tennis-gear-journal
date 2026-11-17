import { useEffect } from "react"
import { Toaster } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { TabBar } from "@/components/tab-bar"
import { sync, useStore } from "@/lib/store"
import { useRoute } from "@/lib/route"
import { Courts } from "@/screens/courts"
import { Gear } from "@/screens/gear"
import { RacketPage } from "@/screens/racket"
import { Today } from "@/screens/today"

export function App() {
  const user = useStore((s) => s.user)
  const signedIn = useStore((s) => s.signedIn)
  const route = useRoute()
  useEffect(() => { sync() }, [])

  // Signing in still happens in the current app; both share the same account on this site.
  if (!user || signedIn === false) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-xl place-items-center px-4">
        <Card className="w-full">
          <CardContent className="grid gap-3">
            <div className="flex items-center gap-3"><img src="/icons/icon-192.png" alt="" className="size-10 rounded-lg" /><h1 className="font-display text-3xl font-bold uppercase">Tennis Hub</h1></div>
            <p className="text-muted-foreground">{user ? "Your session ended. Sign in again to sync." : "Sign in to see your rackets, sessions and courts."}</p>
            <Button asChild size="lg" className="w-fit"><a href="/">Sign in</a></Button>
          </CardContent>
        </Card>
      </main>
    )
  }
  return (
    <>
      <main className="mx-auto grid max-w-xl gap-4 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-[calc(96px+env(safe-area-inset-bottom))]">
        {route.page === "gear" ? <Gear /> : route.page === "courts" ? <Courts /> : route.page === "racket" ? <RacketPage key={route.id} id={route.id} edit={route.edit} /> : <Today />}
        <p className="pt-2 text-center text-xs text-muted-foreground">New look, in progress. <a className="font-semibold text-primary" href="/">Back to the current app</a></p>
      </main>
      <TabBar active={route.page === "racket" ? "gear" : route.page} />
      <Toaster position="bottom-center" offset={{ bottom: "calc(88px + env(safe-area-inset-bottom))" }} mobileOffset={{ bottom: "calc(88px + env(safe-area-inset-bottom))" }} duration={8000} />
    </>
  )
}
