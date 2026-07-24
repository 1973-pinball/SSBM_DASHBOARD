import { SlippiGame, GameEndMethod, ActionsComputer, InputComputer, calcDamageTaken, didLoseStock } from "@slippi/slippi-js";
import type { GameStartType } from "@slippi/slippi-js";
import type { GameRecord, GameType, PlayerSide } from "./types";

const MIN_GAME_SECONDS = 30;

function detectGameType(matchId: string | null | undefined): GameType {
  if (!matchId) return "offline";
  if (matchId.includes("mode.ranked")) return "ranked";
  if (matchId.includes("mode.unranked")) return "unranked";
  if (matchId.includes("mode.direct")) return "direct";
  return "unknown";
}

interface TeamsStats {
  dmgMatrix: number[][]; // [attacker][victim] in settings.players order; diagonal = self/unattributed
  killMatrix: number[][]; // same shape; diagonal = self-destructs
  actionsByPlayerIndex: Map<number, ReturnType<ActionsComputer["fetch"]>[number]>;
  inputCountByPlayerIndex: Map<number, number>;
}

/**
 * slippi-js's stat computers are singles-only (they no-op on 4-player games),
 * so for clean 2v2s we make our own frame pass. Damage and kills are
 * attributed through each victim's `lastHitBy`, split into a full
 * attacker→victim matrix — that one structure yields enemy damage, friendly
 * fire (both directions), damage taken by source, and real stock captures.
 * Action/input counts reuse the library's own per-player state machines by
 * running them pairwise across teams (they only read the opponent's position,
 * for tech direction, which we don't surface).
 */
function computeTeamsStats(game: SlippiGame, settings: GameStartType): TeamsStats | null {
  const players = settings.players;
  if (players.length !== 4) return null;
  const byTeam = new Map<number, number>();
  for (const p of players) {
    if (p.teamId === null || p.teamId === undefined) return null;
    byTeam.set(p.teamId, (byTeam.get(p.teamId) ?? 0) + 1);
  }
  if (byTeam.size !== 2 || Array.from(byTeam.values()).some((n) => n !== 2)) return null;

  const teamIds = Array.from(byTeam.keys());
  const teamA = players.filter((p) => p.teamId === teamIds[0]);
  const teamB = players.filter((p) => p.teamId === teamIds[1]);
  // One computer per cross-team pair; each handles both of its players.
  const computers = [
    [teamA[0], teamB[0]],
    [teamA[1], teamB[1]],
  ].map((pair) => {
    const fake = { ...settings, players: pair } as GameStartType;
    const actions = new ActionsComputer();
    actions.setup(fake);
    const inputs = new InputComputer();
    inputs.setup(fake);
    return { actions, inputs };
  });

  const posOf = new Map(players.map((p, i) => [p.playerIndex, i]));
  const dmgMatrix = players.map(() => players.map(() => 0));
  const killMatrix = players.map(() => players.map(() => 0));

  const frames = game.getFrames();
  const frameNums = Object.keys(frames)
    .map(Number)
    .sort((a, b) => a - b);
  let prev: (typeof frames)[number] | null = null;
  for (const fn of frameNums) {
    const frame = frames[fn];
    if (!frame?.players || players.some((p) => !frame.players[p.playerIndex]?.post)) continue;
    for (const { actions, inputs } of computers) {
      actions.processFrame(frame);
      inputs.processFrame(frame, frames);
    }
    if (prev?.players) {
      for (const p of players) {
        const post = frame.players[p.playerIndex]!.post;
        const prevPost = prev.players[p.playerIndex]?.post;
        if (!prevPost) continue;
        const vi = posOf.get(p.playerIndex)!;
        const lhb = post.lastHitBy;
        const ai = lhb !== null && lhb !== undefined && lhb !== p.playerIndex && posOf.has(lhb) ? posOf.get(lhb)! : vi;
        const dmg = calcDamageTaken(post, prevPost);
        if (dmg > 0) dmgMatrix[ai][vi] += dmg;
        if (didLoseStock(post, prevPost)) killMatrix[ai][vi] += 1;
      }
    }
    prev = frame;
  }

  const actionsByPlayerIndex = new Map<number, ReturnType<ActionsComputer["fetch"]>[number]>();
  const inputCountByPlayerIndex = new Map<number, number>();
  for (const { actions, inputs } of computers) {
    for (const a of actions.fetch()) actionsByPlayerIndex.set(a.playerIndex, a);
    for (const i of inputs.fetch()) inputCountByPlayerIndex.set(i.playerIndex, i.inputCount);
  }
  return { dmgMatrix, killMatrix, actionsByPlayerIndex, inputCountByPlayerIndex };
}

/**
 * Parse a single replay into a GameRecord. Stats-only: frame data is used
 * transiently by slippi-js to compute stats, then everything is discarded
 * except the ~1-2 KB summary row.
 */
export function parseReplay(id: string, path: string, buf: ArrayBuffer): GameRecord {
  const game = new SlippiGame(buf);
  const settings = game.getSettings();
  if (!settings || !settings.players || settings.players.length === 0) {
    throw new Error("no settings block");
  }

  const metadata = game.getMetadata();
  const gameEnd = game.getGameEnd();
  const stats = game.getStats();
  const latestFrame = game.getLatestFrame();

  const durationFrames = stats?.lastFrame ?? metadata?.lastFrame ?? 0;
  const isTeams = Boolean(settings.isTeams) || settings.players.length > 2;

  const players: PlayerSide[] = settings.players.map((p) => {
    const overall = stats?.overall?.find((o) => o.playerIndex === p.playerIndex);
    const actions = stats?.actionCounts?.find((a) => a.playerIndex === p.playerIndex);
    const post = latestFrame?.players?.[p.playerIndex]?.post;
    return {
      port: (p.port ?? p.playerIndex + 1) as number,
      connectCode: p.connectCode || null,
      displayName: p.displayName || null,
      characterId: p.characterId ?? -1,
      colorId: p.characterColor ?? 0,
      teamId: isTeams ? p.teamId ?? null : null,
      stocksRemaining: post?.stocksRemaining ?? null,
      kills: overall?.killCount ?? 0,
      totalDamage: overall?.totalDamage ?? 0,
      openingsPerKill: overall?.openingsPerKill?.ratio ?? null,
      damagePerOpening: overall?.damagePerOpening?.ratio ?? null,
      inputsPerMinute: overall?.inputsPerMinute?.ratio ?? null,
      neutralWins: overall?.neutralWinRatio?.count ?? 0,
      counterHits: overall?.counterHitRatio?.count ?? 0,
      beneficialTrades: overall?.beneficialTradeRatio?.count ?? 0,
      lCancelSuccess: actions?.lCancelCount?.success ?? 0,
      lCancelFail: actions?.lCancelCount?.fail ?? 0,
      grabSuccess: actions?.grabCount?.success ?? 0,
      actions: {
        rolls: actions?.rollCount ?? 0,
        airDodges: actions?.airDodgeCount ?? 0,
        spotDodges: actions?.spotDodgeCount ?? 0,
        wavedashes: actions?.wavedashCount ?? 0,
        wavelands: actions?.wavelandCount ?? 0,
        dashDances: actions?.dashDanceCount ?? 0,
        ledgeGrabs: actions?.ledgegrabCount ?? 0,
        grabs: (actions?.grabCount?.success ?? 0) + (actions?.grabCount?.fail ?? 0),
      },
    };
  });

  // Doubles: slippi-js left every stat field zeroed, so fill them from our
  // own frame pass. kills/totalDamage keep singles semantics (enemies only);
  // friendly fire lives in the matrices.
  const teamsStats = isTeams ? computeTeamsStats(game, settings) : null;
  if (teamsStats) {
    const minutes = durationFrames / 3600;
    settings.players.forEach((p, i) => {
      const side = players[i];
      let enemyDmg = 0;
      let enemyKills = 0;
      settings.players.forEach((v, j) => {
        if (i === j || v.teamId === p.teamId) return;
        enemyDmg += teamsStats.dmgMatrix[i][j];
        enemyKills += teamsStats.killMatrix[i][j];
      });
      side.totalDamage = enemyDmg;
      side.kills = enemyKills;
      const ac = teamsStats.actionsByPlayerIndex.get(p.playerIndex);
      if (ac) {
        side.lCancelSuccess = ac.lCancelCount?.success ?? 0;
        side.lCancelFail = ac.lCancelCount?.fail ?? 0;
        side.grabSuccess = ac.grabCount?.success ?? 0;
        side.actions = {
          rolls: ac.rollCount ?? 0,
          airDodges: ac.airDodgeCount ?? 0,
          spotDodges: ac.spotDodgeCount ?? 0,
          wavedashes: ac.wavedashCount ?? 0,
          wavelands: ac.wavelandCount ?? 0,
          dashDances: ac.dashDanceCount ?? 0,
          ledgeGrabs: ac.ledgegrabCount ?? 0,
          grabs: (ac.grabCount?.success ?? 0) + (ac.grabCount?.fail ?? 0),
        };
      }
      const inputCount = teamsStats.inputCountByPlayerIndex.get(p.playerIndex);
      side.inputsPerMinute = inputCount !== undefined && minutes > 0 ? inputCount / minutes : null;
    });
  }

  // Placements are only meaningful when the game actually concluded. On a
  // NO_CONTEST (LRAS quit-out) or UNRESOLVED end the payload can carry stale
  // placement data — typically position 0 parked on player index 0 — which
  // would crown the quitter before the LRAS rule below ever runs.
  const placementsValid =
    gameEnd?.gameEndMethod === GameEndMethod.TIME ||
    gameEnd?.gameEndMethod === GameEndMethod.GAME ||
    gameEnd?.gameEndMethod === GameEndMethod.RESOLVED;

  // --- Win/loss determination (singles only) ---
  let winnerIndex: number | null = null;
  if (!isTeams && players.length === 2) {
    const placements = placementsValid
      ? gameEnd?.placements?.filter((pl) => pl.position !== null && pl.position !== undefined && pl.position >= 0)
      : undefined;
    if (placements && placements.length >= 2) {
      const first = placements.find((pl) => pl.position === 0);
      if (first?.playerIndex !== null && first?.playerIndex !== undefined) {
        winnerIndex = settings.players.findIndex((p) => p.playerIndex === first.playerIndex);
      }
    }
    if (winnerIndex === null || winnerIndex < 0) {
      if (gameEnd?.gameEndMethod === GameEndMethod.GAME) {
        // Stock-out: survivor wins.
        const [a, b] = players;
        if (a.stocksRemaining !== null && b.stocksRemaining !== null && a.stocksRemaining !== b.stocksRemaining) {
          winnerIndex = a.stocksRemaining > b.stocksRemaining ? 0 : 1;
        }
      } else if (gameEnd?.gameEndMethod === GameEndMethod.NO_CONTEST && gameEnd.lrasInitiatorIndex !== null && gameEnd.lrasInitiatorIndex !== undefined && gameEnd.lrasInitiatorIndex >= 0) {
        // Quit-out: the LRAS initiator takes the loss.
        const quitter = settings.players.findIndex((p) => p.playerIndex === gameEnd.lrasInitiatorIndex);
        if (quitter >= 0) winnerIndex = quitter === 0 ? 1 : 0;
      }
    }
    if (winnerIndex !== null && winnerIndex < 0) winnerIndex = null;
    // Very short games are indeterminate regardless of end method.
    if (durationFrames < MIN_GAME_SECONDS * 60) winnerIndex = null;
  }

  // --- Win/loss determination (teams) ---
  // Same ladder as singles, resolved to a team rather than a player.
  let winnerTeamId: number | null = null;
  const teamIds = new Set(players.map((p) => p.teamId).filter((t): t is number => t !== null));
  if (isTeams && players.length === 4 && teamIds.size === 2) {
    const teamOfPlayerIndex = (playerIndex: number): number | null => {
      const idx = settings.players.findIndex((p) => p.playerIndex === playerIndex);
      return idx >= 0 ? players[idx].teamId : null;
    };

    const first = placementsValid ? gameEnd?.placements?.find((pl) => pl.position === 0) : undefined;
    if (first && first.playerIndex !== null && first.playerIndex !== undefined) {
      winnerTeamId = teamOfPlayerIndex(first.playerIndex);
    }
    if (winnerTeamId === null) {
      if (gameEnd?.gameEndMethod === GameEndMethod.GAME) {
        // Stock-out: the team with stocks left wins.
        const stocks = new Map<number, number>();
        let complete = true;
        for (const p of players) {
          if (p.teamId === null || p.stocksRemaining === null) {
            complete = false;
            break;
          }
          stocks.set(p.teamId, (stocks.get(p.teamId) ?? 0) + p.stocksRemaining);
        }
        if (complete && stocks.size === 2) {
          const [[tA, sA], [tB, sB]] = Array.from(stocks.entries());
          if (sA !== sB) winnerTeamId = sA > sB ? tA : tB;
        }
      } else if (
        gameEnd?.gameEndMethod === GameEndMethod.NO_CONTEST &&
        gameEnd.lrasInitiatorIndex !== null &&
        gameEnd.lrasInitiatorIndex !== undefined &&
        gameEnd.lrasInitiatorIndex >= 0
      ) {
        // Quit-out: the quitter's team takes the loss.
        const quitterTeam = teamOfPlayerIndex(gameEnd.lrasInitiatorIndex);
        if (quitterTeam !== null) {
          winnerTeamId = Array.from(teamIds).find((t) => t !== quitterTeam) ?? null;
        }
      }
    }
    if (durationFrames < MIN_GAME_SECONDS * 60) winnerTeamId = null;
  }

  return {
    id,
    path,
    playedAt: metadata?.startAt ?? null,
    durationFrames,
    stageId: settings.stageId ?? -1,
    gameType: detectGameType(settings.matchInfo?.matchId),
    isTeams,
    players,
    winnerIndex,
    winnerTeamId,
    dmgMatrix: teamsStats?.dmgMatrix ?? null,
    killMatrix: teamsStats?.killMatrix ?? null,
  };
}
