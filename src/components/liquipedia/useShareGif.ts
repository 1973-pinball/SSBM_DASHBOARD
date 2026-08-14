import { useCallback, useRef, useState } from "react";
import { buildShareFiles, canShareFiles, downloadFile, shareFiles, type BuildGifOptions } from "./gifShare";

export type ShareState =
  | { status: "idle" }
  | { status: "working"; pct: number }
  /** Built and waiting for a second tap, so `share()` gets a live gesture. */
  | { status: "ready"; files: File[] }
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
 *
 * Both the animation and a still of the final frame go out together: some
 * destinations preview a PNG where they'd show a GIF as a grey box, and some
 * won't accept an animation at all.
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
      const { gif, still } = await buildShareFiles({
        ...opts,
        onProgress: (pct) => setState({ status: "working", pct }),
      });
      // Some browsers accept a lone file but refuse a set; fall back to the
      // animation alone rather than losing the share sheet entirely.
      const files = canShareFiles([gif, still]) ? [gif, still] : canShareFiles([gif]) ? [gif] : [];
      if (files.length) {
        setState({ status: "ready", files });
      } else {
        downloadFile(gif);
        // Space the second save: back-to-back downloads look like a popup
        // storm to the browser and the second is silently dropped.
        setTimeout(() => downloadFile(still), 600);
        setState({ status: "idle" });
      }
    } catch (err) {
      console.error(err);
      setState({ status: "error", message: "Couldn't build the GIF — try again." });
    } finally {
      busy.current = false;
    }
  }, []);

  /** Second tap: hand the built files to the OS. No awaits before share(). */
  const send = useCallback((files: File[]) => {
    void shareFiles(files).then((ok) => {
      // If the sheet refused outright, saving is better than a dead button.
      if (!ok) files.forEach((f, i) => setTimeout(() => downloadFile(f), i * 600));
      setState({ status: "idle" });
    });
  }, []);

  /** Drop built files that no longer match the settings on screen. */
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
      return "Send GIF + still ›";
    default:
      return "Share GIF";
  }
};
