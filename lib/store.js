// Rackets and readings. The phone sends a list of changes ("ops"); they are applied in one
// transaction and the signed-in user's whole state comes back. Ops are safe to send twice.
// Every query is scoped to that user: a change to someone else's racket or reading does nothing.

import { DEFAULT_TZ } from "../public/courts.js";

export const MATERIALS = ["poly", "multi", "syngut", "gut", "hybrid", "kevlar"];
export const PATTERNS = ["16x19", "18x20", "16x18", "18x19"];
export const PLAY_KINDS = ["singles", "doubles", "hitting", "drills", "ball_machine", "serves"];
export const LEVELS = ["2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0", "7.0"];
export const STYLES = ["heavy_spin", "moderate_spin", "flat", "all_court", "serve_volley", "counter"];
export const MAX_OPS = 500;
export const JOB_REASONS = ["broke", "dead", "routine"];
export const AREAS = ["indoor", "outdoor", "clay", "any"];

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

class Invalid extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}

const num = (v, lo, hi, what) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Invalid(`${what} must be a number from ${lo} to ${hi}.`);
  return v;
};
const optNum = (v, lo, hi, what) => (v === null || v === undefined ? null : num(v, lo, hi, what));
const optText = (v, max, what) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || v.length > max) throw new Invalid(`${what} must be text up to ${max} characters.`);
  return v;
};
const id = (v, what) => {
  if (typeof v !== "string" || !ID.test(v)) throw new Invalid(`${what} is not a valid id.`);
  return v;
};
const validTz = (v) => {
  if (v === null || v === undefined || v === "") return DEFAULT_TZ;
  if (typeof v === "string" && v.length <= 64) { try { new Intl.DateTimeFormat("en-CA", { timeZone: v }); return v; } catch {} }
  throw new Invalid("Time zone is not valid.");
};
const oneOf = (v, list, what) => {
  if (!list.includes(v)) throw new Invalid(`${what} must be one of ${list.join(", ")}.`);
  return v;
};

function racketFields(d) {
  if (!d || typeof d !== "object") throw new Invalid("Racket data is missing.");
  const name = optText(d.name, 60, "Name");
  if (!name) throw new Invalid("Name is required.");
  const strungOn = d.strungOn === null || d.strungOn === undefined || d.strungOn === "" ? null : d.strungOn;
  if (strungOn !== null && (typeof strungOn !== "string" || !DATE.test(strungOn))) throw new Invalid("Strung on must be a date like 2026-10-11.");
  return {
    name,
    head: num(d.head, 60, 140, "Head size"),
    gauge: num(d.gauge, 1.0, 1.5, "Gauge"),
    material: oneOf(d.material, MATERIALS, "String"),
    pattern: oneOf(d.pattern || "16x19", PATTERNS, "Pattern"),
    weight: d.weight === null || d.weight === undefined ? null : Math.round(num(d.weight, 150, 450, "Weight")),
    stringName: optText(d.stringName, 60, "String name"),
    strungKg: optNum(d.strungKg, 5, 40, "Strung tension"),
    strungOn,
    calib: d.calib === undefined || d.calib === null ? 1 : num(d.calib, 0.3, 3, "Calibration"),
    calibAt: optNum(d.calibAt, 0, 8.64e15, "Calibration time"),
  };
}

function setupFields(s) {
  if (s === null || s === undefined) return null;
  if (typeof s !== "object") throw new Invalid("Reading setup must be an object.");
  return {
    head: num(s.head, 60, 140, "Setup head size"),
    gauge: num(s.gauge, 1.0, 1.5, "Setup gauge"),
    material: oneOf(s.material, MATERIALS, "Setup string"),
    pattern: oneOf(s.pattern || "16x19", PATTERNS, "Setup pattern"),
    calib: num(s.calib ?? 1, 0.3, 3, "Setup calibration"),
  };
}

// Turn one op into SQL. Throws Invalid for anything malformed, so a bad op never reaches the database.
export function opToQuery(op, userId) {
  if (!op || typeof op !== "object") throw new Invalid("Each change must be an object.");
  switch (op.op) {
    case "racket.put": {
      const r = racketFields(op.data);
      return [
        `insert into rackets (id, user_id, name, head, gauge, material, pattern, weight, string_name, strung_kg, strung_on, calib, calib_at, updated_at)
         values ($1, $13, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, case when $12::float8 is null then null else to_timestamp($12::float8 / 1000) end, now())
         on conflict (id) do update set
           name = excluded.name, head = excluded.head, gauge = excluded.gauge, material = excluded.material,
           pattern = excluded.pattern, weight = excluded.weight, string_name = excluded.string_name,
           strung_kg = excluded.strung_kg, strung_on = excluded.strung_on, calib = excluded.calib,
           calib_at = excluded.calib_at, updated_at = now()
         where rackets.user_id = excluded.user_id`,
        [id(op.id, "Racket"), r.name, r.head, r.gauge, r.material, r.pattern, r.weight, r.stringName, r.strungKg, r.strungOn, r.calib, r.calibAt, userId],
      ];
    }
    case "racket.delete":
      return [`delete from rackets where id = $1 and user_id = $2`, [id(op.id, "Racket"), userId]];
    case "reading.add": {
      const t = num(op.t, 0, 8.64e15, "Reading time");
      const hz = num(op.hz, 100, 2000, "Pitch");
      const setup = setupFields(op.s);
      // A racket deleted on another device just drops the reading, rather than failing the whole sync.
      return [
        `insert into readings (id, racket_id, taken_at, hz, setup)
         select $1, $2, to_timestamp($3::float8 / 1000), $4, $5::jsonb
         where exists (select 1 from rackets where id = $2 and user_id = $6)
         on conflict (id) do nothing`,
        [id(op.id, "Reading"), id(op.racketId, "Racket"), t, hz, setup === null ? null : JSON.stringify(setup), userId],
      ];
    }
    case "play.add": {
      if (typeof op.d !== "string" || !DATE.test(op.d)) throw new Invalid("Play date must be a date like 2026-10-27.");
      const minutes = Math.round(num(op.min, 5, 600, "Minutes played"));
      const kind = oneOf(op.kind, PLAY_KINDS, "Type of play");
      // Like readings: a racket deleted on another device just drops the session.
      return [
        `insert into plays (id, racket_id, played_on, minutes, kind)
         select $1, $2, $3::date, $4, $5
         where exists (select 1 from rackets where id = $2 and user_id = $6)
         on conflict (id) do nothing`,
        [id(op.id, "Play"), id(op.racketId, "Racket"), op.d, minutes, kind, userId],
      ];
    }
    case "play.delete":
      return [
        `delete from plays using rackets
         where plays.id = $1 and plays.racket_id = rackets.id and rackets.user_id = $2`,
        [id(op.id, "Play"), userId],
      ];
    case "profile.put": {
      const d = op.data && typeof op.data === "object" ? op.data : {};
      const level = d.level === null || d.level === undefined || d.level === "" ? null : oneOf(d.level, LEVELS, "Level");
      const style = d.style === null || d.style === undefined || d.style === "" ? null : oneOf(d.style, STYLES, "Style");
      return [
        `insert into players (user_id, level, style, updated_at) values ($1, $2, $3, now())
         on conflict (user_id) do update set level = excluded.level, style = excluded.style, updated_at = now()`,
        [userId, level, style],
      ];
    }
    case "booking.put": {
      const start = num(op.start, 1.5e12, 8.64e15, "Booking start");
      const minutes = Math.round(num(op.min, 15, 360, "Booking length"));
      const kind = oneOf(op.kind || "singles", PLAY_KINDS, "Type of play");
      const tz = validTz(op.tz);
      const racketId = op.racketId === null || op.racketId === undefined || op.racketId === "" ? null : id(op.racketId, "Racket");
      // A racket that isn't this player's is dropped rather than linked.
      return [
        `insert into court_bookings (id, user_id, starts_at, minutes, tz, kind, court, location, note, ref, racket_id, updated_at)
         values ($1, $2, to_timestamp($3::float8 / 1000), $4, $5, $6, $7, $8, $9, $10,
                 (select id from rackets where id = $11 and user_id = $2), now())
         on conflict (id) do update set
           starts_at = excluded.starts_at, minutes = excluded.minutes, tz = excluded.tz, kind = excluded.kind,
           court = excluded.court, location = excluded.location, note = excluded.note, ref = excluded.ref,
           racket_id = excluded.racket_id, cancelled = false, updated_at = now()
         where court_bookings.user_id = excluded.user_id`,
        [id(op.id, "Booking"), userId, start, minutes, tz, kind, optText(op.court, 40, "Court"), optText(op.location, 80, "Location"),
         optText(op.note, 200, "Note"), optText(op.ref, 40, "Booking number"), racketId],
      ];
    }
    case "plan.put": {
      // A regular weekly court time. Its "book now" reminder goes in the court calendar.
      if (typeof op.time !== "string" || !TIME.test(op.time)) throw new Invalid("Start must be a time like 18:00.");
      return [
        `insert into court_plans (id, user_id, dow, start_time, minutes, area, court, kind, note, backups, paused, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         on conflict (id) do update set dow = excluded.dow, start_time = excluded.start_time, minutes = excluded.minutes,
           area = excluded.area, court = excluded.court, kind = excluded.kind, note = excluded.note,
           backups = excluded.backups, paused = excluded.paused, updated_at = now()
         where court_plans.user_id = excluded.user_id`,
        [id(op.id, "Regular time"), userId, Math.round(num(op.dow, 0, 6, "Day of the week")), op.time,
         Math.round(num(op.min, 15, 360, "Length")), oneOf(op.area || "any", AREAS, "Area"), optText(op.court, 40, "Court"),
         oneOf(op.kind || "singles", PLAY_KINDS, "Type of play"), optText(op.note, 120, "Note"),
         courtList(op.backups), op.paused === true],
      ];
    }
    case "plan.delete":
      return [`delete from court_plans where id = $1 and user_id = $2`, [id(op.id, "Regular time"), userId]];
    case "window.put": {
      // How many days before a court time ends GameTime opens it. book_time is from an older model
      // (a fixed daily opening time) and is cleared, which also marks the row as using this rule.
      return [
        `insert into players (user_id, book_days, book_time, updated_at) values ($1, $2, null, now())
         on conflict (user_id) do update set book_days = excluded.book_days, book_time = null, updated_at = now()`,
        [userId, Math.round(num(op.days, 1, 30, "Days ahead"))],
      ];
    }
    case "booking.cancel":
      // Kept as cancelled (not deleted) so subscribed calendars remove the event too.
      return [`update court_bookings set cancelled = true, updated_at = now() where id = $1 and user_id = $2`, [id(op.id, "Booking"), userId]];
    case "job.add": {
      // Past strings, saved when a racket is restrung. Like readings, a racket deleted elsewhere drops it.
      for (const [k, what] of [["from", "Strung on"], ["to", "Came out on"]]) {
        if (typeof op[k] !== "string" || !DATE.test(op[k])) throw new Invalid(`${what} must be a date like 2026-10-11.`);
      }
      if (op.to < op.from) throw new Invalid("Strings can't come out before they went in.");
      return [
        `insert into string_jobs (id, racket_id, strung_on, ended_on, reason, string_name, material, gauge, strung_kg)
         select $1, $2, $3::date, $4::date, $5, $6, $7, $8, $9
         where exists (select 1 from rackets where id = $2 and user_id = $10)
         on conflict (id) do nothing`,
        [id(op.id, "String job"), id(op.racketId, "Racket"), op.from, op.to, oneOf(op.reason, JOB_REASONS, "Reason"),
         optText(op.stringName, 60, "String name"), oneOf(op.material, MATERIALS, "String"), num(op.gauge, 1.0, 1.5, "Gauge"),
         optNum(op.strungKg, 5, 40, "Strung tension"), userId],
      ];
    }
    case "job.delete":
      return [
        `delete from string_jobs using rackets
         where string_jobs.id = $1 and string_jobs.racket_id = rackets.id and rackets.user_id = $2`,
        [id(op.id, "String job"), userId],
      ];
    case "shoe.put": {
      const d = op.data && typeof op.data === "object" ? op.data : {};
      const name = optText(d.name, 60, "Shoe name");
      if (!name) throw new Invalid("Shoe name is required.");
      if (typeof d.startedOn !== "string" || !DATE.test(d.startedOn)) throw new Invalid("In use from must be a date like 2026-10-11.");
      const retired = d.retiredOn === null || d.retiredOn === undefined || d.retiredOn === "" ? null : d.retiredOn;
      if (retired !== null && (typeof retired !== "string" || !DATE.test(retired))) throw new Invalid("Retired on must be a date like 2026-10-11.");
      if (retired && retired < d.startedOn) throw new Invalid("Shoes can't be retired before they went into use.");
      return [
        `insert into shoes (id, user_id, name, started_on, retired_on, life_hours, updated_at) values ($1, $2, $3, $4::date, $5::date, $6, now())
         on conflict (id) do update set name = excluded.name, started_on = excluded.started_on, retired_on = excluded.retired_on,
           life_hours = excluded.life_hours, updated_at = now()
         where shoes.user_id = excluded.user_id`,
        [id(op.id, "Shoe"), userId, name, d.startedOn, retired, Math.round(num(d.lifeHours ?? 60, 10, 500, "Expected life"))],
      ];
    }
    case "shoe.delete":
      return [`delete from shoes where id = $1 and user_id = $2`, [id(op.id, "Shoe"), userId]];
    case "reading.delete":
      return [
        `delete from readings using rackets
         where readings.id = $1 and readings.racket_id = rackets.id and rackets.user_id = $2`,
        [id(op.id, "Reading"), userId],
      ];
    default:
      throw new Invalid(`Unknown change "${String(op.op).slice(0, 40)}".`);
  }
}

function requireUser(userId) {
  if (typeof userId !== "string" || !userId) throw new Error("A signed-in user is required.");
}

// Strict by default (the chat tools want an error). With { skipInvalid: true } (the phone's sync),
// a malformed change is left out and reported instead, so one bad value can't throw away the
// readings and sessions queued with it. Returns the refused changes as [{ index, op, error }].
export async function applyOps(db, userId, ops, { skipInvalid = false } = {}) {
  requireUser(userId);
  if (!Array.isArray(ops)) throw new Invalid("ops must be a list.");
  if (ops.length > MAX_OPS) throw new Invalid(`Send at most ${MAX_OPS} changes at a time.`);
  const queries = [], refused = [];
  ops.forEach((op, index) => {
    try { queries.push(opToQuery(op, userId)); }
    catch (e) {
      if (!skipInvalid || !(e instanceof Invalid)) throw e;
      refused.push({ index, op, error: e.message });
    }
  });
  await db.transaction(queries);
  return refused;
}

export async function getState(db, userId) {
  requireUser(userId);
  const [rackets, readings, plays, players, bookings, jobs, plans, shoeRows] = await Promise.all([
    db.query(`select id, name, head, gauge, material, pattern, weight, string_name, strung_kg,
                     to_char(strung_on, 'YYYY-MM-DD') as strung_on, calib,
                     (extract(epoch from calib_at) * 1000)::float8 as calib_at
              from rackets where user_id = $1 order by name`, [userId]),
    db.query(`select r.id, r.racket_id, (extract(epoch from r.taken_at) * 1000)::float8 as t, r.hz, r.setup
              from readings r join rackets k on k.id = r.racket_id
              where k.user_id = $1 order by r.taken_at`, [userId]),
    db.query(`select p.id, p.racket_id, to_char(p.played_on, 'YYYY-MM-DD') as d, p.minutes, p.kind
              from plays p join rackets k on k.id = p.racket_id
              where k.user_id = $1 order by p.played_on, p.created_at`, [userId]),
    db.query(`select level, style, book_days, book_time from players where user_id = $1`, [userId]),
    // Upcoming bookings plus the last two weeks, so a just-finished one still shows.
    db.query(`select id, (extract(epoch from starts_at) * 1000)::float8 as start, minutes, tz, kind, court, location, note, ref, racket_id, play_id
              from court_bookings where user_id = $1 and not cancelled and starts_at > now() - interval '14 days'
              order by starts_at`, [userId]),
    db.query(`select j.id, j.racket_id, to_char(j.strung_on, 'YYYY-MM-DD') as "from", to_char(j.ended_on, 'YYYY-MM-DD') as "to",
                     j.reason, j.string_name, j.material, j.gauge, j.strung_kg
              from string_jobs j join rackets k on k.id = j.racket_id
              where k.user_id = $1 order by j.ended_on, j.created_at`, [userId]),
    plansFor(db, userId),
    db.query(`select id, name, to_char(started_on, 'YYYY-MM-DD') as started_on, to_char(retired_on, 'YYYY-MM-DD') as retired_on, life_hours
              from shoes where user_id = $1 order by started_on`, [userId]),
  ]);
  const out = {};
  for (const r of rackets) {
    out[r.id] = {
      name: r.name, head: Number(r.head), gauge: round(r.gauge, 3), material: r.material, pattern: r.pattern,
      weight: r.weight, stringName: r.string_name, strungKg: r.strung_kg === null ? null : round(r.strung_kg, 2),
      strungOn: r.strung_on, calib: round(r.calib, 5), calibAt: r.calib_at === null ? null : Math.round(r.calib_at),
      readings: [], plays: [], jobs: [],
    };
  }
  for (const x of readings) {
    const r = out[x.racket_id];
    if (!r) continue;
    const s = typeof x.setup === "string" ? JSON.parse(x.setup) : x.setup;
    r.readings.push({ id: x.id, t: Math.round(x.t), hz: round(x.hz, 1), ...(s ? { s } : {}) });
  }
  for (const p of plays) {
    const r = out[p.racket_id];
    if (r) r.plays.push({ id: p.id, d: p.d, min: Number(p.minutes), kind: p.kind });
  }
  for (const j of jobs) {
    const r = out[j.racket_id];
    if (r) r.jobs.push({ id: j.id, from: j.from, to: j.to, reason: j.reason, stringName: j.string_name, material: j.material,
      gauge: round(j.gauge, 3), strungKg: j.strung_kg === null ? null : round(j.strung_kg, 2) });
  }
  const profile = players[0] ? { level: players[0].level, style: players[0].style } : { level: null, style: null };
  const courts = bookings.map((b) => ({
    id: b.id, start: Math.round(b.start), min: Number(b.minutes), tz: b.tz, kind: b.kind, court: b.court, location: b.location,
    note: b.note, ref: b.ref, racketId: b.racket_id, playId: b.play_id,
  }));
  const shoes = shoeRows.map((x) => ({ id: x.id, name: x.name, startedOn: x.started_on, retiredOn: x.retired_on, lifeHours: Number(x.life_hours) }));
  return { rackets: out, profile, shoes, bookings: courts, plans, window: bookingWindow(players[0]) };
}

// Until the player says otherwise: a day opens a week ahead at 7 am.
// STC: each court time opens 7 days before it ends (seen 2026-10-30). Rows saved under the old
// fixed-daily-time guess (book_time set) are ignored.
export const DEFAULT_WINDOW = { days: 7, set: false };
export const bookingWindow = (p) => (p && p.book_days !== null && p.book_days !== undefined && !p.book_time
  ? { days: Number(p.book_days), set: true } : { ...DEFAULT_WINDOW });

export async function plansFor(db, userId) {
  const rows = await db.query(
    `select id, dow, start_time, minutes, area, court, kind, note, backups, paused from court_plans where user_id = $1 order by dow, start_time`, [userId]);
  return rows.map((p) => ({ id: p.id, dow: Number(p.dow), time: p.start_time, min: Number(p.minutes), area: p.area, court: p.court, kind: p.kind, note: p.note,
    backups: p.backups || null, paused: !!p.paused }));
}
// Backup courts, in the order to try them: "15, ct 14" becomes "Court 15, Court 14" (at most 6).
export function courtList(v) {
  if (v === undefined || v === null || v === "") return null;
  const list = (Array.isArray(v) ? v : String(v).split(/[,;/]+/)).map((x) => String(x).trim()).filter(Boolean)
    .map((x) => { const n = /^(?:court|ct\.?)?\s*(\d{1,2})$/i.exec(x); return n ? "Court " + Number(n[1]) : x; });
  if (list.length > 6 || list.some((x) => x.length > 20)) throw new Invalid("Backup courts: up to 6, like \"Court 15, Court 14\".");
  return list.length ? list.join(", ") : null;
}

// real columns come back as float4, so trim the float noise (1.25 -> 1.2499999)
const round = (v, places) => (v === null ? null : Number(Number(v).toFixed(places)));
