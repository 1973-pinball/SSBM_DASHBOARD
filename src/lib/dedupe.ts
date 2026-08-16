import type { GameRecord } from "./types";

/**
 * `GameRecord.id` is `path|size|mtime`. It answers "have I already parsed this
 * file?", which is what makes a folder rescan cheap — and it is the right key
 * for that job. It does not answer "is this the same game?", and the two
 * diverge as soon as a replay folder is shared or moved:
 *
 *  - copying the folder to a second machine changes every path;
 *  - Dropbox / Drive / SMB shares routinely rewrite mtimes;
 *  - re-organizing replays into per-month subfolders changes both.
 *
 * Each of those produces a second record for a game already in the cache,
 * which would inflate game counts, hours played, and win-rate denominators.
 *
 * So game identity comes from inside the replay instead. Two games cannot start
 * in the same second, on the same stage, between the same players.
 */
export function gameKey(rec: GameRecord): string {
  // No start timestamp — pre-metadata replays, and the parse-failure tombstones
  // pool.ts writes. There is nothing stable to match on, so fall back to the
  // file key: such a record dedups against a rescan of that same file and
  // nothing else, which is the honest answer rather than a risky guess.
  if (!rec.playedAt) return rec.id;
  // A connect code identifies a netplay side across copies. Offline sides have
  // none, so port + character stands in. Sorted because port order is not
  // guaranteed identical between the two records we are trying to match.
  const sides = rec.players
    .map((p) => p.connectCode ?? `p${p.port}:${p.characterId}`)
    .sort()
    .join("+");
  return `${rec.playedAt}|${rec.stageId}|${sides}`;
}

/** True when `a` should survive dedup over `b`. */
function preferred(a: GameRecord, b: GameRecord): boolean {
  const aTombstone = a.parseError !== undefined;
  const bTombstone = b.parseError !== undefined;
  // A real record beats a tombstone. This does not fire today — pool.ts writes
  // tombstones with playedAt null, so they key on their file id and can never
  // collide with anything. It is here so that a tombstone which one day does
  // carry a timestamp (header read, stats failed) loses to the copy of that
  // game which parsed cleanly on another machine, rather than winning on id.
  if (aTombstone !== bTombstone) return bTombstone;
  return a.id < b.id;
}

/**
 * Collapse records describing the same game down to one apiece.
 *
 * The survivor is chosen deterministically — real record over tombstone, then
 * lowest id — rather than first-wins, because the cache restore, the folder
 * scan and a cloud pull all race to deliver records. Order-dependent survivors
 * would mean a different React key for the same game between two loads.
 *
 * Returns the input array untouched when there is nothing to collapse, so the
 * common case doesn't invalidate every downstream memo.
 */
export function dedupeRecords(records: GameRecord[]): GameRecord[] {
  const best = new Map<string, GameRecord>();
  for (const rec of records) {
    const key = gameKey(rec);
    const cur = best.get(key);
    if (cur === undefined || preferred(rec, cur)) best.set(key, rec);
  }
  return best.size === records.length ? records : [...best.values()];
}
