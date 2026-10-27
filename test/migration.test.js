import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pgliteDb } from "../lib/db.js";
import { ensureSchema, resetSchemaCache } from "../lib/schema.js";
import { claimUnowned, getState } from "../lib/store.js";

test("a database from the single-user version upgrades, and its rackets go to OWNER_EMAIL", async () => {
  const db = pgliteDb(new PGlite());
  // The tables as the passcode version made them, with one racket and reading.
  await db.query(`create table rackets (id text primary key, name text not null, head real not null, gauge real not null,
    material text not null, pattern text not null, weight integer, string_name text, strung_kg real, strung_on date,
    calib real not null default 1, calib_at timestamptz, updated_at timestamptz not null default now())`);
  await db.query(`create table readings (id text primary key, racket_id text not null references rackets(id) on delete cascade,
    taken_at timestamptz not null, hz real not null, setup jsonb, created_at timestamptz not null default now())`);
  await db.query(`insert into rackets (id, name, head, gauge, material, pattern) values ('blade-v8', 'Wilson Blade 98 v8', 98, 1.25, 'poly', '16x19')`);
  await db.query(`insert into readings (id, racket_id, taken_at, hz) values ('r1', 'blade-v8', now(), 520)`);

  resetSchemaCache();
  await ensureSchema(db);
  process.env.OWNER_EMAIL = "Jack@Example.com";

  assert.equal(await claimUnowned(db, { id: "u-friend", email: "friend@example.com" }), 0, "a friend gets nothing");
  assert.deepEqual((await getState(db, "u-friend")).rackets, {});

  assert.equal(await claimUnowned(db, { id: "u-jack", email: "jack@example.com" }), 1, "the owner gets the old racket");
  const { rackets } = await getState(db, "u-jack");
  assert.equal(rackets["blade-v8"].name, "Wilson Blade 98 v8");
  assert.equal(rackets["blade-v8"].readings.length, 1);
  assert.equal(await claimUnowned(db, { id: "u-jack", email: "jack@example.com" }), 0, "only once");
  delete process.env.OWNER_EMAIL;
  resetSchemaCache();
});
