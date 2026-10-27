import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/server.js";

// Runs the app as it runs on Vercel: the real /api functions, the real Neon Auth proxy
// toolkit, a local Better Auth standing in for Neon Auth, and an in-memory Postgres.
let app;
before(async () => { delete process.env.NEON_AUTH_BASE_URL; app = await startServer({ port: 3917 }); });
after(() => app.close());

// A tiny browser: keeps cookies between requests.
function browser() {
  const jar = new Map();
  return {
    jar,
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
      const text = await res.text();
      let data = null; try { data = JSON.parse(text); } catch {}
      return { status: res.status, data };
    },
  };
}

const blade = { name: "Wilson Blade 98 v8", head: 98, gauge: 1.25, material: "poly", pattern: "16x19", weight: 305, stringName: "Luxilon ALU Power", strungKg: 22.68, strungOn: "2026-10-11", calib: 1, calibAt: null };
const setup = { head: 98, gauge: 1.25, material: "poly", pattern: "16x19", calib: 1 };
const jack = browser(), sam = browser(), stranger = browser();

test("sync refuses without an account", async () => {
  assert.equal((await stranger.call("POST", "/api/sync", { ops: [] })).status, 401);
});

test("a friend can create an account and is signed in", async () => {
  const res = await jack.call("POST", "/api/auth/sign-up/email", { name: "Jack", email: "jack@example.com", password: "forehand-winner" });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.user.email, "jack@example.com");
  assert.ok([...jack.jar.keys()].some((k) => k.startsWith("__Secure-neon-auth.session_token")), "session cookie set");
  const s = await jack.call("GET", "/api/auth/get-session");
  assert.equal(s.data.user.name, "Jack");
});

test("signing up twice with one email is refused", async () => {
  const res = await browser().call("POST", "/api/auth/sign-up/email", { name: "Jack again", email: "jack@example.com", password: "another-password" });
  assert.notEqual(res.status, 200);
});

test("a wrong password is refused", async () => {
  const res = await stranger.call("POST", "/api/auth/sign-in/email", { email: "jack@example.com", password: "nope-nope-nope" });
  assert.equal(res.status, 401);
  assert.equal((await stranger.call("POST", "/api/sync", { ops: [] })).status, 401);
});

test("a new account starts empty and saves rackets and readings", async () => {
  let res = await jack.call("POST", "/api/sync", { ops: [] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.rackets, {});
  assert.equal(res.data.user.email, "jack@example.com");
  res = await jack.call("POST", "/api/sync", { ops: [
    { op: "racket.put", id: "jk-blade", data: blade },
    { op: "reading.add", id: "rd-1", racketId: "jk-blade", t: 1793044980123, hz: 521.4, s: setup },
    { op: "reading.add", id: "rd-1", racketId: "jk-blade", t: 1793044980123, hz: 521.4, s: setup }, // sent twice
  ] });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const r = res.data.rackets["jk-blade"];
  assert.equal(r.strungOn, "2026-10-11");
  assert.equal(r.gauge, 1.25);
  assert.deepEqual(r.readings, [{ id: "rd-1", t: 1793044980123, hz: 521.4, s: setup }]);
});

test("a second friend sees only their own rackets and can't touch Jack's", async () => {
  assert.equal((await sam.call("POST", "/api/auth/sign-up/email", { name: "Sam", email: "sam@example.com", password: "drop-shot-123" })).status, 200);
  let res = await sam.call("POST", "/api/sync", { ops: [] });
  assert.deepEqual(res.data.rackets, {}, "Sam can't see Jack's racket");
  res = await sam.call("POST", "/api/sync", { ops: [
    { op: "racket.put", id: "jk-blade", data: { ...blade, name: "Hijacked" } }, // Jack's id
    { op: "reading.add", id: "rd-sam", racketId: "jk-blade", t: 1, hz: 500 },
    { op: "reading.delete", id: "rd-1" },
    { op: "racket.delete", id: "jk-blade" },
    { op: "racket.put", id: "sam-pure", data: { ...blade, name: "Babolat Pure Aero" } },
  ] });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.data.rackets), ["sam-pure"]);
  const j = (await jack.call("POST", "/api/sync", { ops: [] })).data.rackets;
  assert.deepEqual(Object.keys(j), ["jk-blade"]);
  assert.equal(j["jk-blade"].name, "Wilson Blade 98 v8");
  assert.deepEqual(j["jk-blade"].readings.map((x) => x.id), ["rd-1"]);
});

test("signing in again on another device gets the same rackets", async () => {
  const phone = browser();
  assert.equal((await phone.call("POST", "/api/auth/sign-in/email", { email: "jack@example.com", password: "forehand-winner" })).status, 200);
  const res = await phone.call("POST", "/api/sync", { ops: [] });
  assert.deepEqual(Object.keys(res.data.rackets), ["jk-blade"]);
});

test("one bad change rejects the whole batch", async () => {
  const res = await jack.call("POST", "/api/sync", { ops: [
    { op: "racket.put", id: "new-one", data: { ...blade, name: "New" } },
    { op: "racket.put", id: "bad id!", data: blade },
  ] });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /not a valid id/);
  assert.equal((await jack.call("POST", "/api/sync", { ops: [] })).data.rackets["new-one"], undefined);
});

test("out-of-range values are refused", async () => {
  for (const data of [{ ...blade, head: 400 }, { ...blade, material: "rope" }, { ...blade, strungOn: "Oct 11" }, { ...blade, name: "" }]) {
    assert.equal((await jack.call("POST", "/api/sync", { ops: [{ op: "racket.put", id: "x", data }] })).status, 400);
  }
});

test("play sessions save per racket, can't be sent twice, and stay private", async () => {
  let res = await jack.call("POST", "/api/sync", { ops: [
    { op: "play.add", id: "pl-1", racketId: "jk-blade", d: "2026-10-25", min: 90, kind: "singles" },
    { op: "play.add", id: "pl-1", racketId: "jk-blade", d: "2026-10-25", min: 90, kind: "singles" }, // sent twice
    { op: "play.add", id: "pl-2", racketId: "jk-blade", d: "2026-10-26", min: 45, kind: "ball_machine" },
  ] });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.rackets["jk-blade"].plays, [
    { id: "pl-1", d: "2026-10-25", min: 90, kind: "singles" },
    { id: "pl-2", d: "2026-10-26", min: 45, kind: "ball_machine" },
  ]);
  // Sam can't log time on Jack's racket or delete Jack's sessions.
  res = await sam.call("POST", "/api/sync", { ops: [
    { op: "play.add", id: "pl-sam", racketId: "jk-blade", d: "2026-10-26", min: 60, kind: "doubles" },
    { op: "play.delete", id: "pl-1" },
  ] });
  assert.equal(res.status, 200);
  res = await jack.call("POST", "/api/sync", { ops: [{ op: "play.delete", id: "pl-2" }] });
  assert.deepEqual(res.data.rackets["jk-blade"].plays.map((p) => p.id), ["pl-1"]);
});

test("bad play sessions are refused", async () => {
  for (const op of [
    { op: "play.add", id: "x1", racketId: "jk-blade", d: "yesterday", min: 60, kind: "singles" },
    { op: "play.add", id: "x2", racketId: "jk-blade", d: "2026-10-26", min: 0, kind: "singles" },
    { op: "play.add", id: "x3", racketId: "jk-blade", d: "2026-10-26", min: 60, kind: "pickleball" },
  ]) assert.equal((await jack.call("POST", "/api/sync", { ops: [op] })).status, 400, op.id);
});

test("each player has their own level and style", async () => {
  let res = await jack.call("POST", "/api/sync", { ops: [] });
  assert.deepEqual(res.data.profile, { level: null, style: null });
  res = await jack.call("POST", "/api/sync", { ops: [{ op: "profile.put", data: { level: "4.0", style: "heavy_spin" } }] });
  assert.deepEqual(res.data.profile, { level: "4.0", style: "heavy_spin" });
  res = await sam.call("POST", "/api/sync", { ops: [] });
  assert.deepEqual(res.data.profile, { level: null, style: null });
  assert.equal((await jack.call("POST", "/api/sync", { ops: [{ op: "profile.put", data: { level: "9.9" } }] })).status, 400);
  assert.equal((await jack.call("POST", "/api/sync", { ops: [{ op: "profile.put", data: { style: "moonball" } }] })).status, 400);
});

test("the auth route refuses odd paths", async () => {
  assert.equal((await jack.call("GET", "/api/auth/..%2f..%2fetc")).status, 404);
});

test("signing out ends the session", async () => {
  assert.equal((await jack.call("POST", "/api/auth/sign-out", {})).status, 200);
  assert.equal((await jack.call("POST", "/api/sync", { ops: [] })).status, 401);
});
