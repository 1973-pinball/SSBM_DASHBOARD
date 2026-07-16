import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { Filters, ResolvedGame } from "../lib/types";
import { matchupMatrix, byStage, byOpponent, byOppCharacter, executionTrend } from "../lib/stats";
import { pct, int, shortDate, duration, winRateColor } from "../lib/format";
import { charName, stageName } from "../lib/melee";

const axisStyle = { fill: "var(--faint)", fontSize: 11, fontFamily: "var(--font-data)" };
const tooltipStyle = {
  contentStyle: { background: "#272245", border: "1px solid #34305a", borderRadius: 8, fontFamily: "var(--font-data)", fontSize: 12 },
  labelStyle: { color: "#9a93bd" },
};

// ---------------- Matchups ----------------

export function Matchups({ games, onSelect }: { games: ResolvedGame[]; onSelect: (my: number, opp: number) => void }) {
  const [minGames, setMinGames] = useState(10);
  const { myChars, oppChars, cells } = useMemo(() => matchupMatrix(games), [games]);
  const oppRows = useMemo(() => byOppCharacter(games), [games]);

  if (games.length === 0) return <div className="empty-note">No games match the current filters.</div>;

  return (
    <>
      <div className="panel">
        <h2>Matchup matrix — my character × opponent character</h2>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            Fade cells under{" "}
            <select value={minGames} onChange={(e) => setMinGames(Number(e.target.value))}>
              {[1, 5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>{" "}
            games
          </label>
        </div>
        <div className="matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th />
                {oppChars.map((c) => (
                  <th key={c}>{charName(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {myChars.map((mc) => (
                <tr key={mc}>
                  <th>{charName(mc)}</th>
                  {oppChars.map((oc) => {
                    const cell = cells.get(`${mc}:${oc}`);
                    if (!cell || cell.decided === 0) {
                      return (
                        <td key={oc} className="cell empty">
                          ·
                        </td>
                      );
                    }
                    const alpha = cell.games >= minGames ? 1 : 0.35;
                    return (
                      <td
                        key={oc}
                        className="cell"
                        style={{ background: winRateColor(cell.winRate, alpha) }}
                        onClick={() => onSelect(mc, oc)}
                        title={`${charName(mc)} vs ${charName(oc)}: ${cell.wins}–${cell.losses}`}
                      >
                        {pct(cell.winRate, 0)}
                        <span className="n">n={cell.games}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint">Click a cell to filter the dashboard to that matchup. Faded cells are below the sample threshold.</div>
      </div>

      <div className="panel">
        <h2>Vs opponent character</h2>
        <table>
          <thead>
            <tr>
              <th>Opponent plays</th>
              <th className="data">Games</th>
              <th className="data">W–L</th>
              <th className="data">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {oppRows.map((r) => (
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
    </>
  );
}

// ---------------- Stages ----------------

export function Stages({ games }: { games: ResolvedGame[] }) {
  const rows = useMemo(() => byStage(games), [games]);
  if (rows.length === 0) return <div className="empty-note">No games match the current filters.</div>;
  const max = Math.max(...rows.map((r) => r.games));
  return (
    <div className="panel">
      <h2>By stage</h2>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th className="data">Games</th>
            <th className="data">W–L</th>
            <th className="data">Win rate</th>
            <th style={{ width: "38%" }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.stageId}>
              <td>{stageName(r.stageId)}</td>
              <td className="data">{r.games.toLocaleString()}</td>
              <td className="data">
                <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
              </td>
              <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
              <td>
                <div style={{ background: "var(--bg-raised)", borderRadius: 4, height: 8 }}>
                  <div
                    style={{
                      width: `${((r.games / max) * 100).toFixed(1)}%`,
                      background: winRateColor(r.winRate, 0.9),
                      height: 8,
                      borderRadius: 4,
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Opponents ----------------

export function Opponents({ games, onSelect }: { games: ResolvedGame[]; onSelect: (code: string) => void }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => byOpponent(games), [games]);
  const filtered = rows.filter(
    (r) =>
      !query ||
      r.code.toLowerCase().includes(query.toLowerCase()) ||
      (r.displayName ?? "").toLowerCase().includes(query.toLowerCase()),
  );
  if (rows.length === 0) return <div className="empty-note">No opponents with connect codes in the current filter.</div>;
  return (
    <div className="panel">
      <h2>Opponents</h2>
      <div style={{ marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code or name…"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            color: "var(--text)",
            padding: "7px 10px",
            fontFamily: "var(--font-data)",
            fontSize: 12,
            width: 240,
          }}
        />
      </div>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Plays</th>
            <th className="data">Games</th>
            <th className="data">W–L</th>
            <th className="data">Win rate</th>
            <th className="data">Last played</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 100).map((r) => (
            <tr key={r.code} className="clickable" onClick={() => onSelect(r.code)}>
              <td style={{ fontFamily: "var(--font-data)" }}>{r.code}</td>
              <td>{r.displayName ?? "—"}</td>
              <td>{charName(r.topCharacter)}</td>
              <td className="data">{r.games.toLocaleString()}</td>
              <td className="data">
                <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
              </td>
              <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
              <td className="data">{shortDate(r.lastPlayed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 100 && <div className="hint">Showing top 100 of {filtered.length.toLocaleString()} — refine with search.</div>}
      <div className="hint">Click a row to filter the dashboard to that opponent.</div>
    </div>
  );
}

// ---------------- Execution ----------------

const EXEC_CHARTS = [
  { key: "lCancel", label: "L-cancel success", unit: "%", color: "var(--accent)" },
  { key: "opk", label: "Openings per kill (lower is better)", unit: "", color: "#e8b54d" },
  { key: "dpo", label: "Damage per opening", unit: "", color: "#3fcf8e" },
  { key: "ipm", label: "Inputs per minute", unit: "", color: "#6db3f2" },
] as const;

export function Execution({ games }: { games: ResolvedGame[] }) {
  const points = useMemo(() => executionTrend(games), [games]);
  if (points.length < 2) return <div className="empty-note">Not enough games for execution trends.</div>;
  return (
    <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
      {EXEC_CHARTS.map((c) => (
        <div className="panel" key={c.key}>
          <h2>{c.label}</h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={points} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <XAxis dataKey="date" tick={axisStyle} tickLine={false} axisLine={{ stroke: "#34305a" }} minTickGap={48} />
              <YAxis tick={axisStyle} tickLine={false} axisLine={false} domain={["auto", "auto"]} unit={c.unit} />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}${c.unit}`, c.label]} />
              <Line type="monotone" dataKey={c.key} stroke={c.color} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}

// ---------------- Game log ----------------

export function GameLog({ games }: { games: ResolvedGame[] }) {
  const recent = useMemo(() => [...games].reverse().slice(0, 300), [games]);

  const exportCsv = () => {
    const header = "date,my_character,opp_character,opponent_code,stage,mode,result,my_kills,opp_kills,duration_s\n";
    const body = [...games]
      .reverse()
      .map((g) =>
        [
          g.rec.playedAt ?? "",
          charName(g.me.characterId),
          charName(g.opp.characterId),
          g.opp.connectCode ?? "",
          stageName(g.rec.stageId),
          g.rec.gameType,
          g.isWin === null ? "n/a" : g.isWin ? "W" : "L",
          g.me.kills,
          g.opp.kills,
          Math.round(g.rec.durationFrames / 60),
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ssbm-games.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (games.length === 0) return <div className="empty-note">No games match the current filters.</div>;
  return (
    <div className="panel">
      <h2>
        Game log{" "}
        <button className="ghost" style={{ float: "right", marginTop: -6 }} onClick={exportCsv}>
          Export CSV ({games.length.toLocaleString()})
        </button>
      </h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Matchup</th>
            <th>Opponent</th>
            <th>Stage</th>
            <th>Mode</th>
            <th className="data">Result</th>
            <th className="data">Kills</th>
            <th className="data">Length</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((g) => (
            <tr key={g.rec.id}>
              <td className="data">{shortDate(g.date)}</td>
              <td>
                {charName(g.me.characterId)} <span style={{ color: "var(--faint)" }}>vs</span> {charName(g.opp.characterId)}
              </td>
              <td style={{ fontFamily: "var(--font-data)" }}>{g.opp.connectCode ?? "—"}</td>
              <td>{stageName(g.rec.stageId)}</td>
              <td>
                <span className="badge">{g.rec.gameType}</span>
              </td>
              <td className="data">
                {g.isWin === null ? (
                  <span className="badge" title="Indeterminate result (quit-out or very short game)">
                    n/a
                  </span>
                ) : g.isWin ? (
                  <span className="wl-pill up">W</span>
                ) : (
                  <span className="wl-pill down">L</span>
                )}
              </td>
              <td className="data">
                {int(g.me.kills)}–{int(g.opp.kills)}
              </td>
              <td className="data">{duration(g.rec.durationFrames / 60)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {games.length > 300 && <div className="hint">Showing latest 300 of {games.length.toLocaleString()} — export CSV for the full set.</div>}
    </div>
  );
}

// Re-export types used by App for convenience.
export type { Filters };
