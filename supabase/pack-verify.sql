-- SSBM Stats packed-copy verification (READ-ONLY).
-- Run only after pack-migration.sql reports users_remaining = 0.

set statement_timeout = '15min';

-- Verification 1: this must return 0. The state row is inserted in the same
-- transaction as that user's packed copy, so it cannot acknowledge a failed
-- migration. This avoids a long per-game JSON lookup through the dashboard API.
select count(*) as migration_users_remaining
from (
  select distinct legacy.user_id
  from public.game_records legacy
  left join public.game_record_pack_migration_state state using (user_id)
  where state.user_id is null
) pending;

-- Verification 2: both maps are built from the same grouped rows and therefore
-- must have the same number of keys. This inspects at most 256 small rows/user.
select count(*) as packs_with_mismatched_maps
from public.game_record_packs packed
where (select count(*) from jsonb_object_keys(packed.records))
   <> (select count(*) from jsonb_object_keys(packed.versions));

-- Verification 3: inspect the compressed replacement footprint. It can take
-- a minute for dashboard usage charts to catch up after the later cleanup.
select
  pg_size_pretty(pg_total_relation_size('public.game_record_packs')) as packed_total_size,
  count(*) as pack_rows,
  coalesce(sum(record_count.games), 0) as packed_games
from public.game_record_packs packs
cross join lateral (
  select count(*)::bigint as games
  from jsonb_object_keys(packs.records)
) record_count;
