import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  CommunityLookbackDays,
  CommunityMatchupRow,
  CommunityMoveRow,
} from "../lib/community";
import { INCLUDED_STAGE_IDS } from "../lib/config";
import { num, pct, shortDate, winRateColor } from "../lib/format";
import { charName, moveGroup, moveGroupLabel, stageName } from "../lib/melee";
import {
  fetchArchiveCommunityAtlasRows,
  fetchArchiveCommunityProOptions,
  fetchArchiveProAggregateAtlasRows,
  fetchArchivePlayerAtlasRows,
  fetchLatestArchiveDataset,
  type ArchiveDataset,
  type ArchiveMoveMetrics,
  type ArchiveProOption,
  type ArchiveRollup,
} from "../lib/publicArchive";
import { moveTable } from "../lib/stats";
import type { ResolvedGame } from "../lib/types";
import "./ArchiveCommunityBenchmark.css";

interface ArchiveAtlasState {
  dataset: ArchiveDataset | null;
  pros: ArchiveProOption[];
  fieldRows: ArchiveRollup[];
  proAggregateRows: ArchiveRollup[];
  proRows: ArchiveRollup[];
  characterPros: ArchiveProOption[];
  selectedPro: ArchiveProOption | null;
  playerId: string | null;
  setPlayerId: (value: string | null) => void;
  loading: boolean;
  error: string | null;
}

function useArchiveAtlas(characterId: number): ArchiveAtlasState {
  const [dataset, setDataset] = useState<ArchiveDataset | null>(null);
  const [pros, setPros] = useState<ArchiveProOption[]>([]);
  const [fieldRows, setFieldRows] = useState<ArchiveRollup[]>([]);
  const [proAggregateRows, setProAggregateRows] = useState<ArchiveRollup[]>([]);
  const [proRows, setProRows] = useState<ArchiveRollup[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCatalogLoading(true);
    void fetchLatestArchiveDataset()
      .then(async (nextDataset) => {
        if (!alive) return;
        setDataset(nextDataset);
        if (!nextDataset) {
          setError("No historical tournament archive is published yet.");
          return;
        }
        const nextPros = await fetchArchiveCommunityProOptions(nextDataset.id);
        if (alive) setPros(nextPros);
      })
      .catch(() => { if (alive) setError("Historical tournament comparisons are temporarily unavailable."); })
      .finally(() => { if (alive) setCatalogLoading(false); });
    return () => { alive = false; };
  }, []);

  const characterPros = useMemo(
    () => pros.filter((player) => player.observed_character_ids.includes(characterId)),
    [characterId, pros],
  );

  useEffect(() => {
    if (playerId && !characterPros.some((player) => player.id === playerId)) setPlayerId(null);
  }, [characterPros, playerId]);

  useEffect(() => {
    if (!dataset || characterId < 0) {
      setFieldRows([]);
      setProAggregateRows([]);
      return;
    }
    let alive = true;
    setRowsLoading(true);
    void Promise.all([
      fetchArchiveCommunityAtlasRows(dataset.id, characterId),
      fetchArchiveProAggregateAtlasRows(dataset.id, characterId),
    ])
      .then(([rows, proAggregate]) => { if (alive) { setFieldRows(rows); setProAggregateRows(proAggregate); setError(null); } })
      .catch(() => { if (alive) { setFieldRows([]); setProAggregateRows([]); setError("Historical tournament comparisons are temporarily unavailable."); } })
      .finally(() => { if (alive) setRowsLoading(false); });
    return () => { alive = false; };
  }, [characterId, dataset]);

  useEffect(() => {
    if (!dataset || characterId < 0 || !playerId) {
      setProRows([]);
      return;
    }
    let alive = true;
    void fetchArchivePlayerAtlasRows(dataset.id, playerId, characterId)
      .then((rows) => { if (alive) setProRows(rows); })
      .catch(() => { if (alive) setProRows([]); });
    return () => { alive = false; };
  }, [characterId, dataset, playerId]);

  return {
    dataset,
    pros,
    fieldRows,
    proAggregateRows,
    proRows,
    characterPros,
    selectedPro: characterPros.find((player) => player.id === playerId) ?? null,
    playerId,
    setPlayerId,
    loading: catalogLoading || rowsLoading,
    error,
  };
}

function localLookback(games: ResolvedGame[], days: CommunityLookbackDays): ResolvedGame[] {
  if (days === null) return games;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1_000;
  return games.filter((game) => game.date !== null && game.date.getTime() >= cutoff);
}

function ProControl({ archive, onCharacterChange }: { archive: ArchiveAtlasState; onCharacterChange?: (characterId: number) => void }) {
  return (
    <label>
      Named Top 100 player
      <select
        value={archive.playerId ?? "none"}
        disabled={archive.pros.length === 0}
        onChange={(event) => {
          const nextId = event.target.value === "none" ? null : event.target.value;
          archive.setPlayerId(nextId);
          const player = archive.pros.find((option) => option.id === nextId);
          if (player) onCharacterChange?.(player.primary_character_id);
        }}
      >
        <option value="none">No pro comparison</option>
        {archive.pros.map((player) => (
          <option key={player.id} value={player.id}>
            {player.display_name} · {charName(player.primary_character_id)} · #{player.latest_ranking.rank} {player.latest_ranking.edition_year}
          </option>
        ))}
      </select>
    </label>
  );
}

function ArchiveFrame({
  archive,
  eyebrow,
  title,
  controls,
  onCharacterChange,
  children,
}: {
  archive: ArchiveAtlasState;
  eyebrow: string;
  title: string;
  controls?: ReactNode;
  onCharacterChange?: (characterId: number) => void;
  children: ReactNode;
}) {
  return (
    <section className="panel acb-panel community-atlas-archive">
      <div className="panel-heading-row acb-heading">
        <div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>
        <div className="community-controls">
          {controls}
          <ProControl archive={archive} onCharacterChange={onCharacterChange} />
        </div>
      </div>
      {archive.loading && archive.fieldRows.length === 0 ? <div className="empty-note">Loading historical tournament comparisons…</div> : archive.error ? <div className="acb-error" role="status">{archive.error}</div> : children}
      <div className="acb-separation-note">
        “SSBM Stats” is the opt-in user cohort. “Venue archive” includes usable event-associated games;
        “Tournament archive” includes only conservatively curated tournament games. Pro rows use only externally
        resolved Top-100 identities. Your values are computed locally and are not uploaded by this view.
      </div>
      {archive.dataset && <div className="hint">
        Sources: <a href={archive.dataset.source_url} target="_blank" rel="noreferrer">{archive.dataset.source_label}</a> · derived snapshot {shortDate(archive.dataset.data_as_of)};
        {" "}<a href="https://liquipedia.net/smash/SSBMRank" target="_blank" rel="noreferrer">Liquipedia SSBMRank history</a> for player names and rankings
        {" "}(<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a>).
      </div>}
    </section>
  );
}

interface RateSummary {
  wins: number;
  decided: number;
  games: number;
  contributors?: number;
}

const rateSummary = (row: ArchiveRollup | undefined): RateSummary | null => row ? {
  wins: row.wins,
  decided: row.win_rate_game_count,
  games: row.game_count,
} : null;

function RateCell({ value }: { value: RateSummary | null | undefined }) {
  if (!value || value.decided === 0) return <td className="data atlas-rate-cell">—</td>;
  const rate = value.wins / value.decided;
  return (
    <td className={`data atlas-rate-cell ${value.games < 10 ? "atlas-low-sample" : ""}`}>
      <b style={{ color: winRateColor(rate) }}>{pct(rate)}</b>
      <span className="sample-note">{value.games.toLocaleString()} games{value.contributors === undefined ? "" : ` · ${value.contributors.toLocaleString()} users`}</span>
    </td>
  );
}

function archiveRateMap(rows: ArchiveRollup[], population: "broad" | "conservative", stageId: number | null) {
  return new Map(rows
    .filter((row) => row.population === population && row.opponent_character_id !== null && row.stage_id === stageId)
    .map((row) => [row.opponent_character_id!, rateSummary(row)!]));
}

export function ArchiveMatchupAtlasComparison({
  games,
  characterId,
  stageId,
  gameType,
  lookbackDays,
  communityRows,
  controls,
  onCharacterChange,
}: {
  games: ResolvedGame[];
  characterId: number;
  stageId: number;
  gameType: string;
  lookbackDays: CommunityLookbackDays;
  communityRows: CommunityMatchupRow[];
  controls?: ReactNode;
  onCharacterChange?: (characterId: number) => void;
}) {
  const archive = useArchiveAtlas(characterId);
  const local = useMemo(() => {
    const rows = new Map<number, RateSummary>();
    for (const game of localLookback(games, lookbackDays)) {
      if (game.me.characterId !== characterId || (stageId !== 0 && game.rec.stageId !== stageId)) continue;
      if (gameType !== "all" && game.rec.gameType !== gameType) continue;
      const row = rows.get(game.opp.characterId) ?? { wins: 0, decided: 0, games: 0 };
      row.games++;
      if (game.isWin !== null) { row.decided++; if (game.isWin) row.wins++; }
      rows.set(game.opp.characterId, row);
    }
    return rows;
  }, [characterId, gameType, games, lookbackDays, stageId]);
  const community = new Map(communityRows.map((row) => [row.opponentCharacterId, {
    wins: row.wins,
    decided: row.games,
    games: row.games,
    contributors: row.contributors,
  }]));
  const archiveStage = stageId === 0 ? null : stageId;
  const broad = archiveRateMap(archive.fieldRows, "broad", archiveStage);
  const conservative = archiveRateMap(archive.fieldRows, "conservative", archiveStage);
  const proAggregate = archiveRateMap(archive.proAggregateRows, "conservative", archiveStage);
  const pro = archiveRateMap(archive.proRows, "conservative", archiveStage);
  const opponents = [...new Set([...local.keys(), ...community.keys(), ...broad.keys(), ...conservative.keys(), ...proAggregate.keys(), ...pro.keys()])]
    .sort((a, b) => Math.max(conservative.get(b)?.games ?? 0, community.get(b)?.games ?? 0) - Math.max(conservative.get(a)?.games ?? 0, community.get(a)?.games ?? 0));

  return (
    <ArchiveFrame archive={archive} eyebrow="Matchup Atlas" title={`Your ${charName(characterId)} matchups across the full field`} controls={controls} onCharacterChange={onCharacterChange}>
      {opponents.length ? <div className="table-scroll"><table><thead><tr><th>Opponent</th><th className="data">You</th><th className="data">SSBM Stats</th><th className="data">Venue archive</th><th className="data">Tournament archive</th><th className="data">Pro tournament archive</th>{archive.selectedPro && <th className="data">{archive.selectedPro.display_name}</th>}</tr></thead><tbody>
        {opponents.map((opponentId) => <tr key={opponentId}><td>{charName(opponentId)}</td><RateCell value={local.get(opponentId)} /><RateCell value={community.get(opponentId)} /><RateCell value={broad.get(opponentId)} /><RateCell value={conservative.get(opponentId)} /><RateCell value={proAggregate.get(opponentId)} />{archive.selectedPro && <RateCell value={pro.get(opponentId)} />}</tr>)}
      </tbody></table></div> : <div className="empty-note">No matching matchup samples are available.</div>}
      {gameType !== "all" && <div className="hint">Your and SSBM Stats columns use the selected mode. Historical archive columns are offline event games.</div>}
    </ArchiveFrame>
  );
}

function archiveStageMap(rows: ArchiveRollup[], population: "broad" | "conservative", opponentId: number) {
  return new Map(rows
    .filter((row) => row.population === population && row.opponent_character_id === opponentId && row.stage_id !== null)
    .map((row) => [row.stage_id!, rateSummary(row)!]));
}

export function ArchiveStageAtlasComparison({
  games,
  characterId,
  opponentId,
  lookbackDays,
  communityRows,
  controls,
  onCharacterChange,
}: {
  games: ResolvedGame[];
  characterId: number;
  opponentId: number;
  lookbackDays: CommunityLookbackDays;
  communityRows: CommunityMatchupRow[];
  controls?: ReactNode;
  onCharacterChange?: (characterId: number) => void;
}) {
  const archive = useArchiveAtlas(characterId);
  const local = useMemo(() => {
    const rows = new Map<number, RateSummary>();
    for (const game of localLookback(games, lookbackDays)) {
      if (game.me.characterId !== characterId || game.opp.characterId !== opponentId) continue;
      const row = rows.get(game.rec.stageId) ?? { wins: 0, decided: 0, games: 0 };
      row.games++;
      if (game.isWin !== null) { row.decided++; if (game.isWin) row.wins++; }
      rows.set(game.rec.stageId, row);
    }
    return rows;
  }, [characterId, games, lookbackDays, opponentId]);
  const community = new Map(communityRows.map((row) => [row.stageId, {
    wins: row.wins,
    decided: row.games,
    games: row.games,
    contributors: row.contributors,
  }]));
  const broad = archiveStageMap(archive.fieldRows, "broad", opponentId);
  const conservative = archiveStageMap(archive.fieldRows, "conservative", opponentId);
  const proAggregate = archiveStageMap(archive.proAggregateRows, "conservative", opponentId);
  const pro = archiveStageMap(archive.proRows, "conservative", opponentId);
  const stages = INCLUDED_STAGE_IDS.filter((id) => local.has(id) || community.has(id) || broad.has(id) || conservative.has(id) || proAggregate.has(id) || pro.has(id));

  return (
    <ArchiveFrame archive={archive} eyebrow="Stage Atlas" title={`${charName(characterId)} vs ${charName(opponentId)} across the full field`} controls={controls} onCharacterChange={onCharacterChange}>
      {stages.length ? <div className="table-scroll"><table><thead><tr><th>Stage</th><th className="data">You</th><th className="data">SSBM Stats</th><th className="data">Venue archive</th><th className="data">Tournament archive</th><th className="data">Pro tournament archive</th>{archive.selectedPro && <th className="data">{archive.selectedPro.display_name}</th>}</tr></thead><tbody>
        {stages.map((id) => <tr key={id}><td>{stageName(id)}</td><RateCell value={local.get(id)} /><RateCell value={community.get(id)} /><RateCell value={broad.get(id)} /><RateCell value={conservative.get(id)} /><RateCell value={proAggregate.get(id)} />{archive.selectedPro && <RateCell value={pro.get(id)} />}</tr>)}
      </tbody></table></div> : <div className="empty-note">No stage-specific sample is available for this matchup.</div>}
    </ArchiveFrame>
  );
}

interface GroupedArchiveMove extends ArchiveMoveMetrics {
  key: string;
  label: string;
}

function groupArchiveMoves(row: ArchiveRollup | null): Map<string, GroupedArchiveMove> {
  const grouped = new Map<string, GroupedArchiveMove>();
  for (const [moveId, move] of Object.entries(row?.metrics.moves ?? {})) {
    const group = moveGroup(Number(moveId));
    const value = grouped.get(group.key) ?? {
      key: group.key,
      label: moveGroupLabel(group.key),
      attempts: 0,
      landed: 0,
      damage: 0,
      kills: 0,
      killPctSum: 0,
      openings: 0,
      openingDmg: 0,
      lCancelSuccess: 0,
      lCancelFail: 0,
    };
    value.attempts += move.attempts;
    value.landed += move.landed;
    value.damage += move.damage;
    value.kills += move.kills;
    value.killPctSum += move.killPctSum;
    value.openings += move.openings;
    value.openingDmg += move.openingDmg;
    value.lCancelSuccess += move.lCancelSuccess;
    value.lCancelFail += move.lCancelFail;
    grouped.set(group.key, value);
  }
  return grouped;
}

type MoveMetric = "attempts" | "landed" | "damage" | "kills" | "killPct";

function localMoveValue(move: ReturnType<typeof moveTable>["rows"][number] | undefined, metric: MoveMetric, games: number) {
  return formatMoveMetric(localMoveMetric(move, metric, games), metric);
}

function communityMoveValue(move: CommunityMoveRow | undefined, metric: MoveMetric, totalDamage: number) {
  return formatMoveMetric(communityMoveMetric(move, metric, totalDamage), metric);
}

function archiveMoveValue(move: GroupedArchiveMove | undefined, metric: MoveMetric, row: ArchiveRollup | null) {
  return formatMoveMetric(archiveMoveMetric(move, metric, row), metric);
}

function localMoveMetric(move: ReturnType<typeof moveTable>["rows"][number] | undefined, metric: MoveMetric, games: number): number | null {
  if (!move) return null;
  if (metric === "attempts") return move.attemptsPerGame;
  if (metric === "landed") return move.landedPerGame;
  if (metric === "damage") return move.dmgShare;
  if (metric === "kills") return games > 0 ? move.kills / games : null;
  return move.avgKillPct;
}

function communityMoveMetric(move: CommunityMoveRow | undefined, metric: MoveMetric, totalDamage: number): number | null {
  if (!move || move.characterGames === 0) return null;
  if (metric === "attempts") return move.attempts === null ? null : move.attempts / move.characterGames;
  if (metric === "landed") return move.landed / move.characterGames;
  if (metric === "damage") return totalDamage > 0 ? move.damage / totalDamage : null;
  if (metric === "kills") return move.kills / move.characterGames;
  return move.kills > 0 ? move.killPctSum / move.kills : null;
}

function archiveMoveMetric(move: GroupedArchiveMove | undefined, metric: MoveMetric, row: ArchiveRollup | null): number | null {
  if (!move || !row || row.game_count === 0) return null;
  if (metric === "attempts") return move.attempts === 0 && move.landed > 0 ? null : move.attempts / row.game_count;
  if (metric === "landed") return move.landed / row.game_count;
  if (metric === "damage") return row.metrics.damageTotal > 0 ? move.damage / row.metrics.damageTotal : null;
  if (metric === "kills") return move.kills / row.game_count;
  return move.kills > 0 ? move.killPctSum / move.kills : null;
}

function formatMoveMetric(value: number | null, metric: MoveMetric): string {
  if (value === null) return "—";
  if (metric === "damage") return pct(value);
  if (metric === "killPct") return `${num(value, 0)}%`;
  return num(value, metric === "kills" ? 3 : 2);
}

function moveDifference(
  mine: number | null,
  field: number | null,
  metric: MoveMetric,
  localGames: number,
  fieldGames: number,
): "above" | "below" | null {
  if (mine === null || field === null || localGames < 10 || fieldGames < 25) return null;
  const absoluteMinimum = metric === "damage" ? 0.05 : metric === "killPct" ? 10 : metric === "kills" ? 0.05 : metric === "landed" ? 0.25 : 0.5;
  const gap = mine - field;
  if (Math.abs(gap) < Math.max(absoluteMinimum, Math.abs(field) * 0.35)) return null;
  return gap > 0 ? "above" : "below";
}

export function ArchiveMoveAtlasComparison({
  games,
  characterId,
  lookbackDays,
  communityRows,
  controls,
  onCharacterChange,
}: {
  games: ResolvedGame[];
  characterId: number;
  lookbackDays: CommunityLookbackDays;
  communityRows: CommunityMoveRow[];
  controls?: ReactNode;
  onCharacterChange?: (characterId: number) => void;
}) {
  const archive = useArchiveAtlas(characterId);
  const [metric, setMetric] = useState<MoveMetric>("attempts");
  const localGames = useMemo(
    () => localLookback(games, lookbackDays).filter((game) => game.me.characterId === characterId),
    [characterId, games, lookbackDays],
  );
  const localMoves = useMemo(() => moveTable(localGames), [localGames]);
  const localByKey = new Map(localMoves.rows.map((row) => [row.key, row]));
  const communityByKey = new Map(communityRows.map((row) => [row.moveKey, row]));
  const broadRow = archive.fieldRows.find((row) => row.population === "broad" && row.opponent_character_id === null && row.stage_id === null) ?? null;
  const conservativeRow = archive.fieldRows.find((row) => row.population === "conservative" && row.opponent_character_id === null && row.stage_id === null) ?? null;
  const proAggregateRow = archive.proAggregateRows.find((row) => row.opponent_character_id === null && row.stage_id === null) ?? null;
  const proRow = archive.proRows.find((row) => row.opponent_character_id === null && row.stage_id === null) ?? null;
  const broadMoves = groupArchiveMoves(broadRow);
  const conservativeMoves = groupArchiveMoves(conservativeRow);
  const proAggregateMoves = groupArchiveMoves(proAggregateRow);
  const proMoves = groupArchiveMoves(proRow);
  const comparisonRow = conservativeRow ?? broadRow;
  const comparisonMoves = conservativeRow ? conservativeMoves : broadMoves;
  const communityDamage = communityRows.reduce((sum, row) => sum + row.damage, 0);
  const moveKeys = [...new Set([...localByKey.keys(), ...communityByKey.keys(), ...broadMoves.keys(), ...conservativeMoves.keys(), ...proAggregateMoves.keys(), ...proMoves.keys()])]
    .sort((a, b) => Math.max(localByKey.get(b)?.dmgShare ?? 0, communityDamage > 0 ? (communityByKey.get(b)?.damage ?? 0) / communityDamage : 0) - Math.max(localByKey.get(a)?.dmgShare ?? 0, communityDamage > 0 ? (communityByKey.get(a)?.damage ?? 0) / communityDamage : 0));
  const communityGames = communityRows.length
    ? Math.max(...communityRows.map((row) => row.characterGames))
    : null;

  return (
    <ArchiveFrame archive={archive} eyebrow="Move Atlas" title={`Your ${charName(characterId)} move profile across the full field`} controls={controls} onCharacterChange={onCharacterChange}>
      <div className="acb-move-heading"><h3>Move profile</h3><label>Measure<select value={metric} onChange={(event) => setMetric(event.target.value as MoveMetric)}><option value="attempts">Attempts / game</option><option value="landed">Landed / game</option><option value="damage">Damage share</option><option value="kills">Kills / game</option><option value="killPct">Average kill %</option></select></label></div>
      {moveKeys.length ? <div className="table-scroll"><table><thead><tr><th>Move</th><th className="data">You<span className="sample-note">{localGames.length.toLocaleString()} games</span></th><th className="data">SSBM Stats<span className="sample-note">{communityGames === null ? "sample not yet publishable" : `${communityGames.toLocaleString()} player-games`}</span></th><th className="data">Venue archive<span className="sample-note">{broadRow?.game_count.toLocaleString() ?? "—"} player-games</span></th><th className="data">Tournament archive<span className="sample-note">{conservativeRow?.game_count.toLocaleString() ?? "—"} player-games</span></th><th className="data">Pro tournament archive<span className="sample-note">{proAggregateRow?.game_count.toLocaleString() ?? "—"} player-games · {proAggregateRow?.identified_player_count?.toLocaleString() ?? "—"} pros</span></th>{archive.selectedPro && <th className="data">{archive.selectedPro.display_name}<span className="sample-note">{proRow?.game_count.toLocaleString() ?? "—"} games</span></th>}</tr></thead><tbody>
        {moveKeys.map((key) => {
          const mine = localMoveMetric(localByKey.get(key), metric, localGames.length);
          const field = archiveMoveMetric(comparisonMoves.get(key), metric, comparisonRow);
          const direction = moveDifference(mine, field, metric, localGames.length, comparisonRow?.game_count ?? 0);
          return <tr key={key}><td>{localByKey.get(key)?.label ?? moveGroupLabel(key)}</td><td className={`data ${direction ? `community-diff-${direction}` : ""}`} title={direction ? `Large ${direction === "above" ? "increase over" : "decrease from"} the ${conservativeRow ? "tournament" : "venue"} archive benchmark` : undefined}>{localMoveValue(localByKey.get(key), metric, localGames.length)}</td><td className="data">{communityMoveValue(communityByKey.get(key), metric, communityDamage)}</td><td className="data">{archiveMoveValue(broadMoves.get(key), metric, broadRow)}</td><td className="data">{archiveMoveValue(conservativeMoves.get(key), metric, conservativeRow)}</td><td className="data">{archiveMoveValue(proAggregateMoves.get(key), metric, proAggregateRow)}</td>{archive.selectedPro && <td className="data">{archiveMoveValue(proMoves.get(key), metric, proRow)}</td>}</tr>;
        })}
      </tbody></table></div> : <div className="empty-note">No move sample is available for this character.</div>}
    </ArchiveFrame>
  );
}
