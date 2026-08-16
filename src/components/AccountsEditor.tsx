import { useEffect, useRef, useState } from "react";
import type { Account } from "../lib/types";
import { accountsError, blankAccount, cleanAccounts } from "../lib/types";
import { AccountFields } from "./AccountFields";

interface Props {
  accounts: Account[];
  gameCounts: Map<string, number>;
  onSave: (accounts: Account[]) => void;
  onClose: () => void;
}

/**
 * Add, rename, and remove accounts after setup. Before this existed the only
 * route to a second account was "Change folder", which wipes the cache — but
 * identity is resolved at query time (decision 1 in CLAUDE.md), so changing it
 * costs one recompute and never a re-parse.
 */
export function AccountsEditor({ accounts, gameCounts, onSave, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Never open on an empty list — there'd be nothing to type into.
  const [draft, setDraft] = useState<Account[]>(accounts.length ? accounts : [blankAccount(0)]);
  // A text-selection drag starting in the dialog and released over the backdrop
  // dispatches its click on the overlay — only close when the press started there.
  const pressedOnOverlay = useRef(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab inside the dialog so keyboard users can't reach the dashboard behind the overlay.
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      // Non-empty: the focusables.length === 0 case returned above.
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === dialog) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || active === dialog) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const error = accountsError(draft);
  // Compare cleaned, so whitespace or a lower-case retype isn't "a change".
  const cleaned = cleanAccounts(draft);
  const changed =
    cleaned.length !== accounts.length ||
    cleaned.some((a, i) => a.code !== accounts[i]?.code || (a.label ?? "") !== (accounts[i]?.label ?? ""));

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        pressedOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnOverlay.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="My accounts"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>My accounts</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginTop: 4 }}>
            Every account listed here counts as you. Games are pooled across all of them, and the Account filter
            splits them back apart. Labels show up as <b>Main (ABCD#123)</b> in filters and tables.
          </p>

          <AccountFields accounts={draft} onChange={setDraft} gameCounts={gameCounts} />

          <div className="acct-actions">
            <button className="primary" disabled={error !== null || !changed} onClick={() => onSave(cleanAccounts(draft))}>
              Save
            </button>
            <button className="ghost" onClick={onClose}>
              Cancel
            </button>
            {error !== null && (
              <span className="acct-error" role="alert">
                {error}
              </span>
            )}
          </div>
          <p className="hint">
            Changing accounts re-reads the replays already in your cache — nothing is re-parsed and nothing is lost.
          </p>
        </div>
      </div>
    </div>
  );
}
