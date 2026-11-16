# Tennis Hub front end (React + shadcn/ui)

The app is moving from one hand-written page (`public/index.html`) to React, Tailwind and
[shadcn/ui](https://ui.shadcn.com) components, one tab at a time. Until the new app covers every tab
it is served at **`/next/`**, beside the current app at `/`, on the same site and account.

- `npm run build` builds this folder into `public/next/` (git-ignored; Vercel builds it on deploy), then runs the build check.
- `npm run dev` serves the API and `public/` (including the last build at `/next/`); `npm run dev:web` runs the Vite dev server with hot reload, sending `/api` calls to port 3000.
- `npm run typecheck`, and `npm run test:screens` (Playwright, phone-sized) after a build.

**Data.** `src/lib/store.ts` keeps the same on-device copy and change queue (`sbm-…` localStorage keys) as the current app and syncs through the same `/api/sync`, so both work on one phone during the move. The models in `public/*.js` (restring, shoes, strings, tension, courts) are imported through `@models/…`, not copied.

**Components.** `src/components/ui/` holds shadcn's own component source (new-york style). Add more with the shadcn CLI (`npx shadcn@latest add <name>` from this folder; `components.json` is set up), or copy the file from the shadcn repo's `apps/v4/registry/new-york-v4/ui/` and change the `cn` import to `@/lib/utils`. The theme in `src/index.css` maps the Courtside look onto shadcn's tokens: court blue is `primary`, ball yellow is `optic`, and `good` / `warn` / `bad` are the status colours.

**Order.** 1 Today (done) · 2 Gear and the racket page · 3 Courts · 4 Settings · 5 Measure (wraps the existing listening code, unchanged) · 6 swap `/next/` to `/` and retire `public/index.html`.
