import type { GifFrame } from "../../../scripts/lib/gif-encode.mjs";

/**
 * Render a sequence of canvas frames to a GIF and hand it to the browser as a
 * download. The encoder and painters live in scripts/lib so the monthly asset
 * render in CI produces byte-identical artwork from the same code.
 *
 * Everything is local: no upload, no network beyond the stock icons already
 * served by the app.
 */
export interface ShareGifOptions {
  frameCount: number;
  /** Paint frame `i`; called once per frame, in order. */
  draw: (ctx: CanvasRenderingContext2D, i: number) => void;
  /** Per-step hold, from the transport's current speed. */
  stepMs: number;
  /** Extra hold on the final frame so the result is readable when it loops. */
  finalHoldMs?: number;
  filename: string;
  onProgress?: (fraction: number) => void;
}

/** Load the bundled stock sprites, keyed however the caller wants them. */
export async function loadIcons(entries: [key: string, charId: number][]): Promise<Record<string, HTMLImageElement>> {
  const unique = new Map<number, Promise<HTMLImageElement | null>>();
  const load = (id: number) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // a missing sprite just means no icon
      img.src = `/stock/${id}.png`;
    });

  for (const [, id] of entries) if (!unique.has(id)) unique.set(id, load(id));
  const loaded = new Map<number, HTMLImageElement | null>();
  await Promise.all([...unique].map(async ([id, p]) => loaded.set(id, await p)));

  const out: Record<string, HTMLImageElement> = {};
  for (const [key, id] of entries) {
    const img = loaded.get(id);
    if (img) out[key] = img;
  }
  return out;
}

export async function shareGif(opts: ShareGifOptions): Promise<{ bytes: number }> {
  const { frameCount, draw, stepMs, finalHoldMs = 3000, filename, onProgress } = opts;
  // Both pulled in on demand so the encoder never lands in the tab's chunk.
  const [{ encodeGif }, { CANVAS }] = await Promise.all([
    import("../../../scripts/lib/gif-encode.mjs"),
    import("../../../scripts/lib/gif-draw.mjs"),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS.w;
  canvas.height = CANVAS.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d context unavailable");

  // GIF delays are centiseconds; most decoders treat anything under 2 as 10.
  const stepCs = Math.max(2, Math.round(stepMs / 10));
  const frames: GifFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    draw(ctx, i);
    frames.push({
      data: ctx.getImageData(0, 0, CANVAS.w, CANVAS.h).data,
      delayCs: i === frameCount - 1 ? Math.round(finalHoldMs / 10) : stepCs,
    });
    // Yield periodically so the button's progress label can actually repaint.
    if (i % 12 === 0) {
      onProgress?.((i / frameCount) * 0.75);
      await new Promise((r) => setTimeout(r));
    }
  }

  onProgress?.(0.8);
  await new Promise((r) => setTimeout(r, 16));
  const gif = encodeGif(frames, CANVAS.w, CANVAS.h);
  onProgress?.(1);

  const url = URL.createObjectURL(new Blob([gif as BlobPart], { type: "image/gif" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late: Safari cancels an in-flight download if the URL dies too soon.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { bytes: gif.length };
}
