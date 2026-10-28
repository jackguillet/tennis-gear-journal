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

## Tracking play

Under **Play on these strings**, pick the type of play (singles, doubles, hitting, lesson or drills, ball machine, serves), how long, and the day, then press **Log play**. The big number is the hours played since the racket's **Strung on** date, so it starts again from zero when you restring and change that date. Your level (NTRP) and style of play (heavy topspin, flat and so on) are under **Your game**, saved with your account.

## When to restring

The **Restring** card shows how much life is left in each racket's strings, a projected restring date at your recent pace of play, and what is driving it. It takes the largest of four limits:

- **Going dead.** Strings lose their snapback and control well before they break, polyester fastest (about 15 h for a 4.0 player, against about 25 h for multifilament and 35 h for natural gut). Higher levels and heavy topspin shorten it.
- **Breaking.** Strings notch where they rub. Thinner gauges, open patterns (16x18), bigger heads, lower tension, heavy spin and harder hitting all cut the hours before a likely break; polyester and aramid last longest, natural gut and multifilament least.
- **Tension loss.** Your saved readings since the **Strung on** date, compared with the tension you strung at (when calibrated after the restring) or with your first reading. Restring at about 25% down for polyester and 15–20% for softer strings.
- **Age.** Strings go stale in the bag: about 2 months for polyester, 4–5 months for nylon and gut.

Hours are weighted by type of play (drills and ball machine count more than doubles). The hour figures are typical values, not lab constants; your own readings refine the estimate. The model lives in `public/restring.js`, shared with the chat connector, and is tested in `test/restring.test.js`.

## Log play by chatting (Claude and other assistants)

The app has a remote MCP server, so a chat assistant can log sessions for you: "I played an hour of singles", "log 90 minutes of doubles yesterday on the v9", "how many hours are on my strings?", "should I restring the v8?", "I restrung the v8 today at 52 lb".

1. In the app, under **Chat assistant**, press **Make a connector link** and copy it. It looks like `https://<your-app>.vercel.app/api/mcp/sbm_...` and is shown once.
2. In Claude, open **Settings → Connectors → Add custom connector**, give it a name (for example Stringbed) and paste the link as the server URL. No other sign-in is needed.
3. Ask away. The phone app picks up the change on its next sync.

The link is a password for your tennis data: anyone with it can read and add to your rackets. Remove it in the app (×) to turn it off. Assistants that can send headers can call `https://<your-app>.vercel.app/api/mcp` with `Authorization: Bearer sbm_...` instead.

Tools: `log_play`, `list_rackets`, `restring_advice`, `list_sessions`, `delete_session`, `record_restring`, `set_player_profile`. "Today" means today in the phone's time zone when the link was made.

## Court bookings (Seattle Tennis Club)

The Court bookings card keeps the courts you book. Add one in the app, or paste a GameTime confirmation email into Claude with the connector on (it calls `add_court_booking`, and sending the same confirmation number again updates the booking). Once a booking ends, its time is logged as play on the racket you picked, or on the one you used most recently. This happens on the next sync, chat call or calendar refresh.

Under "Show bookings in my calendar", make a private calendar link and subscribe to it in Apple or Google Calendar. Each booking appears with a reminder an hour before, and cancelled ones disappear. Calendar links can only read bookings and are separate from connector links (`api_tokens.scope`). The feed is `GET /api/calendar/<secret>.ics`. The 📅 button on a booking downloads a one-off `.ics` file for when you don't want to wait for the calendar to refresh.

**GameTime button.** Under "GameTime button" in the same card, make a bookmark (drag it to the bookmarks bar, or paste it into a Safari bookmark on iPhone). Tap it while signed in on stc.gametime.net. It shows open courts by day and area, and tapping one opens GameTime's own booking form for that slot. It also sends your own bookings for the next 7 days to `POST /api/gametime`, which adds them, updates moved ones and cancels ones gone from GameTime. The bookmark's key (`scope = 'gametime'`) can only save court bookings. The script is `public/stc.js`. It runs in your browser with your GameTime session and never books or cancels anything itself.

The panel has two more tabs. **Clinics & events** lists adult clinics, round robins and club nights for the next four weeks, with spots left, and links to each one on GameTime so you can sign up there. **Partners** lists members who opted into GameTime's partner finder, filtered by level, singles or doubles, and name, with email, text and call links. The partner list is read in your browser only; it is never sent to or stored by Stringbed Meter. Clinics and drills you're signed up for are imported as lesson time with your court bookings.

Removing a booking here does not cancel it with the club. Do that in GameTime. Notes on how GameTime's court sheet works, for a later direct hookup, are in `docs/gametime.md`.

## Put it on your iPhone

1. Open the site in **Safari** and create an account (or sign in).
2. Tap **Share**, then **Add to Home Screen**.
3. Open **Stringbed** from the Home Screen, press **Listen for taps**, and allow the microphone.

## Measuring

- Hold the phone 10–20 cm from the strings, somewhere quiet.
- Point the phone's bottom edge (the main microphone) at the strings from 10–20 cm. Tap the centre of the strings firmly with the heel of your palm and lift off at once, about a second apart. The app shows the median of your last five taps.
- Press **Save this reading** to add it to the racket's history.
- Right after a restring, set **Strung on** to today, tap, and press **Calibrate**. Readings then match the tension your stringer used.

A tapped string bed rings like a drum skin at one main pitch, usually 450–700 Hz. The app finds the lowest clear peak with an FFT (so an off-centre tap's louder overtone isn't mistaken for it), then computes the tension left in the strings from the head size and the string's weight per metre, using the oval-membrane formula that Cross & Bower (Sports Engineering, 2001) checked against a load cell. The big number converts that to stringing-machine terms using the typical 30% (nylon) to 40% (polyester) drop after stringing; calibrating replaces the typical drop with your stringer's. The model and pitch detection live in `public/tension.js` and are tested in `test/tension.test.js`.

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
| `api/mcp.js` | Remote MCP server for chat assistants (`/api/mcp/<link secret>`); tools in `lib/assistant.js` |
| `api/tokens.js` | Make, list and remove connector links (signed-in player); only a hash of each secret is stored (`lib/tokens.js`) |
| `lib/auth.js` | Neon Auth proxy and session check (`@neondatabase/auth/server`) |
| `lib/db.js` | node-postgres pool, attached to Vercel Fluid compute |
| `lib/store.js` | Validation and SQL for each change, all scoped to the player |
| `lib/schema.js` | Tables, created on first use. Accounts themselves live in Neon Auth's `neon_auth` schema. |
| `scripts/local-auth.js` | Open-source Better Auth in memory, standing in for Neon Auth in dev and tests |

Changes are queued on the device and sent in order. Each reading has an id made on the phone, so a retry never saves it twice. A change aimed at another player's racket does nothing.
