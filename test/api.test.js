import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setDb } from "../lib/db.js";
import { POST as sync } from "../api/sync.js";
import { POST as login, GET as loginState, DELETE as logout } from "../api/login.js";

process.env.APP_PASSCODE = "correct horse";

before(async () => {
  const pg = new PGlite();
  setDb({
    query: async (t, p = []) => (await pg.query(t, p)).rows,
    transaction: (list) => pg.transaction(async (tx) => { const out = []; for (const [t, p] of list) out.push((await tx.query(t, p || [])).rows); return out; }),
  });
});

const post = (fn, body, cookie) =>
  fn(new Request("https://x.test/api", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));

let cookie;
const blade = { name: "Wilson Blade 98 v8", head: 98, gauge: 1.25, material: "poly", pattern: "16x19", weight: 305, stringName: "Luxilon ALU Power", strungKg: 22.68, strungOn: "2026-10-11", calib: 1, calibAt: null };

test("sync refuses without a session", async () => {
  const res = await post(sync, { ops: [] });
  assert.equal(res.status, 401);
});

test("a wrong passcode is refused and sets no cookie", async () => {
  const res = await post(login, { passcode: "nope" });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("the right passcode signs in", async () => {
  const res = await post(login, { passcode: "correct horse" });
  assert.equal(res.status, 200);
  cookie = res.headers.get("set-cookie").split(";")[0];
  assert.match(res.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  const state = await loginState(new Request("https://x.test/api/login", { headers: { cookie } }));
  assert.deepEqual(await state.json(), { signedIn: true });
});

test("a tampered cookie is refused", async () => {
  const bad = cookie.replace(/\.(.)/, (m, c) => "." + (c === "A" ? "B" : "A"));
  assert.equal((await post(sync, { ops: [] }, bad)).status, 401);
});

test("an empty database returns no rackets", async () => {
  const res = await post(sync, { ops: [] }, cookie);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { rackets: {} });
});

test("rackets and readings round-trip with their types", async () => {
  const s = { head: 98, gauge: 1.25, material: "poly", pattern: "16x19", calib: 1 };
  const res = await post(sync, { ops: [
    { op: "racket.put", id: "blade-v8", data: blade },
    { op: "reading.add", id: "rd1", racketId: "blade-v8", t: 1793044980123, hz: 521.4, s },
    { op: "reading.add", id: "rd1", racketId: "blade-v8", t: 1793044980123, hz: 521.4, s }, // sent twice
  ] }, cookie);
  assert.equal(res.status, 200);
  const { rackets } = await res.json();
  const r = rackets["blade-v8"];
  assert.equal(r.name, "Wilson Blade 98 v8");
  assert.equal(r.gauge, 1.25);
  assert.equal(r.strungKg, 22.68);
  assert.equal(r.strungOn, "2026-10-11");
  assert.equal(r.calibAt, null);
  assert.deepEqual(r.readings, [{ id: "rd1", t: 1793044980123, hz: 521.4, s }]);
});

test("editing a racket keeps its readings, and calibration time survives", async () => {
  const res = await post(sync, { ops: [{ op: "racket.put", id: "blade-v8", data: { ...blade, calib: 1.07, calibAt: 1793045000000 } }] }, cookie);
  const r = (await res.json()).rackets["blade-v8"];
  assert.equal(r.calib, 1.07);
  assert.equal(r.calibAt, 1793045000000);
  assert.equal(r.readings.length, 1);
});

test("a reading for a racket deleted elsewhere is dropped, not an error", async () => {
  const res = await post(sync, { ops: [
    { op: "racket.put", id: "gone", data: { ...blade, name: "Old racket" } },
    { op: "racket.delete", id: "gone" },
    { op: "reading.add", id: "rd2", racketId: "gone", t: 1, hz: 500 },
  ] }, cookie);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rackets.gone, undefined);
});

test("deleting a reading removes it", async () => {
  const res = await post(sync, { ops: [{ op: "reading.delete", id: "rd1" }] }, cookie);
  assert.equal((await res.json()).rackets["blade-v8"].readings.length, 0);
});

test("one bad change rejects the whole batch and saves nothing", async () => {
  const res = await post(sync, { ops: [
    { op: "racket.put", id: "new-one", data: { ...blade, name: "New" } },
    { op: "racket.put", id: "bad id!", data: blade },
  ] }, cookie);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not a valid id/);
  const after = await (await post(sync, { ops: [] }, cookie)).json();
  assert.equal(after.rackets["new-one"], undefined);
});

test("out-of-range values are refused", async () => {
  for (const data of [{ ...blade, head: 400 }, { ...blade, material: "rope" }, { ...blade, strungOn: "Oct 11" }, { ...blade, name: "" }]) {
    assert.equal((await post(sync, { ops: [{ op: "racket.put", id: "x", data }] }, cookie)).status, 400);
  }
});

test("signing out clears the cookie", async () => {
  const res = await logout(new Request("https://x.test/api/login", { method: "DELETE" }));
  assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
});
