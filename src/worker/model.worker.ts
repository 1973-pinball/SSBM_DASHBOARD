/// <reference lib="webworker" />
import { fitWinModelFromInput } from "../lib/model";
import type { WinModel, WinModelInput } from "../lib/model";

/**
 * Runs the O(iterations · n · k²) IRLS win-model fit off the main thread.
 * The input is plain data from buildWinModelInput(), so it structured-clones
 * across the boundary; the WinModel result is plain data too.
 */

/** One fit request. `id` echoes back so the caller can match responses. */
export interface ModelWorkerJob {
  id: number;
  input: WinModelInput;
}

export interface ModelWorkerResult {
  id: number;
  ok: boolean;
  /** Present when ok. null is a valid outcome: not enough data to fit. */
  model?: WinModel | null;
  error?: string;
}

self.onmessage = (e: MessageEvent<ModelWorkerJob>) => {
  const { id, input } = e.data;
  try {
    const model = fitWinModelFromInput(input);
    const result: ModelWorkerResult = { id, ok: true, model };
    self.postMessage(result);
  } catch (err) {
    const result: ModelWorkerResult = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(result);
  }
};
