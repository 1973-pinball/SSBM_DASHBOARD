-- Privacy-preserving Community Lab schema.
--
-- Run after schema.sql. Raw game_records stay behind their existing per-user
-- RLS policies. The browser can read only community_snapshot, a precomputed
-- aggregate with no user ids, connect codes, display names, paths, file ids, or
-- exact timestamps. Community contribution is a separate, default-off consent.

create table if not exists public.community_consent (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  consent_version text not null,
  updated_at timestamptz not null default now()
);

alter table public.community_consent enable row level security;

drop policy if exists "own community consent select" on public.community_consent;
create policy "own community consent select" on public.community_consent
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "own community consent insert" on public.community_consent;
create policy "own community consent insert" on public.community_consent
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "own community consent update" on public.community_consent;
create policy "own community consent update" on public.community_consent
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own community consent delete" on public.community_consent;
create policy "own community consent delete" on public.community_consent
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.community_consent to authenticated;

create table if not exists public.community_snapshot (
  snapshot_id text primary key default 'current' check (snapshot_id = 'current'),
  refreshed_at timestamptz not null default now(),
  contributor_count int not null default 0,
  player_game_count bigint not null default 0,
  min_contributors int not null default 25,
  min_games int not null default 100,
  payload jsonb not null default '{}'::jsonb
);

alter table public.community_snapshot enable row level security;

drop policy if exists "community aggregate read" on public.community_snapshot;
create policy "community aggregate read" on public.community_snapshot
  for select to anon, authenticated using (true);

grant select on public.community_snapshot to anon, authenticated;
revoke insert, update, delete on public.community_snapshot from anon, authenticated;

-- Publish-time coarsening.
--
-- The k-thresholds below protect any single snapshot; they do not protect a
-- sequence of them. This snapshot is world-readable and replaced on a schedule,
-- so an observer who archives each refresh can diff them, and a contributor
-- joining or leaving moves exact counts by a knowable amount -- which is what
-- attributes a delta to one person. Rounding published figures to a bucket puts
-- a single contributor beneath the resolution of the number, so the diff has
-- nothing to attribute.
--
-- Rates are rounded only to the precision the UI actually renders (pct() shows
-- one decimal), on the principle that a payload should not publish digits no
-- one is shown. That is hygiene, not protection: one game moves a 100-game cell
-- by a full point, which no display-precision rounding can hide. The bucketed
-- counts are what does the work, by hiding that the population changed at all.
--
-- So this raises the cost of the attack; it is not differential privacy and does
-- not claim to be. Refresh cadence is the other half: every refresh is another
-- observation, so publish as rarely as the view can tolerate.
create or replace function public.pub_bucket(value numeric, bucket numeric)
returns numeric
language sql
immutable
as $$ select case when value is null then null else round(value / bucket) * bucket end $$;

-- Rebuild the one public snapshot from consenting users' private rows. This is
-- intentionally a scheduled/admin operation, never a browser-callable RPC.
-- It counts only the consenting user's own player side for execution and move
-- benchmarks; opponent codes/names never enter an aggregate key.
create or replace function public.refresh_community_snapshot()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
with
params as (
  -- consent_version must match COMMUNITY_CONSENT_VERSION in src/lib/community.ts.
  -- Consent is gathered under specific published terms, so a row agreed under
  -- superseded terms must stop contributing until the user agrees again. Bump
  -- both constants together when the terms change; contributions then fail
  -- closed until each user re-consents, which is the safe direction.
  select 25::int as min_contributors, 100::int as min_games,
         '2026-08-24'::text as consent_version
),
eligible as (
  select
    g.user_id,
    coalesce(
      g.game_key,
      (g.data->>'playedAt') || '|' || (g.data->>'stageId') || '|' || (
        select string_agg(coalesce(p->>'connectCode', 'p' || (p->>'port') || ':' || (p->>'characterId')), '+' order by coalesce(p->>'connectCode', 'p' || (p->>'port') || ':' || (p->>'characterId')))
        from jsonb_array_elements(g.data->'players') p
      )
    ) as private_game_key,
    g.data,
    own.side as own_side,
    own.ord - 1 as own_index,
    opp.side as opp_side
  from public.game_records g
  cross join params
  join public.community_consent consent
    on consent.user_id = g.user_id
   and consent.enabled
   and consent.consent_version = params.consent_version
  cross join lateral (
    select p.side, p.ord
    from jsonb_array_elements(g.data->'players') with ordinality p(side, ord)
    join public.user_codes c on c.user_id = g.user_id and c.code = p.side->>'connectCode'
    order by p.ord
    limit 1
  ) own
  cross join lateral (
    select p.side
    from jsonb_array_elements(g.data->'players') with ordinality p(side, ord)
    where p.ord <> own.ord
    order by p.ord
    limit 1
  ) opp
  where coalesce((g.data->>'isTeams')::boolean, false) = false
    and jsonb_array_length(g.data->'players') = 2
    and not (g.data ? 'parseError')
    and (g.data->>'playedAt') is not null
    and (g.data->>'stageId')::int in (2, 3, 8, 28, 31, 32)
    -- A self-match has two owned codes and no meaningful personal result.
    and 1 = (
      select count(*)
      from jsonb_array_elements(g.data->'players') p
      join public.user_codes c on c.user_id = g.user_id and c.code = p->>'connectCode'
    )
),
deduped as (
  select distinct on (user_id, private_game_key, own_side->>'connectCode') *
  from eligible
  order by user_id, private_game_key, own_side->>'connectCode'
),
base as (
  select
    user_id,
    private_game_key,
    date_trunc('month', (data->>'playedAt')::timestamptz)::date as month,
    (data->>'durationFrames')::numeric / 60.0 as duration_seconds,
    (data->>'stageId')::int as stage_id,
    case when data->>'gameType' in ('ranked', 'unranked', 'direct', 'offline') then data->>'gameType' else 'unknown' end as game_type,
    (own_side->>'characterId')::int as character_id,
    (opp_side->>'characterId')::int as opponent_character_id,
    case
      when data->>'winnerIndex' is null then null
      when (data->>'winnerIndex')::int = own_index then 1
      else 0
    end as win,
    coalesce((own_side->>'lCancelSuccess')::numeric, 0) as l_cancel_success,
    coalesce((own_side->>'lCancelFail')::numeric, 0) as l_cancel_fail,
    own_side ? 'techs' as has_techs,
    coalesce((own_side->'techs'->>'inPlace')::numeric, 0) as tech_in_place,
    coalesce((own_side->'techs'->>'toward')::numeric, 0) as tech_in,
    coalesce((own_side->'techs'->>'away')::numeric, 0) as tech_away,
    coalesce((own_side->'techs'->>'missed')::numeric, 0) as tech_missed,
    nullif(own_side->>'openingsPerKill', '')::numeric as openings_per_kill,
    nullif(own_side->>'damagePerOpening', '')::numeric as damage_per_opening,
    nullif(own_side->>'inputsPerMinute', '')::numeric as inputs_per_minute,
    coalesce(own_side->'moveStats', '{}'::jsonb) as move_stats
  from deduped
),
active as (
  -- player_games is bucketed for the same reason every cell inside the payload
  -- is. These two columns are published even when the payload is empty (below
  -- min_contributors), so with a handful of contributors they were the ONLY
  -- thing on the wire -- and an exact pair is a differencing oracle: archive
  -- the snapshot every refresh, watch contributors go n -> n+1, and the
  -- player_games delta is that person's exact lifetime game count. Bucketing
  -- the count puts one contributor beneath the resolution of the number, which
  -- is the principle stated at the top of this file. contributor_count stays
  -- exact on purpose: alone it identifies nobody, and the Community tab renders
  -- it as an "n of 25 contributors" progress bar.
  select count(distinct user_id)::int as contributors,
         public.pub_bucket(count(*), 500)::bigint as player_games
  from base
),
matchup_rollup as (
  select
    character_id,
    opponent_character_id,
    coalesce(stage_id, 0)::int as stage_id,
    coalesce(game_type, 'all') as game_type,
    count(*)::int as games,
    count(distinct user_id)::int as contributors,
    sum(win)::int as wins
  from base, params
  where win is not null
  group by grouping sets (
    (character_id, opponent_character_id),
    (character_id, opponent_character_id, stage_id),
    (character_id, opponent_character_id, game_type),
    (character_id, opponent_character_id, stage_id, game_type)
  ), params.min_contributors, params.min_games
  having count(*) >= params.min_games and count(distinct user_id) >= params.min_contributors
),
benchmark_user as (
  select
    user_id,
    character_id,
    count(*)::int as games,
    case when sum(l_cancel_success + l_cancel_fail) > 0 then 100.0 * sum(l_cancel_success) / sum(l_cancel_success + l_cancel_fail) end as l_cancel,
    avg(openings_per_kill) as openings_per_kill,
    avg(damage_per_opening) as damage_per_opening,
    avg(inputs_per_minute) as inputs_per_minute
  from base
  group by user_id, character_id
  having count(*) >= 5
  union all
  select
    user_id,
    -1 as character_id,
    count(*)::int as games,
    case when sum(l_cancel_success + l_cancel_fail) > 0 then 100.0 * sum(l_cancel_success) / sum(l_cancel_success + l_cancel_fail) end,
    avg(openings_per_kill), avg(damage_per_opening), avg(inputs_per_minute)
  from base
  group by user_id
  having count(*) >= 5
),
benchmark_rollup as (
  -- percentile_cont has no numeric overload: Postgres coerces the numeric sort
  -- column to double precision and hands back double precision[]. round() then
  -- has no round(double precision, integer) to bind to, so the whole function
  -- fails to create. Casting the array back to numeric[] here fixes all twelve
  -- round() call sites at once rather than one at a time.
  select
    character_id,
    sum(games)::int as games,
    count(*)::int as contributors,
    case when count(l_cancel) >= params.min_contributors then
      (percentile_cont(array[0.25, 0.5, 0.75]) within group (order by l_cancel) filter (where l_cancel is not null))::numeric[]
    end as l_cancel_q,
    case when count(openings_per_kill) >= params.min_contributors then
      (percentile_cont(array[0.25, 0.5, 0.75]) within group (order by openings_per_kill) filter (where openings_per_kill is not null))::numeric[]
    end as opk_q,
    case when count(damage_per_opening) >= params.min_contributors then
      (percentile_cont(array[0.25, 0.5, 0.75]) within group (order by damage_per_opening) filter (where damage_per_opening is not null))::numeric[]
    end as dpo_q,
    case when count(inputs_per_minute) >= params.min_contributors then
      (percentile_cont(array[0.25, 0.5, 0.75]) within group (order by inputs_per_minute) filter (where inputs_per_minute is not null))::numeric[]
    end as ipm_q
  from benchmark_user, params
  group by character_id, params.min_contributors, params.min_games
  having count(*) >= params.min_contributors and sum(games) >= params.min_games
),
execution_rollup as (
  -- Tech counts arrived after the original cached stat shape. Excluding rows
  -- without the object keeps a legacy game from reading as a perfect zero-
  -- attempt game. Each visible cohort clears the same k/game thresholds as the
  -- rest of Community; the empty grouping is the deliberate overall row.
  select
    (case when grouping(character_id) = 1 then -1 else character_id end)::int as character_id,
    count(*)::int as games,
    count(distinct user_id)::int as contributors,
    case when sum(l_cancel_success + l_cancel_fail) > 0
      then 100.0 * sum(l_cancel_success) / sum(l_cancel_success + l_cancel_fail)
    end as l_cancel_success,
    case when sum(tech_in_place + tech_in + tech_away + tech_missed) > 0
      then 100.0 * sum(tech_in_place + tech_in + tech_away)
        / sum(tech_in_place + tech_in + tech_away + tech_missed)
    end as ground_tech_success,
    case when sum(tech_in_place + tech_in + tech_away) > 0
      then 100.0 * sum(tech_in_place) / sum(tech_in_place + tech_in + tech_away)
    end as ground_tech_in_place,
    case when sum(tech_in_place + tech_in + tech_away) > 0
      then 100.0 * sum(tech_in) / sum(tech_in_place + tech_in + tech_away)
    end as ground_tech_in,
    case when sum(tech_in_place + tech_in + tech_away) > 0
      then 100.0 * sum(tech_away) / sum(tech_in_place + tech_in + tech_away)
    end as ground_tech_away
  from base, params
  where has_techs and character_id between 0 and 25
  group by grouping sets ((character_id), ()), params.min_contributors, params.min_games
  having count(*) >= params.min_games and count(distinct user_id) >= params.min_contributors
),
character_totals as (
  select character_id, count(*)::int as games, count(distinct user_id)::int as contributors
  from base
  group by character_id
),
move_per_game as (
  select
    b.user_id,
    b.private_game_key,
    b.character_id,
    case
      when m.key::int in (2,3,4,5) then 'jab'
      when m.key::int = 6 then 'dash'
      when m.key::int = 7 then 'ftilt'
      when m.key::int = 8 then 'utilt'
      when m.key::int = 9 then 'dtilt'
      when m.key::int = 10 then 'fsmash'
      when m.key::int = 11 then 'usmash'
      when m.key::int = 12 then 'dsmash'
      when m.key::int = 13 then 'nair'
      when m.key::int = 14 then 'fair'
      when m.key::int = 15 then 'bair'
      when m.key::int = 16 then 'uair'
      when m.key::int = 17 then 'dair'
      when m.key::int = 18 then 'neutral-b'
      when m.key::int = 19 then 'side-b'
      when m.key::int = 20 then 'up-b'
      when m.key::int = 21 then 'down-b'
      when m.key::int in (50,51) then 'getup'
      when m.key::int = 52 then 'pummel'
      when m.key::int = 53 then 'fthrow'
      when m.key::int = 54 then 'bthrow'
      when m.key::int = 55 then 'uthrow'
      when m.key::int = 56 then 'dthrow'
      when m.key::int in (61,62) then 'edge'
      else 'other'
    end as move_key,
    sum(coalesce((m.value->>'landed')::numeric, 0)) as landed,
    sum(coalesce((m.value->>'damage')::numeric, 0)) as damage,
    sum(coalesce((m.value->>'kills')::numeric, 0)) as kills,
    sum(coalesce((m.value->>'killPctSum')::numeric, 0)) as kill_pct_sum,
    sum(coalesce((m.value->>'openings')::numeric, 0)) as openings,
    sum(coalesce((m.value->>'openingDmg')::numeric, 0)) as opening_damage,
    sum(coalesce((m.value->>'lcSuccess')::numeric, 0)) as l_cancel_success,
    sum(coalesce((m.value->>'lcFail')::numeric, 0)) as l_cancel_fail,
    sum((m.value->>'attempts')::numeric) filter (where m.value ? 'attempts') as attempts,
    bool_or(m.value ? 'attempts') as has_attempts
  from base b
  cross join lateral jsonb_each(b.move_stats) m
  group by b.user_id, b.private_game_key, b.character_id, move_key
),
move_rollup as (
  select
    m.character_id,
    m.move_key,
    c.games as character_games,
    count(distinct m.user_id)::int as contributors,
    sum(m.attempts) filter (where m.has_attempts) as attempts,
    count(*) filter (where m.has_attempts)::int as attempt_games,
    sum(m.landed) as landed,
    sum(m.damage) as damage,
    sum(m.kills) as kills,
    sum(m.kill_pct_sum) as kill_pct_sum,
    sum(m.openings) as openings,
    sum(m.opening_damage) as opening_damage,
    sum(m.l_cancel_success) as l_cancel_success,
    sum(m.l_cancel_fail) as l_cancel_fail
  from move_per_game m
  join character_totals c on c.character_id = m.character_id
  cross join params
  group by m.character_id, m.move_key, c.games, params.min_contributors, params.min_games
  having count(distinct m.user_id) >= params.min_contributors
     and count(*) >= params.min_games
     and c.games >= params.min_games
),
month_rollup as (
  select
    month,
    count(*)::int as player_games,
    count(distinct user_id)::int as contributors,
    avg(duration_seconds) as average_duration_seconds,
    count(*) filter (where game_type = 'ranked')::int as ranked,
    count(*) filter (where game_type = 'unranked')::int as unranked,
    count(*) filter (where game_type = 'direct')::int as direct,
    count(*) filter (where game_type = 'offline')::int as offline
  from base, params
  group by month, params.min_contributors, params.min_games
  having count(*) >= params.min_games and count(distinct user_id) >= params.min_contributors
),
character_rollup as (
  select
    character_id,
    count(*)::int as player_games,
    count(distinct user_id)::int as contributors,
    sum(win) filter (where win is not null)::int as wins,
    count(win)::int as decided
  from base, params
  group by character_id, params.min_contributors, params.min_games
  having count(*) >= params.min_games and count(distinct user_id) >= params.min_contributors
),
stage_rollup as (
  select
    stage_id,
    count(*)::int as player_games,
    count(distinct user_id)::int as contributors,
    avg(duration_seconds) as average_duration_seconds
  from base, params
  group by stage_id, params.min_contributors, params.min_games
  having count(*) >= params.min_games and count(distinct user_id) >= params.min_contributors
),
assembled as (
  select jsonb_build_object(
    'matchups', coalesce((select jsonb_agg(jsonb_build_object(
      'characterId', character_id, 'opponentCharacterId', opponent_character_id,
      'stageId', stage_id, 'gameType', game_type, 'games', public.pub_bucket(games, 25),
      'contributors', public.pub_bucket(contributors, 5), 'wins', public.pub_bucket(wins, 25),
      'winRate', round(wins::numeric / games, 3)
    ) order by games desc) from matchup_rollup), '[]'::jsonb),
    'benchmarks', coalesce((select jsonb_agg(jsonb_build_object(
      'characterId', character_id, 'games', public.pub_bucket(games, 25),
      'contributors', public.pub_bucket(contributors, 5),
      'lCancel', case when l_cancel_q is null then null else jsonb_build_object('p25', round(l_cancel_q[1], 1), 'p50', round(l_cancel_q[2], 1), 'p75', round(l_cancel_q[3], 1)) end,
      'openingsPerKill', case when opk_q is null then null else jsonb_build_object('p25', round(opk_q[1], 1), 'p50', round(opk_q[2], 1), 'p75', round(opk_q[3], 1)) end,
      'damagePerOpening', case when dpo_q is null then null else jsonb_build_object('p25', round(dpo_q[1], 1), 'p50', round(dpo_q[2], 1), 'p75', round(dpo_q[3], 1)) end,
      'inputsPerMinute', case when ipm_q is null then null else jsonb_build_object('p25', round(ipm_q[1], 1), 'p50', round(ipm_q[2], 1), 'p75', round(ipm_q[3], 1)) end
    ) order by character_id) from benchmark_rollup), '[]'::jsonb),
    'execution', coalesce((select jsonb_agg(jsonb_build_object(
      'characterId', character_id, 'games', public.pub_bucket(games, 25),
      'contributors', public.pub_bucket(contributors, 5),
      'lCancelSuccess', round(l_cancel_success, 1),
      'groundTechSuccess', round(ground_tech_success, 1),
      'groundTechInPlace', round(ground_tech_in_place, 1),
      'groundTechIn', round(ground_tech_in, 1),
      'groundTechAway', round(ground_tech_away, 1)
    ) order by character_id) from execution_rollup), '[]'::jsonb),
    -- The move sums below are deliberately NOT bucketed. They span orders of
    -- magnitude in the same column -- a jab lands thousands of times while its
    -- kill count is single digits -- so any bucket wide enough to mask one
    -- contributor erases the small cells entirely (12 kills rounding to 0),
    -- and any bucket narrow enough to keep them masks nobody. They stay a
    -- differencing vector; refresh cadence is what limits them.
    'moves', coalesce((select jsonb_agg(jsonb_build_object(
      'characterId', character_id, 'moveKey', move_key,
      'characterGames', public.pub_bucket(character_games, 25),
      'contributors', public.pub_bucket(contributors, 5),
      'attempts', attempts, 'attemptGames', public.pub_bucket(attempt_games, 25),
      'landed', landed, 'damage', damage, 'kills', kills, 'killPctSum', kill_pct_sum,
      'openings', openings, 'openingDamage', opening_damage,
      'lCancelSuccess', l_cancel_success, 'lCancelFail', l_cancel_fail
    ) order by character_id, damage desc) from move_rollup), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object(
      'month', month, 'playerGames', public.pub_bucket(player_games, 25),
      'contributors', public.pub_bucket(contributors, 5),
      'averageDurationSeconds', round(average_duration_seconds, 0), 'ranked', public.pub_bucket(ranked, 25),
      'unranked', public.pub_bucket(unranked, 25), 'direct', public.pub_bucket(direct, 25),
      'offline', public.pub_bucket(offline, 25)
    ) order by month) from month_rollup), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object(
      'characterId', character_id, 'playerGames', public.pub_bucket(player_games, 25),
      'contributors', public.pub_bucket(contributors, 5),
      'wins', public.pub_bucket(coalesce(wins, 0), 25), 'decided', public.pub_bucket(decided, 25),
      'winRate', case when decided > 0 then round(wins::numeric / decided, 3) else null end
    ) order by player_games desc) from character_rollup), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
      'stageId', stage_id, 'playerGames', public.pub_bucket(player_games, 25),
      'contributors', public.pub_bucket(contributors, 5),
      'averageDurationSeconds', round(average_duration_seconds, 0)
    ) order by player_games desc) from stage_rollup), '[]'::jsonb)
  ) as payload
)
insert into public.community_snapshot (
  snapshot_id, refreshed_at, contributor_count, player_game_count,
  min_contributors, min_games, payload
)
select 'current', now(), active.contributors, active.player_games,
       params.min_contributors, params.min_games, assembled.payload
from active, params, assembled
on conflict (snapshot_id) do update set
  refreshed_at = excluded.refreshed_at,
  contributor_count = excluded.contributor_count,
  player_game_count = excluded.player_game_count,
  min_contributors = excluded.min_contributors,
  min_games = excluded.min_games,
  payload = excluded.payload;
$$;

revoke all on function public.refresh_community_snapshot() from public, anon, authenticated;
grant execute on function public.refresh_community_snapshot() to service_role;

-- Incremental refresh cache.
--
-- The original snapshot query above is kept as the readable definition of the
-- source-of-truth aggregation. Running it for every cron tick became wasteful
-- once the opted-in library reached ~100k games: even an unchanged population
-- had to reopen every GameRecord JSON document and expand every move. The cache
-- below changes the unit of work from "the whole community" to "one user whose
-- private inputs changed". Writes to games, account codes, or consent enqueue
-- only that user. Their exact private rollup is replaced, and the public
-- snapshot is then assembled from the compact per-user rows.
--
-- Replacing one dirty user's row (instead of trying to subtract opaque JSON
-- deltas) is deliberate. It makes opt-out, identity edits, stale-game updates,
-- and deletes exact while leaving every unchanged user completely untouched.
create table if not exists public.community_dirty_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  queued_at timestamptz not null default now()
);

create table if not exists public.community_user_rollups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  game_count bigint not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.community_dirty_users enable row level security;
alter table public.community_user_rollups enable row level security;
revoke all on public.community_dirty_users from anon, authenticated;
revoke all on public.community_user_rollups from anon, authenticated;

create or replace function public.mark_community_user_dirty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected_user uuid;
begin
  affected_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  insert into public.community_dirty_users (user_id, queued_at)
  values (affected_user, now())
  on conflict (user_id) do update set queued_at = excluded.queued_at;

  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    insert into public.community_dirty_users (user_id, queued_at)
    values (old.user_id, now())
    on conflict (user_id) do update set queued_at = excluded.queued_at;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- game_records arrive in 500-row upserts. A row trigger used to rewrite the
-- same dirty-user row 500 times per request (20,000 times for a large first
-- sync), generating avoidable WAL and compute. Transition tables reduce that
-- to one upsert per affected user per SQL statement.
create or replace function public.mark_community_changed_game_users_dirty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.community_dirty_users (user_id, queued_at)
  select distinct user_id, now() from changed_game_rows
  on conflict (user_id) do update set queued_at = excluded.queued_at;
  return null;
end;
$$;

create or replace function public.mark_community_deleted_game_users_dirty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.community_dirty_users (user_id, queued_at)
  select distinct user_id, now() from deleted_game_rows
  on conflict (user_id) do update set queued_at = excluded.queued_at;
  return null;
end;
$$;

drop trigger if exists community_dirty_game_records on public.game_records;
drop trigger if exists community_dirty_game_records_insert on public.game_records;
drop trigger if exists community_dirty_game_records_update on public.game_records;
drop trigger if exists community_dirty_game_records_delete on public.game_records;
create trigger community_dirty_game_records_insert
after insert on public.game_records
referencing new table as changed_game_rows
for each statement execute function public.mark_community_changed_game_users_dirty();
create trigger community_dirty_game_records_update
after update on public.game_records
referencing new table as changed_game_rows
for each statement execute function public.mark_community_changed_game_users_dirty();
create trigger community_dirty_game_records_delete
after delete on public.game_records
referencing old table as deleted_game_rows
for each statement execute function public.mark_community_deleted_game_users_dirty();

drop trigger if exists community_dirty_user_codes on public.user_codes;
create trigger community_dirty_user_codes
after insert or update or delete on public.user_codes
for each row execute function public.mark_community_user_dirty();

drop trigger if exists community_dirty_consent on public.community_consent;
create trigger community_dirty_consent
after insert or update or delete on public.community_consent
for each row execute function public.mark_community_user_dirty();

revoke all on function public.mark_community_user_dirty() from public, anon, authenticated;
revoke all on function public.mark_community_changed_game_users_dirty() from public, anon, authenticated;
revoke all on function public.mark_community_deleted_game_users_dirty() from public, anon, authenticated;

create or replace function public.refresh_community_user_rollup(target_user uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
delete from public.community_user_rollups where user_id = target_user;

with
params as (
  select '2026-08-24'::text as consent_version
),
eligible as (
  select
    g.user_id,
    coalesce(
      g.game_key,
      (g.data->>'playedAt') || '|' || (g.data->>'stageId') || '|' || (
        select string_agg(coalesce(p->>'connectCode', 'p' || (p->>'port') || ':' || (p->>'characterId')), '+' order by coalesce(p->>'connectCode', 'p' || (p->>'port') || ':' || (p->>'characterId')))
        from jsonb_array_elements(g.data->'players') p
      )
    ) as private_game_key,
    g.data,
    own.side as own_side,
    own.ord - 1 as own_index,
    opp.side as opp_side
  from public.game_records g
  cross join params
  join public.community_consent consent
    on consent.user_id = g.user_id
   and consent.enabled
   and consent.consent_version = params.consent_version
  cross join lateral (
    select p.side, p.ord
    from jsonb_array_elements(g.data->'players') with ordinality p(side, ord)
    join public.user_codes c on c.user_id = g.user_id and c.code = p.side->>'connectCode'
    order by p.ord
    limit 1
  ) own
  cross join lateral (
    select p.side
    from jsonb_array_elements(g.data->'players') with ordinality p(side, ord)
    where p.ord <> own.ord
    order by p.ord
    limit 1
  ) opp
  where g.user_id = target_user
    and coalesce((g.data->>'isTeams')::boolean, false) = false
    and jsonb_array_length(g.data->'players') = 2
    and not (g.data ? 'parseError')
    and (g.data->>'playedAt') is not null
    and (g.data->>'stageId')::int in (2, 3, 8, 28, 31, 32)
    and 1 = (
      select count(*)
      from jsonb_array_elements(g.data->'players') p
      join public.user_codes c on c.user_id = g.user_id and c.code = p->>'connectCode'
    )
),
deduped as (
  select distinct on (user_id, private_game_key, own_side->>'connectCode') *
  from eligible
  order by user_id, private_game_key, own_side->>'connectCode'
),
base as materialized (
  select
    user_id,
    private_game_key,
    (data->>'playedAt')::timestamptz as played_at,
    date_trunc('month', (data->>'playedAt')::timestamptz)::date as month,
    (data->>'durationFrames')::numeric / 60.0 as duration_seconds,
    (data->>'stageId')::int as stage_id,
    case when data->>'gameType' in ('ranked', 'unranked', 'direct', 'offline') then data->>'gameType' else 'unknown' end as game_type,
    (own_side->>'characterId')::int as character_id,
    (opp_side->>'characterId')::int as opponent_character_id,
    case
      when data->>'winnerIndex' is null then null
      when (data->>'winnerIndex')::int = own_index then 1
      else 0
    end as win,
    coalesce((own_side->>'lCancelSuccess')::numeric, 0) as l_cancel_success,
    coalesce((own_side->>'lCancelFail')::numeric, 0) as l_cancel_fail,
    own_side ? 'techs' as has_techs,
    coalesce((own_side->'techs'->>'inPlace')::numeric, 0) as tech_in_place,
    coalesce((own_side->'techs'->>'toward')::numeric, 0) as tech_in,
    coalesce((own_side->'techs'->>'away')::numeric, 0) as tech_away,
    coalesce((own_side->'techs'->>'missed')::numeric, 0) as tech_missed,
    nullif(own_side->>'openingsPerKill', '')::numeric as openings_per_kill,
    nullif(own_side->>'damagePerOpening', '')::numeric as damage_per_opening,
    nullif(own_side->>'inputsPerMinute', '')::numeric as inputs_per_minute,
    coalesce(own_side->'moveStats', '{}'::jsonb) as move_stats
  from deduped
),
periods(lookback_days) as (
  values (30::int), (90::int), (180::int), (365::int), (null::int)
),
windowed as materialized (
  select b.*, p.lookback_days
  from base b
  cross join periods p
  where p.lookback_days is null
     or b.played_at >= (
       ((now() at time zone 'UTC')::date - p.lookback_days)::timestamp at time zone 'UTC'
     )
),
active as (
  select count(*)::bigint as games from base
),
matchup_rollup as (
  select
    lookback_days,
    character_id,
    opponent_character_id,
    coalesce(stage_id, 0)::int as stage_id,
    coalesce(game_type, 'all') as game_type,
    count(*)::bigint as games,
    sum(win)::bigint as wins
  from windowed
  where win is not null
  group by lookback_days, grouping sets (
    (character_id, opponent_character_id),
    (character_id, opponent_character_id, stage_id),
    (character_id, opponent_character_id, game_type),
    (character_id, opponent_character_id, stage_id, game_type)
  )
),
benchmark_rollup as (
  select
    (case when grouping(character_id) = 1 then -1 else character_id end)::int as character_id,
    count(*)::bigint as games,
    case when sum(l_cancel_success + l_cancel_fail) > 0
      then 100.0 * sum(l_cancel_success) / sum(l_cancel_success + l_cancel_fail)
    end as l_cancel,
    avg(openings_per_kill) as openings_per_kill,
    avg(damage_per_opening) as damage_per_opening,
    avg(inputs_per_minute) as inputs_per_minute
  from base
  group by grouping sets ((character_id), ())
  having count(*) >= 5
),
execution_rollup as (
  select
    lookback_days,
    (case when grouping(character_id) = 1 then -1 else character_id end)::int as character_id,
    count(*)::bigint as games,
    sum(l_cancel_success) as l_cancel_success,
    sum(l_cancel_fail) as l_cancel_fail,
    sum(tech_in_place) as tech_in_place,
    sum(tech_in) as tech_in,
    sum(tech_away) as tech_away,
    sum(tech_missed) as tech_missed
  from windowed
  where has_techs and character_id between 0 and 25
  group by lookback_days, grouping sets ((character_id), ())
),
character_totals as (
  select lookback_days, character_id, count(*)::bigint as games
  from windowed
  group by lookback_days, character_id
),
move_per_game as (
  select
    b.lookback_days,
    b.private_game_key,
    b.character_id,
    case
      when m.key::int in (2,3,4,5) then 'jab'
      when m.key::int = 6 then 'dash'
      when m.key::int = 7 then 'ftilt'
      when m.key::int = 8 then 'utilt'
      when m.key::int = 9 then 'dtilt'
      when m.key::int = 10 then 'fsmash'
      when m.key::int = 11 then 'usmash'
      when m.key::int = 12 then 'dsmash'
      when m.key::int = 13 then 'nair'
      when m.key::int = 14 then 'fair'
      when m.key::int = 15 then 'bair'
      when m.key::int = 16 then 'uair'
      when m.key::int = 17 then 'dair'
      when m.key::int = 18 then 'neutral-b'
      when m.key::int = 19 then 'side-b'
      when m.key::int = 20 then 'up-b'
      when m.key::int = 21 then 'down-b'
      when m.key::int in (50,51) then 'getup'
      when m.key::int = 52 then 'pummel'
      when m.key::int = 53 then 'fthrow'
      when m.key::int = 54 then 'bthrow'
      when m.key::int = 55 then 'uthrow'
      when m.key::int = 56 then 'dthrow'
      when m.key::int in (61,62) then 'edge'
      else 'other'
    end as move_key,
    sum(coalesce((m.value->>'landed')::numeric, 0)) as landed,
    sum(coalesce((m.value->>'damage')::numeric, 0)) as damage,
    sum(coalesce((m.value->>'kills')::numeric, 0)) as kills,
    sum(coalesce((m.value->>'killPctSum')::numeric, 0)) as kill_pct_sum,
    sum(coalesce((m.value->>'openings')::numeric, 0)) as openings,
    sum(coalesce((m.value->>'openingDmg')::numeric, 0)) as opening_damage,
    sum(coalesce((m.value->>'lcSuccess')::numeric, 0)) as l_cancel_success,
    sum(coalesce((m.value->>'lcFail')::numeric, 0)) as l_cancel_fail,
    sum((m.value->>'attempts')::numeric) filter (where m.value ? 'attempts') as attempts,
    bool_or(m.value ? 'attempts') as has_attempts
  from windowed b
  cross join lateral jsonb_each(b.move_stats) m
  group by b.lookback_days, b.private_game_key, b.character_id, move_key
),
move_rollup as (
  select
    m.lookback_days,
    m.character_id,
    m.move_key,
    c.games as character_games,
    count(*)::bigint as move_games,
    sum(m.attempts) filter (where m.has_attempts) as attempts,
    count(*) filter (where m.has_attempts)::bigint as attempt_games,
    sum(m.landed) as landed,
    sum(m.damage) as damage,
    sum(m.kills) as kills,
    sum(m.kill_pct_sum) as kill_pct_sum,
    sum(m.openings) as openings,
    sum(m.opening_damage) as opening_damage,
    sum(m.l_cancel_success) as l_cancel_success,
    sum(m.l_cancel_fail) as l_cancel_fail
  from move_per_game m
  join character_totals c
    on c.character_id = m.character_id
   and c.lookback_days is not distinct from m.lookback_days
  group by m.lookback_days, m.character_id, m.move_key, c.games
),
month_rollup as (
  select
    month,
    count(*)::bigint as games,
    sum(duration_seconds) as duration_seconds,
    count(*) filter (where game_type = 'ranked')::bigint as ranked,
    count(*) filter (where game_type = 'unranked')::bigint as unranked,
    count(*) filter (where game_type = 'direct')::bigint as direct,
    count(*) filter (where game_type = 'offline')::bigint as offline
  from base
  group by month
),
character_rollup as (
  select
    lookback_days,
    character_id,
    count(*)::bigint as games,
    sum(win) filter (where win is not null)::bigint as wins,
    count(win)::bigint as decided
  from windowed
  group by lookback_days, character_id
),
stage_rollup as (
  select stage_id, count(*)::bigint as games, sum(duration_seconds) as duration_seconds
  from base
  group by stage_id
),
assembled as (
  select jsonb_build_object(
    'matchups', coalesce((select jsonb_agg(jsonb_build_object(
      'lookbackDays', lookback_days,
      'characterId', character_id, 'opponentCharacterId', opponent_character_id,
      'stageId', stage_id, 'gameType', game_type, 'games', games, 'wins', wins
    )) from matchup_rollup), '[]'::jsonb),
    'benchmarks', coalesce((select jsonb_agg(jsonb_build_object(
      'characterId', character_id, 'games', games, 'lCancel', l_cancel,
      'openingsPerKill', openings_per_kill, 'damagePerOpening', damage_per_opening,
      'inputsPerMinute', inputs_per_minute
    )) from benchmark_rollup), '[]'::jsonb),
    'execution', coalesce((select jsonb_agg(jsonb_build_object(
      'lookbackDays', lookback_days,
      'characterId', character_id, 'games', games,
      'lCancelSuccess', l_cancel_success, 'lCancelFail', l_cancel_fail,
      'techInPlace', tech_in_place, 'techIn', tech_in,
      'techAway', tech_away, 'techMissed', tech_missed
    )) from execution_rollup), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object(
      'lookbackDays', lookback_days,
      'characterId', character_id, 'moveKey', move_key,
      'characterGames', character_games, 'moveGames', move_games,
      'attempts', attempts, 'attemptGames', attempt_games,
      'landed', landed, 'damage', damage, 'kills', kills,
      'killPctSum', kill_pct_sum, 'openings', openings,
      'openingDamage', opening_damage, 'lCancelSuccess', l_cancel_success,
      'lCancelFail', l_cancel_fail
    )) from move_rollup), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object(
      'month', month, 'games', games, 'durationSeconds', duration_seconds,
      'ranked', ranked, 'unranked', unranked, 'direct', direct, 'offline', offline
    )) from month_rollup), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object(
      'lookbackDays', lookback_days,
      'characterId', character_id, 'games', games,
      'wins', coalesce(wins, 0), 'decided', decided
    )) from character_rollup), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
      'stageId', stage_id, 'games', games, 'durationSeconds', duration_seconds
    )) from stage_rollup), '[]'::jsonb)
  ) as payload
)
insert into public.community_user_rollups (user_id, game_count, payload, updated_at)
select target_user, active.games, assembled.payload, now()
from active, assembled
where active.games > 0
on conflict (user_id) do update set
  game_count = excluded.game_count,
  payload = excluded.payload,
  updated_at = excluded.updated_at;
$$;

revoke all on function public.refresh_community_user_rollup(uuid) from public, anon, authenticated;

-- Supersede the stateless full-community function above. With no dirty users,
-- this returns after one indexed existence check and performs no game scan.
create or replace function public.refresh_community_snapshot()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dirty_user uuid;
  changed boolean := false;
begin
  -- Rolling cohorts age even when nobody uploads or edits a game. Queue one
  -- refresh per contributor on the first cron run of each UTC day so a game
  -- that crosses a lookback boundary leaves the private cache on schedule.
  if exists (
    select 1
    from public.community_snapshot
    where snapshot_id = 'current'
      and (refreshed_at at time zone 'UTC')::date < (now() at time zone 'UTC')::date
  ) then
    insert into public.community_dirty_users (user_id, queued_at)
    select user_id, now() from public.community_consent
    on conflict (user_id) do update set queued_at = excluded.queued_at;
  end if;

  for dirty_user in
    select d.user_id
    from public.community_dirty_users d
    order by d.queued_at
    for update
  loop
    changed := true;
    perform public.refresh_community_user_rollup(dirty_user);
    delete from public.community_dirty_users where user_id = dirty_user;
  end loop;

  if not changed and exists (select 1 from public.community_snapshot where snapshot_id = 'current') then
    return;
  end if;

  with
  params as (
    select 25::int as min_contributors, 100::int as min_games
  ),
  active as (
    select count(*)::int as contributors,
           public.pub_bucket(coalesce(sum(game_count), 0), 500)::bigint as player_games
    from public.community_user_rollups
    where game_count > 0
  ),
  matchup_user as (
    select
      r.user_id,
      (j->>'lookbackDays')::int as lookback_days,
      (j->>'characterId')::int as character_id,
      (j->>'opponentCharacterId')::int as opponent_character_id,
      (j->>'stageId')::int as stage_id,
      j->>'gameType' as game_type,
      (j->>'games')::bigint as games,
      (j->>'wins')::bigint as wins
    from public.community_user_rollups r
    cross join lateral jsonb_array_elements(coalesce(r.payload->'matchups', '[]'::jsonb)) j
  ),
  matchup_rollup as (
    select lookback_days, character_id, opponent_character_id, stage_id, game_type,
           sum(games)::bigint as games, count(*)::int as contributors,
           sum(wins)::bigint as wins
    from matchup_user, params
    group by lookback_days, character_id, opponent_character_id, stage_id, game_type,
             params.min_contributors, params.min_games
    having sum(games) >= params.min_games and count(*) >= params.min_contributors
  ),
  benchmark_user as (
    select
      r.user_id,
      (j->>'characterId')::int as character_id,
      (j->>'games')::bigint as games,
      (j->>'lCancel')::numeric as l_cancel,
      (j->>'openingsPerKill')::numeric as openings_per_kill,
      (j->>'damagePerOpening')::numeric as damage_per_opening,
      (j->>'inputsPerMinute')::numeric as inputs_per_minute
    from public.community_user_rollups r
    cross join lateral jsonb_array_elements(coalesce(r.payload->'benchmarks', '[]'::jsonb)) j
  ),
  benchmark_rollup as (
    select
      character_id,
      sum(games)::bigint as games,
      count(*)::int as contributors,
      case when count(l_cancel) >= params.min_contributors then
        (percentile_cont(array[0.25, 0.5, 0.75]) within group (order by l_cancel) filter (where l_cancel is not null))::numeric[]
      end as l_cancel_q,
      case when count(openings_per_kill) >= params.min_contributors then
        (percentile_cont(array[0.25, 0.5, 0.75]) within group (order by openings_per_kill) filter (where openings_per_kill is not null))::numeric[]
      end as opk_q,
      case when count(damage_per_opening) >= params.min_contributors then
        (percentile_cont(array[0.25, 0.5, 0.75]) within group (order by damage_per_opening) filter (where damage_per_opening is not null))::numeric[]
      end as dpo_q,
      case when count(inputs_per_minute) >= params.min_contributors then
        (percentile_cont(array[0.25, 0.5, 0.75]) within group (order by inputs_per_minute) filter (where inputs_per_minute is not null))::numeric[]
      end as ipm_q
    from benchmark_user, params
    group by character_id, params.min_contributors, params.min_games
    having count(*) >= params.min_contributors and sum(games) >= params.min_games
  ),
  execution_user as (
    select
      r.user_id,
      (j->>'lookbackDays')::int as lookback_days,
      (j->>'characterId')::int as character_id,
      (j->>'games')::bigint as games,
      (j->>'lCancelSuccess')::numeric as l_cancel_success,
      (j->>'lCancelFail')::numeric as l_cancel_fail,
      (j->>'techInPlace')::numeric as tech_in_place,
      (j->>'techIn')::numeric as tech_in,
      (j->>'techAway')::numeric as tech_away,
      (j->>'techMissed')::numeric as tech_missed
    from public.community_user_rollups r
    cross join lateral jsonb_array_elements(coalesce(r.payload->'execution', '[]'::jsonb)) j
  ),
  execution_rollup as (
    select
      lookback_days,
      character_id,
      sum(games)::bigint as games,
      count(*)::int as contributors,
      case when sum(l_cancel_success + l_cancel_fail) > 0
        then 100.0 * sum(l_cancel_success) / sum(l_cancel_success + l_cancel_fail)
      end as l_cancel_success,
      case when sum(tech_in_place + tech_in + tech_away + tech_missed) > 0
        then 100.0 * sum(tech_in_place + tech_in + tech_away)
          / sum(tech_in_place + tech_in + tech_away + tech_missed)
      end as ground_tech_success,
      case when sum(tech_in_place + tech_in + tech_away) > 0
        then 100.0 * sum(tech_in_place) / sum(tech_in_place + tech_in + tech_away)
      end as ground_tech_in_place,
      case when sum(tech_in_place + tech_in + tech_away) > 0
        then 100.0 * sum(tech_in) / sum(tech_in_place + tech_in + tech_away)
      end as ground_tech_in,
      case when sum(tech_in_place + tech_in + tech_away) > 0
        then 100.0 * sum(tech_away) / sum(tech_in_place + tech_in + tech_away)
      end as ground_tech_away
    from execution_user, params
    group by lookback_days, character_id, params.min_contributors, params.min_games
    having sum(games) >= params.min_games and count(*) >= params.min_contributors
  ),
  character_user as (
    select
      r.user_id,
      (j->>'lookbackDays')::int as lookback_days,
      (j->>'characterId')::int as character_id,
      (j->>'games')::bigint as games,
      (j->>'wins')::bigint as wins,
      (j->>'decided')::bigint as decided
    from public.community_user_rollups r
    cross join lateral jsonb_array_elements(coalesce(r.payload->'characters', '[]'::jsonb)) j
  ),
  character_totals as (
    select lookback_days, character_id, sum(games)::bigint as games
    from character_user
    group by lookback_days, character_id
  ),
  move_user as (
    select
      r.user_id,
      (j->>'lookbackDays')::int as lookback_days,
      (j->>'characterId')::int as character_id,
      j->>'moveKey' as move_key,
      (j->>'moveGames')::bigint as move_games,
      (j->>'attempts')::numeric as attempts,
      (j->>'attemptGames')::bigint as attempt_games,
      (j->>'landed')::numeric as landed,
      (j->>'damage')::numeric as damage,
      (j->>'kills')::numeric as kills,
      (j->>'killPctSum')::numeric as kill_pct_sum,
      (j->>'openings')::numeric as openings,
      (j->>'openingDamage')::numeric as opening_damage,
      (j->>'lCancelSuccess')::numeric as l_cancel_success,
      (j->>'lCancelFail')::numeric as l_cancel_fail
    from public.community_user_rollups r
    cross join lateral jsonb_array_elements(coalesce(r.payload->'moves', '[]'::jsonb)) j
  ),
  move_rollup as (
    select
      m.lookback_days,
      m.character_id,
      m.move_key,
      c.games as character_games,
      count(*)::int as contributors,
      sum(m.attempts) as attempts,
      sum(m.attempt_games)::bigint as attempt_games,
      sum(m.landed) as landed,
      sum(m.damage) as damage,
      sum(m.kills) as kills,
      sum(m.kill_pct_sum) as kill_pct_sum,
      sum(m.openings) as openings,
      sum(m.opening_damage) as opening_damage,
      sum(m.l_cancel_success) as l_cancel_success,
      sum(m.l_cancel_fail) as l_cancel_fail,
      sum(m.move_games)::bigint as move_games
    from move_user m
    join character_totals c
      on c.character_id = m.character_id
     and c.lookback_days is not distinct from m.lookback_days
    cross join params
    group by m.lookback_days, m.character_id, m.move_key, c.games, params.min_contributors, params.min_games
    having count(*) >= params.min_contributors
       and sum(m.move_games) >= params.min_games
       and c.games >= params.min_games
  ),
  month_user as (
    select
      r.user_id,
      (j->>'month')::date as month,
      (j->>'games')::bigint as games,
      (j->>'durationSeconds')::numeric as duration_seconds,
      (j->>'ranked')::bigint as ranked,
      (j->>'unranked')::bigint as unranked,
      (j->>'direct')::bigint as direct,
      (j->>'offline')::bigint as offline
    from public.community_user_rollups r
    cross join lateral jsonb_array_elements(coalesce(r.payload->'months', '[]'::jsonb)) j
  ),
  month_rollup as (
    select
      month,
      sum(games)::bigint as player_games,
      count(*)::int as contributors,
      sum(duration_seconds) / nullif(sum(games), 0) as average_duration_seconds,
      sum(ranked)::bigint as ranked,
      sum(unranked)::bigint as unranked,
      sum(direct)::bigint as direct,
      sum(offline)::bigint as offline
    from month_user, params
    group by month, params.min_contributors, params.min_games
    having sum(games) >= params.min_games and count(*) >= params.min_contributors
  ),
  character_rollup as (
    select
      character_id,
      sum(games)::bigint as player_games,
      count(*)::int as contributors,
      sum(wins)::bigint as wins,
      sum(decided)::bigint as decided
    from character_user, params
    where lookback_days is null
    group by character_id, params.min_contributors, params.min_games
    having sum(games) >= params.min_games and count(*) >= params.min_contributors
  ),
  stage_user as (
    select
      r.user_id,
      (j->>'stageId')::int as stage_id,
      (j->>'games')::bigint as games,
      (j->>'durationSeconds')::numeric as duration_seconds
    from public.community_user_rollups r
    cross join lateral jsonb_array_elements(coalesce(r.payload->'stages', '[]'::jsonb)) j
  ),
  stage_rollup as (
    select
      stage_id,
      sum(games)::bigint as player_games,
      count(*)::int as contributors,
      sum(duration_seconds) / nullif(sum(games), 0) as average_duration_seconds
    from stage_user, params
    group by stage_id, params.min_contributors, params.min_games
    having sum(games) >= params.min_games and count(*) >= params.min_contributors
  ),
  assembled as (
    select jsonb_build_object(
      'matchups', coalesce((select jsonb_agg(jsonb_build_object(
        'lookbackDays', lookback_days,
        'characterId', character_id, 'opponentCharacterId', opponent_character_id,
        'stageId', stage_id, 'gameType', game_type,
        'games', public.pub_bucket(games, 25),
        'contributors', public.pub_bucket(contributors, 5),
        'wins', public.pub_bucket(wins, 25),
        'winRate', round(wins::numeric / games, 3)
      ) order by games desc) from matchup_rollup), '[]'::jsonb),
      'benchmarks', coalesce((select jsonb_agg(jsonb_build_object(
        'characterId', character_id, 'games', public.pub_bucket(games, 25),
        'contributors', public.pub_bucket(contributors, 5),
        'lCancel', case when l_cancel_q is null then null else jsonb_build_object('p25', round(l_cancel_q[1], 1), 'p50', round(l_cancel_q[2], 1), 'p75', round(l_cancel_q[3], 1)) end,
        'openingsPerKill', case when opk_q is null then null else jsonb_build_object('p25', round(opk_q[1], 1), 'p50', round(opk_q[2], 1), 'p75', round(opk_q[3], 1)) end,
        'damagePerOpening', case when dpo_q is null then null else jsonb_build_object('p25', round(dpo_q[1], 1), 'p50', round(dpo_q[2], 1), 'p75', round(dpo_q[3], 1)) end,
        'inputsPerMinute', case when ipm_q is null then null else jsonb_build_object('p25', round(ipm_q[1], 1), 'p50', round(ipm_q[2], 1), 'p75', round(ipm_q[3], 1)) end
      ) order by character_id) from benchmark_rollup), '[]'::jsonb),
      'execution', coalesce((select jsonb_agg(jsonb_build_object(
        'lookbackDays', lookback_days,
        'characterId', character_id, 'games', public.pub_bucket(games, 25),
        'contributors', public.pub_bucket(contributors, 5),
        'lCancelSuccess', round(l_cancel_success, 1),
        'groundTechSuccess', round(ground_tech_success, 1),
        'groundTechInPlace', round(ground_tech_in_place, 1),
        'groundTechIn', round(ground_tech_in, 1),
        'groundTechAway', round(ground_tech_away, 1)
      ) order by character_id) from execution_rollup), '[]'::jsonb),
      'moves', coalesce((select jsonb_agg(jsonb_build_object(
        'lookbackDays', lookback_days,
        'characterId', character_id, 'moveKey', move_key,
        'characterGames', public.pub_bucket(character_games, 25),
        'contributors', public.pub_bucket(contributors, 5),
        'attempts', attempts, 'attemptGames', public.pub_bucket(attempt_games, 25),
        'landed', landed, 'damage', damage, 'kills', kills,
        'killPctSum', kill_pct_sum, 'openings', openings,
        'openingDamage', opening_damage, 'lCancelSuccess', l_cancel_success,
        'lCancelFail', l_cancel_fail
      ) order by character_id, damage desc) from move_rollup), '[]'::jsonb),
      'months', coalesce((select jsonb_agg(jsonb_build_object(
        'month', month, 'playerGames', public.pub_bucket(player_games, 25),
        'contributors', public.pub_bucket(contributors, 5),
        'averageDurationSeconds', round(average_duration_seconds, 0),
        'ranked', public.pub_bucket(ranked, 25),
        'unranked', public.pub_bucket(unranked, 25),
        'direct', public.pub_bucket(direct, 25),
        'offline', public.pub_bucket(offline, 25)
      ) order by month) from month_rollup), '[]'::jsonb),
      'characters', coalesce((select jsonb_agg(jsonb_build_object(
        'characterId', character_id, 'playerGames', public.pub_bucket(player_games, 25),
        'contributors', public.pub_bucket(contributors, 5),
        'wins', public.pub_bucket(wins, 25),
        'decided', public.pub_bucket(decided, 25),
        'winRate', case when decided > 0 then round(wins::numeric / decided, 3) else null end
      ) order by player_games desc) from character_rollup), '[]'::jsonb),
      'stages', coalesce((select jsonb_agg(jsonb_build_object(
        'stageId', stage_id, 'playerGames', public.pub_bucket(player_games, 25),
        'contributors', public.pub_bucket(contributors, 5),
        'averageDurationSeconds', round(average_duration_seconds, 0)
      ) order by player_games desc) from stage_rollup), '[]'::jsonb)
    ) as payload
  )
  insert into public.community_snapshot (
    snapshot_id, refreshed_at, contributor_count, player_game_count,
    min_contributors, min_games, payload
  )
  select 'current', now(), active.contributors, active.player_games,
         params.min_contributors, params.min_games, assembled.payload
  from active, params, assembled
  on conflict (snapshot_id) do update set
    refreshed_at = excluded.refreshed_at,
    contributor_count = excluded.contributor_count,
    player_game_count = excluded.player_game_count,
    min_contributors = excluded.min_contributors,
    min_games = excluded.min_games,
    payload = excluded.payload;
end;
$$;

revoke all on function public.refresh_community_snapshot() from public, anon, authenticated;
grant execute on function public.refresh_community_snapshot() to service_role;

-- Seed the cache backfill. Re-running this file deliberately requeues every
-- user so changes to the private rollup shape (such as lookback cohorts) are
-- populated before the next public snapshot is assembled.
insert into public.community_dirty_users (user_id, queued_at)
select user_id, now() from public.community_consent
on conflict (user_id) do update set queued_at = excluded.queued_at;

-- First run / manual refresh:
--   set statement_timeout = '10min';
--   select public.refresh_community_snapshot();
--
-- In production, schedule both statements as one command every 15 minutes with
-- Supabase Cron. The SET must precede the SELECT in the scheduled command: a
-- function-level SET happens after Postgres has already armed the caller's
-- statement timer, so it cannot extend the refresh's two-minute default.
-- Unchanged runs return immediately. A game/code/consent write queues only that
-- user; switching consent off removes that user's private rollup on the next run.
