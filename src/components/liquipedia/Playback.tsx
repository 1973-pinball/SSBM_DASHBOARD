import type { ReactNode } from "react";
import { SPEEDS, type Playback } from "./usePlayback";
import { shareLabel, type ShareState } from "./useShareGif";

/** Play/pause + speed + scrubber row, with a caption for the current frame. */
export function Playbar({
  playback,
  max,
  sliderLabel,
  caption,
  ticks,
  valueText,
  onShare,
  shareState,
  onSpeedChange,
}: {
  playback: Playback;
  max: number;
  sliderLabel: string;
  caption: ReactNode;
  /** Optional tick labels under the slider, one per frame. */
  ticks?: string[];
  /** What frame `idx` actually is, spoken instead of the bare index. */
  valueText: string;
  /** Renders the animation to a GIF at the selected speed. */
  onShare?: () => void;
  shareState?: ShareState;
  /** Called when the speed changes, so a stale built GIF can be dropped. */
  onSpeedChange?: () => void;
}) {
  const { idx, playing, speed, setSpeed, atEnd, toggle, scrub } = playback;
  const ticksId = ticks ? `${sliderLabel.replace(/\W+/g, "-")}-ticks` : undefined;

  return (
    <div className="lq-controls">
      {/* Paused at the last frame on mount, so the first press restarts from
          the beginning rather than doing nothing. */}
      <button
        className="primary lq-play"
        onClick={toggle}
        aria-label={playing ? "Pause" : atEnd ? "Play from the beginning" : "Play"}
      >
        {playing ? "❚❚ Pause" : "▶ Play"}
      </button>

      <div className="lq-speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`lq-speed${s === speed ? " on" : ""}`}
            aria-pressed={s === speed}
            onClick={() => {
              setSpeed(s);
              onSpeedChange?.();
            }}
          >
            {s}×
          </button>
        ))}
      </div>

      {/* Sits with the transport rather than after the caption: it shares at
          whatever speed is selected, and on a narrow screen anything below the
          caption is several lines down and easy to miss. */}
      {onShare && (
        <button
          className={`ghost lq-share${shareState?.status === "ready" ? " ready" : ""}`}
          onClick={onShare}
          disabled={shareState?.status === "working"}
          title={
            shareState?.status === "ready"
              ? "Tap to open the share sheet"
              : "Save or send an animated GIF of this chart, timed to the speed selected here"
          }
        >
          {shareLabel(shareState ?? { status: "idle" })}
        </button>
      )}

      {/* aria-valuetext so the position is spoken as the event or season it
          represents; the raw frame index means nothing on its own. */}
      <input
        type="range"
        min={0}
        max={max}
        value={idx}
        onChange={(e) => scrub(Number(e.target.value))}
        aria-label={sliderLabel}
        aria-valuetext={valueText}
        {...(ticksId ? { list: ticksId } : {})}
      />
      {ticks && ticksId && (
        <datalist id={ticksId}>
          {ticks.map((t, i) => (
            <option key={`${t}-${i}`} value={i} label={t} />
          ))}
        </datalist>
      )}

      {/* Announced as the frame changes, including during autoplay. */}
      <span className="lq-frame-label" role="status" aria-live="polite">
        {caption}
      </span>

      {shareState?.status === "error" && (
        <span className="lq-share-error" role="alert">
          {shareState.message}
        </span>
      )}

    </div>
  );
}
