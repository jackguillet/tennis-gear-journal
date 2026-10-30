import { randomUUID } from "node:crypto";
import { applyOps, getState, plansFor, PLAY_KINDS, LEVELS, STYLES } from "./store.js";
// Same pitch -> tension model as the app.
import { LB, readingKg, readingBedKg } from "../public/tension.js";
// Same restring advice as the app.
import { restringAdvice, personalBreak } from "../public/restring.js";
import { DEFAULT_LOCATION, DEFAULT_TZ, zonedToUtc, localDate, bookingTitle, planTitle, planOpenings, planLink, DAY_NAMES } from "../public/courts.js";
import { findOpenCourts, bookingLink, planInfo } from "./gametime.js";
import { logFinishedBookings } from "./bookings.js";
// Same string-job history as the app.
import { shoeWear, currentShoe } from "../public/shoes.js";
import { REASONS, REASON_NAMES, currentJob, minutesBetween, stringStats, onCurrentStrings } from "../public/stringjobs.js";

// The tools a chat assistant (Claude, ChatGPT, ...) can call for one player, through the MCP
// endpoint in api/mcp.js. Every write goes through the same validated ops as the app's sync,
// so the phone picks the change up on its next sync.

const KIND_NAMES = { singles: "singles", doubles: "doubles", hitting: "hitting", drills: "lesson / drills", ball_machine: "ball machine", serves: "serves" };
const STYLE_NAMES = { heavy_spin: "heavy topspin", moderate_spin: "moderate topspin", flat: "flat hitter", all_court: "all-court / slice", serve_volley: "serve and volley", counter: "counterpuncher" };

class ToolError extends Error {}
const fail = (msg) => { throw new ToolError(msg); };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayIn = (tz) => {
  try { return new Date().toLocaleDateString("en-CA", { timeZone: tz || "UTC" }); } catch { return new Date().toISOString().slice(0, 10); }
};
const hrs = (min) => Math.round(min / 6) / 10;
const onStrings = (r) => onCurrentStrings(r);
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function summary(id, r, ctx) {
  const mine = onStrings(r), minutes = mine.reduce((a, p) => a + p.min, 0);
  const last = r.readings.length ? r.readings[r.readings.length - 1] : null;
  const lastKg = last ? readingKg(last, r) : null;
  return {
    id, name: r.name, string: r.stringName || null,
    strung_on: r.strungOn || null,
    strung_at_lb: r.strungKg ? Math.round(r.strungKg * LB * 10) / 10 : null,
    hours_on_current_strings: hrs(minutes),
    sessions_on_current_strings: mine.length,
    hours_by_type: Object.fromEntries(Object.entries(mine.reduce((m, p) => { m[p.kind] = (m[p.kind] || 0) + p.min; return m; }, {})).map(([k, v]) => [k, hrs(v)])),
    last_tension_reading: last ? { date: new Date(last.t).toISOString().slice(0, 10), lb: Math.round(lastKg * LB * 10) / 10, kg: Math.round(lastKg * 10) / 10, estimate: (r.calib || 1) === 1, string_bed_lb: Math.round(readingBedKg(last, r) * LB * 10) / 10 } : null,
    ...(ctx ? { restring: restringAdvice(r, ctx.profile, ctx.today, ctx.personal) } : {}),
  };
}

// Find a racket from what the person said ("v8", "my blade", an id). With nothing said, use the
// one they played with most recently, or the only one.
function pickRacket(rackets, query) {
  const list = Object.entries(rackets);
  if (!list.length) fail("This player has no rackets yet. Add one in the Tennis Hub app first.");
  if (query === undefined || query === null || String(query).trim() === "") {
    if (list.length === 1) return list[0];
    const recent = list.map(([id, r]) => [id, r, (r.plays || []).reduce((m, p) => (p.d > m ? p.d : m), r.strungOn || "")]).sort((a, b) => b[2].localeCompare(a[2]));
    return [recent[0][0], recent[0][1]];
  }
  const q = String(query).toLowerCase().trim();
  if (rackets[query]) return [query, rackets[query]];
  const exact = list.filter(([, r]) => r.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const words = q.split(/[^a-z0-9.]+/).filter((w) => w && !["my", "the", "racket", "racquet"].includes(w));
  const hits = list.filter(([, r]) => { const n = r.name.toLowerCase(); return words.length && words.every((w) => n.includes(w)); });
  if (hits.length === 1) return hits[0];
  const names = list.map(([, r]) => `"${r.name}"`).join(", ");
  fail(hits.length > 1 ? `"${query}" matches more than one racket: ${hits.map(([, r]) => `"${r.name}"`).join(", ")}. Say which one.` : `No racket matches "${query}". This player's rackets: ${names}.`);
}

function minutesFrom(args) {
  if (args.minutes !== undefined && args.minutes !== null) return Math.round(Number(args.minutes));
  if (args.hours !== undefined && args.hours !== null) return Math.round(Number(args.hours) * 60);
  fail("Say how long they played, in minutes or hours.");
}

export const TOOLS = [
  {
    name: "log_play",
    title: "Log a tennis session",
    description: "Log time played with a racket (for example 'I played an hour of singles'). Adds the session to the racket's play tracker in the Tennis Hub app, where it counts toward hours on the current strings. If the person doesn't name a racket, leave racket out and the one they used most recently is chosen; the result says which.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: PLAY_KINDS, description: "Type of play. hitting = rallying or practice with someone; drills = a lesson, clinic or drills; serves = serve practice." },
        minutes: { type: "number", minimum: 5, maximum: 600, description: "How long they played, in minutes. Give this or hours." },
        hours: { type: "number", minimum: 0.1, maximum: 10, description: "How long they played, in hours (1.5 = 90 minutes). Give this or minutes." },
        racket: { type: "string", description: "Racket name or part of it, such as 'Blade v8', or a racket id from list_rackets. Optional." },
        date: { type: "string", description: "Day played, YYYY-MM-DD, in the person's local time. Leave out for today; use it for 'yesterday' and earlier." },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "list_rackets",
    title: "List rackets and string wear",
    description: "List the player's rackets with hours played on the current strings (split by type), when and at what tension they were strung, and the latest tension reading. Use it to answer questions like 'how many hours are on my strings?'. Each racket also has a restring estimate (see restring_advice). A reading's lb is in stringing-machine terms (comparable to the tension asked for); string_bed_lb is the tension actually left in the strings, typically 30-40% lower.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "restring_advice",
    title: "Should I restring?",
    description: "Say whether a racket's strings need replacing, and roughly when. Weighs the string type (polyester goes dead fastest), gauge, pattern, head size and tension (how fast strings notch and break), hours played on these strings weighted by type of play, the player's level and spin, the tension loss measured since stringing, and the strings' age. status is good, soon or now; life_used_pct is the share of string life used by the closest limit (reason: dead, break, tension or age); restring_by is a projected date at the player's recent pace. Leave racket out to get every racket.",
    inputSchema: { type: "object", properties: { racket: { type: "string", description: "Racket name or id. Leave out for all rackets." } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_sessions",
    title: "List recent sessions",
    description: "List recent play sessions for one racket, or for all rackets, newest first. Each has an id that delete_session takes.",
    inputSchema: {
      type: "object",
      properties: {
        racket: { type: "string", description: "Racket name or id. Leave out for all rackets." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many sessions to return. Default 10." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "delete_session",
    title: "Delete a session",
    description: "Delete one play session, for example one logged by mistake. Get its id from log_play's result or list_sessions.",
    inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: "record_restring",
    title: "Record a restring",
    description: "Record that a racket was restrung. The old strings are saved to the racket's string history (with the hours they lasted and why they came out), and the Strung on date moves, so the hours-on-strings count starts again from zero. Optionally sets the tension and string name.",
    inputSchema: {
      type: "object",
      properties: {
        racket: { type: "string", description: "Racket name or id." },
        date: { type: "string", description: "Day it was restrung, YYYY-MM-DD in the person's local time. Leave out for today." },
        tension_lb: { type: "number", minimum: 20, maximum: 80, description: "Tension the stringer used, in pounds. Give this or tension_kg." },
        tension_kg: { type: "number", minimum: 10, maximum: 36, description: "Tension the stringer used, in kilograms." },
        string_name: { type: "string", maxLength: 60, description: "String used, for example 'Luxilon ALU Power 1.25'." },
        old_strings: { type: "string", enum: REASONS, description: "Why the old strings came out: broke, dead (lost playability or tension) or routine. Ask if it isn't clear; default routine." },
      },
      required: ["racket"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "strings_broke",
    title: "Strings broke",
    description: "Record that a racket's strings broke (for example 'I broke a string on my v8'). Saves the set to the string history as broken, with the hours it lasted, and marks the racket as waiting for a restring; call record_restring when it is restrung. Each break makes the restring estimate's break hours more like this player's own. If they already restrung, call record_restring with old_strings broke instead.",
    inputSchema: {
      type: "object",
      properties: {
        racket: { type: "string", description: "Racket name or id. Optional when they have one racket or just played with it." },
        date: { type: "string", description: "Day it broke, YYYY-MM-DD in the person's local time. Leave out for today." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "list_shoes",
    title: "Shoe wear",
    description: "List the player's tennis shoes with hours played in each pair (counted from all logged play while the pair was in use), the expected life and whether they're wearing out. Use it for 'how worn are my shoes?' or 'how long did my last pair last?'.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "string_history",
    title: "String history",
    description: "List the past string jobs on one racket or all of them: when each set went in and came out, string, tension, hours played on it and why it came out (broke, dead or routine). Also compares strings: average hours each string lasted and how often it broke. Use it for 'which string lasts longest?' or 'how long did my last strings last?'.",
    inputSchema: { type: "object", properties: { racket: { type: "string", description: "Racket name or id. Leave out for all rackets." } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "set_player_profile",
    title: "Set level and style",
    description: "Set the player's NTRP level and style of play, shown in the app under Your game.",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "string", enum: LEVELS, description: "NTRP level." },
        style: { type: "string", enum: STYLES, description: "heavy_spin, moderate_spin, flat, all_court (incl. slice), serve_volley or counter (counterpuncher)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "add_court_booking",
    title: "Add a court booking",
    description: "Save a tennis court booking, for example from a Seattle Tennis Club / GameTime confirmation email the person pastes or forwards. It appears in the app and in the person's subscribed court calendar, and once the booking has ended its time is logged as play on the racket automatically. Read the date, start time, length, court and booking number from the email. Times are local to the club. Calling it again with the same ref updates that booking instead of adding a second one.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Day of the booking, YYYY-MM-DD." },
        start_time: { type: "string", description: "Start time, 24-hour HH:MM in the club's local time, e.g. 18:30." },
        minutes: { type: "number", minimum: 15, maximum: 360, description: "Length of the booking in minutes. Use end time minus start time when the email gives both." },
        kind: { type: "string", enum: PLAY_KINDS, description: "Type of play. Guess from the email (two players = singles, four = doubles, a lesson or clinic = drills); default singles." },
        court: { type: "string", maxLength: 40, description: "Court name or number, e.g. 'Court 3' or 'Indoor 2'." },
        ref: { type: "string", maxLength: 40, description: "The booking or confirmation number from the email, if any." },
        note: { type: "string", maxLength: 200, description: "Partners or the lesson pro, if the email names them." },
        racket: { type: "string", description: "Racket to log the time to. Leave out to use the one played with most recently." },
        location: { type: "string", maxLength: 80, description: "Club name. Leave out for Seattle Tennis Club." },
        time_zone: { type: "string", description: "IANA time zone of the club. Leave out for America/Los_Angeles." },
      },
      required: ["date", "start_time", "minutes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "list_court_bookings",
    title: "List court bookings",
    description: "List the person's upcoming court bookings and those from the last two weeks, with whether each has been logged as play. Each has an id that cancel_court_booking takes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "cancel_court_booking",
    title: "Cancel a court booking",
    description: "Remove a court booking from the app and the person's calendar, for example after a cancellation email. This does not cancel it with the club; the person still does that in GameTime. If the booking was already logged as play, that session stays (use delete_session to remove it).",
    inputSchema: { type: "object", properties: { booking_id: { type: "string", description: "Id from list_court_bookings or add_court_booking." }, ref: { type: "string", description: "Or the club's booking number." } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: "find_open_courts",
    title: "Find open courts",
    description: "Open tennis court slots at the Seattle Tennis Club, as the person's GameTime button last saw them (it saves free slots for the coming week each time they tap it on stc.gametime.net; seen_at says when). Each slot has a 'book' link that opens GameTime's booking form for that court and time. You cannot finish a booking: GameTime requires the person to complete it (it has a robot check). Give them the link so they can tap Book. If the data is old or missing, ask them to tap their Tennis Hub button on stc.gametime.net to refresh it.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "A day, YYYY-MM-DD. Leave out for today." },
        to: { type: "string", description: "With date: the last day of a range, YYYY-MM-DD." },
        after: { type: "string", description: "Only slots starting at or after this time, HH:MM (24-hour, club time)." },
        before: { type: "string", description: "Only slots starting before this time, HH:MM." },
        area: { type: "string", enum: ["indoor", "outdoor", "clay", "any"], description: "Indoor (courts 14-19), outdoor (1-8) or pro & clay (9-13)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "court_booking_link",
    title: "Get a court booking link",
    description: "A link that opens GameTime's booking form for one court at one time, for the person to finish (you can't book for them: GameTime has a robot check). Give a court for that exact court; leave it out to get the open court nearest the time. Says whether the slot looked open when the button last checked.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD." },
        time: { type: "string", description: "Start, HH:MM (24-hour, club time)." },
        court: { type: "string", description: "e.g. 'Court 15'. Optional." },
      },
      required: ["date", "time"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_regular_times",
    title: "List regular court times",
    description: "The person's regular weekly court times, each with its next date, whether that date is already booked, and when GameTime opens booking for it (with a booking link once it's open). Also the club's booking rule (each court time opens a set number of days before it ends).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_regular_time",
    title: "Add a regular court time",
    description: "Save a weekly court time the person wants to claim, e.g. Tuesdays 18:00 for 75 minutes indoors with Marc. Their court calendar then alerts them the minute GameTime opens each week's slot, and their GameTime button offers the best open court for it in one tap.",
    inputSchema: {
      type: "object",
      properties: {
        day: { type: "string", enum: DAY_NAMES, description: "Day of the week." },
        time: { type: "string", description: "Start, HH:MM (24-hour, club time)." },
        minutes: { type: "number", minimum: 15, maximum: 360, description: "Length; STC courts are usually booked for 75 minutes." },
        area: { type: "string", enum: ["indoor", "outdoor", "clay", "any"] },
        court: { type: "string", maxLength: 40, description: "Favourite court, e.g. 'Court 15'." },
        backups: { type: "string", maxLength: 120, description: "Other courts to try if the favourite is taken, in order, e.g. 'Court 15, Court 14'." },
        kind: { type: "string", enum: PLAY_KINDS },
        note: { type: "string", maxLength: 120, description: "Partner or anything else." },
      },
      required: ["day", "time"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "update_regular_time",
    title: "Change or pause a regular court time",
    description: "Change a regular weekly court time (day, start, length, area, favourite court, backups, type, partner), or pause it (no alerts or picks until resumed) and resume it. Takes the id from list_regular_times; fields left out stay as they are. Pass an empty string to clear court, backups or note.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        day: { type: "string", enum: DAY_NAMES },
        time: { type: "string", description: "Start, HH:MM (24-hour, club time)." },
        minutes: { type: "number", minimum: 15, maximum: 360 },
        area: { type: "string", enum: ["indoor", "outdoor", "clay", "any"] },
        court: { type: "string", maxLength: 40 },
        backups: { type: "string", maxLength: 120 },
        kind: { type: "string", enum: PLAY_KINDS },
        note: { type: "string", maxLength: 120 },
        paused: { type: "boolean", description: "true pauses it, false resumes it." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "remove_regular_time",
    title: "Remove a regular court time",
    description: "Stop a regular weekly court time (its calendar alerts go too). Takes the id from list_regular_times.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];

const handlers = {
  async log_play(store, user, args) {
    const { rackets } = await getState(store, user.id);
    const [id, r] = pickRacket(rackets, args.racket);
    const min = minutesFrom(args);
    if (!(min >= 5 && min <= 600)) fail("A session must be between 5 minutes and 10 hours.");
    if (!PLAY_KINDS.includes(args.kind)) fail(`Type of play must be one of ${PLAY_KINDS.join(", ")}.`);
    const today = todayIn(user.timezone);
    const d = args.date || today;
    if (!DATE.test(d)) fail("date must look like 2026-10-27.");
    if (d > today) fail(`${d} is in the future (today is ${today}).`);
    const sessionId = randomUUID();
    await applyOps(store, user.id, [{ op: "play.add", id: sessionId, racketId: id, d, min, kind: args.kind }]);
    const state = await getState(store, user.id), after = state.rackets[id];
    const s = summary(id, after, { profile: state.profile, today, personal: personalBreak(state.rackets, state.profile) });
    const rs = s.restring;
    const counts = !r.strungOn || d >= r.strungOn;
    const shoe = currentShoe(state.shoes), sw = shoe ? shoeWear(shoe, state.rackets) : null;
    return {
      text: `Logged ${hrs(min)} h of ${KIND_NAMES[args.kind]} on ${r.name} for ${fmtDate(d)}. `
        + (counts ? `That's ${s.hours_on_current_strings} h on these strings` + (r.strungOn ? ` since ${fmtDate(r.strungOn)}.` : ".")
                  : `That day is before these strings went in (${fmtDate(r.strungOn)}), so it doesn't count toward the current strings.`)
        + (rs && (rs.status === "soon" || rs.status === "now") ? ` ${rs.summary}` : "")
        + (sw ? ` Shoes (${shoe.name}): ${sw.hours} of about ${sw.life} h` + (sw.status === "now" ? ", time to replace them." : sw.status === "soon" ? ", wearing out." : ".") : ""),
      data: { session_id: sessionId, racket: s, ...(sw ? { shoes: { name: shoe.name, hours: sw.hours, expected_hours: sw.life, status: sw.status } } : {}) },
    };
  },
  async list_rackets(store, user) {
    const { rackets, profile } = await getState(store, user.id);
    const ctx = { profile, today: todayIn(user.timezone), personal: personalBreak(rackets, profile) };
    const list = Object.entries(rackets).map(([id, r]) => summary(id, r, ctx));
    const text = list.length
      ? list.map((s) => `${s.name}: ${s.hours_on_current_strings} h on strings` + (s.strung_on ? ` strung ${fmtDate(s.strung_on)}` : "") + (s.strung_at_lb ? ` at ${s.strung_at_lb} lb` : "") + (s.last_tension_reading ? `; last reading ${s.last_tension_reading.lb} lb on ${s.last_tension_reading.date}` : "") + `. ${s.restring.label}.`).join("\n")
      : "No rackets yet.";
    return { text, data: { rackets: list, profile: { level: profile.level, style: profile.style ? STYLE_NAMES[profile.style] : null }, today: todayIn(user.timezone) } };
  },
  async restring_advice(store, user, args) {
    const { rackets, profile } = await getState(store, user.id);
    const ids = args.racket ? [pickRacket(rackets, args.racket)[0]] : Object.keys(rackets);
    if (!ids.length) fail("This player has no rackets yet. Add one in the Tennis Hub app first.");
    const today = todayIn(user.timezone);
    const list = ids.map((id) => ({ id, name: rackets[id].name, string: rackets[id].stringName || null, strung_on: rackets[id].strungOn || null, ...restringAdvice(rackets[id], profile, today, personalBreak(rackets, profile)) }));
    const missing = [!profile.level && "level", !profile.style && "style of play"].filter(Boolean);
    return {
      text: list.map((a) => `${a.name}: ${a.summary}`).join("\n") + (missing.length ? `\n(Estimate assumes a 4.0 player with moderate topspin; set ${missing.join(" and ")} for a better one.)` : ""),
      data: { rackets: list, profile: { level: profile.level, style: profile.style }, today },
    };
  },
  async list_sessions(store, user, args) {
    const { rackets } = await getState(store, user.id);
    const ids = args.racket ? [pickRacket(rackets, args.racket)[0]] : Object.keys(rackets);
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
    const all = ids.flatMap((id) => (rackets[id].plays || []).map((p) => ({ session_id: p.id, racket: rackets[id].name, date: p.d, kind: p.kind, hours: hrs(p.min), on_current_strings: !rackets[id].strungOn || p.d >= rackets[id].strungOn })))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
    return { text: all.length ? all.map((p) => `${p.date} ${p.racket}: ${p.hours} h ${KIND_NAMES[p.kind]} (id ${p.session_id})`).join("\n") : "No sessions logged yet.", data: { sessions: all } };
  },
  async delete_session(store, user, args) {
    const { rackets } = await getState(store, user.id);
    const hit = Object.values(rackets).flatMap((r) => (r.plays || []).map((p) => ({ r, p }))).find(({ p }) => p.id === args.session_id);
    if (!hit) fail("No session with that id. Use list_sessions to find it.");
    await applyOps(store, user.id, [{ op: "play.delete", id: hit.p.id }]);
    return { text: `Deleted ${hrs(hit.p.min)} h of ${KIND_NAMES[hit.p.kind]} on ${hit.r.name} from ${fmtDate(hit.p.d)}.`, data: { deleted: hit.p.id } };
  },
  async record_restring(store, user, args) {
    const { rackets } = await getState(store, user.id);
    const [id, r] = pickRacket(rackets, args.racket);
    const today = todayIn(user.timezone), d = args.date || today;
    if (!DATE.test(d)) fail("date must look like 2026-10-27.");
    if (d > today) fail(`${d} is in the future (today is ${today}).`);
    let strungKg = r.strungKg ?? null;
    if (args.tension_lb !== undefined) strungKg = Math.round(Number(args.tension_lb) / LB * 100) / 100;
    else if (args.tension_kg !== undefined) strungKg = Number(args.tension_kg);
    const data = {
      name: r.name, head: r.head, gauge: r.gauge, material: r.material, pattern: r.pattern, weight: r.weight ?? null,
      stringName: args.string_name !== undefined ? String(args.string_name).slice(0, 60) || null : r.stringName ?? null,
      strungKg, strungOn: d, calib: r.calib || 1, calibAt: r.calibAt ?? null,
    };
    const reason = args.old_strings === undefined ? "routine" : args.old_strings;
    if (!REASONS.includes(reason)) fail(`old_strings must be one of ${REASONS.join(", ")}.`);
    // The strings coming out go to the history, unless this just re-records the same restring.
    const job = r.strungOn && r.strungOn !== d ? currentJob(r, randomUUID(), d, reason) : null;
    await applyOps(store, user.id, [...(job ? [{ op: "job.add", racketId: id, ...job }] : []), { op: "racket.put", id, data }]);
    const lasted = job ? hrs(minutesBetween(r.plays, job.from, job.to)) : null;
    return {
      text: (job ? `Saved the old strings to the history: ${lasted} h from ${fmtDate(job.from)}, ${REASON_NAMES[reason]}. ` : "") + `${r.name} restrung on ${fmtDate(d)}` + (strungKg ? ` at ${Math.round(strungKg * LB * 10) / 10} lb` : "") + (data.stringName ? ` with ${data.stringName}` : "") + ". Hours on strings start again from zero. Tap the strings in the app right after a restring to calibrate.",
      data: { racket: summary(id, { ...r, ...data }), ...(job ? { saved_to_history: { ...job, hours: lasted } } : {}) },
    };
  },
  async strings_broke(store, user, args) {
    const { rackets } = await getState(store, user.id);
    const [id, r] = pickRacket(rackets, args.racket);
    const today = todayIn(user.timezone), d = args.date || today;
    if (!DATE.test(d)) fail("date must look like 2026-10-27.");
    if (d > today) fail(`${d} is in the future (today is ${today}).`);
    if (!r.strungOn) fail(`${r.name} has no current strings on record (no Strung on date). Use record_restring with old_strings broke if it has been restrung.`);
    if (d < r.strungOn) fail(`${fmtDate(d)} is before these strings went in (${fmtDate(r.strungOn)}).`);
    const job = currentJob(r, randomUUID(), d, "broke");
    const data = { name: r.name, head: r.head, gauge: r.gauge, material: r.material, pattern: r.pattern, weight: r.weight ?? null,
      stringName: r.stringName ?? null, strungKg: r.strungKg ?? null, strungOn: null, calib: r.calib || 1, calibAt: r.calibAt ?? null };
    await applyOps(store, user.id, [{ op: "job.add", racketId: id, ...job }, { op: "racket.put", id, data }]);
    const lasted = hrs(minutesBetween(r.plays, job.from, job.to));
    return { text: `Saved: ${r.name}'s ${r.stringName || "strings"} broke on ${fmtDate(d)} after ${lasted} h of play since ${fmtDate(job.from)}. Record the restring when it's done.`, data: { broke: { ...job, hours: lasted } } };
  },
  async list_shoes(store, user) {
    const { rackets, shoes } = await getState(store, user.id);
    const list = shoes.slice().sort((a, b) => b.startedOn.localeCompare(a.startedOn)).map((x) => {
      const w = shoeWear(x, rackets);
      return { name: x.name, in_use_from: x.startedOn, retired_on: x.retiredOn, hours: w.hours, expected_hours: w.life, status: w.status };
    });
    return {
      text: list.length ? list.map((x) => `${x.name}: ${x.hours} h` + (x.retired_on ? ` (${x.in_use_from} to ${x.retired_on}, retired)` : ` of about ${x.expected_hours} h since ${x.in_use_from}, ${x.status === "good" ? "fine" : x.status === "soon" ? "wearing out" : "time to replace"}`) + ".").join("\n")
        : "No shoes yet. Add the pair in use in the Tennis Hub app, on the Gear tab.",
      data: { shoes: list },
    };
  },
  async string_history(store, user, args) {
    const { rackets } = await getState(store, user.id);
    const ids = args.racket ? [pickRacket(rackets, args.racket)[0]] : Object.keys(rackets);
    const jobs = ids.flatMap((id) => {
      const r = rackets[id];
      const past = (r.jobs || []).map((j) => ({ racket: r.name, strung_on: j.from, came_out: j.to, string: j.stringName, gauge_mm: j.gauge, material: j.material,
        tension_lb: j.strungKg ? Math.round(j.strungKg * LB * 10) / 10 : null, hours: hrs(minutesBetween(r.plays, j.from, j.to)), reason: j.reason }));
      const now = r.strungOn ? [{ racket: r.name, strung_on: r.strungOn, came_out: null, string: r.stringName || null, gauge_mm: r.gauge, material: r.material,
        tension_lb: r.strungKg ? Math.round(r.strungKg * LB * 10) / 10 : null, hours: hrs(minutesBetween(r.plays, r.strungOn, null)), reason: "still in" }] : [];
      return [...past, ...now];
    }).sort((a, b) => b.strung_on.localeCompare(a.strung_on));
    const by_string = stringStats(Object.fromEntries(ids.map((id) => [id, rackets[id]])));
    const text = jobs.length
      ? jobs.map((j) => `${j.racket}: ${j.string || j.material} ${j.strung_on} to ${j.came_out || "now"}, ${j.hours} h` + (j.tension_lb ? ` at ${j.tension_lb} lb` : "") + `, ${j.reason === "still in" ? "still in" : REASON_NAMES[j.reason]}.`).join("\n")
        + (by_string.length ? "\nBy string: " + by_string.map((s) => `${s.string} lasted ${s.avgHours} h on average over ${s.jobs} set${s.jobs === 1 ? "" : "s"}` + (s.broke ? `, broke ${s.broke}x` : "")).join("; ") + "." : "")
      : "No string history yet. It fills in each time a restring is recorded.";
    return { text, data: { jobs, by_string } };
  },
  async add_court_booking(store, user, args) {
    const tz = args.time_zone || DEFAULT_TZ;
    try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); } catch { fail(`${tz} isn't a time zone. Use one like America/Los_Angeles.`); }
    if (!DATE.test(String(args.date || ""))) fail("date must look like 2026-11-01.");
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(args.start_time || "").trim());
    if (!m || +m[1] > 23 || +m[2] > 59) fail("start_time must be 24-hour HH:MM, like 18:30.");
    const min = Math.round(Number(args.minutes));
    if (!(min >= 15 && min <= 360)) fail("A booking must be between 15 minutes and 6 hours.");
    const kind = args.kind || "singles";
    if (!PLAY_KINDS.includes(kind)) fail(`Type of play must be one of ${PLAY_KINDS.join(", ")}.`);
    const state = await getState(store, user.id);
    const racketId = args.racket ? pickRacket(state.rackets, args.racket)[0] : null;
    const ref = args.ref ? String(args.ref).trim().slice(0, 40) : null;
    // The same confirmation sent twice updates the booking rather than adding another.
    const same = ref ? (await store.query(`select id from court_bookings where user_id = $1 and ref = $2 limit 1`, [user.id, ref]))[0] : null;
    const id = same ? same.id : randomUUID();
    const start = zonedToUtc(args.date, `${m[1].padStart(2, "0")}:${m[2]}`, tz);
    const booking = { id, start, min, tz, kind, court: args.court || null, location: args.location || null, note: args.note || null, ref, racketId };
    await applyOps(store, user.id, [{ op: "booking.put", ...booking }]);
    await logFinishedBookings(store, user.id);
    const when = new Date(start).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const racketName = racketId ? state.rackets[racketId].name : null;
    return {
      text: `${same ? "Updated" : "Saved"} ${bookingTitle(booking)}, ${when} for ${hrs(min)} h at ${booking.location || DEFAULT_LOCATION}. `
        + (start + min * 60000 <= Date.now() ? "It has already ended, so its time is logged as play now." : `It's in the court calendar, and the time is logged as play${racketName ? " on " + racketName : ""} once it ends.`),
      data: { booking_id: id, updated: !!same, starts_at: new Date(start).toISOString(), local_day: localDate(start, tz), minutes: min, kind, court: booking.court, ref, racket: racketName },
    };
  },
  async list_court_bookings(store, user) {
    const { bookings, rackets } = await getState(store, user.id);
    const now = Date.now();
    const list = bookings.map((b) => ({
      booking_id: b.id, title: bookingTitle(b), starts_at: new Date(b.start).toISOString(),
      local: new Date(b.start).toLocaleString("en-US", { timeZone: b.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      minutes: b.min, kind: b.kind, court: b.court, ref: b.ref, note: b.note,
      racket: b.racketId && rackets[b.racketId] ? rackets[b.racketId].name : null,
      status: b.playId ? "logged as play" : b.start + b.min * 60000 <= now ? "ended" : "upcoming",
    }));
    return { text: list.length ? list.map((b) => `${b.local}: ${b.title}, ${hrs(b.minutes)} h (${b.status}, id ${b.booking_id})`).join("\n") : "No court bookings saved.", data: { bookings: list } };
  },
  async cancel_court_booking(store, user, args) {
    const rows = args.booking_id
      ? await store.query(`select id, ref from court_bookings where user_id = $1 and id = $2 and not cancelled`, [user.id, String(args.booking_id)])
      : args.ref ? await store.query(`select id, ref from court_bookings where user_id = $1 and ref = $2 and not cancelled`, [user.id, String(args.ref)]) : [];
    if (!args.booking_id && !args.ref) fail("Give booking_id or ref.");
    if (!rows.length) fail("No booking matches. Use list_court_bookings to find it.");
    await applyOps(store, user.id, rows.map((r) => ({ op: "booking.cancel", id: r.id })));
    return { text: `Removed ${rows.length === 1 ? "the booking" : rows.length + " bookings"} from the app and calendar. Remember to cancel with the club in GameTime too if you haven't.`, data: { cancelled: rows.map((r) => r.id) } };
  },
  async find_open_courts(store, user, args) {
    for (const k of ["date", "to"]) if (args[k] !== undefined && !DATE.test(String(args[k]))) fail(`${k} must look like 2026-11-03.`);
    const days = await findOpenCourts(store, user.id, { date: args.to ? undefined : args.date, from: args.date, to: args.to, after: args.after, before: args.before, area: args.area });
    if (!days.length) return { text: "No open-court data for those days yet. Ask the person to tap their Tennis Hub button on stc.gametime.net (signed in); it saves the coming week's open courts.", data: { days: [] } };
    const lines = days.map((d) => `${d.date} (seen ${new Date(d.seen_at).toLocaleString("en-US", { timeZone: DEFAULT_TZ, weekday: "short", hour: "numeric", minute: "2-digit" })}): ` +
      (d.open.length ? d.open.slice(0, 30).map((x) => `${x.court} ${x.start}`).join(", ") + (d.open.length > 30 ? ` and ${d.open.length - 30} more` : "") : "nothing open"));
    return { text: lines.join("\n") + "\nThe person books by opening a slot's link and tapping Book in GameTime.", data: { days } };
  },
  async court_booking_link(store, user, args) {
    const out = await bookingLink(store, user.id, args);
    if (!out) fail("Give date as YYYY-MM-DD, time as HH:MM, and a court number GameTime knows (1-8 or 14-19), or leave the court out.");
    if (!out.link) return { text: `Nothing looked open within an hour of ${args.time} on ${args.date}${out.seen_at ? "" : " (no open-court data for that day yet; ask the person to tap their Tennis Hub button on stc.gametime.net)"}.`, data: out };
    return { text: `${out.court}${out.start ? " at " + out.start : ""}: ${out.link}` + (out.open === false ? " (it looked taken when last checked)" : out.open == null ? " (not checked yet)" : "") + ". The person finishes the booking in GameTime.", data: out };
  },
  async list_regular_times(store, user) {
    const [{ plans, window }, { bookings }] = await Promise.all([planInfo(store, user.id), getState(store, user.id)]);
    const now = Date.now();
    const next = planOpenings(plans, window, bookings, { now, weeks: 1 });
    const list = plans.map((p) => {
      const o = next.filter((x) => x.plan.id === p.id).sort((a, b) => a.start - b.start)[0];
      return { id: p.id, title: planTitle(p), day: DAY_NAMES[p.dow], time: p.time, minutes: p.min, area: p.area, court: p.court, backups: p.backups, note: p.note, paused: p.paused,
        next: o ? { date: o.date, booked: o.booked, opens_at: new Date(o.opensAt).toISOString(), open_now: o.open, link: o.open && !o.booked ? planLink(p, o.date) : null } : null };
    });
    const w = `GameTime opens each court time ${window.days} days before it ends (a 6 to 7:15 pm court opens at 7:15 pm ${window.days === 7 ? "a week" : window.days + " days"} earlier).`;
    return { text: (list.length ? list.map((p) => `${p.title}, ${p.minutes} min${p.backups ? ", backups " + p.backups : ""}${p.note ? " with " + p.note : ""}: ${p.paused ? "paused" : "next " + (p.next ? p.next.date + (p.next.booked ? " (booked)" : p.next.open_now ? " (open now: " + p.next.link + ")" : " (opens " + new Date(p.next.opens_at).toLocaleString("en-US", { timeZone: DEFAULT_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + ")") : "none")} [id ${p.id}]`).join("\n") : "No regular times saved.") + "\n" + w, data: { regular_times: list, window } };
  },
  async add_regular_time(store, user, args) {
    const dow = DAY_NAMES.indexOf(args.day);
    if (dow < 0) fail("day must be a day of the week, e.g. Tuesday.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(args.time || ""))) fail("time must look like 18:00.");
    const p = { id: randomUUID(), dow, time: args.time, min: Math.round(Number(args.minutes || 75)), area: args.area || "any", court: args.court || null, backups: args.backups || null, kind: args.kind || "singles", note: args.note || null };
    const refused = await applyOps(store, user.id, [{ op: "plan.put", ...p }]);
    if (refused.length) fail(refused[0].error);
    return { text: `Saved ${planTitle(p)} every week. The court calendar will alert the minute GameTime opens each one.`, data: { id: p.id } };
  },
  async update_regular_time(store, user, args) {
    const p = (await plansFor(store, user.id)).find((x) => x.id === String(args.id || ""));
    if (!p) fail("No regular time has that id. Use list_regular_times.");
    if (args.day !== undefined) { p.dow = DAY_NAMES.indexOf(args.day); if (p.dow < 0) fail("day must be a day of the week, e.g. Tuesday."); }
    if (args.time !== undefined) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(args.time))) fail("time must look like 18:00."); p.time = args.time; }
    if (args.minutes !== undefined) p.min = Math.round(Number(args.minutes));
    for (const k of ["area", "kind"]) if (args[k] !== undefined) p[k] = args[k];
    for (const k of ["court", "backups", "note"]) if (args[k] !== undefined) p[k] = args[k] || null;
    if (args.paused !== undefined) p.paused = args.paused === true;
    const refused = await applyOps(store, user.id, [{ op: "plan.put", ...p }]);
    if (refused.length) fail(refused[0].error);
    const [saved] = (await plansFor(store, user.id)).filter((x) => x.id === p.id);
    return { text: `${planTitle(saved)}, ${saved.min} min${saved.backups ? ", backups " + saved.backups : ""}${saved.paused ? " (paused)" : ""}.`, data: saved };
  },
  async remove_regular_time(store, user, args) {
    const rows = await store.query(`select id from court_plans where id = $1 and user_id = $2`, [String(args.id || ""), user.id]);
    if (!rows.length) fail("No regular time has that id. Use list_regular_times.");
    await applyOps(store, user.id, [{ op: "plan.delete", id: rows[0].id }]);
    return { text: "Removed that regular time.", data: { removed: rows[0].id } };
  },
  async set_player_profile(store, user, args) {
    const { profile } = await getState(store, user.id);
    const next = { level: args.level !== undefined ? args.level : profile.level, style: args.style !== undefined ? args.style : profile.style };
    await applyOps(store, user.id, [{ op: "profile.put", data: next }]);
    return { text: `Level ${next.level || "not set"}, style ${next.style ? STYLE_NAMES[next.style] : "not set"}.`, data: next };
  },
};

// A read-only token sees only the tools marked readOnlyHint.
const READ_ONLY = new Set(TOOLS.filter((t) => t.annotations && t.annotations.readOnlyHint).map((t) => t.name));
export const toolsFor = (access) => (access === "read" ? TOOLS.filter((t) => READ_ONLY.has(t.name)) : TOOLS);

// Run one tool. Returns MCP tool-call content: a short sentence plus the data as JSON.
export async function callTool(store, user, name, args = {}) {
  const fn = handlers[name];
  if (!fn) return { content: [{ type: "text", text: `Unknown tool ${name}.` }], isError: true };
  if (user.access === "read" && !READ_ONLY.has(name)) return { content: [{ type: "text", text: `This connector is read only, so it can't run ${name}. Make a read and write token in the Tennis Hub app to change things.` }], isError: true };
  try {
    await logFinishedBookings(store, user.id);
    const out = await fn(store, user, args && typeof args === "object" ? args : {});
    return { content: [{ type: "text", text: out.text + "\n\n" + JSON.stringify(out.data) }], structuredContent: out.data };
  } catch (e) {
    if (e instanceof ToolError || e.status === 400) return { content: [{ type: "text", text: e.message }], isError: true };
    throw e;
  }
}
