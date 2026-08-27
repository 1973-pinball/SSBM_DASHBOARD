import { useRef } from "react";
import { GoogleG } from "./GoogleG";

interface Props {
  onPickDirectory: () => void;
  onPickFiles: (files: FileList) => void;
  onDemo: () => void;
  /** Opens the scene-history tab, which needs no replays at all. */
  onBrowseHistory: () => void;
  /** Opens aggregate Community Lab data without requiring a replay folder. */
  onBrowseCommunity: () => void;
  supportsFsAccess: boolean;
  /** Non-null when cloud sync is configured: "sign in to restore" entry point. */
  onCloudSignIn: (() => void) | null;
  /** Null while idle; otherwise the number of cloud games fetched so far. */
  cloudRestoring: number | null;
  online: boolean;
  /** Chromium install prompt; null on unsupported/already-installed browsers. */
  onInstall: (() => void) | null;
}

export function Landing({
  onPickDirectory,
  onPickFiles,
  onDemo,
  onBrowseHistory,
  onBrowseCommunity,
  supportsFsAccess,
  onCloudSignIn,
  cloudRestoring,
  online,
  onInstall,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="landing">
      <div className="landing-brand" aria-label="SSBM Stats">
        <img src="/favicon.svg" alt="" aria-hidden="true" />
        <span>SSBM Stats</span>
      </div>
      <h1>
        Ready? <span className="accent">Go!</span>
      </h1>
      <p className="sub">
        Point this page at your Slippi replay folder and get a full statistical readout of your play: win rates by
        opponent, matchup, and stage, kill stats, and execution trends. Everything is parsed in your browser.
      </p>
      <div className="cta-row">
        {supportsFsAccess ? (
          <button className="primary" onClick={onPickDirectory} disabled={cloudRestoring !== null}>
            Select replay folder
          </button>
        ) : (
          <button className="primary" onClick={() => inputRef.current?.click()} disabled={cloudRestoring !== null}>
            Select replay folder
          </button>
        )}
        <button className="ghost" onClick={onDemo} disabled={cloudRestoring !== null}>
          Explore with demo data
        </button>
        {onInstall && (
          <button className="ghost" onClick={onInstall}>
            Install app
          </button>
        )}
        {onCloudSignIn && (
          <button
            className="ghost"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            onClick={onCloudSignIn}
            disabled={cloudRestoring !== null || !online}
          >
            <GoogleG size={15} />
            {cloudRestoring !== null
              ? cloudRestoring > 0
                ? `Restoring ${cloudRestoring.toLocaleString()} games…`
                : "Restoring your stats…"
              : online
                ? "Sign in with Google to restore"
                : "Cloud restore unavailable offline"}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        // Non-standard attribute; enables folder selection in Chromium/Firefox/Safari.
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(e) => e.target.files && onPickFiles(e.target.files)}
      />
      {/* Neither public tab touches replays, so they should not sit behind the
          folder picker or demo mode. */}
      <div className="landing-aside">
        No replays to hand? <button className="linky" onClick={onBrowseCommunity} disabled={cloudRestoring !== null}>Explore anonymous community benchmarks</button>
        {" "}or <button className="linky" onClick={onBrowseHistory} disabled={cloudRestoring !== null}>browse Melee tournament history</button>. Neither needs
        access to your replay folder.
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        Slippi saves replays to <span style={{ fontFamily: "var(--font-data)" }}>Documents\Slippi</span> by default
        (<span style={{ fontFamily: "var(--font-data)" }}>~/Slippi</span> on Mac/Linux) — the picker opens in Documents
        to get you close.
      </div>
      {/* This is the claim the whole product rests on, and it was set in 12px
          --faint under a divider. Sized and split so it can actually be read
          at the moment someone is deciding whether to sign in. */}
      <div className="privacy">
        <p className="privacy-lead"><b>Your replays never leave your machine.</b></p>
        {onCloudSignIn ? (
          <ul className="privacy-points">
            <li>Signing in syncs <b>only parsed stats</b> — never replay files — to your own private account.</li>
            <li>
              <b>Community contribution is a separate opt-in, off by default.</b> Turn it on any time from the{" "}
              Community tab or My Account to add your anonymised stats to the shared benchmarks.
            </li>
            <li>Your email is used only for sign-in — never sold, published, shared, or used for marketing or outreach.</li>
          </ul>
        ) : (
          <p className="privacy-points">No uploads, no accounts, no tracking.</p>
        )}
      </div>
      {/* Below the privacy panel on purpose: worth saying plainly, but it is
          not the claim someone is weighing when they decide to point this at
          their replay folder. */}
      <p className="landing-made-with">
        <b>Built with AI assistance.</b> AI coding tools were used throughout — and countless hours of hands-on
        refinement, testing, and design went in on top of them.
      </p>
      {!online && <div className="badge gold">Offline mode · demo, cached stats, and Melee history still work.</div>}
    </div>
  );
}
