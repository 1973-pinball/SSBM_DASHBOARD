// Pure selectors over the bundled Liquipedia dataset. The dataset is tiny
// (hundreds of rows, not the user's 30k games), so clarity beats micro-perf.

import type { Major, PlayerMeta, RankingEdition } from "./types";
import { CHAR_STACK_ORDER, OTHER_CHAR } from "./chars";

// ---------------- Majors ----------------

export interface YearCount {
  year: number;
  /** Non-supermajor majors — the lower stack segment. */
  major: number;
  supermajor: number;
  count: number;
}

/** Majors per calendar year split by tier, with zero-count gap years kept (COVID). */
export function majorsPerYear(majors: Major[]): YearCount[] {
  if (majors.length === 0) return [];
  const byYear = new Map<number, { major: number; supermajor: number }>();
  let min = Infinity;
  let max = -Infinity;
  for (const m of majors) {
    const cur = byYear.get(m.year) ?? { major: 0, supermajor: 0 };
    cur[m.tier === "supermajor" ? "supermajor" : "major"]++;
    byYear.set(m.year, cur);
    if (m.year < min) min = m.year;
    if (m.year > max) max = m.year;
  }
  const out: YearCount[] = [];
  for (let y = min; y <= max; y++) {
    const c = byYear.get(y) ?? { major: 0, supermajor: 0 };
    out.push({ year: y, major: c.major, supermajor: c.supermajor, count: c.major + c.supermajor });
  }
  return out;
}

/** Majors sorted chronologically (date strings are YYYY-MM[-DD], so lexicographic works). */
export const sortedMajors = (majors: Major[]): Major[] =>
  [...majors].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

export interface RaceStanding {
  player: string;
  count: number;
}

export interface RaceFrame {
  /** The major whose result this frame lands (frame 0 = before any major). */
  major: Major | null;
  /** Sorted desc; ties broken by who reached the count first (stable race order). */
  standings: RaceStanding[];
}

/**
 * Cumulative major-title standings after each major, oldest → newest.
 * Frame i shows the world the moment major i finishes.
 */
export function raceFrames(majors: Major[]): RaceFrame[] {
  const ordered = sortedMajors(majors);
  const counts = new Map<string, number>();
  // When each player *reached their current total* — not when they first won.
  // Using the first win would let an early-debuting player jump above someone
  // they merely tied, so a bar would animate past one it only caught.
  const reachedAt = new Map<string, number>();
  const frames: RaceFrame[] = [{ major: null, standings: [] }];
  ordered.forEach((m, i) => {
    counts.set(m.winner, (counts.get(m.winner) ?? 0) + 1);
    reachedAt.set(m.winner, i);
    const standings = [...counts.entries()]
      .map(([player, count]) => ({ player, count }))
      .sort(
        (a, b) =>
          b.count - a.count || reachedAt.get(a.player)! - reachedAt.get(b.player)! || a.player.localeCompare(b.player),
      );
    frames.push({ major: m, standings });
  });
  return frames;
}

export interface CareerRow {
  player: string;
  majors: number;
  earningsUsd: number | null;
  mains: string[];
  firstWin: string;
  lastWin: string;
}

/** Final leaderboard: majors won (desc), then winnings. */
export function careerLeaderboard(majors: Major[], players: Record<string, PlayerMeta>): CareerRow[] {
  const rows = new Map<string, CareerRow>();
  for (const m of sortedMajors(majors)) {
    const row = rows.get(m.winner);
    if (row) {
      row.majors++;
      row.lastWin = m.date;
    } else {
      const meta = players[m.winner];
      rows.set(m.winner, {
        player: m.winner,
        majors: 1,
        earningsUsd: meta?.earningsUsd ?? null,
        mains: meta?.mains ?? [],
        firstWin: m.date,
        lastWin: m.date,
      });
    }
  }
  return [...rows.values()].sort((a, b) => b.majors - a.majors || (b.earningsUsd ?? 0) - (a.earningsUsd ?? 0));
}

// ---------------- Top-100 character composition ----------------

export interface CharRep {
  player: string;
  rank: number;
}

export interface CharStat {
  char: string;
  /** Players whose PRIMARY main this is (first listed character). */
  count: number;
  /** Ranked reps, best first — reps[0] is the character's torchbearer that year. */
  reps: CharRep[];
}

export interface EditionComposition {
  edition: RankingEdition;
  /** Sorted by count desc, then by best rank. */
  chars: CharStat[];
  byChar: Map<string, CharStat>;
}

/** Primary-main composition of each ranking edition. */
export function compositionByEdition(editions: RankingEdition[]): EditionComposition[] {
  return [...editions]
    .sort((a, b) => a.year - b.year)
    .map((edition) => {
      const byChar = new Map<string, CharStat>();
      for (const e of edition.entries) {
        const main = e.chars[0];
        if (!main) continue;
        let stat = byChar.get(main);
        if (!stat) {
          stat = { char: main, count: 0, reps: [] };
          byChar.set(main, stat);
        }
        stat.count++;
        stat.reps.push({ player: e.player, rank: e.rank });
      }
      for (const stat of byChar.values()) stat.reps.sort((a, b) => a.rank - b.rank);
      const chars = [...byChar.values()].sort((a, b) => b.count - a.count || a.reps[0]!.rank - b.reps[0]!.rank);
      return { edition, chars, byChar };
    });
}

/** Row shape for the stacked composition area chart. */
export interface CompositionRow {
  label: string;
  year: number;
  values: Record<string, number>; // CHAR_STACK_ORDER keys + Other
}

/** Named-character counts per edition with the long tail folded into Other. */
export function compositionSeries(comps: EditionComposition[]): CompositionRow[] {
  return comps.map((c) => {
    const values: Record<string, number> = {};
    let named = 0;
    for (const char of CHAR_STACK_ORDER) {
      const n = c.byChar.get(char)?.count ?? 0;
      values[char] = n;
      named += n;
    }
    const total = c.chars.reduce((s, ch) => s + ch.count, 0);
    values[OTHER_CHAR] = total - named;
    return { label: editionLabel(c.edition), year: c.edition.year, values };
  });
}

/** Short x-axis label: the season year (titles disambiguate in tooltips). */
export const editionLabel = (e: RankingEdition): string => String(e.year);

// ---------------- Character storylines ----------------

export interface CharStoryline {
  char: string;
  /** Edition where the character first cracked the top 100, and who carried it. */
  arrival: { year: number; title: string; rep: CharRep };
  /** Whether the character was absent from the FIRST edition (a true "arrival"). */
  newcomer: boolean;
  peak: { year: number; count: number };
  bestEver: { year: number; rep: CharRep };
  /** Count in the latest edition (0 = fell out of the top 100). */
  current: number;
  currentTop: CharRep | null;
}

export interface Breakthrough {
  year: number;
  title: string;
  char: string;
  player: string;
  rank: number;
  /** "debut" = first ever top-100 entry; "top10"/"top25" = first time that high. */
  kind: "debut" | "top25" | "top10";
}

const KIND_LABEL: Record<Breakthrough["kind"], string> = {
  debut: "first ranked",
  top25: "first top 25",
  top10: "first top 10",
};

export const breakthroughLabel = (b: Breakthrough): string => KIND_LABEL[b.kind];

/**
 * Chronological list of "a character arrived" moments and the player behind
 * each: its first appearance in a top-100 list (for characters that debuted
 * after the first edition), and the first time any of its players cracked the
 * top 25 and top 10. This is the aMSa/Yoshi story, generalized.
 */
export function breakthroughs(comps: EditionComposition[]): Breakthrough[] {
  const out: Breakthrough[] = [];
  const seen = new Set<string>();
  const hitTop = new Set<string>();
  const firstEdition = comps[0];
  comps.forEach((c, i) => {
    for (const stat of c.chars) {
      const top = stat.reps[0]!;
      const base = { year: c.edition.year, title: c.edition.title, char: stat.char, player: top.player, rank: top.rank };
      // Characters present in the very first edition were already established;
      // only later arrivals count as a debut we can point to.
      if (!seen.has(stat.char)) {
        seen.add(stat.char);
        if (i > 0 && firstEdition && !firstEdition.byChar.has(stat.char)) out.push({ ...base, kind: "debut" });
      }
      for (const [threshold, kind] of [[25, "top25"], [10, "top10"]] as const) {
        const key = `${stat.char}:${kind}`;
        if (top.rank <= threshold && !hitTop.has(key)) {
          hitTop.add(key);
          // Where a character already stood in the first edition is the
          // baseline, not a breakthrough — record it, but don't report it.
          if (i > 0) out.push({ ...base, kind });
        }
      }
    }
  });
  return out.sort((a, b) => a.year - b.year || a.rank - b.rank);
}

/**
 * Per-character history across editions: when it arrived, who brought it,
 * its peak representation, and its best-ever ranked player. This is the
 * "aMSa puts Yoshi on the map" layer.
 */
export function charStorylines(comps: EditionComposition[]): CharStoryline[] {
  const out = new Map<string, CharStoryline>();
  const latest = comps[comps.length - 1];
  comps.forEach((c, i) => {
    for (const stat of c.chars) {
      const existing = out.get(stat.char);
      const top = stat.reps[0]!;
      if (!existing) {
        out.set(stat.char, {
          char: stat.char,
          arrival: { year: c.edition.year, title: c.edition.title, rep: top },
          newcomer: i > 0,
          peak: { year: c.edition.year, count: stat.count },
          bestEver: { year: c.edition.year, rep: top },
          current: 0,
          currentTop: null,
        });
      } else {
        if (stat.count > existing.peak.count) existing.peak = { year: c.edition.year, count: stat.count };
        if (top.rank < existing.bestEver.rep.rank) existing.bestEver = { year: c.edition.year, rep: top };
      }
    }
  });
  if (latest) {
    for (const stat of latest.chars) {
      const s = out.get(stat.char);
      if (s) {
        s.current = stat.count;
        s.currentTop = stat.reps[0]!;
      }
    }
  }
  return [...out.values()].sort((a, b) => b.peak.count - a.peak.count || a.arrival.year - b.arrival.year);
}
