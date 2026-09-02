-- Existing-project upgrade for the Community per-user rollup.
--
-- The original plan materialized each wide GameRecord (including moveStats)
-- once for every lookback period, then expanded the move table in every copy.
-- A large contributor could therefore exhaust the database disk with
-- pgsql_tmp files. This patch preserves the rollup payload while materializing
-- only narrow lookback rows and collapsing each game's move table once.
--
-- Run this once in the Supabase SQL editor, then run the manual refresh shown
-- at the bottom. It is idempotent and does not touch private game data, cached
-- rollups, the dirty-user queue, or the public snapshot.

begin;
set local statement_timeout = '5min';
set local lock_timeout = '30s';

do $migration$
declare
  rollup_oid regprocedure;
  rollup_definition text;
  old_pack_source text := $old_pack_source$from public.game_record_packs packs
    cross join lateral jsonb_each(packs.records) entry
  ) g$old_pack_source$;
  new_pack_source text := $new_pack_source$from public.game_record_packs packs
    cross join lateral jsonb_each(packs.records) entry
    where packs.user_id = target_user
  ) g$new_pack_source$;
  old_eligible text := $old_eligible$eligible as (
  select$old_eligible$;
  new_eligible text := $new_eligible$-- This source is used once for scalar stats and once for moves. Inlining makes
-- PostgreSQL project only the fields each path needs instead of spooling the
-- full GameRecord JSON between them.
eligible as not materialized (
  select$new_eligible$;
  old_dedupe text := $old_dedupe$deduped as (
  select distinct on (user_id, private_game_key, own_side->>'connectCode') *
  from eligible
  order by user_id, private_game_key, own_side->>'connectCode'
),
base as materialized ($old_dedupe$;
  new_dedupe text := $new_dedupe$-- All writers place a content-derived game key in its deterministic bucket.
-- A JSON object has unique keys, so normal packed data has no duplicate row to
-- remove here; sorting the full payload through DISTINCT only creates a large
-- temporary file left over from the legacy row-table plan.
base as materialized ($new_dedupe$;
  old_base_move text := $old_base_move$    nullif(own_side->>'damagePerOpening', '')::numeric as damage_per_opening,
    nullif(own_side->>'inputsPerMinute', '')::numeric as inputs_per_minute,
    coalesce(own_side->'moveStats', '{}'::jsonb) as move_stats$old_base_move$;
  new_base_move text := $new_base_move$    nullif(own_side->>'damagePerOpening', '')::numeric as damage_per_opening,
    nullif(own_side->>'inputsPerMinute', '')::numeric as inputs_per_minute$new_base_move$;
  old_window text := $old_window$windowed as materialized (
  select b.*, p.lookback_days$old_window$;
  new_window text := $new_window$-- Keep this materialized because five downstream aggregates reuse it, but do
-- not carry move_stats through it. That JSON is by far the widest value in a
-- game row; copying it into every lookback cohort can fill pgsql_tmp for a
-- large library before any aggregate is produced.
windowed as materialized (
  select
    p.lookback_days,
    b.character_id,
    b.opponent_character_id,
    b.stage_id,
    b.game_type,
    b.win,
    b.l_cancel_success,
    b.l_cancel_fail,
    b.has_techs,
    b.tech_in_place,
    b.tech_in,
    b.tech_away,
    b.tech_missed$new_window$;
  old_move_start text := $old_move_start$move_per_game as (
  select
    b.lookback_days,
    b.private_game_key,
    b.character_id,$old_move_start$;
  new_move_start text := $new_move_start$-- Collapse raw action ids into the public move categories once per game. The
-- old plan crossed games with all five periods before jsonb_each(), expanding
-- and grouping the same move table up to five times. Only these narrow rows
-- need to be copied into the lookback cohorts.
move_per_game_base as (
  select
    (b.data->>'playedAt')::timestamptz as played_at,
    b.private_game_key,
    (b.own_side->>'characterId')::int as character_id,$new_move_start$;
  old_move_end text := $old_move_end$  from windowed b
  cross join lateral jsonb_each(b.move_stats) m
  group by b.lookback_days, b.private_game_key, b.character_id, move_key
),
move_rollup as ($old_move_end$;
  new_move_end text := $new_move_end$  from eligible b
  cross join lateral jsonb_each(coalesce(b.own_side->'moveStats', '{}'::jsonb)) m
  group by (b.data->>'playedAt')::timestamptz, b.private_game_key,
           (b.own_side->>'characterId')::int, move_key
),
move_per_game as (
  select
    p.lookback_days,
    m.private_game_key,
    m.character_id,
    m.move_key,
    m.landed,
    m.damage,
    m.kills,
    m.kill_pct_sum,
    m.openings,
    m.opening_damage,
    m.l_cancel_success,
    m.l_cancel_fail,
    m.attempts,
    m.has_attempts
  from move_per_game_base m
  cross join periods p
  where p.lookback_days is null
     or m.played_at >= (
       ((now() at time zone 'UTC')::date - p.lookback_days)::timestamp at time zone 'UTC'
     )
),
move_rollup as ($new_move_end$;
begin
  rollup_oid := to_regprocedure('public.refresh_community_user_rollup(uuid)');
  if rollup_oid is null then
    raise exception 'Community functions are missing; run the full community.sql first';
  end if;

  select pg_get_functiondef(rollup_oid) into rollup_definition;

  if strpos(rollup_definition, 'from public.game_record_packs packs') = 0 then
    raise exception 'Packed Community rollup is not installed; run community-pack-upgrade.sql first';
  elsif strpos(rollup_definition, 'move_per_game_base as (') > 0
     and strpos(rollup_definition, old_dedupe) = 0 then
    raise notice 'Community rollup is already temp-disk optimized';
  elsif strpos(rollup_definition, old_eligible) = 0
     or strpos(rollup_definition, old_dedupe) = 0
     or strpos(rollup_definition, old_base_move) = 0
     or strpos(rollup_definition, old_window) = 0
     or strpos(rollup_definition, old_move_start) = 0
     or strpos(rollup_definition, old_move_end) = 0 then
    raise exception 'Unrecognized Community rollup definition; stopping without changes';
  else
    if strpos(rollup_definition, new_pack_source) = 0 then
      if strpos(rollup_definition, old_pack_source) = 0 then
        raise exception 'Unrecognized packed Community source; stopping without changes';
      end if;
      rollup_definition := replace(rollup_definition, old_pack_source, new_pack_source);
    end if;
    rollup_definition := replace(rollup_definition, old_eligible, new_eligible);
    rollup_definition := replace(rollup_definition, old_dedupe, new_dedupe);
    rollup_definition := replace(rollup_definition, '  from deduped', '  from eligible');
    rollup_definition := replace(rollup_definition, old_base_move, new_base_move);
    rollup_definition := replace(rollup_definition, old_window, new_window);
    rollup_definition := replace(rollup_definition, old_move_start, new_move_start);
    rollup_definition := replace(rollup_definition, old_move_end, new_move_end);

    if strpos(rollup_definition, 'move_per_game_base as (') = 0
       or strpos(rollup_definition, new_pack_source) = 0
       or strpos(rollup_definition, old_eligible) > 0
       or strpos(rollup_definition, old_dedupe) > 0
       or strpos(rollup_definition, '  from deduped') > 0
       or strpos(rollup_definition, old_base_move) > 0
       or strpos(rollup_definition, old_window) > 0
       or strpos(rollup_definition, old_move_start) > 0
       or strpos(rollup_definition, old_move_end) > 0 then
      raise exception 'Community rollup rewrite did not apply cleanly; stopping without changes';
    end if;

    execute rollup_definition;
  end if;
end;
$migration$;

revoke all on function public.refresh_community_user_rollup(uuid) from public, anon, authenticated;

commit;

select strpos(
  pg_get_functiondef('public.refresh_community_user_rollup(uuid)'::regprocedure),
  'move_per_game_base as ('
) > 0 as temp_disk_optimization_installed;

-- After the result above is true, run the refresh as a separate SQL query:
--
-- begin;
-- set local statement_timeout = '15min';
-- set local work_mem = '128MB';
-- select public.refresh_community_snapshot();
-- commit;
