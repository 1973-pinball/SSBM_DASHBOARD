import type { ActionCounts, Filters, GameRecord, GameType, ResolvedGame, ResolvedTeamGame } from "./types";
import { ACTION_LABELS } from "./types";
import { INCLUDED_STAGE_ID_SET } from "./config";

/** Local-timezone YYYY-MM-DD, matching the dates the user sees in the UI. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- Identity ----------

export interface CodeCandidate {
  code: string;
  displayName: string | null;
  games: number;
  share: number;
}

/** Rank connect codes by how many games they appear in; "you" is almost always #1. */
export function inferIdentity(records: GameRecord[]): CodeCandidate[] {
  const counts = new Map<string, { games: number; displayName: string | null }>();
  let withCodes = 0;
  for (const rec of records) {
    // Teams games count too — a doubles-only player still needs an identity.
    if (rec.parseError || rec.players.length < 2) continue;
    let counted = false;
    for (const p of rec.players) {
      if (!p.connectCode) continue;
      counted = true;
      const cur = counts.get(p.connectCode) ?? { games: 0, displayName: null };
      cur.games++;
      cur.displayName = p.displayName ?? cur.displayName;
      counts.set(p.connectCode, cur);
    }
    if (counted) withCodes++;
  }
  return Array.from(counts.entries())
    .map(([code, v]) => ({ code, displayName: v.displayName, games: v.games, share: withCodes ? v.games / withCodes : 0 }))
    .sort((a, b) => b.games - a.games);
}

// ---------- Resolution & filtering ----------

export function resolveGames(records: GameRecord[], myCodes: Set<string>): ResolvedGame[] {
  const out: ResolvedGame[] = [];
  for (const rec of records) {
    if (rec.parseError || rec.isTeams || rec.players.length !== 2) continue;
    if (!INCLUDED_STAGE_ID_SET.has(rec.stageId)) continue;
    const meIdx = rec.players.findIndex((p) => p.connectCode && myCodes.has(p.connectCode));
    if (meIdx < 0) continue;
    const me = rec.players[meIdx];
    const opp = rec.players[1 - meIdx];
    const isWin = rec.winnerIndex === null ? null : rec.winnerIndex === meIdx;
    out.push({ rec, me, opp, isWin, date: rec.playedAt ? new Date(rec.playedAt) : null });
  }
  return out.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
}

/**
 * Resolve 2v2 games. Requires a clean 4-player, two-team game: anything odd
 * (3v1, free-for-all with team flags, a missing teamId) is skipped rather than
 * guessed at, since a wrong teammate silently corrupts every team stat.
 */
export function resolveTeamGames(records: GameRecord[], myCodes: Set<string>): ResolvedTeamGame[] {
  const out: ResolvedTeamGame[] = [];
  for (const rec of records) {
    if (rec.parseError || !rec.isTeams || rec.players.length !== 4) continue;
    if (!INCLUDED_STAGE_ID_SET.has(rec.stageId)) continue;
    const me = rec.players.find((p) => p.connectCode && myCodes.has(p.connectCode));
    if (!me || me.teamId === null) continue;
    const allies = rec.players.filter((p) => p !== me && p.teamId === me.teamId);
    const opps = rec.players.filter((p) => p.teamId !== null && p.teamId !== me.teamId);
    if (allies.length !== 1 || opps.length !== 2) continue;
    const isWin = rec.winnerTeamId === null ? null : rec.winnerTeamId === me.teamId;
    out.push({
      rec,
      me,
      teammate: allies[0],
      opps: [opps[0], opps[1]],
      isWin,
      date: rec.playedAt ? new Date(rec.playedAt) : null,
    });
  }
  return out.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
}

const RANGE_DAYS: Record<Exclude<Filters["range"], "all">, number> = { "7d": 7, "14d": 14, "30d": 30, "90d": 90, "1y": 365 };

export function applyFilters(games: ResolvedGame[], f: Filters): ResolvedGame[] {
  // A picked day overrides the relative range — combining them could only
  // produce "day inside range" (redundant) or "day outside range" (empty).
  let cutoff: number | null = null;
  if (f.day === null && f.range !== "all") cutoff = Date.now() - RANGE_DAYS[f.range] * 86_400_000;
  return games.filter((g) => {
    if (f.day !== null && (!g.date || localDay(g.date) !== f.day)) return false;
    if (cutoff !== null && (!g.date || g.date.getTime() < cutoff)) return false;
    if (f.myCharacter !== null && g.me.characterId !== f.myCharacter) return false;
    if (f.oppCharacter !== null && g.opp.characterId !== f.oppCharacter) return false;
    if (f.stageId !== null && g.rec.stageId !== f.stageId) return false;
    if (f.opponentCode !== null && g.opp.connectCode !== f.opponentCode) return false;
    if (f.gameType !== null && g.rec.gameType !== f.gameType) return false;
    return true;
  });
}

/** Same filters against a 2v2 game; opponent-side predicates match if *either* opponent matches. */
export function applyTeamFilters(games: ResolvedTeamGame[], f: Filters): ResolvedTeamGame[] {
  let cutoff: number | null = null;
  if (f.day === null && f.range !== "all") cutoff = Date.now() - RANGE_DAYS[f.range] * 86_400_000;
  return games.filter((g) => {
    if (f.day !== null && (!g.date || localDay(g.date) !== f.day)) return false;
    if (cutoff !== null && (!g.date || g.date.getTime() < cutoff)) return false;
    if (f.myCharacter !== null && g.me.characterId !== f.myCharacter) return false;
    if (f.oppCharacter !== null && !g.opps.some((o) => o.characterId === f.oppCharacter)) return false;
    if (f.stageId !== null && g.rec.stageId !== f.stageId) return false;
    if (f.opponentCode !== null && !g.opps.some((o) => o.connectCode === f.opponentCode)) return false;
    if (f.teammateCode !== null && g.teammate.connectCode !== f.teammateCode) return false;
    if (f.gameType !== null && g.rec.gameType !== f.gameType) return false;
    return true;
  });
}

// ---------- Aggregations ----------

const winRate = (wins: number, decided: number) => (decided > 0 ? wins / decided : null);

export interface WL {
  games: number;
  wins: number;
  losses: number;
  decided: number;
  winRate: number | null;
}

/** Shared by singles and teams — both carry a nullable isWin. */
type Decidable = { isWin: boolean | null };

export function tally(games: Decidable[]): WL {
  let wins = 0;
  let losses = 0;
  for (const g of games) {
    if (g.isWin === true) wins++;
    else if (g.isWin === false) losses++;
  }
  return { games: games.length, wins, losses, decided: wins + losses, winRate: winRate(wins, wins + losses) };
}

/** Current W/L streak over decided games, most recent last. */
function streakOf(games: Decidable[]): { kind: "W" | "L"; length: number } | null {
  let streak: { kind: "W" | "L"; length: number } | null = null;
  for (let i = games.length - 1; i >= 0; i--) {
    const w = games[i].isWin;
    if (w === null) continue;
    const kind = w ? "W" : "L";
    if (!streak) streak = { kind, length: 1 };
    else if (streak.kind === kind) streak.length++;
    else break;
  }
  return streak;
}

export interface OverviewStats extends WL {
  totalKills: number;
  killsPerGame: number | null;
  deathsPerGame: number | null;
  damagePerGame: number | null;
  avgGameSeconds: number | null;
  currentStreak: { kind: "W" | "L"; length: number } | null;
  prevWinRate: number | null; // same-length window immediately before the current one
}

export function overview(games: ResolvedGame[], allResolved: ResolvedGame[], f: Filters): OverviewStats {
  const base = tally(games);
  let kills = 0;
  let deaths = 0;
  let damage = 0;
  let frames = 0;
  for (const g of games) {
    kills += g.me.kills;
    deaths += g.opp.kills;
    damage += g.me.totalDamage;
    frames += g.rec.durationFrames;
  }
  const streak = streakOf(games);
  // Prior-window comparison (only meaningful for bounded ranges).
  let prevWinRate: number | null = null;
  if (f.range !== "all") {
    const days = RANGE_DAYS[f.range];
    const end = Date.now() - days * 86_400_000;
    const start = end - days * 86_400_000;
    const prev = allResolved.filter((g) => g.date && g.date.getTime() >= start && g.date.getTime() < end);
    prevWinRate = tally(applyFilters(prev, { ...f, range: "all" })).winRate;
  }
  return {
    ...base,
    totalKills: kills,
    killsPerGame: games.length ? kills / games.length : null,
    deathsPerGame: games.length ? deaths / games.length : null,
    damagePerGame: games.length ? damage / games.length : null,
    avgGameSeconds: games.length ? frames / 60 / games.length : null,
    currentStreak: streak,
    prevWinRate,
  };
}

export interface NeutralSummaryRow {
  label: string;
  mine: number;
  theirs: number;
  perGame: number;
  share: number | null; // mine / (mine + theirs)
}

/** Aggregate neutral-exchange counts: who's winning neutral, countering, and trading well. */
export function neutralSummary(games: ResolvedGame[]): NeutralSummaryRow[] {
  const rows = [
    { label: "Neutral wins", pick: (p: { neutralWins: number }) => p.neutralWins },
    { label: "Counter hits", pick: (p: { counterHits: number }) => p.counterHits },
    { label: "Beneficial trades", pick: (p: { beneficialTrades: number }) => p.beneficialTrades },
  ];
  return rows.map(({ label, pick }) => {
    let mine = 0;
    let theirs = 0;
    for (const g of games) {
      mine += pick(g.me) ?? 0;
      theirs += pick(g.opp) ?? 0;
    }
    return {
      label,
      mine,
      theirs,
      perGame: games.length ? mine / games.length : 0,
      share: mine + theirs > 0 ? mine / (mine + theirs) : null,
    };
  });
}

export interface ActionAverageRow {
  key: keyof ActionCounts;
  label: string;
  perGame: number;
  perMinute: number;
  oppPerGame: number;
  oppPerMinute: number;
}

/** Average action counts per game (and per minute, for length-independent comparison). */
export function actionAverages(games: ResolvedGame[]): ActionAverageRow[] {
  if (games.length === 0) return [];
  const totals: Record<keyof ActionCounts, number> = {
    rolls: 0, airDodges: 0, spotDodges: 0, wavedashes: 0, wavelands: 0, dashDances: 0, ledgeGrabs: 0, grabs: 0,
  };
  const oppTotals: Record<keyof ActionCounts, number> = {
    rolls: 0, airDodges: 0, spotDodges: 0, wavedashes: 0, wavelands: 0, dashDances: 0, ledgeGrabs: 0, grabs: 0,
  };
  let frames = 0;
  for (const g of games) {
    frames += g.rec.durationFrames;
    for (const { key } of ACTION_LABELS) {
      totals[key] += g.me.actions?.[key] ?? 0;
      oppTotals[key] += g.opp.actions?.[key] ?? 0;
    }
  }
  const minutes = frames / 3600;
  return ACTION_LABELS.map(({ key, label }) => ({
    key,
    label,
    perGame: totals[key] / games.length,
    perMinute: minutes > 0 ? totals[key] / minutes : 0,
    oppPerGame: oppTotals[key] / games.length,
    oppPerMinute: minutes > 0 ? oppTotals[key] / minutes : 0,
  }));
}

export interface RollingPoint {
  index: number;
  date: string;
  winRate: number;
}

export function rollingWinRate(games: ResolvedGame[], window = 50): RollingPoint[] {
  const decided = games.filter((g) => g.isWin !== null);
  const out: RollingPoint[] = [];
  let wins = 0;
  for (let i = 0; i < decided.length; i++) {
    if (decided[i].isWin) wins++;
    if (i >= window && decided[i - window].isWin) wins--;
    const n = Math.min(i + 1, window);
    if (i + 1 >= Math.min(window, 10)) {
      out.push({
        index: i + 1,
        date: decided[i].date?.toISOString().slice(0, 10) ?? "",
        winRate: (wins / n) * 100,
      });
    }
  }
  return out;
}

export interface CharacterRow extends WL {
  characterId: number;
  killsPerGame: number | null;
  deathsPerGame: number | null;
}

export function byMyCharacter(games: ResolvedGame[]): CharacterRow[] {
  return groupRows(games, (g) => g.me.characterId);
}

export function byOppCharacter(games: ResolvedGame[]): CharacterRow[] {
  return groupRows(games, (g) => g.opp.characterId);
}

function groupRows(games: ResolvedGame[], key: (g: ResolvedGame) => number): CharacterRow[] {
  const map = new Map<number, ResolvedGame[]>();
  for (const g of games) {
    const k = key(g);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(g);
  }
  return Array.from(map.entries())
    .map(([characterId, gs]) => {
      const t = tally(gs);
      let kills = 0;
      let deaths = 0;
      for (const g of gs) {
        kills += g.me.kills;
        deaths += g.opp.kills;
      }
      return { characterId, ...t, killsPerGame: gs.length ? kills / gs.length : null, deathsPerGame: gs.length ? deaths / gs.length : null };
    })
    .sort((a, b) => b.games - a.games);
}

export interface MatchupCell extends WL {
  myChar: number;
  oppChar: number;
}

export function matchupMatrix(games: ResolvedGame[]): { myChars: number[]; oppChars: number[]; cells: Map<string, MatchupCell> } {
  const cells = new Map<string, MatchupCell>();
  const myCount = new Map<number, number>();
  const oppCount = new Map<number, number>();
  for (const g of games) {
    const key = `${g.me.characterId}:${g.opp.characterId}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { myChar: g.me.characterId, oppChar: g.opp.characterId, games: 0, wins: 0, losses: 0, decided: 0, winRate: null };
      cells.set(key, cell);
    }
    cell.games++;
    if (g.isWin === true) cell.wins++;
    else if (g.isWin === false) cell.losses++;
    myCount.set(g.me.characterId, (myCount.get(g.me.characterId) ?? 0) + 1);
    oppCount.set(g.opp.characterId, (oppCount.get(g.opp.characterId) ?? 0) + 1);
  }
  for (const cell of cells.values()) {
    cell.decided = cell.wins + cell.losses;
    cell.winRate = winRate(cell.wins, cell.decided);
  }
  const sortDesc = (m: Map<number, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { myChars: sortDesc(myCount), oppChars: sortDesc(oppCount), cells };
}

export interface StageCharCell extends WL {
  stageId: number;
  charId: number;
}

/**
 * Counterpick helper: win rate by stage × character. side="opp" keys on the
 * opponent's character (where do I beat Fox?); side="mine" keys on my own
 * (where does my Falco perform?). Stages sort by legal-list order via games
 * played; characters by games played.
 */
export function stageCharMatrix(
  games: ResolvedGame[],
  side: "opp" | "mine",
): { stages: number[]; chars: number[]; cells: Map<string, StageCharCell> } {
  const cells = new Map<string, StageCharCell>();
  const stageCount = new Map<number, number>();
  const charCount = new Map<number, number>();
  for (const g of games) {
    const charId = side === "opp" ? g.opp.characterId : g.me.characterId;
    const key = `${g.rec.stageId}:${charId}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { stageId: g.rec.stageId, charId, games: 0, wins: 0, losses: 0, decided: 0, winRate: null };
      cells.set(key, cell);
    }
    cell.games++;
    if (g.isWin === true) cell.wins++;
    else if (g.isWin === false) cell.losses++;
    stageCount.set(g.rec.stageId, (stageCount.get(g.rec.stageId) ?? 0) + 1);
    charCount.set(charId, (charCount.get(charId) ?? 0) + 1);
  }
  for (const cell of cells.values()) {
    cell.decided = cell.wins + cell.losses;
    cell.winRate = winRate(cell.wins, cell.decided);
  }
  const sortDesc = (m: Map<number, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { stages: sortDesc(stageCount), chars: sortDesc(charCount), cells };
}

// ---------- Sessions & tilt ----------

export interface Session {
  start: Date;
  end: Date;
  games: ResolvedGame[];
  wins: number;
  losses: number;
  decided: number;
  winRate: number | null;
  minutes: number;
}

/** Group games into play sessions: a new session starts after `gapMinutes` of no games. */
export function computeSessions(games: ResolvedGame[], gapMinutes = 30): Session[] {
  const sessions: Session[] = [];
  let cur: Session | null = null;
  let lastEndMs = 0;
  for (const g of games) {
    if (!g.date) continue;
    const startMs = g.date.getTime();
    const endMs = startMs + (g.rec.durationFrames / 60) * 1000;
    if (!cur || startMs - lastEndMs > gapMinutes * 60_000) {
      cur = { start: g.date, end: new Date(endMs), games: [], wins: 0, losses: 0, decided: 0, winRate: null, minutes: 0 };
      sessions.push(cur);
    }
    cur.games.push(g);
    if (g.isWin === true) cur.wins++;
    else if (g.isWin === false) cur.losses++;
    cur.end = new Date(Math.max(cur.end.getTime(), endMs));
    lastEndMs = endMs;
  }
  for (const s of sessions) {
    s.decided = s.wins + s.losses;
    s.winRate = winRate(s.wins, s.decided);
    s.minutes = (s.end.getTime() - s.start.getTime()) / 60_000;
  }
  return sessions;
}

export interface SessionBucketRow extends WL {
  label: string;
}

/** Win rate by position within a session: does your play degrade as the session drags? */
export function winRateBySessionPosition(sessions: Session[]): SessionBucketRow[] {
  const defs: { label: string; lo: number; hi: number }[] = [
    { label: "Games 1–5", lo: 1, hi: 5 },
    { label: "Games 6–10", lo: 6, hi: 10 },
    { label: "Games 11–15", lo: 11, hi: 15 },
    { label: "Games 16–20", lo: 16, hi: 20 },
    { label: "Games 21+", lo: 21, hi: Infinity },
  ];
  const agg = defs.map(() => ({ games: 0, wins: 0, losses: 0 }));
  for (const s of sessions) {
    s.games.forEach((g, i) => {
      const pos = i + 1;
      const bi = defs.findIndex((d) => pos >= d.lo && pos <= d.hi);
      if (bi < 0) return;
      agg[bi].games++;
      if (g.isWin === true) agg[bi].wins++;
      else if (g.isWin === false) agg[bi].losses++;
    });
  }
  return defs.map((d, i) => ({
    label: d.label,
    games: agg[i].games,
    wins: agg[i].wins,
    losses: agg[i].losses,
    decided: agg[i].wins + agg[i].losses,
    winRate: winRate(agg[i].wins, agg[i].wins + agg[i].losses),
  }));
}

/**
 * Win rate conditioned on the streak you were on entering the game (within the
 * same session). "After 3+ losses" trending below baseline is what tilt looks
 * like in the data. Indeterminate games neither extend nor break a streak.
 */
export function tiltStats(sessions: Session[]): SessionBucketRow[] {
  const defs = ["Session opener", "After a win", "After 2+ wins", "After a loss", "After 2 losses", "After 3+ losses"] as const;
  const agg = new Map(defs.map((d) => [d as string, { games: 0, wins: 0, losses: 0 }]));
  const add = (label: string, isWin: boolean) => {
    const a = agg.get(label)!;
    a.games++;
    if (isWin) a.wins++;
    else a.losses++;
  };
  for (const s of sessions) {
    let kind: "W" | "L" | null = null;
    let run = 0;
    for (const g of s.games) {
      if (g.isWin === null) continue;
      if (kind === null) add("Session opener", g.isWin);
      else if (kind === "W") add(run >= 2 ? "After 2+ wins" : "After a win", g.isWin);
      else add(run >= 3 ? "After 3+ losses" : run === 2 ? "After 2 losses" : "After a loss", g.isWin);
      const k = g.isWin ? "W" : "L";
      run = k === kind ? run + 1 : 1;
      kind = k;
    }
  }
  return defs.map((label) => {
    const a = agg.get(label)!;
    return { label, games: a.games, wins: a.wins, losses: a.losses, decided: a.wins + a.losses, winRate: winRate(a.wins, a.wins + a.losses) };
  });
}

// ---------- Records ----------

export interface GameRef {
  oppCode: string | null;
  oppChar: number;
  date: Date | null;
}

export interface SinglesRecords {
  bestWinStreak: { length: number; end: Date | null } | null;
  worstLossStreak: { length: number; end: Date | null } | null;
  highestDamage: (GameRef & { value: number }) | null;
  fastestWin: (GameRef & { seconds: number }) | null;
  longestGame: (GameRef & { seconds: number }) | null;
  perfectWins: number; // wins with all 4 stocks intact
  bestLCancelDay: { day: string; rate: number; attempts: number } | null;
  busiestDay: { day: string; games: number } | null;
  longestSession: { games: number; start: Date } | null;
  nemesis: { code: string; wins: number; losses: number } | null; // most losses to
  victim: { code: string; wins: number; losses: number } | null; // most wins against
}

const LC_DAY_MIN_ATTEMPTS = 100;

export function singlesRecords(games: ResolvedGame[]): SinglesRecords {
  let bestW: SinglesRecords["bestWinStreak"] = null;
  let bestL: SinglesRecords["worstLossStreak"] = null;
  let kind: "W" | "L" | null = null;
  let run = 0;
  let highestDamage: SinglesRecords["highestDamage"] = null;
  let fastestWin: SinglesRecords["fastestWin"] = null;
  let longestGame: SinglesRecords["longestGame"] = null;
  let perfectWins = 0;
  const lcByDay = new Map<string, { s: number; f: number }>();
  const gamesByDay = new Map<string, number>();
  const byOpp = new Map<string, { wins: number; losses: number }>();

  const ref = (g: ResolvedGame): GameRef => ({ oppCode: g.opp.connectCode, oppChar: g.opp.characterId, date: g.date });

  for (const g of games) {
    const seconds = g.rec.durationFrames / 60;
    if (g.isWin !== null) {
      const k = g.isWin ? "W" : "L";
      run = k === kind ? run + 1 : 1;
      kind = k;
      if (k === "W" && (!bestW || run > bestW.length)) bestW = { length: run, end: g.date };
      if (k === "L" && (!bestL || run > bestL.length)) bestL = { length: run, end: g.date };
    }
    if (!highestDamage || g.me.totalDamage > highestDamage.value) highestDamage = { ...ref(g), value: g.me.totalDamage };
    if (g.isWin === true && (!fastestWin || seconds < fastestWin.seconds)) fastestWin = { ...ref(g), seconds };
    if (!longestGame || seconds > longestGame.seconds) longestGame = { ...ref(g), seconds };
    if (g.isWin === true && g.me.stocksRemaining === 4) perfectWins++;
    if (g.date) {
      const day = localDay(g.date);
      gamesByDay.set(day, (gamesByDay.get(day) ?? 0) + 1);
      const lc = lcByDay.get(day) ?? { s: 0, f: 0 };
      lc.s += g.me.lCancelSuccess;
      lc.f += g.me.lCancelFail;
      lcByDay.set(day, lc);
    }
    if (g.opp.connectCode && g.isWin !== null) {
      const o = byOpp.get(g.opp.connectCode) ?? { wins: 0, losses: 0 };
      if (g.isWin) o.wins++;
      else o.losses++;
      byOpp.set(g.opp.connectCode, o);
    }
  }

  let bestLCancelDay: SinglesRecords["bestLCancelDay"] = null;
  for (const [day, { s, f }] of lcByDay) {
    if (s + f < LC_DAY_MIN_ATTEMPTS) continue;
    const rate = s / (s + f);
    if (!bestLCancelDay || rate > bestLCancelDay.rate) bestLCancelDay = { day, rate, attempts: s + f };
  }
  let busiestDay: SinglesRecords["busiestDay"] = null;
  for (const [day, n] of gamesByDay) {
    if (!busiestDay || n > busiestDay.games) busiestDay = { day, games: n };
  }
  const sessions = computeSessions(games);
  let longestSession: SinglesRecords["longestSession"] = null;
  for (const s of sessions) {
    if (!longestSession || s.games.length > longestSession.games) longestSession = { games: s.games.length, start: s.start };
  }
  let nemesis: SinglesRecords["nemesis"] = null;
  let victim: SinglesRecords["victim"] = null;
  for (const [code, o] of byOpp) {
    if (!nemesis || o.losses > nemesis.losses) nemesis = { code, ...o };
    if (!victim || o.wins > victim.wins) victim = { code, ...o };
  }

  return { bestWinStreak: bestW, worstLossStreak: bestL, highestDamage, fastestWin, longestGame, perfectWins, bestLCancelDay, busiestDay, longestSession, nemesis, victim };
}

export interface TeamsRecords {
  bestWinStreak: { length: number; end: Date | null } | null;
  /** Teammate who friendly-fires me the most (per game, min 5 games). */
  grudge: { code: string; ffPerGame: number; games: number } | null;
  /** Teammate I friendly-fire the most (per game, min 5 games). */
  myTarget: { code: string; ffPerGame: number; games: number } | null;
}

const FF_RECORD_MIN_GAMES = 5;

export function teamsRecords(games: ResolvedTeamGame[]): TeamsRecords {
  let best: TeamsRecords["bestWinStreak"] = null;
  let kind: "W" | "L" | null = null;
  let run = 0;
  const ff = new Map<string, { toMe: number; fromMe: number; games: number }>();
  for (const g of games) {
    if (g.isWin !== null) {
      const k = g.isWin ? "W" : "L";
      run = k === kind ? run + 1 : 1;
      kind = k;
      if (k === "W" && (!best || run > best.length)) best = { length: run, end: g.date };
    }
    const dm = g.rec.dmgMatrix;
    const code = g.teammate.connectCode;
    if (!dm || !code) continue;
    const ps = g.rec.players;
    const me = ps.indexOf(g.me);
    const mate = ps.indexOf(g.teammate);
    if (me < 0 || mate < 0) continue;
    const e = ff.get(code) ?? { toMe: 0, fromMe: 0, games: 0 };
    e.toMe += dm[mate][me];
    e.fromMe += dm[me][mate];
    e.games++;
    ff.set(code, e);
  }
  let grudge: TeamsRecords["grudge"] = null;
  let myTarget: TeamsRecords["myTarget"] = null;
  for (const [code, e] of ff) {
    if (e.games < FF_RECORD_MIN_GAMES) continue;
    const toMe = e.toMe / e.games;
    const fromMe = e.fromMe / e.games;
    if (!grudge || toMe > grudge.ffPerGame) grudge = { code, ffPerGame: toMe, games: e.games };
    if (!myTarget || fromMe > myTarget.ffPerGame) myTarget = { code, ffPerGame: fromMe, games: e.games };
  }
  return { bestWinStreak: best, grudge, myTarget };
}

export interface StageRow extends WL {
  stageId: number;
}

export function byStage(games: ResolvedGame[]): StageRow[] {
  const map = new Map<number, ResolvedGame[]>();
  for (const g of games) {
    if (!map.has(g.rec.stageId)) map.set(g.rec.stageId, []);
    map.get(g.rec.stageId)!.push(g);
  }
  return Array.from(map.entries())
    .map(([stageId, gs]) => ({ stageId, ...tally(gs) }))
    .sort((a, b) => b.games - a.games);
}

export interface OpponentRow extends WL {
  code: string;
  displayName: string | null;
  lastPlayed: Date | null;
  topCharacter: number;
}

export function byOpponent(games: ResolvedGame[]): OpponentRow[] {
  const map = new Map<string, ResolvedGame[]>();
  for (const g of games) {
    const code = g.opp.connectCode;
    if (!code) continue;
    if (!map.has(code)) map.set(code, []);
    map.get(code)!.push(g);
  }
  return Array.from(map.entries())
    .map(([code, gs]) => {
      const chars = new Map<number, number>();
      let name: string | null = null;
      let last: Date | null = null;
      for (const g of gs) {
        chars.set(g.opp.characterId, (chars.get(g.opp.characterId) ?? 0) + 1);
        name = g.opp.displayName ?? name;
        if (g.date && (!last || g.date > last)) last = g.date;
      }
      const topCharacter = Array.from(chars.entries()).sort((a, b) => b[1] - a[1])[0][0];
      return { code, displayName: name, lastPlayed: last, topCharacter, ...tally(gs) };
    })
    .sort((a, b) => b.games - a.games);
}

export interface ExecutionPoint {
  index: number;
  date: string;
  lCancel: number | null;
  opk: number | null;
  dpo: number | null;
  ipm: number | null;
  oppLCancel: number | null;
  oppOpk: number | null;
  oppDpo: number | null;
  oppIpm: number | null;
}

export function executionTrend(games: ResolvedGame[], window = 30): ExecutionPoint[] {
  const out: ExecutionPoint[] = [];
  for (let i = 0; i < games.length; i++) {
    if ((i + 1) % Math.max(1, Math.floor(window / 3)) !== 0 && i !== games.length - 1) continue;
    const slice = games.slice(Math.max(0, i - window + 1), i + 1);
    let lcS = 0, lcF = 0, opkSum = 0, opkN = 0, dpoSum = 0, dpoN = 0, ipmSum = 0, ipmN = 0;
    let oLcS = 0, oLcF = 0, oOpkSum = 0, oOpkN = 0, oDpoSum = 0, oDpoN = 0, oIpmSum = 0, oIpmN = 0;
    for (const g of slice) {
      lcS += g.me.lCancelSuccess;
      lcF += g.me.lCancelFail;
      oLcS += g.opp.lCancelSuccess;
      oLcF += g.opp.lCancelFail;
      if (g.me.openingsPerKill !== null) { opkSum += g.me.openingsPerKill; opkN++; }
      if (g.me.damagePerOpening !== null) { dpoSum += g.me.damagePerOpening; dpoN++; }
      if (g.me.inputsPerMinute !== null) { ipmSum += g.me.inputsPerMinute; ipmN++; }
      if (g.opp.openingsPerKill !== null) { oOpkSum += g.opp.openingsPerKill; oOpkN++; }
      if (g.opp.damagePerOpening !== null) { oDpoSum += g.opp.damagePerOpening; oDpoN++; }
      if (g.opp.inputsPerMinute !== null) { oIpmSum += g.opp.inputsPerMinute; oIpmN++; }
    }
    out.push({
      index: i + 1,
      date: games[i].date?.toISOString().slice(0, 10) ?? "",
      lCancel: lcS + lcF > 0 ? (lcS / (lcS + lcF)) * 100 : null,
      opk: opkN ? opkSum / opkN : null,
      dpo: dpoN ? dpoSum / dpoN : null,
      ipm: ipmN ? ipmSum / ipmN : null,
      oppLCancel: oLcS + oLcF > 0 ? (oLcS / (oLcS + oLcF)) * 100 : null,
      oppOpk: oOpkN ? oOpkSum / oOpkN : null,
      oppDpo: oDpoN ? oDpoSum / oDpoN : null,
      oppIpm: oIpmN ? oIpmSum / oIpmN : null,
    });
  }
  return out;
}

export type ExecMetricKey = "lCancel" | "opk" | "dpo" | "ipm";

/**
 * Each execution metric expressed as a numerator/denominator pair so windowed
 * averages compose by summing: L-cancel is a ratio of counts (success over
 * attempts), the others are means over games where the value is known.
 */
const EXEC_METRICS: Record<ExecMetricKey, { num: (g: ResolvedGame) => number; den: (g: ResolvedGame) => number; scale: number }> = {
  lCancel: { num: (g) => g.me.lCancelSuccess, den: (g) => g.me.lCancelSuccess + g.me.lCancelFail, scale: 100 },
  opk: { num: (g) => g.me.openingsPerKill ?? 0, den: (g) => (g.me.openingsPerKill !== null ? 1 : 0), scale: 1 },
  dpo: { num: (g) => g.me.damagePerOpening ?? 0, den: (g) => (g.me.damagePerOpening !== null ? 1 : 0), scale: 1 },
  ipm: { num: (g) => g.me.inputsPerMinute ?? 0, den: (g) => (g.me.inputsPerMinute !== null ? 1 : 0), scale: 1 },
};

export interface ExecutionSummary {
  games: number;
  lCancel: number | null;
  opk: number | null;
  dpo: number | null;
  ipm: number | null;
}

/** Averages over the most recent `window` games (KPI strip on Execution). */
export function executionSummary(games: ResolvedGame[], window = 50): ExecutionSummary {
  const slice = games.slice(Math.max(0, games.length - window));
  const value = (key: ExecMetricKey): number | null => {
    const { num, den, scale } = EXEC_METRICS[key];
    let n = 0, d = 0;
    for (const g of slice) { n += num(g); d += den(g); }
    return d > 0 ? (n / d) * scale : null;
  };
  return {
    games: slice.length,
    lCancel: value("lCancel"),
    opk: value("opk"),
    dpo: value("dpo"),
    ipm: value("ipm"),
  };
}

export interface RollingExecutionPoint {
  index: number;
  date: string;
  value: number | null;
}

/**
 * Rolling `window`-game average of one execution metric, one point per game.
 * Single-pass sliding sums (no per-point slicing); output is capped to the
 * latest `limit` points to keep the chart renderable, but each window still
 * looks back over games before the cap.
 */
export function rollingExecutionSeries(
  games: ResolvedGame[],
  metric: ExecMetricKey,
  window = 50,
  limit = 500,
): RollingExecutionPoint[] {
  const { num, den, scale } = EXEC_METRICS[metric];
  const emitStart = Math.max(0, games.length - limit);
  const out: RollingExecutionPoint[] = [];
  let numSum = 0, denSum = 0;
  for (let i = 0; i < games.length; i++) {
    numSum += num(games[i]);
    denSum += den(games[i]);
    if (i >= window) {
      numSum -= num(games[i - window]);
      denSum -= den(games[i - window]);
    }
    if (i < emitStart) continue;
    out.push({
      index: i + 1,
      date: games[i].date?.toISOString().slice(0, 10) ?? "",
      value: denSum > 0 ? (numSum / denSum) * scale : null,
    });
  }
  return out;
}

export interface LCancelPoint {
  index: number;
  date: string;
  attempts: number;
  success: number;
}

/**
 * Raw L-cancel volume, one point per game (no rolling window — this chart is
 * about per-game counts, unlike executionTrend's smoothed rates). Capped to the
 * most recent `limit` games to keep the chart renderable on 30k-game libraries.
 */
export function lCancelSeries(games: ResolvedGame[], limit = 500): LCancelPoint[] {
  const start = Math.max(0, games.length - limit);
  const out: LCancelPoint[] = [];
  for (let i = start; i < games.length; i++) {
    const g = games[i];
    out.push({
      index: i + 1,
      date: g.date?.toISOString().slice(0, 10) ?? "",
      attempts: g.me.lCancelSuccess + g.me.lCancelFail,
      success: g.me.lCancelSuccess,
    });
  }
  return out;
}

export interface GameSeriesPoint {
  index: number;
  date: string;
  [metric: string]: number | string;
}

/**
 * One point per game for arbitrary picked metrics — same shape and cap
 * rationale as lCancelSeries (recent `limit` games keep charts renderable
 * on 30k-game libraries).
 */
export function perGameSeries(
  games: ResolvedGame[],
  picks: { key: string; value: (g: ResolvedGame) => number }[],
  limit = 500,
): GameSeriesPoint[] {
  const start = Math.max(0, games.length - limit);
  const out: GameSeriesPoint[] = [];
  for (let i = start; i < games.length; i++) {
    const g = games[i];
    const point: GameSeriesPoint = { index: i + 1, date: g.date?.toISOString().slice(0, 10) ?? "" };
    for (const p of picks) point[p.key] = p.value(g);
    out.push(point);
  }
  return out;
}

export interface ModeRow extends WL {
  mode: GameType | "overall";
  killsPerGame: number | null;
  deathsPerGame: number | null;
  avgGameSeconds: number | null;
}

/** Overall + one row per game mode present in the data. */
export function byMode(games: ResolvedGame[]): ModeRow[] {
  const mk = (mode: ModeRow["mode"], gs: ResolvedGame[]): ModeRow => {
    let kills = 0;
    let deaths = 0;
    let frames = 0;
    for (const g of gs) {
      kills += g.me.kills;
      deaths += g.opp.kills;
      frames += g.rec.durationFrames;
    }
    return {
      mode,
      ...tally(gs),
      killsPerGame: gs.length ? kills / gs.length : null,
      deathsPerGame: gs.length ? deaths / gs.length : null,
      avgGameSeconds: gs.length ? frames / 60 / gs.length : null,
    };
  };
  const order: GameType[] = ["ranked", "unranked", "direct", "offline", "unknown"];
  const rows: ModeRow[] = [mk("overall", games)];
  for (const mode of order) {
    const gs = games.filter((g) => g.rec.gameType === mode);
    if (gs.length > 0) rows.push(mk(mode, gs));
  }
  return rows;
}

// ---------- Teams (2v2) ----------

export interface TeamOverviewStats extends WL {
  // Stock counts come from end-of-game state, the only per-player data slippi-js
  // yields for 4-player games (its stats engine — kills, damage, conversions —
  // is singles-only, so those fields are always 0 in teams records).
  stocksTakenPerGame: number | null;
  stocksLostPerGame: number | null;
  avgGameSeconds: number | null;
  currentStreak: { kind: "W" | "L"; length: number } | null;
  distinctTeammates: number;
}

const START_STOCKS = 4; // standard ruleset; replays don't reliably carry startStocks

export function teamOverview(games: ResolvedTeamGame[]): TeamOverviewStats {
  let taken = 0;
  let lost = 0;
  let stockGames = 0;
  let frames = 0;
  const mates = new Set<string>();
  for (const g of games) {
    frames += g.rec.durationFrames;
    mates.add(g.teammate.connectCode ?? `port:${g.teammate.port}`);
    const rem = [g.opps[0], g.opps[1], g.me, g.teammate].map((p) => p.stocksRemaining);
    if (rem.every((r) => r !== null)) {
      taken += START_STOCKS - rem[0]! + (START_STOCKS - rem[1]!);
      lost += START_STOCKS - rem[2]! + (START_STOCKS - rem[3]!);
      stockGames++;
    }
  }
  return {
    ...tally(games),
    stocksTakenPerGame: stockGames ? taken / stockGames : null,
    stocksLostPerGame: stockGames ? lost / stockGames : null,
    avgGameSeconds: games.length ? frames / 60 / games.length : null,
    currentStreak: streakOf(games),
    distinctTeammates: mates.size,
  };
}

export interface TeammateRow extends WL {
  code: string;
  displayName: string | null;
  topCharacter: number;
  stocksTakenPerGame: number | null; // team stocks taken; per-player kills don't exist for teams
  lastPlayed: Date | null;
}

/** Win rate with each teammate. Offline games without connect codes are skipped. */
export function byTeammate(games: ResolvedTeamGame[]): TeammateRow[] {
  const map = new Map<
    string,
    { gs: ResolvedTeamGame[]; chars: Map<number, number>; name: string | null; last: Date | null; taken: number; stockGames: number }
  >();
  for (const g of games) {
    const code = g.teammate.connectCode;
    if (!code) continue;
    let e = map.get(code);
    if (!e) {
      e = { gs: [], chars: new Map(), name: null, last: null, taken: 0, stockGames: 0 };
      map.set(code, e);
    }
    e.gs.push(g);
    e.chars.set(g.teammate.characterId, (e.chars.get(g.teammate.characterId) ?? 0) + 1);
    e.name = g.teammate.displayName ?? e.name;
    if (g.date && (!e.last || g.date > e.last)) e.last = g.date;
    if (g.opps[0].stocksRemaining !== null && g.opps[1].stocksRemaining !== null) {
      e.taken += START_STOCKS - g.opps[0].stocksRemaining + (START_STOCKS - g.opps[1].stocksRemaining);
      e.stockGames++;
    }
  }
  return Array.from(map.entries())
    .map(([code, e]) => ({
      code,
      displayName: e.name,
      topCharacter: Array.from(e.chars.entries()).sort((a, b) => b[1] - a[1])[0][0],
      stocksTakenPerGame: e.stockGames ? e.taken / e.stockGames : null,
      lastPlayed: e.last,
      ...tally(e.gs),
    }))
    .sort((a, b) => b.games - a.games);
}

export interface TeamCharacterRow extends WL {
  characterId: number;
}

export function teamsByMyCharacter(games: ResolvedTeamGame[]): TeamCharacterRow[] {
  return teamCharRows(games, (g) => [g.me.characterId]);
}

/**
 * Games in which the enemy duo included each character. A game is counted once
 * per *distinct* opposing character, so a double-Fox team counts once for Fox.
 */
export function teamsByOppCharacter(games: ResolvedTeamGame[]): TeamCharacterRow[] {
  return teamCharRows(games, (g) => Array.from(new Set(g.opps.map((o) => o.characterId))));
}

function teamCharRows(games: ResolvedTeamGame[], keys: (g: ResolvedTeamGame) => number[]): TeamCharacterRow[] {
  const map = new Map<number, { games: number; wins: number; losses: number }>();
  for (const g of games) {
    for (const c of keys(g)) {
      let row = map.get(c);
      if (!row) {
        row = { games: 0, wins: 0, losses: 0 };
        map.set(c, row);
      }
      row.games++;
      if (g.isWin === true) row.wins++;
      else if (g.isWin === false) row.losses++;
    }
  }
  return Array.from(map.entries())
    .map(([characterId, r]) => ({
      characterId,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      decided: r.wins + r.losses,
      winRate: winRate(r.wins, r.wins + r.losses),
    }))
    .sort((a, b) => b.games - a.games);
}

export function teamsByStage(games: ResolvedTeamGame[]): StageRow[] {
  const map = new Map<number, ResolvedTeamGame[]>();
  for (const g of games) {
    if (!map.has(g.rec.stageId)) map.set(g.rec.stageId, []);
    map.get(g.rec.stageId)!.push(g);
  }
  return Array.from(map.entries())
    .map(([stageId, gs]) => ({ stageId, ...tally(gs) }))
    .sort((a, b) => b.games - a.games);
}

// ---------- Teams damage & friendly fire ----------
// All of these read the per-game dmgMatrix/killMatrix (attacker→victim in
// rec.players order); games parsed before schema v7 don't have them and the
// v7 upgrade wipes the cache, so a null matrix only means a malformed 2v2.

/** Positions of me/teammate/opps within rec.players, for matrix lookups. */
function teamIdx(g: ResolvedTeamGame): { me: number; mate: number; opps: [number, number] } | null {
  const ps = g.rec.players;
  const me = ps.indexOf(g.me);
  const mate = ps.indexOf(g.teammate);
  const o0 = ps.indexOf(g.opps[0]);
  const o1 = ps.indexOf(g.opps[1]);
  if (me < 0 || mate < 0 || o0 < 0 || o1 < 0) return null;
  return { me, mate, opps: [o0, o1] };
}

interface DmgTotals {
  games: number;
  myDmg: number;
  mateDmg: number;
  myFF: number;
  mateFF: number;
  myKills: number;
  mateKills: number;
  myFFKills: number;
  mateFFKills: number;
  myTaken: number;
  mateTaken: number;
}

function emptyTotals(): DmgTotals {
  return { games: 0, myDmg: 0, mateDmg: 0, myFF: 0, mateFF: 0, myKills: 0, mateKills: 0, myFFKills: 0, mateFFKills: 0, myTaken: 0, mateTaken: 0 };
}

function accumulate(t: DmgTotals, g: ResolvedTeamGame): void {
  const dm = g.rec.dmgMatrix;
  const km = g.rec.killMatrix;
  if (!dm || !km) return;
  const ix = teamIdx(g);
  if (!ix) return;
  const [a, b] = ix.opps;
  t.games++;
  t.myDmg += dm[ix.me][a] + dm[ix.me][b];
  t.mateDmg += dm[ix.mate][a] + dm[ix.mate][b];
  t.myFF += dm[ix.me][ix.mate];
  t.mateFF += dm[ix.mate][ix.me];
  t.myKills += km[ix.me][a] + km[ix.me][b];
  t.mateKills += km[ix.mate][a] + km[ix.mate][b];
  t.myFFKills += km[ix.me][ix.mate];
  t.mateFFKills += km[ix.mate][ix.me];
  t.myTaken += dm[a][ix.me] + dm[b][ix.me];
  t.mateTaken += dm[a][ix.mate] + dm[b][ix.mate];
}

export interface TeamsDamageOverview {
  games: number; // games carrying matrices (clean 2v2s parsed on schema v7+)
  myDmgPerGame: number | null;
  mateDmgPerGame: number | null;
  dmgShare: number | null; // my share of the team's damage to enemies
  myFFPerGame: number | null; // damage I dealt to my teammate
  mateFFPerGame: number | null; // damage my teammate dealt to me
  myFFKills: number;
  mateFFKills: number;
  myKillsPerGame: number | null;
  mateKillsPerGame: number | null;
  killShare: number | null;
  focusShare: number | null; // share of enemy damage that was aimed at me
}

function toOverview(t: DmgTotals): TeamsDamageOverview {
  const per = (v: number) => (t.games ? v / t.games : null);
  const share = (mine: number, theirs: number) => (mine + theirs > 0 ? mine / (mine + theirs) : null);
  return {
    games: t.games,
    myDmgPerGame: per(t.myDmg),
    mateDmgPerGame: per(t.mateDmg),
    dmgShare: share(t.myDmg, t.mateDmg),
    myFFPerGame: per(t.myFF),
    mateFFPerGame: per(t.mateFF),
    myFFKills: t.myFFKills,
    mateFFKills: t.mateFFKills,
    myKillsPerGame: per(t.myKills),
    mateKillsPerGame: per(t.mateKills),
    killShare: share(t.myKills, t.mateKills),
    focusShare: share(t.myTaken, t.mateTaken),
  };
}

export function teamsDamageOverview(games: ResolvedTeamGame[]): TeamsDamageOverview {
  const t = emptyTotals();
  for (const g of games) accumulate(t, g);
  return toOverview(t);
}

export interface TeammateDamageRow extends TeamsDamageOverview {
  code: string;
  displayName: string | null;
}

/** Damage/FF splits per teammate. Offline games without connect codes are skipped. */
export function byTeammateDamage(games: ResolvedTeamGame[]): TeammateDamageRow[] {
  const map = new Map<string, { t: DmgTotals; name: string | null }>();
  for (const g of games) {
    const code = g.teammate.connectCode;
    if (!code) continue;
    let e = map.get(code);
    if (!e) {
      e = { t: emptyTotals(), name: null };
      map.set(code, e);
    }
    accumulate(e.t, g);
    e.name = g.teammate.displayName ?? e.name;
  }
  return Array.from(map.entries())
    .map(([code, e]) => ({ code, displayName: e.name, ...toOverview(e.t) }))
    .filter((r) => r.games > 0)
    .sort((a, b) => b.games - a.games);
}

export interface TeamsDamageWeek {
  week: string;
  games: number;
  myDmg: number; // per-game averages within the week
  mateDmg: number;
  myFF: number;
  mateFF: number;
}

/** Weekly per-game averages of damage and friendly fire, for the time series. */
export function teamsDamageByWeek(games: ResolvedTeamGame[]): TeamsDamageWeek[] {
  const map = new Map<string, DmgTotals>();
  for (const g of games) {
    if (!g.date) continue;
    const d = new Date(g.date);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // week start (Sunday)
    const key = d.toISOString().slice(0, 10);
    let t = map.get(key);
    if (!t) {
      t = emptyTotals();
      map.set(key, t);
    }
    accumulate(t, g);
  }
  return Array.from(map.entries())
    .filter(([, t]) => t.games > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, t]) => ({
      week,
      games: t.games,
      myDmg: t.myDmg / t.games,
      mateDmg: t.mateDmg / t.games,
      myFF: t.myFF / t.games,
      mateFF: t.mateFF / t.games,
    }));
}

export interface TeamsExecutionRow {
  who: "Me" | "Teammate";
  lCancelPct: number | null;
  ipm: number | null;
  wavedashesPerGame: number | null;
  dashDancesPerGame: number | null;
  grabSuccessPct: number | null;
}

/** Execution comparison (me vs teammate) over teams games. */
export function teamsExecution(games: ResolvedTeamGame[]): TeamsExecutionRow[] {
  const mk = () => ({ lcS: 0, lcF: 0, ipmSum: 0, ipmGames: 0, wd: 0, dd: 0, grabS: 0, grabs: 0, games: 0 });
  const me = mk();
  const mate = mk();
  for (const g of games) {
    for (const [agg, p] of [
      [me, g.me],
      [mate, g.teammate],
    ] as const) {
      agg.games++;
      agg.lcS += p.lCancelSuccess;
      agg.lcF += p.lCancelFail;
      if (p.inputsPerMinute !== null) {
        agg.ipmSum += p.inputsPerMinute;
        agg.ipmGames++;
      }
      agg.wd += p.actions.wavedashes;
      agg.dd += p.actions.dashDances;
      agg.grabS += p.grabSuccess;
      agg.grabs += p.actions.grabs;
    }
  }
  const row = (who: TeamsExecutionRow["who"], a: ReturnType<typeof mk>): TeamsExecutionRow => ({
    who,
    lCancelPct: a.lcS + a.lcF > 0 ? a.lcS / (a.lcS + a.lcF) : null,
    ipm: a.ipmGames ? a.ipmSum / a.ipmGames : null,
    wavedashesPerGame: a.games ? a.wd / a.games : null,
    dashDancesPerGame: a.games ? a.dd / a.games : null,
    grabSuccessPct: a.grabs > 0 ? a.grabS / a.grabs : null,
  });
  return [row("Me", me), row("Teammate", mate)];
}

export interface WeekBar {
  week: string;
  games: number;
}

export function gamesPerWeek(games: ResolvedGame[]): WeekBar[] {
  const map = new Map<string, number>();
  for (const g of games) {
    if (!g.date) continue;
    const d = new Date(g.date);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - day); // week start (Sunday)
    const key = d.toISOString().slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, games]) => ({ week, games }));
}
