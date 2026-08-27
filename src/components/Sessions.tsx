import { useMemo, useState } from "react";
import type { ResolvedGame } from "../lib/types";
import { computeSessions, winRateBySessionPosition, tiltStats } from "../lib/stats";
import { pct, num, int, duration, shortDate, winRateColor } from "../lib/format";
import { Kpi } from "./Kpi";

/**
 * Sessions & tilt: a session is a run of games with no 30-minute gap. The
 * point of this view is the two conditional win-rate tables — position in
 * session (fatigue) and streak entering the game (tilt).
 */
export function Sessions({ games }: { games: ResolvedGame[] }) {
  const sessions = useMemo(() => computeSessions(games), [games]);
  const positions = useMemo(() => winRateBySessionPosition(sessions), [sessions]);
  const tilt = useMemo(() => tiltStats(sessions), [sessions]);
  // Collapsed by default: this is a 50-row table sitting between the tilt
  // tables and the win models now that Sessions renders inside Insights, and
  // scrolling past it every visit is worse than one click to open it.
  const [logOpen, setLogOpen] = useState(false);

  if (sessions.length === 0) return <div className="empty-note">No dated games match the current filters.</div>;

  const totalGames = sessions.reduce((s, x) => s + x.games.length, 0);
  const avgLen = sessions.reduce((s, x) => s + x.minutes, 0) / sessions.length;
  const longest = sessions.reduce((a, b) => (b.games.length > a.games.length ? b : a));
  const baseline = tilt.reduce(
    (acc, r) => ({ wins: acc.wins + r.wins, decided: acc.decided + r.decided }),
    { wins: 0, decided: 0 },
  );
  const baseRate = baseline.decided ? baseline.wins / baseline.decided : null;
  const recent = [...sessions].reverse().slice(0, 50);

  return (
    <>
      <div className="kpi-strip">
        <Kpi label="Sessions" value={int(sessions.length)} />
        <Kpi label="Games / session" value={num(totalGames / sessions.length, 1)} />
        <Kpi label="Avg session length" value={duration(avgLen * 60)} />
        <Kpi label="Longest session" value={`${longest.games.length} games`} />
        <Kpi label="Baseline win rate" value={pct(baseRate)} />
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <h2>Win rate by position in session</h2>
          <table>
            <thead>
              <tr>
                <th />
                <th className="data">Games</th>
                <th className="data">W–L</th>
                <th className="data">Win rate</th>
                <th className="data">vs baseline</th>
              </tr>
            </thead>
            <tbody>
              {positions
                .filter((r) => r.games > 0)
                .map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="data">{r.games.toLocaleString()}</td>
                    <td className="data">
                      <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
                    </td>
                    <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
                    <td className="data">{delta(r.winRate, baseRate)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="hint">If the bottom rows run red, your marathon sessions are donating rating.</div>
        </div>

        <div className="panel">
          <h2>Tilt check — win rate by streak entering the game</h2>
          <table>
            <thead>
              <tr>
                <th />
                <th className="data">Games</th>
                <th className="data">W–L</th>
                <th className="data">Win rate</th>
                <th className="data">vs baseline</th>
              </tr>
            </thead>
            <tbody>
              {tilt
                .filter((r) => r.games > 0)
                .map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="data">{r.games.toLocaleString()}</td>
                    <td className="data">
                      <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
                    </td>
                    <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
                    <td className="data">{delta(r.winRate, baseRate)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="hint">
            Streaks reset between sessions. "After 3+ losses" far below baseline is the statistical signature of tilt —
            that's your stop-playing signal.
          </div>
        </div>
      </div>

      <div className="panel">
        {/* Button inside the heading, not the other way round: <button> takes
            phrasing content, and this keeps the h2 in the document outline. */}
        <h2 className="panel-disclosure">
          <button aria-expanded={logOpen} aria-controls="session-log" onClick={() => setLogOpen((v) => !v)}>
            Session log
            <span className="panel-disclosure-meta">
              {sessions.length.toLocaleString()} session{sessions.length === 1 ? "" : "s"}
              <span aria-hidden="true">{logOpen ? "▲" : "▼"}</span>
            </span>
          </button>
        </h2>
        {logOpen && (
        <div id="session-log">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th className="data">Games</th>
              <th className="data">W–L</th>
              <th className="data">Win rate</th>
              <th className="data">Length</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((s) => (
              <tr key={s.start.getTime()}>
                <td className="data">
                  {shortDate(s.start)}{" "}
                  <span style={{ color: "var(--faint)" }}>
                    {s.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </td>
                <td className="data">{s.games.length}</td>
                <td className="data">
                  <span className="up">{s.wins}</span>–<span className="down">{s.losses}</span>
                </td>
                <td className="data" style={{ color: winRateColor(s.winRate) }}>{pct(s.winRate)}</td>
                <td className="data">{duration(s.minutes * 60)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sessions.length > 50 && <div className="hint">Latest 50 of {sessions.length.toLocaleString()} sessions.</div>}
        </div>
        )}
      </div>
    </>
  );
}

function delta(rate: number | null, base: number | null): string {
  if (rate === null || base === null) return "—";
  const d = (rate - base) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts`;
}
