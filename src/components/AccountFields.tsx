import type { Account } from "../lib/types";
import { blankAccount, isValidCode, normalizeCode } from "../lib/types";

interface Props {
  accounts: Account[];
  onChange: (accounts: Account[]) => void;
  /**
   * Connect code → games in the parsed library. Used only to confirm a typed
   * code actually occurs, never to suggest one: a mistyped code would otherwise
   * produce an empty dashboard with nothing on screen explaining why.
   */
  gameCounts: Map<string, number>;
}

/**
 * The account list shared by the first-run identity step and the Accounts
 * editor. The user states which accounts are theirs — nothing is guessed from
 * the replays. Array order is display order, and the first entry is the one
 * that titles the player card.
 */
export function AccountFields({ accounts, onChange, gameCounts }: Props) {
  const update = (index: number, patch: Partial<Account>) =>
    onChange(accounts.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  const remove = (index: number) => onChange(accounts.filter((_, i) => i !== index));

  return (
    <div className="acct-fields">
      <div className="acct-list">
        {accounts.map((a, i) => {
          const typed = a.code.trim() !== "";
          const code = normalizeCode(a.code);
          const valid = typed && isValidCode(code);
          const count = valid ? (gameCounts.get(code) ?? 0) : null;
          return (
            // Index keys: rows have no stable id, and keying on the code would
            // remount the input on every keystroke and lose focus.
            <div className="acct-row" key={i}>
              <input
                className="acct-code-input"
                type="text"
                value={a.code}
                placeholder="ABCD#123"
                autoComplete="off"
                spellCheck={false}
                aria-label={`Connect code ${i + 1}`}
                onChange={(e) => update(i, { code: e.target.value })}
              />
              <input
                className="acct-label"
                type="text"
                value={a.label ?? ""}
                placeholder="Label — e.g. Main"
                maxLength={24}
                aria-label={`Label for account ${i + 1}`}
                // Stored untrimmed so a trailing space can be typed; cleaned on save.
                onChange={(e) => update(i, { label: e.target.value.trim() === "" ? null : e.target.value })}
              />
              <span className={statusClass(typed, valid, count)}>{statusText(typed, valid, count)}</span>
              <button
                className="ghost acct-remove"
                onClick={() => remove(i)}
                aria-label={`Remove account ${i + 1}`}
                title="Remove"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <button className="ghost acct-add-btn" onClick={() => onChange([...accounts, blankAccount(accounts.length)])}>
        + Add {accounts.length ? "another account" : "an account"}
      </button>
    </div>
  );
}

function statusText(typed: boolean, valid: boolean, count: number | null): string {
  if (!typed) return "";
  if (!valid) return "check the format";
  if (count === 0) return "no games in this folder";
  return `${count!.toLocaleString()} games`;
}

function statusClass(typed: boolean, valid: boolean, count: number | null): string {
  if (!typed) return "acct-status";
  // A well-formed code that matches nothing is the likely-typo case, and the
  // one worth flagging in gold — it's the difference between "you're set up"
  // and "your dashboard will be empty and you won't know why".
  if (!valid) return "acct-status bad";
  if (count === 0) return "acct-status warn";
  return "acct-status ok";
}
