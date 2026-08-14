import { useCallback, useRef, useState } from "react";
import { buildGifFile, canShareFile, downloadFile, shareFile, type BuildGifOptions } from "./gifShare";

export type ShareState =
  | { status: "idle" }
  | { status: "working"; pct: number }
  /** Built and waiting for a second tap, so `share()` gets a live gesture. */
  | { status: "ready"; file: File }
  | { status: "error"; message: string };

/**
 * Drives one Share button.
 *
 * Where the browser can open a share sheet (phones), this is two taps: the
 * first renders, the second sends. That split isn't a UX preference — the Web
 * Share API only runs while a user gesture is still live, and encoding takes
 * far longer than that window, so sharing at the end of the render is rejected
 * and the browser falls back to a download. Desktop browsers can't share files
 * at all, so there the first tap renders and saves in one go.
 */
export function useShareGif() {
  const [state, setState] = useState<ShareState>({ status: "idle" });
  const busy = useRef(false);

  const run = useCallback(async (build: () => Promise<Omit<BuildGifOptions, "onProgress">>) => {
    if (busy.current) return;
    busy.current = true;
    setState({ status: "working", pct: 0 });
    try {
      const opts = await build();
      const file = await buildGifFile({ ...opts, onProgress: (pct) => setState({ status: "working", pct }) });
      if (canShareFile(file)) {
        setState({ status: "ready", file });
      } else {
        downloadFile(file);
        setState({ status: "idle" });
      }
    } catch (err) {
      console.error(err);
      setState({ status: "error", message: "Couldn't build the GIF — try again." });
    } finally {
      busy.current = false;
    }
  }, []);

  /** Second tap: hand the built file to the OS. No awaits before share(). */
  const send = useCallback((file: File) => {
    void shareFile(file).then((ok) => {
      // If the sheet refused outright, saving is better than a dead button.
      if (!ok) downloadFile(file);
      setState({ status: "idle" });
    });
  }, []);

  /** Drop a built file that no longer matches the settings on screen. */
  const reset = useCallback(() => {
    setState((s) => (s.status === "ready" || s.status === "error" ? { status: "idle" } : s));
  }, []);

  return { state, run, send, reset };
}

export const shareLabel = (state: ShareState): string => {
  switch (state.status) {
    case "working":
      return `Rendering ${Math.round(state.pct * 100)}%`;
    case "ready":
      return "Send GIF ›";
    default:
      return "Share GIF";
  }
};
