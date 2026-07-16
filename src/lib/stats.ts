import type { Filters, GameRecord, ResolvedGame } from "./types";

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
    if (rec.parseError || rec.players.length !== 2) continue;
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
    const meIdx = rec.players.findIndex((p) => p.connectCode && myCodes.has(p.connectCode));
    if (meIdx < 0) continue;
    const me = rec.players[meIdx];
    const opp = rec.players[1 - meIdx];
    const isWin = rec.winnerIndex === null ? null : rec.winnerIndex === meIdx;
    out.push({ rec, me, opp, isWin, date: rec.playedAt ? new Date(rec.playedAt) : null });
  }
  return out.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
}

const RANGE_DAYS: Record<Exclude<Filters["range"], "all">, number> = { "30d": 30, "90d": 90, "1y": 365 };

export function applyFilters(games: ResolvedGame[], f: Filters): ResolvedGame[] {
  let cutoff: number | null = null;
  if (f.range !== "all") cutoff = Date.now() - RANGE_DAYS[f.range] * 86_400_000;
  return games.filter((g) => {
    if (cutoff !== null && (!g.date || g.date.getTime() < cutoff)) return false;
    if (f.myCharacter !== null && g.me.characterId !== f.myCharacter) return false;
    if (f.oppCharacter !== null && g.opp.characterId !== f.oppCharacter) return false;
    if (f.stageId !== null && g.rec.stageId !== f.stageId) return false;
    if (f.opponentCode !== null && g.opp.connectCode !== f.opponentCode) return false;
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

export function tally(games: ResolvedGame[]): WL {
  let wins = 0;
  let losses = 0;
  for (const g of games) {
    if (g.isWin === true) wins++;
    else if (g.isWin === false) losses++;
  }
  return { games: games.length, wins, losses, decided: wins + losses, winRate: winRate(wins, wins + losses) };
}

export interface OverviewStats extends WL {
  totalKills: number;
  killsPerGame: number | null;
  deathsPerGame: number | null;
  avgGameSeconds: number | null;
  currentStreak: { kind: "W" | "L"; length: number } | null;
  prevWinRate: number | null; // same-length window immediately before the current one
}

export function overview(games: ResolvedGame[], allResolved: ResolvedGame[], f: Filters): OverviewStats {
  const base = tally(games);
  let kills = 0;
  let deaths = 0;
  let frames = 0;
  for (const g of games) {
    kills += g.me.kills;
    deaths += g.opp.kills;
    frames += g.rec.durationFrames;
  }
  // Streak over decided games, most recent last.
  let streak: OverviewStats["currentStreak"] = null;
  for (let i = games.length - 1; i >= 0; i--) {
    const w = games[i].isWin;
    if (w === null) continue;
    const kind = w ? "W" : "L";
    if (!streak) streak = { kind, length: 1 };
    else if (streak.kind === kind) streak.length++;
    else break;
  }
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
    avgGameSeconds: games.length ? frames / 60 / games.length : null,
    currentStreak: streak,
    prevWinRate,
  };
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
}

export function executionTrend(games: ResolvedGame[], window = 30): ExecutionPoint[] {
  const out: ExecutionPoint[] = [];
  for (let i = 0; i < games.length; i++) {
    if ((i + 1) % Math.max(1, Math.floor(window / 3)) !== 0 && i !== games.length - 1) continue;
    const slice = games.slice(Math.max(0, i - window + 1), i + 1);
    let lcS = 0, lcF = 0, opkSum = 0, opkN = 0, dpoSum = 0, dpoN = 0, ipmSum = 0, ipmN = 0;
    for (const g of slice) {
      lcS += g.me.lCancelSuccess;
      lcF += g.me.lCancelFail;
      if (g.me.openingsPerKill !== null) { opkSum += g.me.openingsPerKill; opkN++; }
      if (g.me.damagePerOpening !== null) { dpoSum += g.me.damagePerOpening; dpoN++; }
      if (g.me.inputsPerMinute !== null) { ipmSum += g.me.inputsPerMinute; ipmN++; }
    }
    out.push({
      index: i + 1,
      date: games[i].date?.toISOString().slice(0, 10) ?? "",
      lCancel: lcS + lcF > 0 ? (lcS / (lcS + lcF)) * 100 : null,
      opk: opkN ? opkSum / opkN : null,
      dpo: dpoN ? dpoSum / dpoN : null,
      ipm: ipmN ? ipmSum / ipmN : null,
    });
  }
  return out;
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
