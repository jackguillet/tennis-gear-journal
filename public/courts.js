// Court bookings: local-time helpers and calendar (.ics) files. Shared by the app (the
// "Add to calendar" button) and the server (the subscribed calendar feed), like tension.js.

export const DEFAULT_LOCATION = "Seattle Tennis Club";
export const DEFAULT_TZ = "America/Los_Angeles";

const KIND_TITLE = { singles: "Singles", doubles: "Doubles", hitting: "Hitting", drills: "Lesson / drills", ball_machine: "Ball machine", serves: "Serve practice" };

// The UTC instant (ms) of a wall-clock date and time in a time zone, e.g. ("2026-11-01", "18:30", "America/Los_Angeles").
export function zonedToUtc(date, time, tz) {
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes handle the hour around a daylight-saving change.
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return t;
}

// How far the zone's wall clock is ahead of UTC at instant t, in ms.
function offsetMs(t, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(t / 1000) * 1000;
}

// The local calendar day (YYYY-MM-DD) of instant t in a time zone.
export function localDate(t, tz) {
  return new Date(t).toLocaleDateString("en-CA", { timeZone: tz || DEFAULT_TZ });
}

export function bookingTitle(b) {
  return "Tennis: " + (KIND_TITLE[b.kind] || "court") + (b.court ? " · " + b.court : "");
}

// ---------- iCalendar ----------
const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
// Lines longer than 75 characters are folded onto continuation lines that start with a space.
const fold = (line) => {
  const out = [];
  for (let i = 0; i < line.length; i += i ? 74 : 75) out.push((i ? " " : "") + line.slice(i, i + (i ? 74 : 75)));
  return out.join("\r\n");
};

function vevent(b, now) {
  const end = b.start + b.min * 60000;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${b.id}@stringbed-meter`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(b.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(bookingTitle(b))}`,
    `LOCATION:${esc(b.location || DEFAULT_LOCATION)}`,
  ];
  const desc = [b.note, b.ref ? "Booking " + b.ref : null, "Added by Stringbed Meter. The time played is logged to your racket after the session."].filter(Boolean).join("\n");
  lines.push(`DESCRIPTION:${esc(desc)}`);
  if (b.cancelled) lines.push("STATUS:CANCELLED");
  else lines.push("STATUS:CONFIRMED", "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(bookingTitle(b))}`, "TRIGGER:-PT60M", "END:VALARM");
  // SEQUENCE rises when a booking changes, so calendars take the newer version.
  lines.push(`SEQUENCE:${Math.max(0, Math.floor(((b.updated || now) - Date.UTC(2026, 0, 1)) / 1000))}`, "END:VEVENT");
  return lines;
}

// A whole calendar. `bookings` is a list of { id, start (ms), min, kind, court, location, note, ref, cancelled, updated }.
export function toIcs(bookings, { name = "Tennis courts", now = Date.now(), method } = {}) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Stringbed Meter//Court bookings//EN", "CALSCALE:GREGORIAN",
    ...(method ? [`METHOD:${method}`] : []),
    `X-WR-CALNAME:${esc(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
    ...bookings.flatMap((b) => vevent(b, now)),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
