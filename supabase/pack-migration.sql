-- SSBM Stats row-to-pack migration (NON-DESTRUCTIVE).
--
-- Run the latest schema.sql first, then run this file repeatedly. Each run
-- copies one user from the legacy
-- game_records row into game_record_packs without changing or deleting the
-- source table. Safe and resumable: completed users are recorded separately,
-- and an equal/newer packed payload always wins.
--
-- Keep clicking Run until users_remaining is 0, then run pack-verify.sql.

set statement_timeout = '15min';

select * from public.migrate_legacy_game_record_batch(1);
