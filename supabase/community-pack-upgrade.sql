-- Existing-project upgrade from row-per-game Community inputs to packed inputs.
-- Idempotent: safe to rerun if an earlier community.sql attempt was aborted.

begin;
set local statement_timeout = '15min';
set local lock_timeout = '2min';

-- Match the packed writer's lock order before touching the dirty-user queue.
lock table public.game_records, public.game_record_packs in access exclusive mode;

do $$
declare
  rollup_oid regprocedure;
  rollup_definition text;
begin
  rollup_oid := to_regprocedure('public.refresh_community_user_rollup(uuid)');
  if rollup_oid is null then
    raise exception 'Community functions are missing; run the full community.sql first';
  end if;

  select pg_get_functiondef(rollup_oid) into rollup_definition;

  if strpos(rollup_definition, 'from public.game_records g') > 0 then
    rollup_definition := replace(
      rollup_definition,
      'from public.game_records g',
      'from (
    select packs.user_id, entry.key as game_key, entry.value as data
    from public.game_record_packs packs
    cross join lateral jsonb_each(packs.records) entry
    where packs.user_id = target_user
  ) g'
    );
    execute rollup_definition;
  elsif strpos(rollup_definition, 'from public.game_record_packs packs') = 0 then
    raise exception 'Unrecognized Community rollup source; stopping without changes';
  end if;
end;
$$;

drop trigger if exists community_dirty_game_records on public.game_records;
drop trigger if exists community_dirty_game_records_insert on public.game_records;
drop trigger if exists community_dirty_game_records_update on public.game_records;
drop trigger if exists community_dirty_game_records_delete on public.game_records;

drop trigger if exists community_dirty_game_record_packs_insert on public.game_record_packs;
drop trigger if exists community_dirty_game_record_packs_update on public.game_record_packs;
drop trigger if exists community_dirty_game_record_packs_delete on public.game_record_packs;

create trigger community_dirty_game_record_packs_insert
after insert on public.game_record_packs
referencing new table as changed_game_rows
for each statement execute function public.mark_community_changed_game_users_dirty();

create trigger community_dirty_game_record_packs_update
after update on public.game_record_packs
referencing new table as changed_game_rows
for each statement execute function public.mark_community_changed_game_users_dirty();

create trigger community_dirty_game_record_packs_delete
after delete on public.game_record_packs
referencing old table as deleted_game_rows
for each statement execute function public.mark_community_deleted_game_users_dirty();

-- Rebuild consenting users from packed data on the next scheduled refresh.
insert into public.community_dirty_users (user_id, queued_at)
select user_id, now() from public.community_consent
on conflict (user_id) do update set queued_at = excluded.queued_at;

commit;
