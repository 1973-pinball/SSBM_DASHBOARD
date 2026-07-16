import type { GameRecord, ParseProgress } from "./types";
import { cachedIds, putRecords } from "./db";

export interface DiscoveredFile {
  id: string;
  path: string;
  file: File;
}

const fileId = (path: string, f: File) => `${path}|${f.size}|${f.lastModified}`;

/** Recursively walk a FileSystemDirectoryHandle collecting .slp files. */
export async function discoverFromHandle(dir: FileSystemDirectoryHandle, prefix = ""): Promise<DiscoveredFile[]> {
  const out: DiscoveredFile[] = [];
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      out.push(...(await discoverFromHandle(handle as FileSystemDirectoryHandle, path)));
    } else if (name.toLowerCase().endsWith(".slp")) {
      const file = await (handle as FileSystemFileHandle).getFile();
      out.push({ id: fileId(path, file), path, file });
    }
  }
  return out;
}

/** Fallback for <input webkitdirectory> file lists. */
export function discoverFromFileList(files: FileList): DiscoveredFile[] {
  const out: DiscoveredFile[] = [];
  for (const file of Array.from(files)) {
    if (!file.name.toLowerCase().endsWith(".slp")) continue;
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    out.push({ id: fileId(path, file), path, file });
  }
  return out;
}

const BATCH_FLUSH = 25;

/**
 * Parse all not-yet-cached files across a pool of web workers.
 * Streams progress and flushes records to IndexedDB in batches so the
 * dashboard can render while parsing continues.
 */
export async function runParsePipeline(
  files: DiscoveredFile[],
  onProgress: (p: ParseProgress, newRecords: GameRecord[]) => void,
): Promise<void> {
  const cached = await cachedIds();
  const queue = files.filter((f) => !cached.has(f.id));
  const progress: ParseProgress = {
    total: files.length,
    done: files.length - queue.length,
    skippedCached: files.length - queue.length,
    errors: 0,
  };
  onProgress({ ...progress }, []);
  if (queue.length === 0) return;

  const workerCount = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
  const workers = Array.from(
    { length: workerCount },
    () => new Worker(new URL("../worker/parser.worker.ts", import.meta.url), { type: "module" }),
  );

  let next = 0;
  let pendingFlush: GameRecord[] = [];

  const flush = async () => {
    if (!pendingFlush.length) return;
    const batch = pendingFlush;
    pendingFlush = [];
    await putRecords(batch);
    onProgress({ ...progress }, batch);
  };

  await new Promise<void>((resolve) => {
    let inFlight = 0;

    const feed = (worker: Worker) => {
      if (next >= queue.length) {
        if (inFlight === 0) resolve();
        return;
      }
      const job = queue[next++];
      inFlight++;
      job.file
        .arrayBuffer()
        .then((buf) => worker.postMessage({ id: job.id, path: job.path, buf }, [buf]))
        .catch(() => {
          inFlight--;
          progress.done++;
          progress.errors++;
          feed(worker);
        });
    };

    for (const worker of workers) {
      worker.onmessage = (e: MessageEvent) => {
        inFlight--;
        progress.done++;
        const res = e.data as { ok: boolean; record?: GameRecord; id: string; path: string; error?: string };
        if (res.ok && res.record) {
          pendingFlush.push(res.record);
        } else {
          progress.errors++;
          // Store a tombstone so corrupt files are not re-parsed every visit.
          pendingFlush.push({
            id: res.id,
            path: res.path,
            playedAt: null,
            durationFrames: 0,
            stageId: -1,
            gameType: "unknown",
            isTeams: false,
            players: [],
            winnerIndex: null,
            parseError: res.error ?? "parse failed",
          });
        }
        if (pendingFlush.length >= BATCH_FLUSH) void flush();
        feed(worker);
      };
      feed(worker);
    }
  });

  await flush();
  onProgress({ ...progress }, []);
  workers.forEach((w) => w.terminate());
}
