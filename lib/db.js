import { neon } from "@neondatabase/serverless";

// One small interface over the database, so tests can run on an in-memory Postgres.
//   query(text, params)       -> rows
//   transaction([[text, params], ...]) -> array of row arrays, all or nothing
let impl = null;

function neonImpl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Connect a Neon database to this Vercel project.");
  const sql = neon(url);
  return {
    query: (text, params = []) => sql.query(text, params),
    transaction: (list) => list.length ? sql.transaction(list.map(([t, p]) => sql.query(t, p || []))) : Promise.resolve([]),
  };
}

export function db() {
  if (!impl) impl = neonImpl();
  return impl;
}

export function setDb(next) { impl = next; }
