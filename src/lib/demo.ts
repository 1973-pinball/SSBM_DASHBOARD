import type { GameRecord, PlayerSide } from "./types";
import { LEGAL_STAGE_IDS } from "./melee";

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
      stocksRemaining: kills === 4 ? Math.max(1, 4 - taken) : 0,
      kills,
      totalDamage: kills * (95 + rand() * 40),
      openingsPerKill: kills > 0 ? +(2.2 + rand() * 3.5 - (isMe ? t * 0.7 : 0)).toFixed(2) : null,
      damagePerOpening: +(18 + rand() * 18 + (isMe ? t * 4 : 0)).toFixed(2),
      inputsPerMinute: Math.floor(isMe ? 340 + t * 90 + rand() * 60 : 260 + rand() * 200),
      neutralWins: Math.floor(6 + rand() * 14),
      lCancelSuccess: isMe ? Math.floor(lcAttempts * lcRate) : Math.floor(lcAttempts * (0.6 + rand() * 0.3)),
      lCancelFail: isMe ? lcAttempts - Math.floor(lcAttempts * lcRate) : Math.floor(lcAttempts * 0.3),
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
    });
  }
  return records;
}
