import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ResolvedGame } from "../lib/types";
import {
  COMMUNITY_MIN_CONTRIBUTORS,
  COMMUNITY_MIN_GAMES,
  demoCommunitySnapshot,
  fetchCommunitySnapshot,
  type CommunityBenchmarkRow,
  type CommunityExecutionRow,
  type CommunityMoveRow,
  type CommunitySnapshot,
  type Quartiles,
} from "../lib/community";
import { executionSummary } from "../lib/stats";
import { charName, moveGroupLabel, stageName } from "../lib/melee";
import { duration, int, num, pct, shortDate, winRateColor } from "../lib/format";
import { INCLUDED_STAGE_IDS } from "../lib/config";
import { moveTabFocus } from "../lib/a11y";
import { axisStyle, gridStyle, tooltipStyle } from "./chartStyle";
import { Kpi } from "./Kpi";
import { CommunityConsent } from "./CommunityConsent";

type CommunityView = "matchups" | "benchmarks" | "moves" | "stages" | "pulse";

const VIEWS: { id: CommunityView; label: string }[] = [
  { id: "matchups", label: "Matchup Atlas" },
  { id: "benchmarks", label: "You vs Community" },
  { id: "moves", label: "Move Atlas" },
  { id: "stages", label: "Stage Lab" },
  { id: "pulse", label: "Community Pulse" },
];

const gameTypes = ["all", "ranked", "unranked", "direct", "offline"];

const EMPTY_COMMUNITY_SNAPSHOT: CommunitySnapshot = {
  refreshedAt: "",
  contributorCount: 0,
  playerGameCount: 0,
  minContributors: COMMUNITY_MIN_CONTRIBUTORS,
  minGames: COMMUNITY_MIN_GAMES,
  matchups: [],
  benchmarks: [],
  moves: [],
  execution: [],
  months: [],
  characters: [],
  stages: [],
};

interface Props {
  games: ResolvedGame[];
  isDemo: boolean;
  onOpenAccount: () => void;
}

const selectCharacters = (snapshot: CommunitySnapshot): number[] =>
  snapshot.characters.map((c) => c.characterId).sort((a, b) => charName(a).localeCompare(charName(b)));

export function Community({ games, isDemo, onOpenAccount }: Props) {
  const [view, setView] = useState<CommunityView>("matchups");
  const [snapshot, setSnapshot] = useState<CommunitySnapshot | null>(null);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);
  const demo = useMemo(() => demoCommunitySnapshot(games), [games]);

  useEffect(() => {
    if (isDemo) {
      setSnapshot(demo);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    void fetchCommunitySnapshot()
      .then((next) => { if (alive) setSnapshot(next); })
      .catch(() => { if (alive) setError("Community data is temporarily unavailable."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [demo, isDemo]);

  if (loading) return <div className="empty-note">Loading anonymous community aggregates…</div>;

  // Demo data is derived synchronously, so use it on the first render instead
  // of mounting placeholder controls that would retain their empty selection.
  const displaySnapshot = snapshot ?? (isDemo ? demo : EMPTY_COMMUNITY_SNAPSHOT);
  const hasSnapshot = snapshot !== null || isDemo;
  const ready = hasSnapshot && displaySnapshot.contributorCount >= displaySnapshot.minContributors && displaySnapshot.matchups.length > 0;
  const progress = Math.min(100, (displaySnapshot.contributorCount / displaySnapshot.minContributors) * 100);

  return (
    <>
      {!ready && (
        <div className="panel community-warmup community-preview-progress">
          <div className="eyebrow">Community Lab · Unlock progress</div>
          <h2>Help build a privacy-safe sample</h2>
          <p>
            Explore every planned view below now. A dash marks a result that stays private until at least{" "}
            {displaySnapshot.minContributors} distinct contributors and {displaySnapshot.minGames} player-games qualify.
          </p>
          <div
            className="community-progress"
            aria-label={`${displaySnapshot.contributorCount} of ${displaySnapshot.minContributors} contributors`}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="community-progress-label">
            <b>{hasSnapshot ? displaySnapshot.contributorCount.toLocaleString() : "—"}</b> /{" "}
            {displaySnapshot.minContributors.toLocaleString()} contributors ·{" "}
            <b>{hasSnapshot ? displaySnapshot.playerGameCount.toLocaleString() : "—"}</b> player-games collected
          </div>
          <button className="primary" onClick={onOpenAccount}>Review contribution settings</button>
          {error && <div className="error-note" role="alert">{error}</div>}
        </div>
      )}

      <div className="community-hero panel">
        <div>
          <div className="eyebrow">
            Community Lab {displaySnapshot.demo && <span className="tag">demo preview</span>}
            {!ready && <span className="tag">view preview</span>}
          </div>
          <h2>{ready ? "Learn from the field without exposing the players" : "See what anonymous community data can unlock"}</h2>
          <p>
            Only thresholded aggregates appear here—never connect codes, names, emails, replay paths, exact activity
            timelines, or row-level downloads. Placeholder dashes mark data that has not cleared the thresholds yet.
          </p>
        </div>
        <div className="community-hero-stats">
          <span><b>{hasSnapshot ? displaySnapshot.contributorCount.toLocaleString() : "—"}</b> contributors</span>
          <span><b>{hasSnapshot ? displaySnapshot.playerGameCount.toLocaleString() : "—"}</b> player-games</span>
          <span>Refreshed {hasSnapshot ? shortDate(displaySnapshot.refreshedAt) : "—"}</span>
        </div>
      </div>

      {/* Directly under the contributor count, which is the moment the question
          "am I in this?" actually occurs to someone. It used to live only at
          the bottom of the My Account dialog. */}
      <CommunityConsent isDemo={isDemo} variant="feature" />

      <div className="tabs community-tabs" role="tablist" aria-label="Community views">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            role="tab"
            tabIndex={view === item.id ? 0 : -1}
            aria-selected={view === item.id}
            className={view === item.id ? "active" : ""}
            onKeyDown={moveTabFocus}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === "matchups" && <MatchupAtlas snapshot={displaySnapshot} />}
      {view === "benchmarks" && <CommunityBenchmarks snapshot={displaySnapshot} games={games} />}
      {view === "moves" && <MoveAtlas snapshot={displaySnapshot} />}
      {view === "stages" && <StageLab snapshot={displaySnapshot} />}
      {view === "pulse" && <CommunityPulse snapshot={displaySnapshot} />}
    </>
  );
}

function MatchupAtlas({ snapshot }: { snapshot: CommunitySnapshot }) {
  const chars = selectCharacters(snapshot);
  const [characterId, setCharacterId] = useState(chars[0] ?? -1);
  const [stageId, setStageId] = useState(0);
  const [gameType, setGameType] = useState("all");
  const rows = snapshot.matchups
    .filter((r) => r.characterId === characterId && r.stageId === stageId && r.gameType === gameType)
    .sort((a, b) => b.games - a.games);
  return (
    <div className="panel">
      <div className="panel-heading-row community-heading-row">
        <div>
          <div className="eyebrow">Matchup Atlas</div>
          <h2>{characterId === -1 ? "Character matchups across the qualifying field" : `${charName(characterId)} across the qualifying field`}</h2>
        </div>
        <div className="community-controls">
          <label>Character<select value={characterId} onChange={(e) => setCharacterId(Number(e.target.value))}>{chars.length === 0 && <option value={-1}>—</option>}{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label>
          <label>Stage<select value={stageId} onChange={(e) => setStageId(Number(e.target.value))}><option value={0}>All legal stages</option>{INCLUDED_STAGE_IDS.map((id) => <option key={id} value={id}>{stageName(id)}</option>)}</select></label>
          <label>Mode<select value={gameType} onChange={(e) => setGameType(e.target.value)}>{gameTypes.map((mode) => <option key={mode} value={mode}>{mode === "all" ? "All modes" : mode}</option>)}</select></label>
        </div>
      </div>
      {rows.length ? (
        <div className="community-matchup-grid">
          {rows.map((row) => (
            <article key={row.opponentCharacterId} className="community-matchup-card" style={{ borderColor: winRateColor(row.winRate, 0.8) }}>
              <div className="community-card-label">vs {charName(row.opponentCharacterId)}</div>
              <div className="community-card-value" style={{ color: winRateColor(row.winRate) }}>{pct(row.winRate)}</div>
              <div className="community-card-meta">{row.games.toLocaleString()} games · {row.contributors} contributors</div>
            </article>
          ))}
        </div>
      ) : (
        <div className="community-matchup-grid" aria-label="Matchup data awaiting a qualifying sample">
          {Array.from({ length: 4 }, (_, index) => (
            <article key={index} className="community-matchup-card community-placeholder">
              <div className="community-card-label">vs —</div>
              <div className="community-card-value">—</div>
              <div className="community-card-meta">— games · — contributors</div>
            </article>
          ))}
        </div>
      )}
      <div className="hint">Results are contributor player-games, not an official sample of every Slippi player. Every visible cell clears both the contributor and game minimum.</div>
    </div>
  );
}

const benchmarkDefs: { key: keyof Pick<CommunityBenchmarkRow, "lCancel" | "openingsPerKill" | "damagePerOpening" | "inputsPerMinute">; label: string; local: "lCancel" | "opk" | "dpo" | "ipm"; digits: number; suffix: string; lowerBetter?: boolean }[] = [
  { key: "lCancel", label: "L-cancel success", local: "lCancel", digits: 1, suffix: "%" },
  { key: "openingsPerKill", label: "Openings per kill", local: "opk", digits: 2, suffix: "", lowerBetter: true },
  { key: "damagePerOpening", label: "Damage per opening", local: "dpo", digits: 1, suffix: "" },
  { key: "inputsPerMinute", label: "Inputs per minute", local: "ipm", digits: 0, suffix: "" },
];

function quartileLabel(value: number | null, q: Quartiles | null, lowerBetter = false): string {
  if (value === null) return "Not enough local data";
  if (!q) return "Community cohort not yet available";
  if (value < q.p25) return lowerBetter ? "Below the middle band · efficient" : "Below the community middle band";
  if (value > q.p75) return lowerBetter ? "Above the middle band" : "Above the community middle band";
  return "Inside the community middle 50%";
}

function CommunityBenchmarks({ snapshot, games }: { snapshot: CommunitySnapshot; games: ResolvedGame[] }) {
  const chars = [-1, ...selectCharacters(snapshot)];
  const [characterId, setCharacterId] = useState(-1);
  const row = snapshot.benchmarks.find((b) => b.characterId === characterId) ?? snapshot.benchmarks.find((b) => b.characterId === -1);
  const selected = characterId === -1 ? games : games.filter((g) => g.me.characterId === characterId);
  const own = executionSummary(selected, Number.MAX_SAFE_INTEGER);
  return (
    <div className="panel">
      <div className="panel-heading-row community-heading-row">
        <div><div className="eyebrow">You vs Community</div><h2>Private local overlay on anonymous percentiles</h2></div>
        <div className="community-controls"><label>Character<select value={characterId} onChange={(e) => setCharacterId(Number(e.target.value))}>{chars.map((id) => <option key={id} value={id}>{id === -1 ? "All characters" : charName(id)}</option>)}</select></label></div>
      </div>
      <div className="benchmark-grid">
        {benchmarkDefs.map((def) => {
          const q = row?.[def.key] ?? null;
          const value = own[def.local];
          return (
            <article className={`benchmark-card ${q ? "" : "community-placeholder"}`} key={def.key}>
              <div className="community-card-label">{def.label}</div>
              <div className="benchmark-values"><span><small>You</small><b>{value === null ? "—" : `${value.toFixed(def.digits)}${def.suffix}`}</b></span><span><small>Median</small><b>{q ? `${q.p50.toFixed(def.digits)}${def.suffix}` : "—"}</b></span></div>
              <div className="benchmark-range">Middle 50%: {q ? `${q.p25.toFixed(def.digits)}–${q.p75.toFixed(def.digits)}${def.suffix}` : "—"}</div>
              <div className="benchmark-note">{quartileLabel(value, q, def.lowerBetter)}</div>
            </article>
          );
        })}
      </div>
      <div className="hint">Your values are computed in this browser and are never sent by this comparison. Community quartiles first average each contributor, so a 30,000-game library cannot overpower everyone else.</div>
    </div>
  );
}

function MoveAtlas({ snapshot }: { snapshot: CommunitySnapshot }) {
  const chars = [...new Set([
    ...snapshot.moves.map((m) => m.characterId),
    ...snapshot.execution.filter((r) => r.characterId !== -1).map((r) => r.characterId),
  ])].sort((a, b) => charName(a).localeCompare(charName(b)));
  const [characterId, setCharacterId] = useState(chars[0] ?? -1);
  const rows = snapshot.moves.filter((m) => m.characterId === characterId).sort((a, b) => b.damage - a.damage);
  const execution = snapshot.execution.find((r) => r.characterId === characterId);
  const totalDamage = rows.reduce((sum, r) => sum + r.damage, 0);
  const cohort = characterId === -1 ? "the qualifying field" : `qualifying ${charName(characterId)} players`;
  return (
    <div className="panel">
      <div className="panel-heading-row community-heading-row">
        <div><div className="eyebrow">Move Atlas</div><h2>How {cohort} execute and create openings</h2></div>
        <div className="community-controls"><label>Character<select value={characterId} onChange={(e) => setCharacterId(Number(e.target.value))}><option value={-1}>All characters</option>{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label></div>
      </div>

      <h3 className="table-subhead community-table-subhead">Execution profile</h3>
      <CommunityExecutionTable row={execution} characterId={characterId} />

      <h3 className="table-subhead community-table-subhead">Move effectiveness</h3>
      <div className="table-scroll"><table><thead><tr><th>Move</th><th className="data">Attempted / game</th><th className="data">Landed / game</th><th className="data">Damage share</th><th className="data">Avg dmg / hit</th><th className="data">Kills</th><th className="data">Avg kill %</th><th className="data">Contributors</th></tr></thead><tbody>
        {rows.length ? rows.map((row) => <MoveRowView key={row.moveKey} row={row} totalDamage={totalDamage} />) : (
          <tr className="community-placeholder-row"><td>—</td>{Array.from({ length: 7 }, (_, index) => <td key={index} className="data">—</td>)}</tr>
        )}
      </tbody></table></div>
      <div className="hint">Execution rates are attempt-weighted across current-stat player-games. Ground-tech direction is the share of successful ground techs, so in-place + in + away totals 100%. Attempt counts include whiffs where replay parsing supports them; rare moves stay suppressed even when a character’s overall cohort qualifies.</div>
    </div>
  );
}

const communityExecutionPct = (value: number | null): string => value === null ? "—" : `${num(value, 1)}%`;

function CommunityExecutionTable({ row, characterId }: { row: CommunityExecutionRow | undefined; characterId: number }) {
  return (
    <div className="table-scroll community-execution-table">
      <table>
        <thead>
          <tr>
            <th>Cohort</th>
            <th className="data">L-cancel success</th>
            <th className="data">Ground tech success</th>
            <th className="data">In-place</th>
            <th className="data">In</th>
            <th className="data">Away</th>
            <th className="data">Player-games</th>
            <th className="data">Contributors</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{characterId === -1 ? "All characters" : charName(characterId)}</td>
            <td className="data">{communityExecutionPct(row?.lCancelSuccess ?? null)}</td>
            <td className="data">{communityExecutionPct(row?.groundTechSuccess ?? null)}</td>
            <td className="data">{communityExecutionPct(row?.groundTechInPlace ?? null)}</td>
            <td className="data">{communityExecutionPct(row?.groundTechIn ?? null)}</td>
            <td className="data">{communityExecutionPct(row?.groundTechAway ?? null)}</td>
            <td className="data">{row ? row.games.toLocaleString() : "—"}</td>
            <td className="data">{row ? row.contributors.toLocaleString() : "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function MoveRowView({ row, totalDamage }: { row: CommunityMoveRow; totalDamage: number }) {
  return <tr><td>{moveGroupLabel(row.moveKey)}</td><td className="data">{row.attempts === null || row.attemptGames === 0 ? "—" : num(row.attempts / row.characterGames, 1)}</td><td className="data">{num(row.landed / row.characterGames, 1)}</td><td className="data">{pct(totalDamage ? row.damage / totalDamage : null, 0)}</td><td className="data">{row.landed ? num(row.damage / row.landed, 1) : "—"}</td><td className="data">{int(row.kills)}</td><td className="data">{row.kills ? `${num(row.killPctSum / row.kills, 0)}%` : "—"}</td><td className="data">{row.contributors}</td></tr>;
}

function StageLab({ snapshot }: { snapshot: CommunitySnapshot }) {
  const overall = snapshot.matchups.filter((r) => r.stageId === 0 && r.gameType === "all").sort((a, b) => b.games - a.games);
  const first = overall[0];
  const [characterId, setCharacterId] = useState(first?.characterId ?? -1);
  const opponents = overall.filter((r) => r.characterId === characterId);
  const [opponentId, setOpponentId] = useState(first?.opponentCharacterId ?? -1);
  const rows = snapshot.matchups.filter((r) => r.characterId === characterId && r.opponentCharacterId === opponentId && r.stageId !== 0 && r.gameType === "all").sort((a, b) => b.winRate - a.winRate);
  const chars = selectCharacters(snapshot);
  return (
    <div className="panel">
      <div className="panel-heading-row community-heading-row">
        <div><div className="eyebrow">Stage Lab</div><h2>Where a community matchup bends</h2></div>
        <div className="community-controls"><label>Character<select value={characterId} onChange={(e) => { const id = Number(e.target.value); setCharacterId(id); const next = overall.find((r) => r.characterId === id); if (next) setOpponentId(next.opponentCharacterId); }}>{chars.length === 0 && <option value={-1}>—</option>}{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label><label>Opponent<select value={opponentId} onChange={(e) => setOpponentId(Number(e.target.value))}>{opponents.length === 0 && <option value={-1}>—</option>}{opponents.map((r) => <option key={r.opponentCharacterId} value={r.opponentCharacterId}>{charName(r.opponentCharacterId)}</option>)}</select></label></div>
      </div>
      <div className="stage-lab-list">{rows.length ? rows.map((row) => <article key={row.stageId}><div><b>{stageName(row.stageId)}</b><span>{row.games.toLocaleString()} games · {row.contributors} contributors</span></div><div className="stage-rate"><span style={{ width: `${row.winRate * 100}%`, background: winRateColor(row.winRate) }} /><b>{pct(row.winRate)}</b></div></article>) : INCLUDED_STAGE_IDS.map((stageId) => <article key={stageId} className="community-placeholder"><div><b>{stageName(stageId)}</b><span>— games · — contributors</span></div><div className="stage-rate community-stage-placeholder"><b>—</b></div></article>)}</div>
      <div className="hint">Use this as a field-level counterpick signal, not a ruleset verdict. Player strength and stage-selection habits are not controlled here.</div>
    </div>
  );
}

function CommunityPulse({ snapshot }: { snapshot: CommunitySnapshot }) {
  const months = snapshot.months.map((m) => ({ ...m, label: shortDate(m.month) }));
  const latest = snapshot.months.at(-1);
  return (
    <>
      <div className="kpi-strip">
        <Kpi label="Contributors" value={snapshot.contributorCount.toLocaleString()} />
        <Kpi label="Player-games" value={snapshot.playerGameCount.toLocaleString()} />
        <Kpi label="Qualifying characters" value={snapshot.characters.length.toLocaleString()} />
        <Kpi label="Latest month" value={latest ? latest.playerGames.toLocaleString() : "—"} />
      </div>
      <div className="panel">
        <h2>Qualifying player-games by month</h2>
        {months.length > 1 ? <ResponsiveContainer width="100%" height={240}><LineChart data={months} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}><CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={42} /><YAxis tick={axisStyle} tickLine={false} axisLine={false} /><Tooltip {...tooltipStyle} formatter={(value) => [Number(value).toLocaleString(), "Player-games"]} /><Line type="monotone" dataKey="playerGames" stroke="var(--accent)" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer> : <div className="community-chart-placeholder"><b>—</b><span>A second qualifying month will unlock this trend</span></div>}
        <div className="hint">Months that do not independently clear the contributor and game thresholds are omitted.</div>
      </div>
      <div className="grid-2 community-pulse-grid">
        <div className="panel"><h2>Character share</h2><div className="table-scroll"><table><thead><tr><th>Character</th><th className="data">Player-games</th><th className="data">Win rate</th><th className="data">Contributors</th></tr></thead><tbody>{snapshot.characters.length ? snapshot.characters.map((row) => <tr key={row.characterId}><td>{charName(row.characterId)}</td><td className="data">{row.playerGames.toLocaleString()}</td><td className="data">{pct(row.winRate)}</td><td className="data">{row.contributors}</td></tr>) : <tr className="community-placeholder-row"><td>—</td><td className="data">—</td><td className="data">—</td><td className="data">—</td></tr>}</tbody></table></div></div>
        <div className="panel"><h2>Stage share</h2><div className="table-scroll"><table><thead><tr><th>Stage</th><th className="data">Player-games</th><th className="data">Avg length</th><th className="data">Contributors</th></tr></thead><tbody>{snapshot.stages.length ? snapshot.stages.map((row) => <tr key={row.stageId}><td>{stageName(row.stageId)}</td><td className="data">{row.playerGames.toLocaleString()}</td><td className="data">{duration(row.averageDurationSeconds)}</td><td className="data">{row.contributors}</td></tr>) : <tr className="community-placeholder-row"><td>—</td><td className="data">—</td><td className="data">—</td><td className="data">—</td></tr>}</tbody></table></div></div>
      </div>
    </>
  );
}
