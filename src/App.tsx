import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Account, Filters, GameRecord, ParseProgress } from "./lib/types";
import { DEFAULT_FILTERS } from "./lib/types";
import { discoverFromHandle, discoverFromFileList, runParsePipeline, RecordSaveError } from "./lib/pool";
import { allRecords, clearAll, getMyAccounts, setMyAccounts, getDirHandle, setDirHandle, pruneDuplicates } from "./lib/db";
import { codeGameCounts, resolveGames, resolveTeamGames, applyFilters, applyTeamFilters } from "./lib/stats";
import { dedupeRecords } from "./lib/dedupe";
import { generateDemoRecords, DEMO_ACCOUNTS } from "./lib/demo";
import { Landing } from "./components/Landing";
import { ProgressBar, IdentityPicker } from "./components/ProgressAndIdentity";
import { FilterBar } from "./components/FilterBar";
import { CloudSync } from "./components/CloudSync";
import { cloudEnabled, currentSession, signInWithGoogle } from "./lib/supabase";
import { syncRecords, pullMyAccounts } from "./lib/cloudSync";
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
const GameLog = lazy(() => import("./components/Views").then((m) => ({ default: m.GameLog })));
const Community = lazy(() => import("./components/Community").then((m) => ({ default: m.Community })));
const Insights = lazy(() => import("./components/Insights").then((m) => ({ default: m.Insights })));
const Sessions = lazy(() => import("./components/Sessions").then((m) => ({ default: m.Sessions })));
const Records = lazy(() => import("./components/Records").then((m) => ({ default: m.Records })));
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
type Tab = "overview" | "matchups" | "stages" | "opponents" | "sessions" | "execution" | "insights" | "records" | "log" | "community" | "liquipedia";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "matchups", label: "Matchups" },
  { id: "stages", label: "Stages" },
  { id: "opponents", label: "Opponents" },
  { id: "sessions", label: "Sessions" },
  { id: "execution", label: "Execution" },
  { id: "insights", label: "Insights" },
  { id: "records", label: "Records" },
  { id: "log", label: "Game log" },
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
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [cloudRestoring, setCloudRestoring] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [folderPermission, setFolderPermission] = useState<PermissionState | "unknown">("unknown");
  const [lastScanned, setLastScanned] = useState<string | null>(() => localStorage.getItem("ssbm-last-scanned"));
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const autoSyncDone = useRef(false);
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
  const appendRecords = useCallback((incoming: GameRecord[]) => {
    if (!incoming.length) return;
    setRecords((prev) => {
      const have = new Set(prev.map((r) => r.id));
      const fresh = incoming.filter((r) => !have.has(r.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  // Restore cache on load: if records + identity exist, go straight to
  // dashboard. With an empty cache but a live cloud session (e.g. first visit
  // on a new device, or returning from the OAuth redirect), restore from the
  // cloud instead — that's the whole point of signing in.
  useEffect(() => {
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
          if (accts.length > 0) {
            setAccountsState(accts);
            setPhase("dashboard");
          } else {
            setPhase("identity");
          }
        } else if (cloudEnabled && (await currentSession())) {
          const gen = generation.current;
          setCloudRestoring(true);
          try {
            // Local is empty, so this is a pure pull and the code set only
            // gates the push half — nothing to filter. Accounts aren't known
            // until pullMyAccounts below, which is why it can't be passed here.
            const { pulled } = await syncRecords([], new Set<string>());
            const cloudAccounts = (await pullMyAccounts()) ?? [];
            if (generation.current !== gen || pulled.length === 0) return;
            setRecords(pulled);
            if (cloudAccounts.length > 0) {
              setAccountsState(cloudAccounts);
              void setMyAccounts(cloudAccounts);
              setPhase("dashboard");
            } else {
              setPhase("identity");
            }
          } finally {
            setCloudRestoring(false);
          }
        }
      } catch (err) {
        console.error(err);
        setPipelineError("Couldn't read the local replay cache — your browser may be blocking storage.");
      }
    })();
  }, []);

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
        const accts = await getMyAccounts();
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
    [appendRecords, markScanned],
  );

  /**
   * Incremental rescan of the remembered folder. Unlike startPipeline this leaves
   * the dashboard on screen — the cache dedups on path|size|mtime, so only replays
   * added since the last scan actually parse.
   */
  const syncFolder = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      setSyncing({ total: 0, done: 0, skippedCached: 0, errors: 0 });
      setPipelineError(null);
      const gen = generation.current;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const files = await discoverFromHandle(handle);
        await runParsePipeline(
          files,
          (p, newRecords) => {
            if (generation.current !== gen) return;
            setSyncing(p);
            appendRecords(newRecords);
          },
          controller.signal,
        );
        markScanned();
      } catch (err) {
        console.error(err);
        if (generation.current !== gen) return;
        setPipelineError(
          err instanceof RecordSaveError
            ? err.message
            : "Refresh failed mid-scan. Reload the page and try again — this usually happens when the site updated while this tab was open.",
        );
      } finally {
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
      void import("./components/Sessions");
      void import("./components/Records");
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

  return (
    <div className="shell">
      {(publicView || phase !== "landing") && (
        <div className="topbar">
          <div className="brand">
            <h1>SSBM Dashboard</h1>
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
              <span className={`app-state ${online ? "" : "offline"}`} title={online ? "Local features are ready" : "Offline — local stats still work"}>
                {online ? (lastScanLabel ? `Scanned ${lastScanLabel}` : "Local") : "Offline · local stats available"}
              </span>
              {!isDemo && dirHandle && (
                <button className="ghost" onClick={onRefresh} disabled={syncing !== null}>
                  {syncing
                    ? syncing.total === 0
                      ? "Scanning…"
                      : `Parsing ${syncing.done.toLocaleString()}/${syncing.total.toLocaleString()}`
                    : folderPermission === "granted" ? "Refresh" : "Reconnect folder"}
                </button>
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
              onSelect={(code) => {
                setFilters({ ...filters, opponentCode: code });
                selectTab("overview");
              }}
            />
          )}
          {tab === "sessions" && <Sessions games={filtered} />}
          {tab === "execution" && <Execution games={filtered} />}
          {tab === "insights" && <Insights games={filtered} />}
          {tab === "records" && <Records games={filtered} teamGames={filteredTeams} />}
          {tab === "log" && <GameLog games={filtered} accounts={accounts} />}
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

      <footer className="site-footer">
        <span>Brought to you by Studio Pinball · © 2026</span>
        <a href="mailto:info.studio.pinball@gmail.com">info.studio.pinball@gmail.com</a>
        <button className="footer-link" onClick={() => openOverlay("privacy")}>Privacy promise</button>
        {/* Which deploy this tab is actually running. The service worker
            precaches the whole shell, so a browser can sit on an old build
            through several releases — compare this to the latest commit on
            main to know for certain. */}
        <span className="build-id" title="Build this tab is running">
          build {__BUILD_ID__}
        </span>
      </footer>

      {updateReady && (
        <div className="pwa-toast" role="status">
          <span><b>Update ready.</b> {busy ? "It will wait while local parsing finishes." : "Reload when you’re ready."}</span>
          {!busy && <button className="primary" onClick={() => window.location.reload()}>Reload</button>}
        </div>
      )}
      {!updateReady && offlineReady && (
        <div className="pwa-toast" role="status">
          <span><b>Ready offline.</b> The dashboard shell is installed on this device.</span>
          <button className="ghost" aria-label="Dismiss" onClick={() => setOfflineReady(false)}>×</button>
        </div>
      )}
    </div>
  );
}
