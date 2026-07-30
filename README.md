# SSBM Dashboard

Point it at your Slippi replay folder and get a full statistical readout of your Melee play: win rates by opponent, matchup, and stage; kill stats; and execution trends. **Everything is parsed in your browser — no uploads, no accounts, no server.**

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

## Stack

Vite + React + TypeScript, [`@slippi/slippi-js`](https://github.com/project-slippi/slippi-js) for parsing, Dexie (IndexedDB), Recharts.

Character stock icons in `public/stock/` are from Super Smash Bros. Melee (© Nintendo / HAL Laboratory), sourced via [slippi-launcher](https://github.com/project-slippi/slippi-launcher); they are fan-project assets and not covered by this repository's MIT license.

## Roadmap

- Sessions view with per-session W/L and tilt indicators
- Frame-level deep dives (wavedash/ledgedash quality) behind an opt-in re-parse
- Shareable read-only snapshots
