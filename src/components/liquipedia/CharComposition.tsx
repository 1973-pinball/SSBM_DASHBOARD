import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHAR_STACK_ORDER, OTHER_CHAR, charColor, charId } from "../../lib/liquipedia/chars";
import type { EditionComposition } from "../../lib/liquipedia/select";
import { breakthroughLabel, breakthroughs, charStorylines, compositionSeries } from "../../lib/liquipedia/select";
import { axisStyle, gridStyle, tooltipStyle } from "../chartStyle";
import { Playbar } from "./Playback";
import { usePlayback } from "./usePlayback";
import { loadIcons } from "./gifShare";
import { useShareGif } from "./useShareGif";
import { Stock } from "./Stock";

const ROW_H = 30;
const PLAY_MS = 750; // editions are sparse, so each one holds longer than a major

// ---------------- Stacked area: composition over time ----------------

/** Named characters + Other, one stacked bar per edition — the dominance picture. */
export function CompositionBars({ comps }: { comps: EditionComposition[] }) {
  const rows = useMemo(() => compositionSeries(comps), [comps]);
  const byLabel = useMemo(() => new Map(comps.map((c) => [String(c.edition.year), c])), [comps]);
  const totals = useMemo(() => new Map(rows.map((r) => [r.label, r.total])), [rows]);
  // Bars carry shares, not head-counts: a few editions rank 101–104 players,
  // and only a normalized stack tops out at exactly 100.
  const chartData = useMemo(() => rows.map((r) => ({ label: r.label, ...r.shares })), [rows]);
  if (rows.length === 0) return <div className="empty-note">No ranking data bundled.</div>;

  const series = [...CHAR_STACK_ORDER, OTHER_CHAR];

  return (
    <>
      <div className="lq-legend">
        {series.map((c) => (
          <span key={c} className="lq-legend-item">
            <span className="dot" style={{ background: charColor(c) }} />
            {c !== OTHER_CHAR && <Stock char={c} size={15} />}
            {c}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: -20 }}>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
          <YAxis
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}`}
          />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "rgba(143, 127, 247, 0.08)" }}
            content={({ active, label }) => {
              if (!active || label === undefined) return null;
              const comp = byLabel.get(String(label));
              if (!comp) return null;
              const total = totals.get(String(label)) ?? 0;
              return (
                <div style={tooltipStyle.contentStyle} className="lq-tip">
                  <div className="lq-tip-title">
                    {comp.edition.title} · {total} ranked
                  </div>
                  {comp.chars.slice(0, 10).map((s) => (
                    <div key={s.char} className="lq-tip-row">
                      <span className="dot" style={{ background: charColor(s.char) }} />
                      <span className="lq-tip-char">{s.char}</span>
                      <b>{s.count}</b>
                      <span className="lq-tip-top">
                        top: {s.reps[0]!.player} (#{s.reps[0]!.rank})
                      </span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          {series.map((c) => (
            <Bar key={c} dataKey={c} stackId="chars" fill={charColor(c)} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="hint">
        One bar per ranking edition, split by primary main and scaled to 100 — a few editions rank 101–104 players
        because of ties, so the axis is share of the list rather than raw head-count (hover for the real numbers).
        Bars are evenly spaced: there were no rankings in 2020–21.
      </div>
    </>
  );
}

// ---------------- Explorer: one edition at a time, animated ----------------

/**
 * Character breakdown of a single edition with a year slider and playback.
 * Defaults to the latest edition, i.e. the "current" snapshot. Characters
 * absent from the previous edition get a gold NEW badge naming who brought
 * them in — the aMSa/Yoshi moments.
 */
export function CompositionExplorer({ comps }: { comps: EditionComposition[] }) {
  const playback = usePlayback(comps.length, PLAY_MS);
  const ticks = useMemo(() => comps.map((c) => String(c.edition.year)), [comps]);
  const share = useShareGif();

  const onShare = () =>
    void share.run(async () => {
      const { drawCharFrame } = await import("../../../scripts/lib/gif-draw.mjs");
      const names = [...new Set(comps.flatMap((c) => c.chars.map((s) => s.char)))];
      const icons = await loadIcons(
        names.map((n) => [n, charId(n)] as [string, number | null]).filter((e): e is [string, number] => e[1] !== null),
      );
      const max = Math.max(1, ...comps.flatMap((c) => c.chars.map((s) => s.count)));
      return {
        frameCount: comps.length,
        stepMs: PLAY_MS / playback.speed,
        filename: "melee-top100-by-main.gif",
        draw: (ctx, i) => {
          const c = comps[i]!;
          const before = i > 0 ? comps[i - 1] : undefined;
          drawCharFrame(
            ctx,
            {
              title: c.edition.title,
              year: c.edition.year,
              total: c.edition.entries.length,
              chars: c.chars.map((s) => ({
                char: s.char,
                count: s.count,
                topPlayer: s.reps[0]?.player,
                topRank: s.reps[0]?.rank,
                isNew: before !== undefined && !before.byChar.has(s.char),
              })),
            },
            { max, icons },
          );
        },
      };
    });

  if (comps.length === 0) return <div className="empty-note">No ranking data bundled.</div>;

  const comp = comps[playback.idx]!;
  const prev = playback.idx > 0 ? comps[playback.idx - 1] : undefined;
  const max = Math.max(1, ...comps.flatMap((c) => c.chars.map((s) => s.count)));

  return (
    <>
      <Playbar
        playback={playback}
        max={comps.length - 1}
        onShare={onShare}
        shareState={share.state}
        sliderLabel="Ranking edition"
        ticks={ticks}
        valueText={`${comp.edition.title}, ${comp.edition.entries.length} players ranked`}
        caption={
          <>
            <b>{comp.edition.title}</b> · {comp.edition.entries.length} players ranked
          </>
        }
      />

      <div className="lq-race" style={{ height: comp.chars.length * ROW_H }}>
        {comp.chars.map((s, i) => {
          const isNew = prev !== undefined && !prev.byChar.has(s.char);
          const top = s.reps[0]!;
          return (
            <div key={s.char} className="lq-race-row lq-char-row" style={{ transform: `translateY(${i * ROW_H}px)` }}>
              <span className="lq-race-who">
                <Stock char={s.char} />
                {s.char}
              </span>
              <span className="lq-race-track">
                <span className="lq-race-barwrap">
                  <span
                    className="lq-race-bar"
                    style={{ width: `${(s.count / max) * 100}%`, background: charColor(s.char) }}
                  />
                </span>
                <span className="lq-race-count">{s.count}</span>
                <span className="lq-race-note">
                  {isNew && <span className="lq-new">NEW</span>} {top.player} (#{top.rank})
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="hint">
        Bars count primary mains among that edition's {comp.edition.entries.length} ranked players; the name after each bar is the
        character's highest-ranked player that year. NEW marks a character absent from the previous edition.
      </div>
    </>
  );
}

// ---------------- Trailblazers ----------------

/**
 * The moments a character arrived, and who carried it there — a character's
 * first ranked appearance, and the first time one of its players cracked the
 * top 25 and the top 10.
 */
export function Trailblazers({ comps }: { comps: EditionComposition[] }) {
  const moments = useMemo(() => breakthroughs(comps), [comps]);
  const byYear = useMemo(() => {
    const m = new Map<number, typeof moments>();
    for (const b of moments) m.set(b.year, [...(m.get(b.year) ?? []), b]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [moments]);

  if (moments.length === 0) return <div className="empty-note">No ranking data bundled.</div>;

  return (
    <>
      <ol className="lq-timeline">
        {byYear.map(([year, items]) => (
          <li key={year}>
            <span className="lq-tl-year">{year}</span>
            <span className="lq-tl-items">
              {items.map((b) => (
                <span key={`${b.char}:${b.kind}`} className={`lq-tl-chip lq-tl-${b.kind}`}>
                  <Stock char={b.char} size={17} />
                  <b>{b.char}</b>
                  <span className="lq-tl-who">
                    {b.player} #{b.rank}
                  </span>
                  <span className="lq-tl-kind">{breakthroughLabel(b)}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
      <div className="hint">
        Each chip is the first time a character reached that bar in a top-100 list, and the player who got it there —
        aMSa dragging Yoshi into the top 10, Junebug ranking Donkey Kong at all. Where a character already stood in the
        2013 list is the baseline, so only later moves appear.
      </div>
    </>
  );
}

// ---------------- Podium timeline ----------------

/**
 * The player-side companion to the character charts: who actually sat at the
 * top of each ranking edition. Majors measure titles won; this measures the
 * scene's own verdict on who was best that season.
 */
export function PodiumTimeline({ comps }: { comps: EditionComposition[] }) {
  if (comps.length === 0) return <div className="empty-note">No ranking data bundled.</div>;
  return (
    <>
      <ol className="lq-timeline">
        {comps.map((c) => (
          <li key={c.edition.title}>
            <span className="lq-tl-year">{c.edition.year}</span>
            <span className="lq-tl-items">
              {c.edition.entries.slice(0, 3).map((e) => (
                <span key={e.player} className={`lq-tl-chip${e.rank === 1 ? " lq-tl-first" : ""}`}>
                  <span className="lq-tl-rank">#{e.rank}</span>
                  {e.chars[0] && <Stock char={e.chars[0]} size={17} />}
                  <b>{e.player}</b>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
      <div className="hint">Top three of each SSBMRank/MPGR edition — the seasons with no edition (2020–21) are simply absent.</div>
    </>
  );
}

// ---------------- Storylines ----------------

/** Per-character arc: arrival (and who drove it), peak era, best rank, today. */
export function CharStorylinesTable({ comps }: { comps: EditionComposition[] }) {
  const stories = useMemo(() => charStorylines(comps), [comps]);
  if (stories.length === 0) return <div className="empty-note">No ranking data bundled.</div>;
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Character</th>
            <th>Entered top 100</th>
            <th className="data">Peak</th>
            <th>Best-ever rank</th>
            <th className="data">Now</th>
            <th>Current torchbearer</th>
          </tr>
        </thead>
        <tbody>
          {stories.map((s) => (
            <tr key={s.char}>
              <td>
                <span className="lq-race-who">
                  <Stock char={s.char} />
                  {s.char}
                </span>
              </td>
              <td>
                {s.arrival.year}
                {s.newcomer && <span className="lq-new">NEW</span>} via {s.arrival.rep.player} (#{s.arrival.rep.rank})
              </td>
              <td className="data">
                {s.peak.count} <span className="lq-dim">in {s.peak.year}</span>
              </td>
              <td>
                #{s.bestEver.rep.rank} — {s.bestEver.rep.player} <span className="lq-dim">({s.bestEver.year})</span>
              </td>
              <td className="data">{s.current > 0 ? s.current : "—"}</td>
              <td>{s.currentTop ? `${s.currentTop.player} (#${s.currentTop.rank})` : <span className="lq-dim">out of top 100</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">
        "Entered" is the first edition where anyone ranked with the character as primary main — NEW marks characters
        that arrived after the first edition (2013), e.g. a scene newcomer putting a character on the map.
      </div>
    </>
  );
}
