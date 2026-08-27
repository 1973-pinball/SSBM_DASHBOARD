import type { GameRecord, ParseProgress } from "./types";
import { cachedIds, putRecords } from "./db";
import type { WorkerResult } from "../worker/parser.worker";

export interface DiscoveredFile {
  id: string;
  path: string;
  file: File;
  /**
   * Kept so the pipeline can re-stat the file immediately before reading it.
   * Absent on the <input webkitdirectory> path, which hands over File objects
   * with no way back to the entry.
   */
  handle?: FileSystemFileHandle;
}

const fileId = (path: string, f: File) => `${path}|${f.size}|${f.lastModified}`;

/**
 * A replay whose mtime is within seconds of now is almost certainly the game
 * that just ended: Slippi appends frames until it closes the file, so reading
 * it now yields a truncated parse where waiting yields the whole game. This is
 * a cheap first line, not the only one — Windows can report a stale mtime for a
 * file another process still holds open, which is why parse.ts independently
 * rejects a replay with no metadata block.
 */
const IN_PROGRESS_MS = 10_000;
const writtenJustNow = (f: File): boolean => {
  const age = Date.now() - f.lastModified;
  return age >= 0 && age < IN_PROGRESS_MS;
};

// getFile() is one OS roundtrip per replay; a big library walked sequentially
// turns every dashboard open into tens of seconds of IPC. Bounded concurrency
// keeps the scan fast without exhausting file-handle limits.
const GETFILE_CONCURRENCY = 64;

/** Recursively walk a FileSystemDirectoryHandle collecting .slp files. */
export async function discoverFromHandle(dir: FileSystemDirectoryHandle, prefix = ""): Promise<DiscoveredFile[]> {
  // Phase 1: walk the tree (subdirectories in parallel), collecting handles.
  const found: { path: string; handle: FileSystemFileHandle }[] = [];
  const walk = async (d: FileSystemDirectoryHandle, p: string): Promise<void> => {
    const subdirs: Promise<void>[] = [];
    for await (const [name, handle] of d.entries()) {
      const path = p ? `${p}/${name}` : name;
      if (handle.kind === "directory") {
        subdirs.push(walk(handle as FileSystemDirectoryHandle, path));
      } else if (name.toLowerCase().endsWith(".slp")) {
        found.push({ path, handle: handle as FileSystemFileHandle });
      }
    }
    await Promise.all(subdirs);
  };
  await walk(dir, prefix);

  // Phase 2: materialize File objects with bounded concurrency. A getFile()
  // failure (typically the replay Slippi is writing right now) skips that
  // file instead of aborting the whole scan — it'll be picked up next visit.
  // The size/mtime captured here is only a pre-filter against the cache: by
  // the time the pipeline reads a file the snapshot may be stale, so it
  // re-stats through the handle first (see runParsePipeline).
  const out: (DiscoveredFile | null)[] = new Array(found.length).fill(null);
  let next = 0;
  const lane = async () => {
    while (next < found.length) {
      const i = next++;
      const entry = found[i]!;
      try {
        const file = await entry.handle.getFile();
        out[i] = { id: fileId(entry.path, file), path: entry.path, file, handle: entry.handle };
      } catch {
        // skip: locked or vanished mid-scan
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(GETFILE_CONCURRENCY, found.length) }, lane));
  return out.filter((f): f is DiscoveredFile => f !== null);
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

// UI record delivery is throttled by time, not batch size: every append
// invalidates App's memoized resolve+sort of the entire library, so per-batch
// delivery on a 30k-file parse would mean ~1,200 full re-resolves — during
// syncFolder with the whole dashboard mounted. Progress counts only re-render
// the progress bar / topbar button, so they may go out more often.
const UI_RECORDS_MS = 1000;
const UI_PROGRESS_MS = 250;

/** Parsed records that could not be written to IndexedDB (quota, private browsing). */
export class RecordSaveError extends Error {
  constructor(unsaved: number, cause: Error) {
    super(
      `Couldn't save ${unsaved.toLocaleString()} parsed game${unsaved === 1 ? "" : "s"} to the local replay cache — ` +
        `your browser may be blocking storage or out of space (${cause.message}).`,
    );
    this.name = "RecordSaveError";
  }
}

/**
 * Parse all not-yet-cached files across a pool of web workers.
 * Streams progress and flushes records to IndexedDB in batches so the
 * dashboard can render while parsing continues.
 */
export async function runParsePipeline(
  files: DiscoveredFile[],
  onProgress: (p: ParseProgress, newRecords: GameRecord[]) => void,
  // Aborting (App's reset) must stop DB writes and callbacks immediately —
  // a pipeline that keeps committing after clearAll() resurrects the old
  // folder's records into the wiped cache and the fresh React state.
  signal?: AbortSignal,
): Promise<void> {
  const cached = await cachedIds();
  const queue = files.filter((f) => !cached.has(f.id));
  const progress: ParseProgress = {
    total: files.length,
    done: files.length - queue.length,
    skippedCached: files.length - queue.length,
    errors: 0,
    deferred: 0,
  };
  onProgress({ ...progress }, []);
  if (queue.length === 0) return;

  const workerCount = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
  interface Slot {
    worker: Worker;
    job: DiscoveredFile | null;
    dead: boolean;
  }
  const slots: Slot[] = Array.from({ length: workerCount }, () => ({
    worker: new Worker(new URL("../worker/parser.worker.ts", import.meta.url), { type: "module" }),
    job: null,
    dead: false,
  }));

  let next = 0;
  let pendingDb: GameRecord[] = [];
  let pendingUi: GameRecord[] = [];
  let lastProgressEmit = 0;
  let lastRecordsEmit = 0;

  const emitUi = () => {
    if (signal?.aborted) return;
    const now = Date.now();
    if (now - lastProgressEmit < UI_PROGRESS_MS) return;
    lastProgressEmit = now;
    let batch: GameRecord[] = [];
    if (pendingUi.length && now - lastRecordsEmit >= UI_RECORDS_MS) {
      lastRecordsEmit = now;
      batch = pendingUi;
      pendingUi = [];
    }
    onProgress({ ...progress }, batch);
  };

  // DB writes are chained so batches commit in order and a rejection can't
  // escape as an unhandled rejection mid-pipeline — the chain never rejects;
  // failures are captured here and surfaced after the worker loop settles.
  let flushChain: Promise<void> = Promise.resolve();
  let flushError: Error | null = null;
  let unsaved = 0;

  const flush = () => {
    if (!pendingDb.length || signal?.aborted) return;
    const batch = pendingDb;
    pendingDb = [];
    flushChain = flushChain.then(async () => {
      try {
        await putRecords(batch);
      } catch (err) {
        flushError ??= err instanceof Error ? err : new Error(String(err));
        unsaved += batch.length;
      }
    });
  };

  const workerLoop = new Promise<void>((resolve, reject) => {
    let inFlight = 0;

    const feed = (slot: Slot) => {
      if (slot.dead) return;
      // Once a cache write fails, later ones will too (quota, private
      // browsing) — stop starting new files instead of parsing into batches
      // that can't be saved.
      if (next >= queue.length || flushError || signal?.aborted) {
        if (inFlight === 0) resolve();
        return;
      }
      const job = queue[next++]!;
      slot.job = job;
      inFlight++;
      // Retire the job without producing a record. Nothing lands in `seen`,
      // which is precisely what lets the next scan come back for it.
      const retire = (deferred: boolean) => {
        inFlight--;
        slot.job = null;
        progress.done++;
        if (deferred) progress.deferred++;
        else progress.errors++;
        emitUi(); // read failures must still move the bar
        feed(slot);
      };
      void (async () => {
        let { file, id } = job;
        if (job.handle) {
          // Re-stat immediately before reading. The File from discovery is a
          // snapshot of size+mtime taken during the walk, and Chrome fails the
          // read when the file has changed since — which is exactly the replay
          // of the game you just finished. Re-fetching here shrinks that window
          // from "however long the scan took" to microseconds, and gives the
          // record an id that matches the bytes we actually parse.
          file = await job.handle.getFile();
          id = fileId(job.path, file);
          // It moved on since discovery and we already hold this exact version.
          if (id !== job.id && cached.has(id)) return retire(true);
          // Deferring is only useful when a rescan can come back for the file.
          // The webkitdirectory path has no handle and no rescan, so there it
          // is better to parse what we have than to drop the file silently.
          if (writtenJustNow(file)) return retire(true);
        }
        const buf = await file.arrayBuffer();
        slot.worker.postMessage({ id, path: job.path, buf }, [buf]);
      })().catch(() => retire(false));
    };

    for (const slot of slots) {
      slot.worker.onmessage = (e: MessageEvent) => {
        inFlight--;
        slot.job = null;
        progress.done++;
        const res = e.data as WorkerResult;
        if (res.ok && res.record) {
          pendingDb.push(res.record);
          pendingUi.push(res.record);
        } else if (res.incomplete) {
          // Read mid-write: the file is fine, we were early. No tombstone —
          // keeping its id out of `seen` is what lets the next scan pick up
          // the finished game. Caching the fragment instead would shadow that
          // game permanently (see IncompleteReplayError in parse.ts).
          progress.deferred++;
        } else {
          progress.errors++;
          // Store a tombstone so corrupt files are not re-parsed every visit.
          const tombstone: GameRecord = {
            id: res.id,
            path: res.path,
            playedAt: null,
            durationFrames: 0,
            stageId: -1,
            gameType: "unknown",
            isTeams: false,
            players: [],
            winnerIndex: null,
            winnerTeamId: null,
            parseError: res.error ?? "parse failed",
          };
          pendingDb.push(tombstone);
          pendingUi.push(tombstone);
        }
        if (pendingDb.length >= BATCH_FLUSH) flush();
        emitUi();
        feed(slot);
      };
      // A worker that dies — most commonly its script 404ing because a new
      // deploy replaced the hashed chunk while this tab was open — never posts
      // a message, which used to hang the pipeline at "0 / N" forever. The
      // file is fine, so requeue it (no tombstone) and drop the worker; when
      // every worker is gone, fail loudly instead of waiting.
      slot.worker.onerror = () => {
        slot.dead = true;
        slot.worker.terminate();
        if (slot.job) {
          inFlight--;
          queue.push(slot.job);
          slot.job = null;
        }
        const alive = slots.filter((s) => !s.dead);
        if (alive.length === 0) {
          reject(new Error("All parse workers failed to start (often a stale tab after a site update)."));
          return;
        }
        // Wake idle survivors so the requeued job isn't stranded.
        for (const s of alive) if (s.job === null) feed(s);
      };
      feed(slot);
    }
  });

  try {
    await workerLoop;
  } finally {
    // Terminate on rejection too — a failed pipeline must not leak the pool.
    slots.forEach((s) => s.worker.terminate());
  }

  if (signal?.aborted) return; // parsed-but-unflushed records are dropped by design
  flush();
  await flushChain;
  if (signal?.aborted) return;
  // Trailing delivery: syncFolder builds its record state solely from these
  // callbacks, so every remaining record must go out, exactly once.
  onProgress({ ...progress }, pendingUi);
  pendingUi = [];
  if (flushError) throw new RecordSaveError(unsaved, flushError);
}
