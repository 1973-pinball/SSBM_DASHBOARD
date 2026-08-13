import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameRecord } from "../lib/types";
import { cloudEnabled, currentSession, onAuthChange, signInWithGoogle, signOut, type Session } from "../lib/supabase";
import { pushMyCodes, syncRecords } from "../lib/cloudSync";

interface Props {
  records: GameRecord[];
  myCodes: string[];
  isDemo: boolean;
  /** App's reset generation when this mounted — stale syncs identify themselves with it. */
  generation: number;
  /** Pulled records are already in the local cache; parent only updates state. */
  onPulled: (pulled: GameRecord[], generation: number) => void;
}

type SyncState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; pushed: number; pulled: number } | { kind: "error" };

/**
 * Optional account layer: sign in with Google to mirror the local record cache
 * to Supabase (flattened stats only — never .slp files). Renders nothing when
 * the Supabase env vars are absent, keeping the app local-only by default.
 */
export function CloudSync({ records, myCodes, isDemo, generation, onPulled }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [sync, setSync] = useState<SyncState>({ kind: "idle" });
  // Ids known to be in the cloud as of the last successful sync. After a sync
  // every then-current record is in the cloud by definition, so anything local
  // that isn't in this set was parsed since — those are the "unsynced" games
  // the gold button state calls out. Null until the first sync of this visit.
  const [syncedIds, setSyncedIds] = useState<Set<string> | null>(null);
  const autoSynced = useRef(false);

  // Latest props for the auto-sync effect without re-triggering it per change.
  const latest = useRef({ records, myCodes, generation });
  latest.current = { records, myCodes, generation };

  useEffect(() => {
    if (!cloudEnabled) return;
    void currentSession().then(setSession);
    return onAuthChange(setSession);
  }, []);

  const runSync = useCallback(async () => {
    setSync({ kind: "busy" });
    try {
      const { records: recs, myCodes: codes, generation: gen } = latest.current;
      const result = await syncRecords(recs);
      if (result.pulled.length) onPulled(result.pulled, gen);
      // The dashboard always has codes (identity is confirmed before entry);
      // fresh-device adoption of cloud codes happens in App's landing restore.
      if (codes.length) await pushMyCodes(codes);
      // parseError tombstones are never pushed, so they never count as pending.
      const ids = new Set<string>();
      for (const r of recs) if (!r.parseError) ids.add(r.id);
      for (const r of result.pulled) ids.add(r.id);
      setSyncedIds(ids);
      setSync({ kind: "done", pushed: result.pushed, pulled: result.pulled.length });
    } catch (err) {
      console.error(err);
      setSync({ kind: "error" });
    }
  }, [onPulled]);

  // One automatic reconcile per visit once signed in — manual after that.
  useEffect(() => {
    if (!session || isDemo || autoSynced.current) return;
    autoSynced.current = true;
    void runSync();
  }, [session, isDemo, runSync]);

  // Games parsed since the last sync (e.g. a folder Refresh mid-session).
  const pending = useMemo(() => {
    if (!syncedIds) return 0;
    let n = 0;
    for (const r of records) if (!r.parseError && !syncedIds.has(r.id)) n++;
    return n;
  }, [records, syncedIds]);

  if (!cloudEnabled || isDemo) return null;

  if (!session) {
    return (
      <button className="ghost" style={{ marginLeft: 10 }} onClick={() => void signInWithGoogle().catch(console.error)}>
        Sign in with Google
      </button>
    );
  }

  // Pending games outrank the "done" receipt: after a folder Refresh the
  // button flips gold to say new games still need a push.
  const hasPending = sync.kind !== "busy" && pending > 0;
  const label =
    sync.kind === "busy"
      ? "Syncing…"
      : hasPending
        ? `Sync ${pending.toLocaleString()} new game${pending === 1 ? "" : "s"}`
        : sync.kind === "done"
          ? `Synced ↑${sync.pushed.toLocaleString()} ↓${sync.pulled.toLocaleString()}`
          : sync.kind === "error"
            ? "Sync failed — retry"
            : "Sync to cloud";

  return (
    <>
      <button
        className={hasPending ? "ghost attn" : "ghost"}
        style={{ marginLeft: 10 }}
        onClick={() => void runSync()}
        disabled={sync.kind === "busy"}
      >
        {label}
      </button>
      <button
        className="ghost"
        style={{ marginLeft: 10 }}
        title={session.user.email ?? undefined}
        onClick={() =>
          void signOut().then(() => {
            setSync({ kind: "idle" });
            setSyncedIds(null);
          })
        }
      >
        Sign out
      </button>
    </>
  );
}
