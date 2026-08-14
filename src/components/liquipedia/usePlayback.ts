import { useEffect, useState } from "react";

export const SPEEDS = [0.5, 1, 1.5, 2] as const;

/**
 * Shared transport for the animated bar charts: paused on mount at the latest
 * frame, so the default view is "today" rather than an animation the user
 * didn't ask for. Scrubbing pauses; pressing play at the end replays from the
 * start.
 */
export function usePlayback(length: number, baseMs: number) {
  const [idx, setIdx] = useState(Math.max(0, length - 1));
  const [playing, setPlaying] = useState(false);
  // 2x is the default: at 1x a 100-plus-step race is a slog to watch and the
  // exported GIF inherits whatever is selected here.
  const [speed, setSpeed] = useState<number>(2);

  // Re-armed each frame so the stop condition lives here rather than inside a
  // state updater, which has to stay pure.
  useEffect(() => {
    if (!playing) return;
    if (idx >= length - 1) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setIdx((i) => i + 1), baseMs / speed);
    return () => window.clearTimeout(id);
  }, [playing, idx, length, baseMs, speed]);

  return {
    idx: Math.min(idx, Math.max(0, length - 1)),
    playing,
    speed,
    setSpeed,
    atEnd: idx >= length - 1,
    toggle: () => {
      if (!playing && idx >= length - 1) setIdx(0);
      setPlaying(!playing);
    },
    scrub: (n: number) => {
      setPlaying(false);
      setIdx(n);
    },
  };
}

export type Playback = ReturnType<typeof usePlayback>;
