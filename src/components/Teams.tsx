import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import type { ResolvedTeamGame } from "../lib/types";
import {
  teamOverview, byTeammate, teamsByMyCharacter, teamsByOppCharacter, teamsByStage,
  teamsDamageOverview, byTeammateDamage, teamsDamageByWeek, teamsExecution,
} from "../lib/stats";
import { pct, num, int, duration, shortDate, winRateColor } from "../lib/format";
import { charName, stageName } from "../lib/melee";
import { Kpi } from "./Kpi";
import { axisStyle, tooltipStyle, gridStyle, dayTick } from "./chartStyle";

interface Props {
  games: ResolvedTeamGame[]; // filtered
  onSelectTeammate: (code: string) => void;
}

/** Win rate is the team's, not yours — in 2v2 there is no individual result. */
export function Teams({ games, onSelectTeammate }: Props) {
  const [tab, setTab] = useState<"overview" | "damage">("overview");

  if (games.length === 0) {
    return <div className="empty-note">No 2v2 games match the current filters.</div>;
  }

  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button role="tab" aria-selected={tab === "damage"} className={tab === "damage" ? "active" : ""} onClick={() => setTab("damage")}>
          Damage &amp; FF
        </button>
      </div>
      {tab === "overview" ? (
        <OverviewTab games={games} onSelectTeammate={onSelectTeammate} />
      ) : (
        <DamageTab games={games} onSelectTeammate={onSelectTeammate} />
      )}
    </>
  );
}

function OverviewTab({ games, onSelectTeammate }: Props) {
  const stats = useMemo(() => teamOverview(games), [games]);
  const mates = useMemo(() => byTeammate(games), [games]);
  const myChars = useMemo(() => teamsByMyCharacter(games), [games]);
  const oppChars = useMemo(() => teamsByOppCharacter(games), [games]);
  const stages = useMemo(() => teamsByStage(games), [games]);

  return (
    <>
      <div className="kpi-strip">
        <Kpi label="2v2 games" value={int(stats.games)} />
        <Kpi label="Team win rate" value={pct(stats.winRate)} />
        <Kpi label="Record" value={`${stats.wins}–${stats.losses}`} />
        <Kpi label="Teammates" value={int(stats.distinctTeammates)} />
        <Kpi label="Stocks taken / game" value={num(stats.stocksTakenPerGame, 2)} />
        <Kpi label="Stocks lost / game" value={num(stats.stocksLostPerGame, 2)} />
        <Kpi label="Avg length" value={duration(stats.avgGameSeconds)} />
        <Kpi
          label="Streak"
          value={stats.currentStreak ? `${stats.currentStreak.kind}${stats.currentStreak.length}` : "—"}
          accent={stats.currentStreak && stats.currentStreak.kind === "W" && stats.currentStreak.length >= 5 ? "gold" : undefined}
        />
      </div>

      <div className="panel">
        <h2>By teammate</h2>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Plays</th>
              <th className="data">Games</th>
              <th className="data">W–L</th>
              <th className="data">Win rate</th>
              <th className="data">Stocks taken / game</th>
              <th className="data">Last played</th>
            </tr>
          </thead>
          <tbody>
            {mates.slice(0, 100).map((r) => (
              <tr key={r.code} className="clickable" onClick={() => onSelectTeammate(r.code)}>
                <td style={{ fontFamily: "var(--font-data)" }}>{r.code}</td>
                <td>{r.displayName ?? "—"}</td>
                <td>{charName(r.topCharacter)}</td>
                <td className="data">{r.games.toLocaleString()}</td>
                <td className="data">
                  <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
                </td>
                <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
                <td className="data">{num(r.stocksTakenPerGame, 2)}</td>
                <td className="data">{shortDate(r.lastPlayed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {mates.length === 0 ? (
          <div className="hint">No teammates with connect codes — offline doubles don't record them.</div>
        ) : (
          <div className="hint">
            Stocks taken is the duo's combined count — the Damage &amp; FF tab has the per-player split. Click a row to
            filter to that teammate.
          </div>
        )}
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <h2>My character in 2v2</h2>
          <table>
            <thead>
              <tr>
                <th>Character</th>
                <th className="data">Games</th>
                <th className="data">W–L</th>
                <th className="data">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {myChars.map((r) => (
                <tr key={r.characterId}>
                  <td>{charName(r.characterId)}</td>
                  <td className="data">{r.games.toLocaleString()}</td>
                  <td className="data">
                    <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
                  </td>
                  <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Enemy team includes</h2>
          <table>
            <thead>
              <tr>
                <th>Character</th>
                <th className="data">Games</th>
                <th className="data">W–L</th>
                <th className="data">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {oppChars.map((r) => (
                <tr key={r.characterId}>
                  <td>{charName(r.characterId)}</td>
                  <td className="data">{r.games.toLocaleString()}</td>
                  <td className="data">
                    <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
                  </td>
                  <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">A game counts once per distinct enemy character, so rows sum above the game total.</div>
        </div>
      </div>

      <div className="panel">
        <h2>By stage</h2>
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th className="data">Games</th>
              <th className="data">W–L</th>
              <th className="data">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((r) => (
              <tr key={r.stageId}>
                <td>{stageName(r.stageId)}</td>
                <td className="data">{r.games.toLocaleString()}</td>
                <td className="data">
                  <span className="up">{r.wins}</span>–<span className="down">{r.losses}</span>
                </td>
                <td className="data" style={{ color: winRateColor(r.winRate) }}>{pct(r.winRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DamageTab({ games, onSelectTeammate }: Props) {
  const dmg = useMemo(() => teamsDamageOverview(games), [games]);
  const mates = useMemo(() => byTeammateDamage(games), [games]);
  const weeks = useMemo(() => teamsDamageByWeek(games), [games]);
  const exec = useMemo(() => teamsExecution(games), [games]);

  if (dmg.games === 0) {
    return (
      <div className="empty-note">
        No games with damage attribution match the current filters. Matrices are computed at parse time — if the library
        was cached before this feature, use Refresh to re-parse.
      </div>
    );
  }

  return (
    <>
      <div className="kpi-strip">
        <Kpi label="My damage / game" value={int(dmg.myDmgPerGame)} />
        <Kpi label="Teammate damage / game" value={int(dmg.mateDmgPerGame)} />
        <Kpi label="My damage share" value={pct(dmg.dmgShare)} />
        <Kpi label="My kills / game" value={num(dmg.myKillsPerGame, 2)} />
        <Kpi label="Teammate kills / game" value={num(dmg.mateKillsPerGame, 2)} />
        <Kpi label="FF I dealt / game" value={num(dmg.myFFPerGame, 1)} />
        <Kpi label="FF I took / game" value={num(dmg.mateFFPerGame, 1)} />
        <Kpi label="Enemy focus on me" value={pct(dmg.focusShare)} />
      </div>

      <div className="panel">
        <h2>Damage &amp; friendly fire — weekly per-game averages</h2>
        {weeks.length < 2 ? (
          <div className="empty-note">Not enough weeks of 2v2 games to chart yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={weeks} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid {...gridStyle} />
              <XAxis
                dataKey="week"
                tick={axisStyle}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                minTickGap={48}
                tickFormatter={dayTick}
              />
              <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
              <Tooltip
                {...tooltipStyle}
                labelFormatter={(v) => `Week of ${dayTick(String(v))}`}
                formatter={(v) => `${Number(v).toFixed(1)}%`}
              />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-data)" }} />
              <Line type="monotone" dataKey="myDmg" name="My damage" stroke="var(--accent)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="mateDmg" name="Teammate damage" stroke="#3fcf8e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="myFF" name="FF by me" stroke="#f0564f" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
              <Line type="monotone" dataKey="mateFF" name="FF by teammate" stroke="#f0a54f" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
        <div className="hint">
          Damage to enemies and friendly fire, averaged per game within each week. Solid lines are damage dealt to the
          enemy team; dashed lines are friendly fire.
        </div>
      </div>

      <div className="panel">
        <h2>By teammate</h2>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th className="data">Games</th>
              <th className="data">My dmg</th>
              <th className="data">Their dmg</th>
              <th className="data">My share</th>
              <th className="data">My kills</th>
              <th className="data">Their kills</th>
              <th className="data">FF by me</th>
              <th className="data">FF by them</th>
              <th className="data">FF kills (me–them)</th>
            </tr>
          </thead>
          <tbody>
            {mates.slice(0, 100).map((r) => (
              <tr key={r.code} className="clickable" onClick={() => onSelectTeammate(r.code)}>
                <td style={{ fontFamily: "var(--font-data)" }}>{r.code}</td>
                <td>{r.displayName ?? "—"}</td>
                <td className="data">{r.games.toLocaleString()}</td>
                <td className="data">{int(r.myDmgPerGame)}</td>
                <td className="data">{int(r.mateDmgPerGame)}</td>
                <td className="data">{pct(r.dmgShare)}</td>
                <td className="data">{num(r.myKillsPerGame, 2)}</td>
                <td className="data">{num(r.mateKillsPerGame, 2)}</td>
                <td className="data">{num(r.myFFPerGame, 1)}</td>
                <td className="data">{num(r.mateFFPerGame, 1)}</td>
                <td className="data">
                  {int(r.myFFKills)}–{int(r.mateFFKills)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          Damage and kills are per-game averages against the enemy team; FF columns are friendly-fire damage per game.
          FF kills are totals. Click a row to filter to that teammate.
        </div>
      </div>

      <div className="panel">
        <h2>Execution — me vs teammate</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th className="data">L-cancel</th>
              <th className="data">Inputs / min</th>
              <th className="data">Wavedashes / game</th>
              <th className="data">Dash dances / game</th>
              <th className="data">Grab success</th>
            </tr>
          </thead>
          <tbody>
            {exec.map((r) => (
              <tr key={r.who}>
                <td>{r.who}</td>
                <td className="data">{pct(r.lCancelPct)}</td>
                <td className="data">{int(r.ipm)}</td>
                <td className="data">{num(r.wavedashesPerGame, 1)}</td>
                <td className="data">{num(r.dashDancesPerGame, 1)}</td>
                <td className="data">{pct(r.grabSuccessPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          "Teammate" aggregates whoever you queued with under the current filters — scope to one partner via the
          teammate filter or by clicking a row above. Damage attribution uses each victim's last-hit-by, the same
          convention as other Slippi tools; self-destructs credit no one.
        </div>
      </div>
    </>
  );
}
