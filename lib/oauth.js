import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, insertToken, newId, validTimezone, ACCESS } from "./tokens.js";

// OAuth 2.1 for the chat connector, the way MCP clients such as claude.ai expect it:
//   - metadata at /.well-known/oauth-protected-resource (RFC 9728) and
//     /.well-known/oauth-authorization-server (RFC 8414)
//   - clients register themselves at /oauth/register (RFC 7591)
//   - /oauth/authorize sends the player to the app, which signs them in and asks
//     "Allow <app> to read and change your tennis data?"; the app answers with a one-time code
//   - /oauth/token swaps the code (with its PKCE verifier) for a one-hour access token and a
//     refresh token, and later swaps the refresh token for new ones (rotated each time)
// Access tokens are ordinary "mcp" tokens (lib/tokens.js) tied to the grant, so /api/mcp checks
// them the same way as API tokens. Disconnecting the app in Settings deletes the grant and them.

export const ACCESS_SECONDS = 3600;
const CODE_SECONDS = 600;
const MAX_REDIRECTS = 5;

export class OAuthError extends Error {
  constructor(code, description, status = 400) { super(description); this.code = code; this.status = status; }
}
const fail = (code, description, status) => { throw new OAuthError(code, description, status); };

export const resourceUrl = (origin) => origin + "/api/mcp";

export const resourceMetadata = (origin) => ({
  resource: resourceUrl(origin),
  authorization_servers: [origin],
  scopes_supported: ACCESS,
  bearer_methods_supported: ["header"],
  resource_name: "Tennis Hub",
});

export const serverMetadata = (origin) => ({
  issuer: origin,
  authorization_endpoint: origin + "/oauth/authorize",
  token_endpoint: origin + "/oauth/token",
  registration_endpoint: origin + "/oauth/register",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  scopes_supported: ACCESS,
  service_documentation: origin + "/",
});

// https anywhere, http only on this computer (Claude Code and other desktop clients), or an
// app's own scheme (cursor://...). Never javascript:, data: or file:.
function validRedirect(uri) {
  if (typeof uri !== "string" || uri.length > 500) return false;
  let u; try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return isLoopback(u);
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !["javascript:", "data:", "file:", "blob:", "vbscript:", "about:"].includes(u.protocol);
}
const isLoopback = (u) => ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);

// Exact match, except a loopback http address may use any port (RFC 8252 section 7.3).
function redirectMatches(registered, asked) {
  if (registered.includes(asked)) return true;
  let a; try { a = new URL(asked); } catch { return false; }
  if (a.protocol !== "http:" || !isLoopback(a)) return false;
  return registered.some((r) => {
    try { const u = new URL(r); return u.protocol === "http:" && u.hostname === a.hostname && u.pathname === a.pathname && u.search === a.search; } catch { return false; }
  });
}

export async function registerClient(db, body) {
  if (!body || typeof body !== "object") fail("invalid_client_metadata", "Send the client metadata as JSON.");
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_REDIRECTS || !uris.every(validRedirect)) {
    fail("invalid_redirect_uri", `redirect_uris must be 1 to ${MAX_REDIRECTS} https (or loopback http) addresses.`);
  }
  const method = body.token_endpoint_auth_method || "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) fail("invalid_client_metadata", "Unsupported token_endpoint_auth_method.");
  const grants = body.grant_types || ["authorization_code", "refresh_token"];
  if (!Array.isArray(grants) || !grants.includes("authorization_code") || grants.some((g) => !["authorization_code", "refresh_token"].includes(g))) {
    fail("invalid_client_metadata", "grant_types may only be authorization_code and refresh_token.");
  }
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 60) : "Chat assistant";
  const id = "c_" + randomBytes(12).toString("base64url");
  const secret = method === "none" ? null : "sbmc_" + randomBytes(32).toString("base64url");
  // Registration is open to anyone, so clear out clients nobody ever finished connecting.
  await db.query(`delete from oauth_clients c where c.created_at < now() - interval '1 day' and not exists (select 1 from oauth_grants g where g.client_id = c.id)`);
  await db.query(`insert into oauth_clients (id, name, redirect_uris, secret_hash) values ($1, $2, $3, $4)`, [id, name, JSON.stringify(uris), secret ? hash(secret) : null]);
  return {
    client_id: id, client_name: name, redirect_uris: uris, token_endpoint_auth_method: method,
    grant_types: grants, response_types: ["code"], client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
  };
}

async function clientById(db, id) {
  if (typeof id !== "string" || id.length > 100) return null;
  const rows = await db.query(`select id, name, redirect_uris, secret_hash from oauth_clients where id = $1`, [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, redirectUris: typeof r.redirect_uris === "string" ? JSON.parse(r.redirect_uris) : r.redirect_uris, secretHash: r.secret_hash };
}

const asked = (scope) => (String(scope || "").split(/\s+/).includes("write") || !scope ? "write" : String(scope).split(/\s+/).includes("read") ? "read" : "write");

// Check an authorization request (the query string of /oauth/authorize). A bad client or
// redirect_uri can't be sent back to the client, so it throws with redirect = null; anything
// else goes back to the client's redirect_uri as ?error=.
export async function checkAuthorize(db, params, origin) {
  const p = (k) => (params.get(k) || "").trim();
  const client = await clientById(db, p("client_id"));
  if (!client) throw Object.assign(new OAuthError("invalid_client", "This app isn't registered. Remove the connector in your assistant and add it again."), { redirect: null });
  const redirectUri = p("redirect_uri") || (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) throw Object.assign(new OAuthError("invalid_request", "The app's return address doesn't match the one it registered."), { redirect: null });
  const back = { redirect: redirectUri, state: p("state") };
  const bad = (code, msg) => { throw Object.assign(new OAuthError(code, msg), back); };
  if (p("response_type") !== "code") bad("unsupported_response_type", "Only response_type=code is supported.");
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(p("code_challenge"))) bad("invalid_request", "A PKCE code_challenge is required.");
  if (p("code_challenge_method") !== "S256") bad("invalid_request", "code_challenge_method must be S256.");
  const resource = p("resource");
  if (resource && !resource.replace(/\/$/, "").startsWith(origin)) bad("invalid_target", "This server only issues tokens for its own connector.");
  return { client, redirectUri, state: p("state"), challenge: p("code_challenge"), access: asked(p("scope")) };
}

export function redirectWith(uri, values) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  return u.href;
}

// The player said yes: make a one-time code and send them back to the app.
export async function issueCode(db, userId, request, access, origin) {
  if (!ACCESS.includes(access)) access = request.access;
  const code = randomBytes(32).toString("base64url");
  await db.query(`delete from oauth_codes where expires_at < now()`);
  await db.query(`insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, access, expires_at)
                  values ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))`,
    [hash(code), request.client.id, userId, request.redirectUri, request.challenge, access, CODE_SECONDS]);
  return redirectWith(request.redirectUri, { code, state: request.state, iss: origin });
}

const sameSecret = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function clientCredentials(form, authorization) {
  let id = form.get("client_id"), secret = form.get("client_secret");
  if (authorization && /^basic /i.test(authorization)) {
    try {
      const [u, s] = Buffer.from(authorization.slice(6).trim(), "base64").toString().split(":");
      id = decodeURIComponent(u); secret = decodeURIComponent(s || "");
    } catch { fail("invalid_client", "Bad client credentials.", 401); }
  }
  return { id, secret };
}

async function authenticateClient(db, form, authorization) {
  const { id, secret } = clientCredentials(form, authorization);
  const client = await clientById(db, id);
  if (!client) fail("invalid_client", "Unknown client.", 401);
  if (client.secretHash && !(secret && sameSecret(hash(secret), client.secretHash))) fail("invalid_client", "Wrong client secret.", 401);
  return client;
}

async function tokensFor(db, grant) {
  await db.query(`delete from api_tokens where grant_id = $1 and expires_at < now()`, [grant.id]);
  const { secret } = await insertToken(db, grant.user_id, {
    label: "OAuth", timezone: grant.timezone, scope: "mcp", access: grant.access,
    expiresAt: Date.now() + ACCESS_SECONDS * 1000, grantId: grant.id,
  });
  return { access_token: secret, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: grant.refresh, scope: grant.access };
}

// POST /oauth/token (form-encoded).
export async function exchange(db, form, authorization) {
  const client = await authenticateClient(db, form, authorization);
  const type = form.get("grant_type");
  if (type === "authorization_code") {
    const code = form.get("code") || "", verifier = form.get("code_verifier") || "";
    const [row] = await db.query(`delete from oauth_codes where code_hash = $1 returning client_id, user_id, redirect_uri, challenge, access, expires_at > now() as live`, [hash(code)]);
    if (!row || !row.live || row.client_id !== client.id) fail("invalid_grant", "This sign-in code is invalid or has expired. Try connecting again.");
    if (form.get("redirect_uri") && form.get("redirect_uri") !== row.redirect_uri) fail("invalid_grant", "redirect_uri doesn't match.");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !sameSecret(challenge, row.challenge)) fail("invalid_grant", "The PKCE code_verifier doesn't match.");
    const [user] = await db.query(`select timezone from users where id = $1`, [row.user_id]);
    const refresh = "sbmr_" + randomBytes(32).toString("base64url");
    const grant = { id: newId(), user_id: row.user_id, access: row.access, timezone: validTimezone(user && user.timezone), refresh };
    await db.query(`insert into oauth_grants (id, user_id, client_id, access, refresh_hash, timezone, last_used_at) values ($1, $2, $3, $4, $5, $6, now())`,
      [grant.id, grant.user_id, client.id, grant.access, hash(refresh), grant.timezone]);
    return tokensFor(db, grant);
  }
  if (type === "refresh_token") {
    const old = form.get("refresh_token") || "";
    const refresh = "sbmr_" + randomBytes(32).toString("base64url");
    const [row] = await db.query(
      `update oauth_grants set refresh_hash = $1, last_used_at = now() where refresh_hash = $2 and client_id = $3
       returning id, user_id, access, timezone`, [hash(refresh), hash(old), client.id]);
    if (!row) fail("invalid_grant", "This connection was turned off or the refresh token is out of date. Connect again.");
    return tokensFor(db, { ...row, refresh });
  }
  fail("unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
}
