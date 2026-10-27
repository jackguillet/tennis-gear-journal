# Stringbed Meter

Tap your tennis racket's strings and read the string-bed tension from the pitch. A web app you install on your iPhone's Home Screen. It works offline, and your data stays on the phone.

**Open it:** https://jackguillet.github.io/tennis-gear-journal/

## Put it on your iPhone

1. Open the link above in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Open **Stringbed** from the Home Screen and press **Listen for taps**. Allow the microphone.

## Measuring

- Hold the phone 10–20 cm from the strings, somewhere quiet.
- Tap the centre of the strings with a fingertip, about a second apart. The app shows the median of your last five taps.
- Press **Save this reading** to add it to the racket's history.
- Right after a restring, set **Strung on** to today, tap, and press **Calibrate**. Readings then match the tension your stringer used.

## How it works

A tapped string bed rings at one main pitch, usually 400–700 Hz. The app finds that pitch with an FFT, then estimates tension from the head size and the string's weight per metre (gauge and material). Tension rises with the square of the pitch. Uncalibrated numbers are estimates. The trend for one racket over time is reliable.

## Files

- `index.html`: the whole app (no build step, no libraries)
- `manifest.webmanifest`, `icons/`: Home Screen install
- `sw.js`: offline cache. Bump `VERSION` when you change a file.

Hosted with GitHub Pages from the `main` branch, root folder.
