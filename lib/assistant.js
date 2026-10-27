import { randomUUID } from "node:crypto";
import { applyOps, getState, PLAY_KINDS, LEVELS, STYLES } from "./store.js";

// The tools a chat assistant (Claude, ChatGPT, ...) can call for one player, through the MCP
// endpoint in api/mcp.js. Every write goes through the same validated ops as the app's sync,
// so the phone picks the change up on its next sync.

const KIND_NAMES = { singles: "singles", doubles: "doubles", hitting: "hitting", drills: "lesson / drills", ball_machine: "ball machine", serves: "serves" };
const STYLE_NAMES = { heavy_spin: "heavy topspin", moderate_spin: "moderate topspin", flat: "flat hitter", all_court: "all-court / slice", serve_volley: "serve and volley", counter: "counterpuncher" };
const LB = 2.20462;

// Same model as the app (public/index.html): string-bed pitch -> tension.
const DENSITY = { poly: 1380, multi: 1140, syngut: 1140, gut: 1300, hybrid: 1260, kevlar: 1440 };
const PATTERN = { "16x19": 1, "18x20": 1.06, "16x18": 0.98, "18x19": 1.03 };
function tensionKg(hz, r) {
  const area = r.head * 6.4516e-4, b = Math.sqrt(area / (Math.PI * 1.28)), a = 1.28 * b;
  const mu = DENSITY[r.material] * Math.PI * Math.pow(r.gauge / 2000, 2), pat = PATTERN[r.pattern] || 1;
  return (1.55 * 8 * mu * hz * hz / (1 / (4 * a * a) + 1 / (4 * b * b)) / (pat * pat)) / 9.80665 * (r.calib || 1);
}

class ToolError extends Error {}
const fail = (msg) => { throw new ToolError(msg); };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayIn = (tz) => {
  try { return new Date().toLocaleDateString("en-CA", { timeZone: tz || "UTC" }); } catch { return new Date().toISOString().slice(0, 10); }
};
const hrs = (min) => Math.round(min / 6) / 10;
const onStrings = (r) => (r.plays || []).filter((p) => !r.strungOn || p.d >= r.strungOn);
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function summary(id, r) {
  const mine = onStrings(r), minutes = mine.reduce((a, p) => a + p.min, 0);
  const last = r.readings.length ? r.readings[r.readings.length - 1] : null;
  const lastKg = last ? tensionKg(last.hz, last.s ? { ...r, ...last.s } : r) : null;
  return {
    id, name: r.name, string: r.stringName || null,
    strung_on: r.strungOn || null,
    strung_at_lb: r.strungKg ? Math.round(r.strungKg * LB * 10) / 10 : null,
    hours_on_current_strings: hrs(minutes),
    sessions_on_current_strings: mine.length,
    hours_by_type: Object.fromEntries(Object.entries(mine.reduce((m, p) => { m[p.kind] = (m[p.kind] || 0) + p.min; return m; }, {})).map(([k, v]) => [k, hrs(v)])),
    last_tension_reading: last ? { date: new Date(last.t).toISOString().slice(0, 10), lb: Math.round(lastKg * LB * 10) / 10, kg: Math.round(lastKg * 10) / 10, estimate: (r.calib || 1) === 1 } : null,
  };
}

// Find a racket from what the person said ("v8", "my blade", an id). With nothing said, use the
// one they played with most recently, or the only one.
function pickRacket(rackets, query) {
  const list = Object.entries(rackets);
  if (!list.length) fail("This player has no rackets yet. Add one in the Stringbed Meter app first.");
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
    description: "Log time played with a racket (for example 'I played an hour of singles'). Adds the session to the racket's play tracker in the Stringbed Meter app, where it counts toward hours on the current strings. If the person doesn't name a racket, leave racket out and the one they used most recently is chosen; the result says which.",
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
    description: "List the player's rackets with hours played on the current strings (split by type), when and at what tension they were strung, and the latest tension reading. Use it to answer questions like 'how many hours are on my strings?' or 'should I restring?'.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
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
    description: "Record that a racket was restrung. This sets its Strung on date, so the hours-on-strings count starts again from zero. Optionally sets the tension and string name.",
    inputSchema: {
      type: "object",
      properties: {
        racket: { type: "string", description: "Racket name or id." },
        date: { type: "string", description: "Day it was restrung, YYYY-MM-DD in the person's local time. Leave out for today." },
        tension_lb: { type: "number", minimum: 20, maximum: 80, description: "Tension the stringer used, in pounds. Give this or tension_kg." },
        tension_kg: { type: "number", minimum: 10, maximum: 36, description: "Tension the stringer used, in kilograms." },
        string_name: { type: "string", maxLength: 60, description: "String used, for example 'Luxilon ALU Power 1.25'." },
      },
      required: ["racket"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
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
    const after = (await getState(store, user.id)).rackets[id];
    const s = summary(id, after);
    const counts = !r.strungOn || d >= r.strungOn;
    return {
      text: `Logged ${hrs(min)} h of ${KIND_NAMES[args.kind]} on ${r.name} for ${fmtDate(d)}. `
        + (counts ? `That's ${s.hours_on_current_strings} h on these strings` + (r.strungOn ? ` since ${fmtDate(r.strungOn)}.` : ".")
                  : `That day is before these strings went in (${fmtDate(r.strungOn)}), so it doesn't count toward the current strings.`),
      data: { session_id: sessionId, racket: s },
    };
  },
  async list_rackets(store, user) {
    const { rackets, profile } = await getState(store, user.id);
    const list = Object.entries(rackets).map(([id, r]) => summary(id, r));
    const text = list.length
      ? list.map((s) => `${s.name}: ${s.hours_on_current_strings} h on strings` + (s.strung_on ? ` strung ${fmtDate(s.strung_on)}` : "") + (s.strung_at_lb ? ` at ${s.strung_at_lb} lb` : "") + (s.last_tension_reading ? `; last reading ${s.last_tension_reading.lb} lb on ${s.last_tension_reading.date}` : "")).join("\n")
      : "No rackets yet.";
    return { text, data: { rackets: list, profile: { level: profile.level, style: profile.style ? STYLE_NAMES[profile.style] : null }, today: todayIn(user.timezone) } };
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
    await applyOps(store, user.id, [{ op: "racket.put", id, data }]);
    return {
      text: `${r.name} restrung on ${fmtDate(d)}` + (strungKg ? ` at ${Math.round(strungKg * LB * 10) / 10} lb` : "") + (data.stringName ? ` with ${data.stringName}` : "") + ". Hours on strings start again from zero. Tap the strings in the app right after a restring to calibrate.",
      data: { racket: summary(id, { ...r, ...data }) },
    };
  },
  async set_player_profile(store, user, args) {
    const { profile } = await getState(store, user.id);
    const next = { level: args.level !== undefined ? args.level : profile.level, style: args.style !== undefined ? args.style : profile.style };
    await applyOps(store, user.id, [{ op: "profile.put", data: next }]);
    return { text: `Level ${next.level || "not set"}, style ${next.style ? STYLE_NAMES[next.style] : "not set"}.`, data: next };
  },
};

// Run one tool. Returns MCP tool-call content: a short sentence plus the data as JSON.
export async function callTool(store, user, name, args = {}) {
  const fn = handlers[name];
  if (!fn) return { content: [{ type: "text", text: `Unknown tool ${name}.` }], isError: true };
  try {
    const out = await fn(store, user, args && typeof args === "object" ? args : {});
    return { content: [{ type: "text", text: out.text + "\n\n" + JSON.stringify(out.data) }], structuredContent: out.data };
  } catch (e) {
    if (e instanceof ToolError || e.status === 400) return { content: [{ type: "text", text: e.message }], isError: true };
    throw e;
  }
}
