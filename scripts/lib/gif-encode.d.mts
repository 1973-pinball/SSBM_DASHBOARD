// Types for the plain-JS encoder shared by the app and the asset render.
export interface EncodeGifOptions {
  width: number;
  height: number;
  /** Number of frames to encode. */
  count: number;
  /** RGBA pixels for frame `i`; called again for palette sampling. */
  frameRgba: (i: number) => Uint8ClampedArray;
  /** Hold for frame `i`, in centiseconds (GIF's native unit). */
  delayCs: (i: number) => number;
  /** Sample every Nth frame when building the palette (default ~12 total). */
  sampleStride?: number;
  onProgress?: (fraction: number) => void;
  /** Frames between yields to the event loop (default 8). */
  yieldEvery?: number;
}

export function encodeGifStreamed(opts: EncodeGifOptions): Promise<Uint8Array>;
