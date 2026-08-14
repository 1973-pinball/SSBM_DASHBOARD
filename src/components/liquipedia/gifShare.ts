/**
 * Render a sequence of canvas frames to a GIF and hand it off — to the OS
 * share sheet on a phone, or as a download on a desktop. The encoder and
 * painters live in scripts/lib so the weekly asset render in CI produces the
 * same artwork from the same code.
 *
 * Building and sending are deliberately separate calls. `navigator.share()`
 * only works while a user gesture is still live (a few seconds), and encoding
 * a couple of hundred frames takes far longer than that — sharing at the end
 * of the render is rejected, and the browser falls back to a download, which
 * on iOS means a blob preview page instead of the share sheet. So the caller
 * builds on one tap and sends on the next.
 *
 * Everything is local: no upload, no network beyond the stock icons the app
 * already serves.
 */

export interface BuildGifOptions {
  frameCount: number;
  /** Paint frame `i`. Called more than once per frame — keep it pure. */
  draw: (ctx: CanvasRenderingContext2D, i: number) => void;
  /** Per-step hold, from the transport's current speed. */
  stepMs: number;
  /** Extra hold on the final frame so the result is readable when it loops. */
  finalHoldMs?: number;
  filename: string;
  onProgress?: (fraction: number) => void;
}

/** Long animations are sampled so the file stays sendable; see buildGifFile. */
const MAX_FRAMES = 150;

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

export async function buildGifFile(opts: BuildGifOptions): Promise<File> {
  const { frameCount, draw, stepMs, finalHoldMs = 3000, filename, onProgress } = opts;
  // Both pulled in on demand so the encoder never lands in the tab's chunk.
  const [{ encodeGifStreamed }, { CANVAS }] = await Promise.all([
    import("../../../scripts/lib/gif-encode.mjs"),
    import("../../../scripts/lib/gif-draw.mjs"),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS.w;
  canvas.height = CANVAS.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d context unavailable");

  // A long race is ~225 steps; at one frame each that's a 4.5 MB GIF, slow to
  // build on a phone and awkward to send. Taking every other step and doubling
  // the hold keeps the running time and pacing identical at half the size, and
  // matches what the committed asset does.
  const stride = frameCount > MAX_FRAMES ? Math.ceil(frameCount / MAX_FRAMES) : 1;
  const indexOf = (n: number) => Math.min(frameCount - 1, n * stride);
  const count = Math.ceil(frameCount / stride);

  // GIF delays are centiseconds; most decoders treat anything under 2 as 10.
  const stepCs = Math.max(2, Math.round((stepMs * stride) / 10));

  const gif = await encodeGifStreamed({
    width: CANVAS.w,
    height: CANVAS.h,
    count,
    frameRgba: (n: number) => {
      draw(ctx, indexOf(n));
      return ctx.getImageData(0, 0, CANVAS.w, CANVAS.h).data;
    },
    delayCs: (n: number) => (n === count - 1 ? Math.round(finalHoldMs / 10) : stepCs),
    onProgress,
  });

  return new File([gif as BlobPart], filename, { type: "image/gif" });
}

/**
 * Whether this browser will hand the file to the OS share sheet. False on
 * desktop browsers, which is why they download instead — canShare is the only
 * reliable test, since Safari rejects shares it can't service.
 */
export const canShareFile = (file: File): boolean => navigator.canShare?.({ files: [file] }) ?? false;

/**
 * Open the share sheet. MUST be called straight from a click handler with no
 * awaits before it, or the user activation will have lapsed and iOS will
 * reject it. Returns false if the sheet couldn't open at all.
 */
export async function shareFile(file: File): Promise<boolean> {
  try {
    await navigator.share({ files: [file] });
    return true;
  } catch (err) {
    // Dismissing the sheet throws AbortError — that's a choice, not a fault.
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return false;
  }
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late: Safari cancels an in-flight download if the URL dies too soon.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
