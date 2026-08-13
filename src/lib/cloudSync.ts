import type { GameRecord } from "./types";
import { putRecords } from "./db";
import { supabase } from "./supabase";

/**
 * Sync strategy: the cloud holds the same flattened GameRecords the local cache
 * does, keyed (user_id, id) where id is path|size|mtime — identical on every
 * machine that parses the same file, so upsert is naturally idempotent. Each
 * sync diffs id sets both ways: push local-only records, pull remote-only ones.
 * Raw .slp files never leave the machine.
 */

/** Rows per upsert request — ~500 × ~4 KB ≈ 2 MB, safely under request limits. */
const PUSH_CHUNK = 500;
/** Ids per .in() filter — they ride in the query string, so keep it modest. */
const PULL_CHUNK = 150;
/** Ids per page when listing what the cloud already has. */
const ID_PAGE = 1000;

export interface SyncResult {
  pushed: number;
  pulled: GameRecord[];
}

async function remoteIds(): Promise<Set<string>> {
  if (!supabase) return new Set();
  const ids = new Set<string>();
  for (let from = 0; ; from += ID_PAGE) {
    const { data, error } = await supabase
      .from("game_records")
      .select("id")
      .range(from, from + ID_PAGE - 1);
    if (error) throw error;
    for (const row of data) ids.add(row.id as string);
    if (data.length < ID_PAGE) return ids;
  }
}

async function pushMissing(local: GameRecord[], remote: Set<string>): Promise<number> {
  if (!supabase) return 0;
  // parseError rows carry no stats and can't be re-derived elsewhere — skip them.
  const toPush = local.filter((r) => !remote.has(r.id) && !r.parseError);
  for (let i = 0; i < toPush.length; i += PUSH_CHUNK) {
    const chunk = toPush.slice(i, i + PUSH_CHUNK).map((r) => ({
      id: r.id,
      data: r,
      played_at: r.playedAt,
    }));
    const { error } = await supabase.from("game_records").upsert(chunk, { onConflict: "user_id,id" });
    if (error) throw error;
  }
  return toPush.length;
}

async function pullMissing(localIdSet: Set<string>, remote: Set<string>): Promise<GameRecord[]> {
  if (!supabase) return [];
  const missing = [...remote].filter((id) => !localIdSet.has(id));
  const pulled: GameRecord[] = [];
  for (let i = 0; i < missing.length; i += PULL_CHUNK) {
    const { data, error } = await supabase
      .from("game_records")
      .select("data")
      .in("id", missing.slice(i, i + PULL_CHUNK));
    if (error) throw error;
    pulled.push(...data.map((row) => row.data as GameRecord));
  }
  if (pulled.length) await putRecords(pulled); // also lands them in the local cache
  return pulled;
}

/**
 * Two-way reconcile. Caller passes the full local record list (it already has
 * it in memory) and gets back what was pushed/pulled; pulled records are
 * already persisted locally, so the caller only needs to update React state.
 */
export async function syncRecords(local: GameRecord[]): Promise<SyncResult> {
  if (!supabase) return { pushed: 0, pulled: [] };
  const remote = await remoteIds();
  const localIdSet = new Set(local.map((r) => r.id));
  const pushed = await pushMissing(local, remote);
  const pulled = await pullMissing(localIdSet, remote);
  return { pushed, pulled };
}

/** Cloud copy of the identity codes; last write wins, which matches the UX. */
export async function pushMyCodes(codes: string[]): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("user_settings").upsert({ my_codes: codes });
  if (error) throw error;
}

export async function pullMyCodes(): Promise<string[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("user_settings").select("my_codes").maybeSingle();
  if (error) throw error;
  return (data?.my_codes as string[] | undefined) ?? null;
}
