import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, ReferenceLine,
} from "recharts";
import type { Filters, GameType, ResolvedGame, ResolvedTeamGame } from "../lib/types";
import { overview, rollingWinRate, byMyCharacter, gamesPerWeek, byMode, applyFilters } from "../lib/stats";
import { pct, num, int, duration, winRateColor } from "../lib/format";
import { charName } from "../lib/melee";
import { Kpi } from "./Kpi";
import { ShareCard } from "./ShareCard";
import { axisStyle, tooltipStyle } from "./chartStyle";

interface Props {
  games: ResolvedGame[]; // filtered
  allGames: ResolvedGame[]; // unfiltered (for prior-window delta)
  teamGames: ResolvedTeamGame[]; // filtered 2v2s — hours played spans both formats
  filters: Filters;
  onSelectMyCharacter: (id: number) => void;
  onSelectMode: (mode: GameType | null) => void;
}

export function Overview({ games, allGames, teamGames, filters, onSelectMyCharacter, onSelectMode }: Props) {
  const stats = useMemo(() => overview(games, allGames, filters), [games, allGames, filters]);
  const rolling = useMemo(() => rollingWinRate(games), [games]);
  const chars = useMemo(() => byMyCharacter(games), [games]);
  const weeks = useMemo(() => gamesPerWeek(games), [games]);
  // Mode breakdown ignores the mode filter itself so all sections stay visible.
  const modes = useMemo(
    () => byMode(applyFilters(allGames, { ...filters, gameType: null })),
    [allGames, filters],
  );

  const delta =
    stats.prevWinRate !== null && stats.winRate !== null ? (stats.winRate - stats.prevWinRate) * 100 : null;

  // Hours span both formats — the only KPI here that counts 2v2 time.
  const hours = useMemo(() => {
    let frames = 0;
    for (const g of games) frames += g.rec.durationFrames;
    for (const g of teamGames) frames += g.rec.durationFrames;
    return frames / 60 / 3600;
  }, [games, teamGames]);

  return (
    <>
      <div className="kpi-strip">
        <Kpi label="Games" value={int(stats.games)} />
        <Kpi
          label="Win rate"
          value={pct(stats.winRate)}
          delta={delta !== null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts vs prior` : undefined}
          deltaDir={delta === null ? undefined : delta >= 0 ? "up" : "down"}
        />
        <Kpi label="Record" value={`${stats.wins}–${stats.losses}`} />
        <Kpi label="Total kills" value={int(stats.totalKills)} />
        <Kpi label="Kills / game" value={num(stats.killsPerGame, 2)} />
        <Kpi label="Deaths / game" value={num(stats.deathsPerGame, 2)} />
        <Kpi label="Damage / game" value={int(stats.damagePerGame)} />
        <Kpi label="Avg length" value={duration(stats.avgGameSeconds)} />
        <Kpi
          label="Streak"
          value={stats.currentStreak ? `${stats.currentStreak.kind}${stats.currentStreak.length}` : "—"}
          accent={stats.currentStreak && stats.currentStreak.kind === "W" && stats.currentStreak.length >= 5 ? "gold" : undefined}
        />
        <Kpi label="Hours played" value={hours >= 10 ? int(hours) : num(hours, 1)} />
      </div>

      <ShareCard games={games} />

      <div className="panel">
        <h2>By mode</h2>
        <table>
          <thead>
            <tr>
              <th>Mode</th>
              <th className="data">Games</th>
              <th className="data">W–L</th>
              <th className="data">Win rate</th>
              <th className="data">Kills / game</th>
              <th className="data">Deaths / game</th>
              <th className="data">Avg length</th>
            </tr>
          </thead>
          <tbody>
            {modes.map((row) => {
              const active =
                (row.mode === "overall" && filters.gameType === null) || row.mode === filters.gameType;
              return (
                <tr
                  key={row.mode}
                  className="clickable"
                  style={active ? { background: "var(--panel-2)" } : undefined}
                  onClick={() => onSelectMode(row.mode === "overall" ? null : row.mode)}
                >
                  <td style={{ fontWeight: row.mode === "overall" ? 600 : 400, textTransform: "capitalize" }}>
                    {row.mode}
                  </td>
                  <td className="data">{row.games.toLocaleString()}</td>
                  <td className="data">
                    <span className="up">{row.wins}</span>–<span className="down">{row.losses}</span>
                  </td>
                  <td className="data" style={{ color: winRateColor(row.winRate) }}>{pct(row.winRate)}</td>
                  <td className="data">{num(row.killsPerGame, 2)}</td>
                  <td className="data">{num(row.deathsPerGame, 2)}</td>
                  <td className="data">{duration(row.avgGameSeconds)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="hint">Click a row to scope the whole dashboard to that mode; "overall" clears it.</div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Win rate — rolling 50 games</h2>
          {rolling.length < 2 ? (
            <div className="empty-note">Not enough decided games yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={rolling} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <XAxis dataKey="date" tick={axisStyle} tickLine={false} axisLine={{ stroke: "#34305a" }} minTickGap={48} />
                <YAxis domain={[0, 100]} tick={axisStyle} tickLine={false} axisLine={false} unit="%" />
                <ReferenceLine y={50} stroke="#4a4469" strokeDasharray="4 4" />
                <Tooltip {...tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, "win rate"]} />
                <Line type="monotone" dataKey="winRate" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel">
          <h2>Games per week</h2>
          {weeks.length === 0 ? (
            <div className="empty-note">No dated games.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeks} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <XAxis dataKey="week" tick={axisStyle} tickLine={false} axisLine={{ stroke: "#34305a" }} minTickGap={48} />
                <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="games" fill="var(--accent-dim)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>By my character</h2>
        <table>
          <thead>
            <tr>
              <th>Character</th>
              <th className="data">Games</th>
              <th className="data">W–L</th>
              <th className="data">Win rate</th>
              <th className="data">Kills / game</th>
              <th className="data">Deaths / game</th>
            </tr>
          </thead>
          <tbody>
            {chars.map((row) => (
              <tr key={row.characterId} className="clickable" onClick={() => onSelectMyCharacter(row.characterId)}>
                <td>{charName(row.characterId)}</td>
                <td className="data">{row.games.toLocaleString()}</td>
                <td className="data">
                  <span className="wl-pill">
                    <span className="up">{row.wins}</span>–<span className="down">{row.losses}</span>
                  </span>
                </td>
                <td className="data">{pct(row.winRate)}</td>
                <td className="data">{num(row.killsPerGame, 2)}</td>
                <td className="data">{num(row.deathsPerGame, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">Click a row to filter the whole dashboard to that character.</div>
      </div>
    </>
  );
}
