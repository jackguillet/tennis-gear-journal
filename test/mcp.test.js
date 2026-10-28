import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/server.js";

// The chat-assistant connector: links made in the app, and the MCP endpoint that uses them.
let app;
before(async () => { delete process.env.NEON_AUTH_BASE_URL; app = await startServer({ port: 3918 }); });
after(() => app.close());

function browser() {
  const jar = new Map();
  return {
    async call(method, path, body) {
      const res = await fetch(app.origin + path, {
        method,
        headers: { "content-type": "application/json", origin: app.origin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";"); const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
        if (/max-age=0/i.test(c) || value === "") jar.delete(name); else jar.set(name, value);
      }
      const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {}
      return { status: res.status, data };
    },
  };
}
let rpcId = 0;
async function mcp(url, method, params, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const tool = async (url, name, args) => (await mcp(url, "tools/call", { name, arguments: args })).body.result;

const racket = (name, strungOn) => ({ name, head: 98, gauge: 1.25, material: "poly", pattern: "16x19", weight: 305, stringName: "Luxilon ALU Power", strungKg: 22.68, strungOn, calib: 1, calibAt: null });
const jack = browser(), sam = browser();
let link, samLink, tokenId;

test("setup: two players with rackets", async () => {
  assert.equal((await jack.call("POST", "/api/auth/sign-up/email", { name: "Jack", email: "jack@example.com", password: "forehand-winner" })).status, 200);
  assert.equal((await sam.call("POST", "/api/auth/sign-up/email", { name: "Sam", email: "sam@example.com", password: "drop-shot-123" })).status, 200);
  let res = await jack.call("POST", "/api/sync", { ops: [
    { op: "racket.put", id: "v8", data: racket("Wilson Blade 98 v8", "2026-10-11") },
    { op: "racket.put", id: "v9", data: racket("Wilson Blade 98 v9", "2026-06-20") },
    { op: "reading.add", id: "rd1", racketId: "v8", t: Date.parse("2026-10-12T18:00:00Z"), hz: 520, s: { head: 98, gauge: 1.25, material: "poly", pattern: "16x19", calib: 1 } },
  ] });
  assert.equal(res.status, 200);
  res = await sam.call("POST", "/api/sync", { ops: [{ op: "racket.put", id: "pure", data: racket("Babolat Pure Aero", "2026-10-01") }] });
  assert.equal(res.status, 200);
});

test("making a link needs a signed-in player", async () => {
  assert.equal((await browser().call("POST", "/api/tokens", {})).status, 401);
});

test("a player makes a connector link and sees it listed without the secret", async () => {
  const res = await jack.call("POST", "/api/tokens", { label: "Claude", timezone: "America/Los_Angeles" });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.match(res.data.token.secret, /^sbm_[A-Za-z0-9_-]{40,}$/);
  tokenId = res.data.token.id;
  link = `${app.origin}/api/mcp/${res.data.token.secret}`;
  assert.equal(res.data.tokens.length, 1);
  assert.equal(res.data.tokens[0].timezone, "America/Los_Angeles");
  assert.equal(JSON.stringify(res.data.tokens).includes(res.data.token.secret), false);
  samLink = `${app.origin}/api/mcp/${(await sam.call("POST", "/api/tokens", {})).data.token.secret}`;
});

test("MCP handshake and tool list", async () => {
  const init = await mcp(link, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.ok(init.body.result.capabilities.tools);
  const note = await fetch(link, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(note.status, 202);
  const list = await mcp(link, "tools/list");
  assert.deepEqual(list.body.result.tools.map((t) => t.name).sort(), ["add_court_booking", "cancel_court_booking", "delete_session", "list_court_bookings", "list_rackets", "list_sessions", "log_play", "record_restring", "restring_advice", "set_player_profile", "string_history", "strings_broke"]);
  assert.equal((await fetch(link)).status, 405);
});

test("'I played an hour of singles' logs to the racket and shows up in the app", async () => {
  const out = await tool(link, "log_play", { kind: "singles", hours: 1, racket: "v8" });
  assert.equal(out.isError, undefined, JSON.stringify(out));
  assert.match(out.content[0].text, /Logged 1 h of singles on Wilson Blade 98 v8/);
  assert.equal(out.structuredContent.racket.hours_on_current_strings, 1);
  const sync = await jack.call("POST", "/api/sync", { ops: [] });
  const plays = sync.data.rackets.v8.plays;
  assert.equal(plays.length, 1);
  assert.equal(plays[0].min, 60);
  assert.equal(plays[0].d, new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }), "today in the link's time zone");
});

test("with no racket named, the most recently used one is picked", async () => {
  const out = await tool(link, "log_play", { kind: "doubles", minutes: 90, date: "2026-10-20" });
  assert.match(out.content[0].text, /on Wilson Blade 98 v8/);
  assert.equal(out.structuredContent.racket.hours_on_current_strings, 2.5);
});

test("vague or wrong racket names and bad input come back as tool errors", async () => {
  let out = await tool(link, "log_play", { kind: "singles", hours: 1, racket: "blade" });
  assert.equal(out.isError, true); assert.match(out.content[0].text, /more than one racket/);
  out = await tool(link, "log_play", { kind: "singles", hours: 1, racket: "prince" });
  assert.equal(out.isError, true); assert.match(out.content[0].text, /No racket matches/);
  out = await tool(link, "log_play", { kind: "pickleball", hours: 1, racket: "v8" });
  assert.equal(out.isError, true);
  out = await tool(link, "log_play", { kind: "singles", racket: "v8" });
  assert.equal(out.isError, true); assert.match(out.content[0].text, /how long/);
  out = await tool(link, "log_play", { kind: "singles", hours: 1, racket: "v8", date: "2999-01-01" });
  assert.equal(out.isError, true); assert.match(out.content[0].text, /future/);
});

test("list, delete, restring and profile", async () => {
  let out = await tool(link, "list_rackets", {});
  const v8 = out.structuredContent.rackets.find((r) => r.id === "v8");
  assert.equal(v8.hours_on_current_strings, 2.5);
  assert.deepEqual(v8.hours_by_type, { singles: 1, doubles: 1.5 });
  assert.ok(v8.last_tension_reading.lb > 40 && v8.last_tension_reading.lb < 60, JSON.stringify(v8.last_tension_reading));
  out = await tool(link, "list_sessions", { racket: "v8" });
  const doubles = out.structuredContent.sessions.find((s) => s.kind === "doubles");
  out = await tool(link, "delete_session", { session_id: doubles.session_id });
  assert.match(out.content[0].text, /Deleted 1.5 h of doubles/);
  out = await tool(link, "record_restring", { racket: "v9", date: "2026-10-26", tension_lb: 52, string_name: "RPM Blast 1.25" });
  assert.match(out.content[0].text, /restrung on Oct 26, 2026 at 52 lb with RPM Blast 1.25/);
  out = await tool(link, "set_player_profile", { level: "4.0", style: "heavy_spin" });
  const sync = await jack.call("POST", "/api/sync", { ops: [] });
  assert.equal(sync.data.rackets.v9.strungOn, "2026-10-26");
  assert.equal(sync.data.rackets.v9.stringName, "RPM Blast 1.25");
  assert.equal(sync.data.rackets.v8.plays.length, 1);
  assert.deepEqual(sync.data.profile, { level: "4.0", style: "heavy_spin" });
});

test("a restring saves the old strings to the history, and string_history compares strings", async () => {
  // v9 has RPM Blast in since Oct 26 (above). Log a session on it, then it breaks and is restrung.
  await tool(link, "log_play", { racket: "v9", kind: "singles", hours: 2, date: "2026-10-27" });
  let out = await tool(link, "record_restring", { racket: "v9", date: "2026-10-28", tension_lb: 50, string_name: "ALU Power 1.25", old_strings: "broke" });
  assert.match(out.content[0].text, /Saved the old strings to the history: 2 h from Oct 26, 2026, broke/);
  // Recording the same restring again doesn't add a second record.
  await tool(link, "record_restring", { racket: "v9", date: "2026-10-28", tension_lb: 50, string_name: "ALU Power 1.25" });
  out = await tool(link, "string_history", { racket: "v9" });
  const { jobs, by_string } = out.structuredContent;
  assert.equal(jobs.length, 3); // the June strings went to the history at the Oct 26 restring above
  assert.deepEqual([jobs[0].reason, jobs[0].string], ["still in", "ALU Power 1.25"]);
  assert.deepEqual([jobs[1].reason, jobs[1].string, jobs[1].hours, jobs[1].came_out], ["broke", "RPM Blast 1.25", 2, "2026-10-28"]);
  assert.equal(jobs[2].came_out, "2026-10-26");
  const rpm = by_string.find((s) => s.string.startsWith("RPM Blast"));
  assert.deepEqual([rpm.jobs, rpm.avgHours, rpm.broke], [1, 2, 1]);
  assert.equal((await tool(link, "record_restring", { racket: "v9", old_strings: "snapped" })).isError, true);
  out = await tool(link, "strings_broke", { racket: "v9", date: "2026-10-28" });
  assert.match(out.content[0].text, /broke on Oct 28, 2026 after 0 h/);
  assert.equal((await tool(link, "strings_broke", { racket: "v9" })).isError, true, "no strings left to break");
  const sync = await jack.call("POST", "/api/sync", { ops: [] });
  assert.equal(sync.data.rackets.v9.jobs.length, 3);
  assert.equal(sync.data.rackets.v9.strungOn, null);
});

test("restring advice for every racket, and worn strings say restring now", async () => {
  let out = await tool(link, "restring_advice", {});
  assert.equal(out.isError, undefined, JSON.stringify(out));
  const byId = Object.fromEntries(out.structuredContent.rackets.map((r) => [r.id, r]));
  // Jack's rackets have hardly been played; how long ago they were strung depends on today's date.
  assert.ok(["good", "soon", "now"].includes(byId.v8.status), JSON.stringify(byId.v8));
  assert.equal(byId.v8.hours_on_strings, 1);
  assert.ok(byId.v8.factors.some((f) => f.factor === "age"));
  out = await tool(link, "list_rackets", {});
  assert.ok(out.structuredContent.rackets.every((r) => r.restring && r.restring.status));
  // Sam's racket strung Oct 1 with 30 h of drills is done
  for (let i = 0; i < 6; i++) await tool(samLink, "log_play", { kind: "drills", hours: 5, date: "2026-10-1" + i });
  out = await tool(samLink, "restring_advice", { racket: "aero" });
  assert.equal(out.structuredContent.rackets[0].status, "now");
  assert.match(out.content[0].text, /Restring now/);
  assert.match(out.content[0].text, /set level and style of play/);
});

test("a link only reaches its own player", async () => {
  let out = await tool(samLink, "list_rackets", {});
  assert.deepEqual(out.structuredContent.rackets.map((r) => r.name), ["Babolat Pure Aero"]);
  out = await tool(samLink, "log_play", { kind: "singles", hours: 1, racket: "v8" });
  assert.equal(out.isError, true);
  const jackSessions = (await tool(link, "list_sessions", {})).structuredContent.sessions;
  out = await tool(samLink, "delete_session", { session_id: jackSessions[0].session_id });
  assert.equal(out.isError, true);
  assert.equal((await tool(link, "list_sessions", {})).structuredContent.sessions.length, jackSessions.length);
});

test("bad, missing and turned-off links are refused; Bearer header works", async () => {
  assert.equal((await mcp(`${app.origin}/api/mcp/sbm_${"x".repeat(43)}`, "tools/list")).status, 401);
  assert.equal((await mcp(`${app.origin}/api/mcp`, "tools/list")).status, 401);
  const secret = link.split("/").pop();
  assert.equal((await mcp(`${app.origin}/api/mcp`, "tools/list", null, { authorization: `Bearer ${secret}` })).status, 200);
  const res = await jack.call("DELETE", "/api/tokens", { id: tokenId });
  assert.equal(res.data.tokens.length, 0);
  assert.equal((await mcp(link, "tools/list")).status, 401);
});
