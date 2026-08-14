import type { ReactNode } from "react";
import { SPEEDS, type Playback } from "./usePlayback";

/** Play/pause + speed + scrubber row, with a caption for the current frame. */
export function Playbar({
  playback,
  max,
  sliderLabel,
  caption,
  ticks,
  valueText,
}: {
  playback: Playback;
  max: number;
  sliderLabel: string;
  caption: ReactNode;
  /** Optional tick labels under the slider, one per frame. */
  ticks?: string[];
  /** What frame `idx` actually is, spoken instead of the bare index. */
  valueText: string;
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
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>

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
    </div>
  );
}
