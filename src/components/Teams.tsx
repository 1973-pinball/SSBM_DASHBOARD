import { useMemo } from "react";
import type { ResolvedTeamGame } from "../lib/types";
import { teamOverview, byTeammate, teamsByMyCharacter, teamsByOppCharacter, teamsByStage } from "../lib/stats";
import { pct, num, int, duration, shortDate, winRateColor } from "../lib/format";
import { charName, stageName } from "../lib/melee";
import { Kpi } from "./Kpi";

interface Props {
  games: ResolvedTeamGame[]; // filtered
  onSelectTeammate: (code: string) => void;
}

/** Win rate is the team's, not yours — in 2v2 there is no individual result. */
export function Teams({ games, onSelectTeammate }: Props) {
  const stats = useMemo(() => teamOverview(games), [games]);
  const mates = useMemo(() => byTeammate(games), [games]);
  const myChars = useMemo(() => teamsByMyCharacter(games), [games]);
  const oppChars = useMemo(() => teamsByOppCharacter(games), [games]);
  const stages = useMemo(() => teamsByStage(games), [games]);

  if (games.length === 0) {
    return <div className="empty-note">No 2v2 games match the current filters.</div>;
  }

  return (
    <>
      <div className="kpi-strip">
        <Kpi label="2v2 games" value={int(stats.games)} />
        <Kpi label="Team win rate" value={pct(stats.winRate)} />
        <Kpi label="Record" value={`${stats.wins}–${stats.losses}`} />
        <Kpi label="Teammates" value={int(stats.distinctTeammates)} />
        <Kpi label="Stocks taken / game" value={num(stats.stocksTakenPerGame, 2)} />
        <Kpi label="Stocks lost / game" value={num(stats.stocksLostPerGame, 2)} />
        <Kpi label="Avg length" value={duration(stats.avgGameSeconds)} />
        <Kpi
          label="Streak"
          value={stats.currentStreak ? `${stats.currentStreak.kind}${stats.currentStreak.length}` : "—"}
          accent={stats.currentStreak && stats.currentStreak.kind === "W" && stats.currentStreak.length >= 5 ? "gold" : undefined}
        />
      </div>

      <div className="panel">
        <h2>By teammate</h2>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Plays</th>
              <th className="data">Games</th>
              <th className="data">W–L</th>
              <th className="data">Win rate</th>
              <th className="data">Stocks taken / game</th>
              <th className="data">Last played</th>
            </tr>
          </thead>
          <tbody>
            {mates.slice(0, 100).map((r) => (
              <tr key={r.code} className="clickable" onClick={() => onSelectTeammate(r.code)}>
                <td style={{ fontFamily: "var(--font-data)" }}>{r.code}</td>
                <td>{r.displayName ?? "—"}</td>
                <td>{charName(r.topCharacter)}</td>
                <td className="data">{r.games.toLocaleString()}</td>
                <td className="data">
                  <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
                </td>
                <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
                <td className="data">{num(r.stocksTakenPerGame, 2)}</td>
                <td className="data">{shortDate(r.lastPlayed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {mates.length === 0 ? (
          <div className="hint">No teammates with connect codes — offline doubles don't record them.</div>
        ) : (
          <div className="hint">
            Stocks taken is the duo's combined count — per-player kill attribution isn't available in 2v2 replays (Slippi's
            stat engine is singles-only). Click a row to filter to that teammate.
          </div>
        )}
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <h2>My character in 2v2</h2>
          <table>
            <thead>
              <tr>
                <th>Character</th>
                <th className="data">Games</th>
                <th className="data">W–L</th>
                <th className="data">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {myChars.map((r) => (
                <tr key={r.characterId}>
                  <td>{charName(r.characterId)}</td>
                  <td className="data">{r.games.toLocaleString()}</td>
                  <td className="data">
                    <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
                  </td>
                  <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Enemy team includes</h2>
          <table>
            <thead>
              <tr>
                <th>Character</th>
                <th className="data">Games</th>
                <th className="data">W–L</th>
                <th className="data">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {oppChars.map((r) => (
                <tr key={r.characterId}>
                  <td>{charName(r.characterId)}</td>
                  <td className="data">{r.games.toLocaleString()}</td>
                  <td className="data">
                    <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
                  </td>
                  <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">A game counts once per distinct enemy character, so rows sum above the game total.</div>
        </div>
      </div>

      <div className="panel">
        <h2>By stage</h2>
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th className="data">Games</th>
              <th className="data">W–L</th>
              <th className="data">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((r) => (
              <tr key={r.stageId}>
                <td>{stageName(r.stageId)}</td>
                <td className="data">{r.games.toLocaleString()}</td>
                <td className="data">
                  <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
                </td>
                <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
