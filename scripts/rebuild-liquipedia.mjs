#!/usr/bin/env node
// Rebuild src/lib/liquipedia/data.ts from scratch.
//
// The weekly refresh is append-only by design — it never rewrites history, so
// a parser fix or a schema change can't reach rows already in the file. This
// is the escape hatch: it re-derives the whole dataset from the source pages.
//
// It is deliberately not automated. --force makes two requests per champion
// (winnings from the rendered page, mains from the source) plus the two index
// pages, all serialized 30s apart — about half an hour at today's 25 champions.
// Re-fetching two dozen player pages weekly to confirm figures that rarely move
// would be rude to a wiki that already rate-limits us.
//
//   node scripts/rebuild-liquipedia.mjs            # keep known winnings
//   node scripts/rebuild-liquipedia.mjs --force    # re-fetch every player too
//
// Majors and rankings are always re-derived. Career winnings are reused from
// the existing file unless --force, because that's the slow half and the
// numbers move slowly.

import { existsSync } from "node:fs";
import {
  displayName,
  parseMajorsHtml,
  parsePlayerEarnings,
  parsePlayerMains,
  parseRankingEditions,
  playerKey,
  yearEndEditions,
} from "./lib/liquipedia-parse.mjs";
import { RateLimited, fetchPage } from "./lib/liquipedia-fetch.mjs";
import { DATA_PATH, SOURCES, readDataset, today, writeDataset } from "./lib/liquipedia-data.mjs";

const force = process.argv.includes("--force");
const log = (...a) => console.log(...a);

async function main() {
  // Existing winnings are worth keeping: they cost a request each and the
  // majors/rankings half of the file is what a rebuild is usually fixing.
  let known = new Map();
  if (!force && existsSync(DATA_PATH)) {
    try {
      const prev = readDataset();
      for (const [tag, meta] of Object.entries(prev.players)) known.set(playerKey(tag), meta);
      log(`reusing player details for ${known.size} players (--force to re-fetch)`);
    } catch (err) {
      log(`couldn't read the existing snapshot (${err.message}); rebuilding everything`);
    }
  }

  // ---- majors ----
  const majors = parseMajorsHtml(await fetchPage("Major_Tournaments/Melee", "text", log)).map(
    ({ winnerChars, ...m }) => ({ ...m, winnerChars }),
  );
  if (majors.length === 0) throw new Error("majors page parsed to zero rows — parser is out of date");
  const online = majors.filter((m) => m.online).length;
  log(`majors: ${majors.length} (${majors.filter((m) => m.tier === "supermajor").length} supermajors, ${online} online)`);

  // ---- rankings ----
  const editions = yearEndEditions(parseRankingEditions(await fetchPage("SSBMRank", "wikitext", log)))
    .map((e) => ({
      year: e.year,
      title: e.title,
      url: e.url,
      entries: e.entries.map((x) => ({ rank: x.rank, player: displayName(x.player), chars: x.chars })),
    }))
    .sort((a, b) => a.year - b.year);
  if (editions.length === 0) throw new Error("SSBMRank parsed to zero editions — parser is out of date");
  log(`editions: ${editions.map((e) => `${e.title}(${e.entries.length})`).join(", ")}`);

  // A player's best-ever ranked finish is a good fallback for their main when
  // their own page doesn't spell it out.
  const rankMains = new Map();
  for (const ed of editions) {
    for (const e of ed.entries) {
      const k = playerKey(e.player);
      const cur = rankMains.get(k);
      if (e.chars.length && (!cur || e.rank < cur.rank)) rankMains.set(k, { rank: e.rank, chars: e.chars });
    }
  }

  // ---- players ----
  const winners = [...new Set(majors.map((m) => m.winner))];
  const players = {};
  let fetched = 0;
  for (const tag of winners) {
    const k = playerKey(tag);
    const prev = known.get(k);
    if (prev && prev.earningsUsd !== null) {
      players[tag] = prev;
      continue;
    }
    try {
      const earnings = parsePlayerEarnings(await fetchPage(tag, "text", log));
      const mains = parsePlayerMains(await fetchPage(tag, "wikitext", log));
      players[tag] = {
        earningsUsd: earnings,
        mains: mains.length
          ? mains
          : (rankMains.get(k)?.chars ?? majors.find((m) => m.winner === tag)?.winnerChars ?? []),
      };
      fetched++;
      log(`  ${tag}: ${earnings === null ? "winnings unlisted" : `$${earnings.toLocaleString("en-US")}`}`);
    } catch (err) {
      if (err instanceof RateLimited) throw err;
      players[tag] = {
        earningsUsd: prev?.earningsUsd ?? null,
        mains: prev?.mains?.length ? prev.mains : (rankMains.get(k)?.chars ?? []),
      };
      log(`  ${tag}: ${err.message}`);
    }
  }
  log(`players: ${winners.length} (${fetched} fetched, ${winners.length - fetched} reused)`);

  writeDataset(
    { sources: SOURCES, majors: majors.map(({ winnerChars: _drop, ...m }) => m), editions, players },
    today(),
  );
  log(`wrote ${DATA_PATH}`);
  log("re-render the share images next: node scripts/render-liquipedia-assets.mjs");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(err instanceof RateLimited ? 2 : 1);
});
