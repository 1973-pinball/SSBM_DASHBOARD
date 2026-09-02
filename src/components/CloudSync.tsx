import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Account, GameRecord } from "../lib/types";
import { CURRENT_STATS_VERSION } from "../lib/types";
import { cloudEnabled, currentSession, onAuthChange, signInWithGoogle, signOut, type Session } from "../lib/supabase";
import { isSyncable, pushMyAccounts, syncRecords, type CloudSyncKnowledge } from "../lib/cloudSync";
import { getCloudSyncState, setCloudSyncState } from "../lib/db";
import { GoogleG } from "./GoogleG";

interface Props {
  records: GameRecord[];
  accounts: Account[];
  isDemo: boolean;
  /** App's reset generation when this mounted — stale syncs identify themselves with it. */
  generation: number;
  /** Pulled records are already in the local cache; parent only updates state. */
  onPulled: (pulled: GameRecord[], generation: number) => void;
}

type SyncState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; pushed: number; pulled: number } | { kind: "error" };

/**
 * Optional account layer: sign in with Google to mirror the local record cache
 * to Supabase (flattened stats only — never raw .slp or .slpz files). Renders nothing when
 * the Supabase env vars are absent, keeping the app local-only by default.
 */
export function CloudSync({ records, accounts, isDemo, generation, onPulled }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [sync, setSync] = useState<SyncState>({ kind: "idle" });
  // Ids acknowledged by the cloud as of the last successful sync. That includes
  // local aliases for games already stored under a moved folder's file id, so
  // anything absent was parsed since — those are the "unsynced" games the gold
  // button calls out. Null until this user's knowledge is restored or synced.
  const [syncedIds, setSyncedIds] = useState<Set<string> | null>(null);
  const autoSynced = useRef(false);
  const knowledge = useRef<CloudSyncKnowledge | null>(null);
  const knowledgeOwner = useRef<string | null>(null);
  const [knowledgeReady, setKnowledgeReady] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Latest props for the auto-sync effect without re-triggering it per change.
  const latest = useRef({ records, accounts, generation });
  latest.current = { records, accounts, generation };

  useEffect(() => {
    if (!cloudEnabled) return;
    void currentSession().then(setSession);
    return onAuthChange(setSession);
  }, []);

  // A successful sync leaves enough browser-local knowledge to query only
  // rows changed since its server cursor. Scope it by auth user: two people
  // sharing a browser must never reuse one another's private remote id set.
  useEffect(() => {
    autoSynced.current = false;
    knowledge.current = null;
    knowledgeOwner.current = null;
    setSyncedIds(null);
    setKnowledgeReady(false);
    const userId = session?.user.id;
    if (!userId) {
      setKnowledgeReady(true);
      return;
    }
    let active = true;
    void getCloudSyncState(userId)
      .then((stored) => {
        if (!active) return;
        if (stored?.statsVersion === CURRENT_STATS_VERSION) {
          const restored = { ids: new Set(stored.ids), cursor: stored.cursor };
          knowledge.current = restored;
          setSyncedIds(new Set(restored.ids));
        }
      })
      .catch(console.error)
      .finally(() => {
        if (active) {
          knowledgeOwner.current = userId;
          setKnowledgeReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [session?.user.id]);

  const busyRef = useRef(false);
  const lastSyncAt = useRef(0);

  const runSync = useCallback(async () => {
    if (busyRef.current) return; // auto-triggers can race the manual button
    busyRef.current = true;
    setSync({ kind: "busy" });
    try {
      const { records: recs, accounts: accts, generation: gen } = latest.current;
      const codes = new Set(accts.map((a) => a.code));
      const userId = sessionRef.current?.user.id;
      const result = await syncRecords(recs, codes, knowledge.current ?? undefined);
      if (result.pulled.length) onPulled(result.pulled, gen);
      knowledge.current = result.knowledge;
      setSyncedIds(new Set(result.knowledge.ids));
      if (userId) {
        // Losing this optimization state is safe: the next visit performs one
        // metadata bootstrap. It must not turn an otherwise successful cloud
        // backup into a visible sync failure when local storage is tight.
        await setCloudSyncState(userId, {
          statsVersion: CURRENT_STATS_VERSION,
          ids: [...result.knowledge.ids],
          cursor: result.knowledge.cursor,
        }).catch(console.error);
      }
      // The dashboard always has accounts (identity is confirmed before entry);
      // fresh-device adoption of cloud accounts happens in App's landing restore.
      if (accts.length) await pushMyAccounts(accts);
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
    if (
      !session ||
      !knowledgeReady ||
      knowledgeOwner.current !== session.user.id ||
      isDemo ||
      autoSynced.current
    ) return;
    autoSynced.current = true;
    void runSync();
  }, [session, knowledgeReady, isDemo, runSync]);

  // Games of the user's own parsed since the last sync (e.g. a folder Refresh
  // mid-session). Adding an account makes its games newly syncable, so they
  // show up here and the auto-push picks them up without a rescan.
  const pending = useMemo(() => {
    if (!syncedIds) return 0;
    const codes = new Set(accounts.map((a) => a.code));
    let n = 0;
    for (const r of records) if (isSyncable(r, codes) && !syncedIds.has(r.id)) n++;
    return n;
  }, [records, syncedIds, accounts]);

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

  // Auto-pull: returning to the tab periodically re-syncs so games pushed from
  // another device appear without a manual sync or reload. Fifteen minutes
  // keeps convergence automatic without turning normal tab switching into a
  // database request; the old one-minute interval repeatedly listed 20k ids.
  useEffect(() => {
    if (!session || isDemo) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSyncAt.current < 15 * 60_000) return;
      void runSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [session, isDemo, runSync]);

  if (!cloudEnabled || isDemo) return null;

  if (!session) {
    return (
      <button className="ghost" onClick={() => void signInWithGoogle().catch(console.error)}>
        <span className="btn-icon">
          <GoogleG size={14} />
          Sign in with Google
        </span>
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
        title={session.user.email ?? undefined}
        onClick={() =>
          void signOut().then(() => {
            setSync({ kind: "idle" });
            setSyncedIds(null);
            knowledge.current = null;
            knowledgeOwner.current = null;
          })
        }
      >
        Sign out
      </button>
    </>
  );
}
