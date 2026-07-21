import type { ResolvedGame } from "./types";

/**
 * Client-side "what predicts my wins?" models. Everything here is plain
 * TypeScript because replay data never leaves the browser.
 *
 * The workhorse is L2-regularized logistic regression fit by IRLS (Newton).
 * Win/loss is binary, so logistic regression is the multivariate linear
 * model for this outcome: each coefficient is the change in log-odds of
 * winning per +1 SD of that metric, holding the other metrics fixed.
 * Cost is O(iterations · n · k²) with k ≤ ~16 features — instant even on
 * 30k-game libraries.
 */

export type FeatureGroup = "execution" | "outcome";

export interface FeatureDef {
  key: string;
  label: string;
  group: FeatureGroup;
  /** null = not measurable in this game (e.g. no aerials landed → no L-cancel rate). */
  value: (g: ResolvedGame) => number | null;
}

const perMin = (count: number, g: ResolvedGame): number | null => {
  const minutes = g.rec.durationFrames / 3600;
  return minutes > 0 ? count / minutes : null;
};

export const WIN_MODEL_FEATURES: FeatureDef[] = [
  // --- Execution / habits: things you can directly practice ---
  {
    key: "lCancelPct", label: "L-cancel %", group: "execution",
    value: (g) => {
      const att = g.me.lCancelSuccess + g.me.lCancelFail;
      return att > 0 ? (g.me.lCancelSuccess / att) * 100 : null;
    },
  },
  { key: "ipm", label: "Inputs / minute", group: "execution", value: (g) => g.me.inputsPerMinute },
  { key: "wavedashes", label: "Wavedashes / min", group: "execution", value: (g) => perMin(g.me.actions?.wavedashes ?? 0, g) },
  { key: "wavelands", label: "Wavelands / min", group: "execution", value: (g) => perMin(g.me.actions?.wavelands ?? 0, g) },
  { key: "dashDances", label: "Dash dances / min", group: "execution", value: (g) => perMin(g.me.actions?.dashDances ?? 0, g) },
  { key: "rolls", label: "Rolls / min", group: "execution", value: (g) => perMin(g.me.actions?.rolls ?? 0, g) },
  { key: "airDodges", label: "Air dodges / min", group: "execution", value: (g) => perMin(g.me.actions?.airDodges ?? 0, g) },
  { key: "spotDodges", label: "Spot dodges / min", group: "execution", value: (g) => perMin(g.me.actions?.spotDodges ?? 0, g) },
  { key: "ledgeGrabs", label: "Ledge grabs / min", group: "execution", value: (g) => perMin(g.me.actions?.ledgeGrabs ?? 0, g) },
  { key: "grabs", label: "Grab attempts / min", group: "execution", value: (g) => perMin(g.me.actions?.grabs ?? 0, g) },
  // --- Outcome-linked: partly mechanical consequences of winning, not habits ---
  { key: "dpo", label: "Damage / opening", group: "outcome", value: (g) => g.me.damagePerOpening },
  { key: "opk", label: "Openings / kill", group: "outcome", value: (g) => g.me.openingsPerKill },
  {
    key: "neutralShare", label: "Neutral-win share", group: "outcome",
    value: (g) => {
      const total = g.me.neutralWins + g.opp.neutralWins;
      return total > 0 ? (g.me.neutralWins / total) * 100 : null;
    },
  },
  { key: "counterHits", label: "Counter hits / min", group: "outcome", value: (g) => perMin(g.me.counterHits, g) },
  { key: "trades", label: "Beneficial trades / min", group: "outcome", value: (g) => perMin(g.me.beneficialTrades, g) },
];

export interface CoefRow {
  key: string;
  label: string;
  group: FeatureGroup;
  /** Log-odds change per +1 SD of the metric, other metrics held fixed. */
  coef: number;
  se: number;
  z: number;
  p: number;
  /** exp(coef): multiplicative odds change per +1 SD. */
  oddsPerSd: number;
  mean: number;
  sd: number;
}

export interface WinModel {
  n: number;
  wins: number;
  baseRate: number;
  intercept: number;
  coefs: CoefRow[]; // sorted by |z| descending
  mcfaddenR2: number;
  auc: number;
  converged: boolean;
  /** Feature pairs with |r| > 0.7 — coefficients split credit between these. */
  collinear: { a: string; b: string; r: number }[];
  dropped: string[]; // zero-variance features excluded from the fit
}

/** Gauss-Jordan inverse; returns null if singular. Fine for k ≤ ~20. */
function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];
    const d = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}

/** Standard normal upper-tail probability (Abramowitz & Stegun 26.2.17). */
function upperTail(z: number): number {
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804 * Math.exp((-z * z) / 2);
  return d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
}

const twoSidedP = (z: number): number => Math.min(1, 2 * upperTail(Math.abs(z)));

/** Mann-Whitney AUC with average ranks for ties. */
function computeAuc(scores: number[], y: number[]): number {
  const idx = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const ranks = new Array<number>(scores.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = avg;
    i = j + 1;
  }
  let posRankSum = 0, nPos = 0;
  for (let r = 0; r < y.length; r++) {
    if (y[r] === 1) { posRankSum += ranks[r]; nPos++; }
  }
  const nNeg = y.length - nPos;
  if (nPos === 0 || nNeg === 0) return 0.5;
  return (posRankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

/**
 * Fit the logistic model on games where the outcome and every requested
 * feature are known (listwise deletion). Returns null when there's too
 * little data to say anything (n < 40 or fewer than 10 of either class).
 */
export function fitWinModel(games: ResolvedGame[], features: FeatureDef[]): WinModel | null {
  const rows: number[][] = [];
  const y: number[] = [];
  for (const g of games) {
    if (g.isWin === null) continue;
    const row: number[] = [];
    let ok = true;
    for (const f of features) {
      const v = f.value(g);
      if (v === null || !Number.isFinite(v)) { ok = false; break; }
      row.push(v);
    }
    if (!ok) continue;
    rows.push(row);
    y.push(g.isWin ? 1 : 0);
  }

  const n = rows.length;
  const wins = y.reduce((s, v) => s + v, 0);
  if (n < 40 || wins < 10 || n - wins < 10) return null;

  // Standardize; drop zero-variance features.
  const means = features.map((_, j) => rows.reduce((s, r) => s + r[j], 0) / n);
  const sds = features.map((_, j) => Math.sqrt(rows.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / n));
  const kept: number[] = [];
  const dropped: string[] = [];
  features.forEach((f, j) => (sds[j] > 1e-9 ? kept.push(j) : dropped.push(f.label)));
  if (kept.length === 0) return null;
  const X = rows.map((r) => [1, ...kept.map((j) => (r[j] - means[j]) / sds[j])]);
  const k = kept.length + 1; // + intercept

  // Collinearity report on the standardized features.
  const collinear: { a: string; b: string; r: number }[] = [];
  for (let a = 0; a < kept.length; a++) {
    for (let b = a + 1; b < kept.length; b++) {
      let s = 0;
      for (const row of X) s += row[a + 1] * row[b + 1];
      const r = s / n;
      if (Math.abs(r) > 0.7) collinear.push({ a: features[kept[a]].label, b: features[kept[b]].label, r });
    }
  }

  // IRLS with a small ridge on non-intercept terms (stabilizes near-separation).
  const lambda = 0.01;
  let beta = new Array<number>(k).fill(0);
  let converged = false;
  let Hinv: number[][] | null = null;
  for (let iter = 0; iter < 60; iter++) {
    const p = X.map((row) => {
      const xb = row.reduce((s, v, j) => s + v * beta[j], 0);
      return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, xb))));
    });
    const grad = new Array<number>(k).fill(0);
    const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let r = 0; r < n; r++) {
      const w = Math.max(1e-9, p[r] * (1 - p[r]));
      const resid = y[r] - p[r];
      for (let j = 0; j < k; j++) {
        grad[j] += X[r][j] * resid;
        for (let l = j; l < k; l++) H[j][l] += X[r][j] * X[r][l] * w;
      }
    }
    for (let j = 0; j < k; j++) for (let l = 0; l < j; l++) H[j][l] = H[l][j];
    for (let j = 1; j < k; j++) {
      grad[j] -= lambda * beta[j];
      H[j][j] += lambda;
    }
    Hinv = invert(H);
    if (!Hinv) break;
    const step = Hinv.map((row) => row.reduce((s, v, j) => s + v * grad[j], 0));
    beta = beta.map((b, j) => b + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) { converged = true; break; }
  }
  if (!Hinv) return null;

  // Fit quality: McFadden pseudo-R² and in-sample AUC.
  const scores = X.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
  let ll = 0;
  for (let r = 0; r < n; r++) {
    const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, scores[r]))));
    ll += y[r] === 1 ? Math.log(Math.max(1e-12, p)) : Math.log(Math.max(1e-12, 1 - p));
  }
  const base = wins / n;
  const ll0 = wins * Math.log(base) + (n - wins) * Math.log(1 - base);
  const mcfaddenR2 = ll0 < 0 ? 1 - ll / ll0 : 0;
  const auc = computeAuc(scores, y);

  const coefs: CoefRow[] = kept.map((j, idx) => {
    const coef = beta[idx + 1];
    const se = Math.sqrt(Math.max(0, Hinv![idx + 1][idx + 1]));
    const z = se > 0 ? coef / se : 0;
    return {
      key: features[j].key,
      label: features[j].label,
      group: features[j].group,
      coef,
      se,
      z,
      p: twoSidedP(z),
      oddsPerSd: Math.exp(coef),
      mean: means[j],
      sd: sds[j],
    };
  });
  coefs.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

  return { n, wins, baseRate: base, intercept: beta[0], coefs, mcfaddenR2, auc, converged, collinear, dropped };
}

export interface QuartileRow {
  key: string;
  label: string;
  group: FeatureGroup;
  n: number;
  /** Win rate + value range per quartile, Q1 (lowest values) → Q4 (highest). */
  quartiles: { winRate: number; n: number; lo: number; hi: number }[];
  /** Q4 win rate − Q1 win rate: the headline "does more of this come with more wins?" */
  spread: number;
}

/**
 * Model-free view of the same question: sort games by each metric, cut into
 * quartiles, report the win rate in each. No assumptions, no other-metric
 * adjustment — the cross-check for the regression table.
 */
export function quartileWinRates(games: ResolvedGame[], features: FeatureDef[]): QuartileRow[] {
  const out: QuartileRow[] = [];
  for (const f of features) {
    const pts: { v: number; win: number }[] = [];
    for (const g of games) {
      if (g.isWin === null) continue;
      const v = f.value(g);
      if (v === null || !Number.isFinite(v)) continue;
      pts.push({ v, win: g.isWin ? 1 : 0 });
    }
    if (pts.length < 40) continue;
    pts.sort((a, b) => a.v - b.v);
    const quartiles = Array.from({ length: 4 }, (_, q) => {
      const lo = Math.floor((q * pts.length) / 4);
      const hi = Math.floor(((q + 1) * pts.length) / 4);
      const slice = pts.slice(lo, hi);
      const winSum = slice.reduce((s, p) => s + p.win, 0);
      return { winRate: winSum / slice.length, n: slice.length, lo: slice[0].v, hi: slice[slice.length - 1].v };
    });
    out.push({
      key: f.key,
      label: f.label,
      group: f.group,
      n: pts.length,
      quartiles,
      spread: quartiles[3].winRate - quartiles[0].winRate,
    });
  }
  out.sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread));
  return out;
}
