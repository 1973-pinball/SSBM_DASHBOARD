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
        def: "Openings that started from a clean neutral exchange only — counter-attacks and trades excluded.",
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
        term: "My kill share",
        def: "Your kills ÷ your duo's combined kills with that teammate. Around 50% means even involvement; it measures participation, not carrying — a support player who takes every edgeguard setup can be “low share, high value.”",
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
