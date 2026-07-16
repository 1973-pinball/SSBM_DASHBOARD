import type { Filters, GameType, ResolvedGame } from "../lib/types";
import { charName, stageName } from "../lib/melee";
import { useMemo } from "react";

interface Props {
  filters: Filters;
  setFilters: (f: Filters) => void;
  games: ResolvedGame[]; // unfiltered, for option lists
}

const GAME_TYPES: GameType[] = ["ranked", "unranked", "direct", "offline"];

export function FilterBar({ filters, setFilters, games }: Props) {
  const opts = useMemo(() => {
    const myChars = new Set<number>();
    const oppChars = new Set<number>();
    const stages = new Set<number>();
    const oppCodes = new Map<string, number>();
    for (const g of games) {
      myChars.add(g.me.characterId);
      oppChars.add(g.opp.characterId);
      stages.add(g.rec.stageId);
      if (g.opp.connectCode) oppCodes.set(g.opp.connectCode, (oppCodes.get(g.opp.connectCode) ?? 0) + 1);
    }
    const codes = Array.from(oppCodes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200)
      .map(([c]) => c);
    return {
      myChars: Array.from(myChars).sort((a, b) => a - b),
      oppChars: Array.from(oppChars).sort((a, b) => a - b),
      stages: Array.from(stages).sort((a, b) => a - b),
      codes,
    };
  }, [games]);

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  const isDefault =
    filters.range === "all" &&
    filters.myCharacter === null &&
    filters.oppCharacter === null &&
    filters.stageId === null &&
    filters.opponentCode === null &&
    filters.gameType === null;

  return (
    <div className="filters">
      <label>
        Range
        <select value={filters.range} onChange={(e) => set({ range: e.target.value as Filters["range"] })}>
          <option value="all">All time</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="1y">Last year</option>
        </select>
      </label>
      <label>
        Me
        <select value={filters.myCharacter ?? ""} onChange={(e) => set({ myCharacter: numOrNull(e.target.value) })}>
          <option value="">All characters</option>
          {opts.myChars.map((c) => (
            <option key={c} value={c}>
              {charName(c)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Vs
        <select value={filters.oppCharacter ?? ""} onChange={(e) => set({ oppCharacter: numOrNull(e.target.value) })}>
          <option value="">All characters</option>
          {opts.oppChars.map((c) => (
            <option key={c} value={c}>
              {charName(c)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Stage
        <select value={filters.stageId ?? ""} onChange={(e) => set({ stageId: numOrNull(e.target.value) })}>
          <option value="">All stages</option>
          {opts.stages.map((s) => (
            <option key={s} value={s}>
              {stageName(s)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Opponent
        <select value={filters.opponentCode ?? ""} onChange={(e) => set({ opponentCode: e.target.value || null })}>
          <option value="">Anyone</option>
          {opts.codes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Mode
        <select value={filters.gameType ?? ""} onChange={(e) => set({ gameType: (e.target.value || null) as GameType | null })}>
          <option value="">All modes</option>
          {GAME_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {!isDefault && (
        <button
          className="ghost"
          onClick={() =>
            setFilters({ range: "all", myCharacter: null, oppCharacter: null, stageId: null, opponentCode: null, gameType: null })
          }
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
