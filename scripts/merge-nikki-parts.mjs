#!/usr/bin/env node

import { once } from "node:events";
import {
  createReadStream,
  createWriteStream,
  promises as fs,
} from "node:fs";
import path from "node:path";
import process from "node:process";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const partsDir = option("--parts");
const bundle = option("--bundle");
const output = option("--output");

if (!partsDir || !bundle || !output) {
  console.error(
    "Usage: node scripts/merge-nikki-parts.mjs --parts DIR --bundle NAME --output FILE",
  );
  process.exit(1);
}

async function inspectPart(file) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    const head = Buffer.alloc(Math.min(stat.size, 8192));
    await handle.read(head, 0, head.length, 0);

    const marker = Buffer.from('"records":[');
    const markerIndex = head.indexOf(marker);
    if (markerIndex < 0) throw new Error(`${file}: records array not found`);

    const metadata = JSON.parse(
      `${head.subarray(0, markerIndex).toString("utf8")}"records":[]}`,
    );

    const tailLength = Math.min(stat.size, 128);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, stat.size - tailLength);
    const tailText = tail.toString("utf8");
    const trailingWhitespace = tailText.length - tailText.trimEnd().length;
    const trimmed = tailText.trimEnd();
    if (!trimmed.endsWith("]}")) {
      throw new Error(`${file}: records array has an unexpected ending`);
    }

    const recordsStart = markerIndex + marker.length;
    const recordsEnd = stat.size - trailingWhitespace - 2;
    if (recordsEnd < recordsStart) {
      throw new Error(`${file}: invalid records array bounds`);
    }

    return { file, metadata, recordsStart, recordsEnd };
  } finally {
    await handle.close();
  }
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, "drain");
}

async function appendFileSlice(stream, file, start, end) {
  if (end <= start) return;
  for await (const chunk of createReadStream(file, { start, end: end - 1 })) {
    await writeChunk(stream, chunk);
  }
}

const names = (await fs.readdir(partsDir))
  .filter((name) => name.endsWith(".json"))
  .sort();

if (names.length === 0) throw new Error(`No JSON parts found in ${partsDir}`);

const parts = [];
for (const name of names) parts.push(await inspectPart(path.join(partsDir, name)));

let replayFiles = 0;
let parsed = 0;
let failed = 0;
for (const part of parts) {
  const metadata = part.metadata;
  if (metadata.bundle !== bundle) {
    throw new Error(`${part.file}: expected bundle ${bundle}, got ${metadata.bundle}`);
  }
  if (metadata.replayFiles !== metadata.parsed + metadata.failed) {
    throw new Error(`${part.file}: parsed + failed does not equal replayFiles`);
  }
  replayFiles += metadata.replayFiles;
  parsed += metadata.parsed;
  failed += metadata.failed;
}

const first = parts[0].metadata;
const metadata = {
  schemaVersion: first.schemaVersion,
  source: first.source,
  bundle,
  analyzedAt: new Date().toISOString(),
  statProfile: first.statProfile,
  replayFiles,
  parsed,
  failed,
  partFiles: names,
};

await fs.mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
const stream = createWriteStream(temporary, { encoding: "utf8" });

try {
  await writeChunk(stream, `${JSON.stringify(metadata).slice(0, -1)},"records":[`);
  let hasRecords = false;
  for (const part of parts) {
    if (part.recordsEnd === part.recordsStart) continue;
    if (hasRecords) await writeChunk(stream, ",");
    await appendFileSlice(
      stream,
      part.file,
      part.recordsStart,
      part.recordsEnd,
    );
    hasRecords = true;
  }
  stream.end("]}\n");
  await once(stream, "close");
  await fs.rename(temporary, output);
} catch (error) {
  stream.destroy();
  await fs.rm(temporary, { force: true });
  throw error;
}

console.log(
  JSON.stringify({
    bundle,
    parts: parts.length,
    replayFiles,
    parsed,
    failed,
    output,
  }),
);
