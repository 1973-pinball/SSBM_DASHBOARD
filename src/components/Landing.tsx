import { useRef } from "react";
import { GoogleG } from "./GoogleG";

interface Props {
  onPickDirectory: () => void;
  onPickFiles: (files: FileList) => void;
  onDemo: () => void;
  /** Opens the scene-history tab, which needs no replays at all. */
  onBrowseHistory: () => void;
  supportsFsAccess: boolean;
  /** Non-null when cloud sync is configured: "sign in to restore" entry point. */
  onCloudSignIn: (() => void) | null;
  cloudRestoring: boolean;
  online: boolean;
}

export function Landing({
  onPickDirectory,
  onPickFiles,
  onDemo,
  onBrowseHistory,
  supportsFsAccess,
  onCloudSignIn,
  cloudRestoring,
  online,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="landing">
      <h1>
        Ready? <span className="accent">Go!</span>
      </h1>
      <p className="sub">
        Point this page at your Slippi replay folder and get a full statistical readout of your play: win rates by
        opponent, matchup, and stage, kill stats, and execution trends. Everything is parsed in your browser.
      </p>
      <div className="cta-row">
        {supportsFsAccess ? (
          <button className="primary" onClick={onPickDirectory}>
            Select replay folder
          </button>
        ) : (
          <button className="primary" onClick={() => inputRef.current?.click()}>
            Select replay folder
          </button>
        )}
        <button className="ghost" onClick={onDemo}>
          Explore with demo data
        </button>
        {onCloudSignIn && (
          <button
            className="ghost"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            onClick={onCloudSignIn}
            disabled={cloudRestoring || !online}
          >
            <GoogleG size={15} />
            {cloudRestoring ? "Restoring your stats…" : online ? "Sign in with Google to restore" : "Cloud restore unavailable offline"}
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
      {/* Nothing on the history tab touches replays, so it shouldn't sit
          behind the folder picker or demo mode. */}
      <div className="landing-aside">
        No replays to hand? <button className="linky" onClick={onBrowseHistory}>Browse Melee tournament history</button> —
        every major since 2003 and the top 100 by character, no setup needed.
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        Slippi saves replays to <span style={{ fontFamily: "var(--font-data)" }}>Documents\Slippi</span> by default
        (<span style={{ fontFamily: "var(--font-data)" }}>~/Slippi</span> on Mac/Linux) — the picker opens in Documents
        to get you close.
      </div>
      <div className="privacy">
        Your replays never leave your machine.
        {onCloudSignIn
          ? " Signing in syncs only parsed stats — never replay files — to your own account."
          : " No uploads, no accounts, no tracking."}
      </div>
      {!online && <div className="badge gold">Offline mode · demo, cached stats, and Melee history still work.</div>}
    </div>
  );
}
