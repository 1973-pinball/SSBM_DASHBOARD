import { useState } from "react";
import type { Account, ParseProgress } from "../lib/types";
import { accountsError, blankAccount, cleanAccounts } from "../lib/types";
import { AccountFields } from "./AccountFields";

export function ProgressBar({ p }: { p: ParseProgress }) {
  const fraction = p.total ? p.done / p.total : 0;
  return (
    <div className="progress-panel">
      <div className="progress-meta">
        {p.pass === "header" ? "Reading game headers…" : "Parsing replays…"} {p.done.toLocaleString()} /{" "}
        {p.total.toLocaleString()}
        {p.skippedCached > 0 ? ` (${p.skippedCached.toLocaleString()} cached)` : ""}
        {p.failed > 0 ? ` · ${p.failed} couldn't be parsed` : ""}
        {p.unreadable > 0 ? ` · ${p.unreadable} couldn't be opened` : ""}
        {p.deferred > 0 ? ` · ${p.deferred} still being written` : ""}
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(fraction * 100).toFixed(1)}%` }} />
      </div>
      {p.pass === "header" && (
        <div className="hint">Win rates, matchups and opponents first — execution stats follow on the second pass.</div>
      )}
    </div>
  );
}

interface IdentityProps {
  gameCounts: Map<string, number>;
  onConfirm: (accounts: Account[]) => void;
}

export function IdentityPicker({ gameCounts, onConfirm }: IdentityProps) {
  const [accounts, setAccounts] = useState<Account[]>([blankAccount(0)]);

  const error = accountsError(accounts);
  const filled = accounts.filter((a) => a.code.trim() !== "").length;
  // Don't scold an untouched form: "enter at least one" is only worth showing
  // once the user has actually started typing.
  const showError = error !== null && filled > 0;

  return (
    <div className="panel">
      <h2>What are your connect codes?</h2>
      <p>
        Enter every Slippi account you play on. A main and an alt in the same replay folder is normal — the dashboard
        pools them, and the Account filter splits them apart again. Labels are optional and show up as{" "}
        <b style={{ fontFamily: "var(--font-data)" }}>Main (ABCD#123)</b> in filters and tables.
      </p>

      <AccountFields accounts={accounts} onChange={setAccounts} gameCounts={gameCounts} />

      <div className="acct-actions">
        <button className="primary" disabled={error !== null} onClick={() => onConfirm(cleanAccounts(accounts))}>
          {filled > 1 ? `Continue with ${filled} accounts` : "Continue"}
        </button>
        {showError && (
          <span className="acct-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <p className="hint">You can add, rename, or remove accounts later without re-scanning your replays.</p>
    </div>
  );
}
