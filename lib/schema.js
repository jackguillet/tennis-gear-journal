// The tables. Every statement is safe to run more than once, so the API runs them on first use
// and there is no separate migration step.
export const SCHEMA = `
-- Stringbed Meter schema. Safe to run more than once.
create table if not exists rackets (
  id          text primary key,
  name        text not null,
  head        real not null,          -- head size, sq in
  gauge       real not null,          -- string gauge, mm
  material    text not null,          -- poly, multi, syngut, gut, hybrid, kevlar
  pattern     text not null,          -- e.g. 16x19
  weight      integer,                -- grams, strung or unstrung as the player records it
  string_name text,
  strung_kg   real,                   -- tension asked of the stringer
  strung_on   date,
  calib       real not null default 1,
  calib_at    timestamptz,
  updated_at  timestamptz not null default now()
);

create table if not exists readings (
  id         text primary key,        -- made on the phone, so an offline save is never sent twice
  racket_id  text not null references rackets(id) on delete cascade,
  taken_at   timestamptz not null,
  hz         real not null,           -- string-bed pitch
  setup      jsonb,                   -- head, gauge, material, pattern, calib at the time
  created_at timestamptz not null default now()
);

create index if not exists readings_racket_idx on readings (racket_id, taken_at);
`;

const statements = () => SCHEMA.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean);

let ready = null;
export function ensureSchema(db) {
  if (!ready) ready = db.transaction(statements().map((s) => [s, []])).catch((e) => { ready = null; throw e; });
  return ready;
}
