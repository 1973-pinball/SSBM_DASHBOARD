import type { ParseProgress } from "../lib/types";
import type { CodeCandidate } from "../lib/stats";

export function ProgressBar({ p }: { p: ParseProgress }) {
  const fraction = p.total ? p.done / p.total : 0;
  return (
    <div className="progress-panel">
      <div className="progress-meta">
        Parsing replays… {p.done.toLocaleString()} / {p.total.toLocaleString()}
        {p.skippedCached > 0 ? ` (${p.skippedCached.toLocaleString()} cached)` : ""}
        {p.errors > 0 ? ` · ${p.errors} unreadable` : ""}
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(fraction * 100).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

interface IdentityProps {
  candidates: CodeCandidate[];
  onConfirm: (codes: string[]) => void;
}

export function IdentityPicker({ candidates, onConfirm }: IdentityProps) {
  const top = candidates[0];
  if (!top) {
    return (
      <div className="panel">
        <h2>Who are you?</h2>
        <p>
          No connect codes were found in these replays (offline games?). Identity resolution for offline replays is
          on the roadmap; for now the dashboard needs netplay replays.
        </p>
      </div>
    );
  }
  return (
    <div className="panel">
      <h2>Confirm your identity</h2>
      <p>
        You appear to be <b style={{ fontFamily: "var(--font-data)" }}>{top.code}</b>
        {top.displayName ? ` (“${top.displayName}”)` : ""} — found in {(top.share * 100).toFixed(0)}% of games.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button className="primary" onClick={() => onConfirm([top.code])}>
          Yes, that&rsquo;s me
        </button>
        {candidates.slice(1, 5).map((c) => (
          <button key={c.code} onClick={() => onConfirm([c.code])}>
            I&rsquo;m {c.code} ({c.games})
          </button>
        ))}
      </div>
      <p className="hint">Playing on multiple accounts? Pick your main now — you can add alt codes later in the header.</p>
    </div>
  );
}
