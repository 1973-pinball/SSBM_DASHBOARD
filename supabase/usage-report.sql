-- Read-only Supabase usage diagnostics for SSBM Stats.
-- Run in Dashboard -> SQL Editor before any cleanup or plan change.

-- Total table/index footprint. game_records is the private per-game mirror;
-- community_user_rollups and community_snapshot are compact derived data.
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

-- Logical payload size versus row count. PostgreSQL/TOAST storage and indexes
-- make the physical footprint above the authoritative billing figure.
select
  count(*) as games,
  pg_size_pretty(coalesce(sum(pg_column_size(data)), 0)) as jsonb_payload,
  pg_size_pretty(coalesce(avg(pg_column_size(data)), 0)::bigint) as avg_game_payload
from public.game_records;

-- Largest private libraries. The dashboard owner can use auth.users to map an
-- id to an account when support requires it; this report does not expose email.
select
  user_id,
  count(*) as games,
  pg_size_pretty(sum(pg_column_size(data))) as jsonb_payload,
  min(played_at) as first_game,
  max(played_at) as latest_game
from public.game_records
group by user_id
order by sum(pg_column_size(data)) desc;

-- Extra rows a moved/copied folder may have duplicated before game_key existed.
select coalesce(sum(copies - 1), 0) as duplicate_rows
from (
  select count(*) as copies
  from public.game_records
  where game_key is not null
  group by user_id, game_key
  having count(*) > 1
) duplicate_games;

-- Pre-current payloads that a reparse can replace. Keep this value aligned
-- with CURRENT_STATS_VERSION in src/lib/types.ts (currently 1).
select count(*) as stale_game_rows
from public.game_records
where coalesce((data->>'statsVersion')::int, 0) <> 1;

-- Indexes with no recorded scans may be cleanup candidates, but do not drop
-- one from this report alone: counters reset after a database restart.
select
  indexrelname as index_name,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
where schemaname = 'public'
order by pg_relation_size(indexrelid) desc;
