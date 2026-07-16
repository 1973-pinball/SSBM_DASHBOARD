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
}

export const ACTION_LABELS: { key: keyof ActionCounts; label: string }[] = [
  { key: "rolls", label: "Rolls" },
  { key: "airDodges", label: "Air dodges" },
  { key: "spotDodges", label: "Spot dodges" },
  { key: "wavedashes", label: "Wavedashes" },
  { key: "wavelands", label: "Wavelands" },
  { key: "dashDances", label: "Dash dances" },
  { key: "ledgeGrabs", label: "Ledge grabs" },
];

export interface PlayerSide {
  port: number;
  connectCode: string | null;
  displayName: string | null;
  characterId: number;
  colorId: number;
  teamId: number | null; // null in singles
  stocksRemaining: number | null;
  kills: number;
  totalDamage: number;
  openingsPerKill: number | null;
  damagePerOpening: number | null;
  inputsPerMinute: number | null;
  neutralWins: number;
  lCancelSuccess: number;
  lCancelFail: number;
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
  parseError?: string;
}

export interface Filters {
  format: Format;
  range: "all" | "30d" | "90d" | "1y";
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
