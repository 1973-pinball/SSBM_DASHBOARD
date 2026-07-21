import { useMemo, useState } from "react";
import type { ResolvedGame } from "../lib/types";
import { WIN_MODEL_FEATURES, fitWinModel, quartileWinRates } from "../lib/model";
import type { CoefRow } from "../lib/model";
import { num, pct, winRateColor } from "../lib/format";

/**
 * "What predicts my wins?" — a logistic regression over per-game metrics plus
 * a model-free quartile cross-check. Interpretation-first: standardized
 * coefficients, plain-language effect sizes, and loud caveats.
 */

const evidence = (p: number): { label: string; dim: boolean } => {
  if (p < 0.01) return { label: "strong", dim: false };
  if (p < 0.05) return { label: "moderate", dim: false };
  if (p < 0.1) return { label: "weak", dim: true };
  return { label: "—", dim: true };
};

/** Divide-by-4 rule: max change in win probability per +1 SD, in points. */
const probPoints = (coef: number): number => (coef / 4) * 100;

function CoefBar({ coef, max }: { coef: number; max: number }) {
  const frac = Math.min(1, Math.abs(coef) / max);
  const color = coef >= 0 ? "#3fcf8e" : "#f0564f";
  return (
    <div style={{ display: "flex", alignItems: "center", height: 14 }}>
      <div style={{ width: "50%", display: "flex", justifyContent: "flex-end" }}>
        {coef < 0 && <div style={{ width: `${frac * 100}%`, height: 8, background: color, borderRadius: 2, opacity: 0.85 }} />}
      </div>
      <div style={{ width: 1, alignSelf: "stretch", background: "#34305a" }} />
      <div style={{ width: "50%" }}>
        {coef >= 0 && <div style={{ width: `${frac * 100}%`, height: 8, background: color, borderRadius: 2, opacity: 0.85 }} />}
      </div>
    </div>
  );
}

export function Insights({ games }: { games: ResolvedGame[] }) {
  const [includeOutcome, setIncludeOutcome] = useState(false);

  const features = useMemo(
    () => WIN_MODEL_FEATURES.filter((f) => f.group === "execution" || includeOutcome),
    [includeOutcome],
  );
  const model = useMemo(() => fitWinModel(games, features), [games, features]);
  const quartiles = useMemo(() => quartileWinRates(games, features), [games, features]);

  const maxCoef = useMemo(
    () => Math.max(0.1, ...(model?.coefs.map((c) => Math.abs(c.coef)) ?? [])),
    [model],
  );

  const toggle = (
    <div className="chip-row" style={{ marginBottom: 12 }}>
      <button
        className={`chip ${!includeOutcome ? "on" : ""}`}
        aria-pressed={!includeOutcome}
        style={!includeOutcome ? { borderColor: "var(--accent)" } : undefined}
        onClick={() => setIncludeOutcome(false)}
      >
        <span className="dot" style={{ background: "var(--accent)", opacity: !includeOutcome ? 1 : 0.35 }} />
        Habits only
      </button>
      <button
        className={`chip ${includeOutcome ? "on" : ""}`}
        aria-pressed={includeOutcome}
        style={includeOutcome ? { borderColor: "#e8b54d" } : undefined}
        onClick={() => setIncludeOutcome(true)}
      >
        <span className="dot" style={{ background: "#e8b54d", opacity: includeOutcome ? 1 : 0.35 }} />
        + outcome-linked stats
      </button>
    </div>
  );

  if (!model) {
    return (
      <div className="panel">
        <h2>What predicts your wins</h2>
        {toggle}
        <div className="empty-note">
          Not enough decided games in the current filter to fit a model — need at least 40 games with every metric
          measurable and 10+ wins and losses.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h2>What predicts your wins — logistic regression</h2>
        {toggle}
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th style={{ width: "22%" }}>Pull on win odds</th>
              <th className="data">Odds × per +1 SD</th>
              <th className="data">≈ win-prob shift</th>
              <th className="data">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {model.coefs.map((c: CoefRow) => {
              const ev = evidence(c.p);
              return (
                <tr key={c.key} style={ev.dim ? { opacity: 0.55 } : undefined}>
                  <td>
                    {c.label}
                    {c.group === "outcome" && (
                      <span className="tag" style={{ marginLeft: 6 }}>outcome-linked</span>
                    )}
                  </td>
                  <td><CoefBar coef={c.coef} max={maxCoef} /></td>
                  <td className="data">{num(c.oddsPerSd, 2)}×</td>
                  <td className="data" style={{ color: c.coef >= 0 ? "#3fcf8e" : "#f0564f" }}>
                    {c.coef >= 0 ? "+" : ""}{num(probPoints(c.coef), 1)} pp
                  </td>
                  <td className="data">{ev.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="hint">
          Fit on {model.n.toLocaleString()} decided games (win rate {pct(model.baseRate, 0)}) · pseudo-R²{" "}
          {num(model.mcfaddenR2, 2)} · AUC {num(model.auc, 2)}
          {model.dropped.length > 0 && <> · dropped (no variance): {model.dropped.join(", ")}</>}
          <br />
          Each row: holding the other metrics fixed, a game where this metric is one standard deviation above your
          average has that many times the odds of being a win; "win-prob shift" is the same effect in percentage
          points near a 50% game. Faded rows are indistinguishable from noise at this sample size.
        </div>
      </div>

      <div className="panel">
        <h2>Win rate by quartile — no model, just buckets</h2>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th className="data">Q1 (low)</th>
              <th className="data">Q2</th>
              <th className="data">Q3</th>
              <th className="data">Q4 (high)</th>
              <th className="data">Q4 − Q1</th>
            </tr>
          </thead>
          <tbody>
            {quartiles.map((q) => (
              <tr key={q.key}>
                <td>{q.label}</td>
                {q.quartiles.map((b, i) => (
                  <td key={i} className="data" style={{ color: winRateColor(b.winRate) }} title={`${num(b.lo, 1)}–${num(b.hi, 1)} · ${b.n} games`}>
                    {pct(b.winRate, 0)}
                  </td>
                ))}
                <td className="data" style={{ color: q.spread >= 0 ? "#3fcf8e" : "#f0564f" }}>
                  {q.spread >= 0 ? "+" : ""}{num(q.spread * 100, 0)} pp
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          Games sorted by each metric and cut into four equal buckets; each cell is the win rate in that bucket (hover
          for the value range). Agreement with the regression table above is a good sign; disagreement usually means
          the effect belongs to a correlated metric.
        </div>
      </div>

      <div className="panel">
        <h2>Reading this honestly</h2>
        <div className="hint" style={{ fontSize: 13, lineHeight: 1.6 }}>
          <b>Correlation, not causation.</b> These are associations across your games — "my wins look like this", not
          "doing this causes wins". Nothing here controls for opponent strength: if you wavedash more against weaker
          opponents, wavedashing gets credit it didn't earn. Filter to a single opponent or rank range above to tighten
          that.
          {includeOutcome && (
            <>
              <br />
              <b>Outcome-linked stats are partly the win itself.</b> Openings/kill, neutral-win share, damage/opening
              move mechanically with winning — they'll dominate the table without telling you what to practice. That's
              why the default view is habits only. Openings/kill is also only defined in games where you took a stock,
              which skews its sample toward wins.
            </>
          )}
          {model.collinear.length > 0 && (
            <>
              <br />
              <b>Correlated metrics split credit:</b>{" "}
              {model.collinear.map((c, i) => (
                <span key={i}>
                  {i > 0 && "; "}
                  {c.a} ↔ {c.b} (r = {num(c.r, 2)})
                </span>
              ))}
              . The regression divides one shared effect between them — read them as a bundle, and trust the quartile
              table for each one alone.
            </>
          )}
          {!model.converged && (
            <>
              <br />
              <b>Note:</b> the fit stopped before full convergence — treat coefficients as approximate.
            </>
          )}
        </div>
      </div>
    </>
  );
}
