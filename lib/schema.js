// The tables. Every statement is safe to run more than once, so the API runs them on first use
// and there is no separate migration step. Accounts themselves live in Neon Auth's own
// `neon_auth` schema; user_id here is the Neon Auth user id.
export const SCHEMA = `
create table if not exists rackets (
  id          text primary key,
  user_id     text,                   -- owner, null only for rows from the single-user version
  name        text not null,
  head        real not null,          -- head size, sq in
  gauge       real not null,          -- string gauge, mm
  material    text not null,          -- poly, multi, syngut, gut, hybrid, kevlar
  pattern     text not null,          -- e.g. 16x19
  weight      integer,                -- grams
  string_name text,
  strung_kg   real,                   -- tension asked of the stringer
  strung_on   date,
  calib       real not null default 1,
  calib_at    timestamptz,
  updated_at  timestamptz not null default now()
);

alter table rackets add column if not exists user_id text;

create index if not exists rackets_user_idx on rackets (user_id);

create table if not exists readings (
  id         text primary key,        -- made on the phone, so an offline save is never sent twice
  racket_id  text not null references rackets(id) on delete cascade,
  taken_at   timestamptz not null,
  hz         real not null,           -- string-bed pitch
  setup      jsonb,                   -- head, gauge, material, pattern, calib at the time
  created_at timestamptz not null default now()
);

create index if not exists readings_racket_idx on readings (racket_id, taken_at);

create table if not exists plays (
  id         text primary key,        -- made on the phone, like readings
  racket_id  text not null references rackets(id) on delete cascade,
  played_on  date not null,
  minutes    integer not null,
  kind       text not null,           -- singles, doubles, hitting, drills, ball_machine, serves
  created_at timestamptz not null default now()
);

create index if not exists plays_racket_idx on plays (racket_id, played_on);

create table if not exists api_tokens (
  id           text primary key,      -- short public id, shown in the app so a link can be revoked
  token_hash   text not null unique,  -- sha256 of the secret; the secret itself is never stored
  user_id      text not null,
  label        text,
  timezone     text,                  -- the phone's time zone when the link was made, for "today"
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists api_tokens_user_idx on api_tokens (user_id);

-- 'mcp' links can read and write through the chat connector, 'calendar' links can only read the court calendar,
-- and 'gametime' links (the GameTime button) can only save court bookings.
alter table api_tokens add column if not exists scope text not null default 'mcp';

create table if not exists court_bookings (
  id          text primary key,       -- made on the phone or by the chat tool
  user_id     text not null,
  starts_at   timestamptz not null,
  minutes     integer not null,
  tz          text not null,          -- the club's time zone, for the day the play is logged on
  kind        text not null,          -- same types as plays
  court       text,                   -- e.g. Court 3
  location    text,                   -- club name, default Seattle Tennis Club
  note        text,                   -- partners, lesson pro, anything else
  ref         text,                   -- the club's booking or confirmation number
  racket_id   text references rackets(id) on delete set null,
  play_id     text,                   -- the play session logged once the booking ended
  cancelled   boolean not null default false,
  updated_at  timestamptz not null default now()
);

create index if not exists court_bookings_user_idx on court_bookings (user_id, starts_at);

create table if not exists string_jobs (
  id          text primary key,       -- made on the phone, like readings
  racket_id   text not null references rackets(id) on delete cascade,
  strung_on   date not null,
  ended_on    date not null,          -- the day these strings came out
  reason      text not null,          -- broke, dead, routine
  string_name text,
  material    text not null,
  gauge       real not null,
  strung_kg   real,
  created_at  timestamptz not null default now()
);

create index if not exists string_jobs_racket_idx on string_jobs (racket_id, ended_on);

-- Restring reminders: one row per phone that turned them on (a Web Push subscription).
create table if not exists push_subs (
  endpoint   text primary key,        -- the push service URL for that phone
  user_id    text not null,
  sub        jsonb not null,          -- endpoint plus the phone's encryption keys
  timezone   text,                    -- the phone's time zone, for "today"
  created_at timestamptz not null default now()
);

create index if not exists push_subs_user_idx on push_subs (user_id);

-- The last reminder sent for each racket, so a player hears once per stage (soon, then now) per set of strings.
create table if not exists reminders_sent (
  user_id   text not null,
  racket_id text not null,
  strung_on text not null,            -- the set of strings it was about
  status    text not null,            -- soon or now
  sent_at   timestamptz not null default now(),
  primary key (user_id, racket_id)
);

-- Server keys made on first use (the Web Push VAPID key pair), so reminders need no setup.
create table if not exists app_keys (
  name  text primary key,
  value text not null
);

create table if not exists shoes (
  id          text primary key,       -- made on the phone
  user_id     text not null,
  name        text not null,          -- e.g. NB 996v6 2E
  started_on  date not null,          -- first day in use
  retired_on  date,                   -- day they were replaced, null while in use
  life_hours  integer not null default 60,
  updated_at  timestamptz not null default now()
);

create index if not exists shoes_user_idx on shoes (user_id);

create table if not exists players (
  user_id    text primary key,        -- Neon Auth user id
  level      text,                    -- e.g. 3.5 (NTRP)
  style      text,                    -- heavy_spin, moderate_spin, flat, all_court, serve_volley, counter
  updated_at timestamptz not null default now()
);

-- How far ahead the club opens court booking: book_days before the day, at book_time (club time).
alter table players add column if not exists book_days integer;
alter table players add column if not exists book_time text;

-- Regular weekly court times the player wants to claim ("Tue 6 pm, indoor, with Marc").
create table if not exists court_plans (
  id          text primary key,       -- made on the phone
  user_id     text not null,
  dow         integer not null,       -- 0 Sunday .. 6 Saturday
  start_time  text not null,          -- HH:MM, club time
  minutes     integer not null,
  area        text not null,          -- indoor, outdoor, clay or any
  court       text,                   -- favourite court, e.g. Court 15
  kind        text not null,
  note        text,                   -- partner, anything else
  updated_at  timestamptz not null default now()
);

create index if not exists court_plans_user_idx on court_plans (user_id);
alter table court_plans add column if not exists backups text;            -- other courts to try, in order: "Court 15, Court 14"
alter table court_plans add column if not exists paused boolean not null default false;

-- Open court slots the GameTime button saw on the player's last visit (free or taken only, never who
-- booked), so the app and a chat assistant can say what's open without the player on GameTime.
create table if not exists court_open (
  user_id    text not null,
  day        date not null,
  slots      jsonb not null,          -- [{ c: court name, i: GameTime court id, t: start minute, d: minutes }]
  scanned_at timestamptz not null,
  primary key (user_id, day)
);
`;

// Comments are stripped before splitting, so a ";" in a comment can't cut a statement in two.
const statements = () => SCHEMA.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);

let ready = null;
export function ensureSchema(db) {
  if (!ready) ready = db.transaction(statements().map((s) => [s, []])).catch((e) => { ready = null; throw e; });
  return ready;
}
export function resetSchemaCache() { ready = null; }
