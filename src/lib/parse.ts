import { SlippiGame, GameEndMethod } from "@slippi/slippi-js";
import type { GameRecord, GameType, PlayerSide } from "./types";

const MIN_GAME_SECONDS = 30;

function detectGameType(matchId: string | null | undefined): GameType {
  if (!matchId) return "offline";
  if (matchId.includes("mode.ranked")) return "ranked";
  if (matchId.includes("mode.unranked")) return "unranked";
  if (matchId.includes("mode.direct")) return "direct";
  return "unknown";
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

  // --- Win/loss determination (singles only) ---
  let winnerIndex: number | null = null;
  if (!isTeams && players.length === 2) {
    const placements = gameEnd?.placements?.filter((pl) => pl.position !== null && pl.position !== undefined);
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

    const first = gameEnd?.placements?.find((pl) => pl.position === 0);
    if (first?.playerIndex !== null && first?.playerIndex !== undefined) {
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
  };
}
