import Dexie, { type Table } from "dexie";
import type { GameRecord } from "./types";

/**
 * Browser-local persistence. Nothing leaves the machine; this exists so a
 * repeat visit only parses files not seen before (keyed on path|size|mtime).
 */
class SsbmDb extends Dexie {
  games!: Table<GameRecord, string>;
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
  }
}

export const db = new SsbmDb();

export async function cachedIds(): Promise<Set<string>> {
  const keys = await db.games.toCollection().primaryKeys();
  return new Set(keys);
}

export async function putRecords(records: GameRecord[]): Promise<void> {
  if (records.length) await db.games.bulkPut(records);
}

export async function allRecords(): Promise<GameRecord[]> {
  return db.games.toArray();
}

export async function clearAll(): Promise<void> {
  await db.games.clear();
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
