import { useEffect, useMemo, useState } from "react";
import type { ResolvedGame } from "../lib/types";
import {
  COMMUNITY_MIN_CONTRIBUTORS,
  COMMUNITY_MIN_GAMES,
  demoCommunitySnapshot,
  fetchCommunitySnapshot,
  type CommunityLookbackDays,
  type CommunitySnapshot,
} from "../lib/community";
import { charName, stageName } from "../lib/melee";
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
  const [archiveGames, setArchiveGames] = useState<number | null>(null);
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
      .then(async (dataset) => dataset
        ? { games: dataset.broad_game_count, playerGames: await fetchArchivePlayerGameCount(dataset.id) }
        : null)
      .then((counts) => {
        if (!alive || counts === null) return;
        setArchiveGames(counts.games);
        setArchivePlayerGames(counts.playerGames);
      })
      .catch(() => { /* The Community views remain usable without archive totals. */ });
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="empty-note">Loading anonymous community aggregates…</div>;

  // Demo data is derived synchronously, so use it on the first render instead
  // of mounting placeholder controls that would retain their empty selection.
  const displaySnapshot = snapshot ?? (isDemo ? demo : EMPTY_COMMUNITY_SNAPSHOT);
  const hasSnapshot = snapshot !== null || isDemo;
  const nextMilestone = displaySnapshot.contributorCount < 25
    ? 25
    : displaySnapshot.contributorCount < 100
      ? 100
      : Math.ceil((displaySnapshot.contributorCount + 1) / 100) * 100;
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
          <div className="community-progress-footer">
            <div className="community-progress-label">
              <b>{hasSnapshot ? displaySnapshot.contributorCount.toLocaleString() : "—"}</b> / {nextMilestone.toLocaleString()} SSBM Stats users toward the next milestone ·{" "}
              <b>{hasSnapshot ? displaySnapshot.playerGameCount.toLocaleString() : "—"}</b> opt-in player-games ·{" "}
              <b>{archiveGames === null ? "—" : archiveGames.toLocaleString()}</b> historical games
              {archivePlayerGames === null ? null : <> ({archivePlayerGames.toLocaleString()} player-games)</>}
            </div>
            <button className="primary" onClick={onOpenAccount}>Review contribution settings</button>
          </div>
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

const localGamesInLookback = (games: ResolvedGame[], lookbackDays: CommunityLookbackDays): ResolvedGame[] => {
  if (lookbackDays === null) return games;
  const cutoff = Date.now() - lookbackDays * 86_400_000;
  return games.filter((game) => game.date !== null && game.date.getTime() >= cutoff);
};

const mostPlayedCharacter = (games: ResolvedGame[]): number | null => {
  const counts = new Map<number, number>();
  for (const game of games) counts.set(game.me.characterId, (counts.get(game.me.characterId) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || charName(a[0]).localeCompare(charName(b[0])))[0]?.[0] ?? null;
};

const defaultCharacter = (games: ResolvedGame[], available: number[]): number => {
  const mostPlayed = mostPlayedCharacter(games);
  return mostPlayed !== null && available.includes(mostPlayed) ? mostPlayed : available[0] ?? -1;
};

function MatchupAtlas({ snapshot, games, lookbackDays, onLookbackChange }: { snapshot: CommunitySnapshot; games: ResolvedGame[] } & LookbackProps) {
  const lookbackRows = snapshot.matchups.filter((row) => hasLookback(row, lookbackDays));
  const chars = [...new Set([
    ...lookbackRows.map((row) => row.characterId),
    ...games.map((game) => game.me.characterId),
  ])]
    .sort((a, b) => charName(a).localeCompare(charName(b)));
  const preferredCharacterId = defaultCharacter(games, chars);
  const [characterId, setCharacterId] = useState(preferredCharacterId);
  const selectedCharacterId = chars.includes(characterId) ? characterId : preferredCharacterId;
  const [stageId, setStageId] = useState(0);
  const [gameType, setGameType] = useState("all");
  const rows = lookbackRows
    .filter((r) => r.characterId === selectedCharacterId && r.stageId === stageId && r.gameType === gameType)
    .sort((a, b) => b.games - a.games);
  if (selectedCharacterId < 0) return <div className="panel empty-note">Choose a character to compare matchup samples.</div>;
  return <ArchiveMatchupAtlasComparison
    games={games}
    characterId={selectedCharacterId}
    stageId={stageId}
    gameType={gameType}
    lookbackDays={lookbackDays}
    communityRows={rows}
    onCharacterChange={setCharacterId}
    controls={<>
      <label>Character<select value={selectedCharacterId} onChange={(event) => setCharacterId(Number(event.target.value))}>{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label>
      <label>Stage<select value={stageId} onChange={(event) => setStageId(Number(event.target.value))}><option value={0}>All legal stages</option>{INCLUDED_STAGE_IDS.map((id) => <option key={id} value={id}>{stageName(id)}</option>)}</select></label>
      <label>Mode<select value={gameType} onChange={(event) => setGameType(event.target.value)}>{gameTypes.map((mode) => <option key={mode} value={mode}>{mode === "all" ? "All modes" : mode}</option>)}</select></label>
      <LookbackSelect lookbackDays={lookbackDays} onLookbackChange={onLookbackChange} />
    </>}
  />;
}

function CommunityBenchmarks({ snapshot, games }: { snapshot: CommunitySnapshot; games: ResolvedGame[] }) {
  const chars = useMemo(() => {
    const ids = new Set(selectCharacters(snapshot));
    for (const game of games) ids.add(game.me.characterId);
    return [...ids].sort((a, b) => charName(a).localeCompare(charName(b)));
  }, [games, snapshot]);
  const preferredCharacterId = defaultCharacter(games, chars);
  const [characterId, setCharacterId] = useState(preferredCharacterId);
  const selectedCharacterId = chars.includes(characterId) ? characterId : preferredCharacterId;
  const [lookbackInput, setLookbackInput] = useState("100");
  const parsedLookback = Number(lookbackInput);
  const lookback = Number.isFinite(parsedLookback) && parsedLookback > 0
    ? Math.max(25, Math.round(parsedLookback))
    : 100;
  const row = snapshot.benchmarks.find((item) => item.characterId === selectedCharacterId);
  const communityExecution = snapshot.execution.find((item) => item.lookbackDays === null && item.characterId === selectedCharacterId);
  const communityCharacter = snapshot.characters.find((item) => item.characterId === selectedCharacterId);
  const communityMoves = snapshot.moves.filter((move) => move.lookbackDays === null && move.characterId === selectedCharacterId);
  const selected = useMemo(
    () => {
      const matching = games.filter((game) => game.me.characterId === selectedCharacterId);
      return matching.slice(-lookback);
    },
    [games, lookback, selectedCharacterId],
  );
  return <ArchiveCommunityBenchmark
    games={selected}
    characterId={selectedCharacterId < 0 ? null : selectedCharacterId}
    communityMoves={communityMoves}
    communityBenchmark={row}
    communityExecution={communityExecution}
    communityCharacter={communityCharacter}
    controls={<>
      <label>Character<select value={selectedCharacterId} onChange={(event) => setCharacterId(Number(event.target.value))}>{chars.length === 0 && <option value={-1}>—</option>}{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label>
      <label>
        My games lookback
        <span className="number-suffix unitless">
          <input type="number" min={25} step={25} inputMode="numeric" value={lookbackInput} onChange={(event) => setLookbackInput(event.target.value)} onBlur={() => setLookbackInput(String(lookback))} />
        </span>
      </label>
    </>}
    onCharacterChange={setCharacterId}
  />;
}

function MoveAtlas({ snapshot, games, lookbackDays, onLookbackChange }: { snapshot: CommunitySnapshot; games: ResolvedGame[] } & LookbackProps) {
  const lookbackMoves = snapshot.moves.filter((row) => hasLookback(row, lookbackDays));
  const lookbackExecution = snapshot.execution.filter((row) => hasLookback(row, lookbackDays));
  const chars = [...new Set([
    ...lookbackMoves.map((m) => m.characterId),
    ...lookbackExecution.filter((r) => r.characterId !== -1).map((r) => r.characterId),
    ...games.map((game) => game.me.characterId),
  ])].sort((a, b) => charName(a).localeCompare(charName(b)));
  const preferredCharacterId = defaultCharacter(games, chars);
  const [characterId, setCharacterId] = useState(preferredCharacterId);
  const selectedCharacterId = chars.includes(characterId) ? characterId : preferredCharacterId;
  const rows = lookbackMoves.filter((m) => m.characterId === selectedCharacterId).sort((a, b) => b.damage - a.damage);
  const execution = lookbackExecution.find((row) => row.characterId === selectedCharacterId);
  const benchmark = snapshot.benchmarks.find((row) => row.characterId === selectedCharacterId);
  if (selectedCharacterId < 0) return <div className="panel empty-note">Choose a character to compare move samples.</div>;
  return <ArchiveMoveAtlasComparison
    games={games}
    characterId={selectedCharacterId}
    lookbackDays={lookbackDays}
    communityRows={rows}
    communityExecution={execution}
    communityBenchmark={benchmark}
    onCharacterChange={setCharacterId}
    controls={<>
      <label>Character<select value={selectedCharacterId} onChange={(event) => setCharacterId(Number(event.target.value))}>{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label>
      <LookbackSelect lookbackDays={lookbackDays} onLookbackChange={onLookbackChange} />
    </>}
  />;
}

function StageLab({ snapshot, games, lookbackDays, onLookbackChange }: { snapshot: CommunitySnapshot; games: ResolvedGame[] } & LookbackProps) {
  const overall = snapshot.matchups.filter((r) => hasLookback(r, lookbackDays) && r.stageId === 0 && r.gameType === "all").sort((a, b) => b.games - a.games);
  const localGames = localGamesInLookback(games, lookbackDays);
  const chars = [...new Set([
    ...overall.map((row) => row.characterId),
    ...localGames.map((game) => game.me.characterId),
  ])]
    .sort((a, b) => charName(a).localeCompare(charName(b)));
  const preferredCharacterId = defaultCharacter(games, chars);
  const [characterId, setCharacterId] = useState(preferredCharacterId);
  const selectedCharacterId = chars.includes(characterId) ? characterId : preferredCharacterId;
  const communityOpponents = overall.filter((r) => r.characterId === selectedCharacterId);
  const opponentIds = [...new Set([
    ...communityOpponents.map((row) => row.opponentCharacterId),
    ...localGames.filter((game) => game.me.characterId === selectedCharacterId).map((game) => game.opp.characterId),
  ])].sort((a, b) => charName(a).localeCompare(charName(b)));
  const [opponentId, setOpponentId] = useState<number | null>(null);
  const selectedOpponentId = opponentId === null || opponentIds.includes(opponentId)
    ? opponentId
    : null;
  const rows = snapshot.matchups.filter((r) => hasLookback(r, lookbackDays)
    && r.characterId === selectedCharacterId
    && (selectedOpponentId === null || r.opponentCharacterId === selectedOpponentId)
    && r.stageId !== 0
    && r.gameType === "all");
  if (selectedCharacterId < 0) return <div className="panel empty-note">Choose a character to compare stage samples.</div>;
  return <ArchiveStageAtlasComparison
    games={games}
    characterId={selectedCharacterId}
    opponentId={selectedOpponentId}
    lookbackDays={lookbackDays}
    communityRows={rows}
    onCharacterChange={(id) => {
      setCharacterId(id);
      if (selectedOpponentId === null) return;
      const nextCommunity = overall.find((row) => row.characterId === id)?.opponentCharacterId;
      const nextLocal = localGames.find((game) => game.me.characterId === id)?.opp.characterId;
      setOpponentId(nextCommunity ?? nextLocal ?? null);
    }}
    controls={<>
      <label>Character<select value={selectedCharacterId} onChange={(event) => { const id = Number(event.target.value); setCharacterId(id); if (selectedOpponentId === null) return; const nextCommunity = overall.find((row) => row.characterId === id)?.opponentCharacterId; const nextLocal = localGames.find((game) => game.me.characterId === id)?.opp.characterId; setOpponentId(nextCommunity ?? nextLocal ?? null); }}>{chars.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label>
      <label>Opponent<select value={selectedOpponentId ?? "all"} onChange={(event) => setOpponentId(event.target.value === "all" ? null : Number(event.target.value))}><option value="all">All opponents</option>{opponentIds.map((id) => <option key={id} value={id}>{charName(id)}</option>)}</select></label>
      <LookbackSelect lookbackDays={lookbackDays} onLookbackChange={onLookbackChange} />
    </>}
  />;
}
