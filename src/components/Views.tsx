import { Fragment, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { Filters, PlayerSide, ResolvedGame } from "../lib/types";
import { ACTION_LABELS } from "../lib/types";
import { matchupMatrix, byStage, byOpponent, byOppCharacter, executionTrend, lCancelSeries, actionAverages, neutralSummary, perGameSeries } from "../lib/stats";
import { pct, num, int, shortDate, duration, winRateColor } from "../lib/format";
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

const EXEC_CHARTS: {
  key: string;
  label: string;
  unit: string;
  color: string;
  compare?: { key: string; label: string; color: string };
}[] = [
  { key: "lCancel", label: "L-cancel success", unit: "%", color: "var(--accent)", compare: { key: "oppLCancel", label: "Opponents", color: "#f0564f" } },
  { key: "opk", label: "Openings per kill (lower is better)", unit: "", color: "#e8b54d", compare: { key: "oppOpk", label: "Opponents", color: "#f0564f" } },
  { key: "dpo", label: "Damage per opening", unit: "", color: "#3fcf8e", compare: { key: "oppDpo", label: "Opponents", color: "#f0564f" } },
  { key: "ipm", label: "Inputs per minute", unit: "", color: "#6db3f2", compare: { key: "oppIpm", label: "Opponents", color: "#f0564f" } },
];

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

const ACTION_COLORS: Record<string, string> = {
  rolls: "#f0564f",
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
            style={showOpp ? { borderColor: "#f0564f" } : undefined}
            onClick={() => setShowOpp((v) => !v)}
          >
            <span className="dot" style={{ background: "#f0564f", opacity: showOpp ? 1 : 0.35 }} />
            vs opponents
          </button>
        )}
      </div>
      {selected.size === 0 ? (
        <div className="empty-note">Pick at least one metric above.</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
            {/* Unique game index as the axis key, dates as labels — see L-cancel chart. */}
            <XAxis
              dataKey="index"
              tick={axisStyle}
              tickLine={false}
              axisLine={{ stroke: "#34305a" }}
              minTickGap={48}
              tickFormatter={(v: number) => (data[v - data[0].index] as { date?: string })?.date ?? ""}
            />
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              {...tooltipStyle}
              labelFormatter={(v, payload) => {
                const d = payload?.[0]?.payload?.date;
                return d ? `Game ${v} — ${d}` : `Game ${v}`;
              }}
              formatter={(v, name) => [int(Number(v)), name]}
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
                    stroke="#f0564f"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    strokeOpacity={0.9}
                    dot={false}
                  />
                ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      <div className="hint">Each point is one game{games.length > 500 ? ` (latest 500 of ${games.length.toLocaleString()})` : ""}.</div>
    </div>
  );
}

export function Execution({ games }: { games: ResolvedGame[] }) {
  const points = useMemo(() => executionTrend(games), [games]);
  const lcVolume = useMemo(() => lCancelSeries(games), [games]);
  const actions = useMemo(() => actionAverages(games), [games]);
  const neutral = useMemo(() => neutralSummary(games), [games]);
  if (points.length < 2) return <div className="empty-note">Not enough games for execution trends.</div>;
  return (
    <>
      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {EXEC_CHARTS.map((c) => (
          <div className="panel" key={c.key}>
            <h2>{c.label}</h2>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={points} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                <XAxis dataKey="date" tick={axisStyle} tickLine={false} axisLine={{ stroke: "#34305a" }} minTickGap={48} />
                <YAxis tick={axisStyle} tickLine={false} axisLine={false} domain={["auto", "auto"]} unit={c.unit} />
                <Tooltip {...tooltipStyle} formatter={(v, name) => [`${Number(v).toFixed(1)}${c.unit}`, name]} />
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

      <div className="panel">
        <h2>L-cancel volume — per game</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={lcVolume} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
            {/* The axis must key on the unique game index — keying on `date` makes
                recharts treat same-day games as one category, so every hover
                resolves to the first game of that day. Ticks still render dates. */}
            <XAxis
              dataKey="index"
              tick={axisStyle}
              tickLine={false}
              axisLine={{ stroke: "#34305a" }}
              minTickGap={48}
              tickFormatter={(v: number) => lcVolume[v - lcVolume[0].index]?.date ?? ""}
            />
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              {...tooltipStyle}
              labelFormatter={(v, payload) => {
                const d = payload?.[0]?.payload?.date;
                return d ? `Game ${v} — ${d}` : `Game ${v}`;
              }}
              formatter={(v, name) => [int(Number(v)), name]}
            />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-data)" }} />
            <Line type="monotone" dataKey="attempts" name="Attempts" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="success" name="Successful" stroke="#3fcf8e" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="hint">
          Each point is one game{games.length > 500 ? ` (latest 500 of ${games.length.toLocaleString()})` : ""}. The gap
          between the lines is your missed L-cancels; the attempts line alone tracks how aerial-heavy your play is.
        </div>
      </div>

      <PerGameMetricChart
        title="Neutral exchanges — per game"
        games={games}
        series={NEUTRAL_SERIES}
        defaults={["beneficialTrades"]}
      />

      <PerGameMetricChart
        title="Actions — per game"
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

function GameDetail({ g }: { g: ResolvedGame }) {
  return (
    <tr className="detail-row">
      <td colSpan={8}>
        <div className="detail-grid">
          <table>
            <thead>
              <tr>
                <th />
                <th className="data">
                  Me — {charName(g.me.characterId)} (P{g.me.port})
                </th>
                <th className="data">
                  {g.opp.displayName ?? g.opp.connectCode ?? "Opponent"} — {charName(g.opp.characterId)} (P{g.opp.port})
                </th>
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
      </td>
    </tr>
  );
}

export function GameLog({ games }: { games: ResolvedGame[] }) {
  const recent = useMemo(() => [...games].reverse().slice(0, 300), [games]);
  const [openId, setOpenId] = useState<string | null>(null);

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
            <Fragment key={g.rec.id}>
              <tr className="clickable" onClick={() => setOpenId(openId === g.rec.id ? null : g.rec.id)}>
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
              {openId === g.rec.id && <GameDetail g={g} />}
            </Fragment>
          ))}
        </tbody>
      </table>
      {games.length > 300 && <div className="hint">Showing latest 300 of {games.length.toLocaleString()} — export CSV for the full set.</div>}
      <div className="hint">Click a game to see the full stat line for both players.</div>
    </div>
  );
}

// Re-export types used by App for convenience.
export type { Filters };
