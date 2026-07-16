export type GameType = "ranked" | "unranked" | "direct" | "offline" | "unknown";

export interface PlayerSide {
  port: number;
  connectCode: string | null;
  displayName: string | null;
  characterId: number;
  colorId: number;
  stocksRemaining: number | null;
  kills: number;
  totalDamage: number;
  openingsPerKill: number | null;
  damagePerOpening: number | null;
  inputsPerMinute: number | null;
  neutralWins: number;
  lCancelSuccess: number;
  lCancelFail: number;
}

/**
 * One row per parsed game. Players are stored neutrally (no self/opponent)
 * so identity can be chosen or changed after parsing without a re-parse.
 */
export interface GameRecord {
  id: string; // path|size|mtime
  path: string;
  playedAt: string | null; // ISO
  durationFrames: number;
  stageId: number;
  gameType: GameType;
  isTeams: boolean;
  players: PlayerSide[]; // length 2 for singles
  winnerIndex: number | null; // index into players; null = indeterminate
  parseError?: string;
}

export interface Filters {
  range: "all" | "30d" | "90d" | "1y";
  myCharacter: number | null;
  oppCharacter: number | null;
  stageId: number | null;
  opponentCode: string | null;
  gameType: GameType | null;
}

export const DEFAULT_FILTERS: Filters = {
  range: "all",
  myCharacter: null,
  oppCharacter: null,
  stageId: null,
  opponentCode: null,
  gameType: null,
};

/** A game record resolved against the chosen identity. */
export interface ResolvedGame {
  rec: GameRecord;
  me: PlayerSide;
  opp: PlayerSide;
  isWin: boolean | null;
  date: Date | null;
}

export interface ParseProgress {
  total: number;
  done: number;
  skippedCached: number;
  errors: number;
}
