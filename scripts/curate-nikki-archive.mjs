#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [resultsDir, output] = process.argv.slice(2);
if (!resultsDir || !output) {
  throw new Error("Usage: curate-nikki-archive.mjs RESULTS_DIR OUTPUT.json");
}

const MIN_GAME_FRAMES = 30 * 60;
const MAX_SET_GAMES = 10;
const SET_GAP_MS = 30 * 60 * 1000;
const BROADCAST_BUNDLE = /-(?:main-stream|streams?|top-8|r2-offstream)\.(?:7z|zip)$/i;
const BRACKET_PATH = /(?:^|[/\\ _-])(?:bracket|pools?|top[-_ ]?\d+|stream|broadcast)(?:$|[/\\ _-])/i;
const FRIENDLY_PATH = /(?:^|[/\\ _-])(?:friendlies?|warm[-_ ]?ups?|hand[-_ ]?warmers?|casuals?)(?:$|[/\\ _-])/i;
const NON_TOURNAMENT_EVENTS = new Set(["personal-pre-slippi-online"]);
const VERIFIED_EVENTS = new Set(["the-match-zain-vs-cody"]);

const normalize = (value) => value?.trim().toLocaleLowerCase("en-US") || null;
const eventIdFor = (bundle) => bundle
  .replace(/\.(?:7z|zip)$/i, "")
  .replace(/-(?:main-stream|streams?|top-8|r2-offstream)$/i, "");

const playerIdentity = (player, eventId) => {
  if (player.connectCode) return `code:${player.connectCode.toUpperCase()}`;
  if (player.userIdHash) return `uid:${player.userIdHash}`;
  const display = normalize(player.displayName);
  if (display) return `display:${display}`;
  const tag = normalize(player.nametag);
  if (tag) return `event:${eventId}:tag:${tag}`;
  return null;
};

const globallyCollapsedPlayerIdentity = (player) => {
  if (player.connectCode) return `code:${player.connectCode.toUpperCase()}`;
  if (player.userIdHash) return `uid:${player.userIdHash}`;
  const display = normalize(player.displayName);
  if (display) return `display:${display}`;
  const tag = normalize(player.nametag);
  if (tag) return `tag:${tag}`;
  return null;
};

const rosterKeyFor = (record, eventId) => {
  const sides = record.players.map((player) => ({
    id: playerIdentity(player, eventId),
    teamId: player.teamId,
  }));
  if (sides.some((side) => !side.id)) return null;
  if (!record.isTeams) return sides.map((side) => side.id).sort().join(" vs ");
  const teams = new Map();
  for (const side of sides) {
    const key = side.teamId ?? "unknown";
    const members = teams.get(key) ?? [];
    members.push(side.id);
    teams.set(key, members);
  }
  return [...teams.values()]
    .map((members) => members.sort().join("+"))
    .sort()
    .join(" vs ");
};

const technicalExclusion = (record) => {
  if (!record.legalStage) return "illegal-stage";
  if (!record.playableRoster) return "invalid-roster";
  if (!record.isTeams && record.players.length !== 2) return "invalid-singles-format";
  if (record.isTeams) {
    if (record.players.length !== 4) return "invalid-doubles-format";
    const teamSizes = new Map();
    for (const player of record.players) {
      if (player.teamId === null || player.teamId === undefined) return "invalid-doubles-format";
      teamSizes.set(player.teamId, (teamSizes.get(player.teamId) ?? 0) + 1);
    }
    if (teamSizes.size !== 2 || [...teamSizes.values()].some((size) => size !== 2)) {
      return "invalid-doubles-format";
    }
  }
  if (record.durationFrames < MIN_GAME_FRAMES) return "under-30-seconds";
  return null;
};

const hasDeterminateWinner = (record) => record.isTeams
  ? record.winnerTeamId !== null
  : record.winnerIndex !== null;

const stationKeyFor = (record) => {
  const directory = path.posix.dirname(record.file.replaceAll("\\", "/")).toLocaleLowerCase("en-US");
  return `${directory}|${normalize(record.consoleNick) ?? "unknown-console"}`;
};

const files = (await readdir(resultsDir)).filter((name) => name.endsWith(".json")).sort();
const bundleRows = [];
const gamesByKey = new Map();
const failedReasons = new Map();
let replayFiles = 0;
let parsedFiles = 0;
let failedFiles = 0;
let duplicateFiles = 0;

for (const name of files) {
  const payload = JSON.parse(await readFile(path.join(resultsDir, name), "utf8"));
  const eventId = eventIdFor(payload.bundle);
  const bundleRow = {
    bundle: payload.bundle,
    eventId,
    replayFiles: payload.replayFiles,
    parsed: payload.parsed,
    failed: payload.failed,
    duplicateCopies: 0,
    uniqueGames: 0,
    buckets: { verifiedBracket: 0, probableBracket: 0, unclassifiedVenue: 0, excludedOrIncomplete: payload.failed },
  };
  bundleRows.push(bundleRow);
  replayFiles += payload.replayFiles;
  parsedFiles += payload.parsed;
  failedFiles += payload.failed;
  for (const record of payload.records) {
    if (!record.ok) {
      failedReasons.set(record.error, (failedReasons.get(record.error) ?? 0) + 1);
      continue;
    }
    const key = record.identityKey ?? `${payload.bundle}/${record.file}`;
    const broadcastEvidence = BROADCAST_BUNDLE.test(payload.bundle) || BRACKET_PATH.test(record.file);
    const explicitFriendly = FRIENDLY_PATH.test(record.file);
    const hasTournamentSource = !NON_TOURNAMENT_EVENTS.has(eventId);
    const existing = gamesByKey.get(key);
    if (existing) {
      duplicateFiles++;
      bundleRow.duplicateCopies++;
      bundleRow.buckets.excludedOrIncomplete++;
      existing.broadcastEvidence ||= broadcastEvidence;
      existing.explicitFriendly &&= explicitFriendly;
      existing.hasTournamentSource ||= hasTournamentSource;
      existing.sourceBundles.add(payload.bundle);
      continue;
    }
    bundleRow.uniqueGames++;
    gamesByKey.set(key, {
      key,
      bundle: payload.bundle,
      bundleRow,
      eventId,
      file: record.file,
      stationKey: stationKeyFor(record),
      timeMs: record.playedAt ? Date.parse(record.playedAt) : Number.NaN,
      durationFrames: record.durationFrames,
      isTeams: record.isTeams,
      winrateEligible: hasDeterminateWinner(record),
      rosterKey: rosterKeyFor(record, eventId),
      technicalExclusion: technicalExclusion(record),
      broadcastEvidence,
      explicitFriendly,
      hasTournamentSource,
      sourceBundles: new Set([payload.bundle]),
      bucket: null,
      reason: null,
    });
  }
}

const games = [...gamesByKey.values()];
const sequenceCandidates = games.filter((game) =>
  !game.technicalExclusion && game.hasTournamentSource && !game.explicitFriendly && game.rosterKey,
);
const byStation = new Map();
for (const game of sequenceCandidates) {
  const key = `${game.eventId}|${game.stationKey}`;
  const rows = byStation.get(key) ?? [];
  rows.push(game);
  byStation.set(key, rows);
}

const plausibleSetKeys = new Set();
const setSizeHistogram = {};
let sequenceNumber = 0;
for (const rows of byStation.values()) {
  rows.sort((a, b) => {
    if (Number.isFinite(a.timeMs) && Number.isFinite(b.timeMs) && a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    return a.file.localeCompare(b.file);
  });
  let group = [];
  const flush = () => {
    if (!group.length) return;
    setSizeHistogram[group.length] = (setSizeHistogram[group.length] ?? 0) + 1;
    if (group.length >= 2 && group.length <= MAX_SET_GAMES) {
      const setId = `sequence:${sequenceNumber++}`;
      for (const game of group) plausibleSetKeys.add(`${setId}|${game.key}`);
    }
    group = [];
  };
  for (const game of rows) {
    const previous = group.at(-1);
    const comparableTimes = previous && Number.isFinite(previous.timeMs) && Number.isFinite(game.timeMs);
    const withinGap = comparableTimes ? game.timeMs - previous.timeMs <= SET_GAP_MS && game.timeMs >= previous.timeMs : true;
    if (previous && (previous.rosterKey !== game.rosterKey || !withinGap)) flush();
    group.push(game);
  }
  flush();
}

// Convert the set-instance membership above to replay-key membership.
const plausibleReplayKeys = new Set([...plausibleSetKeys].map((value) => value.slice(value.indexOf("|") + 1)));
const uniqueBuckets = { verifiedBracket: 0, probableBracket: 0, unclassifiedVenue: 0, excludedOrIncomplete: 0 };
const exclusionReasons = new Map();
for (const [error, count] of failedReasons) exclusionReasons.set(`parse:${error}`, count);
exclusionReasons.set("duplicate-copy", duplicateFiles);

for (const game of games) {
  if (game.technicalExclusion) {
    game.bucket = "excludedOrIncomplete";
    game.reason = game.technicalExclusion;
  } else if (!game.hasTournamentSource) {
    game.bucket = "excludedOrIncomplete";
    game.reason = "non-tournament-source";
  } else if (game.explicitFriendly) {
    game.bucket = "excludedOrIncomplete";
    game.reason = "explicit-friendly-or-warmup-path";
  } else if (VERIFIED_EVENTS.has(game.eventId)) {
    game.bucket = "verifiedBracket";
    game.reason = "manually-verified-event-format";
  } else if (game.broadcastEvidence) {
    game.bucket = "probableBracket";
    game.reason = "broadcast-or-bracket-path";
  } else if (plausibleReplayKeys.has(game.key)) {
    game.bucket = "probableBracket";
    game.reason = "identified-players-in-2-to-10-game-sequence";
  } else {
    game.bucket = "unclassifiedVenue";
    game.reason = "tournament-labeled-archive-without-set-level-proof";
  }
  uniqueBuckets[game.bucket]++;
  game.bundleRow.buckets[game.bucket]++;
  if (game.bucket === "excludedOrIncomplete") {
    exclusionReasons.set(game.reason, (exclusionReasons.get(game.reason) ?? 0) + 1);
  }
}

const fileBuckets = {
  verifiedBracket: uniqueBuckets.verifiedBracket,
  probableBracket: uniqueBuckets.probableBracket,
  unclassifiedVenue: uniqueBuckets.unclassifiedVenue,
  excludedOrIncomplete: uniqueBuckets.excludedOrIncomplete + failedFiles + duplicateFiles,
};

const makeMetrics = () => ({
  games: 0,
  singles: 0,
  doubles: 0,
  winrateEligibleGames: 0,
  recordedHours: 0,
  playerSlots: 0,
  identifiedPlayerSlots: 0,
  identities: new Set(),
  globallyCollapsedIdentities: new Set(),
  lCancelSuccess: 0,
  lCancelFail: 0,
  techSuccess: 0,
  techMissed: 0,
  moveAttempts: 0,
  moveHits: 0,
  moveKills: 0,
  moveDamage: 0,
  neutralWins: 0,
  totalDamage: 0,
  inputsPerMinuteSum: 0,
  inputsPerMinuteSamples: 0,
  stages: new Map(),
  characters: new Map(),
  matchups: new Map(),
  characterStages: new Map(),
});

const addMetricGame = (metrics, record, eventId) => {
  metrics.games++;
  if (record.isTeams) metrics.doubles++;
  else metrics.singles++;
  if (hasDeterminateWinner(record)) metrics.winrateEligibleGames++;
  metrics.recordedHours += record.durationFrames / 60 / 3600;
  metrics.stages.set(record.stageId, (metrics.stages.get(record.stageId) ?? 0) + 1);
  if (!record.isTeams && record.winnerIndex !== null && record.players.length === 2) {
    for (let index = 0; index < record.players.length; index++) {
      const player = record.players[index];
      const opponent = record.players[index === 0 ? 1 : 0];
      const won = record.winnerIndex === index;
      const matchupKey = `${player.characterId}|${opponent.characterId}`;
      const matchup = metrics.matchups.get(matchupKey) ?? {
        characterId: player.characterId,
        opponentCharacterId: opponent.characterId,
        games: 0,
        wins: 0,
        losses: 0,
      };
      matchup.games++;
      if (won) matchup.wins++;
      else matchup.losses++;
      metrics.matchups.set(matchupKey, matchup);
      const stageKey = `${player.characterId}|${record.stageId}`;
      const characterStage = metrics.characterStages.get(stageKey) ?? {
        characterId: player.characterId,
        stageId: record.stageId,
        games: 0,
        wins: 0,
        losses: 0,
      };
      characterStage.games++;
      if (won) characterStage.wins++;
      else characterStage.losses++;
      metrics.characterStages.set(stageKey, characterStage);
    }
  }
  for (const [playerSideIndex, player] of record.players.entries()) {
    metrics.playerSlots++;
    const identity = playerIdentity(player, eventId);
    if (identity) {
      metrics.identifiedPlayerSlots++;
      metrics.identities.add(identity);
      metrics.globallyCollapsedIdentities.add(globallyCollapsedPlayerIdentity(player));
    }
    metrics.lCancelSuccess += player.lCancelSuccess ?? 0;
    metrics.lCancelFail += player.lCancelFail ?? 0;
    const techs = player.techs ?? {};
    metrics.techSuccess += (techs.inPlace ?? 0) + (techs.toward ?? 0) + (techs.away ?? 0) + (techs.wallSuccess ?? 0);
    metrics.techMissed += (techs.missed ?? 0) + (techs.wallMissed ?? 0);
    metrics.neutralWins += player.neutralWins ?? 0;
    metrics.totalDamage += player.totalDamage ?? 0;
    if (Number.isFinite(player.inputsPerMinute)) {
      metrics.inputsPerMinuteSum += player.inputsPerMinute;
      metrics.inputsPerMinuteSamples++;
    }
    const character = metrics.characters.get(player.characterId) ?? {
      characterId: player.characterId,
      playerGames: 0,
      wins: 0,
      losses: 0,
      unknownResults: 0,
      lCancelSuccess: 0,
      lCancelFail: 0,
      techSuccess: 0,
      techMissed: 0,
      moves: new Map(),
    };
    for (const [moveId, move] of Object.entries(player.moveStats ?? {})) {
      metrics.moveAttempts += move.attempts ?? 0;
      metrics.moveHits += move.landed ?? 0;
      metrics.moveKills += move.kills ?? 0;
      metrics.moveDamage += move.damage ?? 0;
      const characterMove = character.moves.get(moveId) ?? {
        moveId: Number(moveId),
        attempts: 0,
        hits: 0,
        kills: 0,
        damage: 0,
        openings: 0,
        lCancelSuccess: 0,
        lCancelFail: 0,
      };
      characterMove.attempts += move.attempts ?? 0;
      characterMove.hits += move.landed ?? 0;
      characterMove.kills += move.kills ?? 0;
      characterMove.damage += move.damage ?? 0;
      characterMove.openings += move.openings ?? 0;
      characterMove.lCancelSuccess += move.lcSuccess ?? 0;
      characterMove.lCancelFail += move.lcFail ?? 0;
      character.moves.set(moveId, characterMove);
    }
    character.playerGames++;
    character.lCancelSuccess += player.lCancelSuccess ?? 0;
    character.lCancelFail += player.lCancelFail ?? 0;
    character.techSuccess += (techs.inPlace ?? 0) + (techs.toward ?? 0) + (techs.away ?? 0) + (techs.wallSuccess ?? 0);
    character.techMissed += (techs.missed ?? 0) + (techs.wallMissed ?? 0);
    if (record.isTeams) {
      if (record.winnerTeamId === null) character.unknownResults++;
      else if (record.winnerTeamId === player.teamId) character.wins++;
      else character.losses++;
    } else if (record.winnerIndex === null) character.unknownResults++;
    else if (record.winnerIndex === playerSideIndex) character.wins++;
    else character.losses++;
    metrics.characters.set(player.characterId, character);
  }
};

const serializeMetrics = (metrics) => {
  const lCancelAttempts = metrics.lCancelSuccess + metrics.lCancelFail;
  const techAttempts = metrics.techSuccess + metrics.techMissed;
  return {
    games: metrics.games,
    singles: metrics.singles,
    doubles: metrics.doubles,
    winrateEligibleGames: metrics.winrateEligibleGames,
    recordedHours: Number(metrics.recordedHours.toFixed(3)),
    playerSlots: metrics.playerSlots,
    identifiedPlayerSlots: metrics.identifiedPlayerSlots,
    identifiedPlayerSlotPercent: metrics.playerSlots ? metrics.identifiedPlayerSlots / metrics.playerSlots : 0,
    distinctRecordedIdentities: metrics.identities.size,
    distinctGloballyCollapsedLabels: metrics.globallyCollapsedIdentities.size,
    lCancelSuccess: metrics.lCancelSuccess,
    lCancelFail: metrics.lCancelFail,
    lCancelAttempts,
    lCancelRate: lCancelAttempts ? metrics.lCancelSuccess / lCancelAttempts : null,
    techSuccess: metrics.techSuccess,
    techMissed: metrics.techMissed,
    techAttempts,
    techSuccessRate: techAttempts ? metrics.techSuccess / techAttempts : null,
    moveAttempts: metrics.moveAttempts,
    moveHits: metrics.moveHits,
    moveKills: metrics.moveKills,
    moveDamage: Number(metrics.moveDamage.toFixed(3)),
    neutralWins: metrics.neutralWins,
    totalDamage: Number(metrics.totalDamage.toFixed(3)),
    averageInputsPerMinute: metrics.inputsPerMinuteSamples
      ? metrics.inputsPerMinuteSum / metrics.inputsPerMinuteSamples
      : null,
    stages: [...metrics.stages.entries()]
      .map(([stageId, games]) => ({ stageId, games }))
      .sort((a, b) => b.games - a.games || a.stageId - b.stageId),
    characters: [...metrics.characters.values()]
      .map((character) => {
        const { moves, ...characterSummary } = character;
        const lCancelAttempts = character.lCancelSuccess + character.lCancelFail;
        const techAttempts = character.techSuccess + character.techMissed;
        return {
          ...characterSummary,
          lCancelAttempts,
          lCancelRate: lCancelAttempts ? character.lCancelSuccess / lCancelAttempts : null,
          techAttempts,
          techSuccessRate: techAttempts ? character.techSuccess / techAttempts : null,
          moves: [...moves.values()]
            .map((move) => {
              const lCancelAttempts = move.lCancelSuccess + move.lCancelFail;
              return {
                ...move,
                damage: Number(move.damage.toFixed(3)),
                lCancelAttempts,
                lCancelRate: lCancelAttempts ? move.lCancelSuccess / lCancelAttempts : null,
              };
            })
            .sort((a, b) => b.attempts - a.attempts || b.hits - a.hits || a.moveId - b.moveId),
        };
      })
      .sort((a, b) => b.playerGames - a.playerGames || a.characterId - b.characterId),
    matchups: [...metrics.matchups.values()]
      .sort((a, b) => b.games - a.games || a.characterId - b.characterId || a.opponentCharacterId - b.opponentCharacterId),
    characterStages: [...metrics.characterStages.values()]
      .sort((a, b) => b.games - a.games || a.characterId - b.characterId || a.stageId - b.stageId),
  };
};

const allUsableMetrics = makeMetrics();
const conservativeMetrics = makeMetrics();
const balancedGroups = new Map();
for (const name of files) {
  const payload = JSON.parse(await readFile(path.join(resultsDir, name), "utf8"));
  const eventId = eventIdFor(payload.bundle);
  for (const record of payload.records) {
    if (!record.ok) continue;
    const key = record.identityKey ?? `${payload.bundle}/${record.file}`;
    const game = gamesByKey.get(key);
    if (!game || game.bundle !== payload.bundle || game.file !== record.file || game.bucket === "excludedOrIncomplete") continue;
    addMetricGame(allUsableMetrics, record, eventId);
    if (game.bucket === "verifiedBracket" || game.bucket === "probableBracket") {
      addMetricGame(conservativeMetrics, record, eventId);
      for (const player of record.players) {
        const identity = playerIdentity(player, eventId);
        if (!identity) continue;
        const key = `${identity}|character:${player.characterId}`;
        const row = balancedGroups.get(key) ?? {
          identity,
          characterId: player.characterId,
          games: 0,
          lCancelSuccess: 0,
          lCancelFail: 0,
          techSuccess: 0,
          techMissed: 0,
        };
        row.games++;
        row.lCancelSuccess += player.lCancelSuccess ?? 0;
        row.lCancelFail += player.lCancelFail ?? 0;
        const techs = player.techs ?? {};
        row.techSuccess += (techs.inPlace ?? 0) + (techs.toward ?? 0) + (techs.away ?? 0) + (techs.wallSuccess ?? 0);
        row.techMissed += (techs.missed ?? 0) + (techs.wallMissed ?? 0);
        balancedGroups.set(key, row);
      }
    }
  }
}

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

const summarizeRates = (rates) => {
  const sorted = [...rates].sort((a, b) => a - b);
  return {
    qualifiedPlayers: sorted.length,
    equalWeightMean: sorted.length ? sorted.reduce((sum, rate) => sum + rate, 0) / sorted.length : null,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
  };
};

const PLAYER_BALANCE_MIN_GAMES = 10;
const PLAYER_BALANCE_MIN_L_CANCEL_ATTEMPTS = 50;
const PLAYER_BALANCE_MIN_TECH_ATTEMPTS = 20;
const balancedByCharacter = new Map();
for (const row of balancedGroups.values()) {
  if (row.games < PLAYER_BALANCE_MIN_GAMES) continue;
  const character = balancedByCharacter.get(row.characterId) ?? { lCancelRates: [], techRates: [] };
  const lCancelAttempts = row.lCancelSuccess + row.lCancelFail;
  const techAttempts = row.techSuccess + row.techMissed;
  if (lCancelAttempts >= PLAYER_BALANCE_MIN_L_CANCEL_ATTEMPTS) {
    character.lCancelRates.push(row.lCancelSuccess / lCancelAttempts);
  }
  if (techAttempts >= PLAYER_BALANCE_MIN_TECH_ATTEMPTS) {
    character.techRates.push(row.techSuccess / techAttempts);
  }
  balancedByCharacter.set(row.characterId, character);
}
const playerBalanced = [...balancedByCharacter.entries()].map(([characterId, rates]) => ({
  characterId,
  lCancel: summarizeRates(rates.lCancelRates),
  techSuccess: summarizeRates(rates.techRates),
})).sort((a, b) => {
  const aPlayers = Math.max(a.lCancel.qualifiedPlayers, a.techSuccess.qualifiedPlayers);
  const bPlayers = Math.max(b.lCancel.qualifiedPlayers, b.techSuccess.qualifiedPlayers);
  return bPlayers - aPlayers || a.characterId - b.characterId;
});

const events = new Map();
for (const game of games) {
  const row = events.get(game.eventId) ?? {
    eventId: game.eventId,
    bundles: new Set(),
    uniqueGames: 0,
    singles: 0,
    doubles: 0,
    recordedHours: 0,
    winrateEligibleGames: 0,
    buckets: { verifiedBracket: 0, probableBracket: 0, unclassifiedVenue: 0, excludedOrIncomplete: 0 },
  };
  for (const bundle of game.sourceBundles) row.bundles.add(bundle);
  row.uniqueGames++;
  if (!game.technicalExclusion) {
    if (game.isTeams) row.doubles++;
    else row.singles++;
    row.recordedHours += game.durationFrames / 60 / 3600;
    if (game.winrateEligible) row.winrateEligibleGames++;
  }
  row.buckets[game.bucket]++;
  events.set(game.eventId, row);
}

const report = {
  schemaVersion: 1,
  source: "https://replays.nikki.sh/",
  generatedAt: new Date().toISOString(),
  methodology: {
    unit: "source replay files for fileBuckets; deduplicated parsed games for uniqueGameBuckets",
    minimumGameSeconds: MIN_GAME_FRAMES / 60,
    maximumPlausibleConsecutiveSetGames: MAX_SET_GAMES,
    maximumSequenceGapMinutes: SET_GAP_MS / 60000,
    verifiedRule: "manual event-format whitelist only; full bracket cross-reference is still pending",
    probableRules: ["broadcast/bracket/top-eight path evidence", "all players identified in a consecutive 2-10 game sequence"],
    unclassifiedRule: "technically usable game from a tournament-labeled archive without set-level proof",
  },
  replayFiles,
  parsedFiles,
  failedFiles,
  duplicateFiles,
  uniqueGames: games.length,
  fileBuckets,
  uniqueGameBuckets: uniqueBuckets,
  technicallyUsableUniqueGames: uniqueBuckets.verifiedBracket + uniqueBuckets.probableBracket + uniqueBuckets.unclassifiedVenue,
  conservativeBenchmarkGames: uniqueBuckets.verifiedBracket + uniqueBuckets.probableBracket,
  conservativeWinrateGames: games.filter((game) =>
    (game.bucket === "verifiedBracket" || game.bucket === "probableBracket") && game.winrateEligible,
  ).length,
  technicallyUsableWinrateGames: games.filter((game) =>
    game.bucket !== "excludedOrIncomplete" && game.winrateEligible,
  ).length,
  technicallyUsableGamesWithoutWinner: games.filter((game) =>
    game.bucket !== "excludedOrIncomplete" && !game.winrateEligible,
  ).length,
  metrics: {
    conservativeBracket: serializeMetrics(conservativeMetrics),
    allTechnicallyUsableTournamentLabeled: serializeMetrics(allUsableMetrics),
  },
  playerBalanced: {
    scope: "conservativeBracket",
    minimumGamesPerIdentityCharacter: PLAYER_BALANCE_MIN_GAMES,
    minimumLCancelAttempts: PLAYER_BALANCE_MIN_L_CANCEL_ATTEMPTS,
    minimumTechAttempts: PLAYER_BALANCE_MIN_TECH_ATTEMPTS,
    characters: playerBalanced,
  },
  exclusionReasons: [...exclusionReasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  setSizeHistogram: Object.entries(setSizeHistogram)
    .map(([games, sequences]) => ({ games: Number(games), sequences }))
    .sort((a, b) => a.games - b.games),
  events: [...events.values()].map((row) => ({
    ...row,
    bundles: [...row.bundles].sort(),
    recordedHours: Number(row.recordedHours.toFixed(3)),
  })).sort((a, b) => a.eventId.localeCompare(b.eventId)),
  bundles: bundleRows,
};

const fileBucketTotal = Object.values(fileBuckets).reduce((sum, value) => sum + value, 0);
const uniqueBucketTotal = Object.values(uniqueBuckets).reduce((sum, value) => sum + value, 0);
if (fileBucketTotal !== replayFiles) throw new Error(`file bucket total ${fileBucketTotal} != ${replayFiles}`);
if (uniqueBucketTotal !== games.length) throw new Error(`unique bucket total ${uniqueBucketTotal} != ${games.length}`);

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  replayFiles,
  uniqueGames: games.length,
  fileBuckets,
  uniqueGameBuckets: uniqueBuckets,
  conservativeBenchmarkGames: report.conservativeBenchmarkGames,
  events: report.events.length,
  output,
})}\n`);
