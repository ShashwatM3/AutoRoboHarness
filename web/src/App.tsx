import { useEffect, useState } from "react";
import { Cuboid } from "lucide-react";
import { savedApi } from "./api.ts";
import type { VersionIndex } from "./BrainExplorer.tsx";
import ComparisonLauncher from "./ComparisonLauncher.tsx";
import ComparisonWorkspace from "./ComparisonWorkspace.tsx";
import Development from "./Development.tsx";
import { PreviewLab } from "./PreviewLab.tsx";
import ResultsWorkspace from "./ResultsWorkspace.tsx";
import ShiftLab from "./ShiftLab.tsx";
import {
  COMPARISON_PREFILL,
  readPrefill,
  type ComparisonConfig,
} from "./recordings.ts";
import {
  buildHash,
  parseHash,
  parseStage,
  type PrimaryTab,
  type Route,
  type Stage,
} from "./routes.ts";

const TABS: { id: PrimaryTab; label: string }[] = [
  { id: "live", label: "Live trial" },
  { id: "results", label: "Previous results" },
  { id: "development", label: "Development" },
];
const LIVE_COMPARISON = "autorobo-live-comparison";

/** Live matched comparison: launch, watch recordings arrive, then read the aggregate. */
function LiveComparison() {
  const [prefill] = useState(() =>
    readPrefill<ComparisonConfig>(COMPARISON_PREFILL),
  );
  const [versions, setVersions] = useState<VersionIndex | null>(null);
  const [active, setActive] = useState<string | null>(() =>
    prefill ? null : localStorage.getItem(LIVE_COMPARISON),
  );
  const [stage, setStage] = useState<Stage>(active ? "work" : "launch");
  useEffect(() => {
    void savedApi<VersionIndex>("/brain/versions")
      .then(setVersions)
      .catch(() => {});
  }, []);
  const launcher = (
    <ComparisonLauncher
      versions={versions}
      prefill={prefill}
      onLaunched={(id) => {
        localStorage.setItem(LIVE_COMPARISON, id);
        setActive(id);
        setStage("work");
      }}
    />
  );
  if (!active) return <div className="live-comparison">{launcher}</div>;
  return (
    <div className="live-comparison">
      <ComparisonWorkspace
        comparisonId={active}
        stage={stage}
        onStage={setStage}
        live
        launchPanel={
          <>
            {launcher}
            <p className="results-note">
              The comparison above stays saved under{" "}
              <a
                className="text-link"
                href={buildHash("results", { comparison: active })}
              >
                Previous results
              </a>
              .
            </p>
          </>
        }
      />
    </div>
  );
}

function LiveTrial({ route }: { route: Route }) {
  const mode = route.params.get("mode") ?? "shift";
  const setMode = (m: string) => {
    location.hash = buildHash("live", m === "shift" ? {} : { mode: m });
  };
  return (
    <main className="live-trial">
      <div className="live-modes" role="tablist" aria-label="Live trial mode">
        {[
          ["shift", "Training shift"],
          ["comparison", "Matched comparison"],
          ["preview", "Motion preview · no model calls"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            className={mode === id ? "selected" : ""}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "comparison" ? (
        <LiveComparison />
      ) : mode === "preview" ? (
        <PreviewLab />
      ) : (
        <ShiftLab initialStage={parseStage(route.params.get("stage"))} />
      )}
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [live, setLive] = useState<number | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let tab = route.tab;
    const change = () => {
      const next = parseHash(location.hash);
      if (next.tab !== tab) window.scrollTo({ top: 0 });
      tab = next.tab;
      setRoute(next);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const check = () =>
      savedApi<{ live_brain: number }>("/health")
        .then((h) => {
          setOnline(true);
          setLive(h.live_brain);
        })
        .catch(() => setOnline(false));
    void check();
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="dash-shell">
      <header className="dash-header">
        <a className="wordmark" href="#live" aria-label="AutoRoboHarness">
          <Cuboid size={20} strokeWidth={1.7} /> auto<span>robo</span>
          <small>HARNESS</small>
        </a>
        <nav className="primary-tabs" aria-label="Primary">
          {TABS.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className={route.tab === t.id ? "selected" : ""}
              aria-current={route.tab === t.id ? "page" : undefined}
            >
              {t.label}
            </a>
          ))}
        </nav>
        <span className={`connection-label ${online === false ? "offline" : ""}`}>
          <span className="status-dot" />
          {online === null
            ? "CONNECTING"
            : online
              ? `SERVER · LIVE BRAIN v${live}`
              : "SERVER OFFLINE"}
          <em>VERSION 2</em>
        </span>
      </header>
      {route.tab === "results" ? (
        <ResultsWorkspace params={route.params} />
      ) : route.tab === "development" ? (
        <Development />
      ) : (
        <LiveTrial route={route} />
      )}
    </div>
  );
}
