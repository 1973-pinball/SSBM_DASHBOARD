import { useCallback, useEffect, useMemo, useState } from "react";
import type { Filters, GameRecord, ParseProgress } from "./lib/types";
import { DEFAULT_FILTERS } from "./lib/types";
import { discoverFromHandle, discoverFromFileList, runParsePipeline } from "./lib/pool";
import { allRecords, clearAll, getMyCodes, setMyCodes } from "./lib/db";
import { inferIdentity, resolveGames, applyFilters } from "./lib/stats";
import { generateDemoRecords, DEMO_CODE } from "./lib/demo";
import { Landing } from "./components/Landing";
import { ProgressBar, IdentityPicker } from "./components/ProgressAndIdentity";
import { FilterBar } from "./components/FilterBar";
import { Overview } from "./components/Overview";
import { Matchups, Stages, Opponents, Execution, GameLog } from "./components/Views";

type Phase = "landing" | "parsing" | "identity" | "dashboard";
type Tab = "overview" | "matchups" | "stages" | "opponents" | "execution" | "log";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "matchups", label: "Matchups" },
  { id: "stages", label: "Stages" },
  { id: "opponents", label: "Opponents" },
  { id: "execution", label: "Execution" },
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

  const supportsFsAccess = typeof window !== "undefined" && "showDirectoryPicker" in window;

  // Restore cache on load: if records + identity exist, go straight to dashboard.
  useEffect(() => {
    void (async () => {
      const [cached, codes] = await Promise.all([allRecords(), getMyCodes()]);
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
        setPhase("landing");
      } finally {
        setProgress(null);
      }
    },
    [],
  );

  const onPickDirectory = useCallback(() => {
    void startPipeline(async () => {
      const dir = await window.showDirectoryPicker();
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
    if (!isDemo) void clearAll();
    setRecords([]);
    setMyCodesState([]);
    setFilters(DEFAULT_FILTERS);
    setIsDemo(false);
    setPhase("landing");
  }, [isDemo]);

  const resolved = useMemo(() => resolveGames(records, new Set(myCodes)), [records, myCodes]);
  const filtered = useMemo(() => applyFilters(resolved, filters), [resolved, filters]);
  const candidates = useMemo(() => (phase === "identity" ? inferIdentity(records) : []), [phase, records]);

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
              <b>{myCodes.join(", ") || "—"}</b> · {resolved.length.toLocaleString()} games{" "}
              <button className="ghost" style={{ marginLeft: 10 }} onClick={reset}>
                {isDemo ? "Exit demo" : "Change folder"}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "landing" && (
        <Landing onPickDirectory={onPickDirectory} onPickFiles={onPickFiles} onDemo={onDemo} supportsFsAccess={supportsFsAccess} />
      )}

      {phase === "parsing" && progress && <ProgressBar p={progress} />}

      {phase === "identity" && <IdentityPicker candidates={candidates} onConfirm={confirmIdentity} />}

      {phase === "dashboard" && (
        <>
          <FilterBar filters={filters} setFilters={setFilters} games={resolved} />
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
          {tab === "stages" && <Stages games={filtered} />}
          {tab === "opponents" && (
            <Opponents
              games={filtered}
              onSelect={(code) => {
                setFilters({ ...filters, opponentCode: code });
                setTab("overview");
              }}
            />
          )}
          {tab === "execution" && <Execution games={filtered} />}
          {tab === "log" && <GameLog games={filtered} />}
        </>
      )}
    </div>
  );
}
