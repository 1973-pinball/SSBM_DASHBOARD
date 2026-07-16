import { useRef } from "react";

interface Props {
  onPickDirectory: () => void;
  onPickFiles: (files: FileList) => void;
  onDemo: () => void;
  supportsFsAccess: boolean;
}

export function Landing({ onPickDirectory, onPickFiles, onDemo, supportsFsAccess }: Props) {
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
      <div className="privacy">Your replays never leave your machine. No uploads, no accounts, no tracking.</div>
    </div>
  );
}
