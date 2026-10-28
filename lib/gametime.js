import { createHash } from "node:crypto";
import { applyOps, PLAY_KINDS } from "./store.js";
import { zonedToUtc, DEFAULT_TZ } from "../public/courts.js";

// Bookings sent by the GameTime button (public/stc.js) from the member's own signed-in GameTime
// page. Each GameTime booking keeps one row here (id "gt-<bkId>-<player>"), so sending the same
// week again updates rather than duplicates. A GameTime booking that disappears from a day that
// was just read was cancelled or moved, so it is cancelled here too.

const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/, BKID = /^\d{1,12}$/;
export const MAX_IMPORT = 100;

class Invalid extends Error { constructor(m) { super(m); this.status = 400; } }

const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const rowId = (userId, bkId) => "gt-" + bkId + "-" + createHash("sha256").update(String(userId)).digest("hex").slice(0, 8);

export function cleanImport(body) {
  if (!body || typeof body !== "object") throw new Invalid("Nothing was sent.");
  const days = Array.isArray(body.days) ? body.days.filter((d) => typeof d === "string" && DATE.test(d)).slice(0, 14) : [];
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
    let id = rowId(userId, b.bkId);
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
