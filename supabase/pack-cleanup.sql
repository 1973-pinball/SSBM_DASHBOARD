-- SSBM Stats legacy storage cleanup (DESTRUCTIVE).
--
-- Do NOT run this with the initial migration. Run it only after:
--   1. schema.sql and pack-migration.sql completed;
--   2. both verification counts in pack-verify.sql matched;
--   3. the packed-storage client was deployed and a cloud restore was tested;
--   4. you explicitly intend to remove the legacy row-per-game copy.
--
-- TRUNCATE is what actually returns the ~767 MB legacy table allocation. The
-- old table stays present and readable-but-empty so a stale browser fails its
-- write safely instead of recreating hundreds of thousands of rows.

begin;
set local statement_timeout = '15min';
set local lock_timeout = '2min';

-- Prevent an old service-worker bundle from refilling the legacy table after
-- it has been emptied. SELECT remains for a clear empty response; writes fail
-- RLS until that browser receives the packed-sync client.
drop policy if exists "own records insert" on public.game_records;
drop policy if exists "own records update" on public.game_records;
drop policy if exists "own records delete" on public.game_records;

-- Hold out old-client writes, copy anything that landed after the first
-- migration, and verify the copy while the lock is still held. If verification
-- fails, the exception rolls this entire transaction back before TRUNCATE.
lock table public.game_records in access exclusive mode;

do $$
declare
  candidate_user uuid;
begin
  for candidate_user in
    select distinct user_id from public.game_records order by user_id
  loop
    perform public.migrate_legacy_game_records_to_packs(candidate_user);
  end loop;
end;
$$;

do $$
declare
  missing_count bigint;
begin
  select count(*) into missing_count
  from public.game_records legacy
  left join public.game_record_packs packed
    on packed.user_id = legacy.user_id
   and packed.bucket = public.game_record_bucket(coalesce(legacy.game_key, legacy.id))
  where packed.user_id is null
     or not (packed.records ? coalesce(legacy.game_key, legacy.id));

  if missing_count <> 0 then
    raise exception 'Cleanup stopped: % legacy games are missing from packs', missing_count;
  end if;
end;
$$;

drop trigger if exists community_dirty_game_records on public.game_records;
drop trigger if exists community_dirty_game_records_insert on public.game_records;
drop trigger if exists community_dirty_game_records_update on public.game_records;
drop trigger if exists community_dirty_game_records_delete on public.game_records;
drop trigger if exists game_records_touch_updated_at on public.game_records;

truncate table public.game_records;

drop index if exists public.game_records_played_at_idx;
drop index if exists public.game_records_game_key_idx;
drop index if exists public.game_records_updated_at_idx;

analyze public.game_record_packs;

commit;

select
  pg_size_pretty(pg_database_size(current_database())) as database_size_after_cleanup,
  pg_size_pretty(pg_total_relation_size('public.game_record_packs')) as packed_records_size,
  (select count(*) from public.game_records) as legacy_rows_remaining,
  (
    select coalesce(sum(record_count.games), 0)
    from public.game_record_packs packs
    cross join lateral (
      select count(*)::bigint as games
      from jsonb_object_keys(packs.records)
    ) record_count
  ) as packed_games;
