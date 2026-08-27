import { Fragment, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import type { Account, ActionCounts, PlayerSide, ResolvedGame } from "../lib/types";
import { ACTION_LABELS, codeShort } from "../lib/types";
import { matchupMatrix, byStage, byOpponent, byOppCharacter, computeSets, setsSummary, executionTrend, executionSummary, rollingExecutionSeries, ROLLING_WINDOW, lCancelSeries, actionAverages, actionImpact, moveTable, moveImpact, neutralSummary, perGameSeries, stageCharMatrix } from "../lib/stats";
import type { ExecMetricKey } from "../lib/stats";
import { pct, num, int, shortDate, duration, winRateColor } from "../lib/format";
import { charName, stageName } from "../lib/melee";
import { Kpi } from "./Kpi";
import { axisStyle, tooltipStyle, gridStyle, dayTick, OPP_SERIES_COLOR } from "./chartStyle";
import { activateOnKey } from "../lib/a11y";

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
                        role="button"
                        tabIndex={0}
                        aria-label={`${charName(mc)} versus ${charName(oc)}, ${pct(cell.winRate, 0)} win rate across ${cell.games} games`}
                        style={{ background: winRateColor(cell.winRate, alpha) }}
                        onClick={() => onSelect(mc, oc)}
                        onKeyDown={(e) => activateOnKey(e, () => onSelect(mc, oc))}
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
        <MatrixLegend />
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
              {/* "My" is load-bearing: the row is keyed by the opponent's character,
                  so an unqualified "L-cancel" reads as theirs. This is mine. */}
              <th className="data">My L-cancel</th>
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
                <td
                  className="data"
                  style={r.lCancelAttempts < 100 ? { opacity: 0.55 } : undefined}
                  title={r.lCancelAttempts ? `${r.lCancelAttempts.toLocaleString()} attempts` : undefined}
                >
                  {pct(r.lCancelPct)}
                  {r.lCancelAttempts > 0 && <span className="sample-note">{r.lCancelAttempts.toLocaleString()} att.</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          My L-cancel is your own rate in games against that character — whether a matchup's pressure costs you tech
          skill — not the opponent's. Whole history in the current filter, no recency window. Hover for attempt counts;
          rows under 100 attempts are faded.
        </div>
      </div>
    </>
  );
}

/** Color-scale key for the win-rate matrices: loss red → neutral → win green. */
function MatrixLegend() {
  return (
    <div className="matrix-legend">
      <span>0%</span>
      <span className="ramp" aria-hidden="true" />
      <span>50%</span>
      <span className="ramp ramp-hi" aria-hidden="true" />
      <span>100% win rate</span>
      <span className="sep">·</span>
      <span>faded = small sample</span>
    </div>
  );
}

// ---------------- Stages ----------------

/** Stage × character win-rate grid shared by the two counterpick panels. */
function StageCharGrid({
  games,
  side,
  minGames,
  onSelect,
}: {
  games: ResolvedGame[];
  side: "opp" | "mine";
  minGames: number;
  onSelect: (stageId: number, charId: number, side: "opp" | "mine") => void;
}) {
  const { stages, chars, cells } = useMemo(() => stageCharMatrix(games, side), [games, side]);
  if (stages.length === 0) return <div className="empty-note">No games match the current filters.</div>;
  return (
    <div className="matrix-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th />
            {chars.map((c) => (
              <th key={c}>{charName(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s}>
              <th>{stageName(s)}</th>
              {chars.map((c) => {
                const cell = cells.get(`${s}:${c}`);
                if (!cell || cell.decided === 0) {
                  return (
                    <td key={c} className="cell empty">
                      ·
                    </td>
                  );
                }
                const alpha = cell.games >= minGames ? 1 : 0.35;
                return (
                  <td
                    key={c}
                    className="cell"
                    role="button"
                    tabIndex={0}
                    aria-label={`${stageName(s)}, ${side === "opp" ? "versus" : "as"} ${charName(c)}, ${pct(cell.winRate, 0)} win rate across ${cell.games} games`}
                    style={{ background: winRateColor(cell.winRate, alpha) }}
                    onClick={() => onSelect(s, c, side)}
                    onKeyDown={(e) => activateOnKey(e, () => onSelect(s, c, side))}
                    title={`${stageName(s)} ${side === "opp" ? "vs" : "as"} ${charName(c)}: ${cell.wins}–${cell.losses}`}
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
      <MatrixLegend />
    </div>
  );
}

export function Stages({
  games,
  onSelect,
}: {
  games: ResolvedGame[];
  onSelect: (stageId: number, charId: number, side: "opp" | "mine") => void;
}) {
  const [minGames, setMinGames] = useState(10);
  const rows = useMemo(() => byStage(games), [games]);
  if (rows.length === 0) return <div className="empty-note">No games match the current filters.</div>;
  const max = Math.max(...rows.map((r) => r.games));
  return (
    <>
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

    <div className="panel">
      <h2>Counterpick helper — stage × opponent character</h2>
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
      <StageCharGrid games={games} side="opp" minGames={minGames} onSelect={onSelect} />
      <div className="hint">
        Where you actually win each matchup — green columns are safe picks against that character, red ones are bans.
        Click a cell to scope the dashboard to that stage + opponent character.
      </div>
    </div>

    <div className="panel">
      <h2>My character × stage</h2>
      <StageCharGrid games={games} side="mine" minGames={minGames} onSelect={onSelect} />
      <div className="hint">Same grid keyed on your own character — where each of your characters over- or under-performs.</div>
    </div>
    </>
  );
}

// ---------------- Opponents ----------------

/**
 * Set-level framing: players think in sets, not games — "I went 3–1 in the
 * runback". Sets are always best of three (see computeSets); an unfinished
 * trailing set is not counted.
 */
function SetsPanel({ games, onSelect }: { games: ResolvedGame[]; onSelect: (code: string) => void }) {
  const sets = useMemo(() => computeSets(games), [games]);
  const s = useMemo(() => setsSummary(sets), [sets]);
  if (s.sets === 0) return null;
  const recent = [...sets].reverse().slice(0, 15);
  return (
    <>
      <div className="kpi-strip">
        <Kpi label="Sets" value={int(s.sets)} />
        <Kpi label="Set record" value={`${s.wins}–${s.losses}`} />
        <Kpi label="Set win rate" value={pct(s.setWinRate)} />
        <Kpi label="Games / set" value={num(s.avgGames, 1)} />
        <Kpi
          label="After dropping game 1"
          value={s.afterG1Loss.total ? pct(s.afterG1Loss.wins / s.afterG1Loss.total, 0) : "—"}
          delta={s.afterG1Loss.total ? `${s.afterG1Loss.wins} of ${s.afterG1Loss.total} sets won` : undefined}
        />
        <Kpi
          label="Sets that went to game 3"
          value={s.deciders.total ? pct(s.deciders.wins / s.deciders.total, 0) : "—"}
          delta={s.deciders.total ? `${s.deciders.wins} of ${s.deciders.total} won` : undefined}
        />
      </div>
      <div className="panel">
        <h2>Recent sets</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th className="data">Score</th>
              <th className="data">Result</th>
              <th className="data">Games</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((set, i) => (
              <tr key={`${set.oppCode}-${set.start?.getTime() ?? i}`} className="clickable" role="button" tabIndex={0} aria-label={`Filter to opponent ${set.oppCode}`} onClick={() => onSelect(set.oppCode)} onKeyDown={(e) => activateOnKey(e, () => onSelect(set.oppCode))}>
                <td className="data">{shortDate(set.start)}</td>
                <td style={{ fontFamily: "var(--font-data)" }}>
                  {set.oppCode}
                  {set.oppName && <span style={{ color: "var(--faint)" }}> · {set.oppName}</span>}
                </td>
                <td className="data">
                  <span className="up">{set.wins}</span>–<span className="down">{set.losses}</span>
                </td>
                <td className="data">
                  <span className={`wl-pill ${set.result === "W" ? "up" : "down"}`}>{set.result}</span>
                </td>
                <td className="data">{set.games.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          A set is a run of consecutive games against the same opponent (20-minute gap starts a new one); the result is
          the majority of decided games, since ranked sets and long friendly runbacks both live here. Click a row to
          filter to that opponent.
        </div>
      </div>
    </>
  );
}

export function Opponents({ games, onSelect }: { games: ResolvedGame[]; onSelect: (code: string) => void }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => byOpponent(games), [games]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return rows.filter(
      (r) => !q || r.code.toLowerCase().includes(q) || (r.displayName ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);
  if (rows.length === 0) return <div className="empty-note">No opponents with connect codes in the current filter.</div>;
  return (
    <>
    <SetsPanel games={games} onSelect={onSelect} />
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
            <tr key={r.code} className="clickable" role="button" tabIndex={0} aria-label={`Filter to opponent ${r.code}`} onClick={() => onSelect(r.code)} onKeyDown={(e) => activateOnKey(e, () => onSelect(r.code))}>
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
    </>
  );
}

// ---------------- Execution ----------------

const EXEC_CHARTS: {
  key: string;
  label: string;
  unit: string;
  color: string;
  compare?: { key: string; label: string; color: string };
}[] = [
  { key: "lCancel", label: "L-cancel success", unit: "%", color: "var(--accent)", compare: { key: "oppLCancel", label: "Opponents", color: OPP_SERIES_COLOR } },
  { key: "opk", label: "Openings per kill (lower is better)", unit: "", color: "#e8b54d", compare: { key: "oppOpk", label: "Opponents", color: OPP_SERIES_COLOR } },
  { key: "dpo", label: "Damage per opening", unit: "", color: "#3fcf8e", compare: { key: "oppDpo", label: "Opponents", color: OPP_SERIES_COLOR } },
  { key: "ipm", label: "Inputs per minute", unit: "", color: "#6db3f2", compare: { key: "oppIpm", label: "Opponents", color: OPP_SERIES_COLOR } },
];

const ROLLING_METRICS: { key: ExecMetricKey; label: string; unit: string; color: string }[] = [
  { key: "lCancel", label: "L-cancel success", unit: "%", color: "var(--accent)" },
  { key: "opk", label: "Openings per kill", unit: "", color: "#e8b54d" },
  { key: "dpo", label: "Damage per opening", unit: "", color: "#3fcf8e" },
  { key: "ipm", label: "Inputs per minute", unit: "", color: "#6db3f2" },
];

/** Rolling 50-game average of a single execution metric, chosen via chips. */
function RollingExecChart({ games }: { games: ResolvedGame[] }) {
  const [metric, setMetric] = useState<ExecMetricKey>("lCancel");
  const def = ROLLING_METRICS.find((m) => m.key === metric)!;
  const data = useMemo(() => rollingExecutionSeries(games, metric), [games, metric]);
  return (
    <div className="panel">
      <h2>Rolling 50-game average</h2>
      <div className="chip-row">
        {ROLLING_METRICS.map((m) => {
          const on = m.key === metric;
          return (
            <button
              key={m.key}
              className={`chip ${on ? "on" : ""}`}
              aria-pressed={on}
              style={on ? { borderColor: m.color } : undefined}
              onClick={() => setMetric(m.key)}
            >
              <span className="dot" style={{ background: m.color, opacity: on ? 1 : 0.35 }} />
              {m.label}
            </button>
          );
        })}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
          <CartesianGrid {...gridStyle} />
          {/* Unique game index as the axis key, dates as labels — see L-cancel chart. */}
          <XAxis
            dataKey="index"
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
            minTickGap={48}
            tickFormatter={(v: number) => dayTick(data[v - data[0]!.index]?.date)} // ticks only exist when data is non-empty
          />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} domain={["auto", "auto"]} unit={def.unit} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(v, payload) => {
              const d = payload?.[0]?.payload?.date;
              return d ? `Game ${v} — ${dayTick(d)}` : `Game ${v}`;
            }}
            formatter={(v) => [`${Number(v).toFixed(1)}${def.unit}`, def.label]}
          />
          <Line type="monotone" dataKey="value" name={def.label} stroke={def.color} strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <div className="hint">
        Each point averages the previous 50 games{games.length > 500 ? ` (latest 500 of ${games.length.toLocaleString()} games shown)` : ""}.
      </div>
    </div>
  );
}

interface SeriesDef {
  key: string;
  label: string;
  color: string;
  value: (g: ResolvedGame) => number;
  /** Opponent counterpart; when present the chart offers a "vs opponents" toggle that overlays dashed lines. */
  oppValue?: (g: ResolvedGame) => number;
}

const NEUTRAL_SERIES: SeriesDef[] = [
  { key: "neutralWins", label: "Neutral wins", color: "var(--accent)", value: (g) => g.me.neutralWins },
  { key: "counterHits", label: "Counter hits", color: "#e8b54d", value: (g) => g.me.counterHits },
  { key: "beneficialTrades", label: "Beneficial trades", color: "#3fcf8e", value: (g) => g.me.beneficialTrades },
];

// No reds here: red stays reserved for loss/danger, not series identity.
const ACTION_COLORS: Record<keyof ActionCounts, string> = {
  rolls: "#4fc9c4",
  airDodges: "#e8b54d",
  spotDodges: "#e87fd0",
  wavedashes: "#8f7ff7",
  wavelands: "#6db3f2",
  dashDances: "#3fcf8e",
  ledgeGrabs: "#9adb4f",
  grabs: "#f2985e",
};

const ACTION_SERIES: SeriesDef[] = ACTION_LABELS.map(({ key, label }) => ({
  key,
  label,
  color: ACTION_COLORS[key],
  value: (g) => g.me.actions?.[key] ?? 0,
  oppValue: (g) => g.opp.actions?.[key] ?? 0,
}));

/** Per-game line chart with chip toggles choosing which metrics are plotted. */
function PerGameMetricChart({
  title,
  games,
  series,
  defaults,
}: {
  title: string;
  games: ResolvedGame[];
  series: SeriesDef[];
  defaults: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaults));
  // Opponent overlay defaults on — the chip is there to turn it OFF when it clutters.
  const [showOpp, setShowOpp] = useState(true);
  const hasOpp = series.some((s) => s.oppValue);
  // All metrics (including opponent counterparts) are computed once; the chips only toggle which lines render.
  const data = useMemo(
    () =>
      perGameSeries(games, [
        ...series,
        ...series.filter((s) => s.oppValue).map((s) => ({ key: `opp:${s.key}`, value: s.oppValue! })),
      ]),
    [games, series],
  );

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="chip-row">
        {series.map((s) => {
          const on = selected.has(s.key);
          return (
            <button
              key={s.key}
              className={`chip ${on ? "on" : ""}`}
              aria-pressed={on}
              style={on ? { borderColor: s.color } : undefined}
              onClick={() => toggle(s.key)}
            >
              <span className="dot" style={{ background: s.color, opacity: on ? 1 : 0.35 }} />
              {s.label}
            </button>
          );
        })}
        {hasOpp && (
          <button
            className={`chip ${showOpp ? "on" : ""}`}
            aria-pressed={showOpp}
            style={showOpp ? { borderColor: OPP_SERIES_COLOR } : undefined}
            onClick={() => setShowOpp((v) => !v)}
          >
            <span className="dot" style={{ background: OPP_SERIES_COLOR, opacity: showOpp ? 1 : 0.35 }} />
            vs opponents
          </button>
        )}
      </div>
      {selected.size === 0 ? (
        <div className="empty-note">Pick at least one metric above.</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid {...gridStyle} />
            {/* Unique game index as the axis key, dates as labels — see L-cancel chart. */}
            <XAxis
              dataKey="index"
              tick={axisStyle}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              minTickGap={48}
              tickFormatter={(v: number) => dayTick((data[v - data[0]!.index] as { date?: string })?.date)} // ticks only exist when data is non-empty
            />
            {/* Decimals allowed: these are rolling averages of counts, not counts. */}
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
            <Tooltip
              {...tooltipStyle}
              labelFormatter={(v, payload) => {
                const d = payload?.[0]?.payload?.date;
                return d ? `Game ${v} — ${dayTick(d)}` : `Game ${v}`;
              }}
              formatter={(v, name) => [num(Number(v), 1), name]}
            />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-data)" }} />
            {series
              .filter((s) => selected.has(s.key))
              .map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
              ))}
            {showOpp &&
              series
                .filter((s) => selected.has(s.key) && s.oppValue)
                .map((s) => (
                  <Line
                    key={`opp:${s.key}`}
                    type="monotone"
                    dataKey={`opp:${s.key}`}
                    name={`${s.label} — opponents`}
                    stroke={OPP_SERIES_COLOR}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    strokeOpacity={0.9}
                    dot={false}
                  />
                ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      <div className="hint">
        Each point averages the previous {ROLLING_WINDOW} games
        {games.length > 500 ? ` (latest 500 of ${games.length.toLocaleString()} games shown)` : ""}.
      </div>
    </div>
  );
}

export function Execution({ games }: { games: ResolvedGame[] }) {
  const points = useMemo(() => executionTrend(games), [games]);
  const summary = useMemo(() => executionSummary(games), [games]);
  const lcVolume = useMemo(() => lCancelSeries(games), [games]);
  const actions = useMemo(() => actionAverages(games), [games]);
  const neutral = useMemo(() => neutralSummary(games), [games]);
  if (points.length < 2) return <div className="empty-note">Not enough games for execution trends.</div>;
  return (
    <>
      <div className="kpi-strip">
        <Kpi label={`L-cancel — last ${summary.games}`} value={summary.lCancel !== null ? `${num(summary.lCancel, 1)}%` : "—"} />
        <Kpi label={`Openings / kill — last ${summary.games}`} value={num(summary.opk, 2)} />
        <Kpi label={`Damage / opening — last ${summary.games}`} value={num(summary.dpo, 1)} />
        <Kpi label={`Inputs / min — last ${summary.games}`} value={int(summary.ipm)} />
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {EXEC_CHARTS.map((c) => (
          <div className="panel" key={c.key}>
            <h2>{c.label}</h2>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={points} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid {...gridStyle} />
                <XAxis
                  dataKey="date"
                  tick={axisStyle}
                  tickLine={false}
                  axisLine={{ stroke: "var(--line)" }}
                  minTickGap={48}
                  tickFormatter={dayTick}
                />
                <YAxis tick={axisStyle} tickLine={false} axisLine={false} domain={["auto", "auto"]} unit={c.unit} />
                <Tooltip
                  {...tooltipStyle}
                  labelFormatter={(v) => dayTick(String(v))}
                  formatter={(v, name) => [`${Number(v).toFixed(1)}${c.unit}`, name]}
                />
                {c.compare && <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-data)" }} />}
                <Line type="monotone" dataKey={c.key} name={c.compare ? "Me" : c.label} stroke={c.color} strokeWidth={2} dot={false} connectNulls />
                {c.compare && (
                  <Line
                    type="monotone"
                    dataKey={c.compare.key}
                    name={c.compare.label}
                    stroke={c.compare.color}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      <RollingExecChart games={games} />

      <div className="panel">
        <h2>L-cancel volume — per game, {ROLLING_WINDOW}-game rolling average</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={lcVolume} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid {...gridStyle} />
            {/* The axis must key on the unique game index — keying on `date` makes
                recharts treat same-day games as one category, so every hover
                resolves to the first game of that day. Ticks still render dates. */}
            <XAxis
              dataKey="index"
              tick={axisStyle}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              minTickGap={48}
              tickFormatter={(v: number) => dayTick(lcVolume[v - lcVolume[0]!.index]?.date)} // ticks only exist when data is non-empty
            />
            {/* Decimals allowed: these are rolling averages of counts, not counts. */}
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
            <Tooltip
              {...tooltipStyle}
              labelFormatter={(v, payload) => {
                const d = payload?.[0]?.payload?.date;
                return d ? `Game ${v} — ${dayTick(d)}` : `Game ${v}`;
              }}
              formatter={(v, name) => [num(Number(v), 1), name]}
            />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-data)" }} />
            <Line type="monotone" dataKey="attempts" name="Attempts" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="success" name="Successful" stroke="#3fcf8e" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="hint">
          Each point averages the previous {ROLLING_WINDOW} games
          {games.length > 500 ? ` (latest 500 of ${games.length.toLocaleString()} games shown)` : ""}. The gap between the
          lines is your missed L-cancels; the attempts line alone tracks how aerial-heavy your play is.
        </div>
      </div>

      <PerGameMetricChart
        title={`Neutral exchanges — per game, ${ROLLING_WINDOW}-game rolling average`}
        games={games}
        series={NEUTRAL_SERIES}
        defaults={["beneficialTrades"]}
      />

      <PerGameMetricChart
        title={`Actions — per game, ${ROLLING_WINDOW}-game rolling average`}
        games={games}
        series={ACTION_SERIES}
        defaults={["wavedashes"]}
      />

      <div className="panel">
        <h2>Neutral summary</h2>
        <table>
          <thead>
            <tr>
              <th />
              <th className="data">Me</th>
              <th className="data">Opponents</th>
              <th className="data">Per game</th>
              <th className="data">My share</th>
            </tr>
          </thead>
          <tbody>
            {neutral.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="data">{r.mine.toLocaleString()}</td>
                <td className="data">{r.theirs.toLocaleString()}</td>
                <td className="data">{num(r.perGame, 1)}</td>
                <td className="data" style={{ color: winRateColor(r.share) }}>{pct(r.share, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          Share is your count ÷ the game total — over 50% means you're winning that kind of exchange more often than your
          opponents across the filtered games.
        </div>
      </div>

      <div className="panel">
        <h2>Actions per game</h2>
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th className="data">Per game</th>
              <th className="data">Per minute</th>
              <th className="data">Opp per game</th>
              <th className="data">Opp per minute</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.key}>
                <td>{a.label}</td>
                <td className="data">{num(a.perGame, 1)}</td>
                <td className="data">{num(a.perMinute, 1)}</td>
                <td className="data">{num(a.oppPerGame, 1)}</td>
                <td className="data">{num(a.oppPerMinute, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          Averages over the filtered games — your counts and your opponents'. Per-minute normalizes for game length —
          better for comparing across filters.
        </div>
      </div>

      <MovesSection games={games} />
    </>
  );
}

/** Per-move damage, kills, openings, and the volume-vs-wins impact analysis. */
function MovesSection({ games }: { games: ResolvedGame[] }) {
  // Effectiveness reads the recent window (current habits); openings and the
  // impact analysis keep the full filter, which they need for sample size.
  const recent = useMemo(() => moveTable(games.slice(-100)), [games]);
  const { rows, covered } = useMemo(() => moveTable(games), [games]);
  // Moves and actions ride the same heavy-vs-light analysis, one sorted table.
  const impact = useMemo(
    () => [...moveImpact(games), ...actionImpact(games)].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)),
    [games],
  );
  if (rows.length === 0) {
    return (
      <div className="panel">
        <h2>Moves</h2>
        <div className="empty-note">
          No per-move data in these games yet — it's computed at parse time, so hit <b>Refresh</b> (or re-pick your
          folder) to re-parse the library once.
        </div>
      </div>
    );
  }
  const deltaColor = (d: number | null) => (d === null ? undefined : { color: d >= 0 ? "#3fcf8e" : "#f0564f" });
  return (
    <>
      <div className="panel">
        <h2>Move effectiveness (past {Math.min(100, recent.covered).toLocaleString()} games)</h2>
        <table>
          <thead>
            <tr>
              <th>Move</th>
              <th className="data">Attempted / game</th>
              <th className="data">Landed / game</th>
              <th className="data">Dmg / game</th>
              <th className="data">Dmg share</th>
              <th className="data">Avg dmg / hit</th>
              <th className="data">Kills</th>
              <th className="data">Kill share</th>
              <th className="data">Avg kill %</th>
              <th className="data">L-cancel</th>
            </tr>
          </thead>
          <tbody>
            {recent.rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="data">{r.attemptsPerGame !== null ? num(r.attemptsPerGame, 1) : "—"}</td>
                <td className="data">{num(r.landedPerGame, 1)}</td>
                <td className="data">{num(r.dmgPerGame, 1)}</td>
                <td className="data">{pct(r.dmgShare, 0)}</td>
                <td className="data">{num(r.avgDmgPerHit, 1)}</td>
                <td className="data">{r.kills.toLocaleString()}</td>
                <td className="data">{pct(r.killShare, 0)}</td>
                <td className="data">{r.avgKillPct !== null ? `${num(r.avgKillPct, 0)}%` : "—"}</td>
                <td className="data" title={r.lCancelAttempts ? `${r.lCancelAttempts.toLocaleString()} attempts` : undefined}>
                  {pct(r.lCancelPct)}
                  {r.lCancelAttempts > 0 && <span className="sample-note">{r.lCancelAttempts.toLocaleString()} att.</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          Your most recent {Math.min(100, recent.covered).toLocaleString()} games in this filter — current habits, not
          career averages. Attempted counts every initiation (whiffs included) and is tracked for normals and aerials
          only — specials and throws show "—", not zero. The gap between attempted and landed is your whiff rate.
          L-cancel likewise counts every landing of that aerial (hover for attempts; it can differ a hair from the
          headline rate, which corrects for edge-cancels). Avg kill % is the opponent's percent when the move closed a
          stock — a high number on a kill move means you're fishing with it stale.
        </div>
      </div>

      <div className="panel">
        <h2>Openings — which move starts your offense</h2>
        <table>
          <thead>
            <tr>
              <th>Move</th>
              <th className="data">Openings / game</th>
              <th className="data">Share of openings</th>
              <th className="data">Damage per opening</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.openings > 0)
              .sort((a, b) => b.openings - a.openings)
              .map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="data">{num(covered ? r.openings / covered : 0, 1)}</td>
                  <td className="data">{pct(r.openingShare, 0)}</td>
                  <td className="data">{num(r.dmgPerOpening, 1)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="hint">
          The first move of each conversion. High damage-per-opening moves are the neutral wins worth hunting; pair
          with openings/kill above to see whether you're converting them.
        </div>
      </div>

      {impact.length > 0 && (
        <div className="panel">
          <h2>Move impact — volume vs wins</h2>
          <table>
            <thead>
              <tr>
                <th>Move / action</th>
                <th className="data">Usage</th>
                <th className="data">WR when heavy</th>
                <th className="data">WR when light</th>
                <th className="data">Heavy − light</th>
              </tr>
            </thead>
            <tbody>
              {impact.map((r) => (
                <tr key={r.key} style={r.avgShare < 0.02 && r.usageKind !== "perMinute" ? { opacity: 0.55 } : undefined}>
                  <td>
                    {r.label}
                    {r.usageKind === "perMinute" && <span className="tag" style={{ marginLeft: 6 }}>action</span>}
                  </td>
                  <td className="data">{r.usageKind === "perMinute" ? `${num(r.avgShare, 1)}/min` : pct(r.avgShare, 1)}</td>
                  <td className="data">{pct(r.winRateHigh)}</td>
                  <td className="data">{pct(r.winRateLow)}</td>
                  <td className="data" style={deltaColor(r.delta)}>
                    {r.delta !== null ? `${r.delta >= 0 ? "+" : ""}${num(r.delta * 100, 1)} pp` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">
            Move usage is that move's share of your landed hits that game (so "winners land more of everything" doesn't
            skew it); action usage is the count per minute of game time. Games are median-split into heavy vs light
            usage and the win rates compared. Red rows near the top are habits that swell in games you lose — a
            practice lead, not proof. Faded rows are moves under 2% of your offense: their deltas run noisy, trust them
            less.
          </div>
        </div>
      )}
    </>
  );
}

// ---------------- Game log ----------------

/** Count plus this player's share of the game total, e.g. "13 (57%)". */
const withShare = (mine: number, theirs: number) =>
  mine + theirs > 0 ? `${mine} (${pct(mine / (mine + theirs), 0)})` : "0";

const DETAIL_STATS: { label: string; value: (p: PlayerSide, other: PlayerSide) => string }[] = [
  { label: "Kills", value: (p) => int(p.kills) },
  { label: "Stocks left", value: (p) => (p.stocksRemaining === null ? "—" : int(p.stocksRemaining)) },
  { label: "Damage done", value: (p) => int(p.totalDamage) },
  { label: "Damage / opening", value: (p) => num(p.damagePerOpening, 1) },
  { label: "Openings / kill", value: (p) => num(p.openingsPerKill, 1) },
  { label: "Neutral wins", value: (p, o) => withShare(p.neutralWins, o.neutralWins) },
  { label: "Counter hits", value: (p, o) => withShare(p.counterHits, o.counterHits) },
  { label: "Beneficial trades", value: (p, o) => withShare(p.beneficialTrades, o.beneficialTrades) },
  {
    label: "L-cancels",
    value: (p) => {
      const attempts = p.lCancelSuccess + p.lCancelFail;
      return attempts === 0 ? "—" : `${p.lCancelSuccess}/${attempts} (${pct(p.lCancelSuccess / attempts, 0)})`;
    },
  },
  { label: "Inputs / minute", value: (p) => int(p.inputsPerMinute) },
  {
    label: "Grabs (landed)",
    value: (p) => {
      const attempts = p.actions?.grabs ?? 0;
      return attempts === 0 ? "—" : `${p.grabSuccess}/${attempts} (${pct(p.grabSuccess / attempts, 0)})`;
    },
  },
  ...ACTION_LABELS.filter(({ key }) => key !== "grabs").map(({ key, label }) => ({
    label,
    value: (p: PlayerSide) => int(p.actions?.[key] ?? null),
  })),
];

function GameDetailTable({ g }: { g: ResolvedGame }) {
  return (
    <div className="detail-grid">
      <table>
        <thead>
          <tr>
            <th />
            <th className="data">Me — {charName(g.me.characterId)} (P{g.me.port})</th>
            <th className="data">{g.opp.displayName ?? g.opp.connectCode ?? "Opponent"} — {charName(g.opp.characterId)} (P{g.opp.port})</th>
          </tr>
        </thead>
        <tbody>
          {DETAIL_STATS.map((s) => (
            <tr key={s.label}>
              <td>{s.label}</td>
              <td className="data">{s.value(g.me, g.opp)}</td>
              <td className="data">{s.value(g.opp, g.me)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GameDetail({ g, colSpan }: { g: ResolvedGame; colSpan: number }) {
  return (
    <tr className="detail-row">
      <td colSpan={colSpan}>
        <GameDetailTable g={g} />
      </td>
    </tr>
  );
}

export function GameLog({ games, accounts }: { games: ResolvedGame[]; accounts: Account[] }) {
  const recent = useMemo(() => [...games].reverse().slice(0, 300), [games]);
  const [openId, setOpenId] = useState<string | null>(null);
  // One account needs no column — every row would say the same thing.
  const showAccount = accounts.length > 1;

  // Connect codes and dates come from the .slp file, i.e. from strangers online:
  // quote every field and defuse leading =+-@ so a crafted tag can't inject a
  // spreadsheet formula or break rows.
  const csvField = (v: string | number): string => {
    const s = String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const exportCsv = () => {
    const header =
      "date,my_code,my_account,my_character,opp_character,opponent_code,stage,mode,result,my_kills,opp_kills,duration_s\n";
    const body = [...games]
      .reverse()
      .map((g) =>
        [
          g.rec.playedAt ?? "",
          g.me.connectCode ?? "",
          g.me.connectCode ? codeShort(accounts, g.me.connectCode) : "",
          charName(g.me.characterId),
          charName(g.opp.characterId),
          g.opp.connectCode ?? "",
          stageName(g.rec.stageId),
          g.rec.gameType,
          g.isWin === null ? "n/a" : g.isWin ? "W" : "L",
          g.me.kills,
          g.opp.kills,
          Math.round(g.rec.durationFrames / 60),
        ]
          .map(csvField)
          .join(","),
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
      <h2 className="game-log-head">
        <span>Game log</span>
        <button className="ghost" style={{ float: "right", marginTop: -6 }} onClick={exportCsv}>
          Export CSV ({games.length.toLocaleString()})
        </button>
      </h2>
      <table className="game-log-table">
        <thead>
          <tr>
            <th>Date</th>
            {showAccount && <th>Account</th>}
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
            <Fragment key={g.rec.id}>
              <tr
                className="clickable"
                role="button"
                tabIndex={0}
                aria-expanded={openId === g.rec.id}
                aria-label={`${shortDate(g.date)}, ${charName(g.me.characterId)} versus ${charName(g.opp.characterId)}, ${g.isWin === null ? "no result" : g.isWin ? "win" : "loss"}`}
                onClick={() => setOpenId(openId === g.rec.id ? null : g.rec.id)}
                onKeyDown={(e) => activateOnKey(e, () => setOpenId(openId === g.rec.id ? null : g.rec.id))}
              >
                <td className="data">{shortDate(g.date)}</td>
                {showAccount && (
                  <td title={g.me.connectCode ?? undefined}>
                    {g.me.connectCode ? codeShort(accounts, g.me.connectCode) : "—"}
                  </td>
                )}
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
                    <span
                      className="badge"
                      title={
                        g.selfMatch
                          ? "Both sides are your own accounts — no result to credit either way"
                          : "Indeterminate result (quit-out or very short game)"
                      }
                    >
                      {g.selfMatch ? "self" : "n/a"}
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
              {openId === g.rec.id && <GameDetail g={g} colSpan={showAccount ? 9 : 8} />}
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="game-log-cards">
        {recent.map((g) => {
          const open = openId === g.rec.id;
          return (
            <article className="game-card" key={g.rec.id}>
              <button className="game-card-toggle" aria-expanded={open} onClick={() => setOpenId(open ? null : g.rec.id)}>
                <span className="game-card-head">
                  <span>{shortDate(g.date)}{showAccount && g.me.connectCode ? ` · ${codeShort(accounts, g.me.connectCode)}` : ""}</span>
                  <span>{duration(g.rec.durationFrames / 60)}</span>
                </span>
                <span className="game-card-main">
                  <span className="game-card-matchup">{charName(g.me.characterId)} vs {charName(g.opp.characterId)}</span>
                  <span className={`game-card-result ${g.isWin === null ? "" : g.isWin ? "up" : "down"}`}>{g.isWin === null ? (g.selfMatch ? "self" : "n/a") : g.isWin ? "W" : "L"}</span>
                </span>
                <span className="game-card-meta">
                  <span>{g.opp.connectCode ?? g.opp.displayName ?? "Unknown opponent"}</span>
                  <span>·</span><span>{stageName(g.rec.stageId)}</span>
                  <span>·</span><span>{int(g.me.kills)}–{int(g.opp.kills)}</span>
                  <span className="badge">{g.rec.gameType}</span>
                </span>
              </button>
              {open && <div className="game-card-detail"><GameDetailTable g={g} /></div>}
            </article>
          );
        })}
      </div>
      {games.length > 300 && <div className="hint">Showing latest 300 of {games.length.toLocaleString()} — export CSV for the full set.</div>}
      <div className="hint">Click a game to see the full stat line for both players.</div>
    </div>
  );
}
