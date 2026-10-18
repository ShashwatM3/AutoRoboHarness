import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { savedApi, type GateInfo } from "./api.ts";
import BrainExplorer from "./BrainExplorer.tsx";
import ComparisonWorkspace from "./ComparisonWorkspace.tsx";
import { GateResult } from "./GatePanel.tsx";
import RunWorkspace from "./RunWorkspace.tsx";
import StageNav from "./StageNav.tsx";
import TrialExplorer from "./TrialExplorer.tsx";
import { buildHash, parseStage, type Stage } from "./routes.ts";
import type { RunSummary } from "./runTypes.ts";
import type { SavedComparison } from "./trialTypes.ts";

const ORIGINAL_GATE = "gate-mvcynupn";

function go(params: Record<string, string | number | null | undefined>) {
  location.hash = buildHash("results", params);
}

/** The original verified gate saved scores only. It has no replay, and none is fabricated. */
function GateWorkspace({
  gateId,
  stage,
  onStage,
}: {
  gateId: string;
  stage: Stage;
  onStage: (s: Stage) => void;
}) {
  const [gate, setGate] = useState<GateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    savedApi<GateInfo>(`/gate/${encodeURIComponent(gateId)}`)
      .then(setGate)
      .catch((e) => setError(String(e)));
  }, [gateId]);
  if (!gate)
    return (
      <div className="workspace-loading">
        {error ?? (
          <>
            <LoaderCircle className="spin" size={16} /> Loading gate…
          </>
        )}
      </div>
    );
  return (
    <div className="stage-workspace">
      <div className="workspace-title">
        <div>
          <div className="eyebrow">PREVIOUS RESULT · HELD-OUT GATE</div>
          <h2>
            <code>{gate.gate_id}</code> · v{gate.base} → v{gate.candidate}
          </h2>
          <p>
            Score records only. No trajectories were saved for this gate, so it
            has no replay.
          </p>
        </div>
      </div>
      <StageNav
        label="Gate stages"
        stage={stage}
        onStage={onStage}
        available={{ launch: true, work: true, review: true }}
        status={{
          launch: "Saved configuration",
          work: "No replay · score-only",
          review: "Scores and graph difference",
        }}
      />
      {stage === "launch" && (
        <section className="research-card saved-config">
          <h3>Saved configuration</h3>
          <dl className="config-grid">
            <div>
              <dt>Brains</dt>
              <dd>
                v{gate.base} (live) vs candidate v{gate.candidate}
              </dd>
            </div>
            <div>
              <dt>Held-out seeds</dt>
              <dd>{gate.seeds.join(", ")}</dd>
            </div>
            <div>
              <dt>Tasks</dt>
              <dd>
                {(gate.tasks ?? []).map((t) => `${t.type} ${t.slot}`).join(" · ") ||
                  "Not recorded"}
              </dd>
            </div>
            <div>
              <dt>Source review</dt>
              <dd>
                <a className="text-link" href={buildHash("results", { run: gate.shift_id, stage: "review" })}>
                  {gate.shift_id}
                </a>
                {gate.update_ids?.length ? ` · updates ${gate.update_ids.join(", ")}` : ""}
              </dd>
            </div>
            <div>
              <dt>Workers</dt>
              <dd>{gate.worker === "llm" ? "Lightning on Crusoe" : "Compiled policy"}</dd>
            </div>
            <div>
              <dt>Model responses</dt>
              <dd>
                {gate.llm.calls} · {gate.llm.replayed ?? 0} local replays
              </dd>
            </div>
          </dl>
        </section>
      )}
      {stage === "work" && (
        <section className="research-card empty-stage">
          <h3>No replay for this gate</h3>
          <p>
            This gate saved per-seed scores, not trajectories. Nothing is
            reconstructed. Fresh comparisons record their own trajectories under
            separate evaluation IDs.
          </p>
        </section>
      )}
      {stage === "review" && (
        <section className="gate-panel">
          <GateResult gate={gate} recorded />
        </section>
      )}
    </div>
  );
}

/** Previous results: a library of saved runs, each opened as a staged, read-only workspace. */
export default function ResultsWorkspace({
  params,
}: {
  params: URLSearchParams;
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [comparisons, setComparisons] = useState<SavedComparison[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void savedApi<{ runs: RunSummary[] }>("/runs")
      // Version 2 library only: runs found by the Version 3 adversary are not shown here.
      .then((r) => setRuns(r.runs.filter((run) => run.source?.kind !== "adversary")))
      .catch(async () => {
        // Older servers have no run library; the shift list is read-only too.
        try {
          const list = await savedApi<RunSummary[]>("/shifts");
          setRuns(
            list
              .filter((s) => s.source?.kind !== "adversary")
              .map((s) => ({ ...s, review_status: null, gate_ids: [], replay_available: !!s.trial_id }))
              .reverse(),
          );
        } catch (e) {
          setError(String(e));
        }
      });
    void savedApi<{ comparisons: SavedComparison[] }>("/comparisons")
      .then((c) => setComparisons(c.comparisons))
      .catch((e) => setError(String(e)));
  }, []);
  const stage = parseStage(params.get("stage"));
  const run = params.get("run"),
    comparison = params.get("comparison"),
    gate = params.get("gate"),
    trial = params.get("trial"),
    view = params.get("view");
  const keep = (s: Stage) => {
    const next = Object.fromEntries(params.entries());
    go({ ...next, stage: s });
  };
  let workspace;
  if (run)
    workspace = <RunWorkspace shiftId={run} stage={stage ?? "launch"} onStage={keep} />;
  else if (comparison)
    workspace = (
      <ComparisonWorkspace comparisonId={comparison} stage={stage ?? "review"} onStage={keep} />
    );
  else if (gate) workspace = <GateWorkspace gateId={gate} stage={stage ?? "review"} onStage={keep} />;
  else if (view === "recordings" || trial) workspace = <TrialExplorer initialTrial={trial} />;
  else if (view === "brains")
    workspace = (
      <div className="stage-workspace">
        <div className="workspace-title">
          <div>
            <div className="eyebrow">PREVIOUS RESULTS · BRAIN VERSIONS</div>
            <h2>Every brain, every change</h2>
          </div>
        </div>
        <BrainExplorer
          embedded
          initialLeft={Number(params.get("left")) || 4}
          initialRight={Number(params.get("right")) || 5}
        />
      </div>
    );
  else
    workspace = (
      <div className="stage-workspace results-overview">
        <div className="workspace-title">
          <div>
            <div className="eyebrow">PREVIOUS RESULTS</div>
            <h2>Pick a saved result to step through it.</h2>
            <p>
              Every saved run opens in the same three stages as a live trial:
              its saved configuration, the recorded robots at work, and its
              recorded review. Nothing here calls a model or starts a review.
            </p>
          </div>
        </div>
        <div className="overview-cards">
          <button onClick={() => go({ gate: ORIGINAL_GATE })}>
            <span>ORIGINAL VERIFIED GATE · SCORES ONLY</span>
            <strong>v4 6/10 → v5 9/10</strong>
            <small>{ORIGINAL_GATE} · 150 responses · no replay</small>
          </button>
          {comparisons
            .filter((c) => c.worker === "llm")
            .slice(0, 2)
            .map((c) => (
              <button key={c.comparison_id} onClick={() => go({ comparison: c.comparison_id })}>
                <span>RECORDED LIGHTNING COMPARISON</span>
                <strong>
                  {c.aggregates
                    .map((a) => `v${a.version} ${a.successes}/${a.expected_tasks}`)
                    .join(" → ")}
                </strong>
                <small>
                  {c.comparison_id} · {c.progress.pairs_done}/{c.progress.pairs_total} recordings ·{" "}
                  {c.llm.calls} responses
                </small>
              </button>
            ))}
          <button onClick={() => go({ view: "recordings" })}>
            <span>ALL RECORDINGS</span>
            <strong>Replay any saved trial</strong>
            <small>Training and held-out · zero model calls</small>
          </button>
          <button onClick={() => go({ view: "brains" })}>
            <span>BRAIN VERSIONS</span>
            <strong>Graphs and full differences</strong>
            <small>Pan, zoom, search and compare snapshots</small>
          </button>
        </div>
      </div>
    );
  const selected = (key: string, value: string) => params.get(key) === value;
  return (
    <main className="results-layout">
      <aside className="results-library" aria-label="Saved results library">
        {error && <p className="research-error">{error}</p>}
        <h3>Training runs</h3>
        {!runs && <p className="library-empty">Loading…</p>}
        {runs?.length === 0 && <p className="library-empty">No saved training runs.</p>}
        <ul>
          {runs?.map((r) => (
            <li key={r.shift_id}>
              <button
                className={selected("run", r.shift_id) ? "selected" : ""}
                onClick={() => go({ run: r.shift_id, stage: "launch" })}
              >
                <strong>{r.shift_id}</strong>
                <small>
                  v{r.brain_version} · seed {r.seed} · {r.scores.filter((s) => s.complete).length}/
                  {r.tasks.length} passed · {r.status}
                </small>
                <span className="library-tags">
                  <i>{r.replay_available ? "recorded" : "action log"}</i>
                  {r.review_status && <i>review {r.review_status}</i>}
                  {r.gate_ids.length > 0 && <i>{r.gate_ids.length} gate</i>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <h3>Matched comparisons</h3>
        <ul>
          {comparisons.map((c) => (
            <li key={c.comparison_id}>
              <button
                className={selected("comparison", c.comparison_id) ? "selected" : ""}
                onClick={() => go({ comparison: c.comparison_id, stage: "review" })}
              >
                <strong>{c.comparison_id}</strong>
                <small>
                  {c.aggregates.map((a) => `v${a.version} ${a.successes}/${a.expected_tasks}`).join(" vs ")} ·{" "}
                  {c.seeds.length} seeds · {c.worker === "llm" ? "Lightning" : "compiled"} · {c.status}
                </small>
              </button>
            </li>
          ))}
        </ul>
        <h3>Held-out gate</h3>
        <ul>
          <li>
            <button
              className={selected("gate", ORIGINAL_GATE) ? "selected" : ""}
              onClick={() => go({ gate: ORIGINAL_GATE })}
            >
              <strong>{ORIGINAL_GATE}</strong>
              <small>Original verified gate · v4 → v5 · scores only</small>
            </button>
          </li>
        </ul>
        <h3>Explore</h3>
        <ul>
          <li>
            <button className={view === "recordings" ? "selected" : ""} onClick={() => go({ view: "recordings" })}>
              <strong>All recordings</strong>
            </button>
          </li>
          <li>
            <button className={view === "brains" ? "selected" : ""} onClick={() => go({ view: "brains" })}>
              <strong>Brain versions</strong>
            </button>
          </li>
        </ul>
      </aside>
      <section className="results-main">{workspace}</section>
    </main>
  );
}
