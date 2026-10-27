# Tennis Gear Journal

**Stringbed Meter:** tap your tennis racket's strings and read the string-bed tension from the pitch. A web app you install on your iPhone's Home Screen. Each player has their own account, so you can share the link with friends: everyone gets their own rackets and history. Data lives in Neon Postgres, accounts are Neon Auth, and the app is hosted on Vercel. It keeps working with no signal and catches up when you're back online.

## Set up Neon

The Neon project is linked in `.neon` (project `young-sunset-08728679`, branch `production`). `neon.ts` declares Postgres and Neon Auth (`auth: true`).

```sh
npm i -g neon@latest
neon login              # opens a browser sign-in
neon deploy             # enables Neon Auth on the branch, writes DATABASE_URL, DATABASE_URL_UNPOOLED and NEON_AUTH_BASE_URL to .env.local
neon neon-auth domain add https://<your-app>.vercel.app   # Neon Auth only accepts sign-ins from listed origins
npm run db:migrate      # optional: create the tables now (the API also does it on first sync)
```

## Deploy on Vercel

1. Import the repo at [vercel.com/new](https://vercel.com/new). Framework preset: **Other**. Leave the build settings alone (`vercel.json` serves `public/`, and `npm run build` checks that everything loads).
2. In **Settings → Environment Variables**, add these:
   - `DATABASE_URL`: the pooled connection string from `.env.local`. If you connect Neon through Vercel's **Storage** tab instead, it sets this for you. Use the same project and branch.
   - `NEON_AUTH_BASE_URL`: from `.env.local`.
   - `NEON_AUTH_COOKIE_SECRET`: any 32+ random characters (`openssl rand -base64 32`).
   - `OWNER_EMAIL` (optional): your email. Rackets saved by the earlier passcode version have no owner and move to this account the first time you sign in.
3. Redeploy, then open the site, create your account and send the link to friends.

`APP_PASSCODE` is no longer used and can be deleted.

## Put it on your iPhone

1. Open the site in **Safari** and create an account (or sign in).
2. Tap **Share**, then **Add to Home Screen**.
3. Open **Stringbed** from the Home Screen, press **Listen for taps**, and allow the microphone.

## Measuring

- Hold the phone 10–20 cm from the strings, somewhere quiet.
- Tap the centre of the strings with a fingertip, about a second apart. The app shows the median of your last five taps.
- Press **Save this reading** to add it to the racket's history.
- Right after a restring, set **Strung on** to today, tap, and press **Calibrate**. Readings then match the tension your stringer used.

A tapped string bed rings at one main pitch, usually 400–700 Hz. The app finds it with an FFT, then estimates tension from the head size and the string's weight per metre (gauge and material). Uncalibrated numbers are estimates. The trend for one racket over time is reliable.

## Develop

```sh
npm install
npm run dev     # http://localhost:3000, in-memory Postgres and a local stand-in for Neon Auth
npm test        # API tests: accounts, per-player data, sync, upgrades
npm run build   # checks the page, service worker and API routes load
```

`npm run dev` reads `.env.local`. With `NEON_AUTH_BASE_URL` set there, it uses your real Neon Auth; add `http://localhost:3000` as a trusted domain first. With `USE_DATABASE_URL=1`, it uses your real database.

| Path | What it is |
| --- | --- |
| `public/index.html` | The whole front end: no build step, no libraries |
| `public/sw.js` | Offline cache. Bump `VERSION` when you change a file in `public/`. |
| `api/auth.js` | `/api/auth/*` forwards to Neon Auth (Better Auth endpoints such as `sign-up/email`, `sign-in/email`, `sign-out`, `get-session`), so session cookies stay on this site |
| `api/sync.js` | `POST /api/sync {ops}`: applies the signed-in player's queued changes in one transaction and returns their rackets |
| `lib/auth.js` | Neon Auth proxy and session check (`@neondatabase/auth/server`) |
| `lib/db.js` | node-postgres pool, attached to Vercel Fluid compute |
| `lib/store.js` | Validation and SQL for each change, all scoped to the player |
| `lib/schema.js` | Tables, created on first use. Accounts themselves live in Neon Auth's `neon_auth` schema. |
| `scripts/local-auth.js` | Open-source Better Auth in memory, standing in for Neon Auth in dev and tests |

Changes are queued on the device and sent in order. Each reading has an id made on the phone, so a retry never saves it twice. A change aimed at another player's racket does nothing.
