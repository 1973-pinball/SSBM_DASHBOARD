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
