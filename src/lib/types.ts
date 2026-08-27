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

/** Per-move landed-hit aggregates for one player in one game (from conversions). */
export interface MoveAgg {
  landed: number; // landed instances (a multi-hit move counts once per landing)
  damage: number;
  kills: number; // conversions this move ended with a kill
  killPctSum: number; // victim % at those kills (avg = /kills)
  openings: number; // conversions this move started
  openingDmg: number; // total damage of the conversions it started
  /** L-cancels on this aerial's landing lag, whiffs included. Aerials only; 0 elsewhere. */
  lcSuccess: number;
  lcFail: number;
  /** Times the move was initiated (from animation states), whiffs included.
   *  Tracked for grounded normals and aerials only; undefined = not tracked. */
  attempts?: number;
}

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
  /** Keyed by Melee move ID. Singles only (conversions no-op in teams). */
  moveStats?: Record<number, MoveAgg>;
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

/**
 * One Slippi account belonging to the user. Several are normal — the same
 * person routinely keeps a main and an alt, and both sets of replays land in
 * the same folder. Identity stays a query-time concept (see decision 1 in
 * CLAUDE.md): these codes are matched against the neutrally-stored
 * `GameRecord.players[]`, never baked into a record.
 */
export interface Account {
  code: string; // normalized upper-case, e.g. ABCD#123
  label: string | null; // "Main", "Alt" — user-supplied, may be absent
}

/** How an account is named in dropdowns and tables: `Main (ABCD#123)`. */
export function accountLabel(a: Account): string {
  return a.label ? `${a.label} (${a.code})` : a.code;
}

/** Same, given only a code — falls back to the bare code for an unknown one. */
export function codeLabel(accounts: Account[], code: string): string {
  const hit = accounts.find((a) => a.code === code);
  return hit ? accountLabel(hit) : code;
}

/**
 * Compact form for dense tables, where a column header already says "Account"
 * and the full `Main (ABCD#123)` would blow the column out: the label alone,
 * or the bare code when there isn't one.
 */
export function codeShort(accounts: Account[], code: string): string {
  return accounts.find((a) => a.code === code)?.label ?? code;
}

/**
 * Slippi codes look like ABCD#123. Deliberately permissive on length: turning
 * away a code the user actually owns is a worse failure than accepting a typo,
 * which simply never matches a replay and shows up as "no games yet".
 */
const CODE_PATTERN = /^[A-Z0-9]{1,8}#\d{1,4}$/;

export const normalizeCode = (raw: string): string => raw.trim().toUpperCase();
export const isValidCode = (code: string): boolean => CODE_PATTERN.test(code);

/** First two rows get named for you — main/alt is the case by a mile. */
const DEFAULT_LABELS = ["Main", "Alt"];

/** An empty row for the account entry form, pre-labelled by position. */
export const blankAccount = (index: number): Account => ({
  code: "",
  label: DEFAULT_LABELS[index] ?? null,
});

/**
 * Normalize codes, trim labels, drop rows left blank — what the picker and the
 * editor both save. Blank rows are dropped rather than rejected: an empty row
 * is someone who clicked "add another" and changed their mind.
 */
export function cleanAccounts(accounts: Account[]): Account[] {
  return accounts
    .filter((a) => a.code.trim() !== "")
    .map((a) => ({ code: normalizeCode(a.code), label: a.label?.trim() ? a.label.trim() : null }));
}

/**
 * The first problem with a draft account list, or null when it can be saved.
 * Codes compare normalized, so `abcd#1` and `ABCD#1` collide as they should.
 */
export function accountsError(accounts: Account[]): string | null {
  const filled = accounts.filter((a) => a.code.trim() !== "");
  if (filled.length === 0) return "Enter at least one connect code.";
  const seen = new Set<string>();
  for (const a of filled) {
    const code = normalizeCode(a.code);
    if (!isValidCode(code)) return `“${a.code.trim()}” doesn’t look like a connect code — they’re like ABCD#123.`;
    if (seen.has(code)) return `${code} is listed twice.`;
    seen.add(code);
  }
  return null;
}

export interface Filters {
  format: Format;
  range: "all" | "7d" | "14d" | "30d" | "90d" | "1y";
  day: string | null; // local YYYY-MM-DD; overrides range when set
  accountCode: string | null; // which of my accounts; null = all of them
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
  accountCode: null,
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
  /**
   * Two of the user's own accounts met in this game — rare, but possible once
   * an alt exists and gets lent out. "You" won and lost it simultaneously, so
   * it carries no result: `isWin` is forced null and the game is kept out of
   * opponent breakdowns. It still appears in the game log.
   */
  selfMatch: boolean;
}

/** A 2v2 game resolved against the chosen identity. Win/loss is team-level. */
export interface ResolvedTeamGame {
  rec: GameRecord;
  me: PlayerSide;
  teammate: PlayerSide;
  opps: [PlayerSide, PlayerSide];
  isWin: boolean | null;
  date: Date | null;
  /** See ResolvedGame.selfMatch — here it also covers an alt as the teammate. */
  selfMatch: boolean;
}

export interface ParseProgress {
  total: number;
  done: number;
  skippedCached: number;
  errors: number;
  /**
   * Files left unparsed on purpose this run: a replay Slippi was still writing,
   * or one that changed under the scan. Nothing is cached for them — not even a
   * tombstone — so the next scan picks them up once the game has finished.
   */
  deferred: number;
}
