#!/usr/bin/env node
/**
 * Verify the browser .slpz decoder against private, local replay pairs.
 *
 *   node --experimental-strip-types scripts/verify-slpz.mjs <replay-folder> [count]
 *
 * The folder is walked recursively. A test case is a same-directory,
 * same-stem pair such as `Game_20260101.slp` + `Game_20260101.slpz`; unpaired
 * files are reported and ignored. No replay fixture belongs in this repo: raw
 * replays stay on the machine, so this is deliberately a manual release check.
 *
 * For every selected pair this script proves both boundaries that matter:
 *
 *   1. decodeSlpz reconstructs the original .slp byte-for-byte.
 *   2. The reconstructed bytes and original bytes produce identical
 *      GameRecords when parseReplay receives the same logical file identity.
 *
 * It also mutates the first selected .slpz in deterministic ways to keep the
 * decoder's header/version/truncation guards from silently disappearing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { parseReplay } from "../src/lib/parse.ts";
import { decodeSlpz } from "../src/lib/slpz.ts";

const HEADER_SIZE = 24;
const VERSION_OFFSET = 0;
const GAME_START_OFFSET = 8;
const METADATA_OFFSET = 12;
const COMPRESSED_EVENTS_OFFSET = 16;

const [root, countArg] = process.argv.slice(2);
if (!root) usage("missing replay folder");

let wanted = Number.POSITIVE_INFINITY;
if (countArg !== undefined) {
  wanted = Number(countArg);
  if (!Number.isSafeInteger(wanted) || wanted <= 0) usage(`invalid count: ${countArg}`);
}

function usage(reason) {
  if (reason) console.error(reason);
  console.error(
    "usage: node --experimental-strip-types scripts/verify-slpz.mjs <replay-folder> [count]",
  );
  process.exit(2);
}

function walk(directory, out = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    console.error(`cannot read ${directory}: ${error.message}`);
    process.exit(2);
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else {
      const extension = extname(entry.name).toLowerCase();
      if (extension === ".slp" || extension === ".slpz") out.push(path);
    }
  }
  return out;
}

function findPairs(directory) {
  const byStem = new Map();
  for (const path of walk(directory)) {
    const extension = extname(path).toLowerCase();
    // Keep stems case-sensitive. On a case-sensitive filesystem, Foo and foo
    // are distinct replay names and must not be guessed to be a pair.
    const key = join(dirname(path), basename(path, extname(path)));
    const pair = byStem.get(key) ?? { stem: key, slp: null, slpz: null };
    const field = extension === ".slp" ? "slp" : "slpz";
    if (pair[field]) {
      console.error(`duplicate ${extension} candidate for ${key}`);
      process.exit(2);
    }
    pair[field] = path;
    byStem.set(key, pair);
  }
  const values = [...byStem.values()].sort((a, b) => a.stem.localeCompare(b.stem));
  return {
    pairs: values.filter((pair) => pair.slp && pair.slpz),
    unpairedSlp: values.filter((pair) => pair.slp && !pair.slpz).length,
    unpairedSlpz: values.filter((pair) => !pair.slp && pair.slpz).length,
  };
}

function evenlySample(items, count) {
  if (count >= items.length) return items;
  return Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)]);
}

function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function describeRecordDifference(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed = [...keys].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
  return changed.length ? `different fields: ${changed.join(", ")}` : "serialized records differ";
}

const discovered = findPairs(root);
if (discovered.pairs.length === 0) {
  console.error(`no paired same-stem .slp/.slpz files under ${root}`);
  console.error(
    `found ${discovered.unpairedSlp} unpaired .slp and ${discovered.unpairedSlpz} unpaired .slpz files`,
  );
  process.exit(2);
}

const selected = evenlySample(discovered.pairs, Math.min(wanted, discovered.pairs.length));
const failures = [];
const fail = (file, check, detail) => failures.push({ file: basename(file), check, detail });
const milliseconds = () => Number(process.hrtime.bigint() / 1_000n) / 1_000;
let decodeMs = 0;
let parseMs = 0;
let decodedBytes = 0;

for (const [index, pair] of selected.entries()) {
  const original = readFileSync(pair.slp);
  const compressed = readFileSync(pair.slpz);
  let decoded;
  try {
    const started = milliseconds();
    decoded = decodeSlpz(compressed);
    decodeMs += milliseconds() - started;
  } catch (error) {
    fail(pair.slpz, "decode", error instanceof Error ? error.message : String(error));
    continue;
  }

  decodedBytes += decoded.byteLength;
  const decodedView = Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  if (!original.equals(decodedView)) {
    let first = 0;
    const sharedLength = Math.min(original.length, decodedView.length);
    while (first < sharedLength && original[first] === decodedView[first]) first++;
    const location = first < sharedLength ? `first mismatch at byte ${first}` : "common prefix matches";
    fail(
      pair.slpz,
      "byte identity",
      `original ${original.length} bytes, decoded ${decodedView.length} bytes; ${location}`,
    );
  }

  // Give both parsers exactly the same identity: path-derived fields are part
  // of GameRecord, so using each physical filename would create a false diff.
  const logicalPath = `${pair.stem}.slp`;
  const logicalId = `verify|${logicalPath}`;
  try {
    const started = milliseconds();
    const fromSlp = parseReplay(logicalId, logicalPath, exactArrayBuffer(original));
    const fromSlpz = parseReplay(logicalId, logicalPath, exactArrayBuffer(decoded));
    parseMs += milliseconds() - started;
    if (JSON.stringify(fromSlp) !== JSON.stringify(fromSlpz)) {
      fail(pair.slpz, "GameRecord identity", describeRecordDifference(fromSlp, fromSlpz));
    }
  } catch (error) {
    fail(pair.slpz, "parse", error instanceof Error ? error.message : String(error));
  }

  if ((index + 1) % 10 === 0 || index + 1 === selected.length) {
    console.log(`verified ${index + 1}/${selected.length} pairs`);
  }
}

// Decoder boundary checks use a real compressed payload but only mutate its
// container. That makes them deterministic without checking in replay data.
const malformedSource = readFileSync(selected[0].slpz);
const malformedCases = [];

malformedCases.push({ name: "truncated header", bytes: malformedSource.subarray(0, HEADER_SIZE - 1) });

if (malformedSource.length >= HEADER_SIZE) {
  const unsupportedVersion = Uint8Array.from(malformedSource);
  new DataView(unsupportedVersion.buffer).setUint32(VERSION_OFFSET, 1);
  malformedCases.push({ name: "unsupported version", bytes: unsupportedVersion });

  const invalidOffsets = Uint8Array.from(malformedSource);
  const invalidView = new DataView(invalidOffsets.buffer);
  const gameStart = invalidView.getUint32(GAME_START_OFFSET);
  // Metadata must follow Game Start; making it point one byte earlier also
  // stays inside the file, proving ordering is validated rather than merely
  // bounds-checked.
  invalidView.setUint32(METADATA_OFFSET, Math.max(0, gameStart - 1));
  malformedCases.push({ name: "out-of-order section offsets", bytes: invalidOffsets });

  const sourceView = new DataView(malformedSource.buffer, malformedSource.byteOffset, malformedSource.byteLength);
  const compressedOffset = sourceView.getUint32(COMPRESSED_EVENTS_OFFSET);
  if (compressedOffset < malformedSource.length) {
    const shortenedLength = compressedOffset + Math.floor((malformedSource.length - compressedOffset) / 2);
    malformedCases.push({
      name: "truncated compressed events",
      bytes: malformedSource.subarray(0, shortenedLength),
    });
  }
}

for (const test of malformedCases) {
  try {
    decodeSlpz(test.bytes);
    fail(selected[0].slpz, test.name, "decoder accepted malformed input");
  } catch {
    // Expected: the error class/message is intentionally not coupled to this
    // verifier, only the decoder's refusal to return plausible replay bytes.
  }
}

console.log(
  `\ndiscovered ${discovered.pairs.length} pairs` +
    ` (${discovered.unpairedSlp} unpaired .slp, ${discovered.unpairedSlpz} unpaired .slpz)`,
);
console.log(
  `sampled ${selected.length}; decoded ${(decodedBytes / (1024 * 1024)).toFixed(1)} MiB` +
    ` in ${decodeMs.toFixed(1)} ms; two parses/pair in ${parseMs.toFixed(1)} ms`,
);
console.log(`malformed-input guards: ${malformedCases.length} checked`);

if (failures.length === 0) {
  console.log("\nOK — decoded bytes and parsed GameRecords match; malformed containers were rejected\n");
  process.exit(0);
}

console.log(`\n${failures.length} FAILURE(S):`);
for (const failure of failures) {
  console.log(`  ${failure.file}: ${failure.check} — ${failure.detail}`);
}
process.exit(1);
