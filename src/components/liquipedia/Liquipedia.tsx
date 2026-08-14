import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DATA_AS_OF, MAJORS, PLAYERS, RANKING_EDITIONS, SOURCES } from "../../lib/liquipedia/data";
import type { Major } from "../../lib/liquipedia/types";
import { careerLeaderboard, compositionByEdition, majorsPerYear, sortedMajors } from "../../lib/liquipedia/select";
import { Kpi } from "../Kpi";
import { axisStyle, gridStyle, tooltipStyle } from "../chartStyle";
import { CharStorylinesTable, CompositionBars, CompositionExplorer, PodiumTimeline, Trailblazers } from "./CharComposition";
import { MajorsRace } from "./MajorsRace";

/** Ordinal, not categorical: a supermajor IS a major, so one hue, two steps. */
const TIER_COLOR = { major: "#5d51b8", supermajor: "#8f7ff7" } as const;

/**
 * Scene-history view built from a bundled Liquipedia snapshot — majors,
 * SSBMRank top-100 editions, and career winnings. Unlike every other tab
 * this is about the whole competitive scene, not the user's replays, so the
 * global filter bar deliberately does not apply.
 */
export function Liquipedia() {
  // Netplay-era events are excluded from every total on this tab: a week of an
  // online league isn't the same achievement as winning Genesis, and leaving
  // them in inflated the 2020–21 champions. They stay in the dataset flagged,
  // so the choice is visible and reversible rather than a silent omission.
  const majors = useMemo(() => MAJORS.filter((m) => !m.online), []);
  const onlineCount = MAJORS.length - majors.length;

  const years = useMemo(() => majorsPerYear(majors), [majors]);
  const comps = useMemo(() => compositionByEdition(RANKING_EDITIONS), []);
  const leaderboard = useMemo(() => careerLeaderboard(majors, PLAYERS), [majors]);
  const majorsByYear = useMemo(() => {
    const m = new Map<number, Major[]>();
    for (const major of sortedMajors(majors)) {
      const list = m.get(major.year) ?? [];
      list.push(major);
      m.set(major.year, list);
    }
    return m;
  }, [majors]);
  const supermajorCount = useMemo(() => majors.filter((m) => m.tier === "supermajor").length, [majors]);

  const latest = comps[comps.length - 1];
  const topChar = latest?.chars[0];
  const topPlayer = leaderboard[0];
  const firstYear = comps[0]?.edition.year ?? "";
  const lastYear = latest?.edition.year ?? "";

  if (majors.length === 0 && RANKING_EDITIONS.length === 0) {
    return <div className="empty-note">The bundled Liquipedia dataset is empty — regenerate src/lib/liquipedia/data.ts.</div>;
  }

  return (
    <>
      <div className="lq-scope-note">
        Scene-wide Melee history — the filter bar doesn't apply to this tab. Offline majors only:{" "}
        {onlineCount} online events from the 2020–21 netplay era are excluded from every count below.
      </div>
      <div className="kpi-strip">
        <Kpi label="Offline majors" value={String(majors.length)} delta={`${supermajorCount} supermajors`} />
        <Kpi label="Distinct champions" value={String(leaderboard.length)} />
        {topPlayer && <Kpi label="Most majors" value={topPlayer.player} delta={`${topPlayer.majors} titles`} />}
        {topChar && latest && (
          <Kpi
            label={`Top main, ${latest.edition.year}`}
            value={topChar.char}
            delta={`${topChar.count} of ${latest.edition.entries.length} ranked`}
          />
        )}
        <Kpi label="Ranking editions" value={String(RANKING_EDITIONS.length)} delta={`${firstYear}–${lastYear}`} />
      </div>

      <div className="panel">
        <h2>Majors per year</h2>
        {/* Two steps of one hue: major/supermajor is a tier, not two categories.
            The dim step sits under 3:1 on this surface, so the legend and the
            per-tournament tooltip below are its required relief. */}
        <div className="lq-legend">
          <span className="lq-legend-item">
            <span className="dot" style={{ background: TIER_COLOR.supermajor }} />
            Supermajor
          </span>
          <span className="lq-legend-item">
            <span className="dot" style={{ background: TIER_COLOR.major }} />
            Major
          </span>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={years} margin={{ top: 6, right: 12, bottom: 0, left: -24 }}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="year" tick={axisStyle} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              {...tooltipStyle}
              cursor={{ fill: "rgba(143, 127, 247, 0.08)" }}
              content={({ active, label }) => {
                if (!active || label === undefined) return null;
                const list = majorsByYear.get(Number(label)) ?? [];
                return (
                  <div style={tooltipStyle.contentStyle} className="lq-tip">
                    <div className="lq-tip-title">
                      {label} · {list.length} major{list.length === 1 ? "" : "s"}
                    </div>
                    {list.map((m) => (
                      <div key={m.name} className="lq-tip-row">
                        <span className="dot" style={{ background: TIER_COLOR[m.tier] }} />
                        <span className="lq-tip-event">{m.name}</span>
                        <b>{m.winner}</b>
                      </div>
                    ))}
                    {list.length === 0 && <div className="lq-tip-row lq-dim">No majors held this year</div>}
                  </div>
                );
              }}
            />
            <Bar dataKey="major" stackId="tier" fill={TIER_COLOR.major} isAnimationActive={false} />
            <Bar dataKey="supermajor" stackId="tier" fill={TIER_COLOR.supermajor} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <div className="hint">
          Tournaments Liquipedia classifies as Melee majors; supermajors are its Premier/Tier-1 events. Hover a year for
          the full card and each winner. 2020–21 look thin because the pandemic moved the circuit onto Slippi, and those
          online events aren't counted here.
        </div>
      </div>

      <div className="panel">
        <h2>The major titles race</h2>
        <MajorsRace majors={majors} players={PLAYERS} />
      </div>

      <div className="panel">
        <h2>Top 100 by main — over time</h2>
        <CompositionBars comps={comps} />
      </div>

      <div className="panel">
        <h2>Top 100 by main — year explorer</h2>
        <CompositionExplorer comps={comps} />
      </div>

      <div className="panel">
        <h2>Who held the top — ranked #1–3 by season</h2>
        <PodiumTimeline comps={comps} />
      </div>

      <div className="panel">
        <h2>Trailblazers — when each character arrived, and who brought it</h2>
        <Trailblazers comps={comps} />
      </div>

      <div className="panel">
        <h2>Character storylines</h2>
        <CharStorylinesTable comps={comps} />
      </div>

      <div className="panel">
        <h2>Shareable images</h2>
        <p className="lq-share-blurb">
          These are rendered from the same snapshot and regenerated whenever the data updates, so the links always point
          at the current picture — handy for sending to someone. The Share GIF buttons above export the same animations
          at whatever speed you've selected.
        </p>
        <ul className="lq-sources">
          <li>
            <a href="/share/melee-majors-race.gif" target="_blank" rel="noreferrer">
              Major titles race (animated GIF)
            </a>{" "}
            · <a href="/share/melee-majors-race.png" target="_blank" rel="noreferrer">still image</a>
          </li>
          <li>
            <a href="/share/melee-top100-by-main.gif" target="_blank" rel="noreferrer">
              Top 100 by main (animated GIF)
            </a>{" "}
            · <a href="/share/melee-top100-by-main.png" target="_blank" rel="noreferrer">still image</a>
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2>Sources</h2>
        <ul className="lq-sources">
          {SOURCES.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="hint">
          Data is a bundled snapshot compiled {DATA_AS_OF} from Liquipedia's Smash wiki (content licensed{" "}
          <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">
            CC BY-SA 3.0
          </a>
          ), including the pages above and individual player pages for winnings. Character stock icons are the same
          sprites the rest of the dashboard uses. Nothing on this tab reads your replays.
        </div>
      </div>
    </>
  );
}
