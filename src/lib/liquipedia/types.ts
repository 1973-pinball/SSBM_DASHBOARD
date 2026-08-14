// Types for the bundled Liquipedia dataset (see data.ts). This is scene-wide
// esports history — completely separate from the user's own replay records.

export type MajorTier = "major" | "supermajor";

export interface Major {
  name: string;
  year: number;
  /** End date, "YYYY-MM-DD" (or "YYYY-MM" when Liquipedia lists no day). */
  date: string;
  /** Singles winner tag, normalized (see PLAYERS keys). */
  winner: string;
  runnerUp?: string;
  /** Liquipedia Premier/Tier-1 events are supermajors; everything else "major". */
  tier: MajorTier;
  /**
   * Netplay event (Liquipedia lists the venue as "Online"). Kept on the record
   * but excluded from every total on the tab — see OFFLINE_MAJORS.
   */
  online?: boolean;
  note?: string;
}

export interface RankingEntry {
  rank: number;
  player: string;
  /** Characters in listed order — first entry is the primary main. */
  chars: string[];
}

export interface RankingEdition {
  /** Season the edition covers (x-axis position). */
  year: number;
  /** e.g. "SSBMRank 2015", "MPGR 2019". */
  title: string;
  url: string;
  entries: RankingEntry[];
}

export interface PlayerMeta {
  /**
   * Liquipedia's "approx. total winnings" (USD); null = not listed. This spans
   * every Smash title the player competed in, not Melee alone — Liquipedia
   * publishes no per-game split, so label it as all-Smash wherever it shows.
   */
  earningsUsd: number | null;
  /** Main character(s), primary first. */
  mains: string[];
  country?: string;
}

export interface Source {
  label: string;
  url: string;
}
