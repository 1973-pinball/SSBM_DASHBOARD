import { useEffect, useRef, useState } from "react";
import type { Account } from "../lib/types";
import { accountsError, blankAccount, cleanAccounts } from "../lib/types";
import { AccountFields } from "./AccountFields";
import { getCommunityConsent, setCommunityConsent } from "../lib/community";
import { cloudEnabled, signInWithGoogle } from "../lib/supabase";

interface Props {
  accounts: Account[];
  gameCounts: Map<string, number>;
  onSave: (accounts: Account[]) => void;
  onClose: () => void;
  isDemo: boolean;
}

/**
 * Add, rename, and remove accounts after setup. Before this existed the only
 * route to a second account was "Change folder", which wipes the cache — but
 * identity is resolved at query time (decision 1 in CLAUDE.md), so changing it
 * costs one recompute and never a re-parse.
 */
type ConsentState = "loading" | "signed-out" | "unavailable" | boolean;

export function AccountsEditor({ accounts, gameCounts, onSave, onClose, isDemo }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Never open on an empty list — there'd be nothing to type into.
  const [draft, setDraft] = useState<Account[]>(accounts.length ? accounts : [blankAccount(0)]);
  const [consent, setConsent] = useState<ConsentState>(isDemo || !cloudEnabled ? "unavailable" : "loading");
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
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

  useEffect(() => {
    if (isDemo || !cloudEnabled) return;
    let alive = true;
    void getCommunityConsent()
      .then((enabled) => {
        if (alive) setConsent(enabled === null ? "signed-out" : enabled);
      })
      .catch(() => {
        if (alive) setConsent("unavailable");
      });
    return () => { alive = false; };
  }, [isDemo]);

  const updateConsent = async (enabled: boolean) => {
    setConsentSaving(true);
    setConsentError(null);
    try {
      await setCommunityConsent(enabled);
      setConsent(enabled);
    } catch {
      setConsentError("Couldn't save that setting. Check your connection and try again.");
    } finally {
      setConsentSaving(false);
    }
  };

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
        aria-label="My account"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>My account</h2>
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

          <section className="community-consent">
            <div className="community-consent-head">
              <div>
                <div className="eyebrow">Community contribution</div>
                <h3>Help build anonymous Melee benchmarks</h3>
              </div>
              {typeof consent === "boolean" && <span className={`badge ${consent ? "good" : ""}`}>{consent ? "On" : "Off by default"}</span>}
            </div>
            <p>
              This is separate from private cloud sync. When enabled, a scheduled refresh may read your private parsed
              stats, remove identifiers, and include them only in aggregates that clear both contributor and game-count
              thresholds. It never publishes connect codes, names, emails, replay paths, exact activity timelines, or rows.
            </p>
            {consent === "loading" && <div className="hint">Checking your setting…</div>}
            {consent === "signed-out" && (
              <div className="community-consent-action">
                <span>Sign in before choosing whether to contribute.</span>
                <button
                  className="ghost"
                  onClick={() => {
                    setConsentError(null);
                    void signInWithGoogle().catch(() => {
                      setConsentError("Google sign-in couldn't start. Check your connection and try again.");
                    });
                  }}
                >
                  Sign in with Google
                </button>
              </div>
            )}
            {consent === "unavailable" && (
              <div className="hint">Community contribution is unavailable in demo/local-only mode.</div>
            )}
            {typeof consent === "boolean" && (
              <button
                type="button"
                role="switch"
                aria-checked={consent}
                className={`consent-switch ${consent ? "on" : ""}`}
                disabled={consentSaving}
                onClick={() => void updateConsent(!consent)}
              >
                <span className="switch-track" aria-hidden="true"><span /></span>
                <span>{consentSaving ? "Saving…" : consent ? "Contributing to future aggregate refreshes" : "Contribute anonymous stats"}</span>
              </button>
            )}
            {consentError && <div className="acct-error" role="alert">{consentError}</div>}
            <p className="privacy-pledge-inline">
              <b>Privacy promise:</b> replay-derived data is never published or distributed beyond your private cloud
              account without this explicit opt-in. Your email is used only to operate sign-in—never sold, published,
              used for marketing, or shared for outreach.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
