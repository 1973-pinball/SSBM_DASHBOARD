-- SSBM Dashboard cloud sync schema.
-- Paste into the Supabase SQL editor (Dashboard → SQL Editor → New query → Run).
-- Safe to re-run: every statement is idempotent, so this doubles as the migration
-- path when the schema gains something. Policies are dropped and recreated rather
-- than guarded, because Postgres has no `create policy if not exists`.
-- Stores only the flattened per-game metadata the app already keeps in IndexedDB —
-- never raw .slp replay files.

create table if not exists public.game_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null, -- app-side key: path|size|mtime
  data jsonb not null, -- the full GameRecord as stored locally
  played_at timestamptz, -- denormalized from data for range queries
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Content-derived identity for the same game (see src/lib/dedupe.ts). The
-- primary key is file-derived, so a copied, re-organized, or cloud-synced
-- replay folder yields a second row for a game already here. Pushes skip a
-- record whose game_key is already present, which keeps those copies out.
alter table public.game_records add column if not exists game_key text;

create index if not exists game_records_played_at_idx
  on public.game_records (user_id, played_at desc);
create index if not exists game_records_game_key_idx
  on public.game_records (user_id, game_key);

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  my_codes text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- One row per Slippi account the user plays on. Supersedes user_settings.my_codes,
-- which is still written for one release so an older tab doesn't lose its identity.
-- sort_order fixes the display order (the first account is the primary shown on
-- the player card); label is the human name — "Main", "Alt" — rendered as
-- "Main (ABCD#123)" wherever an account is offered.
create table if not exists public.user_codes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code text not null,
  label text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);

-- Backfill from the single-code era. Ordinality keeps the old array order.
insert into public.user_codes (user_id, code, sort_order)
  select s.user_id, c.code, c.ord - 1
  from public.user_settings s,
       lateral unnest(s.my_codes) with ordinality as c(code, ord)
  on conflict (user_id, code) do nothing;

-- Row-level security: every user sees exactly their own rows.
alter table public.game_records enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_codes enable row level security;

drop policy if exists "own records select" on public.game_records;
create policy "own records select" on public.game_records
  for select using (auth.uid() = user_id);
drop policy if exists "own records insert" on public.game_records;
create policy "own records insert" on public.game_records
  for insert with check (auth.uid() = user_id);
drop policy if exists "own records update" on public.game_records;
create policy "own records update" on public.game_records
  for update using (auth.uid() = user_id);
drop policy if exists "own records delete" on public.game_records;
create policy "own records delete" on public.game_records
  for delete using (auth.uid() = user_id);

drop policy if exists "own settings select" on public.user_settings;
create policy "own settings select" on public.user_settings
  for select using (auth.uid() = user_id);
drop policy if exists "own settings insert" on public.user_settings;
create policy "own settings insert" on public.user_settings
  for insert with check (auth.uid() = user_id);
drop policy if exists "own settings update" on public.user_settings;
create policy "own settings update" on public.user_settings
  for update using (auth.uid() = user_id);
drop policy if exists "own settings delete" on public.user_settings;
create policy "own settings delete" on public.user_settings
  for delete using (auth.uid() = user_id);

drop policy if exists "own codes select" on public.user_codes;
create policy "own codes select" on public.user_codes
  for select using (auth.uid() = user_id);
drop policy if exists "own codes insert" on public.user_codes;
create policy "own codes insert" on public.user_codes
  for insert with check (auth.uid() = user_id);
drop policy if exists "own codes update" on public.user_codes;
create policy "own codes update" on public.user_codes
  for update using (auth.uid() = user_id);
drop policy if exists "own codes delete" on public.user_codes;
create policy "own codes delete" on public.user_codes
  for delete using (auth.uid() = user_id);

-- Optional one-shot: give rows pushed before game_key existed a key, so an
-- older library also stops re-uploading itself when the replay folder moves.
-- Safe to skip and safe to re-run — correctness does not depend on it, since
-- the app dedups on the record data itself at read time. This expression
-- mirrors gameKey() in src/lib/dedupe.ts; if the two ever drift, legacy rows
-- simply stop matching and get stored twice, which costs space, not accuracy.
update public.game_records set game_key = (
  (data->>'playedAt') || '|' || (data->>'stageId') || '|' || (
    select string_agg(side, '+' order by side)
    from (
      select coalesce(
               p->>'connectCode',
               'p' || (p->>'port') || ':' || (p->>'characterId')
             ) as side
      from jsonb_array_elements(data->'players') p
    ) sides
  )
)
where game_key is null and data->>'playedAt' is not null;

-- Optional cleanup, DESTRUCTIVE — left commented out deliberately, so running
-- this file never deletes anything. Releases before the participation filter
-- pushed every parsed game, including other people's from a shared replay
-- folder. Those rows are invisible in the app (resolveGames drops them) but
-- still stored. To clear them, first see what would go:
--
--   select g.user_id, count(*) from public.game_records g
--   where exists (select 1 from public.user_codes c where c.user_id = g.user_id)
--     and not exists (
--       select 1 from jsonb_array_elements(g.data->'players') p
--       join public.user_codes c on c.user_id = g.user_id and c.code = p->>'connectCode')
--   group by g.user_id;
--
-- then swap `select ... group by` for `delete`. The first EXISTS is the safety
-- catch: without it, a user who has games but no registered codes yet would
-- match every row and lose their whole library. Add every account in the app
-- BEFORE running this — a code that isn't in user_codes reads as someone else.
--
-- delete from public.game_records g
-- where exists (select 1 from public.user_codes c where c.user_id = g.user_id)
--   and not exists (
--     select 1 from jsonb_array_elements(g.data->'players') p
--     join public.user_codes c on c.user_id = g.user_id and c.code = p->>'connectCode');
