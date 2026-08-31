/**
 * Compare browser-pool candidate sizes against a real replay library.
 *
 *   npm run bench:parse -- <replay-folder> [sample-count] [rounds] [bounded|retained]
 *
 * Raw replays stay local: paths are divided among local Node worker threads,
 * and only aggregate timing/error counts return to the parent.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

if (!isMainThread) {
  const { parseReplay, parseReplayRetainedForVerification } = await import("../src/lib/parse.ts");
  const parse = workerData.mode === "retained" ? parseReplayRetainedForVerification : parseReplay;
  let parsed = 0;
  let failed = 0;
  let bytes = 0;
  for (const path of workerData.paths) {
    try {
      const buf = readFileSync(path);
      const stat = statSync(path);
      parse(`${path}|${buf.length}|${stat.mtimeMs}`, path, toArrayBuffer(buf));
      parsed++;
      bytes += buf.length;
    } catch {
      failed++;
    }
  }
  parentPort.postMessage({ parsed, failed, bytes });
  parentPort.close();
} else {
  const [dir, countArg, roundsArg, modeArg] = process.argv.slice(2);
  if (!dir) {
    console.error("usage: npm run bench:parse -- <replay-folder> [sample-count] [rounds] [bounded|retained]");
    process.exit(2);
  }

  const walk = (root, out = []) => {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) walk(path, out);
      else if (entry.name.toLowerCase().endsWith(".slp")) out.push(path);
    }
    return out;
  };

  const all = walk(dir);
  if (!all.length) {
    console.error(`no .slp files under ${dir}`);
    process.exit(2);
  }
  const want = Math.min(all.length, Math.max(1, Number(countArg ?? 240)));
  const rounds = Math.max(1, Number(roundsArg ?? 2));
  const mode = modeArg === "retained" ? "retained" : "bounded";
  const step = all.length / want;
  const sample = Array.from({ length: want }, (_, i) => all[Math.floor(i * step)]);

  // Take disk-cache order out of the comparison. The app's preview pass has
  // already touched these same files before the full parse in a large import.
  for (const path of sample) readFileSync(path);

  const candidates = [4, 6, 8];
  const timings = new Map(candidates.map((count) => [count, []]));
  const run = async (workerCount) => {
    const lanes = Array.from({ length: workerCount }, () => []);
    sample.forEach((path, i) => lanes[i % workerCount].push(path));
    const started = performance.now();
    const results = await Promise.all(
      lanes.map(
        (paths) =>
          new Promise((resolve, reject) => {
            const worker = new Worker(new URL(import.meta.url), {
              workerData: { paths, mode },
              execArgv: process.execArgv,
            });
            worker.once("message", resolve);
            worker.once("error", reject);
          }),
      ),
    );
    const seconds = (performance.now() - started) / 1000;
    const parsed = results.reduce((sum, result) => sum + result.parsed, 0);
    const failed = results.reduce((sum, result) => sum + result.failed, 0);
    const bytes = results.reduce((sum, result) => sum + result.bytes, 0);
    return { seconds, parsed, failed, bytes };
  };

  // Reverse every second round so thermal/order effects do not always favor
  // the same candidate.
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? [...candidates].reverse() : candidates;
    for (const workerCount of order) {
      const result = await run(workerCount);
      timings.get(workerCount).push(result);
      console.log(
        `round ${round + 1}: ${workerCount} workers  ${result.seconds.toFixed(2)} s  ` +
          `${(result.parsed / result.seconds).toFixed(1)} games/s${result.failed ? `  ${result.failed} failed` : ""}`,
      );
    }
  }

  console.log(`\n${all.length} games found; ${sample.length} sampled; ${rounds} rounds; ${mode} frames`);
  for (const workerCount of candidates) {
    const runs = timings.get(workerCount);
    const seconds = runs.reduce((sum, result) => sum + result.seconds, 0) / runs.length;
    const parsed = runs[0].parsed;
    const bytes = runs[0].bytes;
    console.log(
      `  ${workerCount} workers  ${seconds.toFixed(2)} s average  ` +
        `${(parsed / seconds).toFixed(1)} games/s  ${(bytes / 1024 / 1024 / seconds).toFixed(0)} MiB/s`,
    );
  }
}
