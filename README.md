# SSBM Stats

Production: [ssbmstats.com](https://ssbmstats.com/)

Point it at your Slippi replay folder and get a full statistical readout of your Melee play: win rates by opponent, matchup, and stage; kill stats; and execution trends. **Everything is parsed in your browser — your replays never leave your machine.** An optional Google sign-in ([Cloud sync](#cloud-sync-optional)) mirrors your parsed stats — never raw replays — across devices; without it the app stays fully local.

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
- **Game identity** (`src/lib/dedupe.ts`): that cache key identifies a *file*, not a game — copying the replay folder changes every path, a Dropbox or network share rewrites mtimes, and re-filing replays into subfolders changes both, each producing a second record for a game already held. `gameKey()` derives identity from the replay's own contents (start time, stage, players) so those duplicates collapse instead of inflating game counts and win-rate denominators.
- **Identity** (`src/lib/stats.ts`): games store both players neutrally, and you enter your own connect code(s) — nothing is guessed, because frequency ranking can't tell an alt from a regular opponent. Several accounts are normal: they're pooled by default, split apart with the **Account** filter, and can be labelled ("Main", "Alt") so they read as `Main (ABCD#123)` throughout. Adding, renaming, or removing an account is a recompute, never a re-parse.
- **Win/loss**: placements → stock-out survivor → LRAS initiator loses. Games under 30 seconds are indeterminate and excluded from win-rate aggregates, but still listed in the game log.
- **Installable PWA**: the whole app shell is precached (`vite-plugin-pwa`), so the dashboard installs like an app and loads offline against the local cache. The service worker is registered manually in `src/main.tsx` and polls for new deploys hourly, so long-lived tabs pick up updates; the footer stamps the deployed build commit.

## Views

Filters (date range, mode, character, stage, opponent, and account when you have more than one) are global, and clicking a row or cell scopes the whole dashboard to it. Every metric is defined in the in-app **Metrics guide**.

- **Overview** — KPIs, rolling win rate, weekly volume, a per-character table (win rate, kills, L-cancel), and an exportable share-card PNG. With several accounts it also breaks results down per account, which — like the mode table — ignores the account filter so they stay comparable.
- **Matchups / Stages / Opponents** — character × character matrix, per-stage and stage × opponent-character counterpick tables, per-opponent records with recent sets.
- **Sessions** — a session is games separated by gaps under 30 minutes: per-session W/L plus fatigue and tilt tables.
- **Execution** — L-cancel %, openings per kill, damage per opening, inputs per minute, with per-move effectiveness, opening moves, and kill-move impact.
- **Insights / Records / Game log** — a logistic-regression win-factor model with coaching hints, personal bests (streaks, fastest win, nemesis), and a game log with CSV export.
- **Community** — thresholded, aggregate-only Matchup Atlas, personal-vs-community execution quartiles, Move Atlas, Stage Lab, and monthly Community Pulse. It is public from the landing page; contributing is a separate, default-off choice in My Account.
- **Teams** — 2v2 replays get one consolidated view (team-level W/L, teammate breakdowns) behind the singles/teams switch; they never mix into the singles aggregates.
- **Liquipedia** — competitive Melee history rather than your own play: majors per year by tier, an animated race of major titles ending in the all-time champions table, and top-100 character composition across every SSBMRank edition. It needs no replays, so it's reachable from the landing page as well as from a tab. See [Scene data](#scene-data-the-liquipedia-tab).

## Development

```bash
npm install
npm run dev      # dev server
npm run build    # type-check + production build — must pass before any push (nothing in CI gates it)
npm run preview  # serve the production build locally
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

**Which Supabase project the stats land in depends on the deployment.** The steps below stand up your own, so a self-hosted instance mirrors to infrastructure you control. On the hosted [ssbmstats.com](https://ssbmstats.com/) they land in the operator's project instead, where row-level security scopes every row to the account that wrote it and no other signed-in user can read them.

To enable accounts and cross-device sync of the flattened `GameRecord` metadata (raw `.slp` files never leave the machine):

1. **Create a Supabase project** (free tier is fine) at [database.new](https://database.new).
2. **Create the tables**: paste [`supabase/schema.sql`](supabase/schema.sql) into the SQL Editor and run it. For Community Lab, run [`supabase/community.sql`](supabase/community.sql) afterwards and schedule `select public.refresh_community_snapshot();` with Supabase Cron. The private tables use row-level security; public clients can select only the precomputed aggregate snapshot.
3. **Enable Google sign-in**: in Google Cloud Console create an OAuth 2.0 Client ID (type "Web application") with redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`; paste the client ID and secret into Supabase → Authentication → Providers → Google. Add your app's URL (and `http://localhost:5173`) under Authentication → URL Configuration → Redirect URLs.
4. **Set the env vars**: copy `.env.example` to `.env.local`, and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and the production `VITE_SITE_URL` in Vercel → Settings → Environment Variables. The Supabase values come from Supabase → Settings → API.

With the vars present, a "Sign in with Google" button appears in the header. Sync is two-way and idempotent — rows are keyed `path|size|mtime`, and carry a content-derived `game_key` besides, so a device that parsed the same games from its own copy of the folder converges instead of uploading a second copy of everything. It's automatic: on sign-in, shortly after new replays finish parsing, and when you return to an open tab. If an auto-sync fails (offline, say), the header button turns gold ("Sync N new games") as the manual fallback. On a new device the landing page offers **"Sign in with Google to restore"**, which pulls your synced stats and saved accounts with no replay folder needed.

**Only games one of your own accounts played are uploaded.** A shared replay folder holds other people's games too; those are parsed and cached locally — identity is resolved at query time, so adding an account later still claims them — but they aren't yours to put in the cloud.

### Community contribution and privacy

Private cloud sync is not permission to publish community statistics. The Community contribution switch in **My Account** is a separate consent, starts off, and can be switched off again. The scheduled refresh reads only currently consenting accounts and publishes one aggregate snapshot. It does not expose Google user IDs, emails, connect codes, display names, replay paths, file IDs, exact timestamps, or source rows. Cells require at least 25 distinct contributors and 100 player-games; rare move groups and time buckets remain absent even when a broader cohort qualifies.

The public tab deliberately has no player search, leaderboards, opponent reports, geographic inference, exact activity timeline, rare-cohort explorer, or row-level download. Execution quartiles first average each contributor, so unusually large replay libraries do not dominate the benchmark. Turning contribution off removes that account from the next full snapshot rebuild.

The in-app **Privacy promise** makes two commitments explicit: replay-derived data is never published or distributed beyond a user's private cloud account without this separate opt-in, and an email address is used only to operate authentication — never sold, published, used for marketing, or shared for outreach.

### Professional Google OAuth

`signInWithGoogle()` always returns through the exact `VITE_SITE_URL/?auth=return` URL and removes the temporary marker after the session is restored. To replace the random Supabase project reference on Google's handoff screen, configure a Supabase custom domain or vanity subdomain and Google consent-screen branding. The complete staged checklist is in [`supabase/AUTH_BRANDING.md`](supabase/AUTH_BRANDING.md); it includes DNS, both Google callback URLs, the public privacy URL, Vercel CSP, and rollback-safe activation order.

## Stack

Vite + React + TypeScript, [`@slippi/slippi-js`](https://github.com/project-slippi/slippi-js) for parsing, Dexie (IndexedDB), Recharts, `vite-plugin-pwa` (offline/install), `@supabase/supabase-js` (optional cloud sync), `html-to-image` (share card).

Character stock icons in `public/stock/` are from Super Smash Bros. Melee (© Nintendo / HAL Laboratory), sourced via [slippi-launcher](https://github.com/project-slippi/slippi-launcher); they are fan-project assets and not covered by this repository's MIT license.

## Roadmap

- Frame-level deep dives (wavedash/ledgedash quality) behind an opt-in re-parse
- Hosted read-only snapshot links (a PNG share card already exists on Overview)
