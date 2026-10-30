import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { startServer } from "../scripts/server.js";

// API tokens (read only, expiry, Bearer header) and OAuth sign-in for the chat connector,
// played through the way claude.ai does it: 401 -> metadata -> register -> authorize -> token.
let app;
before(async () => { delete process.env.NEON_AUTH_BASE_URL; app = await startServer({ port: 3971 }); });
after(() => app.close());

function browser() {
  const jar = new Map();
  return {
    async call(method, path, body, extra = {}) {
      const res = await fetch(app.origin + path, {
        method, redirect: "manual",
        headers: { "content-type": "application/json", origin: app.origin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";"); const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
        if (/max-age=0/i.test(c) || value === "") jar.delete(name); else jar.set(name, value);
      }
      const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {}
      return { status: res.status, data, headers: res.headers };
    },
  };
}
let rpcId = 0;
async function mcp(method, params, token, url = app.origin + "/api/mcp") {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const form = (path, values, headers = {}) => fetch(app.origin + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(values) })
  .then(async (r) => ({ status: r.status, data: await r.json() }));

const racket = { name: "Wilson Blade 98 v8", head: 98, gauge: 1.25, material: "poly", pattern: "16x19", weight: 305, stringName: "ALU Power", strungKg: 22.68, strungOn: "2026-10-11", calib: 1, calibAt: null };
const jack = browser(), sam = browser();

test("setup: two players, and the users table fills in on sign-in", async () => {
  assert.equal((await jack.call("POST", "/api/auth/sign-up/email", { name: "Jack", email: "jack@example.com", password: "forehand-winner" })).status, 200);
  assert.equal((await sam.call("POST", "/api/auth/sign-up/email", { name: "Sam", email: "sam@example.com", password: "drop-shot-123" })).status, 200);
  assert.equal((await jack.call("POST", "/api/sync", { ops: [{ op: "racket.put", id: "v8", data: racket }], timezone: "America/Los_Angeles" })).status, 200);
  assert.equal((await sam.call("POST", "/api/sync", { ops: [] })).status, 200);
});

test("API tokens: read only sees and runs only reading tools; read and write sees all", async () => {
  const ro = await jack.call("POST", "/api/tokens", { label: "Laptop", access: "read", days: 30 });
  assert.equal(ro.status, 200, JSON.stringify(ro.data));
  assert.equal(ro.data.token.access, "read");
  assert.ok(Math.abs(ro.data.token.expiresAt - (Date.now() + 30 * 864e5)) < 60e3);
  const listed = ro.data.tokens.find((t) => t.id === ro.data.token.id);
  assert.equal(listed.hint, ro.data.token.secret.slice(-4));
  assert.equal(listed.kind, "token");

  const tools = (await mcp("tools/list", null, ro.data.token.secret)).body.result.tools.map((t) => t.name);
  assert.ok(tools.includes("list_rackets") && !tools.includes("log_play"), tools.join());
  const refused = (await mcp("tools/call", { name: "log_play", arguments: { kind: "singles", hours: 1 } }, ro.data.token.secret)).body.result;
  assert.equal(refused.isError, true); assert.match(refused.content[0].text, /read only/);
  const read = (await mcp("tools/call", { name: "list_rackets", arguments: {} }, ro.data.token.secret)).body.result;
  assert.equal(read.structuredContent.rackets[0].id, "v8");

  const rw = await jack.call("POST", "/api/tokens", { label: "Claude Code", access: "write" });
  assert.ok((await mcp("tools/list", null, rw.data.token.secret)).body.result.tools.some((t) => t.name === "log_play"));
  // The same token still works as a connector link.
  const viaLink = await mcp("tools/list", null, null, app.origin + "/api/mcp/" + rw.data.token.secret);
  assert.equal(viaLink.status, 200);
});

test("bad token options are refused", async () => {
  assert.equal((await jack.call("POST", "/api/tokens", { access: "admin" })).status, 400);
  assert.equal((await jack.call("POST", "/api/tokens", { days: 0 })).status, 400);
  assert.equal((await jack.call("POST", "/api/tokens", { days: 9999 })).status, 400);
  assert.equal((await jack.call("POST", "/api/tokens", { scope: "calendar", access: "read" })).status, 400);
});

test("an expired token opens nothing and is listed as expired", async () => {
  const out = await jack.call("POST", "/api/tokens", { label: "Short", days: 1 });
  const { db } = await import("../lib/db.js");
  await db().query(`update api_tokens set expires_at = now() - interval '1 minute' where id = $1`, [out.data.token.id]);
  const res = await mcp("tools/list", null, out.data.token.secret);
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate"), /error="invalid_token"/);
  const list = (await jack.call("GET", "/api/tokens")).data.tokens;
  assert.equal(list.find((t) => t.id === out.data.token.id).expired, true);
});

test("OAuth: the connector without a token points clients to sign-in", async () => {
  const res = await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1" } });
  assert.equal(res.status, 401);
  const header = res.headers.get("www-authenticate");
  assert.match(header, /^Bearer resource_metadata="http:\/\/localhost:3971\/\.well-known\/oauth-protected-resource"$/);
  const prm = await (await fetch(app.origin + "/.well-known/oauth-protected-resource")).json();
  assert.equal(prm.resource, app.origin + "/api/mcp");
  assert.deepEqual(prm.authorization_servers, [app.origin]);
  const as = await (await fetch(app.origin + "/.well-known/oauth-authorization-server")).json();
  assert.equal(as.issuer, app.origin);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.equal(as.token_endpoint, app.origin + "/oauth/token");
});

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
let client, verifier, challenge, refresh, access;
const pkce = () => { verifier = randomBytes(32).toString("base64url"); challenge = createHash("sha256").update(verifier).digest("base64url"); };
const authorizeQuery = (extra = {}) => new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "st-1", scope: "write", resource: app.origin + "/api/mcp", ...extra });

test("OAuth: a client registers itself; bad redirect addresses are refused", async () => {
  const bad = await fetch(app.origin + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }) });
  assert.equal(bad.status, 400);
  const plainHttp = await fetch(app.origin + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) });
  assert.equal(plainHttp.status, 400);
  const res = await fetch(app.origin + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }) });
  assert.equal(res.status, 201);
  client = await res.json();
  assert.match(client.client_id, /^c_/);
  assert.equal(client.client_secret, undefined);
});

test("OAuth: authorize sends the player to the app; an unknown client gets an error page, not a redirect", async () => {
  pkce();
  let res = await fetch(app.origin + "/oauth/authorize?" + authorizeQuery(), { redirect: "manual" });
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get("location"));
  assert.equal(to.origin + to.pathname, app.origin + "/");
  assert.equal(new URLSearchParams(to.searchParams.get("connect")).get("client_id"), client.client_id);
  res = await fetch(app.origin + "/oauth/authorize?" + authorizeQuery({ client_id: "c_nope" }), { redirect: "manual" });
  assert.equal(res.status, 400);
  res = await fetch(app.origin + "/oauth/authorize?" + authorizeQuery({ redirect_uri: "https://evil.example/cb" }), { redirect: "manual" });
  assert.equal(res.status, 400);
  res = await fetch(app.origin + "/oauth/authorize?" + authorizeQuery({ code_challenge_method: "plain" }), { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("location")).searchParams.get("error"), "invalid_request");
});

test("OAuth: the app asks, needs the session and its own origin, and answers with a code", async () => {
  const request = authorizeQuery().toString();
  assert.equal((await browser().call("POST", "/oauth/authorize", { request, allow: true })).status, 401);
  assert.equal((await jack.call("POST", "/oauth/authorize", { request, allow: true }, { origin: "https://evil.example" })).status, 403);
  const about = await jack.call("POST", "/oauth/authorize", { request, describe: true });
  assert.deepEqual(about.data, { client: "Claude", access: "write", to: "claude.ai" });
  const no = await jack.call("POST", "/oauth/authorize", { request, allow: false });
  assert.equal(new URL(no.data.redirect).searchParams.get("error"), "access_denied");
  const yes = await jack.call("POST", "/oauth/authorize", { request, allow: true, access: "write" });
  const back = new URL(yes.data.redirect);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get("state"), "st-1");
  const code = back.searchParams.get("code");

  // Wrong verifier, then the right one; a code works once.
  let tok = await form("/oauth/token", { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: "x".repeat(43) });
  assert.equal(tok.status, 400); assert.equal(tok.data.error, "invalid_grant");
  // The failed try used the code up; ask again.
  const again = new URL((await jack.call("POST", "/oauth/authorize", { request, allow: true })).data.redirect).searchParams.get("code");
  tok = await form("/oauth/token", { grant_type: "authorization_code", code: again, client_id: client.client_id, redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal(tok.status, 200, JSON.stringify(tok.data));
  assert.equal(tok.data.token_type, "Bearer");
  assert.equal(tok.data.expires_in, 3600);
  ({ access_token: access, refresh_token: refresh } = tok.data);
  const reuse = await form("/oauth/token", { grant_type: "authorization_code", code: again, client_id: client.client_id, code_verifier: verifier });
  assert.equal(reuse.status, 400);
});

test("OAuth: the access token works on the connector, as Jack, in his time zone", async () => {
  const init = await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1" } }, access);
  assert.equal(init.status, 200);
  const out = (await mcp("tools/call", { name: "list_rackets", arguments: {} }, access)).body.result;
  assert.equal(out.structuredContent.rackets[0].id, "v8");
  const list = (await jack.call("GET", "/api/tokens")).data.tokens;
  const app_ = list.find((t) => t.kind === "app");
  assert.equal(app_.label, "Claude");
  assert.ok(app_.lastUsedAt);
  assert.equal(list.filter((t) => t.label === "OAuth").length, 0, "access tokens aren't listed one by one");
  assert.equal((await sam.call("GET", "/api/tokens")).data.tokens.filter((t) => t.kind === "app").length, 0);
});

test("OAuth: refresh rotates; the old refresh token stops working", async () => {
  const r1 = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: refresh, client_id: client.client_id });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.notEqual(r1.data.refresh_token, refresh);
  const stale = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: refresh, client_id: client.client_id });
  assert.equal(stale.status, 400);
  refresh = r1.data.refresh_token; access = r1.data.access_token;
  assert.equal((await mcp("tools/list", null, access)).status, 200);
});

test("OAuth: a read-only grant only sees reading tools", async () => {
  pkce();
  const request = authorizeQuery({ scope: "read" }).toString();
  assert.equal((await jack.call("POST", "/oauth/authorize", { request, describe: true })).data.access, "read");
  const code = new URL((await jack.call("POST", "/oauth/authorize", { request, allow: true, access: "read" })).data.redirect).searchParams.get("code");
  const tok = await form("/oauth/token", { grant_type: "authorization_code", code, client_id: client.client_id, code_verifier: verifier });
  assert.equal(tok.data.scope, "read");
  const tools = (await mcp("tools/list", null, tok.data.access_token)).body.result.tools.map((t) => t.name);
  assert.ok(!tools.includes("log_play"));
});

test("OAuth: clients with a secret must send it", async () => {
  const reg = await (await fetch(app.origin + "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Server app", redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" }) })).json();
  assert.match(reg.client_secret, /^sbmc_/);
  const res = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: "nope", client_id: reg.client_id });
  assert.equal(res.status, 401);
  const basic = "Basic " + Buffer.from(reg.client_id + ":" + reg.client_secret).toString("base64");
  const ok = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: "nope" }, { authorization: basic });
  assert.equal(ok.status, 400, "authenticated, but the refresh token is wrong");
  assert.equal(ok.data.error, "invalid_grant");
});

test("disconnecting the app in Settings ends its access and refresh tokens", async () => {
  const appRow = (await jack.call("GET", "/api/tokens")).data.tokens.find((t) => t.kind === "app" && t.access === "write");
  assert.equal((await sam.call("DELETE", "/api/tokens", { id: appRow.id })).status, 200);
  assert.equal((await mcp("tools/list", null, access)).status, 200, "Sam can't disconnect Jack's app");
  await jack.call("DELETE", "/api/tokens", { id: appRow.id });
  assert.equal((await mcp("tools/list", null, access)).status, 401);
  const r = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: refresh, client_id: client.client_id });
  assert.equal(r.status, 400);
});
