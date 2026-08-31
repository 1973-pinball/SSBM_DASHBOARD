import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ResolvedGame } from "../lib/types";
import {
  demoCommunitySnapshot,
  fetchCommunitySnapshot,
  type CommunityBenchmarkRow,
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

  if (!snapshot) {
    return (
      <div className="panel community-warmup">
        <div className="eyebrow">Community Lab</div>
        <h2>{error ? "Community data is temporarily unavailable" : "Community benchmarks are available on the hosted app"}</h2>
        <p>{error ?? "This local build has no Supabase connection. Your personal dashboard remains fully local."}</p>
      </div>
    );
  }

  const ready = snapshot.contributorCount >= snapshot.minContributors && snapshot.matchups.length > 0;
  if (!ready) {
    const progress = Math.min(100, (snapshot.contributorCount / snapshot.minContributors) * 100);
    return (
      <div className="panel community-warmup">
        <div className="eyebrow">Community Lab</div>
        <h2>Building a privacy-safe sample</h2>
        <p>
          Community views open after at least {snapshot.minContributors} distinct contributors and {snapshot.minGames} player-games
          qualify. Small cohorts stay hidden rather than becoming identifiable.
        </p>
        <div className="community-progress" aria-label={`${snapshot.contributorCount} of ${snapshot.minContributors} contributors`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="community-progress-label">
          <b>{snapshot.contributorCount}</b> / {snapshot.minContributors} contributors
        </div>
        <button className="primary" onClick={onOpenAccount}>Review contribution settings</button>
        {error && <div className="error-note" role="alert">{error}</div>}
      </div>
    );
  }

  return (
    <>
      <div className="community-hero panel">
        <div>
          <div className="eyebrow">Community Lab {snapshot.demo && <span className="tag">demo preview</span>}</div>
          <h2>Learn from the field without exposing the players</h2>
          <p>
            Only thresholded aggregates appear here—never connect codes, names, emails, replay paths, exact activity
            timelines, or row-level downloads. Community controls are independent of your dashboard filters.
          </p>
        </div>
        <div className="community-hero-stats">
          <span><b>{snapshot.contributorCount.toLocaleString()}</b> contributors</span>
          <span><b>{snapshot.playerGameCount.toLocaleString()}</b> player-games</span>
          <span>Refreshed {shortDate(snapshot.refreshedAt)}</span>
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

      {view === "matchups" && <MatchupAtlas snapshot={snapshot} />}
      {view === "benchmarks" && <CommunityBenchmarks snapshot={snapshot} games={games} />}
      {view === "moves" && <MoveAtlas snapshot={snapshot} />}
      {view === "stages" && <StageLab snapshot={snapshot} />}
      {view === "pulse" && <CommunityPulse snapshot={snapshot} />}
    </>
  );
}

function MatchupAtlas({ snapshot }: { snapshot: CommunitySnapshot }) {
  const chars = selectCharacters(snapshot);
  const [characterId, setCharacterId] = useState(chars[0] ?? 20);
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
          <h2>{charName(characterId)} across the qualifying field</h2>
        </div>
        <div className="community-controls">
          <label>Character<select value={characterId} onChange={(e) => setCharacterId(Number(e.target.value))}>{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label>
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
      ) : <div className="empty-note">That slice is suppressed because it does not clear the privacy and sample thresholds.</div>}
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
  if (value === null || !q) return "Not enough local data";
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
      {row ? (
        <div className="benchmark-grid">
          {benchmarkDefs.map((def) => {
            const q = row[def.key];
            const value = own[def.local];
            return (
              <article className="benchmark-card" key={def.key}>
                <div className="community-card-label">{def.label}</div>
                <div className="benchmark-values"><span><small>You</small><b>{value === null ? "—" : `${value.toFixed(def.digits)}${def.suffix}`}</b></span><span><small>Median</small><b>{q ? `${q.p50.toFixed(def.digits)}${def.suffix}` : "—"}</b></span></div>
                <div className="benchmark-range">Middle 50%: {q ? `${q.p25.toFixed(def.digits)}–${q.p75.toFixed(def.digits)}${def.suffix}` : "—"}</div>
                <div className="benchmark-note">{quartileLabel(value, q, def.lowerBetter)}</div>
              </article>
            );
          })}
        </div>
      ) : <div className="empty-note">That character does not yet have a qualifying benchmark cohort.</div>}
      <div className="hint">Your values are computed in this browser and are never sent by this comparison. Community quartiles first average each contributor, so a 30,000-game library cannot overpower everyone else.</div>
    </div>
  );
}

function MoveAtlas({ snapshot }: { snapshot: CommunitySnapshot }) {
  const chars = [...new Set(snapshot.moves.map((m) => m.characterId))].sort((a, b) => charName(a).localeCompare(charName(b)));
  const [characterId, setCharacterId] = useState(chars[0] ?? 20);
  const rows = snapshot.moves.filter((m) => m.characterId === characterId).sort((a, b) => b.damage - a.damage);
  const totalDamage = rows.reduce((sum, r) => sum + r.damage, 0);
  return (
    <div className="panel">
      <div className="panel-heading-row community-heading-row">
        <div><div className="eyebrow">Move Atlas</div><h2>How qualifying {charName(characterId)} players create damage and stocks</h2></div>
        <div className="community-controls"><label>Character<select value={characterId} onChange={(e) => setCharacterId(Number(e.target.value))}>{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label></div>
      </div>
      {rows.length ? (
        <div className="table-scroll"><table><thead><tr><th>Move</th><th className="data">Attempted / game</th><th className="data">Landed / game</th><th className="data">Damage share</th><th className="data">Avg dmg / hit</th><th className="data">Kills</th><th className="data">Avg kill %</th><th className="data">Contributors</th></tr></thead><tbody>
          {rows.map((row) => <MoveRowView key={row.moveKey} row={row} totalDamage={totalDamage} />)}
        </tbody></table></div>
      ) : <div className="empty-note">No move group for this character clears the privacy threshold yet.</div>}
      <div className="hint">Attempt counts include whiffs where replay parsing supports them. Rare moves are suppressed even when the character’s overall cohort qualifies.</div>
    </div>
  );
}

function MoveRowView({ row, totalDamage }: { row: CommunityMoveRow; totalDamage: number }) {
  return <tr><td>{moveGroupLabel(row.moveKey)}</td><td className="data">{row.attempts === null || row.attemptGames === 0 ? "—" : num(row.attempts / row.characterGames, 1)}</td><td className="data">{num(row.landed / row.characterGames, 1)}</td><td className="data">{pct(totalDamage ? row.damage / totalDamage : null, 0)}</td><td className="data">{row.landed ? num(row.damage / row.landed, 1) : "—"}</td><td className="data">{int(row.kills)}</td><td className="data">{row.kills ? `${num(row.killPctSum / row.kills, 0)}%` : "—"}</td><td className="data">{row.contributors}</td></tr>;
}

function StageLab({ snapshot }: { snapshot: CommunitySnapshot }) {
  const overall = snapshot.matchups.filter((r) => r.stageId === 0 && r.gameType === "all").sort((a, b) => b.games - a.games);
  const first = overall[0];
  const [characterId, setCharacterId] = useState(first?.characterId ?? 20);
  const opponents = overall.filter((r) => r.characterId === characterId);
  const [opponentId, setOpponentId] = useState(first?.opponentCharacterId ?? 2);
  const rows = snapshot.matchups.filter((r) => r.characterId === characterId && r.opponentCharacterId === opponentId && r.stageId !== 0 && r.gameType === "all").sort((a, b) => b.winRate - a.winRate);
  const chars = selectCharacters(snapshot);
  return (
    <div className="panel">
      <div className="panel-heading-row community-heading-row">
        <div><div className="eyebrow">Stage Lab</div><h2>Where a community matchup bends</h2></div>
        <div className="community-controls"><label>Character<select value={characterId} onChange={(e) => { const id = Number(e.target.value); setCharacterId(id); const next = overall.find((r) => r.characterId === id); if (next) setOpponentId(next.opponentCharacterId); }}>{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label><label>Opponent<select value={opponentId} onChange={(e) => setOpponentId(Number(e.target.value))}>{opponents.map((r) => <option key={r.opponentCharacterId} value={r.opponentCharacterId}>{charName(r.opponentCharacterId)}</option>)}</select></label></div>
      </div>
      {rows.length ? <div className="stage-lab-list">{rows.map((row) => <article key={row.stageId}><div><b>{stageName(row.stageId)}</b><span>{row.games.toLocaleString()} games · {row.contributors} contributors</span></div><div className="stage-rate"><span style={{ width: `${row.winRate * 100}%`, background: winRateColor(row.winRate) }} /><b>{pct(row.winRate)}</b></div></article>)}</div> : <div className="empty-note">No individual stage clears the threshold for this matchup yet.</div>}
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
        {months.length > 1 ? <ResponsiveContainer width="100%" height={240}><LineChart data={months} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}><CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={42} /><YAxis tick={axisStyle} tickLine={false} axisLine={false} /><Tooltip {...tooltipStyle} formatter={(value) => [Number(value).toLocaleString(), "Player-games"]} /><Line type="monotone" dataKey="playerGames" stroke="var(--accent)" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer> : <div className="empty-note">A second qualifying month is needed for a trend.</div>}
        <div className="hint">Months that do not independently clear the contributor and game thresholds are omitted.</div>
      </div>
      <div className="grid-2 community-pulse-grid">
        <div className="panel"><h2>Character share</h2><div className="table-scroll"><table><thead><tr><th>Character</th><th className="data">Player-games</th><th className="data">Win rate</th><th className="data">Contributors</th></tr></thead><tbody>{snapshot.characters.map((row) => <tr key={row.characterId}><td>{charName(row.characterId)}</td><td className="data">{row.playerGames.toLocaleString()}</td><td className="data">{pct(row.winRate)}</td><td className="data">{row.contributors}</td></tr>)}</tbody></table></div></div>
        <div className="panel"><h2>Stage share</h2><div className="table-scroll"><table><thead><tr><th>Stage</th><th className="data">Player-games</th><th className="data">Avg length</th><th className="data">Contributors</th></tr></thead><tbody>{snapshot.stages.map((row) => <tr key={row.stageId}><td>{stageName(row.stageId)}</td><td className="data">{row.playerGames.toLocaleString()}</td><td className="data">{duration(row.averageDurationSeconds)}</td><td className="data">{row.contributors}</td></tr>)}</tbody></table></div></div>
      </div>
    </>
  );
}
