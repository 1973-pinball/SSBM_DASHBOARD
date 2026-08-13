# CLAUDE.md — SSBM Dashboard

## What this is

A zero-backend web app: a Melee player points their browser at their local Slippi replay folder and gets a stats dashboard. All parsing happens client-side via `@slippi/slippi-js` in web workers. The privacy contract, precisely:

1. **Raw `.slp` files never leave the machine — hard product constraint, no exceptions.**
2. Parsed `GameRecord` stats (~1–2 KB/game) may sync, but only **opt-in**, only to the **user's own Supabase project**, behind `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` env vars, with per-user row-level security. Without those vars `supabase` is `null`, `CloudSync` renders nothing, and the app is exactly the local-only tool described here.
3. No telemetry, analytics, or any other non-opt-in transmission of replay-derived data — ever.

## Architecture

```
folder pick ─► discovery (*.slp) ─► dedup vs IndexedDB ─► worker pool (slippi-js)
                                                              │ GameRecord (~1-2 KB)
              React dashboard ◄── memoized selectors ◄── IndexedDB (Dexie)
                                                              │ opt-in, stats only
                                                        Supabase (user's own project)
```

- `src/lib/pool.ts` — file discovery (FS Access API + `webkitdirectory` fallback), worker pool sized to `hardwareConcurrency`. DB flushes are batched (25 records) on a promise chain — storage failures surface as `RecordSaveError` after the run, never as silent loss. UI delivery is time-throttled (~1 s for records, 250 ms for progress counts) because every record append invalidates App's O(n log n) resolve+sort. An `AbortSignal` (App's reset) stops feeding, flushing, and callbacks; parsed-but-unflushed work is dropped by design.
- `src/worker/parser.worker.ts` + `src/lib/parse.ts` — one replay → one `GameRecord`. Stats-only: frame data is computed over then discarded. Corrupt files get tombstone records (`parseError` set) so they're never re-parsed.
- `src/lib/db.ts` — Dexie/IndexedDB. Cache key is `path|size|mtime`. Records live packed ~250/row (`packs`) with an id-only `seen` table for dedup — per-row IndexedDB overhead made 30k-game restores slow. Browser-local; optionally mirrored to the user's own Supabase when cloud sync is configured. Also stores the picked `FileSystemDirectoryHandle` in `kv` so a return visit can re-walk the folder without re-prompting: the app auto-rescans on load when the permission is still granted, and the topbar **Refresh** button re-requests it (needed after a browser restart) — both dedup against the cache, so only new replays parse. **Change folder** is the full reset (`clearAll` + abort + generation bump).
- `src/lib/stats.ts` — identity inference + all aggregation selectors. Pure functions over `ResolvedGame[]`.
- `src/lib/model.ts` + `src/worker/model.worker.ts` — logistic-regression win model (IRLS, O(iterations·n·k²)) fitted in a worker with plain-data in/out; `null` model means "not enough data". `src/lib/coach.ts` — z-score- and sample-size-gated recommendations. Both feed the Insights view, which caches fits by games-array identity so tab revisits don't refit.
- `src/lib/supabase.ts` / `src/lib/cloudSync.ts` / `src/components/CloudSync.tsx` / `supabase/schema.sql` — optional cloud sync. Cloud rows are keyed `(user_id, id)` where `id = path|size|mtime`, so re-parsing the same files anywhere upserts idempotently. Sync is a two-way id diff: push local-only non-tombstone records (500-row chunks), pull remote-only ones straight into the local cache. The landing page's "Sign in with Google to restore" covers the fresh-device case (empty local cache ⇒ pure pull, including saved connect codes). The header button turns gold with a count when games were parsed since the last sync.
- `src/lib/demo.ts` — deterministic synthetic data (seeded PRNG); keep it deterministic.
- `src/components/` — Overview (+ ShareCard PNG export), Teams, Sessions, Insights, Records, MetricsGuide, CloudSync, FilterBar, Landing, and Views.tsx (Matchups, Stages, Opponents, Execution, GameLog). Views are lazy chunks — which is why the PWA precache must cover everything.

## Key decisions (do not silently reverse)

1. **Players are stored neutrally** in `GameRecord.players[]` with `winnerIndex` (singles) / `winnerTeamId` (teams), NOT as self/opponent. Identity (the user's connect code(s)) is chosen after parsing and applied at query time (`resolveGames` / `resolveTeamGames`). This makes alt accounts and identity changes free. Never bake "self" into the stored record.
   - **Singles vs teams is an axis separate from `gameType`** — a 2v2 is still ranked/direct/offline. `Filters.format` switches the dashboard between the singles tab set and the single consolidated `Teams` view; the two never mix in one aggregation. Teams selectors resolve me/teammate/opps and win/loss at the team level. `resolveTeamGames` skips anything that isn't a clean 4-player two-team game rather than guessing a teammate.
2. **Win/loss ladder**: gameEnd placements → stock-out survivor → LRAS initiator loses. Games under 30 seconds are `winnerIndex: null` (indeterminate) and excluded from win-rate denominators but still shown in the game log.
3. **Frames are discarded.** Custom frame-level metrics (wavedash quality, ledgedashes) are a future feature behind an explicit opt-in re-parse — don't retain frames to make a feature easier.
   - When a new per-game stat is added, bump the Dexie version and **clear `packs` + `seen`** (see the v9–v11 migrations in `db.ts` for the template; `games` is a legacy empty store since v8). A one-time full re-parse beats mixed-schema rows silently understating averages; don't build per-row schema versioning or lazy re-parse machinery for this.
4. **The "By mode" panel on Overview ignores the mode filter** (applies all other filters) so overall/ranked/unranked/direct rows are always all visible for comparison. Preserve this when refactoring filters.
5. **Only tournament-legal stages count** — `INCLUDED_STAGE_IDS` in `src/lib/config.ts`; games on other stages are dropped at resolve time and never reach any view.
6. **Priority of stats** (per owner): kills and win rates — by opponent (connect code), by opponent character, by own character — come first; execution metrics (L-cancel %, openings/kill, damage/opening, IPM) second. Sessions exist (a session = games separated by <30-minute gaps — that boundary is load-bearing for the tilt tables; don't change it casually).

## Design system

Dark GameCube-indigo theme, tokens in `src/index.css` (`--bg #121022`, accent `#8f7ff7`, win `#3fcf8e`, loss `#f0564f`, gold `#e8b54d` = attention, e.g. unsynced games). Fonts: Chakra Petch (display), Inter (body), IBM Plex Mono (data — always tabular numerals for stats). Win-rate coloring goes through `winRateColor()` in `src/lib/format.ts`; don't introduce ad-hoc greens/reds. Chart styling goes through `src/components/chartStyle.ts` (`axisStyle`, `tooltipStyle`, `gridStyle`, `dayTick`); **red is reserved for loss/danger** — comparison series like opponent overlays use `OPP_SERIES_COLOR` (muted, dashed), never red.

## Conventions

- TypeScript strict **plus `noUncheckedIndexedAccess`** — indexing returns `T | undefined`; use the guard-then-`!` pattern already established in `pool.ts`/`parse.ts` rather than weakening types. `npm run build` (tsc + vite) must pass before any push.
- Selectors in `stats.ts` must be single-pass O(n) — libraries can reach 30k+ games.
- **Day/week bucketing is local time** (`localDay` and friends in `stats.ts`) — never `toISOString()` for day keys; date-only strings parse as UTC and shift a day west of Greenwich.
- New aggregate views: respect the global `Filters` and the click-to-filter pattern (clicking a row/cell scopes the dashboard).
- Sample-size honesty: any win-rate display over small n should fade or badge it (see matchup matrix `minGames`).
- Smoke-test selectors against demo data (`generateDemoRecords`) when touching `stats.ts`.

## Deployment

Vercel, deploying `main`. Two things to know before touching config:

- **PWA**: `vite-plugin-pwa` (`registerType: autoUpdate`) precaches the entire shell — all lazy chunks, fonts, icons — so the app works offline. If you add a new asset *type*, check `globPatterns` in `vite.config.ts` covers it.
- **CSP** in `vercel.json` allows connections only to self + `*.supabase.co`. Any new network destination must be added there deliberately — a blocked request in production is the symptom.

## Commands

```bash
npm install
npm run dev      # dev server; use demo mode on the landing page if no replays
npm run build    # type-check + production build (CI gate)
```
