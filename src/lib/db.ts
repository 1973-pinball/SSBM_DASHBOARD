import Dexie, { type Table } from "dexie";
import type { GameRecord } from "./types";

/**
 * Records live packed ~250 to a row: reading tens of thousands of individual
 * ~1-2 KB rows on startup is dominated by per-row IndexedDB overhead, and
 * packing makes the full-cache restore several times faster. Dedup stays
 * per-game via the id-only `seen` table (primary-key reads are cheap).
 */
export interface RecordPack {
  id?: number;
  records: GameRecord[];
}

const PACK_SIZE = 250;

/**
 * Browser-local persistence. Nothing leaves the machine; this exists so a
 * repeat visit only parses files not seen before (keyed on path|size|mtime).
 */
class SsbmDb extends Dexie {
  /** Legacy per-record table; empty since v8. Kept declared so Dexie retains the store. */
  games!: Table<GameRecord, string>;
  packs!: Table<RecordPack, number>;
  seen!: Table<{ id: string }, string>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("ssbm-dashboard");
    this.version(1).stores({
      games: "id, playedAt, stageId, gameType",
      kv: "key",
    });
    // v2 added teams support. Rows parsed by v1 have no teamId/winnerTeamId —
    // they carry no usable 2v2 result, so drop them and let a rescan re-parse.
    this.version(2)
      .stores({
        games: "id, playedAt, stageId, gameType",
        kv: "key",
      })
      .upgrade(async (tx) => {
        await tx
          .table<GameRecord>("games")
          .toCollection()
          .filter((r) => r.isTeams === true)
          .delete();
      });
    // v3 added per-player action counts, which every older row is missing, so
    // averaging over a mixed cache would silently understate them. Drop all
    // rows; the folder rescan re-parses the library once.
    this.version(3)
      .stores({
        games: "id, playedAt, stageId, gameType",
        kv: "key",
      })
      .upgrade(async (tx) => {
        await tx.table("games").clear();
      });
    // v4 added counter hits + beneficial trades; same missing-field reasoning.
    this.version(4)
      .stores({
        games: "id, playedAt, stageId, gameType",
        kv: "key",
      })
      .upgrade(async (tx) => {
        await tx.table("games").clear();
      });
    // v5 added grab counts; same missing-field reasoning.
    this.version(5)
      .stores({
        games: "id, playedAt, stageId, gameType",
        kv: "key",
      })
      .upgrade(async (tx) => {
        await tx.table("games").clear();
      });
    // v6 fixed quit-out results: LRAS games could credit a win from stale
    // placement data. Cached rows don't record the end method, so the bad
    // ones can't be picked out — drop all rows and let the rescan re-parse.
    this.version(6)
      .stores({
        games: "id, playedAt, stageId, gameType",
        kv: "key",
      })
      .upgrade(async (tx) => {
        await tx.table("games").clear();
      });
    // v7 added damage/kill matrices and real per-player doubles stats
    // (slippi-js computes nothing for 4-player games, so old teams rows are
    // all zeros). Same missing-field reasoning — full re-parse.
    this.version(7)
      .stores({
        games: "id, playedAt, stageId, gameType",
        kv: "key",
      })
      .upgrade(async (tx) => {
        await tx.table("games").clear();
      });
    // v8 repacks records into ~250-game rows (see RecordPack). Pure storage
    // reshaping — existing rows are migrated in place, NO re-parse.
    this.version(8)
      .stores({
        games: "id, playedAt, stageId, gameType",
        packs: "++id",
        seen: "id",
        kv: "key",
      })
      .upgrade(async (tx) => {
        const rows = (await tx.table<GameRecord>("games").toArray()) as GameRecord[];
        if (rows.length) {
          await tx.table("seen").bulkPut(rows.map((r) => ({ id: r.id })));
          const packs: RecordPack[] = [];
          for (let i = 0; i < rows.length; i += PACK_SIZE) {
            packs.push({ records: rows.slice(i, i + PACK_SIZE) });
          }
          await tx.table("packs").bulkAdd(packs);
        }
        await tx.table("games").clear();
      });
    // v9 added per-move aggregates (PlayerSide.moveStats) computed from
    // conversions at parse time; same missing-field reasoning as v3–v7 —
    // clear and let the rescan re-parse. Records live in packs since v8,
    // so clear packs + seen rather than the legacy games table.
    this.version(9)
      .stores({
        games: "id, playedAt, stageId, gameType",
        packs: "++id",
        seen: "id",
        kv: "key",
      })
      .upgrade(async (tx) => {
        await tx.table("packs").clear();
        await tx.table("seen").clear();
      });
    // v10 added per-aerial L-cancel counts to MoveAgg; v9 rows lack the
    // fields and would silently understate rates. Clear and re-parse.
    this.version(10)
      .stores({
        games: "id, playedAt, stageId, gameType",
        packs: "++id",
        seen: "id",
        kv: "key",
      })
      .upgrade(async (tx) => {
        await tx.table("packs").clear();
        await tx.table("seen").clear();
      });
  }
}

export const db = new SsbmDb();

export async function cachedIds(): Promise<Set<string>> {
  const keys = await db.seen.toCollection().primaryKeys();
  return new Set(keys);
}

export async function putRecords(records: GameRecord[]): Promise<void> {
  if (!records.length) return;
  await db.transaction("rw", db.packs, db.seen, async () => {
    await db.seen.bulkPut(records.map((r) => ({ id: r.id })));
    const queue = [...records];
    // Top up the trailing partial pack before opening new ones.
    const last = await db.packs.orderBy(":id").last();
    if (last && last.records.length < PACK_SIZE) {
      last.records.push(...queue.splice(0, PACK_SIZE - last.records.length));
      await db.packs.put(last);
    }
    while (queue.length) {
      await db.packs.add({ records: queue.splice(0, PACK_SIZE) });
    }
  });
}

export async function allRecords(): Promise<GameRecord[]> {
  const packs = await db.packs.toArray();
  return packs.flatMap((p) => p.records);
}

export async function clearAll(): Promise<void> {
  await db.games.clear();
  await db.packs.clear();
  await db.seen.clear();
  await db.kv.clear();
}

export async function getMyCodes(): Promise<string[]> {
  const row = await db.kv.get("myCodes");
  return (row?.value as string[]) ?? [];
}

export async function setMyCodes(codes: string[]): Promise<void> {
  await db.kv.put({ key: "myCodes", value: codes });
}

/**
 * Directory handles are structured-cloneable, so the picked replay folder can be
 * stored and re-walked on a later visit without re-prompting — this is what makes
 * "refresh" a single click instead of a re-pick. Chromium only; other browsers use
 * the <input webkitdirectory> path, which cannot persist a handle.
 */
export async function getDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const row = await db.kv.get("dirHandle");
    return (row?.value as FileSystemDirectoryHandle) ?? null;
  } catch {
    return null;
  }
}

export async function setDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await db.kv.put({ key: "dirHandle", value: handle });
  } catch {
    // Non-fatal: refresh degrades to re-picking the folder.
  }
}
