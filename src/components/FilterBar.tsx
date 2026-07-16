import type { Filters, GameType, ResolvedGame, ResolvedTeamGame } from "../lib/types";
import { charName, stageName } from "../lib/melee";
import { useMemo } from "react";
import { DEFAULT_FILTERS } from "../lib/types";

interface Props {
  filters: Filters;
  setFilters: (f: Filters) => void;
  games: ResolvedGame[]; // unfiltered, for option lists
  teamGames: ResolvedTeamGame[];
  hasTeamGames: boolean;
}

const GAME_TYPES: GameType[] = ["ranked", "unranked", "direct", "offline"];

export function FilterBar({ filters, setFilters, games, teamGames, hasTeamGames }: Props) {
  const isTeams = filters.format === "teams";

  // Option lists come from whichever format is active — offering "vs Fox" when no
  // 2v2 opponent played Fox would produce an empty dashboard with no explanation.
  const opts = useMemo(() => {
    const myChars = new Set<number>();
    const oppChars = new Set<number>();
    const stages = new Set<number>();
    const oppCodes = new Map<string, number>();
    const mateCodes = new Map<string, number>();
    const bump = (code: string | null) => {
      if (code) oppCodes.set(code, (oppCodes.get(code) ?? 0) + 1);
    };
    if (isTeams) {
      for (const g of teamGames) {
        myChars.add(g.me.characterId);
        stages.add(g.rec.stageId);
        if (g.teammate.connectCode) {
          mateCodes.set(g.teammate.connectCode, (mateCodes.get(g.teammate.connectCode) ?? 0) + 1);
        }
        for (const o of g.opps) {
          oppChars.add(o.characterId);
          bump(o.connectCode);
        }
      }
    } else {
      for (const g of games) {
        myChars.add(g.me.characterId);
        oppChars.add(g.opp.characterId);
        stages.add(g.rec.stageId);
        bump(g.opp.connectCode);
      }
    }
    const topCodes = (m: Map<string, number>) =>
      Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 200)
        .map(([c]) => c);
    return {
      myChars: Array.from(myChars).sort((a, b) => a - b),
      oppChars: Array.from(oppChars).sort((a, b) => a - b),
      stages: Array.from(stages).sort((a, b) => a - b),
      codes: topCodes(oppCodes),
      mateCodes: topCodes(mateCodes),
    };
  }, [games, teamGames, isTeams]);

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  const isDefault =
    filters.range === "all" &&
    filters.day === null &&
    filters.myCharacter === null &&
    filters.oppCharacter === null &&
    filters.stageId === null &&
    filters.opponentCode === null &&
    filters.teammateCode === null &&
    filters.gameType === null;

  return (
    <div className="filters">
      {hasTeamGames && (
        <label>
          Format
          {/* Separate axis from Mode: a 2v2 is also ranked/direct/offline. Switching
              format clears the other filters, whose option lists don't carry over. */}
          <select
            value={filters.format}
            onChange={(e) => setFilters({ ...DEFAULT_FILTERS, format: e.target.value as Filters["format"], range: filters.range })}
          >
            <option value="singles">Singles (1v1)</option>
            <option value="teams">Teams (2v2)</option>
          </select>
        </label>
      )}
      <label>
        Range
        {/* Disabled while a specific day is picked — the day wins (see applyFilters). */}
        <select
          value={filters.range}
          disabled={filters.day !== null}
          onChange={(e) => set({ range: e.target.value as Filters["range"] })}
        >
          <option value="all">All time</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="1y">Last year</option>
        </select>
      </label>
      <label>
        Day
        <input
          type="date"
          className="day-input"
          value={filters.day ?? ""}
          onChange={(e) => set({ day: e.target.value || null })}
        />
        {filters.day !== null && (
          <button className="ghost mini" onClick={() => set({ day: null })} aria-label="Clear day">
            ✕
          </button>
        )}
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
        {isTeams ? "Vs (either)" : "Vs"}
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
      {isTeams && (
        <label>
          Teammate
          <select value={filters.teammateCode ?? ""} onChange={(e) => set({ teammateCode: e.target.value || null })}>
            <option value="">Anyone</option>
            {opts.mateCodes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {isTeams ? "Opponent (either)" : "Opponent"}
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
        <button className="ghost" onClick={() => setFilters({ ...DEFAULT_FILTERS, format: filters.format })}>
          Clear filters
        </button>
      )}
    </div>
  );
}
