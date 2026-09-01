import type { Account, GameRecord } from "./types";
import { CURRENT_STATS_VERSION, hasCurrentStats, hasFullStats } from "./types";
import { putRecords } from "./db";
import { dedupeRecords, gameKey } from "./dedupe";
import { supabase } from "./supabase";

/**
 * Sync strategy: the cloud holds the same flattened GameRecords the local cache
 * does, keyed (user_id, id) where id is path|size|mtime — identical on every
 * machine that parses the same file, so upsert is naturally idempotent. Each
 * sync diffs id sets both ways: push local-only records, pull remote-only ones.
 * Raw replay files (.slp and .slpz) never leave the machine.
 */

/** Rows per upsert request — ~500 × ~4 KB ≈ 2 MB, safely under request limits. */
const PUSH_CHUNK = 500;
/** Ids per .in() filter — they ride in the query string, so keep it modest. */
const PULL_CHUNK = 150;
/** Ids per page when listing what the cloud already has. */
const ID_PAGE = 1000;
/** Rows per request on a fresh-device restore. Unlike the normal id diff, an
 *  empty device can stream full rows directly instead of listing every id and
 *  then fetching them again in much smaller query-string batches. */
const RESTORE_PAGE = 1000;

const stampCurrentVersion = (rec: GameRecord): GameRecord =>
  rec.statsVersion === CURRENT_STATS_VERSION ? rec : { ...rec, statsVersion: CURRENT_STATS_VERSION };

export interface SyncResult {
  pushed: number;
  pulled: GameRecord[];
}

/**
 * Fast path for an empty local cache (new browser/device/custom domain).
 * Fetch full records once in stable id order, report progress per page, then
 * persist the deterministic content-deduped result. The normal two-way sync
 * deliberately keeps its id diff; it is still cheaper when local is populated.
 */
export async function restoreCloudRecords(
  onProgress?: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<GameRecord[]> {
  if (!supabase) return [];
  const records: GameRecord[] = [];
  for (let from = 0; ; from += RESTORE_PAGE) {
    let query = supabase
      .from("game_records")
      .select("data")
      .order("id", { ascending: true })
      .range(from, from + RESTORE_PAGE - 1);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) records.push(row.data as GameRecord);
    onProgress?.(records.length);
    if (rows.length < RESTORE_PAGE) break;
  }
  const restored = dedupeRecords(records);
  // Pre-tech rows remain available in memory so the rest of the dashboard does
  // not vanish during migration, but they must not enter `seen`: the remembered
  // replay folder needs to regard those files as unparsed and replace them.
  const current = restored.filter(hasCurrentStats).map(stampCurrentVersion);
  if (current.length) await putRecords(current);
  return restored;
}

/**
 * Whether a record may leave the machine: a game one of the user's own accounts
 * actually played, and not a parse-failure tombstone (those carry no stats and
 * can't be re-derived elsewhere).
 *
 * A shared replay folder holds other people's games — a housemate's, a friend's
 * on the same setup. Those still parse and cache locally, because identity is a
 * query-time concept and adding an account later has to be able to reach back
 * and claim them (decision 1). But uploading someone else's stats to the user's
 * private project isn't the user's call to make, so the network boundary is
 * where participation starts to matter.
 *
 * The same predicate has to gate CloudSync's pending count. Filtering the push
 * alone would leave every foreign game permanently unsynced, pinning the button
 * gold and re-arming the auto-push on each change.
 */
export function isSyncable(rec: GameRecord, myCodes: Set<string>): boolean {
  if (rec.parseError) return false;
  // Header previews are transient and carry zeroed execution metrics. A push
  // would upsert one over the full record another device already holds, since
  // both share the (user_id, id) key — and because the preview is never written
  // to the local cache, nothing here would ever correct it back.
  if (!hasFullStats(rec)) return false;
  // A pre-tech cloud row must never overwrite the current copy on another
  // device. It becomes syncable only after that device reparses the replay.
  if (!hasCurrentStats(rec)) return false;
  return rec.players.some((p) => p.connectCode !== null && myCodes.has(p.connectCode));
}

interface RemoteIndex {
  ids: Set<string>;
  staleIds: Set<string>;
  /** One existing row per content key. Current rows win over stale duplicates. */
  idByKey: Map<string, string>;
}

async function remoteIndex(): Promise<RemoteIndex> {
  const ids = new Set<string>();
  const staleIds = new Set<string>();
  const idByKey = new Map<string, string>();
  if (!supabase) return { ids, staleIds, idByKey };
  for (let from = 0; ; from += ID_PAGE) {
    const { data, error } = await supabase
      .from("game_records")
      // JSON projection returns one scalar instead of downloading every ~5 KB
      // record merely to decide whether its payload predates tech stats.
      .select("id, game_key, stats_version:data->>statsVersion")
      .order("id", { ascending: true })
      .range(from, from + ID_PAGE - 1);
    if (error) throw error;
    for (const raw of data) {
      const row = raw as { id: string; game_key: string | null; stats_version: string | number | null };
      ids.add(row.id);
      const stale = Number(row.stats_version) !== CURRENT_STATS_VERSION;
      if (stale) staleIds.add(row.id);
      if (row.game_key) {
        const existing = idByKey.get(row.game_key);
        if (!existing || (staleIds.has(existing) && !stale)) idByKey.set(row.game_key, row.id);
      }
    }
    if (data.length < ID_PAGE) return { ids, staleIds, idByKey };
  }
}

async function pushMissing(local: GameRecord[], remote: RemoteIndex, myCodes: Set<string>): Promise<number> {
  if (!supabase) return 0;
  // isSyncable drops tombstones and anyone else's games (see above).
  // A record whose *game* is already up there under a different file key is a
  // folder copy rather than a new game: pushing it would double the library in
  // the cloud every time the folder moves.
  const toPush: { rec: GameRecord; key: string; targetId: string }[] = [];
  for (const rec of local) {
    if (!isSyncable(rec, myCodes)) continue;
    const key = gameKey(rec);
    const sameIdExists = remote.ids.has(rec.id);
    if (sameIdExists && !remote.staleIds.has(rec.id)) continue;

    let targetId = rec.id;
    if (!sameIdExists) {
      const existing = remote.idByKey.get(key);
      if (existing) {
        if (!remote.staleIds.has(existing)) continue;
        // Same game under a moved/copied file id: update the stale row in place
        // instead of appending a second cloud record.
        targetId = existing;
      }
    }
    toPush.push({ rec, key, targetId });
    remote.ids.add(targetId);
    remote.staleIds.delete(targetId);
    remote.idByKey.set(key, targetId);
  }
  for (let i = 0; i < toPush.length; i += PUSH_CHUNK) {
    const chunk = toPush.slice(i, i + PUSH_CHUNK).map(({ rec, key, targetId }) => ({
      id: targetId,
      data: { ...stampCurrentVersion(rec), id: targetId },
      played_at: rec.playedAt,
      game_key: key,
    }));
    const { error } = await supabase.from("game_records").upsert(chunk, { onConflict: "user_id,id" });
    if (error) throw error;
  }
  return toPush.length;
}

async function pullMissing(local: GameRecord[], remote: RemoteIndex): Promise<GameRecord[]> {
  if (!supabase) return [];
  const haveIds = new Set(local.map((r) => r.id));
  // Content keys, not just ids: a device that parsed the same replays from its
  // own copy of the folder holds every game already, under different ids.
  // Pulling those would plant duplicates straight into the local cache.
  const haveKeys = new Set(local.map(gameKey));
  // Stale remote rows stay available through the fresh-device restore path,
  // but normal sync must not persist them locally and mark the replay parsed.
  const missing = [...remote.ids].filter((id) => !haveIds.has(id) && !remote.staleIds.has(id));
  const pulled: GameRecord[] = [];
  for (let i = 0; i < missing.length; i += PULL_CHUNK) {
    const { data, error } = await supabase
      .from("game_records")
      .select("data")
      .in("id", missing.slice(i, i + PULL_CHUNK));
    if (error) throw error;
    for (const row of data) {
      const rec = row.data as GameRecord;
      const key = gameKey(rec);
      if (haveKeys.has(key)) continue;
      haveKeys.add(key);
      pulled.push(rec);
    }
  }
  if (pulled.length) await putRecords(pulled); // also lands them in the local cache
  return pulled;
}

/**
 * Two-way reconcile. Caller passes the full local record list (it already has
 * it in memory) and gets back what was pushed/pulled; pulled records are
 * already persisted locally, so the caller only needs to update React state.
 */
export async function syncRecords(local: GameRecord[], myCodes: Set<string>): Promise<SyncResult> {
  if (!supabase) return { pushed: 0, pulled: [] };
  const remote = await remoteIndex();
  const pushed = await pushMissing(local, remote, myCodes);
  // The pull stays unfiltered: RLS means everything up there is already this
  // user's, and anything a pre-participation-filter release left behind is
  // dropped at resolve time anyway. Filtering here would also break the
  // fresh-device restore, which syncs before it knows what the accounts are.
  const pulled = await pullMissing(local, remote);
  return { pushed, pulled };
}

/**
 * Cloud copy of the user's accounts; last write wins, which matches the UX.
 * Array position becomes sort_order, so the editor's ordering survives a
 * restore — the first account is the one that titles the player card.
 */
export async function pushMyAccounts(accounts: Account[]): Promise<void> {
  if (!supabase) return;
  if (accounts.length) {
    // user_id comes from the column default (auth.uid()), same as game_records.
    const rows = accounts.map((a, i) => ({ code: a.code, label: a.label, sort_order: i }));
    const { error } = await supabase.from("user_codes").upsert(rows, { onConflict: "user_id,code" });
    if (error) throw error;
  }
  // An account removed in the editor has to actually disappear — upsert alone
  // would leave it behind. Diffing against what's up there beats deleting the
  // lot first, which would strand the user with no identity if the write failed.
  const { data, error } = await supabase.from("user_codes").select("code");
  if (error) throw error;
  const keep = new Set(accounts.map((a) => a.code));
  const stale = data.map((r) => r.code as string).filter((c) => !keep.has(c));
  if (stale.length) {
    const { error: delError } = await supabase.from("user_codes").delete().in("code", stale);
    if (delError) throw delError;
  }
}

export async function pullMyAccounts(signal?: AbortSignal): Promise<Account[] | null> {
  if (!supabase) return null;
  let query = supabase
    .from("user_codes")
    .select("code, label, sort_order")
    .order("sort_order", { ascending: true });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  // No user_settings fallback: the schema's backfill copied every pre-existing
  // my_codes array into user_codes, so a user who had an identity before the
  // migration already has rows here. Empty genuinely means "never set one".
  return data.length
    ? data.map((r) => ({ code: r.code as string, label: (r.label as string | null) ?? null }))
    : null;
}
