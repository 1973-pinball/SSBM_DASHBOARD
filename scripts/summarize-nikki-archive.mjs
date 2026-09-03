#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [resultsDir, output] = process.argv.slice(2);
if (!resultsDir || !output) {
  throw new Error("Usage: summarize-nikki-archive.mjs RESULTS_DIR OUTPUT.json");
}

const normalize = (value) => value?.trim().toLocaleLowerCase("en-US") || null;
const eventId = (bundle) => bundle
  .replace(/\.(?:7z|zip)$/i, "")
  .replace(/-(?:main-stream|streams?|top-8|r2-offstream)$/i, "");

const resultFiles = (await readdir(resultsDir))
  .filter((name) => name.endsWith(".json"))
  .sort();
const bundles = [];
for (const name of resultFiles) {
  const payload = JSON.parse(await readFile(path.join(resultsDir, name), "utf8"));
  bundles.push(payload);
}

const allRecords = bundles.flatMap((bundle) => bundle.records.map((record) => ({
  ...record,
  bundle: bundle.bundle,
  eventId: eventId(bundle.bundle),
})));
const parsed = allRecords.filter((record) => record.ok);
const failed = allRecords.filter((record) => !record.ok);

// A copied replay can appear in a full-event and stream/top-eight bundle. The
// key comes only from replay contents, so bundle and path cannot influence it.
const gamesByKey = new Map();
for (const record of parsed) {
  const key = record.identityKey ?? `${record.bundle}/${record.file}`;
  const current = gamesByKey.get(key);
  if (!current || `${record.bundle}/${record.file}` < `${current.bundle}/${current.file}`) {
    gamesByKey.set(key, record);
  }
}
const games = [...gamesByKey.values()];
const eligibleGames = games.filter((record) =>
  record.legalStage && record.playableRoster && record.players.length >= 2,
);

const identityFor = (player, event) => {
  if (player.connectCode) return { id: `code:${player.connectCode}`, confidence: "exact" };
  if (player.userIdHash) return { id: `uid:${player.userIdHash}`, confidence: "exact" };
  const display = normalize(player.displayName);
  if (display) return { id: `display:${display}`, confidence: "probable" };
  const tag = normalize(player.nametag);
  if (tag) return { id: `event:${event}:tag:${tag}`, confidence: "event-only" };
  return null;
};

const players = new Map();
let playerSlots = 0;
let identifiedSlots = 0;
for (const game of eligibleGames) {
  for (const player of game.players) {
    playerSlots++;
    const identity = identityFor(player, game.eventId);
    if (!identity) continue;
    identifiedSlots++;
    const row = players.get(identity.id) ?? {
      id: identity.id,
      confidence: identity.confidence,
      games: 0,
      events: new Set(),
      connectCodes: new Set(),
      displayNames: new Set(),
      nametags: new Set(),
      characters: new Map(),
    };
    row.games++;
    row.events.add(game.eventId);
    if (player.connectCode) row.connectCodes.add(player.connectCode);
    if (player.displayName) row.displayNames.add(player.displayName);
    if (player.nametag) row.nametags.add(player.nametag);
    row.characters.set(player.characterId, (row.characters.get(player.characterId) ?? 0) + 1);
    players.set(identity.id, row);
  }
}

const playerRows = [...players.values()].map((row) => ({
  ...row,
  events: [...row.events].sort(),
  connectCodes: [...row.connectCodes].sort(),
  displayNames: [...row.displayNames].sort(),
  nametags: [...row.nametags].sort(),
  characters: [...row.characters.entries()]
    .map(([characterId, games]) => ({ characterId, games }))
    .sort((a, b) => b.games - a.games || a.characterId - b.characterId),
})).sort((a, b) => b.games - a.games || a.id.localeCompare(b.id));

const thresholdCounts = Object.fromEntries([1, 5, 10, 25, 50, 100]
  .map((minimum) => [minimum, playerRows.filter((player) => player.games >= minimum).length]));
const formats = {
  singles: eligibleGames.filter((game) => !game.isTeams && game.players.length === 2).length,
  teams: eligibleGames.filter((game) => game.isTeams).length,
  other: eligibleGames.filter((game) => !game.isTeams && game.players.length !== 2).length,
};
const modes = {};
for (const game of eligibleGames) modes[game.gameType] = (modes[game.gameType] ?? 0) + 1;
const dated = games.map((game) => game.playedAt).filter(Boolean).sort();

const report = {
  schemaVersion: 1,
  source: "https://replays.nikki.sh/",
  generatedAt: new Date().toISOString(),
  bundlesAnalyzed: bundles.length,
  replayFiles: allRecords.length,
  parsedReplayFiles: parsed.length,
  failedReplayFiles: failed.length,
  duplicateReplayCopies: parsed.length - games.length,
  uniqueGames: games.length,
  eligibleGames: eligibleGames.length,
  excludedGames: games.length - eligibleGames.length,
  formats,
  modes,
  recordedHours: eligibleGames.reduce((sum, game) => sum + game.durationFrames / 60 / 3600, 0),
  dateRange: { first: dated[0] ?? null, last: dated.at(-1) ?? null },
  identityCoverage: {
    playerSlots,
    identifiedSlots,
    unidentifiedSlots: playerSlots - identifiedSlots,
    identifiedPercent: playerSlots ? identifiedSlots / playerSlots : 0,
    distinctRecordedIdentities: playerRows.length,
    exactIdentities: playerRows.filter((player) => player.confidence === "exact").length,
    probableIdentities: playerRows.filter((player) => player.confidence === "probable").length,
    eventOnlyIdentities: playerRows.filter((player) => player.confidence === "event-only").length,
    playersAtLeastGames: thresholdCounts,
  },
  bundles: bundles.map((bundle) => ({
    bundle: bundle.bundle,
    eventId: eventId(bundle.bundle),
    replayFiles: bundle.replayFiles,
    parsed: bundle.parsed,
    failed: bundle.failed,
  })),
  topRecordedIdentities: playerRows.slice(0, 250),
  parseErrors: Object.entries(failed.reduce((counts, record) => {
    counts[record.error] = (counts[record.error] ?? 0) + 1;
    return counts;
  }, {})).map(([error, count]) => ({ error, count })).sort((a, b) => b.count - a.count),
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  bundlesAnalyzed: report.bundlesAnalyzed,
  replayFiles: report.replayFiles,
  uniqueGames: report.uniqueGames,
  distinctRecordedIdentities: report.identityCoverage.distinctRecordedIdentities,
  output,
})}\n`);
