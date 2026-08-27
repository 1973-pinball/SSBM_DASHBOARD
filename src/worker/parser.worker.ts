/// <reference lib="webworker" />
import { IncompleteReplayError, parseReplay } from "../lib/parse";
import type { GameRecord } from "../lib/types";

interface Job {
  id: string;
  path: string;
  buf: ArrayBuffer;
}

export interface WorkerResult {
  ok: boolean;
  record?: GameRecord;
  id: string;
  path: string;
  error?: string;
  /** Read mid-write: valid as far as it goes, but unfinished. Retry, don't tombstone. */
  incomplete?: boolean;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, path, buf } = e.data;
  try {
    const record = parseReplay(id, path, buf);
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
