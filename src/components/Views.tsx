import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import type { Account, ActionCounts, PlayerSide, ResolvedGame } from "../lib/types";
import { ACTION_LABELS, codeShort } from "../lib/types";
import { matchupMatrix, byStage, byOpponent, byOppCharacter, computeSets, setsSummary, executionSummary, rollingExecutionSeries, ROLLING_WINDOW, MAX_SERIES_POINTS, actionAverages, actionImpact, moveTable, moveImpact, moveMetricSeriesMany, neutralSummary, perGameSeries, stageCharMatrix } from "../lib/stats";
import type { ExecMetricKey, ExecutionSummary, GameSet, MoveMetricKey, MoveRow, SetsSummary } from "../lib/stats";
import { pct, num, int, shortDate, duration, winRateColor } from "../lib/format";
import { charName, stageName } from "../lib/melee";
import { Kpi } from "./Kpi";
import { axisStyle, tooltipStyle, gridStyle, dayTick, OPP_SERIES_COLOR } from "./chartStyle";
import { activateOnKey } from "../lib/a11y";

/**
 * A horizontally scrolling win-rate grid with a second scrollbar above it.
 *
 * A full roster is 26 columns, so the grid overflows on any normal window —
 * and the only handle for the columns off the right edge sat under the last
 * row, which is the far corner of the panel from where you're reading. The
 * strip above is an empty div the same width as the grid; the two scroll
 * positions are kept in sync in both directions, so either bar drives.
 * It renders only when the content actually overflows — a dead scrollbar over
 * a grid that already fits is worse than no scrollbar.
 */
function MatrixScroll({ children }: { children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0); // 0 = fits, no top bar

  // No dep array: the grid's width changes with the filters, not with anything
  // this component can name. Re-measuring to the same number is a no-op state
  // set, so this settles in one pass rather than looping.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setScrollWidth(body.scrollWidth > body.clientWidth ? body.scrollWidth : 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    // The box can keep its size while the table inside it grows or shrinks.
    if (body.firstElementChild) ro.observe(body.firstElementChild);
    return () => ro.disconnect();
  });

  // The guard is what stops the pair ping-ponging: assigning scrollLeft fires
  // a scroll event on the target, which syncs straight back.
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };

  return (
    <>
      {scrollWidth > 0 && (
        // Purely a duplicate control surface: the grid below is the content.
        <div className="matrix-scroll-top" ref={topRef} aria-hidden="true" onScroll={() => sync(topRef.current, bodyRef.current)}>
          <div style={{ width: scrollWidth }} />
        </div>
      )}
      <div className="matrix-wrap" ref={bodyRef} onScroll={() => sync(bodyRef.current, topRef.current)}>
        {children}
      </div>
    </>
  );
}

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
        <MatrixScroll>
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
        </MatrixScroll>
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
    <MatrixScroll>
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
    </MatrixScroll>
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
 * Opponents per page. The list is sorted by games played, so page 1 is the
 * people you actually play and the tail is one-off netplay encounters — 100 at
 * once buried the panels underneath without telling anyone anything. Paging
 * keeps the whole history reachable without putting it all on screen.
 */
const OPPONENT_ROWS = 25;

/**
 * Set-level framing: players think in sets, not games — "I went 3–1 in the
 * runback". Sets are always best of three (see computeSets); an unfinished
 * trailing set is not counted.
 */
/** The set summary bars. Split from RecentSets so the game log can sit between them. */
function SetsKpis({ s }: { s: SetsSummary }) {
  if (s.sets === 0) return null;
  return (
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
  );
}

/**
 * Recent sets, collapsed by default like the session log: the bars above are
 * the summary worth landing on, this table is for going looking.
 *
 * Separate from SetsKpis so Opponents can order the game log between the two —
 * and so a library with no completed sets, which renders neither of these,
 * still gets its game log.
 */
function RecentSets({
  sets,
  s,
  onSelect,
}: {
  sets: GameSet[];
  s: SetsSummary;
  onSelect: (code: string) => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  if (s.sets === 0) return null;
  const recent = [...sets].reverse().slice(0, 15);
  return (
    <div className="panel">
      <h2 className="panel-disclosure">
        <button aria-expanded={logOpen} aria-controls="recent-sets" onClick={() => setLogOpen((v) => !v)}>
          Recent sets
          <span className="panel-disclosure-meta">
            latest {Math.min(recent.length, s.sets).toLocaleString()} of {s.sets.toLocaleString()}
            <span aria-hidden="true">{logOpen ? "▲" : "▼"}</span>
          </span>
        </button>
      </h2>
      {logOpen && (
      <div id="recent-sets">
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
        A set is consecutive games against the same opponent, best of three — it ends when someone reaches two wins,
        and the next game starts a new one. A 20-minute gap also ends it, and a trailing set nobody won is not
        counted. Click a row to filter to that opponent.
      </div>
      </div>
      )}
    </div>
  );
}

export function Opponents({
  games,
  accounts,
  onSelect,
}: {
  games: ResolvedGame[];
  accounts: Account[];
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => byOpponent(games), [games]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return rows.filter(
      (r) => !q || r.code.toLowerCase().includes(q) || (r.displayName ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);
  // Computed here rather than inside the sets components so both read the same
  // pass, and so Opponents controls where the game log lands between them.
  const sets = useMemo(() => computeSets(games), [games]);
  const setsSum = useMemo(() => setsSummary(sets), [sets]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / OPPONENT_ROWS));
  // Clamped rather than reset in an effect: a dashboard filter can shrink the
  // list under whatever page you were on, and deriving the page keeps that from
  // rendering an empty table for a frame.
  const current = Math.min(page, pageCount - 1);
  const start = current * OPPONENT_ROWS;
  const visible = filtered.slice(start, start + OPPONENT_ROWS);
  if (rows.length === 0) return <div className="empty-note">No opponents with connect codes in the current filter.</div>;
  return (
    <>
    {/* Bars first, then the two collapsed logs: the tab opens on the summary
        and the opponents table rather than on two long tables. */}
    <SetsKpis s={setsSum} />
    <GameLog games={games} accounts={accounts} />
    <RecentSets sets={sets} s={setsSum} onSelect={onSelect} />
    <div className="panel">
      <h2>Opponents</h2>
      <div style={{ marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0); // a new search should start at its own first page
          }}
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
          {visible.map((r) => (
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
      {filtered.length === 0 && <div className="empty-note">No opponent matches that search.</div>}
      {pageCount > 1 && (
        <div className="pager">
          <button className="ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>
            ← Prev
          </button>
          <span className="pager-count">
            {(start + 1).toLocaleString()}–{(start + visible.length).toLocaleString()} of{" "}
            {filtered.length.toLocaleString()} · page {current + 1} of {pageCount}
          </span>
          <button className="ghost" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
            Next →
          </button>
        </div>
      )}
      <div className="hint">
        Click a row to filter the dashboard to that opponent. Sorted by games played, so later pages are the
        one-off encounters.
      </div>
    </div>
    </>
  );
}

// ---------------- Execution ----------------

const ROLLING_METRICS: { key: ExecMetricKey; label: string; unit: string; color: string }[] = [
  { key: "lCancel", label: "L-cancel success", unit: "%", color: "var(--accent)" },
  { key: "groundTechSuccess", label: "Ground Tech Success", unit: "%", color: "#9adb4f" },
  { key: "wallTechSuccess", label: "Wall Tech Success", unit: "%", color: "#72d6a4" },
  { key: "opk", label: "Openings per kill", unit: "", color: "#e8b54d" },
  { key: "dpo", label: "Damage per opening", unit: "", color: "#3fcf8e" },
  { key: "ipm", label: "Inputs per minute", unit: "", color: "#6db3f2" },
];

/** Rolling ROLLING_WINDOW-game average of a single execution metric, chosen via chips. */
function RollingExecChart({ games }: { games: ResolvedGame[] }) {
  const [metric, setMetric] = useState<ExecMetricKey>("lCancel");
  const def = ROLLING_METRICS.find((m) => m.key === metric)!;
  const data = useMemo(() => rollingExecutionSeries(games, metric), [games, metric]);
  // Points are thinned across the whole history, so a tick's game index is no
  // longer its position in the array — look the date up instead of deriving it.
  const dateByIndex = useMemo(() => new Map<number, string>(data.map((p) => [p.index, p.date])), [data]);
  return (
    <div className="panel">
      <h2>Rolling {ROLLING_WINDOW}-game average</h2>
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
            tickFormatter={(v: number) => dayTick(dateByIndex.get(v))}
          />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} domain={["auto", "auto"]} unit={def.unit} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(v, payload) => {
              const d = payload?.[0]?.payload?.date;
              return d ? `Game ${v} — ${dayTick(d)}` : `Game ${v}`;
            }}
            formatter={(v, name) => [`${Number(v).toFixed(1)}${def.unit}`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-data)" }} />
          <Line type="monotone" dataKey="value" name="Me" stroke={def.color} strokeWidth={2} dot={false} connectNulls />
          <Line
            type="monotone"
            dataKey="oppValue"
            name="Opponents"
            stroke={OPP_SERIES_COLOR}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            strokeOpacity={0.9}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="hint">
        Each point averages the previous {ROLLING_WINDOW} games. The line spans all {games.length.toLocaleString()}{" "}
        games in this filter
        {games.length > MAX_SERIES_POINTS ? `, sampled down to ${MAX_SERIES_POINTS.toLocaleString()} points` : ""}.
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

const ACTION_SERIES: SeriesDef[] = [
  ...ACTION_LABELS.map<SeriesDef>(({ key, label }) => ({
    key,
    label,
    color: ACTION_COLORS[key],
    value: (g) => g.me.actions?.[key] ?? 0,
    oppValue: (g) => g.opp.actions?.[key] ?? 0,
  })),
  {
    key: "techInPlace",
    label: "Tech in place",
    color: "#c4e86b",
    value: (g) => g.me.techs?.inPlace ?? 0,
    oppValue: (g) => g.opp.techs?.inPlace ?? 0,
  },
  {
    key: "techIn",
    label: "Tech in",
    color: "#72d6a4",
    value: (g) => g.me.techs?.toward ?? 0,
    oppValue: (g) => g.opp.techs?.toward ?? 0,
  },
  {
    key: "techAway",
    label: "Tech away",
    color: "#f2c45e",
    value: (g) => g.me.techs?.away ?? 0,
    oppValue: (g) => g.opp.techs?.away ?? 0,
  },
];

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
  // Points are thinned across the whole history, so a tick's game index is no
  // longer its position in the array — look the date up instead of deriving it.
  const dateByIndex = useMemo(() => new Map<number, string>(data.map((p) => [p.index, p.date])), [data]);

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
              tickFormatter={(v: number) => dayTick(dateByIndex.get(v))}
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
        Each point averages the previous {ROLLING_WINDOW} games. The line spans all {games.length.toLocaleString()}{" "}
        games in this filter
        {games.length > MAX_SERIES_POINTS ? `, sampled down to ${MAX_SERIES_POINTS.toLocaleString()} points` : ""}.
      </div>
    </div>
  );
}

const MOVE_METRIC_CHOICES: { key: MoveMetricKey; label: string; unit: string; digits: number }[] = [
  { key: "attemptsPerGame", label: "Attempted / game", unit: "", digits: 1 },
  { key: "landedPerGame", label: "Landed / game", unit: "", digits: 1 },
  { key: "dmgPerGame", label: "Dmg / game", unit: "", digits: 1 },
  { key: "dmgShare", label: "Dmg share", unit: "%", digits: 1 },
  { key: "avgDmgPerHit", label: "Avg dmg / hit", unit: "", digits: 1 },
  { key: "killsPerGame", label: "Kills / game", unit: "", digits: 2 },
  { key: "killShare", label: "Kill share", unit: "%", digits: 1 },
  { key: "avgKillPct", label: "Avg kill %", unit: "%", digits: 0 },
  { key: "lCancelPct", label: "L-cancel", unit: "%", digits: 1 },
];

/**
 * Why a move x metric can have nothing to plot without anything being wrong.
 * Named per metric because a bare "no data" reads as a bug otherwise: two of
 * these columns simply are not collected for every move (see MoveAgg).
 */
const MOVE_METRIC_EMPTY: Partial<Record<MoveMetricKey, string>> = {
  attemptsPerGame:
    "Attempts are tracked for grounded normals and aerials only — specials and throws record landings, not initiations.",
  lCancelPct: "L-cancel only applies to aerials.",
  avgKillPct: "This move hasn't closed a stock in these games.",
};

// No red: it remains reserved for losses and danger throughout the dashboard.
const MOVE_TREND_COLORS = [
  "var(--accent)",
  "#e8b54d",
  "#3fcf8e",
  "#6db3f2",
  "#4fc9c4",
  "#e87fd0",
  "#9adb4f",
  "#f2985e",
];

/**
 * Any cell of the Move effectiveness table, plotted over time. That table is a
 * snapshot of the last ROLLING_WINDOW games; this is the same figure computed
 * over the window ending at every game, so its right edge is that table and
 * the line behind it is how the number got there.
 */
function MoveMetricChart({ games, moves }: { games: ResolvedGame[]; moves: MoveRow[] }) {
  const [moveKeys, setMoveKeys] = useState<Set<string>>(() => new Set(moves[0] ? [moves[0].key] : []));
  const [metric, setMetric] = useState<MoveMetricKey>("landedPerGame");
  // Filters change which moves exist at all. Preserve selections that remain
  // available and fall back to the top move only when every held key is stale.
  const activeMoves = useMemo(() => {
    const selected = moves.filter((move) => moveKeys.has(move.key));
    return selected.length > 0 ? selected : moves.slice(0, 1);
  }, [moves, moveKeys]);
  const def = MOVE_METRIC_CHOICES.find((m) => m.key === metric)!;
  const points = useMemo(
    () => moveMetricSeriesMany(games, activeMoves.map((move) => move.key), metric),
    [games, activeMoves, metric],
  );
  const data = useMemo(
    () => points.map((point) => {
      const row: Record<string, string | number | null> = { index: point.index, date: point.date };
      for (let i = 0; i < activeMoves.length; i++) row[`move-${i}`] = point.values[i] ?? null;
      return row;
    }),
    [activeMoves, points],
  );
  // Points are thinned across the whole history, so a tick's game index is no
  // longer its position in the array — look the date up instead of deriving it.
  const dateByIndex = useMemo(() => new Map<number, string>(points.map((p) => [p.index, p.date])), [points]);
  const hasData = points.some((point) => point.values.some((value) => value !== null));
  const moveSummary = activeMoves.length === 1
    ? activeMoves[0]!.label
    : `${activeMoves.length} moves selected`;
  const toggleMove = (key: string) => {
    setMoveKeys(() => {
      // Base the update on the effective selection so the fallback move stays
      // selected when a second line is added after filters changed.
      const next = new Set(activeMoves.map((move) => move.key));
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  return (
    <div className="panel">
      <div className="panel-heading-row">
        <div>
          <h2 className="panel-title">Move trend — {ROLLING_WINDOW}-game rolling average</h2>
        </div>
        <div className="panel-controls">
          <div className="panel-control">
            <span>Moves</span>
            {moves.length === 0 ? (
              <button type="button" className="move-picker-empty" disabled>No move data</button>
            ) : (
              <details className="move-picker">
                <summary aria-label={`Moves: ${moveSummary}`}>
                  <span>{moveSummary}</span><span className="move-picker-chevron" aria-hidden="true">▾</span>
                </summary>
                <div className="move-picker-menu">
                  {moves.map((move) => {
                    const checked = activeMoves.some((active) => active.key === move.key);
                    return (
                      <label className="move-picker-option" key={move.key}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={checked && activeMoves.length === 1}
                          onChange={() => toggleMove(move.key)}
                        />
                        <span>{move.label}</span>
                      </label>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
          <label>
            Metric
            <select value={metric} onChange={(e) => setMetric(e.target.value as MoveMetricKey)}>
              {MOVE_METRIC_CHOICES.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {activeMoves.length === 0 ? (
        <div className="empty-note">
          No per-move data in these games yet — it's computed at parse time, so hit <b>Refresh</b> (or re-pick your
          folder) to re-parse the library once.
        </div>
      ) : !hasData ? (
        <div className="empty-note">
          Nothing to plot for the selected {activeMoves.length === 1 ? "move" : "moves"} — {def.label}.{" "}
          {MOVE_METRIC_EMPTY[metric] ?? "Those moves don't land in these games."}
        </div>
      ) : (
        <>
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
                tickFormatter={(v: number) => dayTick(dateByIndex.get(v))}
              />
              <YAxis tick={axisStyle} tickLine={false} axisLine={false} domain={["auto", "auto"]} unit={def.unit} />
              <Tooltip
                {...tooltipStyle}
                labelFormatter={(v, payload) => {
                  const d = payload?.[0]?.payload?.date;
                  return d ? `Game ${v} — ${dayTick(d)}` : `Game ${v}`;
                }}
                formatter={(v, name) => [`${num(Number(v), def.digits)}${def.unit}`, `${String(name)} — ${def.label}`]}
              />
              {activeMoves.length > 1 && <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-data)" }} />}
              {activeMoves.map((move, i) => (
                <Line
                  key={move.key}
                  type="monotone"
                  dataKey={`move-${i}`}
                  name={move.label}
                  stroke={MOVE_TREND_COLORS[i % MOVE_TREND_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="hint">
            Each line is {def.label} for a selected move over the previous {ROLLING_WINDOW} games, so its last point
            is the figure the Move effectiveness table below shows. The chart spans all{" "}
            {games.length.toLocaleString()} games in this filter
            {games.length > MAX_SERIES_POINTS ? `, sampled down to ${MAX_SERIES_POINTS.toLocaleString()} points` : ""}.
            Gaps are windows with no denominator — games you never threw it in — rather than zeroes, which would claim
            you threw it and got nothing.
          </div>
        </>
      )}
    </div>
  );
}

const kpiPctValue = (value: number | null, digits: number) => value !== null ? `${num(value, digits)}%` : "—";

function TechKpi({ summary }: { summary: ExecutionSummary }) {
  const ground = kpiPctValue(summary.groundTechSuccess, 1);
  const wall = kpiPctValue(summary.wallTechSuccess, 1);
  const split = [summary.groundTechInPlace, summary.groundTechIn, summary.groundTechAway]
    .map((value) => kpiPctValue(value, 0))
    .join("/");
  return (
    <div className="kpi tech-kpi">
      <div className="label">Tech success % — last {summary.games}</div>
      <div className="tech-kpi-line primary" title="Ground Tech Success" aria-label={`Ground Tech Success: ${ground}`}>{ground}</div>
      <div className="tech-kpi-line" title="Wall Tech Success" aria-label={`Wall Tech Success: ${wall}`}>{wall}</div>
      <div className="tech-kpi-split" title="Ground tech mix: in-place / in / away" aria-label={`Ground tech mix, in-place, in, away: ${split}`}>% of total (in-place/in/away): {split}</div>
    </div>
  );
}

export function Execution({ games }: { games: ResolvedGame[] }) {
  // The charts cover the whole filter; everything under them describes current
  // form, so it reads the trailing window the charts smooth over. The same
  // number on purpose — see ROLLING_WINDOW.
  const recentGames = useMemo(() => games.slice(-ROLLING_WINDOW), [games]);
  const summary = useMemo(() => executionSummary(games), [games]);
  const actions = useMemo(() => actionAverages(recentGames), [recentGames]);
  const neutral = useMemo(() => neutralSummary(recentGames), [recentGames]);
  // One pass over the whole filter feeds the move picker and the impact split;
  // the window pass feeds the two tables that report current habits.
  const career = useMemo(() => moveTable(games), [games]);
  const recentMoves = useMemo(() => moveTable(recentGames), [recentGames]);
  if (games.length < 2) return <div className="empty-note">Not enough games for execution trends.</div>;
  return (
    <>
      <div className="kpi-strip compact">
        <Kpi label={`L-cancel success % — last ${summary.games}`} value={summary.lCancel !== null ? `${num(summary.lCancel, 1)}%` : "—"} />
        <TechKpi summary={summary} />
        <Kpi label={`Openings / kill — last ${summary.games}`} value={num(summary.opk, 2)} />
        <Kpi label={`Damage / opening — last ${summary.games}`} value={num(summary.dpo, 1)} />
        <Kpi label={`Inputs / min — last ${summary.games}`} value={int(summary.ipm)} />
      </div>

      <RollingExecChart games={games} />

      <MoveMetricChart games={games} moves={career.rows} />

      <PerGameMetricChart
        title={`Actions — per game, ${ROLLING_WINDOW}-game rolling average`}
        games={games}
        series={ACTION_SERIES}
        defaults={["wavedashes"]}
      />

      <div className="panel">
        <h2>Neutral summary (past {neutral.covered.toLocaleString()} games)</h2>
        {neutral.covered === 0 ? (
          <div className="empty-note">Your most recent games in this filter don't carry neutral counts yet.</div>
        ) : (
          <>
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
                {neutral.rows.map((r) => (
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
            <h3 className="table-subhead">Ground tech directions</h3>
            <table className="subtable">
              <thead>
                <tr>
                  <th>Tech</th>
                  <th className="data">Me</th>
                  <th className="data">Me / game</th>
                  <th className="data">Me %</th>
                  <th className="data">Opponents</th>
                  <th className="data">Opp / game</th>
                  <th className="data">Opp %</th>
                </tr>
              </thead>
              <tbody>
                {neutral.techRows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="data">{r.mine.toLocaleString()}</td>
                    <td className="data">{num(r.perGame, 1)}</td>
                    <td className="data">{pct(r.minePct ?? null, 0)}</td>
                    <td className="data">{r.theirs.toLocaleString()}</td>
                    <td className="data">{num(r.oppPerGame ?? 0, 1)}</td>
                    <td className="data">{pct(r.theirsPct ?? null, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint">
              Your most recent {neutral.covered.toLocaleString()} games in this filter — current form, not career
              totals. Share is your count ÷ the game total, so over 50% means you're winning that kind of exchange
              more often than your opponents.
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Actions per game (past {actions.covered.toLocaleString()} games)</h2>
        {actions.covered === 0 ? (
          <div className="empty-note">Your most recent games in this filter don't carry action counts yet.</div>
        ) : (
          <>
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
                {actions.rows.map((a) => (
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
              Your most recent {actions.covered.toLocaleString()} games in this filter — your counts and your
              opponents'. Per-minute normalizes for game length, which is the fairer comparison across filters.
            </div>
          </>
        )}
      </div>

      <MovesSection games={games} career={career} recent={recentMoves} />
    </>
  );
}

/**
 * Per-move damage, kills, openings, and the volume-vs-wins impact analysis.
 *
 * Both move-table passes are computed by the caller and handed down: `recent`
 * is the trailing window the first two tables report, `career` the whole
 * filter, which the impact split needs for its medians to mean anything and
 * the move picker needs so its dropdown isn't cut down to the window.
 */
function MovesSection({
  games,
  career,
  recent,
}: {
  games: ResolvedGame[];
  career: { rows: MoveRow[]; covered: number };
  recent: { rows: MoveRow[]; covered: number };
}) {
  const [minMoveUsageInput, setMinMoveUsageInput] = useState("1");
  // Moves and actions ride the same heavy-vs-light analysis, one sorted table.
  const impact = useMemo(
    () => [...moveImpact(games), ...actionImpact(games)].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)),
    [games],
  );
  const minMoveUsage = Math.min(100, Math.max(1, Math.round(Number(minMoveUsageInput) || 1)));
  // The percentage threshold applies only to move share. Action usage is a
  // different unit (/min), so it stays visible at every threshold.
  const visibleImpact = useMemo(
    () => impact.filter((row) => row.usageKind === "perMinute" || row.avgShare * 100 >= minMoveUsage),
    [impact, minMoveUsage],
  );
  if (career.rows.length === 0) {
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
        <h2>Move effectiveness (past {recent.covered.toLocaleString()} games)</h2>
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
          Your most recent {recent.covered.toLocaleString()} games in this filter — current habits, not
          career averages. Attempted counts every initiation (whiffs included) and is tracked for normals and aerials
          only — specials and throws show "—", not zero. The gap between attempted and landed is your whiff rate.
          L-cancel likewise counts every landing of that aerial (hover for attempts; it can differ a hair from the
          headline rate, which corrects for edge-cancels). Avg kill % is the opponent's percent when the move closed a
          stock — a high number on a kill move means you're fishing with it stale.
        </div>
      </div>

      <div className="panel">
        <h2>Openings — which move starts your offense (past {recent.covered.toLocaleString()} games)</h2>
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
            {recent.rows
              .filter((r) => r.openings > 0)
              .sort((a, b) => b.openings - a.openings)
              .map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="data">{num(recent.covered ? r.openings / recent.covered : 0, 1)}</td>
                  <td className="data">{pct(r.openingShare, 0)}</td>
                  <td className="data">{num(r.dmgPerOpening, 1)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="hint">
          The first move of each conversion, over your most recent {recent.covered.toLocaleString()} games in this
          filter. High damage-per-opening moves are the neutral wins worth hunting; pair with openings/kill above to
          see whether you're converting them. A short window makes the rare openings noisy — a move with a handful of
          them can top the damage column on one good conversion.
        </div>
      </div>

      {impact.length > 0 && (
        <div className="panel">
          <div className="panel-heading-row">
            <h2 className="panel-title">Move impact — volume vs wins</h2>
            <div className="panel-controls">
              <label>
                Minimum move usage
                <span className="number-suffix">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    inputMode="numeric"
                    value={minMoveUsageInput}
                    onChange={(e) => setMinMoveUsageInput(e.target.value)}
                    onBlur={() => setMinMoveUsageInput(String(minMoveUsage))}
                  />
                  <span aria-hidden="true">%</span>
                </span>
              </label>
            </div>
          </div>
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
              {visibleImpact.map((r) => (
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
            practice lead, not proof. Move rows below {minMoveUsage}% usage are hidden; action rows use /min and are
            never filtered by this control. Visible moves under 2% are faded because their deltas run noisy.
          </div>
        </div>
      )}
    </>
  );
}

// ---------------- Game log ----------------

/**
 * Rows rendered before the log is cut off. This is a browsing view, not an
 * archive — the CSV export is the archive — and every row mounts an expandable
 * card, so the old 300 cost real render time to show games nobody scrolled to.
 */
const GAME_LOG_ROWS = 50;

/** Count plus this player's share of the game total, e.g. "13 (57%)". */
const withShare = (mine: number, theirs: number) =>
  mine + theirs > 0 ? `${mine} (${pct(mine / (mine + theirs), 0)})` : "0";

const techSuccessLabel = (p: PlayerSide): string => {
  const t = p.techs;
  if (!t) return "—";
  const groundSuccess = t.inPlace + t.toward + t.away;
  const success = groundSuccess + t.wallSuccess;
  const attempts = success + t.missed + t.wallMissed;
  return attempts === 0 ? "—" : `${success}/${attempts} (${pct(success / attempts, 0)})`;
};

const techDirectionLabel = (p: PlayerSide): string => {
  const t = p.techs;
  if (!t) return "—";
  const groundSuccess = t.inPlace + t.toward + t.away;
  return groundSuccess === 0
    ? "—"
    : `${pct(t.inPlace / groundSuccess, 0)} / ${pct(t.toward / groundSuccess, 0)} / ${pct(t.away / groundSuccess, 0)}`;
};

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
  { label: "Tech success", value: techSuccessLabel },
  { label: "Tech dirs (IP/in/away)", value: techDirectionLabel },
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

/** Rendered inside Opponents, not as its own tab — see the Opponents view. */
function GameLog({ games, accounts }: { games: ResolvedGame[]; accounts: Account[] }) {
  const recent = useMemo(() => [...games].reverse().slice(0, GAME_LOG_ROWS), [games]);
  // Closed by default: it is the heaviest thing on the tab (every row mounts an
  // expandable card) and the least likely to be what you came for.
  const [logOpen, setLogOpen] = useState(false);
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
      {/* Export sits beside the disclosure rather than inside it: the CSV is the
          full filtered set and shouldn't need the table opened to reach. */}
      <div className="panel-disclosure-row">
        <h2 className="panel-disclosure">
          <button aria-expanded={logOpen} aria-controls="game-log" onClick={() => setLogOpen((v) => !v)}>
            Game log
            <span className="panel-disclosure-meta">
              latest {Math.min(GAME_LOG_ROWS, games.length).toLocaleString()} of {games.length.toLocaleString()}
              <span aria-hidden="true">{logOpen ? "▲" : "▼"}</span>
            </span>
          </button>
        </h2>
        <button className="ghost" onClick={exportCsv}>
          Export CSV ({games.length.toLocaleString()})
        </button>
      </div>
      {logOpen && (
      <div id="game-log" className="panel-disclosure-body">
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
      {games.length > GAME_LOG_ROWS && (
        <div className="hint">
          Showing latest {GAME_LOG_ROWS} of {games.length.toLocaleString()} — export CSV for the full set.
        </div>
      )}
      <div className="hint">Click a game to see the full stat line for both players.</div>
      </div>
      )}
    </div>
  );
}
