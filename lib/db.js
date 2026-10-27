import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";

// One small interface over the database, so tests can run on an in-memory Postgres.
//   query(text, params)                -> rows
//   transaction([[text, params], ...]) -> array of row arrays, all or nothing
//
// On Vercel the app uses node-postgres with a pool that Vercel's Fluid compute keeps
// between requests (attachDatabasePool closes idle clients before a function is suspended).
// DATABASE_URL is Neon's pooled connection string.
let impl = null;

function pgImpl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Run `neon env pull` locally, or connect Neon to the Vercel project.");
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5000 });
  attachDatabasePool(pool);
  return {
    query: async (text, params = []) => (await pool.query(text, params)).rows,
    transaction: async (list) => {
      if (!list.length) return [];
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = [];
        for (const [t, p] of list) out.push((await client.query(t, p || [])).rows);
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

export function db() {
  if (!impl) impl = pgImpl();
  return impl;
}

export function setDb(next) { impl = next; }

// Adapter for PGlite (in-memory Postgres), used by tests and `npm run dev`.
export function pgliteDb(pg) {
  return {
    query: async (t, p = []) => (await pg.query(t, p)).rows,
    transaction: (list) => pg.transaction(async (tx) => { const out = []; for (const [t, p] of list) out.push((await tx.query(t, p || [])).rows); return out; }),
  };
}
