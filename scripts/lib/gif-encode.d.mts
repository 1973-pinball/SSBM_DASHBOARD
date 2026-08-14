// Types for the plain-JS encoder shared by the app and the asset render.
export interface GifFrame {
  /** RGBA pixels, as returned by CanvasRenderingContext2D.getImageData(). */
  data: Uint8ClampedArray;
  /** Hold time for this frame, in centiseconds (GIF's native unit). */
  delayCs: number;
}

export function encodeGif(frames: GifFrame[], width: number, height: number): Uint8Array;
