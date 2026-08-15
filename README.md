# SSBM Dashboard

Point it at your Slippi replay folder and get a full statistical readout of your Melee play: win rates by opponent, matchup, and stage; kill stats; and execution trends. **Everything is parsed in your browser — no uploads, no accounts, no server.** An optional Google sign-in ([Cloud sync](#cloud-sync-optional)) mirrors your parsed stats — never raw replays — across devices; without it the app stays fully local.

No replays handy? The landing page has a demo mode: a deterministic synthetic year of a Falco player's netplay.

## How it works

```
Replay folder ──► discovery (*.slp) ──► dedup vs cache ──► web worker pool
                                                             @slippi/slippi-js
                                                                   │
                          React dashboard ◄── aggregation ◄── IndexedDB (Dexie)
```

- **Parse pipeline** (`src/lib/pool.ts`, `src/worker/parser.worker.ts`): recursively discovers `.slp` files via the File System Access API (Chromium) or a `webkitdirectory` input (Firefox/Safari), then parses them across one worker per core, capped at 8. Each game is reduced to a ~5 KB `GameRecord` (headline stats plus a per-move breakdown); frame data is discarded.
- **Cache** (`src/lib/db.ts`): records persist in IndexedDB keyed on `path|size|mtime`, so repeat visits only parse new files. Corrupt files get tombstones so they aren't retried every visit.
- **Identity** (`src/lib/stats.ts`): games store both players neutrally; "you" is inferred as the connect code appearing in the most games, confirmed once, and changeable without a re-parse. Multiple codes (alts) are supported.
- **Win/loss**: placements → stock-out survivor → LRAS initiator loses. Games under 30 seconds are indeterminate and excluded from win-rate aggregates, but still listed in the game log.
- **Installable PWA**: the whole app shell is precached (`vite-plugin-pwa`, auto-updating service worker), so the dashboard installs like an app and loads offline against the local cache.

## Views

Filters (date range, mode, character, stage, opponent) are global, and clicking a row or cell scopes the whole dashboard to it. Every metric is defined in the in-app **Metrics guide**.

- **Overview** — KPIs, rolling win rate, weekly volume, a per-character table (win rate, kills, L-cancel), and an exportable share-card PNG.
- **Matchups / Stages / Opponents** — character × character matrix, per-stage and stage × opponent-character counterpick tables, per-opponent records with recent sets.
- **Sessions** — a session is games separated by gaps under 30 minutes: per-session W/L plus fatigue and tilt tables.
- **Execution** — L-cancel %, openings per kill, damage per opening, inputs per minute, with per-move effectiveness, opening moves, and kill-move impact.
- **Insights / Records / Game log** — a logistic-regression win-factor model with coaching hints, personal bests (streaks, fastest win, nemesis), and a game log with CSV export.
- **Teams** — 2v2 replays get one consolidated view (team-level W/L, teammate breakdowns) behind the singles/teams switch; they never mix into the singles aggregates.
- **Liquipedia** — competitive Melee history rather than your own play: majors per year by tier, an animated race of major titles ending in the all-time champions table, and top-100 character composition across every SSBMRank edition. It needs no replays, so it's reachable from the landing page as well as from a tab. See [Scene data](#scene-data-the-liquipedia-tab).

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # type-check + production build (CI gate)
npm run lint     # oxlint
npm run assets   # render the share images into public/share (gitignored)
```

## Scene data (the Liquipedia tab)

The tab reads `src/lib/liquipedia/data.ts`, a snapshot compiled from [Liquipedia's Smash wiki](https://liquipedia.net/smash) (content licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)) — [Major Tournaments/Melee](https://liquipedia.net/smash/Major_Tournaments/Melee), the [SSBMRank](https://liquipedia.net/smash/SSBMRank) editions, and player pages for career winnings. Every source is listed at the bottom of the tab.

It ships in the bundle rather than being fetched at runtime: the app has no backend, its CSP allows only itself and Supabase, and the tab has to work offline. A weekly GitHub Action refreshes it and commits any change, so new majors and each newly published year-end ranking arrive on their own (mid-season lists are skipped so a season isn't double-counted). The refresh is append-only and rate-limits itself hard; if Liquipedia throttles a run it exits 2 and leaves the file untouched.

```bash
node scripts/refresh-liquipedia.mjs                            # top up (what the Action runs)
node scripts/rebuild-liquipedia.mjs                            # re-derive everything, reusing known winnings
node scripts/rebuild-liquipedia.mjs --force                    # ...refetching player pages too (~30 min)
node scripts/inspect-liquipedia-page.mjs Hungrybox 'winnings'  # print the real markup when a parser misses
```

Rebuilding is manual on purpose — append-only means a parser fix can't reach existing rows, but a `--force` run makes two requests per champion spaced 30 seconds apart. When a parser stops matching, the figures have usually moved into rendered HTML; the inspect script prints the markup, and the **Inspect Liquipedia page** workflow runs it from a GitHub runner, which matters because Liquipedia blocks a development IP for hours after any burst.

Two counting decisions the tab states in-app:

- **Offline majors only.** The 2020–21 netplay era put 16 online events on the majors list, including individual weeks of online leagues sitting beside Genesis as equal titles. They're excluded from every total and kept in the dataset flagged `online: true` so the choice stays auditable.
- **Winnings are all-Smash.** Liquipedia's "approx. total winnings" spans every Smash title a player entered with no per-game breakdown to quote, so the column says *All-Smash career winnings* rather than implying Melee prize money.

Both animated charts have a **Share GIF** button that exports the animation at the selected playback speed, rendered entirely in your browser — on a phone it hands the GIF and a still to the share sheet. The same painters run headlessly during the Vercel deploy (`npm run build:deploy`) to produce the images served at `/share/…`, which back the Open Graph link previews. Those are built, never committed — a couple of megabytes of binary that can't delta-compress has no business in the history — and a failed render doesn't fail the deploy.

## Cloud sync (optional)

With no configuration the app is 100% local. When enabled, the cloud is a **mirror, not a backend**: the dashboard always renders from the local IndexedDB cache, and sync keeps that cache converged with the union of games from every device you've signed in on. So the app stays instant, works offline, and a failed sync means a stale mirror, never a broken dashboard.

To enable accounts and cross-device sync of the flattened `GameRecord` metadata (raw `.slp` files never leave the machine):

1. **Create a Supabase project** (free tier is fine) at [database.new](https://database.new).
2. **Create the tables**: paste [`supabase/schema.sql`](supabase/schema.sql) into the SQL Editor and run it. It creates `game_records` and `user_settings` with row-level security, so each user can only read and write their own rows.
3. **Enable Google sign-in**: in Google Cloud Console create an OAuth 2.0 Client ID (type "Web application") with redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`; paste the client ID and secret into Supabase → Authentication → Providers → Google. Add your app's URL (and `http://localhost:5173`) under Authentication → URL Configuration → Redirect URLs.
4. **Set the env vars**: copy `.env.example` to `.env.local`, and set the same `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in Vercel → Settings → Environment Variables. Both come from Supabase → Settings → API.

With the vars present, a "Sign in with Google" button appears in the header. Sync is two-way and idempotent — records are keyed `path|size|mtime`, so re-parsing the same files on another machine converges instead of duplicating — and automatic: on sign-in, shortly after new replays finish parsing, and when you return to an open tab. If an auto-sync fails (offline, say), the header button turns gold ("Sync N new games") as the manual fallback. On a new device the landing page offers **"Sign in with Google to restore"**, which pulls your synced stats and saved connect codes with no replay folder needed.

## Stack

Vite + React + TypeScript, [`@slippi/slippi-js`](https://github.com/project-slippi/slippi-js) for parsing, Dexie (IndexedDB), Recharts, `vite-plugin-pwa` (offline/install), `@supabase/supabase-js` (optional cloud sync), `html-to-image` (share card).

Character stock icons in `public/stock/` are from Super Smash Bros. Melee (© Nintendo / HAL Laboratory), sourced via [slippi-launcher](https://github.com/project-slippi/slippi-launcher); they are fan-project assets and not covered by this repository's MIT license.

## Roadmap

- Frame-level deep dives (wavedash/ledgedash quality) behind an opt-in re-parse
- Hosted read-only snapshot links (a PNG share card already exists on Overview)
