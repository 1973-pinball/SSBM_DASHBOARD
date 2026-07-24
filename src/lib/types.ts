export type GameType = "ranked" | "unranked" | "direct" | "offline" | "unknown";

/** Singles vs teams is a separate axis from GameType: a 2v2 is also ranked/direct/offline. */
export type Format = "singles" | "teams";

/** Movement/defensive action counts for one player in one game. */
export interface ActionCounts {
  rolls: number;
  airDodges: number;
  spotDodges: number;
  wavedashes: number;
  wavelands: number;
  dashDances: number;
  ledgeGrabs: number;
  grabs: number; // attempts (landed + whiffed); slippi-js can't isolate shield grabs
}

export const ACTION_LABELS: { key: keyof ActionCounts; label: string }[] = [
  { key: "rolls", label: "Rolls" },
  { key: "airDodges", label: "Air dodges" },
  { key: "spotDodges", label: "Spot dodges" },
  { key: "wavedashes", label: "Wavedashes" },
  { key: "wavelands", label: "Wavelands" },
  { key: "dashDances", label: "Dash dances" },
  { key: "ledgeGrabs", label: "Ledge grabs" },
  { key: "grabs", label: "Grabs" },
];

export interface PlayerSide {
  port: number;
  connectCode: string | null;
  displayName: string | null;
  characterId: number;
  colorId: number;
  teamId: number | null; // null in singles
  stocksRemaining: number | null;
  kills: number; // enemy stocks taken; in teams, FF kills live in killMatrix
  totalDamage: number; // damage to enemies; in teams, FF lives in dmgMatrix
  openingsPerKill: number | null;
  damagePerOpening: number | null;
  inputsPerMinute: number | null;
  neutralWins: number;
  counterHits: number;
  beneficialTrades: number;
  lCancelSuccess: number;
  lCancelFail: number;
  grabSuccess: number; // landed grabs; actions.grabs is total attempts
  actions: ActionCounts;
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
  players: PlayerSide[]; // 2 for singles, 4 for 2v2
  winnerIndex: number | null; // singles: index into players; null = indeterminate
  winnerTeamId: number | null; // teams: winning teamId; null = indeterminate
  /**
   * Teams only: [attacker][victim] damage / stock captures in players[] order,
   * attributed via each victim's lastHitBy. The diagonal holds self-damage and
   * self-destructs. Null for singles and malformed 2v2s. Cross-team cells are
   * real damage/kills; same-team cells are friendly fire.
   */
  dmgMatrix?: number[][] | null;
  killMatrix?: number[][] | null;
  parseError?: string;
}

export interface Filters {
  format: Format;
  range: "all" | "7d" | "14d" | "30d" | "90d" | "1y";
  day: string | null; // local YYYY-MM-DD; overrides range when set
  myCharacter: number | null;
  oppCharacter: number | null;
  stageId: number | null;
  opponentCode: string | null;
  teammateCode: string | null; // teams only
  gameType: GameType | null;
}

export const DEFAULT_FILTERS: Filters = {
  format: "singles",
  range: "all",
  day: null,
  myCharacter: null,
  oppCharacter: null,
  stageId: null,
  opponentCode: null,
  teammateCode: null,
  gameType: null,
};

/** A singles game resolved against the chosen identity. */
export interface ResolvedGame {
  rec: GameRecord;
  me: PlayerSide;
  opp: PlayerSide;
  isWin: boolean | null;
  date: Date | null;
}

/** A 2v2 game resolved against the chosen identity. Win/loss is team-level. */
export interface ResolvedTeamGame {
  rec: GameRecord;
  me: PlayerSide;
  teammate: PlayerSide;
  opps: [PlayerSide, PlayerSide];
  isWin: boolean | null;
  date: Date | null;
}

export interface ParseProgress {
  total: number;
  done: number;
  skippedCached: number;
  errors: number;
}
