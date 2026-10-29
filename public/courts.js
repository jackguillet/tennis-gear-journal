// Court bookings: local-time helpers and calendar (.ics) files. Shared by the app (the
// "Add to calendar" button) and the server (the subscribed calendar feed), like tension.js.

export const DEFAULT_LOCATION = "Seattle Tennis Club";
export const DEFAULT_TZ = "America/Los_Angeles";
export const CLUB_ADDRESS = "Seattle Tennis Club, 922 McGilvra Blvd E, Seattle, WA 98112";
// STC: "A reservation cancellation must be made at least six hours before the scheduled court time.
// Failure to show for a reserved court may result in a minimum one-week suspension from play."
export const CANCEL_HOURS = 6;
const atClub = (b) => !b.location || b.location === DEFAULT_LOCATION;

// The last moment a club booking can be cancelled (ms), or null for other places.
export const cancelBy = (b) => (atClub(b) ? b.start - CANCEL_HOURS * 3600000 : null);

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

// ---------- regular weekly times ----------
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const AREA_NAMES = { indoor: "indoor", outdoor: "outdoor", clay: "pro & clay", any: "any court" };
const GT = "https://stc.gametime.net";
// GameTime's own ids for STC courts (from its court sheet), for a link straight to a court's booking form.
export const GT_COURT_IDS = { 1: 14, 2: 15, 3: 16, 4: 20, 5: 17, 6: 18, 7: 19, 8: 21, 14: 8, 15: 9, 16: 10, 17: 11, 18: 12, 19: 13 };
const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const weekday = (d) => new Date(d + "T12:00:00Z").getUTCDay();

// Where to book a regular time on a given day: the favourite court's booking form when GameTime's id for it
// is known, otherwise the tennis court sheet.
export function planLink(plan, date) {
  const n = (/(\d+)/.exec(plan.court || "") || [])[1];
  return n && GT_COURT_IDS[n] ? `${GT}/scheduling/index/book/sport/2/court/${GT_COURT_IDS[n]}/date/${date}/time/${toMin(plan.time)}` : `${GT}/scheduling/index/index/sport/2`;
}
export function planTitle(plan) {
  const t = toMin(plan.time), h = Math.floor(t / 60), m = t % 60;
  return DAY_NAMES[plan.dow].slice(0, 3) + " " + ((h % 12) || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? " am" : " pm") +
    " court" + (plan.court ? " (" + plan.court + ")" : plan.area && plan.area !== "any" ? " (" + AREA_NAMES[plan.area] + ")" : "");
}
// The coming days a regular time falls on, each with the moment the club opens booking for it
// (`win.days` days before, at `win.time`). Days already booked are left out.
export function planOpenings(plans, win, bookings = [], { now = Date.now(), weeks = 3, tz = DEFAULT_TZ } = {}) {
  const out = [], today = localDate(now, tz);
  for (const p of plans || []) {
    let d = addDays(today, (p.dow - weekday(today) + 7) % 7);
    for (let i = 0; i < weeks + 1; i++, d = addDays(d, 7)) {
      const start = zonedToUtc(d, p.time, tz), opensAt = zonedToUtc(addDays(d, -win.days), win.time, tz);
      if (start <= now) continue;
      const booked = bookings.some((b) => !b.cancelled && Math.abs(b.start - start) <= 90 * 60000);
      out.push({ plan: p, date: d, start, opensAt, booked, open: opensAt <= now });
    }
  }
  return out.sort((a, b) => a.opensAt - b.opensAt);
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
    `LOCATION:${esc(atClub(b) ? CLUB_ADDRESS : b.location)}`,
  ];
  const desc = [b.note, b.ref ? "Booking " + b.ref : null,
    atClub(b) ? `Cancel at least ${CANCEL_HOURS} hours ahead in GameTime; a no-show can mean a one-week suspension. Check in at the Pro Shop before you play.` : null,
    "Added by Stringbed Meter. The time played is logged to your racket after the session."].filter(Boolean).join("\n");
  lines.push(`DESCRIPTION:${esc(desc)}`);
  // SEQUENCE rises when a booking changes, so calendars take the newer version.
  lines.push(`SEQUENCE:${Math.max(0, Math.floor(((b.updated || now) - Date.UTC(2026, 0, 1)) / 1000))}`);
  if (b.cancelled) lines.push("STATUS:CANCELLED");
  else {
    lines.push("STATUS:CONFIRMED", "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(bookingTitle(b))}`, "TRIGGER:-PT60M", "END:VALARM");
    // An hour before the cancellation cut-off, so plans can still change without a no-show.
    if (atClub(b)) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(`Last chance to cancel ${bookingTitle(b).replace(/^Tennis: /, "")} (${CANCEL_HOURS}-hour rule)`)}`, `TRIGGER:-PT${CANCEL_HOURS + 1}H`, "END:VALARM");
  }
  lines.push("END:VEVENT");
  return lines;
}

// A "book now" reminder at the moment booking opens for a regular time.
function openingEvent(o, now) {
  const title = "Book: " + planTitle(o.plan).replace(/^\w+ /, new Date(o.start).toLocaleDateString("en-US", { timeZone: DEFAULT_TZ, weekday: "short", month: "short", day: "numeric" }) + " ");
  const url = planLink(o.plan, o.date);
  const desc = ["GameTime opens booking for this day now.", o.plan.note, "Book: " + url,
    "Or tap your Stringbed Meter button on stc.gametime.net to see the best open court."].filter(Boolean).join("\n");
  return [
    "BEGIN:VEVENT", `UID:open-${o.plan.id}-${o.date}@stringbed-meter`, `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(o.opensAt)}`, `DTEND:${stamp(o.opensAt + 15 * 60000)}`,
    `SUMMARY:${esc(title)}`, `URL:${url}`, `DESCRIPTION:${esc(desc)}`, "TRANSP:TRANSPARENT", "STATUS:CONFIRMED",
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT",
  ];
}

// A whole calendar. `bookings` is a list of { id, start (ms), min, kind, court, location, note, ref, cancelled, updated }.
// `openings` (from planOpenings) add "book now" reminders for regular times.
export function toIcs(bookings, { name = "Tennis courts", now = Date.now(), method, openings = [] } = {}) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Stringbed Meter//Court bookings//EN", "CALSCALE:GREGORIAN",
    ...(method ? [`METHOD:${method}`] : []),
    `X-WR-CALNAME:${esc(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
    ...bookings.flatMap((b) => vevent(b, now)),
    ...openings.flatMap((o) => openingEvent(o, now)),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
