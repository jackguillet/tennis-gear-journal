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
export function planLink(plan, date, court = plan.court) {
  const n = (/(\d+)/.exec(court || "") || [])[1];
  return n && GT_COURT_IDS[n] ? `${GT}/scheduling/index/book/sport/2/court/${GT_COURT_IDS[n]}/date/${date}/time/${toMin(plan.time)}` : `${GT}/scheduling/index/index/sport/2`;
}
export function planTitle(plan) {
  const t = toMin(plan.time), h = Math.floor(t / 60), m = t % 60;
  const day = plan.date ? new Date(plan.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : DAY_NAMES[plan.dow].slice(0, 3);
  return day + " " + ((h % 12) || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? " am" : " pm") +
    " court" + (plan.court ? " (" + plan.court + ")" : plan.area && plan.area !== "any" ? " (" + AREA_NAMES[plan.area] + ")" : "");
}
// The coming days a regular time falls on, each with the moment the club opens booking for it.
// GameTime opens each court time exactly `win.days` days (7 at STC) before it ends, on the club's clock:
// a Friday 2:15 to 3:30 pm court opens at 3:30 pm the Friday before.
export function planOpenings(plans, win, bookings = [], { now = Date.now(), weeks = 3, tz = DEFAULT_TZ } = {}) {
  const out = [], today = localDate(now, tz);
  for (const p of plans || []) {
    if (p.paused) continue;
    // A one-off request has just its date; a weekly one every week except the ones skipped.
    let d = p.date || addDays(today, (p.dow - weekday(today) + 7) % 7);
    if (p.date && p.date < today) continue;
    for (let i = 0; i < (p.date ? 1 : weeks + 1); i++, d = addDays(d, 7)) {
      if (!p.date && (p.skips || []).includes(d)) continue;
      const end = toMin(p.time) + (Number(p.min) || 60), day = addDays(d, Math.floor(end / 1440) - win.days), m = end % 1440;
      const start = zonedToUtc(d, p.time, tz), opensAt = zonedToUtc(day, String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"), tz);
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
    "Added by Tennis Hub. The time played is logged to your racket after the session."].filter(Boolean).join("\n");
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
  const backups = String(o.plan.backups || "").split(/,\s*/).filter(Boolean).map((c) => "If taken, " + c + ": " + planLink(o.plan, o.date, c));
  const desc = ["GameTime opens booking for this court time now.", o.plan.note, "Book: " + url, ...backups,
    "Or tap your Tennis Hub button on stc.gametime.net to see the best open court."].filter(Boolean).join("\n");
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
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tennis Hub//Court bookings//EN", "CALSCALE:GREGORIAN",
    ...(method ? [`METHOD:${method}`] : []),
    `X-WR-CALNAME:${esc(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
    ...bookings.flatMap((b) => vevent(b, now)),
    ...openings.flatMap((o) => openingEvent(o, now)),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---------- the court grid ----------
// What the GameTime button last saw, one entry per day: { date, at (ms), courts: [{ c: "Court 15", i: "9",
// cells: [[start minute, minutes, state]] }] }. State is o (open), b (taken), m (yours), l (lesson) or
// e (club event). Nothing about who booked.
export const AREA_ORDER = ["indoor", "outdoor", "clay"];
export function courtArea(name) {
  const n = +((/(\d+)/.exec(name || "") || [])[1]);
  return n >= 14 ? "indoor" : n >= 9 ? "clay" : n >= 1 ? "outdoor" : "other";
}
const courtNo = (name) => +((/(\d+)/.exec(name || "") || [])[1]) || 0;
// Parts of the day the grid can show.
export const DAY_PARTS = { all: [0, 1440], morning: [0, 720], afternoon: [720, 1020], evening: [1020, 1440] };
const hm = (m) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

// When GameTime opens a court time: `days` days before it ends, on the club's clock.
export function opensAt(date, start, minutes, days = 7, tz = DEFAULT_TZ) {
  const end = start + minutes;
  return zonedToUtc(addDays(date, Math.floor(end / 1440) - days), hm(end % 1440), tz);
}
const CELL_STATE = { o: "open", b: "taken", m: "mine", l: "lesson", e: "event" };

// One day of the grid, ready to draw: courts in area order (indoor, outdoor, pro & clay) and a row per
// start time. Each cell is open, soon (open on the sheet but GameTime won't take it yet), taken, mine,
// lesson, event, past or closed (not a court time). The player's own bookings in the app count as mine
// even if the sheet is older than they are.
export function gridDay(day, { areas = AREA_ORDER, part = "all", now = Date.now(), days = 7, bookings = [], tz = DEFAULT_TZ } = {}) {
  if (!day) return { courts: [], rows: [] };
  const [lo, hi] = DAY_PARTS[part] || DAY_PARTS.all;
  const courts = (day.courts || []).filter((c) => areas.includes(courtArea(c.c)))
    .sort((a, b) => AREA_ORDER.indexOf(courtArea(a.c)) - AREA_ORDER.indexOf(courtArea(b.c)) || courtNo(a.c) - courtNo(b.c));
  const mine = (bookings || []).filter((b) => !b.cancelled && localDate(b.start, tz) === day.date && b.court);
  const times = new Set();
  courts.forEach((c) => c.cells.forEach(([t]) => { if (t >= lo && t < hi) times.add(t); }));
  const rows = [...times].sort((a, b) => a - b).map((t) => {
    const startAt = zonedToUtc(day.date, hm(t), tz);
    return {
      start: t,
      cells: courts.map((c) => {
        const cell = c.cells.find((x) => x[0] === t);
        if (!cell) return { state: "closed" };
        const [, min, s] = cell;
        let state = CELL_STATE[s] || "taken";
        if (mine.some((b) => courtNo(b.court) === courtNo(c.c) && b.start < startAt + min * 60000 && startAt < b.start + b.min * 60000)) state = "mine";
        if (startAt <= now) state = "past"; // started already
        const out = { state, minutes: min };
        if (state === "open") {
          const at = opensAt(day.date, t, min, days, tz);
          if (at > now) { out.state = "soon"; out.opensAt = at; }
        }
        return out;
      }),
    };
  }).filter((r) => r.cells.some((c) => c.state !== "closed" && c.state !== "past"));
  return {
    courts: courts.map((c, i) => ({ name: c.c, id: c.i, area: courtArea(c.c), first: i === 0 || courtArea(courts[i - 1].c) !== courtArea(c.c) })),
    rows,
  };
}

// The open court nearest a regular time on a day of the sheet: the favourite first, then the backups in
// order, then any court in the area, within `within` minutes of the time. Null when nothing fits.
export function bestCourt(day, plan, { within = 30, now = Date.now(), days = 7, tz = DEFAULT_TZ } = {}) {
  if (!day) return null;
  const want = [plan.court, ...String(plan.backups || "").split(/,\s*/)].filter(Boolean).map(courtNo);
  const t0 = toMin(plan.time), out = [];
  for (const c of day.courts || []) {
    if (plan.area && plan.area !== "any" && courtArea(c.c) !== plan.area && !want.includes(courtNo(c.c))) continue;
    for (const [t, min, s] of c.cells) {
      if (s !== "o" || Math.abs(t - t0) > within) continue;
      const startAt = zonedToUtc(day.date, hm(t), tz);
      if (startAt <= now || opensAt(day.date, t, min, days, tz) > now) continue;
      const rank = want.indexOf(courtNo(c.c));
      out.push({ court: c.c, id: c.i, start: t, minutes: min, rank: rank < 0 ? want.length : rank, gap: Math.abs(t - t0) });
    }
  }
  out.sort((a, b) => a.gap - b.gap || a.rank - b.rank || courtNo(a.court) - courtNo(b.court));
  // An exact-time slot on a wanted court beats a nearer one elsewhere.
  const exact = out.filter((x) => x.gap === 0).sort((a, b) => a.rank - b.rank)[0];
  return exact || out[0] || null;
}
export const bookUrl = (courtId, date, start) => `${GT}/scheduling/index/book/sport/2/court/${courtId}/date/${date}/time/${start}`;
export const WAITLIST_URL = `${GT}/scheduling/waitlist/new/sport/2`;
export const SHEET_URL = `${GT}/scheduling/index/index/sport/2`;

// "Coming up": booked courts and the regular times not yet booked in the next `ahead` days, by start.
export function comingUp(bookings, plans, win, { now = Date.now(), ahead = 8, tz = DEFAULT_TZ } = {}) {
  const until = now + ahead * 86400000;
  const booked = (bookings || []).filter((b) => !b.cancelled && b.start + b.min * 60000 > now && b.start < until).map((b) => ({ type: "booking", start: b.start, booking: b }));
  const open = planOpenings(plans, win || { days: 7 }, bookings, { now, weeks: 1, tz }).filter((o) => !o.booked && o.start < until)
    .map((o) => ({ type: "plan", start: o.start, opening: o }));
  return [...booked, ...open].sort((a, b) => a.start - b.start);
}

// ---------- requests ----------
// Where a request's next date stands: booked, on the waitlist, not open yet, open (with the best court
// on the last sheet), taken (everything near the time is gone, so the waitlist is next) or unknown
// (open, but the button hasn't read that day). Paused and finished requests have no next date.
// `waitlist` is the player's own places: [{ date, start (minute), minutes }].
export function requestStatus(plan, { bookings = [], waitlist = [], sheet = [], win = { days: 7 }, now = Date.now(), tz = DEFAULT_TZ } = {}) {
  if (plan.paused) return { state: "paused" };
  const [o] = planOpenings([plan], win, bookings, { now, weeks: 2, tz });
  if (!o) return { state: "done" };
  const base = { date: o.date, start: o.start, opensAt: o.opensAt };
  if (o.booked) return { ...base, state: "booked" };
  const t = toMin(plan.time);
  if ((waitlist || []).some((w) => w.date === o.date && Math.abs(w.start - t) <= 30)) return { ...base, state: "waitlist" };
  if (!o.open) return { ...base, state: "soon" };
  const day = (sheet || []).find((d) => d.date === o.date);
  if (!day) return { ...base, state: "unknown" };
  const best = bestCourt(day, plan, { now, days: win.days, tz });
  return best ? { ...base, state: "open", best } : { ...base, state: "taken" };
}

// ---------- weather ----------
// Seattle Tennis Club, for the forecast (Open-Meteo, no key needed).
export const CLUB_LAT = 47.6316, CLUB_LON = -122.2788;
export const forecastUrl = () => `https://api.open-meteo.com/v1/forecast?latitude=${CLUB_LAT}&longitude=${CLUB_LON}&hourly=precipitation_probability,temperature_2m&timezone=America%2FLos_Angeles&forecast_days=10`;
// Courts that get rained on: everything that isn't indoor (outdoor 1 to 8, pro & clay 9 to 13).
export const outdoorCourt = (court) => /\d/.test(court || "") && courtArea(court) !== "indoor";
export const outdoorPlan = (plan) => (plan.court ? outdoorCourt(plan.court) : plan.area === "outdoor" || plan.area === "clay");
// The chance of rain (highest hourly %) and the average temperature (°C) over a court time, from Open-Meteo's
// hourly forecast (times are club wall clock, "2026-11-13T14:00"). Null when the forecast doesn't reach it.
export function rainAt(forecast, start, min, tz = DEFAULT_TZ) {
  const h = forecast && forecast.hourly;
  if (!h || !Array.isArray(h.time)) return null;
  const probs = [], temps = [];
  h.time.forEach((t, i) => {
    const at = zonedToUtc(t.slice(0, 10), t.slice(11, 16), tz);
    if (at + 3600000 > start && at < start + min * 60000) {
      if (h.precipitation_probability && h.precipitation_probability[i] != null) probs.push(h.precipitation_probability[i]);
      if (h.temperature_2m && h.temperature_2m[i] != null) temps.push(h.temperature_2m[i]);
    }
  });
  if (!probs.length) return null;
  return { prob: Math.max(...probs), temp: temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null };
}
// An indoor court open on the last sheet at (or within half an hour of) a time, to swap to when rain is likely.
export function indoorSwap(sheet, start, { now = Date.now(), days = 7, tz = DEFAULT_TZ } = {}) {
  const date = localDate(start, tz);
  const t = Math.round((start - zonedToUtc(date, "00:00", tz)) / 60000);
  return bestCourt((sheet || []).find((d) => d.date === date), { time: hm(t), area: "indoor" }, { now, days, tz });
}

// ---------- how fast courts go ----------
// The button's scans, kept as how many courts were open at a time how long after GameTime opened it:
// [{ dow, t (minute), area, bucket, open, seen }]. Buckets are the time since opening when it was seen.
export const SPEED_BUCKETS = [["1h", 3600000, "an hour"], ["6h", 6 * 3600000, "6 hours"], ["1d", 86400000, "a day"], ["3d", 3 * 86400000, "3 days"], ["7d", 8 * 86400000, "the week"]];
export function speedBucket(sinceOpen) {
  if (sinceOpen < 0) return null;
  const b = SPEED_BUCKETS.find(([, ms]) => sinceOpen < ms);
  return b ? b[0] : null;
}
// A line on how fast a weekly time goes, or null until a few scans have seen it.
export function speedSummary(stats, { dow, time, area = "any" }) {
  const t0 = toMin(time);
  const rows = (stats || []).filter((r) => r.dow === dow && Math.abs(r.t - t0) <= 15 && (area === "any" || r.area === area));
  const by = SPEED_BUCKETS.map(([b, , label]) => {
    const rs = rows.filter((r) => r.bucket === b);
    const seen = rs.reduce((a, r) => a + r.seen, 0), open = rs.reduce((a, r) => a + r.open, 0);
    return { b, label, seen, rate: seen ? open / seen : null };
  }).filter((x) => x.seen >= 3);
  if (!by.length || by.reduce((a, x) => a + x.seen, 0) < 10) return null;
  const gone = by.find((x) => x.rate < 0.15);
  if (gone) return gone.b === "1h" ? "Usually all taken within an hour of opening" : "Usually all taken within " + gone.label + " of opening";
  const last = by[by.length - 1];
  if (last.rate >= 0.5) return "Usually still easy to get " + (last.b === "1h" ? "after it opens" : last.label + " after it opens");
  return "About " + Math.round(last.rate * 100) + "% of courts still open " + last.label + " after it opens";
}

// ---------- suggested requests ----------
// Times booked on the same weekday and start in at least `min` different weeks lately, that no request
// covers yet: [{ dow, time, min, court, area, count }], most booked first.
export function suggestRequests(bookings, plans, { now = Date.now(), weeks = 6, min = 2, tz = DEFAULT_TZ } = {}) {
  const since = now - weeks * 7 * 86400000, groups = new Map();
  for (const b of bookings || []) {
    if (b.cancelled || b.start < since || (b.location && b.location !== DEFAULT_LOCATION)) continue;
    const date = localDate(b.start, tz), dow = weekday(date);
    const t = Math.round((b.start - zonedToUtc(date, "00:00", tz)) / 60000);
    const k = dow + "@" + t;
    if (!groups.has(k)) groups.set(k, { dow, time: hm(t), min: b.min, courts: [], weeks: new Set() });
    const g = groups.get(k); g.weeks.add(Math.floor((zonedToUtc(date, "12:00", tz) - 4 * 86400000) / (7 * 86400000))); if (b.court) g.courts.push(b.court);
  }
  const covered = (g) => (plans || []).some((p) => !p.date && p.dow === g.dow && Math.abs(toMin(p.time) - toMin(g.time)) <= 30);
  return [...groups.values()].filter((g) => g.weeks.size >= min && !covered(g)).map((g) => {
    const counts = {}; g.courts.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
    const court = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return { dow: g.dow, time: g.time, min: g.min, court: court ? court[0] : null, area: court ? courtArea(court[0]) : "any", count: g.weeks.size };
  }).sort((a, b) => b.count - a.count);
}

// ---------- send to partner ----------
export function shareText(b, tz = DEFAULT_TZ) {
  const start = new Date(b.start), end = new Date(b.start + b.min * 60000);
  const day = start.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" });
  const t = (d) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const club = !b.location || b.location === DEFAULT_LOCATION;
  return `Tennis ${day}, ${t(start)} to ${t(end)}` + (b.court ? `, ${b.court}` : "") + (club ? ` at ${CLUB_ADDRESS}.` : ` at ${b.location}.`)
    + (club ? " Check in at the Pro Shop; mostly-white clothing." : "");
}
