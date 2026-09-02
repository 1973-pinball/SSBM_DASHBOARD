-- SSBM Stats cloud sync schema.
-- Paste into the Supabase SQL editor (Dashboard → SQL Editor → New query → Run).
-- Safe to re-run: every statement is idempotent, so this doubles as the migration
-- path when the schema gains something. Policies are dropped and recreated rather
-- than guarded, because Postgres has no `create policy if not exists`.
-- Stores only the flattened per-game metadata the app already keeps in IndexedDB —
-- never raw .slp replay files. Current clients store those records in compressed
-- JSONB packs. The legacy row-per-game table remains temporarily so an existing
-- project can copy and verify its data before reclaiming that storage.

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
alter table public.game_records add column if not exists updated_at timestamptz not null default now();

-- Incremental clients use this server timestamp as their pull cursor. An
-- upsert that refreshes a stale stats payload must move the row past every
-- device's prior cursor; inserts receive the column default above.
create or replace function public.touch_game_record_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists game_records_touch_updated_at on public.game_records;
create trigger game_records_touch_updated_at
before update on public.game_records
for each row execute function public.touch_game_record_updated_at();

-- Older schemas created played_at, game_key, and updated_at indexes here.
-- Packed sync needs none of them; keep existing copies through verification and
-- let pack-cleanup.sql drop them with the legacy data instead of recreating
-- ~85 MB of indexes on a cleaned project.

-- Cloud records are content-keyed and spread deterministically across 256
-- buckets per user. PostgreSQL can TOAST-compress the repeated GameRecord field
-- names across a whole bucket, while the primary-key/index overhead is paid once
-- per pack instead of once per replay. `versions` is a compact metadata mirror:
-- normal sync can diff keys without downloading every full record.
create table if not exists public.game_record_packs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bucket smallint not null check (bucket between 0 and 255),
  records jsonb not null default '{}'::jsonb check (jsonb_typeof(records) = 'object'),
  versions jsonb not null default '{}'::jsonb check (jsonb_typeof(versions) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket)
);

-- Resumable one-time migration bookkeeping. This table is never exposed to the
-- browser; it records which users completed a bounded legacy-copy statement so
-- a full 767 MB source is never sorted into one pgsql_tmp file.
create table if not exists public.game_record_pack_migration_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  completed_at timestamptz not null default now()
);

-- FNV-1a's low byte. The browser uses the identical byte loop so an initial
-- upload can keep every bucket in one request and avoid repeatedly rewriting a
-- growing compressed pack. UTF-8 bytes make the function exact for any future
-- non-ASCII content key too.
create or replace function public.game_record_bucket(game_key text)
returns smallint
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  bytes bytea := convert_to(game_key, 'UTF8');
  hash_byte integer := 197; -- 2166136261 mod 256
  i integer;
begin
  if length(bytes) = 0 then return hash_byte::smallint; end if;
  for i in 0 .. length(bytes) - 1 loop
    hash_byte := ((hash_byte # get_byte(bytes, i)) * 147) % 256; -- 16777619 mod 256
  end loop;
  return hash_byte::smallint;
end;
$$;

-- Atomic, version-aware merge used by the browser. Direct writes to packs are
-- intentionally not exposed: two devices can update one bucket concurrently,
-- and a client-side read/modify/write would let the last writer erase the
-- other's games. Lower-version payloads can never overwrite current stats.
create or replace function public.merge_game_record_entries(entries jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  merged_count integer := 0;
  locked_bucket smallint;
begin
  if owner_id is null then
    raise exception 'authentication required';
  end if;
  if jsonb_typeof(entries) is distinct from 'array' then
    raise exception 'entries must be a JSON array';
  end if;

  -- Serialize only calls touching the same user's same buckets. Sorting the
  -- lock order prevents two multi-bucket requests from deadlocking; taking the
  -- locks before the merge also closes the stale-version ON CONFLICT race.
  for locked_bucket in
    select distinct public.game_record_bucket(item->>'game_key')
    from jsonb_array_elements(entries) incoming(item)
    where length(item->>'game_key') > 0
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(owner_id::text), locked_bucket);
  end loop;

  with raw as (
    select item, ord
    from jsonb_array_elements(entries) with ordinality incoming(item, ord)
  ),
  parsed as (
    select
      item->>'game_key' as game_key,
      item->'data' as data,
      case
        when (item->>'stats_version') ~ '^[0-9]+$' then (item->>'stats_version')::integer
        else 0
      end as stats_version,
      ord
    from raw
    where length(item->>'game_key') > 0
      and jsonb_typeof(item->'data') = 'object'
  ),
  incoming as (
    select distinct on (game_key)
      game_key,
      data,
      stats_version,
      public.game_record_bucket(game_key) as bucket
    from parsed
    order by game_key, stats_version desc, ord desc
  ),
  eligible as (
    select incoming.*
    from incoming
    left join public.game_record_packs stored
      on stored.user_id = owner_id and stored.bucket = incoming.bucket
    where stored.user_id is null
       or not (stored.versions ? incoming.game_key)
       or incoming.stats_version > (stored.versions->>incoming.game_key)::integer
  ),
  grouped as (
    select
      bucket,
      jsonb_object_agg(game_key, data) as records,
      jsonb_object_agg(game_key, to_jsonb(stats_version)) as versions
    from eligible
    group by bucket
  ),
  upserted as (
    insert into public.game_record_packs as stored (user_id, bucket, records, versions, updated_at)
    select owner_id, bucket, records, versions, clock_timestamp()
    from grouped
    on conflict (user_id, bucket) do update set
      records = stored.records || excluded.records,
      versions = stored.versions || excluded.versions,
      updated_at = clock_timestamp()
    returning 1
  )
  select count(*) into merged_count from eligible;

  return merged_count;
end;
$$;

-- Admin-only copier used before rollout and once more under an exclusive lock
-- during cleanup. It is deliberately non-destructive and skips keys already
-- packed at the same/newer payload version, so reruns do not rewrite hundreds
-- of megabytes or generate needless WAL.
drop function if exists public.migrate_legacy_game_records_to_packs();
create or replace function public.migrate_legacy_game_records_to_packs(target_user uuid)
returns bigint
language sql
security definer
set search_path = public, pg_temp
as $$
with source_rows as (
  select
    g.user_id,
    coalesce(g.game_key, g.id) as game_key,
    g.data,
    case
      when (g.data->>'statsVersion') ~ '^[0-9]+$' then (g.data->>'statsVersion')::integer
      when jsonb_typeof(g.data->'players') = 'array'
        and jsonb_array_length(g.data->'players') > 0
        and not (g.data ? 'statsLevel')
        and not (g.data ? 'parseError')
        and not exists (
          select 1
          from jsonb_array_elements(g.data->'players') player
          where not (player ? 'techs')
        ) then 1
      else 0
    end as stats_version,
    public.game_record_bucket(coalesce(g.game_key, g.id)) as bucket,
    g.updated_at,
    g.id
  from public.game_records g
  where g.user_id = target_user
),
eligible as (
  select source.*
  from source_rows source
  left join public.game_record_packs packed
    on packed.user_id = source.user_id and packed.bucket = source.bucket
  where packed.user_id is null
     or not (packed.versions ? source.game_key)
     or source.stats_version > (packed.versions->>source.game_key)::integer
),
grouped as (
  select
    user_id,
    bucket,
    -- Duplicate legacy keys collapse here. Highest payload version/latest
    -- update wins; lowest file id wins the final deterministic tie, matching
    -- the client deduper without paying for a second full-table sort.
    jsonb_object_agg(game_key, data order by stats_version, updated_at, id desc) as records,
    jsonb_object_agg(game_key, to_jsonb(stats_version) order by stats_version, updated_at, id desc) as versions
  from eligible
  group by user_id, bucket
),
upserted as (
  insert into public.game_record_packs as packed (user_id, bucket, records, versions, updated_at)
  select user_id, bucket, records, versions, clock_timestamp()
  from grouped
  on conflict (user_id, bucket) do update set
    records = packed.records || excluded.records,
    versions = packed.versions || excluded.versions,
    updated_at = clock_timestamp()
  returning 1
)
select count(*)::bigint from eligible;
$$;

-- Process only a handful of users per statement. Each inner migration releases
-- its aggregate/sort workspace before the next user begins, while the state row
-- makes rerunning pack-migration.sql resume rather than start over.
create or replace function public.migrate_legacy_game_record_batch(max_users integer default 1)
returns table (users_migrated integer, games_copied_or_upgraded bigint, users_remaining bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate_user uuid;
  copied bigint;
begin
  if max_users < 1 or max_users > 20 then
    raise exception 'max_users must be between 1 and 20';
  end if;

  users_migrated := 0;
  games_copied_or_upgraded := 0;
  for candidate_user in
    select distinct legacy.user_id
    from public.game_records legacy
    left join public.game_record_pack_migration_state state using (user_id)
    where state.user_id is null
    order by legacy.user_id
    limit max_users
  loop
    copied := public.migrate_legacy_game_records_to_packs(candidate_user);
    insert into public.game_record_pack_migration_state (user_id, completed_at)
    values (candidate_user, clock_timestamp())
    on conflict (user_id) do update set completed_at = excluded.completed_at;
    users_migrated := users_migrated + 1;
    games_copied_or_upgraded := games_copied_or_upgraded + copied;
  end loop;

  select count(*) into users_remaining
  from (
    select distinct legacy.user_id
    from public.game_records legacy
    left join public.game_record_pack_migration_state state using (user_id)
    where state.user_id is null
  ) pending;
  return next;
end;
$$;

-- One row per Slippi account the user plays on. sort_order fixes the display
-- order (the first account is the primary shown on the player card); label is
-- the human name — "Main", "Alt" — rendered as "Main (ABCD#123)" wherever an
-- account is offered.
--
-- This replaced an earlier public.user_settings (user_id, my_codes text[]),
-- which held one bare array per user and had nowhere to put a label. The app no
-- longer reads or writes it. If your project still has that table, the backfill
-- below has already copied its contents here, and once every browser has picked
-- up a build from 2026-08-17 or later you can retire it:
--
--   drop table if exists public.user_settings;
--
create table if not exists public.user_codes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code text not null,
  label text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);

-- Backfill from the single-code era, for a project that predates user_codes.
-- Ordinality keeps the old array order. Guarded so this file still runs on a
-- fresh project, where user_settings was never created in the first place.
do $$
begin
  if to_regclass('public.user_settings') is not null then
    insert into public.user_codes (user_id, code, sort_order)
      select s.user_id, c.code, c.ord - 1
      from public.user_settings s,
           lateral unnest(s.my_codes) with ordinality as c(code, ord)
      on conflict (user_id, code) do nothing;
  end if;
end $$;

-- Row-level security: every user sees exactly their own rows.
alter table public.game_records enable row level security;
alter table public.game_record_packs enable row level security;
alter table public.game_record_pack_migration_state enable row level security;
alter table public.user_codes enable row level security;

drop policy if exists "own records select" on public.game_records;
create policy "own records select" on public.game_records
  for select using (auth.uid() = user_id);
-- Do not recreate legacy write policies here. Existing projects retain them
-- until pack-cleanup.sql runs, so the currently deployed row-sync client keeps
-- working during migration. Fresh projects need only the packed RPC, and a
-- cleaned project must not let a stale service worker refill this table.

drop policy if exists "own record packs select" on public.game_record_packs;
create policy "own record packs select" on public.game_record_packs
  for select using (auth.uid() = user_id);

revoke all on function public.game_record_bucket(text) from public, anon, authenticated;
revoke all on function public.merge_game_record_entries(jsonb) from public, anon;
revoke all on function public.migrate_legacy_game_records_to_packs(uuid) from public, anon, authenticated;
revoke all on function public.migrate_legacy_game_record_batch(integer) from public, anon, authenticated;
revoke all on public.game_record_pack_migration_state from public, anon, authenticated;
grant execute on function public.merge_game_record_entries(jsonb) to authenticated;
grant select on public.game_record_packs to authenticated;

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
