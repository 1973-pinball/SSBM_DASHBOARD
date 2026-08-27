import type { CopyState } from "./useCardExport";

/** Download / copy row shared by the player card and the records card. */
export function CardActions({
  copied,
  onDownload,
  onCopy,
}: {
  copied: CopyState;
  onDownload: () => Promise<void>;
  onCopy: () => Promise<void>;
}) {
  return (
    <div className="sc-actions">
      <button className="primary" onClick={() => void onDownload()}>Download PNG</button>
      <button onClick={() => void onCopy()}>
        {copied === "ok" ? "Copied!" : copied === "fail" ? "Copy failed" : "Copy image"}
      </button>
      <span className="hint" style={{ margin: 0 }}>Rendered in your browser — share it wherever you like.</span>
    </div>
  );
}
