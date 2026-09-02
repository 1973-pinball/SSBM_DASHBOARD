# SSBM Stats

[ssbmstats.com](https://ssbmstats.com/) turns local `.slp` and `.slpz` replays into a Melee stats dashboard with matchup, opponent, stage, session, execution, teams, and coaching views.

Everything is parsed and cached in your browser; raw replay files never leave your device. Optional Google sign-in syncs parsed stats only, and Community contribution is a separate, default-off choice.

No replays? Try the demo or browse the public Community and Liquipedia views.

## How it works

```text
replays → browser workers → IndexedDB → React dashboard
```

The installable PWA works offline, and content-based deduplication prevents copied or moved replays from being counted twice.

## Development

```bash
npm install
npm run dev
npm run build
npm run lint
```

Requires Node 22. Run `git config core.hooksPath .githooks` once per clone. Use `npm run verify:slpz -- <replay-folder> [count]` to compare local `.slp`/`.slpz` pairs; replay fixtures are never committed.

## Optional cloud sync

The app stays fully local unless Supabase is configured. To enable self-hosted sync:

1. Apply [`supabase/schema.sql`](supabase/schema.sql) and, optionally, [`supabase/community.sql`](supabase/community.sql).
2. Enable Google authentication in Supabase.
3. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_SITE_URL`.

Only parsed stats from the user's own accounts are synced—never replay files. See [`supabase/AUTH_BRANDING.md`](supabase/AUTH_BRANDING.md) for production OAuth setup.

Projects upgrading from the legacy row-per-game mirror should run
[`supabase/pack-migration.sql`](supabase/pack-migration.sql) repeatedly until no
users remain, deploy the packed
client, confirm [`supabase/pack-verify.sql`](supabase/pack-verify.sql) reports no
missing games, verify a restore, and only then run the destructive
[`supabase/pack-cleanup.sql`](supabase/pack-cleanup.sql) to reclaim the old table.

## Credits

Built with React, TypeScript, [`@slippi/slippi-js`](https://github.com/project-slippi/slippi-js), Dexie, Recharts, and optional Supabase.

Scene-history data comes from [Liquipedia](https://liquipedia.net/smash) under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Character icons are Nintendo/HAL fan-project assets sourced through [slippi-launcher](https://github.com/project-slippi/slippi-launcher) and are not covered by this repository's MIT license.
