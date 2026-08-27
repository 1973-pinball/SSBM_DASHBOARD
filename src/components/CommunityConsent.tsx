import { useEffect, useState } from "react";
import { getCommunityConsent, setCommunityConsent } from "../lib/community";
import { cloudEnabled, signInWithGoogle } from "../lib/supabase";

type ConsentState = "loading" | "signed-out" | "unavailable" | boolean;

interface Props {
  isDemo: boolean;
  /**
   * `bar` is the slim strip above the topbar — the switch in front of everyone
   * who opens the dashboard, with the "does this expose my code?" answer next
   * to it. `feature` is the standalone panel on the Community tab, where
   * someone is already reading aggregates and is most likely to want to be in
   * them. `inline` is the copy inside My Account, which stays the canonical
   * place to find the setting again and turn it back off.
   */
  variant?: "inline" | "feature" | "bar";
  /** Jumps to the Community tab from the strip's copy. `bar` only. */
  onOpenCommunity?: () => void;
}

/**
 * The community-contribution opt-in.
 *
 * Shared rather than duplicated because it was only reachable from inside the
 * My Account dialog, under the accounts form — a setting nobody found unless
 * they already knew it existed. Each mount owns its own state, so two of them
 * on screen at once is fine; they just both read the same row.
 *
 * Discoverable is the goal, not persuasive: contribution stays off by default
 * and is never pre-selected here (see decision 6 and the privacy promise). The
 * switch is the only thing that changes it, and it says what it does.
 */
export function CommunityConsent({ isDemo, variant = "inline", onOpenCommunity }: Props) {
  const [consent, setConsent] = useState<ConsentState>(isDemo || !cloudEnabled ? "unavailable" : "loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const update = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await setCommunityConsent(enabled);
      setConsent(enabled);
    } catch {
      setError("Couldn't save that setting. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  // Nothing to offer in demo or a local-only build, and a dead panel is worse
  // than no panel. My Account keeps its copy so the setting still explains
  // itself when someone goes looking for it.
  if (variant !== "inline" && consent === "unavailable") return null;

  const signIn = () => {
    setError(null);
    void signInWithGoogle().catch(() => {
      setError("Google sign-in couldn't start. Check your connection and try again.");
    });
  };

  if (variant === "bar") {
    return (
      <div className="community-consent bar">
        {consent === "loading" && <span className="cc-bar-note">Checking your community setting…</span>}
        {consent === "signed-out" && (
          <>
            <span className="cc-bar-note">Sign in to add your stats to the anonymous community benchmarks.</span>
            <button className="ghost" onClick={signIn}>Sign in with Google</button>
          </>
        )}
        {typeof consent === "boolean" && (
          <>
            <button
              type="button"
              role="switch"
              aria-checked={consent}
              className={`consent-switch ${consent ? "on" : ""}`}
              disabled={saving}
              onClick={() => void update(!consent)}
            >
              <span className="switch-track" aria-hidden="true"><span /></span>
              <span>{saving ? "Saving…" : consent ? "Contributing anonymous stats" : "Contribute anonymous stats"}</span>
            </button>
            {/* The objection this answers is "does my code end up in there?",
                so it says so before the toggle is touched, not in a modal. */}
            <span className="cc-bar-note">
              <b>Your connect code, tag, and replay files are never shared.</b> Your stats are pooled into
              anonymous aggregates only on the{" "}
              {onOpenCommunity ? (
                <button type="button" className="linky" onClick={onOpenCommunity}>Community tab</button>
              ) : (
                "Community tab"
              )}{" "}
              — never published as rows, and only above contributor and game-count thresholds. Off by default,
              reversible any time.
            </span>
          </>
        )}
        {error && <span className="acct-error" role="alert">{error}</span>}
      </div>
    );
  }

  return (
    <section className={`community-consent ${variant}`}>
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
          <button className="ghost" onClick={signIn}>Sign in with Google</button>
        </div>
      )}
      {consent === "unavailable" && (
        <div className="hint">Community contribution is unavailable in demo/local-only mode.</div>
      )}
      {typeof consent === "boolean" && (
        <>
          <button
            type="button"
            role="switch"
            aria-checked={consent}
            className={`consent-switch ${consent ? "on" : ""}`}
            disabled={saving}
            onClick={() => void update(!consent)}
          >
            <span className="switch-track" aria-hidden="true"><span /></span>
            <span>{saving ? "Saving…" : consent ? "Contributing to future aggregate refreshes" : "Contribute anonymous stats"}</span>
          </button>
          {consent && !saving && (
            <div className="hint" role="status" aria-live="polite">
              Contribution queued for the next refresh. Community aggregates update every 15 minutes.
            </div>
          )}
        </>
      )}
      {error && <div className="acct-error" role="alert">{error}</div>}
      <p className="privacy-pledge-inline">
        <b>Privacy promise:</b> replay-derived data is never published or distributed beyond your private cloud
        account without this explicit opt-in. Your email is used only to operate sign-in — never sold, published,
        used for marketing, or shared for outreach.
      </p>
    </section>
  );
}
