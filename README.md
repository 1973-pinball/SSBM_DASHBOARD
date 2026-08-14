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
- **Views**: Overview (KPIs, rolling win rate, by-character table, weekly volume, plus an exportable share-card PNG), Matchups (character × character matrix), Stages, Opponents, Sessions (per-session W/L, fatigue and tilt tables), Execution (L-cancel %, openings/kill, damage/opening, inputs/min), Insights (logistic-regression win-factor model + coaching hints), Records (personal bests: streaks, fastest win, nemesis), and a Game log with CSV export. 2v2 games get their own consolidated Teams view (team-level W/L, teammate breakdowns) via the singles/teams filter switch.
- **Liquipedia**: one tab steps outside your own replays to cover competitive Melee history — majors per year by tier, an animated race of major titles ending in the all-time champions table with career winnings, and top-100 character composition over every SSBMRank edition, including which player first put each character on the board. The dataset is a bundled snapshot (see [Scene data](#scene-data-the-liquipedia-tab)), so it works offline like the rest of the app.
- **Installable PWA**: the full app shell is precached (`vite-plugin-pwa`, auto-updating service worker), so the dashboard installs like an app and loads offline against the local cache.

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # type-check + production build
```

No replays handy? The landing page has a demo-data mode (deterministic synthetic year of a Falco player's netplay).

## Scene data (the Liquipedia tab)

The Liquipedia tab reads from `src/lib/liquipedia/data.ts`, a snapshot compiled from [Liquipedia's Smash wiki](https://liquipedia.net/smash) (content licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)) — primarily [Major Tournaments/Melee](https://liquipedia.net/smash/Major_Tournaments/Melee), the [SSBMRank](https://liquipedia.net/smash/SSBMRank) editions, and individual player pages for career winnings. Every source is listed in-app at the bottom of the tab.

It ships in the bundle rather than being fetched at runtime: the app has no backend, its CSP allows only itself and Supabase, and the tab has to work offline. Refreshing it is therefore a commit:

```bash
node scripts/refresh-liquipedia.mjs
```

A monthly GitHub Action runs exactly that and commits any change, so each month picks up new majors and any newly published ranking edition. The script is append-only — it adds majors dated after the snapshot and editions not already present, never rewriting existing rows — and it rate-limits itself; if Liquipedia throttles the run it exits 2, leaves the file untouched, and the next run tries again.

## Cloud sync (optional)

With no configuration the app is 100% local. When enabled, the cloud is a **mirror, not a backend**: the dashboard always renders from the local IndexedDB cache, and sync keeps that cache converged with the union of games from every device you've signed in on. That's why the app stays instant, works fully offline, and keeps working even if the cloud is unreachable — a failed sync only means the mirror is stale, never a broken dashboard.

To enable accounts + cross-device sync of the flattened `GameRecord` metadata (raw `.slp` files never leave the machine):

1. **Create a Supabase project** (free tier is fine) at [database.new](https://database.new).
2. **Create the tables**: open SQL Editor in the Supabase dashboard, paste [`supabase/schema.sql`](supabase/schema.sql), run it. This creates `game_records` and `user_settings` with row-level security so each user can only read/write their own rows.
3. **Enable Google sign-in**: in Google Cloud Console, create an OAuth 2.0 Client ID (type "Web application") with authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`; then in Supabase → Authentication → Providers → Google, paste the client ID and secret. Add your app's URL (and `http://localhost:5173` for dev) under Authentication → URL Configuration → Redirect URLs.
4. **Set the env vars**: copy `.env.example` to `.env.local` (and set the same two variables in Vercel → Project → Settings → Environment Variables): `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, both from Supabase → Settings → API.

When the vars are present, a "Sign in with Google" button appears in the dashboard header. Sync is two-way, idempotent (records are keyed `path|size|mtime`, so re-parsing the same files on another machine converges instead of duplicating), and automatic: it runs on sign-in, again a moment after new replays finish parsing, and when you return to an open tab — so every signed-in device converges to the union of all your games without pressing anything. If an auto-sync fails (say, offline), the header button turns gold ("Sync N new games") as the manual fallback. On a new device — including a phone — the landing page offers **"Sign in with Google to restore"**, which pulls your synced stats and saved connect codes with no replay folder needed.

## Stack

Vite + React + TypeScript, [`@slippi/slippi-js`](https://github.com/project-slippi/slippi-js) for parsing, Dexie (IndexedDB), Recharts, `vite-plugin-pwa` (offline/install), `@supabase/supabase-js` (optional cloud sync), `html-to-image` (share card).

Character stock icons in `public/stock/` are from Super Smash Bros. Melee (© Nintendo / HAL Laboratory), sourced via [slippi-launcher](https://github.com/project-slippi/slippi-launcher); they are fan-project assets and not covered by this repository's MIT license.

## Roadmap

- Frame-level deep dives (wavedash/ledgedash quality) behind an opt-in re-parse
- Hosted read-only snapshot links (a PNG share card already exists on Overview)
