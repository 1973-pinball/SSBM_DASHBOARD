import { useMemo } from "react";
import type { Major, PlayerMeta } from "../../lib/liquipedia/types";
import { careerLeaderboard, raceFrames } from "../../lib/liquipedia/select";
import { shortDate } from "../../lib/format";
import { charId } from "../../lib/liquipedia/chars";
import { Playbar } from "./Playback";
import { usePlayback } from "./usePlayback";
import { loadIcons } from "./gifShare";
import { useShareGif } from "./useShareGif";
import { Mains, Stock } from "./Stock";

const VISIBLE = 12; // bars shown at once
const ROW_H = 34;
const PLAY_MS = 440; // 1× step; 2× lands near 220ms, which reads as fast but still legible

const usd = (n: number | null): string => (n === null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

/**
 * Animated "bar chart race" of cumulative major titles, one frame per major.
 * Ends on the all-time leaderboard, which the table below extends with
 * career winnings.
 */
export function MajorsRace({ majors, players }: { majors: Major[]; players: Record<string, PlayerMeta> }) {
  const frames = useMemo(() => raceFrames(majors), [majors]);
  const leaderboard = useMemo(() => careerLeaderboard(majors, players), [majors, players]);
  const playback = usePlayback(frames.length, PLAY_MS);
  const share = useShareGif();

  // Frame 0 is the empty "before any major" state; the GIF starts at the first
  // actual result so it opens on something rather than a blank board.
  const onShare = () => {
    if (share.state.status === "ready") return share.send(share.state.file);
    void share.run(async () => {
      const { drawRaceFrame } = await import("../../../scripts/lib/gif-draw.mjs");
      const icons = await loadIcons(
        Object.entries(players)
          .map(([tag, meta]) => [tag, charId(meta.mains[0] ?? "")] as [string, number | null])
          .filter((e): e is [string, number] => e[1] !== null),
      );
      const max = Math.max(1, ...(frames[frames.length - 1]?.standings.map((s) => s.count) ?? [1]));
      return {
        frameCount: frames.length - 1,
        stepMs: PLAY_MS / playback.speed,
        filename: "melee-majors-race.gif",
        draw: (ctx, i) => {
          const f = frames[i + 1]!;
          drawRaceFrame(ctx, { name: f.major!.name, year: f.major!.year, winner: f.major!.winner, standings: f.standings }, { max, icons });
        },
      };
    });
  };

  if (frames.length <= 1) return <div className="empty-note">No majors data bundled.</div>;

  const current = frames[playback.idx]!;
  const globalMax = Math.max(1, ...(frames[frames.length - 1]?.standings.map((s) => s.count) ?? [1]));
  const visible = current.standings.slice(0, VISIBLE);

  return (
    <>
      <Playbar
        playback={playback}
        max={frames.length - 1}
        onShare={onShare}
        shareState={share.state}
        onSpeedChange={share.reset}
        sliderLabel="Timeline position (one step per major)"
        valueText={
          current.major ? `${current.major.name}, ${shortDate(current.major.date)}, won by ${current.major.winner}` : "Before the first major"
        }
        caption={
          current.major ? (
            <>
              <b>{current.major.name}</b> · {shortDate(current.major.date)} — won by <b>{current.major.winner}</b>
            </>
          ) : (
            "Before the first major"
          )
        }
      />

      <div className="lq-race" style={{ height: Math.max(visible.length, 1) * ROW_H }}>
        {visible.map((s, i) => {
          const meta = players[s.player];
          const isNewWin = current.major?.winner === s.player;
          return (
            <div key={s.player} className="lq-race-row" style={{ transform: `translateY(${i * ROW_H}px)` }}>
              <span className="lq-race-rank">{i + 1}</span>
              <span className="lq-race-who">
                {meta?.mains[0] && <Stock char={meta.mains[0]} />}
                <span className={isNewWin ? "gold" : undefined}>{s.player}</span>
              </span>
              <span className="lq-race-track lq-race-track--wide">
                <span className="lq-race-barwrap">
                  <span className="lq-race-bar" style={{ width: `${(s.count / globalMax) * 100}%` }} />
                </span>
                <span className="lq-race-count">{s.count}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="hint">
        Opens on today's standings, paused. Press play — or scrub — to watch major titles accumulate one tournament at a
        time; the winner of the current major is highlighted in gold.
      </div>

      <h3 className="lq-subhead">All-time major champions</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Main</th>
            <th className="data">Majors</th>
            <th className="data">All-Smash career winnings</th>
            <th className="data">First · last major</th>
          </tr>
        </thead>
        <tbody>
          {leaderboard.map((r, i) => (
            <tr key={r.player}>
              <td className="data">{i + 1}</td>
              <td>{r.player}</td>
              <td>
                <Mains chars={r.mains} />
              </td>
              <td className="data">
                <b>{r.majors}</b>
              </td>
              <td className="data">{usd(r.earningsUsd)}</td>
              <td className="data">
                {r.firstWin.slice(0, 4)} · {r.lastWin.slice(0, 4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">
        Winnings are Liquipedia's "approx. total winnings": every tracked Smash event for that player — Melee, Ultimate,
        64, Project M — not Melee alone and not majors alone. Liquipedia publishes no per-game breakdown, so a
        Melee-only figure isn't available to quote.
      </div>
    </>
  );
}
