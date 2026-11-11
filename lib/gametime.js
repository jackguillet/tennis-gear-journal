import { createHash } from "node:crypto";
import { applyOps, PLAY_KINDS, plansFor, bookingWindow } from "./store.js";
import { zonedToUtc, DEFAULT_TZ, localDate, GT_COURT_IDS } from "../public/courts.js";

// Bookings sent by the GameTime button (public/stc.js) from the member's own signed-in GameTime
// page. Each GameTime booking keeps one row here (id "gt-c<confirmation>-<player>"), so sending the same
// week again updates rather than duplicates. A GameTime booking that disappears from a day that
// was just read was cancelled or moved, so it is cancelled here too.

const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/, BKID = /^\d{1,12}$/;
export const MAX_IMPORT = 100;

class Invalid extends Error { constructor(m) { super(m); this.status = 400; } }

const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
// Keyed on the confirmation number when there is one: it stays the same when a booking is edited,
// while GameTime gives the edited booking a new booking id.
const rowId = (userId, b) => "gt-" + (b.ref && /^\d{1,12}$/.test(b.ref) ? "c" + b.ref : b.bkId) + "-" + createHash("sha256").update(String(userId)).digest("hex").slice(0, 8);

export function cleanImport(body) {
  if (!body || typeof body !== "object") throw new Invalid("Nothing was sent.");
  const days = Array.isArray(body.days) ? body.days.filter((d) => typeof d === "string" && DATE.test(d)).slice(0, 62) : [];
  if (!Array.isArray(body.bookings)) throw new Invalid("bookings must be a list.");
  if (body.bookings.length > MAX_IMPORT) throw new Invalid(`Send at most ${MAX_IMPORT} bookings.`);
  const bookings = body.bookings.map((b) => {
    if (!b || !BKID.test(String(b.bkId)) || !DATE.test(b.date) || !TIME.test(b.time)) throw new Invalid("A booking is missing its id, day or time.");
    const minutes = Math.round(Number(b.minutes));
    if (!(minutes >= 15 && minutes <= 360)) throw new Invalid("A booking's length must be 15 minutes to 6 hours.");
    return {
      bkId: String(b.bkId), date: b.date, time: b.time, minutes,
      kind: PLAY_KINDS.includes(b.kind) ? b.kind : "singles",
      court: text(b.court, 40), note: text(b.note, 200), ref: b.ref === null || b.ref === undefined ? null : text(String(b.ref), 40),
    };
  });
  return { days, bookings };
}

export async function importBookings(db, userId, body, now = Date.now()) {
  const { days, bookings } = cleanImport(body);
  const existing = await db.query(
    `select id, ref, racket_id from court_bookings where user_id = $1 and (id like 'gt-%' or ref = any($2::text[]))`,
    [userId, bookings.map((b) => b.ref).filter(Boolean)]);
  const byId = new Map(existing.map((r) => [r.id, r]));
  const ops = [], keep = new Set();
  for (const b of bookings) {
    let id = rowId(userId, b);
    // A booking saved earlier by hand or from a confirmation email takes the GameTime details.
    const typed = !byId.has(id) && b.ref ? existing.filter((r) => r.ref === b.ref && !r.id.startsWith("gt-")) : [];
    if (typed.length === 1) id = typed[0].id;
    keep.add(id);
    const prev = byId.get(id) || typed[0];
    ops.push({
      op: "booking.put", id, start: zonedToUtc(b.date, b.time, DEFAULT_TZ), min: b.minutes, tz: DEFAULT_TZ, kind: b.kind,
      court: b.court, location: null, note: b.note, ref: b.ref, racketId: prev ? prev.racket_id : null,
    });
  }
  // Cancel GameTime bookings on the days just read that are no longer there (only ones not yet started).
  let gone = [];
  if (days.length) {
    gone = await db.query(
      `select id from court_bookings
       where user_id = $1 and id like 'gt-%' and not cancelled and starts_at > to_timestamp($3::float8 / 1000)
         and to_char(starts_at at time zone tz, 'YYYY-MM-DD') = any($2::text[])`, [userId, days, now]);
    gone = gone.filter((r) => !keep.has(r.id));
    for (const r of gone) ops.push({ op: "booking.cancel", id: r.id });
  }
  await applyOps(db, userId, ops);
  const added = bookings.length - existing.filter((r) => keep.has(r.id)).length;
  return { saved: bookings.length, added: Math.max(0, added), cancelled: gone.length };
}

// The member's court times from now to two weeks ahead, for the dining view on the club site.
export async function upcomingBookings(db, userId, now = Date.now()) {
  const rows = await db.query(
    `select starts_at, minutes, court, kind from court_bookings
     where user_id = $1 and not cancelled and starts_at >= $2 and starts_at < $3 order by starts_at limit 50`,
    [userId, new Date(now - 6 * 3600000), new Date(now + 15 * 86400000)]);
  return rows.map((r) => ({ start: new Date(r.starts_at).getTime(), minutes: r.minutes, court: r.court, kind: r.kind }));
}

// The player's regular weekly times and the club's booking window, for the GameTime button.
export async function planInfo(db, userId) {
  const [plans, players] = await Promise.all([plansFor(db, userId), db.query(`select book_days, book_time from players where user_id = $1`, [userId])]);
  return { plans, window: bookingWindow(players[0]) };
}

// The button reads GameTime's refusal ("not allowed to book more than 7 days in advance"): `days` is
// how many days before a court time ends it opens.
export async function learnWindow(db, userId, w) {
  const days = Math.round(Number(w && w.days));
  if (!(days >= 1 && days <= 30)) return;
  await applyOps(db, userId, [{ op: "window.put", days }]);
}

// ---------- the player's own places on GameTime's waitlist ----------
// [{ date, start (minute), minutes, courts: ["14", "15"] }] from the button, which picks out the rows
// with the member's own name. Replaces what was saved before from today on.
export async function saveWaitlist(db, userId, list, now = Date.now()) {
  const rows = (Array.isArray(list) ? list.slice(0, 50) : []).filter((w) => w && DATE.test(w.date) && Number.isInteger(w.start) && w.start >= 0 && w.start < 1440
    && Number.isInteger(w.minutes) && w.minutes >= 15 && w.minutes <= 360);
  const ops = [[`delete from court_waitlist where user_id = $1`, [userId]]];
  const seen = new Set();
  for (const w of rows) {
    if (seen.has(w.date + "@" + w.start)) continue; seen.add(w.date + "@" + w.start);
    const courts = (Array.isArray(w.courts) ? w.courts : []).map((c) => String(c).replace(/\D/g, "")).filter(Boolean).slice(0, 20).join(", ") || null;
    ops.push([`insert into court_waitlist (user_id, day, start_min, minutes, courts, seen_at) values ($1, $2::date, $3, $4, $5, to_timestamp($6::float8 / 1000))`,
      [userId, w.date, w.start, w.minutes, courts, now]]);
  }
  await db.transaction(ops);
  return seen.size;
}

// ---------- open courts, as the button last saw them ----------
const GT_BASE = "https://stc.gametime.net";
export const gtBookLink = (courtId, date, start) => `${GT_BASE}/scheduling/index/book/sport/2/court/${courtId}/date/${date}/time/${start}`;
const COURT_AREA = (name) => { const n = +((/(\d+)/.exec(name || "") || [])[1]); return n >= 14 ? "indoor" : n >= 9 ? "clay" : n >= 1 ? "outdoor" : "any"; };

// One day's whole sheet from the button, checked: at most 40 courts of 120 court times each, every
// state one of o (open), b (taken), m (yours), l (lesson), e (club event). Null when there's none.
function cleanGrid(grid) {
  if (!Array.isArray(grid)) return null;
  return grid.slice(0, 40).filter((c) => c && typeof c.c === "string" && c.c.length <= 40 && /^\d{1,6}$/.test(String(c.i)) && Array.isArray(c.cells))
    .map((c) => ({
      c: c.c, i: String(c.i),
      cells: c.cells.slice(0, 120).filter((x) => Array.isArray(x) && Number.isInteger(x[0]) && x[0] >= 0 && x[0] < 1440
        && Number.isInteger(x[1]) && x[1] >= 15 && x[1] <= 360 && ["o", "b", "m", "l", "e"].includes(x[2])).map((x) => [x[0], x[1], x[2]]),
    }));
}

// { days: [{ date, slots: [{ c, i, t, d }], grid? }], at } from the button. Only free slots: nothing about who booked.
export async function saveOpenCourts(db, userId, body, now = Date.now()) {
  const days = Array.isArray(body && body.days) ? body.days.slice(0, 14) : [];
  const at = Math.min(Number(body && body.at) || now, now);
  const ops = [];
  for (const day of days) {
    if (!day || !DATE.test(day.date) || (!Array.isArray(day.slots) && !Array.isArray(day.grid))) continue;
    const grid = cleanGrid(day.grid);
    if (!Array.isArray(day.slots) && grid) day.slots = grid.flatMap((c) => c.cells.filter((x) => x[2] === "o").map(([t, d]) => ({ c: c.c, i: c.i, t, d })));
    const slots = day.slots.slice(0, 800).filter((x) => x && typeof x.c === "string" && x.c.length <= 40 && /^\d{1,6}$/.test(String(x.i))
      && Number.isInteger(x.t) && x.t >= 0 && x.t < 1440 && Number.isInteger(x.d) && x.d >= 15 && x.d <= 360)
      .map((x) => ({ c: x.c, i: String(x.i), t: x.t, d: x.d }));
    ops.push([`insert into court_open (user_id, day, slots, grid, scanned_at) values ($1, $2::date, $3::jsonb, $4::jsonb, to_timestamp($5::float8 / 1000))
               on conflict (user_id, day) do update set slots = excluded.slots, grid = excluded.grid, scanned_at = excluded.scanned_at`,
      [userId, day.date, JSON.stringify(slots), grid ? JSON.stringify(grid) : null, at]]);
  }
  ops.push([`delete from court_open where user_id = $1 and day < (now() at time zone 'America/Los_Angeles')::date - 1`, [userId]]);
  await db.transaction(ops);
  return ops.length - 1;
}

const toMin = (t) => (typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(3) : null);
// Open slots on the days asked, filtered by time window and area, each with a GameTime booking link.
export async function findOpenCourts(db, userId, { date, from, to, after, before, area } = {}, now = Date.now()) {
  const today = localDate(now, DEFAULT_TZ);
  const lo = date || from || today, hi = date || to || lo;
  const rows = await db.query(
    `select to_char(day, 'YYYY-MM-DD') as day, slots, (extract(epoch from scanned_at) * 1000)::float8 as at
     from court_open where user_id = $1 and day between $2::date and $3::date order by day`, [userId, lo, hi]);
  const a = toMin(after), b = toMin(before);
  const nowMin = (() => { const [h, m] = new Date(now).toLocaleTimeString("en-GB", { timeZone: DEFAULT_TZ, hour12: false }).split(":"); return +h * 60 + +m; })();
  return rows.map((r) => ({
    date: r.day, seen_at: new Date(Math.round(r.at)).toISOString(),
    open: (typeof r.slots === "string" ? JSON.parse(r.slots) : r.slots)
      .filter((x) => (a == null || x.t >= a) && (b == null || x.t < b) && (!area || area === "any" || COURT_AREA(x.c) === area) && !(r.day === today && x.t <= nowMin))
      .sort((p, q) => p.t - q.t || p.c.localeCompare(q.c, undefined, { numeric: true }))
      .map((x) => ({ court: x.c, start: String(Math.floor(x.t / 60)).padStart(2, "0") + ":" + String(x.t % 60).padStart(2, "0"), minutes: x.d, book: gtBookLink(x.i, r.day, x.t) })),
  }));
}

// A link to GameTime's booking form for a court and time. The court id comes from what the button
// saw, or the known STC court ids; without a court it's the day's best open slot near that time.
export async function bookingLink(db, userId, { date, time, court } = {}) {
  const t = toMin(time);
  if (!DATE.test(String(date || "")) || t == null) return null;
  const n = (/(\d+)/.exec(court || "") || [])[1];
  const [day] = await findOpenCourts(db, userId, { date });
  const open = day ? day.open : [];
  if (n) {
    const seen = open.find((x) => (/(\d+)/.exec(x.court) || [])[1] === n && x.start === time);
    const id = seen ? /court\/(\d+)\//.exec(seen.book)[1] : GT_COURT_IDS[n];
    return id ? { court: "Court " + n, link: gtBookLink(id, date, t), open: seen ? true : day ? false : null, seen_at: day ? day.seen_at : null } : null;
  }
  const near = open.map((x) => ({ ...x, gap: Math.abs(toMin(x.start) - t) })).filter((x) => x.gap <= 60).sort((p, q) => p.gap - q.gap)[0];
  return near ? { court: near.court, start: near.start, link: near.book, open: true, seen_at: day.seen_at } : { court: null, link: null, open: false, seen_at: day ? day.seen_at : null };
}
