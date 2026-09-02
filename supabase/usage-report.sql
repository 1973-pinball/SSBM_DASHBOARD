-- Read-only Supabase usage diagnostics for SSBM Stats.
-- Run in Dashboard -> SQL Editor before any cleanup or plan change.

-- Total table/index footprint. game_record_packs is the current private mirror;
-- game_records is the temporary legacy copy until pack-cleanup.sql is run.
select
  c.relname as relation,
  pg_size_pretty(pg_relation_size(c.oid)) as table_size,
  pg_size_pretty(pg_indexes_size(c.oid)) as index_size,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;

-- Packed logical count and payload. PostgreSQL/TOAST compression means the
-- physical footprint above remains the authoritative billing figure.
select
  count(*) as packs,
  coalesce(sum(record_count.games), 0) as games,
  pg_size_pretty(coalesce(sum(pg_column_size(records)), 0)) as packed_jsonb_payload
from public.game_record_packs packs
cross join lateral (
  select count(*)::bigint as games
  from jsonb_object_keys(packs.records)
) record_count;

-- Largest private libraries. This report deliberately does not expose email.
select
  user_id,
  sum(record_count.games) as games,
  count(*) as packs,
  pg_size_pretty(sum(pg_column_size(records))) as packed_jsonb_payload
from public.game_record_packs packs
cross join lateral (
  select count(*)::bigint as games
  from jsonb_object_keys(packs.records)
) record_count
group by user_id
order by sum(pg_column_size(records)) desc;

-- Extra rows a moved/copied folder may have duplicated before game_key existed.
select coalesce(sum(copies - 1), 0) as duplicate_rows
from (
  select count(*) as copies
  from public.game_records
  where game_key is not null
  group by user_id, game_key
  having count(*) > 1
) duplicate_games;

-- Pre-current packed payloads that a reparse can replace. Keep this value
-- aligned with CURRENT_STATS_VERSION in src/lib/types.ts (currently 1).
select count(*) as stale_packed_games
from public.game_record_packs packs
cross join lateral jsonb_each_text(packs.versions) version
where version.value::integer <> 1;

-- Indexes with no recorded scans may be cleanup candidates, but do not drop
-- one from this report alone: counters reset after a database restart.
select
  indexrelname as index_name,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
where schemaname = 'public'
order by pg_relation_size(indexrelid) desc;
