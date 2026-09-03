import { useEffect, useMemo, useState } from "react";
import type { ResolvedGame } from "../lib/types";
import {
  COMMUNITY_MIN_CONTRIBUTORS,
  COMMUNITY_MIN_GAMES,
  demoCommunitySnapshot,
  fetchCommunitySnapshot,
  type CommunityBenchmarkRow,
  type CommunityExecutionRow,
  type CommunityLookbackDays,
  type CommunityMoveRow,
  type CommunitySnapshot,
  type Quartiles,
} from "../lib/community";
import { executionSummary, type ExecutionSummary } from "../lib/stats";
import { charName, moveGroupLabel, stageName } from "../lib/melee";
import { int, num, pct, winRateColor } from "../lib/format";
import { INCLUDED_STAGE_IDS } from "../lib/config";
import { moveTabFocus } from "../lib/a11y";
import { fetchArchivePlayerGameCount, fetchLatestArchiveDataset } from "../lib/publicArchive";
import { ArchiveCommunityBenchmark } from "./ArchiveCommunityBenchmark";
import {
  ArchiveMatchupAtlasComparison,
  ArchiveMoveAtlasComparison,
  ArchiveStageAtlasComparison,
} from "./CommunityArchiveAtlas";

type CommunityView = "atlas" | "benchmarks";

const VIEWS: { id: CommunityView; label: string }[] = [
  { id: "atlas", label: "Atlas" },
  { id: "benchmarks", label: "You vs Community" },
];

const gameTypes = ["all", "ranked", "unranked", "direct", "offline"];

const LOOKBACK_OPTIONS: { value: CommunityLookbackDays; label: string }[] = [
  { value: 30, label: "1 month" },
  { value: 90, label: "3 months" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
  { value: null, label: "Max" },
];

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
  const [view, setView] = useState<CommunityView>("atlas");
  const [lookbackDays, setLookbackDays] = useState<CommunityLookbackDays>(null);
  const [snapshot, setSnapshot] = useState<CommunitySnapshot | null>(null);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);
  const [archivePlayerGames, setArchivePlayerGames] = useState<number | null>(null);
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

  useEffect(() => {
    let alive = true;
    void fetchLatestArchiveDataset()
      .then((dataset) => dataset ? fetchArchivePlayerGameCount(dataset.id) : null)
      .then((count) => { if (alive && count !== null) setArchivePlayerGames(count); })
      .catch(() => { /* The Community views remain usable without archive totals. */ });
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="empty-note">Loading anonymous community aggregates…</div>;

  // Demo data is derived synchronously, so use it on the first render instead
  // of mounting placeholder controls that would retain their empty selection.
  const displaySnapshot = snapshot ?? (isDemo ? demo : EMPTY_COMMUNITY_SNAPSHOT);
  const hasSnapshot = snapshot !== null || isDemo;
  const nextMilestone = Math.max(25, Math.ceil((displaySnapshot.contributorCount + 1) / 25) * 25);
  const progress = Math.min(100, (displaySnapshot.contributorCount / nextMilestone) * 100);

  return (
    <>
      <div className="panel community-warmup community-preview-progress">
          <div className="eyebrow">Community Lab · SSBM Stats growth</div>
          <h2>See the community sample grow</h2>
          <p>
            These counts are informational, not unlock requirements. Opt-in SSBM Stats contributions and the
            historical tournament archive remain separate comparison samples throughout the Community section.
          </p>
          <div
            className="community-progress"
            aria-label={`${displaySnapshot.contributorCount} of ${nextMilestone} contributors toward the next milestone`}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="community-progress-label">
            <b>{hasSnapshot ? displaySnapshot.contributorCount.toLocaleString() : "—"}</b> / {nextMilestone.toLocaleString()} SSBM Stats users toward the next milestone ·{" "}
            <b>{hasSnapshot ? displaySnapshot.playerGameCount.toLocaleString() : "—"}</b> opt-in player-games ·{" "}
            <b>{archivePlayerGames === null ? "—" : archivePlayerGames.toLocaleString()}</b> historical tournament player-games
          </div>
          <button className="primary" onClick={onOpenAccount}>Review contribution settings</button>
          {error && <div className="error-note" role="alert">{error}</div>}
      </div>

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

      {view === "atlas" && <>
        <MatchupAtlas snapshot={displaySnapshot} games={games} lookbackDays={lookbackDays} onLookbackChange={setLookbackDays} />
        <StageLab snapshot={displaySnapshot} games={games} lookbackDays={lookbackDays} onLookbackChange={setLookbackDays} />
        <MoveAtlas snapshot={displaySnapshot} games={games} lookbackDays={lookbackDays} onLookbackChange={setLookbackDays} />
      </>}
      {view === "benchmarks" && <CommunityBenchmarks snapshot={displaySnapshot} games={games} />}
    </>
  );
}

interface LookbackProps {
  lookbackDays: CommunityLookbackDays;
  onLookbackChange: (days: CommunityLookbackDays) => void;
}

function LookbackSelect({ lookbackDays, onLookbackChange }: LookbackProps) {
  return (
    <label>
      Days lookback
      <select
        value={lookbackDays ?? "max"}
        onChange={(event) => {
          const value = event.target.value;
          onLookbackChange(value === "max" ? null : Number(value) as CommunityLookbackDays);
        }}
      >
        {LOOKBACK_OPTIONS.map((option) => (
          <option key={option.value ?? "max"} value={option.value ?? "max"}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

const hasLookback = (row: { lookbackDays: CommunityLookbackDays }, lookbackDays: CommunityLookbackDays): boolean =>
  row.lookbackDays === lookbackDays;

function MatchupAtlas({ snapshot, games, lookbackDays, onLookbackChange }: { snapshot: CommunitySnapshot; games: ResolvedGame[] } & LookbackProps) {
  const lookbackRows = snapshot.matchups.filter((row) => hasLookback(row, lookbackDays));
  const chars = [...new Set(lookbackRows.map((row) => row.characterId))]
    .sort((a, b) => charName(a).localeCompare(charName(b)));
  const [characterId, setCharacterId] = useState(chars[0] ?? -1);
  const selectedCharacterId = chars.includes(characterId) ? characterId : chars[0] ?? -1;
  const [stageId, setStageId] = useState(0);
  const [gameType, setGameType] = useState("all");
  const rows = lookbackRows
    .filter((r) => r.characterId === selectedCharacterId && r.stageId === stageId && r.gameType === gameType)
    .sort((a, b) => b.games - a.games);
  return (
    <>
      <div className="panel">
      <div className="panel-heading-row community-heading-row">
        <div>
          <div className="eyebrow">Matchup Atlas</div>
          <h2>{selectedCharacterId === -1 ? "Character matchups across the qualifying field" : `${charName(selectedCharacterId)} across the qualifying field`}</h2>
        </div>
        <div className="community-controls">
          <label>Character<select value={selectedCharacterId} onChange={(e) => setCharacterId(Number(e.target.value))}>{chars.length === 0 && <option value={-1}>—</option>}{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label>
          <label>Stage<select value={stageId} onChange={(e) => setStageId(Number(e.target.value))}><option value={0}>All legal stages</option>{INCLUDED_STAGE_IDS.map((id) => <option key={id} value={id}>{stageName(id)}</option>)}</select></label>
          <label>Mode<select value={gameType} onChange={(e) => setGameType(e.target.value)}>{gameTypes.map((mode) => <option key={mode} value={mode}>{mode === "all" ? "All modes" : mode}</option>)}</select></label>
          <LookbackSelect lookbackDays={lookbackDays} onLookbackChange={onLookbackChange} />
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
      {selectedCharacterId >= 0 && <ArchiveMatchupAtlasComparison
        games={games}
        characterId={selectedCharacterId}
        stageId={stageId}
        gameType={gameType}
        lookbackDays={lookbackDays}
        communityRows={rows}
      />}
    </>
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

type DifferenceDirection = "above" | "below" | null;

const differenceClass = (direction: DifferenceDirection): string => direction ? `community-diff-${direction}` : "";
const differenceTitle = (direction: DifferenceDirection): string | undefined =>
  direction ? `Large difference: ${direction} the field` : undefined;

function largeDifference(
  mine: number | null | undefined,
  field: number | null | undefined,
  minimumGap: number,
  relativeGap = 0,
): DifferenceDirection {
  if (mine === null || mine === undefined || field === null || field === undefined) return null;
  const gap = mine - field;
  if (Math.abs(gap) < Math.max(minimumGap, Math.abs(field) * relativeGap)) return null;
  return gap > 0 ? "above" : "below";
}

function quartileDifference(value: number | null, q: Quartiles | null, games: number): DifferenceDirection {
  if (games < 10 || value === null || q === null) return null;
  if (value > q.p75) return "above";
  if (value < q.p25) return "below";
  return null;
}

function CommunityBenchmarks({ snapshot, games }: { snapshot: CommunitySnapshot; games: ResolvedGame[] }) {
  const chars = useMemo(() => {
    const ids = new Set(selectCharacters(snapshot));
    for (const game of games) ids.add(game.me.characterId);
    return [-1, ...[...ids].sort((a, b) => charName(a).localeCompare(charName(b)))];
  }, [games, snapshot]);
  const [characterId, setCharacterId] = useState(-1);
  const [lookbackInput, setLookbackInput] = useState("100");
  const parsedLookback = Number(lookbackInput);
  const lookback = Number.isFinite(parsedLookback) && parsedLookback > 0
    ? Math.max(25, Math.round(parsedLookback))
    : 100;
  const row = snapshot.benchmarks.find((b) => b.characterId === characterId);
  const communityExecution = snapshot.execution.find((item) => item.lookbackDays === null && item.characterId === characterId);
  const communityMoves = characterId === -1
    ? []
    : snapshot.moves.filter((move) => move.lookbackDays === null && move.characterId === characterId);
  const selected = useMemo(
    () => {
      const matching = characterId === -1 ? games : games.filter((game) => game.me.characterId === characterId);
      return matching.slice(-lookback);
    },
    [characterId, games, lookback],
  );
  const own = useMemo(() => executionSummary(selected, Number.MAX_SAFE_INTEGER), [selected]);
  return (
    <>
      <div className="panel">
      <div className="panel-heading-row community-heading-row">
        <div><div className="eyebrow">You vs Community</div><h2>Your character compared with the qualifying field</h2></div>
        <div className="community-controls">
          <label>Character<select value={characterId} onChange={(e) => setCharacterId(Number(e.target.value))}>{chars.map((id) => <option key={id} value={id}>{id === -1 ? "All characters" : charName(id)}</option>)}</select></label>
          <label>
            My games lookback
            <span className="number-suffix unitless">
              <input type="number" min={25} step={25} inputMode="numeric" value={lookbackInput} onChange={(e) => setLookbackInput(e.target.value)} onBlur={() => setLookbackInput(String(lookback))} />
            </span>
          </label>
        </div>
      </div>

      <h3 className="table-subhead community-table-subhead">Headline execution</h3>
      <div className="benchmark-grid">
        {benchmarkDefs.map((def) => {
          const q = row?.[def.key] ?? null;
          const value = own[def.local];
          const direction = quartileDifference(value, q, own.games);
          return (
            <article className={`benchmark-card ${q ? "" : "community-placeholder"}`} key={def.key}>
              <div className="community-card-label">{def.label}</div>
              <div className="benchmark-values"><span className={differenceClass(direction)} title={differenceTitle(direction)}><small>You</small><b>{value === null ? "—" : `${value.toFixed(def.digits)}${def.suffix}`}</b></span><span><small>Median</small><b>{q ? `${q.p50.toFixed(def.digits)}${def.suffix}` : "—"}</b></span></div>
              <div className="benchmark-range">Middle 50%: {q ? `${q.p25.toFixed(def.digits)}–${q.p75.toFixed(def.digits)}${def.suffix}` : "—"}</div>
              <div className="benchmark-note">{quartileLabel(value, q, def.lowerBetter)}</div>
            </article>
          );
        })}
      </div>

      <h3 className="table-subhead community-table-subhead">Tech profile</h3>
      <CommunityTechComparison community={communityExecution} own={own} />

      <div className="hint">Your values use the most recent {own.games.toLocaleString()} matching games in the selected lookback, are computed in this browser, and are never sent by this comparison. The field side stays on the full qualifying aggregate. Community quartiles first average each contributor, so a 30,000-game library cannot overpower everyone else. Gold marks meaningfully above the field; violet marks meaningfully below. Direction is descriptive, not a quality judgment, and highlights require at least 10 local games. A dash means that side has not cleared the required data threshold.</div>
      </div>
      <ArchiveCommunityBenchmark games={selected} characterId={characterId === -1 ? null : characterId} communityMoves={communityMoves} />
    </>
  );
}

function CommunityTechComparison({ community, own }: { community: CommunityExecutionRow | undefined; own: ExecutionSummary }) {
  const ownTechCell = (value: number | null, field: number | null | undefined) => {
    const direction = own.games >= 10 ? largeDifference(value, field, 10) : null;
    return <td className={`data ${differenceClass(direction)}`} title={differenceTitle(direction)}>{communityExecutionPct(value)}</td>;
  };
  return (
    <div className="table-scroll community-comparison-table">
      <table>
        <thead><tr><th>Cohort</th><th className="data">Ground tech success</th><th className="data">In-place</th><th className="data">In</th><th className="data">Away</th><th className="data">Player-games</th><th className="data">Contributors</th></tr></thead>
        <tbody>
          <tr className="community-own-row"><td>You</td>{ownTechCell(own.groundTechSuccess, community?.groundTechSuccess)}{ownTechCell(own.groundTechInPlace, community?.groundTechInPlace)}{ownTechCell(own.groundTechIn, community?.groundTechIn)}{ownTechCell(own.groundTechAway, community?.groundTechAway)}<td className="data">{own.games.toLocaleString()}</td><td className="data">{own.games > 0 ? "1" : "—"}</td></tr>
          <tr><td>Community</td><td className="data">{communityExecutionPct(community?.groundTechSuccess ?? null)}</td><td className="data">{communityExecutionPct(community?.groundTechInPlace ?? null)}</td><td className="data">{communityExecutionPct(community?.groundTechIn ?? null)}</td><td className="data">{communityExecutionPct(community?.groundTechAway ?? null)}</td><td className="data">{community ? community.games.toLocaleString() : "—"}</td><td className="data">{community ? community.contributors.toLocaleString() : "—"}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function MoveAtlas({ snapshot, games, lookbackDays, onLookbackChange }: { snapshot: CommunitySnapshot; games: ResolvedGame[] } & LookbackProps) {
  const lookbackMoves = snapshot.moves.filter((row) => hasLookback(row, lookbackDays));
  const lookbackExecution = snapshot.execution.filter((row) => hasLookback(row, lookbackDays));
  const chars = [...new Set([
    ...lookbackMoves.map((m) => m.characterId),
    ...lookbackExecution.filter((r) => r.characterId !== -1).map((r) => r.characterId),
  ])].sort((a, b) => charName(a).localeCompare(charName(b)));
  const [characterId, setCharacterId] = useState(chars[0] ?? -1);
  const selectedCharacterId = characterId === -1 || chars.includes(characterId) ? characterId : chars[0] ?? -1;
  const rows = lookbackMoves.filter((m) => m.characterId === selectedCharacterId).sort((a, b) => b.damage - a.damage);
  const execution = lookbackExecution.find((r) => r.characterId === selectedCharacterId);
  const totalDamage = rows.reduce((sum, r) => sum + r.damage, 0);
  const cohort = selectedCharacterId === -1 ? "the qualifying field" : `qualifying ${charName(selectedCharacterId)} players`;
  return (
    <>
      <div className="panel">
      <div className="panel-heading-row community-heading-row">
        <div><div className="eyebrow">Move Atlas</div><h2>How {cohort} execute and create openings</h2></div>
        <div className="community-controls"><label>Character<select value={selectedCharacterId} onChange={(e) => setCharacterId(Number(e.target.value))}><option value={-1}>All characters</option>{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label><LookbackSelect lookbackDays={lookbackDays} onLookbackChange={onLookbackChange} /></div>
      </div>

      <h3 className="table-subhead community-table-subhead">Execution profile</h3>
      <CommunityExecutionTable row={execution} characterId={selectedCharacterId} />

      <h3 className="table-subhead community-table-subhead">Move effectiveness</h3>
      <div className="table-scroll"><table><thead><tr><th>Move</th><th className="data">Attempted / game</th><th className="data">Landed / game</th><th className="data">Damage share</th><th className="data">Avg dmg / hit</th><th className="data">Kills</th><th className="data">Avg kill %</th><th className="data">Contributors</th></tr></thead><tbody>
        {rows.length ? rows.map((row) => <MoveRowView key={row.moveKey} row={row} totalDamage={totalDamage} />) : (
          <tr className="community-placeholder-row"><td>—</td>{Array.from({ length: 7 }, (_, index) => <td key={index} className="data">—</td>)}</tr>
        )}
      </tbody></table></div>
      <div className="hint">Execution rates are attempt-weighted across current-stat player-games. Ground-tech direction is the share of successful ground techs, so in-place + in + away totals 100%. Attempt counts include whiffs where replay parsing supports them; rare moves stay suppressed even when a character’s overall cohort qualifies.</div>
      </div>
      {selectedCharacterId >= 0 && <ArchiveMoveAtlasComparison
        games={games}
        characterId={selectedCharacterId}
        lookbackDays={lookbackDays}
        communityRows={rows}
      />}
    </>
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

function StageLab({ snapshot, games, lookbackDays, onLookbackChange }: { snapshot: CommunitySnapshot; games: ResolvedGame[] } & LookbackProps) {
  const overall = snapshot.matchups.filter((r) => hasLookback(r, lookbackDays) && r.stageId === 0 && r.gameType === "all").sort((a, b) => b.games - a.games);
  const first = overall[0];
  const [characterId, setCharacterId] = useState(first?.characterId ?? -1);
  const chars = [...new Set(overall.map((row) => row.characterId))]
    .sort((a, b) => charName(a).localeCompare(charName(b)));
  const selectedCharacterId = chars.includes(characterId) ? characterId : first?.characterId ?? -1;
  const opponents = overall.filter((r) => r.characterId === selectedCharacterId);
  const [opponentId, setOpponentId] = useState(first?.opponentCharacterId ?? -1);
  const selectedOpponentId = opponents.some((row) => row.opponentCharacterId === opponentId)
    ? opponentId
    : opponents[0]?.opponentCharacterId ?? -1;
  const rows = snapshot.matchups.filter((r) => hasLookback(r, lookbackDays) && r.characterId === selectedCharacterId && r.opponentCharacterId === selectedOpponentId && r.stageId !== 0 && r.gameType === "all").sort((a, b) => b.winRate - a.winRate);
  return (
    <>
      <div className="panel">
      <div className="panel-heading-row community-heading-row">
        <div><div className="eyebrow">Stage Lab</div><h2>Where a community matchup bends</h2></div>
        <div className="community-controls"><label>Character<select value={selectedCharacterId} onChange={(e) => { const id = Number(e.target.value); setCharacterId(id); const next = overall.find((r) => r.characterId === id); if (next) setOpponentId(next.opponentCharacterId); }}>{chars.length === 0 && <option value={-1}>—</option>}{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label><label>Opponent<select value={selectedOpponentId} onChange={(e) => setOpponentId(Number(e.target.value))}>{opponents.length === 0 && <option value={-1}>—</option>}{opponents.map((r) => <option key={r.opponentCharacterId} value={r.opponentCharacterId}>{charName(r.opponentCharacterId)}</option>)}</select></label><LookbackSelect lookbackDays={lookbackDays} onLookbackChange={onLookbackChange} /></div>
      </div>
      <div className="stage-lab-list">{rows.length ? rows.map((row) => <article key={row.stageId}><div><b>{stageName(row.stageId)}</b><span>{row.games.toLocaleString()} games · {row.contributors} contributors</span></div><div className="stage-rate"><span style={{ width: `${row.winRate * 100}%`, background: winRateColor(row.winRate) }} /><b>{pct(row.winRate)}</b></div></article>) : INCLUDED_STAGE_IDS.map((stageId) => <article key={stageId} className="community-placeholder"><div><b>{stageName(stageId)}</b><span>— games · — contributors</span></div><div className="stage-rate community-stage-placeholder"><b>—</b></div></article>)}</div>
      <div className="hint">Use this as a field-level counterpick signal, not a ruleset verdict. Player strength and stage-selection habits are not controlled here.</div>
      </div>
      {selectedCharacterId >= 0 && selectedOpponentId >= 0 && <ArchiveStageAtlasComparison
        games={games}
        characterId={selectedCharacterId}
        opponentId={selectedOpponentId}
        lookbackDays={lookbackDays}
        communityRows={rows}
      />}
    </>
  );
}
