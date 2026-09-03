# SSBM Stats

[ssbmstats.com](https://ssbmstats.com/) turns local `.slp` and `.slpz` replays into a Melee stats dashboard with matchup, opponent, stage, session, execution, teams, and coaching views.

Everything is parsed and cached in your browser; raw replay files never leave your device. Optional Google sign-in syncs parsed stats only, and Community contribution is a separate, default-off choice.

No replays? Try the demo or browse the public Community, Tournament, and Liquipedia views.

## How it works

```text
replays → browser workers → IndexedDB → React dashboard
```

The installable PWA works offline, and content-based deduplication prevents copied or moved replays from being counted twice.

## Community and tournament benchmarks

The Community section compares your local character stats against four separate samples:

- **SSBM Stats** — privacy-thresholded aggregates from users who explicitly opted in.
- **Venue archive** — usable event-associated games from [Nikki's public Slippi archive](https://replays.nikki.sh/).
- **Tournament archive** — the conservative subset linked to verified or probable tournament sets.
- **Pro tournament archive** — the aggregate of externally verified Top 100 player mappings, with an optional named-pro comparison.

Matchup, Stage, and Move Atlas use the same side-by-side columns. Execution charts show these samples as fixed horizontal references; they are aggregate benchmarks, not historical time series. The Tournament explorer can be browsed by series or event. Selecting a named pro limits the Event menu to that player's verified mappings and automatically selects their most-observed character for the event.

The current `nikki-2026-09-02-v3` snapshot contains 160,075 unique parsed games, of which 152,566 are in the broad usable sample and 25,593 are in the conservative tournament sample. Those 152,566 games represent 321,668 player-games because singles contribute two player appearances and doubles contribute four. Five players currently have publishable identity mappings: Aklo, Cody Schwab, SDJ, Zain, and lloD. Ambiguous identities remain anonymous and still contribute to aggregate statistics.

Raw `.slp` files, source paths, unresolved tags, connect codes, and private user identifiers are not published. The archive contains only derived game/player statistics and rollups, in tables separate from private user-sync data.

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

1. Apply [`supabase/schema.sql`](supabase/schema.sql) and, optionally, [`supabase/community.sql`](supabase/community.sql). Operators publishing a public replay archive also apply [`supabase/public-archive.sql`](supabase/public-archive.sql); it is not required for private sync.
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
