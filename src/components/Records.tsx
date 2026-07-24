import { useMemo } from "react";
import type { ResolvedGame, ResolvedTeamGame } from "../lib/types";
import { singlesRecords, teamsRecords, type GameRef } from "../lib/stats";
import { pct, num, int, duration, shortDate } from "../lib/format";
import { charName } from "../lib/melee";

/** "FALC#123 (Falcon), Mar 3, 26" — however much of that the record carries. */
function refText(r: GameRef): string {
  const who = r.oppCode ? `${r.oppCode} (${charName(r.oppChar)})` : `vs ${charName(r.oppChar)}`;
  return r.date ? `${who}, ${shortDate(r.date)}` : who;
}

function RecordCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="panel" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-data)", fontSize: 26, fontWeight: 600, margin: "4px 0 2px" }}>{value}</div>
      {detail && <div style={{ fontSize: 12, color: "var(--faint)", fontFamily: "var(--font-data)" }}>{detail}</div>}
    </div>
  );
}

export function Records({ games, teamGames }: { games: ResolvedGame[]; teamGames: ResolvedTeamGame[] }) {
  const r = useMemo(() => singlesRecords(games), [games]);
  const t = useMemo(() => teamsRecords(teamGames), [teamGames]);

  if (games.length === 0 && teamGames.length === 0)
    return <div className="empty-note">No games match the current filters.</div>;

  const cards: { label: string; value: string; detail?: string }[] = [];
  if (r.bestWinStreak) cards.push({ label: "Best win streak", value: `${r.bestWinStreak.length}`, detail: r.bestWinStreak.end ? `ended ${shortDate(r.bestWinStreak.end)}` : undefined });
  if (r.worstLossStreak) cards.push({ label: "Worst loss streak", value: `${r.worstLossStreak.length}`, detail: r.worstLossStreak.end ? `ended ${shortDate(r.worstLossStreak.end)}` : undefined });
  if (r.highestDamage) cards.push({ label: "Most damage in a game", value: `${int(r.highestDamage.value)}%`, detail: refText(r.highestDamage) });
  if (r.fastestWin) cards.push({ label: "Fastest win", value: duration(r.fastestWin.seconds) ?? "—", detail: refText(r.fastestWin) });
  cards.push({ label: "Perfect wins (4 stocks left)", value: int(r.perfectWins) ?? "0" });
  if (r.longestGame) cards.push({ label: "Longest game", value: duration(r.longestGame.seconds) ?? "—", detail: refText(r.longestGame) });
  if (r.bestLCancelDay) cards.push({ label: "Best L-cancel day", value: pct(r.bestLCancelDay.rate), detail: `${r.bestLCancelDay.day} · ${r.bestLCancelDay.attempts.toLocaleString()} attempts` });
  if (r.busiestDay) cards.push({ label: "Most games in a day", value: `${r.busiestDay.games}`, detail: r.busiestDay.day });
  if (r.longestSession) cards.push({ label: "Longest session", value: `${r.longestSession.games} games`, detail: shortDate(r.longestSession.start) ?? undefined });
  if (r.nemesis) cards.push({ label: "Nemesis", value: r.nemesis.code, detail: `${r.nemesis.wins}–${r.nemesis.losses} against them` });
  if (r.victim) cards.push({ label: "Favorite victim", value: r.victim.code, detail: `${r.victim.wins}–${r.victim.losses} against them` });

  const teamCards: { label: string; value: string; detail?: string }[] = [];
  if (t.bestWinStreak) teamCards.push({ label: "Best 2v2 win streak", value: `${t.bestWinStreak.length}`, detail: t.bestWinStreak.end ? `ended ${shortDate(t.bestWinStreak.end)}` : undefined });
  if (t.grudge) teamCards.push({ label: "Biggest FF grudge (them → me)", value: `${num(t.grudge.ffPerGame, 1)}%/game`, detail: `${t.grudge.code} · ${t.grudge.games} games` });
  if (t.myTarget) teamCards.push({ label: "My most-FF'd teammate", value: `${num(t.myTarget.ffPerGame, 1)}%/game`, detail: `${t.myTarget.code} · ${t.myTarget.games} games` });

  return (
    <>
      {cards.length > 0 && (
        <>
          <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {cards.map((c) => (
              <RecordCard key={c.label} {...c} />
            ))}
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            Records respect the current filters — scope to a character, opponent, or time range for filtered bests.
            Best L-cancel day requires 100+ attempts that day.
          </div>
        </>
      )}
      {teamCards.length > 0 && (
        <>
          <h2 style={{ margin: "18px 0 10px", fontSize: 15 }}>2v2</h2>
          <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {teamCards.map((c) => (
              <RecordCard key={c.label} {...c} />
            ))}
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            Friendly-fire records need at least 5 games with that teammate.
          </div>
        </>
      )}
    </>
  );
}
