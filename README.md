# Tennis Gear Journal

**Stringbed Meter:** tap your tennis racket's strings and read the string-bed tension from the pitch. A web app you install on your iPhone's Home Screen. Rackets and readings sync through a Neon Postgres database. The app keeps working with no signal and catches up when you're back online.

## Deploy (Vercel + Neon)

1. **Import the repo** at [vercel.com/new](https://vercel.com/new) and pick `jackguillet/tennis-gear-journal`. Framework preset: **Other**. Leave the build settings empty (`vercel.json` serves `public/`).
2. **Add a database:** in the project, open **Storage → Create Database → Neon** (or connect an existing Neon project). This sets `DATABASE_URL`. The tables are created on the first sync, so there is no migration step.
3. **Set a passcode:** in **Settings → Environment Variables**, add `APP_PASSCODE`. Use a long phrase, since it is the only lock on your data. Optional: add `SESSION_SECRET` (any long random string). Without it, sessions are signed with a key derived from the passcode, and changing the passcode signs out every device.
4. **Redeploy** so the variables take effect.

## Put it on your iPhone

1. Open your Vercel address (for example `https://tennis-gear-journal.vercel.app`) in **Safari**.
2. Sign in with your passcode.
3. Tap **Share**, then **Add to Home Screen**.
4. Open **Stringbed** from the Home Screen, press **Listen for taps**, and allow the microphone.

The first device to sign in uploads the two starting rackets (Wilson Blade 98 v8 and v9). Every device after that gets them from the server.

## Measuring

- Hold the phone 10–20 cm from the strings, somewhere quiet.
- Tap the centre of the strings with a fingertip, about a second apart. The app shows the median of your last five taps.
- Press **Save this reading** to add it to the racket's history.
- Right after a restring, set **Strung on** to today, tap, and press **Calibrate**. Readings then match the tension your stringer used.

A tapped string bed rings at one main pitch, usually 400–700 Hz. The app finds it with an FFT, then estimates tension from the head size and the string's weight per metre (gauge and material). Uncalibrated numbers are estimates. The trend for one racket over time is reliable.

## Develop

```sh
npm install
npm run dev     # http://localhost:3000, passcode "dev", in-memory Postgres (PGlite)
npm test        # API tests against PGlite
```

| Path | What it is |
| --- | --- |
| `public/index.html` | The whole front end: no build step, no libraries |
| `public/sw.js` | Offline cache. Bump `VERSION` when you change a file in `public/`. |
| `api/sync.js` | `POST /api/sync {ops}`: applies queued changes in one transaction and returns all rackets |
| `api/login.js` | Passcode sign-in. The session is a signed, HttpOnly cookie. |
| `lib/store.js` | Validation and SQL for each change (`racket.put`, `racket.delete`, `reading.add`, `reading.delete`) |
| `lib/schema.js` | Tables, created on first use. `npm run db:migrate` creates them ahead of time. |

Changes are queued on the device and sent in order. Each reading has an id made on the phone, so a retry never saves it twice. A reading for a racket that another device deleted is dropped instead of failing the sync.
