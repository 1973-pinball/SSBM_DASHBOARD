/**
 * Assert the parse invariants that would otherwise break silently.
 *
 *   node --experimental-strip-types scripts/verify-parse.mjs <replay-folder> [count]
 *
 * Run it after bumping @slippi/slippi-js, or after touching parse.ts. It needs a
 * folder of real .slp files; there are none in the repo and there never will be
 * (decision 1 — raw replays never leave the machine), so this stays a manual
 * script rather than anything CI could run.
 *
 * Both invariants share a failure mode: they break QUIETLY. Nothing in the app
 * goes red, no build fails, and the dashboard keeps rendering plausible numbers.
 * That is the whole reason this file exists.
 *
 *   1. The header pass is a strict subset of the full parse. pool.ts shows
 *      header-only records on screen while the real parse runs behind them, and
 *      that is only defensible if a preview can never be CONTRADICTED later —
 *      it may leave a winner undetermined, never name a different one. Break
 *      this and win rates silently rewrite themselves mid-import.
 *
 *   2. dropUnreadComputers still binds. It reaches into slippi-js's private
 *      fields to stop three stat computers whose output nothing reads. The
 *      guard means a shape change degrades to slow-but-correct, which is the
 *      safe direction and therefore the invisible one: a library upgrade could
 *      quietly hand back ~10% of every parse and nobody would ever know.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SlippiGame } from "@slippi/slippi-js";
import { parseReplay, parseHeader, dropUnreadComputers, IncompleteReplayError } from "../src/lib/parse.ts";

/**
 * Every input gameKey() derives a game's identity from. Asserted instead of
 * importing gameKey itself for two reasons: dedupe.ts reaches ./types with an
 * extensionless specifier that Vite resolves and bare Node does not, and — more
 * usefully — comparing the inputs holds whatever gameKey does with them. If
 * playedAt, stage and every side agree between the two passes, the key must
 * agree too, and it keeps agreeing if the key's formula ever changes.
 */
const identity = (rec) =>
  JSON.stringify({
    playedAt: rec.playedAt,
    stageId: rec.stageId,
    sides: rec.players.map((p) => `${p.connectCode ?? ""}|${p.port}|${p.characterId}`).sort(),
  });

const [dir, countArg] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node --experimental-strip-types scripts/verify-parse.mjs <replay-folder> [count]");
  process.exit(2);
}
const WANT = Number(countArg ?? 40);

function walk(d, out = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith(".slp")) out.push(p);
  }
  return out;
}

const all = walk(dir);
if (all.length === 0) {
  console.error(`no .slp files under ${dir}`);
  process.exit(2);
}
// Spread the sample across the library rather than taking the first N, so one
// directory of unusual games cannot define the result.
const step = Math.max(1, Math.floor(all.length / WANT));
const sample = all.filter((_, i) => i % step === 0).slice(0, WANT);

const failures = [];
const fail = (file, what, detail) => failures.push({ file: file.split(/[\\/]/).pop(), what, detail });

// ---- invariant 2: the reach-in still binds -------------------------------
// Checked on the shape itself rather than inferred from timing, because a
// timing regression is exactly the signal that gets lost in the noise.
{
  const probe = new SlippiGame(toArrayBuffer(readFileSync(sample[0])));
  const before = probe.statsComputer?.allComputers?.length;
  dropUnreadComputers(probe);
  const after = probe.statsComputer?.allComputers?.length;
  if (before !== 6) {
    fail("(library)", "computer count changed upstream", `slippi-js now registers ${before}, expected 6 — re-check which are unread`);
  }
  if (after !== 3) {
    fail("(library)", "dropUnreadComputers no longer binds", `allComputers is ${after} after the call, expected 3 — the private-field shape changed, so every parse is silently ~10% slower`);
  }
}

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// The exact fields parse.ts reads off getStats(). If these match with the three
// computers unregistered, the GameRecord must match too.
const statsFingerprint = (s) =>
  JSON.stringify({
    lastFrame: s?.lastFrame,
    playableFrameCount: s?.playableFrameCount,
    overall: s?.overall,
    actionCounts: s?.actionCounts,
    conversions: s?.conversions,
  });

let ok = 0;
let skipped = 0;
let headerDecided = 0;
let fullDecided = 0;
let headerMs = 0;
let fullMs = 0;
const ms = () => Number(process.hrtime.bigint() / 1000n) / 1000;

for (const path of sample) {
  const buf = readFileSync(path);
  const id = `${path}|${buf.length}|${statSync(path).mtimeMs}`;

  let header, full;
  try {
    const a = toArrayBuffer(buf);
    const b = toArrayBuffer(buf);
    let t = ms();
    header = parseHeader(id, path, a);
    headerMs += ms() - t;
    t = ms();
    full = parseReplay(id, path, b);
    fullMs += ms() - t;
  } catch (err) {
    // A replay caught mid-write is expected and not a failure; anything else is.
    if (err instanceof IncompleteReplayError) skipped++;
    else fail(path, "threw during parse", err.message);
    continue;
  }
  ok++;

  // ---- invariant 1: header is a strict subset of full --------------------
  const hw = header.isTeams ? header.winnerTeamId : header.winnerIndex;
  const fw = full.isTeams ? full.winnerTeamId : full.winnerIndex;
  if (hw !== null) {
    headerDecided++;
    if (hw !== fw) fail(path, "SUBSET VIOLATION", `header says winner ${hw}, full parse says ${fw}`);
  }
  if (fw !== null) fullDecided++;

  // Identity must agree or dedupe cannot collapse a preview onto its own full
  // record, and the library doubles for the length of an import.
  if (identity(header) !== identity(full)) {
    fail(path, "game identity mismatch", `${identity(header)} vs ${identity(full)}`);
  }

  for (const [field, h, f] of [
    ["playedAt", header.playedAt, full.playedAt],
    ["stageId", header.stageId, full.stageId],
    ["gameType", header.gameType, full.gameType],
    ["isTeams", header.isTeams, full.isTeams],
    ["players.length", header.players.length, full.players.length],
  ]) {
    if (h !== f) fail(path, `${field} disagrees`, `header ${h}, full ${f}`);
  }

  // ---- invariant 2, per file: lean stats == stock stats -------------------
  const lean = new SlippiGame(toArrayBuffer(buf));
  dropUnreadComputers(lean);
  const stock = new SlippiGame(toArrayBuffer(buf));
  if (statsFingerprint(lean.getStats()) !== statsFingerprint(stock.getStats())) {
    fail(path, "lean stats differ from stock", "dropUnreadComputers changed a value parse.ts reads");
  }
}

const per = (t) => (ok ? (t / ok).toFixed(1) : "-");
console.log(`\nlibrary ${all.length} files, sampled ${sample.length}, parsed ${ok}${skipped ? `, skipped ${skipped} mid-write` : ""}`);
console.log(`  parseHeader ${per(headerMs)} ms/game   parseReplay ${per(fullMs)} ms/game   ratio ${headerMs ? (fullMs / headerMs).toFixed(0) : "-"}x`);
console.log(`  winner decided: header ${headerDecided}/${ok}, full ${fullDecided}/${ok}  (header <= full by design)`);

if (failures.length === 0) {
  console.log("\nOK — header pass is a strict subset, gameKeys agree, lean stats identical, reach-in still binds\n");
  process.exit(0);
}
console.log(`\n${failures.length} FAILURE(S):`);
for (const f of failures) console.log(`  ${f.file}: ${f.what} — ${f.detail}`);
process.exit(1);
