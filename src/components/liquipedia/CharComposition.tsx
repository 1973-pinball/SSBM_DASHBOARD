import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHAR_STACK_ORDER, OTHER_CHAR, charColor, charId } from "../../lib/liquipedia/chars";
import type { Major, PlayerMeta } from "../../lib/liquipedia/types";
import type { CharStoryline, EditionComposition } from "../../lib/liquipedia/select";
import {
  breakthroughLabel,
  breakthroughs,
  charStorylines,
  compositionSeries,
  majorsByChar,
} from "../../lib/liquipedia/select";
import { axisStyle, gridStyle, tooltipStyle } from "../chartStyle";
import { Playbar } from "./Playback";
import { usePlayback } from "./usePlayback";
import { loadIcons } from "./gifShare";
import { useShareGif } from "./useShareGif";
import { Stock } from "./Stock";

const ROW_H = 30;

/**
 * Every "arrived"/"entered" claim on this tab is bounded by the ranking era:
 * SSBMRank's first edition is 2013, while the majors list reaches back to
 * 2003. A character whose era predates the rankings (Ken's Marth, Azen's
 * Sheik) therefore reads as arriving in the first edition — say so rather
 * than let the table imply the character wasn't around.
 */
function RankingEraNote({ comps }: { comps: EditionComposition[] }) {
  const firstYear = comps[0]?.edition.year;
  if (!firstYear) return null;
  return (
    <div className="hint lq-era-note">
      Ranked data starts at {firstYear} — SSBMRank's first edition. Earlier eras (Ken's Marth, Azen's Sheik) have no
      top-100 list to draw on, so "entered"/"arrived" here means the first ranking, not the first time anyone played
      the character. The majors data above goes back to 2003.
    </div>
  );
}
const PLAY_MS = 750; // editions are sparse, so each one holds longer than a major

// ---------------- Clustered bars: composition over time ----------------

/** A cluster of character bars per ranking edition — the dominance picture. */
export function CompositionBars({ comps }: { comps: EditionComposition[] }) {
  const rows = useMemo(() => compositionSeries(comps), [comps]);
  const byLabel = useMemo(() => new Map(comps.map((c) => [String(c.edition.year), c])), [comps]);
  const totals = useMemo(() => new Map(rows.map((r) => [r.label, r.total])), [rows]);
  // Clustered bars carry head-counts. Shares only earned their keep while the
  // bars were stacked and had to top out at exactly 100; side by side, "28
  // players mained Fox" reads better than "28% of the list did".
  const chartData = useMemo(() => rows.map((r) => ({ label: r.label, ...r.values })), [rows]);
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
      <ResponsiveContainer width="100%" height={320}>
        {/* barCategoryGap separates the year clusters; barGap keeps the bars
            inside one cluster touching, so a cluster reads as a single group. */}
        <BarChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: -20 }} barCategoryGap="22%" barGap={1}>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
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
            <Bar key={c} dataKey={c} fill={charColor(c)} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="hint">
        A cluster per ranking edition, one bar per character, counting players by primary main. Editions rank 100–104
        players (ties), so counts are near-enough comparable across years — hover for the exact list size. Clusters are
        evenly spaced: there were no rankings in 2020–21.
      </div>
      <RankingEraNote comps={comps} />
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

  const onShare = () => {
    if (share.state.status === "ready") return share.send(share.state.files);
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
  };

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
        onSpeedChange={share.reset}
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
      <RankingEraNote comps={comps} />
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
        first list is the baseline, so only later moves appear.
      </div>
      <RankingEraNote comps={comps} />
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
      <RankingEraNote comps={comps} />
    </>
  );
}

// ---------------- Storylines ----------------

type StorySort = "char" | "majors" | "lastMajor" | "current";

const STORY_SORT_DIR: Record<StorySort, "asc" | "desc"> = {
  // The default direction each column takes on first click: names read A→Z,
  // counts and recency read biggest/newest first.
  char: "asc",
  majors: "desc",
  lastMajor: "desc",
  current: "desc",
};

/** Per-character arc: arrival (and who drove it), peak era, best rank, today. */
export function CharStorylinesTable({
  comps,
  majors,
  players,
}: {
  comps: EditionComposition[];
  majors: Major[];
  players: Record<string, PlayerMeta>;
}) {
  const stories = useMemo(() => charStorylines(comps), [comps]);
  const charMajors = useMemo(() => majorsByChar(majors, players), [majors, players]);
  const [sort, setSort] = useState<{ key: StorySort; dir: "asc" | "desc" }>({ key: "current", dir: "desc" });
  // Anything that lands on the first edition is an upper bound, not a date:
  // the rankings start there, so a peak or a best rank sitting in that year
  // may well have been reached before anyone was keeping a list.
  const firstYear = comps[0]?.edition.year;
  const eraYear = (year: number): string => (year === firstYear ? `≤${year}` : String(year));
  const sorted = useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    const rank = (s: CharStoryline): number | string => {
      switch (sort.key) {
        case "char":
          return s.char;
        case "majors":
          return charMajors.get(s.char)?.count ?? 0;
        case "lastMajor":
          // No title at all sorts below every dated one in either direction's
          // "least recent" end, so the blanks stay together.
          return charMajors.get(s.char)?.last.date ?? "";
        case "current":
          return s.current;
      }
    };
    return [...stories].sort((a, b) => {
      const av = rank(a);
      const bv = rank(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
      // Peak count is the table's underlying order — keep it as the tiebreak.
      return cmp !== 0 ? sign * cmp : b.peak.count - a.peak.count || a.char.localeCompare(b.char);
    });
  }, [stories, charMajors, sort]);
  const sortable = (key: StorySort, label: string, cls?: string) => {
    const active = sort.key === key;
    return (
      <th
        className={`lq-sortable${cls ? ` ${cls}` : ""}${active ? " lq-sorted" : ""}`}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() =>
            setSort((prev) =>
              prev.key === key
                ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
                : { key, dir: STORY_SORT_DIR[key] },
            )
          }
        >
          {label}
          <span className="lq-sort-caret">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  };
  if (stories.length === 0) return <div className="empty-note">No ranking data bundled.</div>;
  return (
    <>
      <table>
        <thead>
          <tr>
            {sortable("char", "Character")}
            <th>Entered top 100</th>
            <th className="data">Peak</th>
            {sortable("majors", "Majors", "data")}
            {sortable("lastMajor", "Last major")}
            <th>Best-ever rank</th>
            {sortable("current", "# of Top 100", "data")}
            <th>Current torchbearer</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={s.char}>
              <td>
                <span className="lq-race-who">
                  <Stock char={s.char} />
                  {s.char}
                </span>
              </td>
              <td>
                {/* Characters already in the first edition were around before
                    any ranking existed, so their arrival year is an upper
                    bound, not a date — the rep is who carried them that year. */}
                {eraYear(s.arrival.year)}
                {s.newcomer && <span className="lq-new">NEW</span>}{" "}
                via {s.arrival.rep.player} (#{s.arrival.rep.rank})
              </td>
              <td className="data">
                {s.peak.count} <span className="lq-dim">in {eraYear(s.peak.year)}</span>
              </td>
              <td className="data">{charMajors.get(s.char)?.count ?? "—"}</td>
              <td>
                {(() => {
                  const win = charMajors.get(s.char)?.last;
                  if (!win) return "—";
                  return (
                    <>
                      {win.name}{" "}
                      <span className="lq-dim">
                        ({win.year}, {win.player})
                      </span>
                    </>
                  );
                })()}
              </td>
              <td>
                #{s.bestEver.rep.rank} — {s.bestEver.rep.player} <span className="lq-dim">({eraYear(s.bestEver.year)})</span>
              </td>
              <td className="data">{s.current > 0 ? s.current : "—"}</td>
              <td>{s.currentTop ? `${s.currentTop.player} (#${s.currentTop.rank})` : <span className="lq-dim">out of top 100</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">
        "Entered" is the first edition where anyone ranked with the character as primary main — NEW marks characters
        that arrived after the first edition, e.g. a scene newcomer putting a character on the map; "≤" marks the ones
        already there in the first edition, which were around for however long before it. "Majors" and "Last
        major" count offline majors won by players whose primary main is that character — "—" means none on record.
        "# of Top 100" is how many rank in the latest edition. Click a column header to sort.
      </div>
      <RankingEraNote comps={comps} />
    </>
  );
}
