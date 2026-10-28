import { randomUUID } from "node:crypto";
import { localDate, toIcs } from "../public/courts.js";

// Court bookings turn into play sessions once they're over, and feed a calendar the player
// subscribes to. Both run on the server so they work without the app open.

// The racket a finished booking is logged to: the one picked on the booking, else the one
// played with most recently (or strung most recently), else none.
function defaultRacket(rackets) {
  let best = null, bestDay = "";
  for (const r of rackets) {
    const day = [r.last_played, r.strung_on].filter(Boolean).sort().pop() || "";
    if (!best || day > bestDay) { best = r; bestDay = day; }
  }
  return best ? best.id : null;
}

// Log every finished, not-yet-logged booking of the last 30 days as a play session. Safe to run
// on every request: a booking is claimed and its session added in one transaction.
export async function logFinishedBookings(db, userId, now = Date.now()) {
  const due = await db.query(
    `select id, (extract(epoch from starts_at) * 1000)::float8 as start, minutes, tz, kind, racket_id
     from court_bookings
     where user_id = $1 and not cancelled and play_id is null
       and starts_at + make_interval(mins => minutes) <= to_timestamp($2::float8 / 1000)
       and starts_at > to_timestamp($2::float8 / 1000) - interval '30 days'`, [userId, now]);
  if (!due.length) return [];
  const rackets = await db.query(
    `select k.id, to_char(k.strung_on, 'YYYY-MM-DD') as strung_on,
            (select to_char(max(p.played_on), 'YYYY-MM-DD') from plays p where p.racket_id = k.id) as last_played
     from rackets k where k.user_id = $1`, [userId]);
  const fallback = defaultRacket(rackets);
  const logged = [];
  for (const b of due) {
    const racketId = b.racket_id || fallback;
    if (!racketId) break; // no rackets yet: try again once there is one
    const playId = randomUUID();
    const day = localDate(b.start, b.tz);
    // The update only claims a booking still unlogged, so two requests at once can't log it twice.
    const [claimed] = await db.transaction([
      [`update court_bookings set play_id = $1 where id = $2 and user_id = $3 and play_id is null returning id`, [playId, b.id, userId]],
      [`insert into plays (id, racket_id, played_on, minutes, kind)
        select $1, $2, $3::date, $4, $5
        where exists (select 1 from court_bookings where id = $6 and play_id = $1)
          and exists (select 1 from rackets where id = $2 and user_id = $7)`,
        [playId, racketId, day, Math.min(600, Number(b.minutes)), b.kind, b.id, userId]],
    ]);
    if (claimed.length) logged.push({ booking: b.id, play: playId, racketId, day });
  }
  return logged;
}

// The player's calendar: the last 60 days and everything ahead, cancelled ones included so
// calendar apps remove them.
export async function calendarFor(db, userId, now = Date.now()) {
  const rows = await db.query(
    `select id, (extract(epoch from starts_at) * 1000)::float8 as start, minutes, kind, court, location, note, ref, cancelled,
            (extract(epoch from updated_at) * 1000)::float8 as updated
     from court_bookings where user_id = $1 and starts_at > to_timestamp($2::float8 / 1000) - interval '60 days'
     order by starts_at limit 500`, [userId, now]);
  const list = rows.map((r) => ({
    id: r.id, start: Math.round(r.start), min: Number(r.minutes), kind: r.kind, court: r.court, location: r.location,
    note: r.note, ref: r.ref, cancelled: !!r.cancelled, updated: Math.round(r.updated),
  }));
  return toIcs(list, { now });
}
