/// <reference lib="webworker" />
import { IncompleteReplayError, parseHeader, parseHeaderFile, parseReplay } from "../lib/parse";
import { decodeSlpz } from "../lib/slpz";
import type { GameRecord, ParsePassMode } from "../lib/types";

type ReplayFormat = "slp" | "slpz";

interface Job {
  id: string;
  path: string;
  /**
   * Handed over unread. Structured-cloning a File shares the underlying blob
   * rather than copying its bytes, so the multi-megabyte read runs here instead
   * of on the thread that is also rendering the dashboard — twenty thousand of
   * them on a large library. The re-stat that guards the read stays in pool.ts,
   * because the checks it feeds need the cache's id set.
   */
  file: File;
  /** File container. SLPZ is normalized to ordinary SLP bytes in this worker. */
  format: ReplayFormat;
  /**
   * "header" runs the cheap settings/metadata/game-end read; "full" runs the
   * frame pass. Same worker either way — the pool reuses one pool of them
   * across both passes rather than spinning up a second set.
   */
  mode: ParsePassMode;
}

export interface WorkerResult {
  ok: boolean;
  record?: GameRecord;
  id: string;
  path: string;
  error?: string;
  /** Read mid-write: valid as far as it goes, but unfinished. Retry, don't tombstone. */
  incomplete?: boolean;
  /**
   * The read itself failed — locked or vanished since the re-stat. Nothing is
   * wrong with the replay, so this gets no tombstone either and the next scan
   * comes back for it.
   */
  readFailed?: boolean;
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, path, file, format, mode } = e.data;
  if (mode === "header") {
    try {
      // Normal SLP previews keep their ranged-read fast path. SLPZ is already
      // roughly an order of magnitude smaller on disk and must inflate its zstd
      // event block to recover GAME_END, so normalize it once and reuse the
      // whole-buffer header parser. If benchmarks justify a format-specific
      // preview later, it can replace only this branch without touching stats.
      const record =
        format === "slpz"
          ? parseHeader(id, path, decodeSlpz(new Uint8Array(await file.arrayBuffer())).buffer)
          : await parseHeaderFile(id, path, file);
      const result: WorkerResult = { ok: true, id, path, record };
      self.postMessage(result);
    } catch (err) {
      const result: WorkerResult = {
        ok: false,
        id,
        path,
        error: err instanceof Error ? err.message : String(err),
        incomplete: err instanceof IncompleteReplayError,
      };
      self.postMessage(result);
    }
    return;
  }
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch (err) {
    const result: WorkerResult = {
      ok: false,
      id,
      path,
      readFailed: true,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(result);
    return;
  }
  try {
    const replay = format === "slpz" ? decodeSlpz(new Uint8Array(buf)).buffer : buf;
    const record = parseReplay(id, path, replay);
    const result: WorkerResult = { ok: true, id, path, record };
    self.postMessage(result);
  } catch (err) {
    const result: WorkerResult = {
      ok: false,
      id,
      path,
      error: err instanceof Error ? err.message : String(err),
      incomplete: err instanceof IncompleteReplayError,
    };
    self.postMessage(result);
  }
};
