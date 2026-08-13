import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameRecord } from "../lib/types";
import { cloudEnabled, currentSession, onAuthChange, signInWithGoogle, signOut, type Session } from "../lib/supabase";
import { pushMyCodes, syncRecords } from "../lib/cloudSync";
import { GoogleG } from "./GoogleG";

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

  const busyRef = useRef(false);
  const lastSyncAt = useRef(0);

  const runSync = useCallback(async () => {
    if (busyRef.current) return; // auto-triggers can race the manual button
    busyRef.current = true;
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
    } finally {
      busyRef.current = false;
      lastSyncAt.current = Date.now();
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

  // Auto-push: newly parsed games sync on their own once the parse stream goes
  // quiet (record appends arrive ~1/s, so 2.5s of quiet ≈ done). One attempt
  // per pending count — a failure (offline) leaves the gold manual button
  // rather than a retry loop, and any further parsing re-arms the attempt.
  const autoPushTried = useRef<number | null>(null);
  useEffect(() => {
    if (pending === 0) {
      autoPushTried.current = null;
      return;
    }
    if (!session || sync.kind === "busy" || autoPushTried.current === pending) return;
    const t = window.setTimeout(() => {
      autoPushTried.current = pending;
      void runSync();
    }, 2500);
    return () => window.clearTimeout(t);
  }, [pending, session, sync.kind, runSync]);

  // Auto-pull: returning to the tab re-syncs (≥60s apart) so games pushed from
  // another device appear without a manual sync or reload.
  useEffect(() => {
    if (!session || isDemo) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSyncAt.current < 60_000) return;
      void runSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [session, isDemo, runSync]);

  if (!cloudEnabled || isDemo) return null;

  if (!session) {
    return (
      <button
        className="ghost"
        style={{ marginLeft: 10, display: "inline-flex", alignItems: "center", gap: 8 }}
        onClick={() => void signInWithGoogle().catch(console.error)}
      >
        <GoogleG size={14} />
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
          ? "Synced ✓"
          : sync.kind === "error"
            ? "Sync failed — retry"
            : "Sync to cloud";

  return (
    <>
      <button
        className={hasPending ? "ghost attn" : "ghost"}
        style={{ marginLeft: 10 }}
        title={
          sync.kind === "done"
            ? `Last sync: ${sync.pushed.toLocaleString()} pushed, ${sync.pulled.toLocaleString()} pulled`
            : undefined
        }
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
