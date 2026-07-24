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
        def: "From a logistic regression fit on your filtered games. Each row: a game where that metric is one standard deviation above your average has this many times the odds of being a win, holding the other metrics in the table fixed. Values above 1× pull toward wins, below 1× toward losses. The shift columns translate the same effect into percentage points near an even game.",
      },
      {
        term: "Raw vs adjusted shift",
        def: "Raw is the simple association across all filtered games. Adjusted re-fits the model with fixed effects for the opponent (regulars with 15+ games), your character, the stage, and a time trend — so it asks whether more of the metric came with more wins within the same context. When a raw effect collapses after adjustment, the metric was riding along with context (you improved over time, or move more against certain opponents) rather than driving wins. The adjusted column is the one that answers 'what should I practice'.",
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
        def: "Your duo's combined stocks taken from (or lost to) the enemy team, from end-of-game state. The Damage & FF tab splits captures per player. Self-destructs count as stocks taken by the other team.",
      },
      {
        term: "Enemy team includes",
        def: "A game counts once for each distinct character on the enemy team, so a double-Fox team counts Fox once and the rows sum above the game total.",
      },
    ],
  },
  {
    title: "Teams — Damage & FF",
    items: [
      {
        term: "Damage attribution",
        def: "Slippi's own stat engine computes nothing for 4-player games, so this dashboard does its own frame pass: every point of damage (and every stock loss) is credited to the victim's last-hit-by player — the same convention other Slippi tools use. Self-destructs credit no one. Attribution can very occasionally be wrong when someone dies without being touched recently.",
      },
      {
        term: "My / teammate damage per game",
        def: "Damage dealt to the enemy team only — friendly fire is tracked separately, never mixed in. Kills per game are enemy stocks captured, same rule.",
      },
      {
        term: "Damage share / kill share",
        def: "Your slice of the duo's total enemy damage (or captures). 50% is an even carry; consistently above means you're the engine, below means you're the passenger — though roles (support Puff vs closer Fox) legitimately skew this.",
      },
      {
        term: "Friendly fire (FF)",
        def: "Damage dealt to your own teammate, shown per game in both directions — what you did to them and what they did to you. FF kills are the times a teammate's hit took the partner's stock. These come from same-team cells of the damage matrix.",
      },
      {
        term: "Enemy focus on me",
        def: "Of all the damage the enemy team dealt to your duo, the share aimed at you. Above 50% means they target you; useful for judging whether your teammate is getting camped or napping.",
      },
      {
        term: "Execution — me vs teammate",
        def: "L-cancel %, inputs/min and movement counts computed per player in doubles by running the singles stat machinery pairwise across teams. 'Teammate' aggregates whoever you queued with under the current filters.",
      },
    ],
  },
  {
    title: "Counterpicks (Stages tab)",
    items: [
      {
        term: "Stage × opponent character",
        def: "Your win rate on each stage against each opponent character. Read it as a counterpick sheet: within a character's column, green stages are picks and red ones are bans. Faded cells are below the sample threshold — treat them as anecdotes, not data.",
      },
      {
        term: "My character × stage",
        def: "The same grid keyed on your own character — where each of your characters over- or under-performs. Clicking any cell in either grid scopes the whole dashboard to that stage + character.",
      },
    ],
  },
  {
    title: "Sessions & tilt",
    items: [
      {
        term: "Session",
        def: "A run of consecutive games where each game starts within 30 minutes of the previous game ending. A gap longer than 30 minutes starts a new session. So a night of ranked with drink breaks is one session; morning and evening play on the same day are two.",
      },
      {
        term: "Win rate by position in session",
        def: "All sessions stacked up: your record in games 1–5 of a session, 6–10, and so on, compared against your baseline win rate. A red tail means your marathon sessions are donating rating.",
      },
      {
        term: "Tilt check",
        def: "Win rate conditioned on the streak you were on entering the game, within the same session — after a win, after 2+ wins, after a loss, after 2 losses, after 3+ losses. 'After 3+ losses' sitting far below baseline is the statistical signature of tilt. Streaks reset between sessions, and indeterminate games neither extend nor break a streak.",
      },
      {
        term: "Baseline",
        def: "Your overall win rate across all decided games in the current filter — the reference point the 'vs baseline' columns compare against.",
      },
    ],
  },
  {
    title: "Records",
    items: [
      {
        term: "Streaks & bests",
        def: "All records respect the current filters, so you can ask for your best streak with one character or in one time range. Dates shown are when the record was set (streaks: when the run ended).",
      },
      {
        term: "Perfect win",
        def: "A win with all 4 of your stocks intact — the opponent never took one.",
      },
      {
        term: "Best L-cancel day",
        def: "Highest single-day L-cancel rate among days with at least 100 attempts, so one clean three-aerial game can't take the crown.",
      },
      {
        term: "Nemesis / favorite victim",
        def: "The opponent (by connect code) you've lost to the most, and the one you've beaten the most. Raw counts, not rates — your nemesis is usually just whoever you play the most.",
      },
      {
        term: "FF grudge",
        def: "The teammate who friendly-fires you the hardest per game, and the one you damage most, each needing at least 5 games together so a single Falco-dair accident doesn't define a friendship.",
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
