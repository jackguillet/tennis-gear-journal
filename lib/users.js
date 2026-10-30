import { validTimezone } from "./tokens.js";

// The users table mirrors Neon Auth accounts. Every request with a session cookie calls
// ensureUser first, so the row exists before anything that points at it is saved.
// Token requests (connector, calendar, quick log) don't need to: a token row already
// points at its user.
export async function ensureUser(db, user, { timezone } = {}) {
  if (!user || !user.id) throw Object.assign(new Error("Sign in first."), { status: 401 });
  await db.query(
    `insert into users (id, email, name, timezone, last_seen_at) values ($1, $2, $3, $4, now())
     on conflict (id) do update set email = coalesce(excluded.email, users.email), name = coalesce(excluded.name, users.name),
       timezone = coalesce(excluded.timezone, users.timezone), last_seen_at = now()`,
    [user.id, user.email || null, user.name || null, validTimezone(timezone)]);
  return claimUnowned(db, user.id);
}

// Rackets saved by the single-user (passcode) version have no owner. While there is only one
// account, they are its rackets; once a second account exists nobody can claim them.
export async function claimUnowned(db, userId) {
  const rows = await db.query(
    `update rackets set user_id = $1 where user_id is null and (select count(*) from users) = 1 and exists (select 1 from users where id = $1) returning id`, [userId]);
  return rows.length;
}

export async function getUser(db, userId) {
  const rows = await db.query(`select id, email, name, timezone, (extract(epoch from created_at) * 1000)::float8 as created from users where id = $1`, [userId]);
  const r = rows[0];
  return r ? { id: r.id, email: r.email, name: r.name, timezone: r.timezone, createdAt: Math.round(r.created) } : null;
}
