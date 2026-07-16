import type { ActionCounts, GameRecord, PlayerSide } from "./types";
import { LEGAL_STAGE_IDS } from "./melee";

/** Plausible per-game action counts, scaled by game length; `tech` in [0,1] raises movement actions. */
function mkActions(rand: () => number, minutes: number, tech: number): ActionCounts {
  const per = (base: number, spread: number) => Math.round(minutes * (base + rand() * spread));
  return {
    rolls: per(4 - tech * 2, 4),
    airDodges: per(2, 3),
    spotDodges: per(1, 2.5),
    wavedashes: per(6 + tech * 10, 8),
    wavelands: per(2 + tech * 4, 3),
    dashDances: per(12 + tech * 14, 10),
    ledgeGrabs: per(1.5, 2),
  };
}

// Deterministic PRNG so the demo dashboard is stable between loads.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_CODE = "DEMO#420";

interface Rival {
  code: string;
  name: string;
  chars: number[];
  skill: number; // demo player's win prob vs them
  weight: number;
}

const RIVALS: Rival[] = [
  { code: "FOXG#0", name: "20GX", chars: [2], skill: 0.38, weight: 18 },
  { code: "MARF#33", name: "tippercity", chars: [9], skill: 0.55, weight: 14 },
  { code: "PUFF#88", name: "restzone", chars: [15], skill: 0.62, weight: 11 },
  { code: "FALC#123", name: "knee4days", chars: [0], skill: 0.58, weight: 10 },
  { code: "SHEK#7", name: "needle.exe", chars: [19, 18], skill: 0.44, weight: 9 },
  { code: "PECH#2", name: "turnipmath", chars: [12], skill: 0.51, weight: 8 },
  { code: "ICSY#11", name: "wobbleswobbles", chars: [14], skill: 0.66, weight: 6 },
  { code: "SAMU#909", name: "upBoutOfHere", chars: [16], skill: 0.71, weight: 5 },
  { code: "GANN#66", name: "dorfdaddy", chars: [25], skill: 0.74, weight: 5 },
  { code: "LUIG#31", name: "wavelander", chars: [7], skill: 0.6, weight: 4 },
  { code: "YOSH#5", name: "parryking", chars: [17], skill: 0.57, weight: 4 },
  { code: "DOCM#77", name: "pillzhere", chars: [22], skill: 0.53, weight: 6 },
];

const MY_CHARS = [
  { id: 20, weight: 0.72, edge: 0 }, // Falco main
  { id: 2, weight: 0.2, edge: -0.05 }, // Fox secondary
  { id: 9, weight: 0.08, edge: -0.1 }, // Marth pocket
];

interface Mate {
  code: string;
  name: string;
  char: number;
  synergy: number; // win-prob bump when teaming with them
  weight: number;
}

const MATES: Mate[] = [
  { code: "BUDD#1", name: "sameroom", char: 9, synergy: 0.14, weight: 20 }, // Marth — the good one
  { code: "JIGG#404", name: "sleepytime", char: 15, synergy: 0.04, weight: 12 },
  { code: "SPCE#12", name: "spaceanimal", char: 2, synergy: -0.02, weight: 9 },
  { code: "RAND#0", name: "pubmate", char: 7, synergy: -0.11, weight: 5 }, // randoms drag it down
];

function pickWeighted<T extends { weight: number }>(rand: () => number, items: T[]): T {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

export function generateDemoRecords(count = 1600, seed = 20260716): GameRecord[] {
  const rand = mulberry32(seed);
  const records: GameRecord[] = [];
  const start = Date.now() - 365 * 86_400_000;

  // Simulate improvement over the year: win prob drifts up ~8 points.
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const playedAt = new Date(start + t * 364 * 86_400_000 + rand() * 4 * 3_600_000);
    const rival = pickWeighted(rand, RIVALS);
    const mine = pickWeighted(rand, MY_CHARS.map((c) => ({ ...c, weight: c.weight * 100 })));
    const oppChar = rival.chars[Math.floor(rand() * rival.chars.length)];
    const pWin = Math.min(0.85, Math.max(0.15, rival.skill + mine.edge + t * 0.08 + (rand() - 0.5) * 0.06));
    const iWin = rand() < pWin;

    const durationFrames = Math.floor((90 + rand() * 240) * 60);
    const minutes = durationFrames / 3600;
    const myKills = iWin ? 4 : Math.floor(rand() * 4);
    const oppKills = iWin ? Math.floor(rand() * 4) : 4;
    const lcAttempts = Math.floor(minutes * (26 + rand() * 14));
    const lcRate = Math.min(0.98, 0.68 + t * 0.16 + (rand() - 0.5) * 0.1);

    const mkSide = (kills: number, taken: number, isMe: boolean): PlayerSide => ({
      port: isMe ? 1 : 2,
      connectCode: isMe ? DEMO_CODE : rival.code,
      displayName: isMe ? "demo" : rival.name,
      characterId: isMe ? mine.id : oppChar,
      colorId: 0,
      teamId: null,
      stocksRemaining: kills === 4 ? Math.max(1, 4 - taken) : 0,
      kills,
      totalDamage: kills * (95 + rand() * 40),
      openingsPerKill: kills > 0 ? +(2.2 + rand() * 3.5 - (isMe ? t * 0.7 : 0)).toFixed(2) : null,
      damagePerOpening: +(18 + rand() * 18 + (isMe ? t * 4 : 0)).toFixed(2),
      inputsPerMinute: Math.floor(isMe ? 340 + t * 90 + rand() * 60 : 260 + rand() * 200),
      neutralWins: Math.floor(6 + rand() * 14),
      counterHits: Math.floor(2 + rand() * 9),
      beneficialTrades: Math.floor(rand() * 3),
      lCancelSuccess: isMe ? Math.floor(lcAttempts * lcRate) : Math.floor(lcAttempts * (0.6 + rand() * 0.3)),
      lCancelFail: isMe ? lcAttempts - Math.floor(lcAttempts * lcRate) : Math.floor(lcAttempts * 0.3),
      actions: mkActions(rand, minutes, isMe ? 0.4 + t * 0.5 : 0.3 + rand() * 0.5),
    });

    const me = mkSide(myKills, oppKills, true);
    const opp = mkSide(oppKills, myKills, false);
    const rare = rand();
    records.push({
      id: `demo-${i}`,
      path: `demo/Game_${playedAt.toISOString().replace(/[:.]/g, "")}.slp`,
      playedAt: playedAt.toISOString(),
      durationFrames,
      stageId: LEGAL_STAGE_IDS[Math.floor(rand() * LEGAL_STAGE_IDS.length)],
      gameType: rare < 0.55 ? "ranked" : rare < 0.9 ? "unranked" : "direct",
      isTeams: false,
      players: [me, opp],
      winnerIndex: rare > 0.985 ? null : iWin ? 0 : 1, // ~1.5% indeterminate (quit-outs etc.)
      winnerTeamId: null,
    });
  }
  records.push(...generateDemoTeamRecords(rand, start, Math.round(count * 0.14)));
  return records;
}

/** 2v2 games sharing the demo player's identity, so the Teams view has something to show. */
function generateDemoTeamRecords(rand: () => number, start: number, count: number): GameRecord[] {
  const records: GameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const playedAt = new Date(start + t * 364 * 86_400_000 + rand() * 4 * 3_600_000);
    const mate = pickWeighted(rand, MATES);
    const mine = pickWeighted(rand, MY_CHARS.map((c) => ({ ...c, weight: c.weight * 100 })));
    const rivalA = pickWeighted(rand, RIVALS);
    let rivalB = pickWeighted(rand, RIVALS);
    if (rivalB.code === rivalA.code) rivalB = RIVALS[(RIVALS.indexOf(rivalA) + 1) % RIVALS.length];

    const pWin = Math.min(0.88, Math.max(0.12, 0.5 + mate.synergy + mine.edge + t * 0.06 + (rand() - 0.5) * 0.12));
    const weWin = rand() < pWin;
    const durationFrames = Math.floor((150 + rand() * 300) * 60);

    // 8 team stocks total; the losing team is stocked out.
    const ourStocks = weWin ? 1 + Math.floor(rand() * 4) : 0;
    const theirStocks = weWin ? 0 : 1 + Math.floor(rand() * 4);
    const split = 0.35 + rand() * 0.3; // how the duo's kills divide
    const ourKills = 8 - theirStocks;
    const theirKills = 8 - ourStocks;

    const mk = (
      port: number,
      teamId: number,
      code: string,
      name: string,
      characterId: number,
      kills: number,
      stocks: number,
    ): PlayerSide => ({
      port,
      connectCode: code,
      displayName: name,
      characterId,
      colorId: teamId,
      teamId,
      stocksRemaining: stocks,
      kills,
      totalDamage: kills * (90 + rand() * 45),
      openingsPerKill: kills > 0 ? +(2.6 + rand() * 3.2).toFixed(2) : null,
      damagePerOpening: +(16 + rand() * 16).toFixed(2),
      inputsPerMinute: Math.floor(280 + rand() * 180),
      neutralWins: Math.floor(5 + rand() * 16),
      counterHits: Math.floor(2 + rand() * 8),
      beneficialTrades: Math.floor(rand() * 3),
      lCancelSuccess: Math.floor(durationFrames / 3600 * (26 + rand() * 12)),
      lCancelFail: Math.floor(durationFrames / 3600 * (2 + rand() * 6)),
      actions: mkActions(rand, durationFrames / 3600, 0.3 + rand() * 0.5),
    });

    const myKills = Math.round(ourKills * split);
    const theirA = Math.round(theirKills * (0.4 + rand() * 0.2));
    const players: PlayerSide[] = [
      mk(1, 0, DEMO_CODE, "demo", mine.id, myKills, Math.ceil(ourStocks / 2)),
      mk(2, 0, mate.code, mate.name, mate.char, ourKills - myKills, Math.floor(ourStocks / 2)),
      mk(3, 1, rivalA.code, rivalA.name, rivalA.chars[0], theirA, Math.ceil(theirStocks / 2)),
      mk(4, 1, rivalB.code, rivalB.name, rivalB.chars[0], theirKills - theirA, Math.floor(theirStocks / 2)),
    ];

    const rare = rand();
    records.push({
      id: `demo-teams-${i}`,
      path: `demo/Teams_${playedAt.toISOString().replace(/[:.]/g, "")}.slp`,
      playedAt: playedAt.toISOString(),
      durationFrames,
      stageId: LEGAL_STAGE_IDS[Math.floor(rand() * LEGAL_STAGE_IDS.length)],
      gameType: rare < 0.7 ? "direct" : "unranked", // no ranked doubles matchmaking
      isTeams: true,
      players,
      winnerIndex: null,
      winnerTeamId: rare > 0.98 ? null : weWin ? 0 : 1,
    });
  }
  return records;
}
