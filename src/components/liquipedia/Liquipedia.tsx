import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DATA_AS_OF, MAJORS, PLAYERS, RANKING_EDITIONS, SOURCES } from "../../lib/liquipedia/data";
import type { Major } from "../../lib/liquipedia/types";
import { careerLeaderboard, compositionByEdition, majorsPerYear, sortedMajors } from "../../lib/liquipedia/select";
import { Kpi } from "../Kpi";
import { axisStyle, gridStyle, tooltipStyle } from "../chartStyle";
import { CharStorylinesTable, CompositionArea, CompositionExplorer, PodiumTimeline, Trailblazers } from "./CharComposition";
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
  const years = useMemo(() => majorsPerYear(MAJORS), []);
  const comps = useMemo(() => compositionByEdition(RANKING_EDITIONS), []);
  const leaderboard = useMemo(() => careerLeaderboard(MAJORS, PLAYERS), []);
  const majorsByYear = useMemo(() => {
    const m = new Map<number, Major[]>();
    for (const major of sortedMajors(MAJORS)) {
      const list = m.get(major.year) ?? [];
      list.push(major);
      m.set(major.year, list);
    }
    return m;
  }, []);
  const supermajorCount = useMemo(() => MAJORS.filter((m) => m.tier === "supermajor").length, []);

  const latest = comps[comps.length - 1];
  const topChar = latest?.chars[0];
  const topPlayer = leaderboard[0];
  const firstYear = comps[0]?.edition.year ?? "";
  const lastYear = latest?.edition.year ?? "";

  if (MAJORS.length === 0 && RANKING_EDITIONS.length === 0) {
    return <div className="empty-note">The bundled Liquipedia dataset is empty — regenerate src/lib/liquipedia/data.ts.</div>;
  }

  return (
    <>
      <div className="lq-scope-note">Scene-wide Melee history — the filter bar doesn't apply to this tab.</div>
      <div className="kpi-strip">
        <Kpi label="Majors held" value={String(MAJORS.length)} delta={`${supermajorCount} supermajors`} />
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
          the full card and each winner. 2021 is thin and 2020 leans online — the pandemic moved the circuit to Slippi.
        </div>
      </div>

      <div className="panel">
        <h2>The major titles race</h2>
        <MajorsRace majors={MAJORS} players={PLAYERS} />
      </div>

      <div className="panel">
        <h2>Top 100 by main — over time</h2>
        <CompositionArea comps={comps} />
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
