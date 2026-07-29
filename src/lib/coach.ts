import type { ResolvedGame } from "./types";
import {
  byOppCharacter, byStage, computeSessions, executionSummary, tally, tiltStats, winRateBySessionPosition,
} from "./stats";
import { charName, stageName } from "./melee";

/**
 * Prescriptive coaching: turn the selectors the dashboard already computes into
 * a short ranked list of plain-English "do this" items. Every item is gated on
 * sample size and a z-score against the player's own baseline, so nothing here
 * is noise dressed up as advice — if the data doesn't clear the bar, we say
 * nothing rather than something.
 */

export interface Recommendation {
  kind: "matchup" | "stage-ban" | "stage-pick" | "tilt" | "fatigue" | "execution";
  headline: string;
  detail: string;
  /** Effect size × evidence; used only for ordering. */
  score: number;
}

export const COACH_MIN_DECIDED = 40;

const pctText = (p: number, digits = 0) => `${(p * 100).toFixed(digits)}%`;

/** One-sample z of p against baseline p0 over n decided games. */
const zScore = (p: number, p0: number, n: number) => (p - p0) / Math.sqrt((p0 * (1 - p0)) / n);

const Z_GATE = 1.6; // ~90% one-sided — advice threshold, not a publication

export function recommendations(games: ResolvedGame[], max = 5): Recommendation[] {
  const base = tally(games);
  if (base.decided < COACH_MIN_DECIDED || base.winRate === null) return [];
  const p0 = base.winRate;
  if (p0 <= 0 || p0 >= 1) return [];
  const out: Recommendation[] = [];
  const push = (kind: Recommendation["kind"], headline: string, detail: string, effect: number, n: number) =>
    out.push({ kind, headline, detail, score: Math.abs(effect) * Math.sqrt(n) });

  // Worst matchup by opponent character, with an in-matchup stage tip when one stands out.
  let worstMu: { char: number; rate: number; decided: number; z: number } | null = null;
  for (const row of byOppCharacter(games)) {
    if (row.decided < 20 || row.winRate === null) continue;
    const z = zScore(row.winRate, p0, row.decided);
    if (z <= -Z_GATE && (!worstMu || z < worstMu.z)) worstMu = { char: row.characterId, rate: row.winRate, decided: row.decided, z };
  }
  if (worstMu) {
    const mu = worstMu;
    const inMatchup = games.filter((g) => g.opp.characterId === mu.char);
    let stageTip = "";
    let bestStage: { id: number; rate: number; decided: number } | null = null;
    for (const s of byStage(inMatchup)) {
      if (s.decided < 8 || s.winRate === null) continue;
      if (s.winRate >= mu.rate + 0.12 && (!bestStage || s.winRate > bestStage.rate)) {
        bestStage = { id: s.stageId, rate: s.winRate, decided: s.decided };
      }
    }
    if (bestStage) {
      stageTip = ` One lever already works: you win ${pctText(bestStage.rate)} of this matchup on ${stageName(bestStage.id)} (${bestStage.decided} games) — take them there.`;
    }
    push(
      "matchup",
      `Drill the ${charName(mu.char)} matchup`,
      `You win ${pctText(mu.rate)} of ${mu.decided} decided games against ${charName(mu.char)}, versus ${pctText(p0)} overall — your worst common matchup.${stageTip}`,
      mu.rate - p0,
      mu.decided,
    );
  }

  // Stage to ban / stage to take, independent of matchup.
  let ban: { id: number; rate: number; decided: number; z: number } | null = null;
  let pick: { id: number; rate: number; decided: number; z: number } | null = null;
  for (const s of byStage(games)) {
    if (s.decided < 30 || s.winRate === null) continue;
    const z = zScore(s.winRate, p0, s.decided);
    if (z <= -Z_GATE && (!ban || z < ban.z)) ban = { id: s.stageId, rate: s.winRate, decided: s.decided, z };
    if (z >= Z_GATE && (!pick || z > pick.z)) pick = { id: s.stageId, rate: s.winRate, decided: s.decided, z };
  }
  if (ban) {
    push(
      "stage-ban",
      `Ban ${stageName(ban.id)}`,
      `You win ${pctText(ban.rate)} of ${ban.decided} decided games there, versus ${pctText(p0)} overall. Until that gap closes, spend your ban on it every time.`,
      ban.rate - p0,
      ban.decided,
    );
  }
  if (pick) {
    push(
      "stage-pick",
      `Counterpick ${stageName(pick.id)}`,
      `${pctText(pick.rate)} over ${pick.decided} decided games, versus ${pctText(p0)} overall — your best stage by a real margin. Take opponents there when you get the choice.`,
      pick.rate - p0,
      pick.decided,
    );
  }

  // Tilt: performance right after consecutive losses, within a session.
  const sessions = computeSessions(games);
  const tilt = tiltStats(sessions);
  let tiltWins = 0, tiltDecided = 0;
  for (const row of tilt) {
    if (row.label === "After 2 losses" || row.label === "After 3+ losses") {
      tiltWins += row.wins;
      tiltDecided += row.decided;
    }
  }
  if (tiltDecided >= 25) {
    const rate = tiltWins / tiltDecided;
    if (zScore(rate, p0, tiltDecided) <= -Z_GATE) {
      push(
        "tilt",
        "Walk away after two straight losses",
        `Down two or more in a session, you win just ${pctText(rate)} of the next games (${tiltDecided} of them), versus ${pctText(p0)} overall. A five-minute break is worth more than a runback.`,
        rate - p0,
        tiltDecided,
      );
    }
  }

  // Fatigue: late-session games underperforming.
  const pos = winRateBySessionPosition(sessions);
  let lateWins = 0, lateDecided = 0;
  for (const row of pos) {
    if (row.label === "Games 16–20" || row.label === "Games 21+") {
      lateWins += row.wins;
      lateDecided += row.decided;
    }
  }
  if (lateDecided >= 25) {
    const rate = lateWins / lateDecided;
    if (zScore(rate, p0, lateDecided) <= -Z_GATE) {
      push(
        "fatigue",
        "Cap your sessions around 15 games",
        `Past game 15 of a session your win rate drops to ${pctText(rate)} (${lateDecided} decided games), versus ${pctText(p0)} overall. The long sets are donating wins.`,
        rate - p0,
        lateDecided,
      );
    }
  }

  // Execution drift: recent L-cancel vs career.
  const career = executionSummary(games, games.length);
  const recent = executionSummary(games, 50);
  if (games.length >= 150 && career.lCancel !== null && recent.lCancel !== null) {
    const diff = recent.lCancel - career.lCancel;
    if (Math.abs(diff) >= 2) {
      const up = diff > 0;
      push(
        "execution",
        up ? "Your hands are heating up — keep the routine" : "L-cancels are slipping",
        `${recent.lCancel.toFixed(1)}% L-cancel over your last 50 games, versus ${career.lCancel.toFixed(1)}% career${up ? ". Whatever you changed recently, keep doing it." : " — worth a warm-up routine before queueing."}`,
        (diff / 100) * 2, // rough parity with win-rate effects so it ranks, not dominates
        50,
      );
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, max);
}
