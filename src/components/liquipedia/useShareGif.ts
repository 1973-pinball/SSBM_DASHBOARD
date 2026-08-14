import { useCallback, useRef, useState } from "react";
import { shareGif, type ShareGifOptions } from "./gifShare";

export type ShareState = { status: "idle" } | { status: "working"; pct: number } | { status: "error"; message: string };

/**
 * Drives one Share button: builds the GIF, reports progress, and refuses to
 * start twice. Rendering is a few seconds of main-thread work, so the button
 * has to visibly say what it's doing rather than appear stuck.
 */
export function useShareGif() {
  const [state, setState] = useState<ShareState>({ status: "idle" });
  const busy = useRef(false);

  const run = useCallback(async (build: () => Promise<Omit<ShareGifOptions, "onProgress">>) => {
    if (busy.current) return;
    busy.current = true;
    setState({ status: "working", pct: 0 });
    try {
      const opts = await build();
      await shareGif({ ...opts, onProgress: (pct) => setState({ status: "working", pct }) });
      setState({ status: "idle" });
    } catch (err) {
      console.error(err);
      setState({ status: "error", message: "Couldn't build the GIF — try again." });
    } finally {
      busy.current = false;
    }
  }, []);

  return { state, run };
}

export const shareLabel = (state: ShareState): string =>
  state.status === "working" ? `Rendering ${Math.round(state.pct * 100)}%` : "Share GIF";
