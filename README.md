# SSBM Dashboard

Point it at your Slippi replay folder and get a full statistical readout of your Melee play: win rates by opponent, matchup, and stage; kill stats; and execution trends. **Everything is parsed in your browser — no uploads, no accounts, no server.** An optional Google sign-in (see [Cloud sync](#cloud-sync-optional)) can mirror your parsed stats — never raw replays — so they follow you across devices; without it the app remains fully local.

## How it works

```
Replay folder ──► discovery (*.slp) ──► dedup vs cache ──► web worker pool
                                                             @slippi/slippi-js
                                                                   │
                          React dashboard ◄── aggregation ◄── IndexedDB (Dexie)
```

- **Parse pipeline** (`src/lib/pool.ts`, `src/worker/parser.worker.ts`): recursively discovers `.slp` files via the File System Access API (Chromium) or a `webkitdirectory` input (Firefox/Safari), then parses them across `hardwareConcurrency` web workers. Each game is reduced to a ~1–2 KB `GameRecord`; frame data is discarded.
- **Cache** (`src/lib/db.ts`): records persist in IndexedDB keyed on `path|size|mtime`, so repeat visits only parse new files. Corrupt files get tombstones so they aren't retried every visit.
- **Identity** (`src/lib/stats.ts`): games store both players neutrally; "you" is inferred as the connect code appearing in the most games, confirmed once, and changeable without a re-parse. Multiple codes (alts) are supported.
- **Win/loss**: placements → stock-out survivor → LRAS initiator loses. Games under 30 seconds are indeterminate and excluded from win-rate aggregates (still visible in the game log).
- **Views**: Overview (KPIs, rolling win rate, by-character table, weekly volume), Matchups (character × character matrix), Stages, Opponents, Execution (L-cancel %, openings/kill, damage/opening, inputs/min), Game log with CSV export.

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # type-check + production build
```

No replays handy? The landing page has a demo-data mode (deterministic synthetic year of a Falco player's netplay).

## Cloud sync (optional)

With no configuration the app is 100% local. To enable accounts + cross-device sync of the flattened `GameRecord` metadata (raw `.slp` files never leave the machine):

1. **Create a Supabase project** (free tier is fine) at [database.new](https://database.new).
2. **Create the tables**: open SQL Editor in the Supabase dashboard, paste [`supabase/schema.sql`](supabase/schema.sql), run it. This creates `game_records` and `user_settings` with row-level security so each user can only read/write their own rows.
3. **Enable Google sign-in**: in Google Cloud Console, create an OAuth 2.0 Client ID (type "Web application") with authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`; then in Supabase → Authentication → Providers → Google, paste the client ID and secret. Add your app's URL (and `http://localhost:5173` for dev) under Authentication → URL Configuration → Redirect URLs.
4. **Set the env vars**: copy `.env.example` to `.env.local` (and set the same two variables in Vercel → Project → Settings → Environment Variables): `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, both from Supabase → Settings → API.

When the vars are present, a "Sign in with Google" button appears in the dashboard header. Sync is two-way and idempotent (records are keyed `path|size|mtime`, so re-parsing the same files on another machine converges instead of duplicating), runs once automatically after sign-in, and manually via the Sync button after that.

## Stack

Vite + React + TypeScript, [`@slippi/slippi-js`](https://github.com/project-slippi/slippi-js) for parsing, Dexie (IndexedDB), Recharts.

Character stock icons in `public/stock/` are from Super Smash Bros. Melee (© Nintendo / HAL Laboratory), sourced via [slippi-launcher](https://github.com/project-slippi/slippi-launcher); they are fan-project assets and not covered by this repository's MIT license.

## Roadmap

- Sessions view with per-session W/L and tilt indicators
- Frame-level deep dives (wavedash/ledgedash quality) behind an opt-in re-parse
- Shareable read-only snapshots
