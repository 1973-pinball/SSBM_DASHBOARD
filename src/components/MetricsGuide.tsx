import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

const SECTIONS: { title: string; items: { term: string; def: string }[] }[] = [
  {
    title: "Results",
    items: [
      {
        term: "Win rate",
        def: "Wins ÷ decided games. Games under 30 seconds or with no determinable result (some quit-outs) don't count toward the denominator — they show as “n/a” in the game log.",
      },
      {
        term: "Kills / deaths per game",
        def: "Stocks you took (or lost) per game, averaged over the filtered set. 4–0 sweeps and last-stock nail-biters weigh the same.",
      },
      {
        term: "Damage per game",
        def: "Total percent you dealt per game, averaged over the filtered set. Includes damage on stocks you didn't close out.",
      },
      {
        term: "Streak",
        def: "Current run of consecutive wins (W) or losses (L) over decided games, most recent first.",
      },
    ],
  },
  {
    title: "Neutral & punish",
    items: [
      {
        term: "Opening (conversion)",
        def: "Counted every time you start a punish: you hit the opponent out of neutral — a clean neutral win, a counter-attack while escaping their punish, or a trade. The opening ends when they regain control and hit you back, or when they die. You usually get several openings per stock.",
      },
      {
        term: "Openings per kill",
        def: "Openings started ÷ kills. Lower is better: 3.0 means you win neutral three times for every stock you actually take — the other two punishes got dropped. Even top players usually sit around 2–3.",
      },
      {
        term: "Damage per opening",
        def: "Total damage dealt ÷ openings. How much each neutral win costs the opponent on average. Low DPO with a decent win rate = you win neutral a lot but drop punishes; high DPO = when you get in, you make it count.",
      },
      {
        term: "Neutral wins",
        def: "Openings that started from a clean neutral exchange only — counter-attacks and trades excluded. The share % is your count ÷ the game total, so over 50% means you won neutral more often than they did.",
      },
      {
        term: "Counter hits",
        def: "Openings you earned by hitting the opponent during their punish on you — escaping pressure and turning it around, rather than winning a clean neutral exchange.",
      },
      {
        term: "Beneficial trades",
        def: "Both players hit each other at once, and the trade favored you — either your hit killed and theirs didn't, or yours simply dealt more damage.",
      },
    ],
  },
  {
    title: "Execution",
    items: [
      {
        term: "L-cancel %",
        def: "Successful L-cancels ÷ attempts. An attempt is any aerial landing where an L-cancel was possible; success halves your landing lag.",
      },
      {
        term: "Inputs per minute",
        def: "Total controller inputs (buttons, sticks, triggers) per minute of game time. A speed gauge, not a quality one — high IPM with low damage per opening is just noise.",
      },
      {
        term: "Actions per game",
        def: "Counts of detected movement and defensive actions — rolls, air dodges, spot dodges, wavedashes, wavelands, dash dances, ledge grabs, grabs. High roll counts usually signal panic options; wavedash/dash-dance volume tracks movement-heavy play. The per-minute column is fairer when comparing filters with different game lengths.",
      },
      {
        term: "Grabs",
        def: "All grab attempts (landed + whiffed) — standing, dash, and out-of-shield together. Replay stats can't isolate shield grabs specifically; that needs frame-level analysis, which is a possible future opt-in feature. The game log drill-down shows landed/attempts with the success rate.",
      },
    ],
  },
  {
    title: "Insights (win model)",
    items: [
      {
        term: "Odds × per +1 SD",
        def: "From a logistic regression fit on your filtered games. Each row: a game where that metric is one standard deviation above your average has this many times the odds of being a win, holding the other metrics in the table fixed. Values above 1× pull toward wins, below 1× toward losses. The win-prob column translates the same effect into percentage points near an even game.",
      },
      {
        term: "Evidence",
        def: "How distinguishable the effect is from noise at your sample size (strong ≈ p<0.01, moderate ≈ p<0.05, weak ≈ p<0.1). Faded rows could easily be chance — more games sharpen these.",
      },
      {
        term: "Win rate by quartile",
        def: "The model-free cross-check: games sorted by the metric, cut into four equal buckets, win rate per bucket. If the regression and the quartiles disagree, the effect usually belongs to a correlated metric the regression is controlling for.",
      },
      {
        term: "Habits vs outcome-linked",
        def: "Habits (L-cancel %, movement per minute) are things you can practice. Outcome-linked stats (openings/kill, neutral-win share) partly ARE the win, so they dominate any model without saying what to change — that's why they're off by default. All of it is correlation across your games, not causation, and none of it controls for how strong the opponent was.",
      },
    ],
  },
  {
    title: "Teams (2v2)",
    items: [
      {
        term: "Team win rate",
        def: "Win/loss is decided per team, not per player — there is no individual result in doubles. The same 30-second / indeterminate rules apply.",
      },
      {
        term: "Stocks taken / lost",
        def: "Your duo's combined stocks taken from (or lost to) the enemy team, from end-of-game state. Per-player stats — kills, damage, L-cancels — don't exist in 2v2 replays: Slippi's stat engine only computes them for singles, so team-level stocks are the honest measure. Self-destructs count as stocks taken by the other team.",
      },
      {
        term: "Enemy team includes",
        def: "A game counts once for each distinct character on the enemy team, so a double-Fox team counts Fox once and the rows sum above the game total.",
      },
    ],
  },
];

export function MetricsGuide({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Metrics guide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Metrics guide</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <dl>
                {s.items.map((it) => (
                  <div key={it.term} className="metric-def">
                    <dt>{it.term}</dt>
                    <dd>{it.def}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="hint">
            Neutral and punish metrics come from slippi-js conversion detection over the replay's frame data; they exist only
            for games where that data is present.
          </p>
        </div>
      </div>
    </div>
  );
}
