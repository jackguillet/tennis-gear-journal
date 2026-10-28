import { createHash, randomBytes } from "node:crypto";

// Connector links for chat assistants. Each link carries a secret token; only its sha256 is
// stored, so a leaked database can't be used to log in. A player can have a few links and
// revoke any of them from the app. A link's scope says what it opens: "mcp" (the chat
// connector, read and write) or "calendar" (the court calendar feed, read only).

export const MAX_TOKENS = 10;
const hash = (secret) => createHash("sha256").update(secret).digest("hex");
const TOKEN = /^sbm_[A-Za-z0-9_-]{32,64}$/;
export const SCOPES = ["mcp", "calendar"];

export const validTimezone = (tz) => {
  if (typeof tz !== "string" || tz.length > 64) return null;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { return null; }
};

export async function createToken(db, userId, { label, timezone, scope = "mcp" } = {}) {
  if (!SCOPES.includes(scope)) throw Object.assign(new Error("Unknown kind of link."), { status: 400 });
  const [{ n }] = await db.query(`select count(*)::int as n from api_tokens where user_id = $1`, [userId]);
  if (n >= MAX_TOKENS) throw Object.assign(new Error(`You can have up to ${MAX_TOKENS} connector links. Remove one first.`), { status: 400 });
  const secret = "sbm_" + randomBytes(32).toString("base64url");
  const id = randomBytes(6).toString("hex");
  const name = typeof label === "string" && label.trim() ? label.trim().slice(0, 40) : scope === "calendar" ? "Court calendar" : "Chat assistant";
  await db.query(`insert into api_tokens (id, token_hash, user_id, label, timezone, scope) values ($1, $2, $3, $4, $5, $6)`,
    [id, hash(secret), userId, name, validTimezone(timezone), scope]);
  return { id, secret, label: name, scope };
}

export async function listTokens(db, userId) {
  const rows = await db.query(
    `select id, label, timezone, scope, (extract(epoch from created_at) * 1000)::float8 as created, (extract(epoch from last_used_at) * 1000)::float8 as used
     from api_tokens where user_id = $1 order by created_at`, [userId]);
  return rows.map((r) => ({ id: r.id, label: r.label, timezone: r.timezone, scope: r.scope, createdAt: Math.round(r.created), lastUsedAt: r.used === null ? null : Math.round(r.used) }));
}

export async function revokeToken(db, userId, id) {
  const rows = await db.query(`delete from api_tokens where id = $1 and user_id = $2 returning id`, [String(id || ""), userId]);
  return rows.length > 0;
}

// The player a secret belongs to, or null. A calendar link never opens the chat connector, and the other way round.
export async function userForToken(db, secret, scope = "mcp") {
  if (typeof secret !== "string" || !TOKEN.test(secret)) return null;
  const rows = await db.query(
    `update api_tokens set last_used_at = now() where token_hash = $1 and scope = $2 returning user_id, timezone`, [hash(secret), scope]);
  return rows[0] ? { id: rows[0].user_id, timezone: rows[0].timezone } : null;
}
