import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Account, Filters, GameRecord, ParseProgress } from "./lib/types";
import { DEFAULT_FILTERS, hasFullStats } from "./lib/types";
import { discoverFromHandle, discoverFromFileList, runParsePipeline, RecordSaveError } from "./lib/pool";
import { allRecords, clearAll, getMyAccounts, setMyAccounts, getDirHandle, setDirHandle, pruneDuplicates } from "./lib/db";
import { codeGameCounts, resolveGames, resolveTeamGames, applyFilters, applyTeamFilters } from "./lib/stats";
import { dedupeRecords } from "./lib/dedupe";
import { generateDemoRecords, DEMO_ACCOUNTS } from "./lib/demo";
import { Landing } from "./components/Landing";
import { ProgressBar, IdentityPicker } from "./components/ProgressAndIdentity";
import { FilterBar } from "./components/FilterBar";
import { CloudSync } from "./components/CloudSync";
import { CommunityConsent } from "./components/CommunityConsent";
import { cloudEnabled, currentSession, signInWithGoogle } from "./lib/supabase";
import { pullMyAccounts, restoreCloudRecords } from "./lib/cloudSync";
import { moveTabFocus } from "./lib/a11y";

// Dashboard views are lazy so the landing/parsing path doesn't pay for
// recharts — it's the biggest dependency in the app and none of it renders
// before the dashboard phase.
const Overview = lazy(() => import("./components/Overview").then((m) => ({ default: m.Overview })));
const Teams = lazy(() => import("./components/Teams").then((m) => ({ default: m.Teams })));
const MetricsGuide = lazy(() => import("./components/MetricsGuide").then((m) => ({ default: m.MetricsGuide })));
const Matchups = lazy(() => import("./components/Views").then((m) => ({ default: m.Matchups })));
const Stages = lazy(() => import("./components/Views").then((m) => ({ default: m.Stages })));
const Opponents = lazy(() => import("./components/Views").then((m) => ({ default: m.Opponents })));
const Execution = lazy(() => import("./components/Views").then((m) => ({ default: m.Execution })));

const Community = lazy(() => import("./components/Community").then((m) => ({ default: m.Community })));
const Insights = lazy(() => import("./components/Insights").then((m) => ({ default: m.Insights })));


const Liquipedia = lazy(() => import("./components/liquipedia/Liquipedia").then((m) => ({ default: m.Liquipedia })));
const AccountsEditor = lazy(() => import("./components/AccountsEditor").then((m) => ({ default: m.AccountsEditor })));
const PrivacyPromise = lazy(() => import("./components/PrivacyPromise").then((m) => ({ default: m.PrivacyPromise })));

/**
 * Last line of defense for lazy-chunk failures: main.tsx auto-reloads once on
 * vite:preloadError, but if the chunk is still missing (guard window, server
 * trouble) the thrown error would otherwise white-screen the whole app.
 */
class ViewErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error-note" role="alert">
        This view failed to load — the site probably updated while this tab was open.
        <button className="ghost" style={{ marginLeft: 10 }} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

type Phase = "landing" | "parsing" | "identity" | "dashboard";
// "sessions", "records" and "log" are gone: the fatigue and tilt tables render
// inside Insights, personal bests are a card at the foot of Overview, and the
// game log is a collapsed panel on Opponents. tabFromUrl validates against
// TABS, so an old ?view= link for any of them falls back to overview rather
// than rendering nothing.
type Tab = "overview" | "matchups" | "stages" | "opponents" | "execution" | "insights" | "community" | "liquipedia";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "matchups", label: "Matchups" },
  { id: "stages", label: "Stages" },
  { id: "opponents", label: "Opponents" },

  { id: "execution", label: "Execution" },
  { id: "insights", label: "Insights" },


  { id: "community", label: "Community" },
  { id: "liquipedia", label: "Liquipedia" },
];

type Overlay = "guide" | "accounts" | "privacy" | null;
type PublicView = "community" | "liquipedia" | null;
interface AppHistoryState { ssbm: true; tab: Tab; overlay: Overlay; publicView: PublicView }

const tabFromUrl = (): Tab => {
  if (typeof window === "undefined") return "overview";
  const value = new URL(window.location.href).searchParams.get("view");
  return TABS.some((t) => t.id === value) ? value as Tab : "overview";
};

const overlayFromUrl = (): Overlay => {
  if (typeof window === "undefined") return null;
  const value = new URL(window.location.href).searchParams.get("overlay");
  return value === "guide" || value === "accounts" || value === "privacy" ? value : null;
};

const navUrl = (tab: Tab, overlay: Overlay = null) => {
  const url = new URL(window.location.href);
  url.searchParams.set("view", tab);
  if (overlay) url.searchParams.set("overlay", overlay);
  else url.searchParams.delete("overlay");
  return `${url.pathname}${url.search}${url.hash}`;
};

/** Why the last refresh left files unparsed, in the user's terms. */
function skippedDetail({ errors, deferred }: { errors: number; deferred: number }): string {
  const parts: string[] = [];
  if (deferred > 0) {
    parts.push(`${deferred.toLocaleString()} replay${deferred === 1 ? " was" : "s were"} still being written`);
  }
  if (errors > 0) parts.push(`${errors.toLocaleString()} couldn't be read`);
  return `${parts.join(", ")}. Nothing was cached for them — refresh again once Slippi has finished writing and they'll be picked up.`;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [accounts, setAccountsState] = useState<Account[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [isDemo, setIsDemo] = useState(false);
  const [showGuide, setShowGuide] = useState(() => overlayFromUrl() === "guide");
  const [showAccounts, setShowAccounts] = useState(() => overlayFromUrl() === "accounts");
  const [showPrivacy, setShowPrivacy] = useState(() => overlayFromUrl() === "privacy");
  // Public aggregate/history views need no replays, so both are reachable
  // straight from the landing page as well as from dashboard tabs.
  const [publicView, setPublicView] = useState<PublicView>(() => {
    const initial = tabFromUrl();
    return initial === "community" || initial === "liquipedia" ? initial : null;
  });
  const [dirHandle, setDirHandleState] = useState<FileSystemDirectoryHandle | null>(null);
  const [syncing, setSyncing] = useState<ParseProgress | null>(null);
  // What the last refresh chose not to parse. Nothing is cached for these, so
  // they are genuinely pending rather than lost — but a silent skip is exactly
  // what makes "my new games didn't show up" impossible to diagnose.
  const [syncSkipped, setSyncSkipped] = useState<{ errors: number; deferred: number } | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  // Null means idle; a number is the count streamed down so a first visit on a
  // new origin never looks frozen while a large cloud library is restoring.
  const [cloudRestoring, setCloudRestoring] = useState<number | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [folderPermission, setFolderPermission] = useState<PermissionState | "unknown">("unknown");
  const [lastScanned, setLastScanned] = useState<string | null>(() => localStorage.getItem("ssbm-last-scanned"));
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const autoSyncDone = useRef(false);
  // Four callers now walk the folder — the load auto-sync, the Refresh click,
  // a folder connect, and the re-focus rescan. Two overlapping runs would
  // stomp each other's abort controller and re-parse what the first was still
  // streaming in, so they take turns.
  const scanBusy = useRef(false);
  // When the last walk finished; throttles the re-focus rescan.
  const lastFolderSyncAt = useRef(0);
  // Browsers without the File System Access API can never remember a folder,
  // so their only way to add newly played games is to re-pick — the topbar
  // needs its own hidden input for that, same as the landing page.
  const topbarPickRef = useRef<HTMLInputElement>(null);
  // Bumped by reset(); async work captures the value at start and drops its
  // results if a reset happened in between, so an abandoned scan or cloud sync
  // can't write stale records into a wiped session.
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const supportsFsAccess = typeof window !== "undefined" && "showDirectoryPicker" in window;

  const markScanned = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem("ssbm-last-scanned", now);
    setLastScanned(now);
  }, []);

  const selectTab = useCallback((next: Tab, replace = false) => {
    setTab(next);
    setPublicView(null);
    const state: AppHistoryState = { ssbm: true, tab: next, overlay: null, publicView: null };
    window.history[replace ? "replaceState" : "pushState"](state, "", navUrl(next));
  }, []);

  const browsePublic = useCallback((next: Exclude<PublicView, null>) => {
    setPublicView(next);
    setTab(next);
    const state: AppHistoryState = { ssbm: true, tab: next, overlay: null, publicView: next };
    window.history.pushState(state, "", navUrl(next));
  }, []);

  const leavePublic = useCallback(() => {
    const state = window.history.state as AppHistoryState | null;
    if (state?.ssbm && state.publicView) window.history.back();
    else selectTab(phase === "dashboard" ? tab : "overview", true);
  }, [phase, selectTab, tab]);

  const openOverlay = useCallback((overlay: Exclude<Overlay, null>) => {
    if (overlay === "guide") setShowGuide(true);
    else if (overlay === "accounts") setShowAccounts(true);
    else setShowPrivacy(true);
    const state: AppHistoryState = { ssbm: true, tab, overlay, publicView };
    window.history.pushState(state, "", navUrl(tab, overlay));
  }, [publicView, tab]);

  const closeOverlay = useCallback((overlay: Exclude<Overlay, null>) => {
    const state = window.history.state as AppHistoryState | null;
    if (state?.ssbm && state.overlay === overlay) window.history.back();
    else if (overlay === "guide") setShowGuide(false);
    else if (overlay === "accounts") setShowAccounts(false);
    else setShowPrivacy(false);
  }, []);

  useEffect(() => {
    const initialTab = tabFromUrl();
    const initialPublic = initialTab === "community" || initialTab === "liquipedia" ? initialTab : null;
    const initialOverlay = overlayFromUrl();
    const state: AppHistoryState = { ssbm: true, tab: initialTab, overlay: initialOverlay, publicView: initialPublic };
    window.history.replaceState(state, "", navUrl(initialTab, initialOverlay));
    const onPop = (event: PopStateEvent) => {
      const next = event.state as AppHistoryState | null;
      const nextTab = next?.ssbm ? next.tab : tabFromUrl();
      setTab(nextTab);
      setPublicView(next?.ssbm ? next.publicView : null);
      setShowGuide(Boolean(next?.ssbm && next.overlay === "guide"));
      setShowAccounts(Boolean(next?.ssbm && next.overlay === "accounts"));
      setShowPrivacy(Boolean(next?.ssbm && next.overlay === "privacy"));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onInstall = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const onUpdate = () => setUpdateReady(true);
    const onOfflineReady = () => setOfflineReady(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("ssbm:update-ready", onUpdate);
    window.addEventListener("ssbm:offline-ready", onOfflineReady);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("ssbm:update-ready", onUpdate);
      window.removeEventListener("ssbm:offline-ready", onOfflineReady);
    };
  }, []);

  useEffect(() => {
    if (!offlineReady) return;
    const id = window.setTimeout(() => setOfflineReady(false), 6000);
    return () => window.clearTimeout(id);
  }, [offlineReady]);

  const installApp = useCallback(() => {
    if (!installPrompt) return;
    void installPrompt.prompt().then(() => installPrompt.userChoice).finally(() => setInstallPrompt(null));
  }, [installPrompt]);

  /**
   * Append records to state, deduped by id. Both the folder scan and a cloud
   * pull can race on dashboard entry and hand us the same game (ids are
   * machine-independent path|size|mtime), so blind appends double-count.
   */
  /**
   * Merge streamed records into state by id. Replacement matters here as much
   * as insertion: on a large import the pipeline delivers a header-only preview
   * of every game first and the full parse of the same file second, under the
   * same id. This used to skip any id already present, which would drop every
   * real record and strand the dashboard on preview numbers.
   */
  const appendRecords = useCallback((incoming: GameRecord[]) => {
    if (!incoming.length) return;
    setRecords((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      let changed = false;
      for (const rec of incoming) {
        const cur = byId.get(rec.id);
        if (cur === rec) continue;
        // Never let a preview overwrite the full record it was standing in for:
        // a late-delivered header batch can arrive after the full pass has
        // already replaced that game.
        if (cur && hasFullStats(cur) && !hasFullStats(rec)) continue;
        byId.set(rec.id, rec);
        changed = true;
      }
      // Map preserves insertion order, so a replaced record keeps its position.
      return changed ? [...byId.values()] : prev;
    });
  }, []);

  /**
   * The user's accounts: local cache first, then the cloud.
   *
   * Identity lives in `user_codes`, so a signed-in user arriving here without a
   * local copy has already told us who they are — on a new device, or on the
   * same one after "Change folder" cleared kv along with the replay cache.
   * Prompting them again is asking them to re-type something we hold, and it is
   * the one step between picking a folder and seeing a dashboard.
   *
   * Best-effort by design: offline, cloud sync not configured, or a failed
   * query all fall through to the identity prompt, which is exactly where the
   * user would have been anyway. A successful pull is written to kv so the next
   * load resolves locally and never waits on the network.
   */
  const accountsForSession = useCallback(async (): Promise<Account[]> => {
    const local = await getMyAccounts();
    if (local.length > 0 || !cloudEnabled) return local;
    try {
      if (!(await currentSession())) return local;
      const remote = await pullMyAccounts();
      if (!remote?.length) return local;
      await setMyAccounts(remote);
      return remote;
    } catch (err) {
      console.error(err);
      return local;
    }
  }, []);

  // Restore cache on load: if records + identity exist, go straight to
  // dashboard. With an empty cache but a live cloud session (e.g. first visit
  // on a new device, or returning from the OAuth redirect), restore from the
  // cloud instead — that's the whole point of signing in.
  useEffect(() => {
    const restoreController = new AbortController();
    void (async () => {
      try {
        const [raw, accts, handle] = await Promise.all([allRecords(), getMyAccounts(), getDirHandle()]);
        if (handle) {
          setDirHandleState(handle);
          try {
            setFolderPermission(await handle.queryPermission({ mode: "read" }));
          } catch {
            setFolderPermission("unknown");
          }
        }
        // A copied or re-organized replay folder leaves the same game cached
        // under several file keys; collapse them once here so the cache doesn't
        // carry the duplicates forward (see lib/dedupe.ts).
        const cached = await pruneDuplicates(raw);
        if (cached.length > 0) {
          setRecords(cached);
          // kv was already read above; only reach for the cloud if it's empty.
          const known = accts.length > 0 ? accts : await accountsForSession();
          if (restoreController.signal.aborted) return;
          if (known.length > 0) {
            setAccountsState(known);
            setPhase("dashboard");
          } else {
            setPhase("identity");
          }
        } else if (cloudEnabled && (await currentSession())) {
          const gen = generation.current;
          let timedOut = false;
          setCloudRestoring(0);
          const timeout = window.setTimeout(() => {
            timedOut = true;
            restoreController.abort();
          }, 120_000);
          try {
            // A new origin has no IndexedDB cache at all, so fetch full rows
            // directly. Running the account query alongside it also avoids an
            // extra serial wait after a large library finishes.
            const [pulled, cloudAccountsResult] = await Promise.all([
              restoreCloudRecords((loaded) => {
                if (generation.current === gen) setCloudRestoring(loaded);
              }, restoreController.signal),
              pullMyAccounts(restoreController.signal),
            ]);
            const cloudAccounts = cloudAccountsResult ?? [];
            if (generation.current !== gen || pulled.length === 0) return;
            setRecords(pulled);
            if (cloudAccounts.length > 0) {
              setAccountsState(cloudAccounts);
              void setMyAccounts(cloudAccounts);
              setPhase("dashboard");
            } else {
              setPhase("identity");
            }
          } catch (err) {
            if (restoreController.signal.aborted && !timedOut) return;
            console.error(err);
            setPipelineError(
              timedOut
                ? "Cloud restore timed out. Reload to retry, or select your replay folder — your cloud data is unchanged."
                : "Couldn't restore your cloud stats. Reload to retry, or select your replay folder.",
            );
          } finally {
            window.clearTimeout(timeout);
            if (generation.current === gen) setCloudRestoring(null);
          }
        }
      } catch (err) {
        console.error(err);
        setPipelineError("Couldn't read the local replay cache — your browser may be blocking storage.");
      }
    })();
    return () => restoreController.abort();
    // accountsForSession is stable ([] deps), so this still runs once on mount.
  }, [accountsForSession]);

  const startPipeline = useCallback(
    async (discover: () => Promise<{ id: string; path: string; file: File }[]>) => {
      setPhase("parsing");
      setPipelineError(null);
      const gen = generation.current;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const files = await discover();
        if (files.length === 0) {
          if (generation.current === gen) setPhase("landing");
          return;
        }
        await runParsePipeline(
          files,
          (p, newRecords) => {
            if (generation.current !== gen) return;
            setProgress(p);
            appendRecords(newRecords);
          },
          controller.signal,
        );
        markScanned();
        if (generation.current !== gen) return;
        const all = await allRecords();
        setRecords(all);
        // A fresh folder pick on a signed-in device lands here with empty kv:
        // ask the cloud who they are before falling back to the prompt.
        const accts = await accountsForSession();
        if (generation.current !== gen) return; // reset while the cloud answered
        if (accts.length > 0) {
          setAccountsState(accts);
          setPhase("dashboard");
        } else {
          setPhase("identity");
        }
      } catch (err) {
        console.error(err);
        if (generation.current !== gen) return; // reset mid-run: nothing to report
        if (err instanceof RecordSaveError) {
          setPipelineError(err.message);
        } else if (!(err instanceof DOMException && err.name === "AbortError")) {
          // AbortError is the user cancelling the folder picker — not a failure.
          setPipelineError("Parsing failed to start. Reload the page and try again — this usually happens when the site updated while this tab was open.");
        }
        setPhase("landing");
      } finally {
        if (generation.current === gen) setProgress(null);
      }
    },
    [appendRecords, markScanned, accountsForSession],
  );

  /**
   * Incremental rescan of the remembered folder. Unlike startPipeline this leaves
   * the dashboard on screen — the cache dedups on path|size|mtime, so only replays
   * added since the last scan actually parse.
   */
  const syncFolder = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      if (scanBusy.current) return;
      scanBusy.current = true;
      lastFolderSyncAt.current = Date.now();
      setSyncing({ pass: "full", total: 0, done: 0, skippedCached: 0, errors: 0, deferred: 0 });
      setSyncSkipped(null);
      setPipelineError(null);
      const gen = generation.current;
      const controller = new AbortController();
      abortRef.current = controller;
      // Held on an object rather than a plain `let`: the pipeline reports the
      // final tally through the callback, and we need it after the await.
      const tally: { last: ParseProgress | null } = { last: null };
      try {
        const files = await discoverFromHandle(handle);
        await runParsePipeline(
          files,
          (p, newRecords) => {
            if (generation.current !== gen) return;
            tally.last = p;
            setSyncing(p);
            appendRecords(newRecords);
          },
          controller.signal,
        );
        markScanned();
        const done = tally.last;
        if (generation.current === gen) {
          setSyncSkipped(done && done.errors + done.deferred > 0 ? { errors: done.errors, deferred: done.deferred } : null);
          // Unlike startPipeline, a refresh builds its record state purely from
          // streamed callbacks, so a delivery lost to a mid-run abort or a dead
          // worker leaves games sitting in the cache that the dashboard never
          // shows until the next reload. Reconcile against storage once, and
          // only when this run actually parsed something — the auto-sync on
          // every page load normally finds nothing and shouldn't pay for a
          // full re-read plus the resolve+sort it invalidates.
          if (done && done.done > done.skippedCached) setRecords(await allRecords());
        }
      } catch (err) {
        console.error(err);
        if (generation.current !== gen) return;
        setPipelineError(
          err instanceof RecordSaveError
            ? err.message
            : "Refresh failed mid-scan. Reload the page and try again — this usually happens when the site updated while this tab was open.",
        );
      } finally {
        scanBusy.current = false;
        // Stamped again on the way out: the throttle window should run from
        // the end of a long parse, not from the moment it started.
        lastFolderSyncAt.current = Date.now();
        if (generation.current === gen) setSyncing(null);
      }
    },
    [appendRecords, markScanned],
  );

  // Warm the lazy view chunks once the dashboard is idle so the first click
  // on each tab renders instantly instead of showing the Suspense fallback.
  useEffect(() => {
    if (phase !== "dashboard") return;
    const warm = () => {
      void import("./components/Overview");
      void import("./components/Views");
      void import("./components/Teams");
      void import("./components/Insights");


      void import("./components/MetricsGuide");
      void import("./components/AccountsEditor");
      void import("./components/liquipedia/Liquipedia");
    };
    // Optional-chained: Safari didn't ship requestIdleCallback until late.
    const ric = window.requestIdleCallback?.bind(window);
    if (ric) {
      const id = ric(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(id);
  }, [phase]);

  // Pick up replays added since the last visit with no click at all — possible
  // only while the folder permission is still live (same browser session).
  useEffect(() => {
    if (phase !== "dashboard" || isDemo || !dirHandle || autoSyncDone.current) return;
    autoSyncDone.current = true;
    void (async () => {
      try {
        const perm = await dirHandle.queryPermission({ mode: "read" });
        setFolderPermission(perm);
        if (perm === "granted") await syncFolder(dirHandle);
      } catch (err) {
        // syncFolder handles its own failures; this is queryPermission dying.
        console.error(err);
        setPipelineError("Couldn't check access to the remembered replay folder — use Refresh to try again.");
      }
    })();
  }, [phase, isDemo, dirHandle, syncFolder]);

  // Leave the dashboard open, play a session, come back: the auto-sync above
  // already fired for this page load, so the folder was never re-walked and
  // the games just played silently never appeared. CloudSync re-pulls on
  // re-focus for exactly this reason; the folder needs the same. Both events
  // are listened for because a Dolphin window that only takes OS focus never
  // hides the tab, so visibilitychange alone misses the common setup. Cheap to
  // double up: they share one throttle. Only while the permission is still
  // live — re-requesting it needs a user gesture, which is Refresh's job.
  useEffect(() => {
    if (phase !== "dashboard" || isDemo || !dirHandle) return;
    const maybeSync = () => {
      if (document.visibilityState !== "visible") return;
      if (scanBusy.current || Date.now() - lastFolderSyncAt.current < 60_000) return;
      void (async () => {
        try {
          const perm = await dirHandle.queryPermission({ mode: "read" });
          setFolderPermission(perm);
          if (perm === "granted") await syncFolder(dirHandle);
        } catch (err) {
          // Silent on purpose: this runs unprompted, and the Refresh button
          // (now reading "Reconnect folder") is the visible recourse.
          console.error(err);
        }
      })();
    };
    document.addEventListener("visibilitychange", maybeSync);
    window.addEventListener("focus", maybeSync);
    return () => {
      document.removeEventListener("visibilitychange", maybeSync);
      window.removeEventListener("focus", maybeSync);
    };
  }, [phase, isDemo, dirHandle, syncFolder]);

  // After a browser restart the permission lapses; re-requesting it needs a user
  // gesture, which this click provides.
  const onRefresh = useCallback(() => {
    if (!dirHandle) return;
    void (async () => {
      try {
        let perm = await dirHandle.queryPermission({ mode: "read" });
        if (perm !== "granted") perm = await dirHandle.requestPermission({ mode: "read" });
        setFolderPermission(perm);
        if (perm === "granted") await syncFolder(dirHandle);
      } catch (err) {
        console.error(err);
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setPipelineError('Couldn\'t access the replay folder — re-pick it with "Change folder".');
        }
      }
    })();
  }, [dirHandle, syncFolder]);

  const onPickDirectory = useCallback(() => {
    void startPipeline(async () => {
      // startIn only applies the first time; afterwards the id remembers the last-picked folder.
      const dir = await window.showDirectoryPicker({ id: "slippi-replays", mode: "read", startIn: "documents" });
      setDirHandleState(dir);
      setFolderPermission("granted");
      await setDirHandle(dir);
      // This parse walks the whole tree itself; without this the auto-sync
      // effect would immediately re-walk it just to skip everything as cached.
      autoSyncDone.current = true;
      return discoverFromHandle(dir);
    });
  }, [startPipeline]);

  const onPickFiles = useCallback(
    (list: FileList) => {
      void startPipeline(async () => discoverFromFileList(list));
    },
    [startPipeline],
  );

  /**
   * Attach a folder to a dashboard that has none — a cloud restore on a new
   * device, or a "Change folder" that was never followed through with a pick.
   * The stats are all there and nothing looks broken, but no replay played
   * from that point on can ever reach the app.
   *
   * Deliberately not onPickDirectory: startPipeline flips to the parsing
   * screen and lands on "landing" if the picker throws, so cancelling the OS
   * dialog would throw the user off their own dashboard. syncFolder keeps them
   * on it and streams into the same progress button Refresh uses.
   */
  const onConnectFolder = useCallback(() => {
    if (!supportsFsAccess) {
      topbarPickRef.current?.click();
      return;
    }
    void (async () => {
      try {
        const dir = await window.showDirectoryPicker({ id: "slippi-replays", mode: "read", startIn: "documents" });
        setDirHandleState(dir);
        setFolderPermission("granted");
        await setDirHandle(dir);
        autoSyncDone.current = true;
        await syncFolder(dir);
      } catch (err) {
        // AbortError is the user closing the picker — not a failure.
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error(err);
        setPipelineError("Couldn't open that replay folder — try again, or use \"Change folder\" to start over.");
      }
    })();
  }, [supportsFsAccess, syncFolder]);

  const onDemo = useCallback(() => {
    setIsDemo(true);
    setRecords(generateDemoRecords());
    setAccountsState(DEMO_ACCOUNTS);
    setPhase("dashboard");
  }, []);

  const confirmIdentity = useCallback((accts: Account[]) => {
    setAccountsState(accts);
    void setMyAccounts(accts);
    setPhase("dashboard");
  }, []);

  /**
   * Identity is resolved at query time, so changing accounts costs a recompute
   * and nothing else — no re-parse, no cache clear. Filters are reset because
   * an accountCode (or an opponent) scoped to a removed account would leave the
   * dashboard empty with no visible cause.
   */
  const saveAccounts = useCallback((accts: Account[]) => {
    setAccountsState(accts);
    if (!isDemo) void setMyAccounts(accts);
    setFilters((f) => ({ ...DEFAULT_FILTERS, format: f.format, range: f.range }));
    closeOverlay("accounts");
  }, [closeOverlay, isDemo]);

  // Cloud pulls land in the Dexie cache before this fires; state just catches
  // up. `gen` is captured by the sync when it starts — a pull that raced a
  // reset is stale and must not resurrect records into the new session.
  const onCloudPulled = useCallback(
    (pulled: GameRecord[], gen: number) => {
      if (gen !== generation.current) return;
      appendRecords(pulled);
    },
    [appendRecords],
  );

  const reset = useCallback(() => {
    generation.current++; // invalidate in-flight scans and cloud syncs
    abortRef.current?.abort();
    abortRef.current = null;
    if (!isDemo) void clearAll(); // also drops the stored dirHandle
    // clearAll only reaches IndexedDB; the scan timestamp is localStorage.
    // Left behind, it makes the next session — a cloud restore, say — report a
    // "Scanned <time>" produced by a folder that session never had, which
    // reads as "checked, nothing new" when nothing was ever checked.
    localStorage.removeItem("ssbm-last-scanned");
    setLastScanned(null);
    setRecords([]);
    setAccountsState([]);
    setFilters(DEFAULT_FILTERS);
    setIsDemo(false);
    setDirHandleState(null);
    setFolderPermission("unknown");
    setProgress(null);
    setSyncing(null);
    autoSyncDone.current = false;
    setPhase("landing");
    selectTab("overview", true);
  }, [isDemo, selectTab]);

  const onCloudSignIn = useCallback(() => {
    void signInWithGoogle().catch((err) => {
      console.error(err);
      setPipelineError("Couldn't start Google sign-in — check your network and try again.");
    });
  }, []);

  // Records reach state from three racing sources — the cache restore, the
  // folder scan and a cloud pull — and a shared or copied replay folder means
  // the same game can arrive under different file keys. Collapse before
  // resolving so no aggregate ever counts a game twice.
  const deduped = useMemo(() => dedupeRecords(records), [records]);
  const myCodes = useMemo(() => new Set(accounts.map((a) => a.code)), [accounts]);
  const resolved = useMemo(() => resolveGames(deduped, myCodes), [deduped, myCodes]);
  const resolvedTeams = useMemo(() => resolveTeamGames(deduped, myCodes), [deduped, myCodes]);
  const filtered = useMemo(() => applyFilters(resolved, filters), [resolved, filters]);
  const filteredTeams = useMemo(() => applyTeamFilters(resolvedTeams, filters), [resolvedTeams, filters]);
  // Confirms a typed code actually occurs in the library — the identity step
  // and the editor both show it next to the code. Nothing is inferred from it.
  const gameCounts = useMemo(
    () => (phase === "identity" || showAccounts ? codeGameCounts(deduped) : new Map<string, number>()),
    [phase, showAccounts, deduped],
  );

  // Never strand the user in a teams view they have no games for.
  const hasTeamGames = resolvedTeams.length > 0;
  const showTeams = hasTeamGames && filters.format === "teams";
  const busy = phase === "parsing" || syncing !== null;
  const lastScanLabel = lastScanned
    ? new Date(lastScanned).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  // A dashboard can hold a full library with no folder behind it. Demo data
  // has none by design, and browsers without the File System Access API can
  // never keep one, so neither counts as a problem — but a Chromium session
  // that lost its handle will never see another replay, and saying "Scanned
  // <time>" at it is the difference between a two-second fix and a bug report.
  const needsFolder = !isDemo && !dirHandle && supportsFsAccess;

  return (
    <div className="shell">
      {(publicView || phase !== "landing") && (
        <div className="topbar">
          <div className="brand">
            <img src="/favicon.svg" alt="" aria-hidden="true" />
            <h1>SSBM Stats</h1>
            {isDemo && <span className="tag">demo data</span>}
          </div>
          {publicView && (
            <div className="identity">
              <button className="ghost" onClick={leavePublic}>
                {phase === "dashboard" ? "Back to my stats" : "Back"}
              </button>
            </div>
          )}
          {!publicView && phase === "dashboard" && (
            <div className="identity">
              <span className="identity-summary">
                <b>{accounts.map((a) => a.code).join(", ") || "—"}</b>
                {accounts.length > 1 && <span className="tag">{accounts.length} accounts</span>}
                <span>
                  · {(showTeams ? resolvedTeams.length : resolved.length).toLocaleString()}{" "}
                  {showTeams ? "2v2 games" : "games"}
                </span>
              </span>
              <span
                className={`app-state ${!online ? "offline" : needsFolder ? "warn" : ""}`}
                title={
                  !online
                    ? "Offline — local stats still work"
                    : needsFolder
                      ? "These stats came from the cache or the cloud. Connect your replay folder to pick up games played from now on."
                      : "Local features are ready"
                }
              >
                {!online
                  ? "Offline · local stats available"
                  : needsFolder
                    ? "No folder connected"
                    : lastScanLabel
                      ? `Scanned ${lastScanLabel}`
                      : "Local"}
              </span>
              {!isDemo && (
                <button
                  className={needsFolder ? "ghost attn" : "ghost"}
                  onClick={dirHandle ? onRefresh : onConnectFolder}
                  disabled={syncing !== null}
                >
                  {syncing
                    ? syncing.total === 0
                      ? "Scanning…"
                      : `${syncing.pass === "header" ? "Reading" : "Parsing"} ${syncing.done.toLocaleString()}/${syncing.total.toLocaleString()}`
                    : !dirHandle
                      ? supportsFsAccess ? "Connect replay folder" : "Add replays"
                      : folderPermission === "granted" ? "Refresh" : "Reconnect folder"}
                </button>
              )}
              <input
                ref={topbarPickRef}
                type="file"
                multiple
                style={{ display: "none" }}
                {...({ webkitdirectory: "" } as Record<string, string>)}
                onChange={(e) => e.target.files && onPickFiles(e.target.files)}
              />
              {!isDemo && !syncing && syncSkipped && (
                <span className="tag" title={skippedDetail(syncSkipped)}>
                  {(syncSkipped.errors + syncSkipped.deferred).toLocaleString()} pending
                </span>
              )}
              <CloudSync
                records={records}
                accounts={accounts}
                isDemo={isDemo}
                generation={generation.current}
                onPulled={onCloudPulled}
              />
              {installPrompt && (
                <button className="ghost" onClick={installApp}>Install app</button>
              )}
              <button className="ghost" onClick={() => openOverlay("accounts")}>
                My account
              </button>
              <button className="ghost" onClick={() => openOverlay("guide")}>
                Metrics guide
              </button>
              <button className="ghost" onClick={reset}>
                {isDemo ? "Exit demo" : "Change folder"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Under the topbar, not above the brand: the opt-in has to be seen to
          work, but it is not the masthead. Renders nothing in demo or a
          local-only build. */}
      {phase === "dashboard" && (
        <CommunityConsent isDemo={isDemo} variant="bar" onOpenCommunity={() => selectTab("community")} />
      )}

      {pipelineError && (
        <div className="error-note" role="alert">
          {pipelineError}
          <button className="ghost" style={{ marginLeft: 10 }} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}

      {publicView === "liquipedia" && (
        <ViewErrorBoundary>
          <Suspense fallback={<div className="empty-note">Loading…</div>}>
            <Liquipedia />
          </Suspense>
        </ViewErrorBoundary>
      )}

      {publicView === "community" && (
        <ViewErrorBoundary>
          <Suspense fallback={<div className="empty-note">Loading…</div>}>
            <Community
              games={resolved}
              isDemo={false}
              onOpenAccount={() => phase === "dashboard" ? openOverlay("accounts") : void signInWithGoogle()}
            />
          </Suspense>
        </ViewErrorBoundary>
      )}

      {!publicView && phase === "landing" && (
        <Landing
          onPickDirectory={onPickDirectory}
          onPickFiles={onPickFiles}
          onDemo={onDemo}
          onBrowseHistory={() => browsePublic("liquipedia")}
          onBrowseCommunity={() => browsePublic("community")}
          supportsFsAccess={supportsFsAccess}
          onCloudSignIn={cloudEnabled ? onCloudSignIn : null}
          cloudRestoring={cloudRestoring}
          online={online}
          onInstall={installPrompt ? installApp : null}
        />
      )}

      {!publicView && phase === "parsing" && progress && <ProgressBar p={progress} />}

      {!publicView && phase === "identity" && <IdentityPicker gameCounts={gameCounts} onConfirm={confirmIdentity} />}

      {!publicView && phase === "dashboard" && (
        <>
          <FilterBar
            filters={filters}
            setFilters={setFilters}
            games={resolved}
            teamGames={resolvedTeams}
            hasTeamGames={hasTeamGames}
            accounts={accounts}
          />
          {/* 2v2 has no 1v1 matchup matrix or single opponent, so it gets one
              consolidated view rather than the singles tab set. */}
          <ViewErrorBoundary>
          <Suspense fallback={<div className="empty-note">Loading…</div>}>
          {showTeams ? (
            <Teams games={filteredTeams} onSelectTeammate={(code) => setFilters({ ...filters, teammateCode: code })} />
          ) : (
        <>
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                tabIndex={tab === t.id ? 0 : -1}
                aria-selected={tab === t.id}
                className={tab === t.id ? "active" : ""}
                onKeyDown={moveTabFocus}
                onClick={() => selectTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <Overview
              games={filtered}
              allGames={resolved}
              teamGames={filteredTeams}
              filters={filters}
              accounts={accounts}
              onSelectMyCharacter={(id) => setFilters({ ...filters, myCharacter: id })}
              onSelectMode={(mode) => setFilters({ ...filters, gameType: mode })}
              onSelectAccount={(code) => setFilters({ ...filters, accountCode: code })}
            />
          )}
          {tab === "matchups" && (
            <Matchups
              games={filtered}
              onSelect={(my, opp) => {
                setFilters({ ...filters, myCharacter: my, oppCharacter: opp });
                selectTab("overview");
              }}
            />
          )}
          {tab === "stages" && (
            <Stages
              games={filtered}
              onSelect={(stageId, charId, side) => {
                setFilters({ ...filters, stageId, ...(side === "opp" ? { oppCharacter: charId } : { myCharacter: charId }) });
                selectTab("overview");
              }}
            />
          )}
          {tab === "opponents" && (
            <Opponents
              games={filtered}
              accounts={accounts}
              onSelect={(code) => {
                setFilters({ ...filters, opponentCode: code });
                selectTab("overview");
              }}
            />
          )}

          {tab === "execution" && <Execution games={filtered} />}
          {tab === "insights" && <Insights games={filtered} />}


          {tab === "community" && <Community games={resolved} isDemo={isDemo} onOpenAccount={() => openOverlay("accounts")} />}
          {tab === "liquipedia" && <Liquipedia />}
        </>
          )}
          </Suspense>
          </ViewErrorBoundary>
        </>
      )}

      {showGuide && (
        <Suspense fallback={null}>
          <MetricsGuide onClose={() => closeOverlay("guide")} />
        </Suspense>
      )}

      {showAccounts && (
        <Suspense fallback={null}>
          <AccountsEditor
            accounts={accounts}
            gameCounts={gameCounts}
            onSave={saveAccounts}
            onClose={() => closeOverlay("accounts")}
            isDemo={isDemo}
          />
        </Suspense>
      )}

      {showPrivacy && (
        <Suspense fallback={null}>
          <PrivacyPromise onClose={() => closeOverlay("privacy")} />
        </Suspense>
      )}

      {/* The build id is no longer printed, but it stays in the DOM as a data
          attribute so a deploy can still be verified — read it with
          document.querySelector(".site-footer").dataset.build, or grep the
          served bundle for the commit. */}
      <footer className="site-footer" data-build={__BUILD_ID__}>
        <span>Brought to you by Studio Pinball · © 2026</span>
        <a href="https://ssbmstats.com/">ssbmstats.com</a>
        <a href="mailto:info.studio.pinball@gmail.com">info.studio.pinball@gmail.com</a>
        <button className="footer-link" onClick={() => openOverlay("privacy")}>Privacy promise</button>
      </footer>

      {updateReady && (
        <div className="pwa-toast" role="status">
          <span><b>Update ready.</b> {busy ? "It will wait while local parsing finishes." : "Reload when you’re ready."}</span>
          {!busy && <button className="primary" onClick={() => window.location.reload()}>Reload</button>}
        </div>
      )}
      {!updateReady && offlineReady && (
        <div className="pwa-toast" role="status">
          <span><b>Ready offline.</b> SSBM Stats is available on this device.</span>
          <button className="ghost" aria-label="Dismiss" onClick={() => setOfflineReady(false)}>×</button>
        </div>
      )}
    </div>
  );
}
