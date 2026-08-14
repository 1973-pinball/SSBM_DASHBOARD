// Minimal animated-GIF89a encoder. Written here rather than pulled in as a
// dependency: the charts need only flat colour plus text, which indexed colour
// and LZW handle well.
//
// Plain JS on purpose — the same module is imported by the browser (the Share
// button) and by Node (the monthly asset render), and Node can't load .ts.

/** Growable byte sink. GIF's 16-bit fields are little-endian. */
class ByteSink {
  constructor() {
    this.buf = new Uint8Array(1 << 16);
    this.len = 0;
  }

  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(v) {
    this.ensure(1);
    this.buf[this.len++] = v & 255;
  }

  word(v) {
    this.byte(v);
    this.byte(v >> 8);
  }

  bytes(values) {
    this.ensure(values.length);
    for (let i = 0; i < values.length; i++) this.buf[this.len++] = values[i] & 255;
  }

  ascii(s) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }

  take() {
    return this.buf.slice(0, this.len);
  }
}

/**
 * GIF-flavoured LZW: codes start at minCodeSize + 1 bits and widen as the
 * dictionary grows, output is packed LSB-first into 255-byte sub-blocks, and
 * the dictionary resets when it reaches 4096 entries.
 */
function lzw(indices, minCodeSize, out) {
  const CLEAR = 1 << minCodeSize;
  const END = CLEAR + 1;

  let dict = new Map();
  let next = END + 1;
  let codeSize = minCodeSize + 1;
  let bitBuf = 0;
  let bitCount = 0;
  let cur = -1;
  const block = [];

  const flush = () => {
    if (!block.length) return;
    out.byte(block.length);
    out.bytes(block);
    block.length = 0;
  };
  const emit = (code) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      block.push(bitBuf & 255);
      bitBuf >>= 8;
      bitCount -= 8;
      if (block.length === 255) flush();
    }
  };
  const reset = () => {
    dict = new Map();
    next = END + 1;
    codeSize = minCodeSize + 1;
  };

  emit(CLEAR);
  reset();
  for (let i = 0; i < indices.length; i++) {
    const k = indices[i];
    if (cur === -1) {
      cur = k;
      continue;
    }
    const key = cur * 4096 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      cur = found;
      continue;
    }
    emit(cur);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(CLEAR);
      reset();
    }
    cur = k;
  }
  if (cur !== -1) emit(cur);
  emit(END);
  if (bitCount > 0) {
    block.push(bitBuf & 255);
    if (block.length === 255) flush();
  }
  flush();
  out.byte(0); // end of image data
}

/** Top-256 colours of a 15-bit histogram, as [r,g,b] triples. */
function paletteFromHistogram(hist) {
  const palette = [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 256)
    .map(([k]) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3]);
  while (palette.length < 256) palette.push([0, 0, 0]);
  return palette;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Encode a looping GIF89a one frame at a time.
 *
 * Frames are pulled from `frameRgba(i)` and LZW-encoded straight into the
 * output, so peak memory is one frame plus the growing file rather than the
 * whole animation — holding 200+ frames of 900x600 RGBA is ~490 MB, which is
 * fine on a desktop and fatal on a phone.
 *
 * Two passes: the first samples frames to build one global palette (it has to
 * be written in the header, before any frame data), the second encodes
 * everything. Sampled frames are therefore drawn twice, which is cheap next to
 * the per-pixel work.
 *
 * These charts change too much between steps for inter-frame diffing to pay
 * off, so every frame is written whole.
 */
export async function encodeGifStreamed({
  width,
  height,
  count,
  frameRgba,
  delayCs,
  sampleStride,
  onProgress,
  yieldEvery = 8,
}) {
  if (!count || count < 1) throw new Error("no frames to encode");

  // ---- pass 1: palette ----
  const hist = new Map();
  const stride = sampleStride ?? Math.max(1, Math.floor(count / 12));
  let sampled = 0;
  for (let i = 0; i < count; i += stride) {
    const d = frameRgba(i);
    for (let p = 0; p < d.length; p += 4) {
      const k = ((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3);
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    onProgress?.(0.12 * ((i + stride) / count));
    // Yield in batches, not per sample: a short animation samples every frame,
    // and one yield each would be a dozen event-loop round trips for nothing.
    if (++sampled % 4 === 0) await tick();
  }
  const palette = paletteFromHistogram(hist);

  // ---- header ----
  const out = new ByteSink();
  out.ascii("GIF89a");
  out.word(width);
  out.word(height);
  out.byte(0xf7); // global colour table, 256 entries
  out.byte(0);
  out.byte(0);
  for (const [r, g, b] of palette) {
    out.byte(r);
    out.byte(g);
    out.byte(b);
  }
  // Netscape extension: loop forever.
  out.byte(0x21);
  out.byte(0xff);
  out.byte(11);
  out.ascii("NETSCAPE2.0");
  out.byte(3);
  out.byte(1);
  out.word(0);
  out.byte(0);

  // Neighbouring pixels repeat heavily, so an exact-match cache carries most
  // lookups and the 256-entry scan runs rarely.
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < 256; i++) {
      const p = palette[i];
      const dr = r - p[0];
      const dg = g - p[1];
      const db = b - p[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
        if (dist === 0) break;
      }
    }
    cache.set(key, best);
    return best;
  };

  // ---- pass 2: frames ----
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < count; i++) {
    const d = frameRgba(i);
    for (let p = 0, q = 0; p < d.length; p += 4, q++) indices[q] = nearest(d[p], d[p + 1], d[p + 2]);

    out.byte(0x21); // graphic control extension
    out.byte(0xf9);
    out.byte(4);
    out.byte(0); // no disposal, no transparency
    out.word(delayCs(i));
    out.byte(0);
    out.byte(0);

    out.byte(0x2c); // image descriptor
    out.word(0);
    out.word(0);
    out.word(width);
    out.word(height);
    out.byte(0);

    out.byte(8); // LZW minimum code size
    lzw(indices, 8, out);

    if (i % yieldEvery === 0) {
      onProgress?.(0.12 + 0.88 * (i / count));
      await tick();
    }
  }

  out.byte(0x3b); // trailer
  onProgress?.(1);
  return out.take();
}
