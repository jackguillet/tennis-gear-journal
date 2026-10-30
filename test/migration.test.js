import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pgliteDb } from "../lib/db.js";
import { ensureSchema, resetSchemaCache, OWNED } from "../lib/schema.js";
import { getState } from "../lib/store.js";
import { ensureUser, getUser } from "../lib/users.js";

const oldRackets = async (db) => {
  // The tables as the passcode version made them, with one racket and reading.
  await db.query(`create table rackets (id text primary key, name text not null, head real not null, gauge real not null,
    material text not null, pattern text not null, weight integer, string_name text, strung_kg real, strung_on date,
    calib real not null default 1, calib_at timestamptz, updated_at timestamptz not null default now())`);
  await db.query(`create table readings (id text primary key, racket_id text not null references rackets(id) on delete cascade,
    taken_at timestamptz not null, hz real not null, setup jsonb, created_at timestamptz not null default now())`);
  await db.query(`insert into rackets (id, name, head, gauge, material, pattern) values ('blade-v8', 'Wilson Blade 98 v8', 98, 1.25, 'poly', '16x19')`);
  await db.query(`insert into readings (id, racket_id, taken_at, hz) values ('r1', 'blade-v8', now(), 520)`);
};

test("a database from the single-user version upgrades, and its rackets go to the only account", async () => {
  const db = pgliteDb(new PGlite());
  await oldRackets(db);
  resetSchemaCache();
  await ensureSchema(db);

  assert.equal(await ensureUser(db, { id: "u-jack", email: "jack@example.com", name: "Jack" }, { timezone: "America/Los_Angeles" }), 1, "the first account gets the old racket");
  const { rackets } = await getState(db, "u-jack");
  assert.equal(rackets["blade-v8"].readings.length, 1);
  assert.equal(await ensureUser(db, { id: "u-jack", email: "jack@example.com" }), 0, "only once");
  const me = await getUser(db, "u-jack");
  assert.equal(me.name, "Jack", "a sign-in without a name keeps the one saved");
  assert.equal(me.timezone, "America/Los_Angeles");
  resetSchemaCache();
});

test("once a second account exists, nobody can claim unowned rackets", async () => {
  const db = pgliteDb(new PGlite());
  await oldRackets(db);
  resetSchemaCache();
  await ensureSchema(db);
  await db.query(`insert into users (id) values ('u-first')`);
  assert.equal(await ensureUser(db, { id: "u-friend", email: "friend@example.com" }), 0);
  assert.deepEqual((await getState(db, "u-friend")).rackets, {});
  resetSchemaCache();
});

test("existing data gets a users row for each owner, then foreign keys, and deleting a user deletes their data", async () => {
  const db = pgliteDb(new PGlite());
  resetSchemaCache();
  await ensureSchema(db);
  // A database from before the users table: drop the keys and users, as if just upgraded.
  for (const t of OWNED) await db.query(`alter table ${t} drop constraint ${t}_user_fk`);
  await db.query(`insert into rackets (id, user_id, name, head, gauge, material, pattern) values ('v9', 'u-jack', 'Blade v9', 98, 1.25, 'poly', '16x19')`);
  await db.query(`insert into shoes (id, user_id, name, started_on) values ('s1', 'u-jack', 'NB 996v6', '2026-10-01')`);
  await db.query(`insert into players (user_id, level) values ('u-sam', '4.0')`);
  await db.query(`delete from users`);
  resetSchemaCache();
  await ensureSchema(db);
  assert.deepEqual((await db.query(`select id from users order by id`)).map((r) => r.id), ["u-jack", "u-sam"]);
  const keys = await db.query(`select conname from pg_constraint where conname like '%user_fk' order by conname`);
  assert.equal(keys.length, OWNED.length);
  await assert.rejects(db.query(`insert into shoes (id, user_id, name, started_on) values ('s2', 'nobody', 'x', '2026-10-01')`), "a row for an unknown user is refused");
  await db.query(`delete from users where id = 'u-jack'`);
  assert.equal((await db.query(`select count(*)::int as n from rackets`))[0].n, 0);
  assert.equal((await db.query(`select count(*)::int as n from shoes`))[0].n, 0);
  resetSchemaCache();
  await ensureSchema(db); // safe to run again
  resetSchemaCache();
});
