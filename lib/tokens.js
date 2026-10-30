import { createHash, randomBytes } from "node:crypto";

// Tokens for everything that reaches a player's data without the app's session cookie. Only the
// sha256 of each secret is stored, so a leaked database can't be used to log in. A token's
// scope says what it opens:
//   "mcp"       the chat connector. Used as `Authorization: Bearer <token>` (an API token) or in
//               the connector link /api/mcp/<token>. `access` is "read" (only the tools that read)
//               or "write"; `expires_at` is optional.
//   "calendar"  the court calendar feed, read only
//   "gametime"  the GameTime button, which can only save court bookings
//   "log"       the quick-log page and iPhone Shortcut, which can only add and undo play sessions
// OAuth access tokens (lib/oauth.js) are "mcp" tokens with grant_id set and a one-hour expiry;
// they are listed under their grant, not as tokens.

export const MAX_TOKENS = 20;
export const hash = (secret) => createHash("sha256").update(secret).digest("hex");
const TOKEN = /^sbm_[A-Za-z0-9_-]{32,64}$/;
export const SCOPES = ["mcp", "calendar", "gametime", "log"];
export const ACCESS = ["read", "write"];
export const MAX_DAYS = 366;
const DEFAULT_LABEL = { mcp: "API token", calendar: "Court calendar", gametime: "GameTime button", log: "Quick log" };

export const validTimezone = (tz) => {
  if (typeof tz !== "string" || tz.length > 64) return null;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { return null; }
};
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
export const newSecret = () => "sbm_" + randomBytes(32).toString("base64url");
export const newId = () => randomBytes(6).toString("hex");

// Insert one token row; returns the secret, which is never stored.
export async function insertToken(db, userId, { label, timezone, scope = "mcp", access = "write", expiresAt = null, grantId = null }) {
  const secret = newSecret(), id = newId();
  await db.query(`insert into api_tokens (id, token_hash, user_id, label, timezone, scope, access, expires_at, hint, grant_id)
                  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, hash(secret), userId, label, validTimezone(timezone), scope, access, expiresAt ? new Date(expiresAt).toISOString() : null, secret.slice(-4), grantId]);
  return { id, secret };
}

export async function createToken(db, userId, { label, timezone, scope = "mcp", access = "write", days = null } = {}) {
  if (!SCOPES.includes(scope)) throw bad("Unknown kind of link.");
  if (!ACCESS.includes(access)) throw bad("Access must be read or write.");
  if (scope !== "mcp" && access !== "write") throw bad("Only API tokens can be read only.");
  if (days !== null && days !== undefined && (!Number.isInteger(days) || days < 1 || days > MAX_DAYS)) throw bad(`An expiry must be 1 to ${MAX_DAYS} days.`);
  const [{ n }] = await db.query(`select count(*)::int as n from api_tokens where user_id = $1 and grant_id is null`, [userId]);
  if (n >= MAX_TOKENS) throw bad(`You can have up to ${MAX_TOKENS} tokens and links. Remove one first.`);
  const name = typeof label === "string" && label.trim() ? label.trim().slice(0, 40) : DEFAULT_LABEL[scope];
  const expiresAt = days ? Date.now() + days * 864e5 : null;
  const { id, secret } = await insertToken(db, userId, { label: name, timezone, scope, access, expiresAt });
  return { id, secret, label: name, scope, access, expiresAt };
}

const ms = (v) => (v === null || v === undefined ? null : Math.round(Number(v)));

// Tokens and links the player made, then apps they connected with OAuth (kind "app").
export async function listTokens(db, userId) {
  const [tokens, apps] = await Promise.all([
    db.query(
      `select id, label, timezone, scope, access, hint, (extract(epoch from created_at) * 1000)::float8 as created,
              (extract(epoch from last_used_at) * 1000)::float8 as used, (extract(epoch from expires_at) * 1000)::float8 as expires
       from api_tokens where user_id = $1 and grant_id is null order by created_at`, [userId]),
    db.query(
      `select g.id, c.name, g.access, (extract(epoch from g.created_at) * 1000)::float8 as created,
              (extract(epoch from g.last_used_at) * 1000)::float8 as used
       from oauth_grants g join oauth_clients c on c.id = g.client_id where g.user_id = $1 order by g.created_at`, [userId]),
  ]);
  const now = Date.now();
  return [
    ...tokens.map((r) => ({ id: r.id, kind: "token", label: r.label, timezone: r.timezone, scope: r.scope, access: r.access, hint: r.hint,
      createdAt: ms(r.created), lastUsedAt: ms(r.used), expiresAt: ms(r.expires), expired: r.expires !== null && r.expires <= now })),
    ...apps.map((r) => ({ id: r.id, kind: "app", label: r.name || "Connected app", scope: "mcp", access: r.access,
      createdAt: ms(r.created), lastUsedAt: ms(r.used), expiresAt: null, expired: false })),
  ];
}

// Revoke a token, or disconnect an app (its access tokens go with it).
export async function revokeToken(db, userId, id) {
  id = String(id || "");
  const [tokens, grants] = await db.transaction([
    [`delete from api_tokens where id = $1 and user_id = $2 and grant_id is null returning id`, [id, userId]],
    [`delete from oauth_grants where id = $1 and user_id = $2 returning id`, [id, userId]],
  ]);
  return tokens.length + grants.length > 0;
}

// The player a secret belongs to, or null. A calendar link never opens the chat connector, and
// the other way round; an expired token opens nothing.
export async function userForToken(db, secret, scope = "mcp") {
  if (typeof secret !== "string" || !TOKEN.test(secret)) return null;
  const rows = await db.query(
    `update api_tokens set last_used_at = now()
     where token_hash = $1 and scope = $2 and (expires_at is null or expires_at > now())
     returning user_id, timezone, access, grant_id`, [hash(secret), scope]);
  const r = rows[0];
  if (!r) return null;
  if (r.grant_id) await db.query(`update oauth_grants set last_used_at = now() where id = $1`, [r.grant_id]);
  return { id: r.user_id, timezone: r.timezone, access: r.access || "write" };
}
