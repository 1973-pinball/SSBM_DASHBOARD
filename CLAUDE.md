# CLAUDE.md — SSBM Dashboard

## What this is

A zero-backend web app: a Melee player points their browser at their local Slippi replay folder and gets a stats dashboard. All parsing happens client-side via `@slippi/slippi-js` in web workers. **Nothing is ever uploaded — this is a hard product constraint, not an implementation detail.** Do not add servers, telemetry, accounts, or network calls that transmit replay-derived data.

## Architecture

```
folder pick ─► discovery (*.slp) ─► dedup vs IndexedDB ─► worker pool (slippi-js)
                                                              │ GameRecord (~1-2 KB)
              React dashboard ◄── memoized selectors ◄── IndexedDB (Dexie)
```

- `src/lib/pool.ts` — file discovery (FS Access API + `webkitdirectory` fallback), worker pool sized to `hardwareConcurrency`, batched flushes (25 records) so the UI streams in during parsing.
- `src/worker/parser.worker.ts` + `src/lib/parse.ts` — one replay → one `GameRecord`. Stats-only: frame data is computed over then discarded. Corrupt files get tombstone records (`parseError` set) so they're never re-parsed.
- `src/lib/db.ts` — Dexie/IndexedDB. Cache key is `path|size|mtime`. Browser-local persistence only.
- `src/lib/stats.ts` — identity inference + all aggregation selectors. Pure functions over `ResolvedGame[]`.
- `src/lib/demo.ts` — deterministic synthetic data (seeded PRNG); keep it deterministic.
- `src/components/` — Overview, Matchups, Stages, Opponents, Execution, GameLog, filters.

## Key decisions (do not silently reverse)

1. **Players are stored neutrally** in `GameRecord.players[]` with `winnerIndex`, NOT as self/opponent. Identity (the user's connect code(s)) is chosen after parsing and applied at query time (`resolveGames`). This makes alt accounts and identity changes free. Never bake "self" into the stored record.
2. **Win/loss ladder**: gameEnd placements → stock-out survivor → LRAS initiator loses. Games under 30 seconds are `winnerIndex: null` (indeterminate) and excluded from win-rate denominators but still shown in the game log.
3. **Frames are discarded.** Custom frame-level metrics (wavedash quality, ledgedashes) are a v2 feature behind an explicit opt-in re-parse — don't retain frames to make a feature easier.
4. **The "By mode" panel on Overview ignores the mode filter** (applies all other filters) so overall/ranked/unranked/direct rows are always all visible for comparison. Preserve this when refactoring filters.
5. **Priority of stats** (per owner): kills and win rates — by opponent (connect code), by opponent character, by own character — come first; execution metrics (L-cancel %, openings/kill, damage/opening, IPM) second. Sessions/tilt view is v2.

## Design system

Dark GameCube-indigo theme, tokens in `src/index.css` (`--bg #121022`, accent `#8f7ff7`, win `#3fcf8e`, loss `#f0564f`). Fonts: Chakra Petch (display), Inter (body), IBM Plex Mono (data — always tabular numerals for stats). Win-rate coloring goes through `winRateColor()` in `src/lib/format.ts`; don't introduce ad-hoc greens/reds.

## Conventions

- TypeScript strict; `npm run build` (tsc + vite) must pass before any push.
- Selectors in `stats.ts` must be single-pass O(n) — libraries can reach 30k+ games.
- New aggregate views: respect the global `Filters` and the click-to-filter pattern (clicking a row/cell scopes the dashboard).
- Sample-size honesty: any win-rate display over small n should fade or badge it (see matchup matrix `minGames`).
- Smoke-test selectors against demo data (`generateDemoRecords`) when touching `stats.ts`.

## Commands

```bash
npm install
npm run dev      # dev server; use demo mode on the landing page if no replays
npm run build    # type-check + production build (CI gate)
```
