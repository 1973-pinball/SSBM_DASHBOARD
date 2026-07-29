import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Filters, GameRecord, ParseProgress } from "./lib/types";
import { DEFAULT_FILTERS } from "./lib/types";
import { discoverFromHandle, discoverFromFileList, runParsePipeline } from "./lib/pool";
import { allRecords, clearAll, getMyCodes, setMyCodes, getDirHandle, setDirHandle } from "./lib/db";
import { inferIdentity, resolveGames, resolveTeamGames, applyFilters, applyTeamFilters } from "./lib/stats";
import { generateDemoRecords, DEMO_CODE } from "./lib/demo";
import { Landing } from "./components/Landing";
import { ProgressBar, IdentityPicker } from "./components/ProgressAndIdentity";
import { FilterBar } from "./components/FilterBar";

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
const Insights = lazy(() => import("./components/Insights").then((m) => ({ default: m.Insights })));
const Sessions = lazy(() => import("./components/Sessions").then((m) => ({ default: m.Sessions })));
const Records = lazy(() => import("./components/Records").then((m) => ({ default: m.Records })));

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
type Tab = "overview" | "matchups" | "stages" | "opponents" | "sessions" | "execution" | "insights" | "records" | "log";

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
];

export default function App() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [tab, setTab] = useState<Tab>("overview");
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [myCodes, setMyCodesState] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [isDemo, setIsDemo] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [dirHandle, setDirHandleState] = useState<FileSystemDirectoryHandle | null>(null);
  const [syncing, setSyncing] = useState<ParseProgress | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const autoSyncDone = useRef(false);

  const supportsFsAccess = typeof window !== "undefined" && "showDirectoryPicker" in window;

  // Restore cache on load: if records + identity exist, go straight to dashboard.
  useEffect(() => {
    void (async () => {
      const [cached, codes, handle] = await Promise.all([allRecords(), getMyCodes(), getDirHandle()]);
      if (handle) setDirHandleState(handle);
      if (cached.length > 0) {
        setRecords(cached);
        if (codes.length > 0) {
          setMyCodesState(codes);
          setPhase("dashboard");
        } else {
          setPhase("identity");
        }
      }
    })();
  }, []);

  const startPipeline = useCallback(
    async (discover: () => Promise<{ id: string; path: string; file: File }[]>) => {
      setPhase("parsing");
      setPipelineError(null);
      try {
        const files = await discover();
        if (files.length === 0) {
          setPhase("landing");
          return;
        }
        await runParsePipeline(files, (p, newRecords) => {
          setProgress(p);
          if (newRecords.length) setRecords((prev) => [...prev, ...newRecords]);
        });
        const all = await allRecords();
        setRecords(all);
        const codes = await getMyCodes();
        if (codes.length > 0) {
          setMyCodesState(codes);
          setPhase("dashboard");
        } else {
          setPhase("identity");
        }
      } catch (err) {
        console.error(err);
        // AbortError is the user cancelling the folder picker — not a failure.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setPipelineError("Parsing failed to start. Reload the page and try again — this usually happens when the site updated while this tab was open.");
        }
        setPhase("landing");
      } finally {
        setProgress(null);
      }
    },
    [],
  );

  /**
   * Incremental rescan of the remembered folder. Unlike startPipeline this leaves
   * the dashboard on screen — the cache dedups on path|size|mtime, so only replays
   * added since the last scan actually parse.
   */
  const syncFolder = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setSyncing({ total: 0, done: 0, skippedCached: 0, errors: 0 });
    setPipelineError(null);
    try {
      const files = await discoverFromHandle(handle);
      await runParsePipeline(files, (p, newRecords) => {
        setSyncing(p);
        if (newRecords.length) setRecords((prev) => [...prev, ...newRecords]);
      });
    } catch (err) {
      console.error(err);
      setPipelineError("Refresh failed mid-scan. Reload the page and try again — this usually happens when the site updated while this tab was open.");
    } finally {
      setSyncing(null);
    }
  }, []);

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
      const perm = await dirHandle.queryPermission({ mode: "read" });
      if (perm === "granted") await syncFolder(dirHandle);
    })();
  }, [phase, isDemo, dirHandle, syncFolder]);

  // After a browser restart the permission lapses; re-requesting it needs a user
  // gesture, which this click provides.
  const onRefresh = useCallback(() => {
    if (!dirHandle) return;
    void (async () => {
      let perm = await dirHandle.queryPermission({ mode: "read" });
      if (perm !== "granted") perm = await dirHandle.requestPermission({ mode: "read" });
      if (perm === "granted") await syncFolder(dirHandle);
    })();
  }, [dirHandle, syncFolder]);

  const onPickDirectory = useCallback(() => {
    void startPipeline(async () => {
      // startIn only applies the first time; afterwards the id remembers the last-picked folder.
      const dir = await window.showDirectoryPicker({ id: "slippi-replays", mode: "read", startIn: "documents" });
      setDirHandleState(dir);
      await setDirHandle(dir);
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
    setMyCodesState([DEMO_CODE]);
    setPhase("dashboard");
  }, []);

  const confirmIdentity = useCallback((codes: string[]) => {
    setMyCodesState(codes);
    void setMyCodes(codes);
    setPhase("dashboard");
  }, []);

  const reset = useCallback(() => {
    if (!isDemo) void clearAll(); // also drops the stored dirHandle
    setRecords([]);
    setMyCodesState([]);
    setFilters(DEFAULT_FILTERS);
    setIsDemo(false);
    setDirHandleState(null);
    autoSyncDone.current = false;
    setPhase("landing");
  }, [isDemo]);

  const resolved = useMemo(() => resolveGames(records, new Set(myCodes)), [records, myCodes]);
  const resolvedTeams = useMemo(() => resolveTeamGames(records, new Set(myCodes)), [records, myCodes]);
  const filtered = useMemo(() => applyFilters(resolved, filters), [resolved, filters]);
  const filteredTeams = useMemo(() => applyTeamFilters(resolvedTeams, filters), [resolvedTeams, filters]);
  const candidates = useMemo(() => (phase === "identity" ? inferIdentity(records) : []), [phase, records]);

  // Never strand the user in a teams view they have no games for.
  const hasTeamGames = resolvedTeams.length > 0;
  const showTeams = hasTeamGames && filters.format === "teams";

  return (
    <div className="shell">
      {phase !== "landing" && (
        <div className="topbar">
          <div className="brand">
            <h1>SSBM Dashboard</h1>
            {isDemo && <span className="tag">demo data</span>}
          </div>
          {phase === "dashboard" && (
            <div className="identity">
              <b>{myCodes.join(", ") || "—"}</b> ·{" "}
              {(showTeams ? resolvedTeams.length : resolved.length).toLocaleString()} {showTeams ? "2v2 games" : "games"}
              {!isDemo && dirHandle && (
                <button className="ghost" style={{ marginLeft: 10 }} onClick={onRefresh} disabled={syncing !== null}>
                  {syncing
                    ? syncing.total === 0
                      ? "Scanning…"
                      : `Parsing ${syncing.done.toLocaleString()}/${syncing.total.toLocaleString()}`
                    : "Refresh"}
                </button>
              )}
              <button className="ghost" style={{ marginLeft: 10 }} onClick={() => setShowGuide(true)}>
                Metrics guide
              </button>
              <button className="ghost" style={{ marginLeft: 10 }} onClick={reset}>
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

      {phase === "landing" && (
        <Landing onPickDirectory={onPickDirectory} onPickFiles={onPickFiles} onDemo={onDemo} supportsFsAccess={supportsFsAccess} />
      )}

      {phase === "parsing" && progress && <ProgressBar p={progress} />}

      {phase === "identity" && <IdentityPicker candidates={candidates} onConfirm={confirmIdentity} />}

      {phase === "dashboard" && (
        <>
          <FilterBar
            filters={filters}
            setFilters={setFilters}
            games={resolved}
            teamGames={resolvedTeams}
            hasTeamGames={hasTeamGames}
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
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
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
              onSelectMyCharacter={(id) => setFilters({ ...filters, myCharacter: id })}
              onSelectMode={(mode) => setFilters({ ...filters, gameType: mode })}
            />
          )}
          {tab === "matchups" && (
            <Matchups
              games={filtered}
              onSelect={(my, opp) => {
                setFilters({ ...filters, myCharacter: my, oppCharacter: opp });
                setTab("overview");
              }}
            />
          )}
          {tab === "stages" && (
            <Stages
              games={filtered}
              onSelect={(stageId, charId, side) => {
                setFilters({ ...filters, stageId, ...(side === "opp" ? { oppCharacter: charId } : { myCharacter: charId }) });
                setTab("overview");
              }}
            />
          )}
          {tab === "opponents" && (
            <Opponents
              games={filtered}
              onSelect={(code) => {
                setFilters({ ...filters, opponentCode: code });
                setTab("overview");
              }}
            />
          )}
          {tab === "sessions" && <Sessions games={filtered} />}
          {tab === "execution" && <Execution games={filtered} />}
          {tab === "insights" && <Insights games={filtered} />}
          {tab === "records" && <Records games={filtered} teamGames={filteredTeams} />}
          {tab === "log" && <GameLog games={filtered} />}
        </>
          )}
          </Suspense>
          </ViewErrorBoundary>
        </>
      )}

      {showGuide && (
        <Suspense fallback={null}>
          <MetricsGuide onClose={() => setShowGuide(false)} />
        </Suspense>
      )}
    </div>
  );
}
