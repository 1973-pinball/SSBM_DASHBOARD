import { useMemo } from "react";
import type { ResolvedGame, ResolvedTeamGame } from "../lib/types";
import { singlesRecords, statCardData, teamsRecords, type GameRef } from "../lib/stats";
import { duration, int, num, pct, shortDate } from "../lib/format";
import { charName } from "../lib/melee";
import { CardActions } from "./CardActions";
import { useCardExport } from "./useCardExport";

/** "FALC#123 (Falcon), Mar 3, 26" — however much of that the record carries. */
function refText(r: GameRef): string {
  const who = r.oppCode ? `${r.oppCode} (${charName(r.oppChar)})` : `vs ${charName(r.oppChar)}`;
  return r.date ? `${who}, ${shortDate(r.date)}` : who;
}

interface Cell {
  label: string;
  value: string;
  sub?: string;
}

/** Matches .sc-grid, which is four across above 760px. */
const COLUMNS = 4;

/**
 * Personal bests as one shareable card.
 *
 * This was its own tab of loose panels. It is the other half of the story the
 * player card tells — that card is who you are, this one is your best day — so
 * it borrows the same frame and cell language and exports through the same
 * client-side PNG path, and now sits at the foot of Overview instead of behind
 * a tab nobody opened twice.
 */
export function RecordsCard({ games, teamGames }: { games: ResolvedGame[]; teamGames: ResolvedTeamGame[] }) {
  const r = useMemo(() => singlesRecords(games), [games]);
  const t = useMemo(() => teamsRecords(teamGames), [teamGames]);
  const d = useMemo(() => statCardData(games), [games]);
  const { cardRef, copied, download, copy } = useCardExport(
    `ssbm-records-${(d.code ?? "player").replace(/[^A-Za-z0-9#-]/g, "")}.png`,
  );

  const cells: Cell[] = [];
  if (r.bestWinStreak) {
    cells.push({
      label: "Best win streak",
      value: `${r.bestWinStreak.length} wins`,
      sub: r.bestWinStreak.end ? `ended ${shortDate(r.bestWinStreak.end)}` : undefined,
    });
  }
  if (r.worstLossStreak) {
    cells.push({
      label: "Worst loss streak",
      value: `${r.worstLossStreak.length} losses`,
      sub: r.worstLossStreak.end ? `ended ${shortDate(r.worstLossStreak.end)}` : undefined,
    });
  }
  if (r.highestDamage) {
    cells.push({ label: "Most damage in a game", value: `${int(r.highestDamage.value)}%`, sub: refText(r.highestDamage) });
  }
  if (r.fastestWin) {
    cells.push({ label: "Fastest win", value: duration(r.fastestWin.seconds), sub: refText(r.fastestWin) });
  }
  cells.push({ label: "Perfect wins", value: int(r.perfectWins), sub: "won with 4 stocks left" });
  if (r.longestGame) {
    cells.push({ label: "Longest game", value: duration(r.longestGame.seconds), sub: refText(r.longestGame) });
  }
  if (r.bestLCancelDay) {
    cells.push({
      label: "Best L-cancel day",
      value: pct(r.bestLCancelDay.rate),
      sub: `${r.bestLCancelDay.day} · ${r.bestLCancelDay.attempts.toLocaleString()} attempts`,
    });
  }
  if (r.busiestDay) {
    cells.push({ label: "Most games in a day", value: `${r.busiestDay.games} games`, sub: r.busiestDay.day });
  }
  if (r.longestSession) {
    cells.push({ label: "Longest session", value: `${r.longestSession.games} games`, sub: shortDate(r.longestSession.start) });
  }
  if (r.nemesis) {
    cells.push({ label: "Nemesis", value: r.nemesis.code, sub: `${r.nemesis.wins}–${r.nemesis.losses} against them` });
  }
  if (r.victim) {
    cells.push({ label: "Favourite victim", value: r.victim.code, sub: `${r.victim.wins}–${r.victim.losses} against them` });
  }
  // Doubles records share the card rather than splitting it — every label here
  // already says 2v2, and the point was to end up with one thing to share.
  if (t.bestWinStreak) {
    cells.push({
      label: "Best 2v2 win streak",
      value: `${t.bestWinStreak.length} wins`,
      sub: t.bestWinStreak.end ? `ended ${shortDate(t.bestWinStreak.end)}` : undefined,
    });
  }
  if (t.grudge) {
    cells.push({
      label: "Biggest 2v2 FF grudge",
      value: `${num(t.grudge.ffPerGame, 1)}%/game`,
      sub: `${t.grudge.code} → me · ${t.grudge.games} games`,
    });
  }
  if (t.myTarget) {
    cells.push({
      label: "My most-FF'd teammate",
      value: `${num(t.myTarget.ffPerGame, 1)}%/game`,
      sub: `${t.myTarget.code} · ${t.myTarget.games} games`,
    });
  }

  if (cells.length === 0) return null;

  // .sc-grid draws its rules as a 1px gap over a --line background, so a ragged
  // final row would render as a bare stripe. Pad it with empty cells.
  const filler = (COLUMNS - (cells.length % COLUMNS)) % COLUMNS;

  return (
    <div className="panel">
      <div className="sc-wrap">
        <div className="share-card" ref={cardRef}>
          <div className="sc-head">
            <div>
              <div className="sc-tag">{d.name ?? d.code ?? "Melee player"}</div>
              {d.codes.length > 0 && <div className="sc-code">{d.codes.join(" · ")}</div>}
            </div>
            <div className="sc-head-right">
              <div className="sc-title">RECORDS</div>
              {d.firstDate && d.lastDate && (
                <div className="sc-range">{shortDate(d.firstDate)} — {shortDate(d.lastDate)}</div>
              )}
            </div>
          </div>

          <div className="sc-grid">
            {cells.map((c) => (
              <div className="sc-cell" key={c.label}>
                <div className="sc-label">{c.label}</div>
                <div className="sc-value">{c.value}</div>
                {c.sub && <div className="sc-sub">{c.sub}</div>}
              </div>
            ))}
            {Array.from({ length: filler }, (_, i) => (
              <div className="sc-cell" key={`filler-${i}`} aria-hidden="true" />
            ))}
          </div>

          <div className="sc-foot">
            <span>Personal bests</span>
            <span className="sc-url">ssbmstats.com</span>
          </div>
        </div>
      </div>

      <CardActions copied={copied} onDownload={download} onCopy={copy} />
      <div className="hint">
        Records respect the current filters — scope to a character, opponent, or time range for filtered bests. Best
        L-cancel day needs 100+ attempts that day; the friendly-fire records need 5+ games with that teammate.
      </div>
    </div>
  );
}
