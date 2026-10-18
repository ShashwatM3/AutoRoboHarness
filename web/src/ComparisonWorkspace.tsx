import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, GitCompare, LoaderCircle, Play } from "lucide-react";
import { savedApi } from "./api.ts";
import BrainExplorer from "./BrainExplorer.tsx";
import SavedReplay from "./SavedReplay.tsx";
import StageNav from "./StageNav.tsx";
import { CRUSOE_LINKS, workerLabel } from "./providers.ts";
import {
  COMPARISON_PREFILL,
  loadRecordings,
  stepMoment,
  type ComparisonConfig,
} from "./recordings.ts";
import { buildHash, type Stage } from "./routes.ts";
import type { SavedComparison, SavedTrial } from "./trialTypes.ts";

type Pair = SavedComparison["per_seed"][number];
const finished = (status: string) =>
  status === "done" || status === "error" || status === "interrupted";

export function relaunchComparison(c: SavedComparison) {
  const config: ComparisonConfig = {
    versions: c.versions,
    seeds: c.seeds,
    tasks: c.tasks,
    max_speed_mps: c.environment.max_speed_mps,
  };
  sessionStorage.setItem(COMPARISON_PREFILL, JSON.stringify(config));
  location.hash = buildHash("live", { mode: "comparison" });
}

function SeedChips({
  comparison,
  seed,
  onSeed,
}: {
  comparison: SavedComparison;
  seed: number | null;
  onSeed: (seed: number) => void;
}) {
  return (
    <div className="seed-chips" role="list" aria-label="Seeds in this comparison">
      {comparison.seeds.map((s) => {
        const pair = comparison.per_seed?.find((p) => p.seed === s);
        const ready =
          pair &&
          pair.pairs.length === 2 &&
          pair.pairs.every((p) => p.trial_id && finished(p.status));
        return (
          <button
            key={s}
            role="listitem"
            className={seed === s ? "selected" : ""}
            disabled={!ready}
            onClick={() => onSeed(s)}
          >
            <strong>Seed {s}</strong>
            <span>
              {pair
                ? pair.pairs.map((p) => {
                    const passed =
                      p.task_scores.length > 0 &&
                      p.task_scores.every((t) => t.complete);
                    return (
                      <i
                        key={p.version}
                        className={
                          !finished(p.status)
                            ? "pending"
                            : passed
                              ? "passed"
                              : "failed"
                        }
                        title={`v${p.version}: ${p.status}${finished(p.status) ? (passed ? ", passed" : ", failed") : ""}`}
                      >
                        v{p.version}
                      </i>
                    );
                  })
                : "Not started"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Results({
  comparison,
  onFailure,
}: {
  comparison: SavedComparison;
  onFailure: (seed: number, version: number, time: number) => void;
}) {
  const [failing, setFailing] = useState<Record<string, SavedTrial>>({});
  const failedIds = useMemo(
    () =>
      (comparison.per_seed ?? []).flatMap((pair) =>
        pair.pairs.flatMap((p) =>
          p.trial_id &&
          finished(p.status) &&
          p.task_scores.some((t) => !t.complete || t.refused_actions > 0)
            ? [p.trial_id]
            : [],
        ),
      ),
    [comparison],
  );
  useEffect(() => {
    let active = true;
    Promise.all(
      failedIds
        .filter((id) => !failing[id])
        .map((id) => savedApi<SavedTrial>(`/trials/${encodeURIComponent(id)}`)),
    )
      .then((loaded) => {
        if (active && loaded.length)
          setFailing((all) => ({
            ...all,
            ...Object.fromEntries(loaded.map((t) => [t.trial_id, t])),
          }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [failedIds.join(",")]);
  const done = comparison.status === "done";
  return (
    <>
      <div className="comparison-scores">
        {comparison.versions.map((v) => {
          const s = comparison.aggregates?.find((a) => a.version === v) as
            | (SavedComparison["aggregates"][number] & {
                refused_per_evaluated_task?: number;
                steps_per_evaluated_task?: number;
              })
            | undefined;
          const expected = comparison.seeds.length * comparison.tasks.length;
          return (
            <div key={v}>
              <span>Brain v{v}</span>
              <strong>
                {s ? `${s.successes}/${s.expected_tasks}` : `0/${expected}`}
              </strong>
              <span>
                {s ? (s.success_rate * 100).toFixed(1) : "0"}% successful tasks
              </span>
              <small>
                {s
                  ? `${s.evaluated_tasks} evaluated · ${s.infeasible_tasks} infeasible${s.refused_per_evaluated_task != null ? ` · ${s.refused_per_evaluated_task} refused/task · ${s.steps_per_evaluated_task} steps/task` : ""}`
                  : "No tasks evaluated yet"}
              </small>
              <small>
                {done && s?.complete
                  ? "Complete comparison"
                  : "Partial results · pending tasks remain in the denominator"}
              </small>
            </div>
          );
        })}
      </div>
      <p className="results-note">
        The aggregate includes every requested task, including failures and
        unavailable tasks; choosing a replay never changes it. Different
        evaluation IDs are separate experiments. The original gate{" "}
        <code>gate-mvcynupn</code> remains its own score-only record.
      </p>
      <div className="version-table">
        <table className="per-seed-table">
          <thead>
            <tr>
              <th>Seed / task</th>
              {comparison.versions.map((v) => (
                <th key={v}>Brain v{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(comparison.per_seed ?? []).map((pair: Pair) => (
              <tr key={pair.seed}>
                <th>
                  Seed {pair.seed}
                  <small>
                    {pair.task_selection
                      .map((t) =>
                        t.actual
                          ? `${t.actual.type} ${t.actual.slot}${t.substituted ? " (equivalent slot)" : ""}`
                          : "Infeasible task · failed",
                      )
                      .join(" · ")}
                  </small>
                </th>
                {comparison.versions.map((v) => {
                  const p = pair.pairs.find((x) => x.version === v);
                  if (!p) return <td key={v}>Not started</td>;
                  const trial = p.trial_id ? failing[p.trial_id] : undefined;
                  return (
                    <td key={v}>
                      {p.task_scores.map((t) => (
                        <span
                          key={t.task_id}
                          className={t.complete ? "diff-added" : "diff-removed"}
                        >
                          {t.complete ? "Passed" : "Failed"} ·{" "}
                          {t.refused_actions} refused · {t.steps} steps
                        </span>
                      ))}
                      {!finished(p.status) && <small>{p.status}</small>}
                      {trial?.trajectory
                        .filter((s) => !s.ok)
                        .map((s) => (
                          <button
                            key={`${s.robot}-${s.step}`}
                            className="text-button step-link"
                            onClick={() => onFailure(pair.seed, v, stepMoment(s))}
                          >
                            <Play size={9} fill="currentColor" /> {s.robot} step{" "}
                            {s.step}: {s.reason}
                          </button>
                        ))}
                      {trial &&
                        trial.scores.some(
                          (s) => !s.complete && s.refused_actions === 0,
                        ) && (
                          <small>
                            Not delivered: item ended at{" "}
                            {trial.scores.map((s) => s.item_location).join(", ")}
                          </small>
                        )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="results-note">
        Held-out recordings are never sent to the supervisor, so comparisons
        have no supervisor review.
      </p>
    </>
  );
}

/** One matched comparison through the three stages. Reads saved records only; live mode polls while running. */
export default function ComparisonWorkspace({
  comparisonId,
  stage,
  onStage,
  live = false,
  launchPanel,
}: {
  comparisonId: string;
  stage: Stage;
  onStage: (stage: Stage) => void;
  live?: boolean;
  launchPanel?: ReactNode;
}) {
  const [comparison, setComparison] = useState<SavedComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<number | null>(null);
  const [recordings, setRecordings] = useState<SavedTrial[]>([]);
  const [loadingPair, setLoadingPair] = useState(false);
  const [seek, setSeek] = useState<{ time: number; key: number } | null>(null);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  const [explore, setExplore] = useState(false);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    setComparison(null);
    setSeed(null);
    setRecordings([]);
    const load = async () => {
      try {
        const c = await savedApi<SavedComparison>(
          `/comparisons/${encodeURIComponent(comparisonId)}`,
        );
        if (!active) return;
        setComparison(c);
        setError(null);
        if (c.status === "running") timer = setTimeout(load, 3500);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [comparisonId]);
  useEffect(() => {
    if (!comparison || seed != null) return;
    const first = comparison.per_seed?.find(
      (p) =>
        p.pairs.length === 2 &&
        p.pairs.every((x) => x.trial_id && finished(x.status)),
    );
    if (first) setSeed(first.seed);
  }, [comparison, seed]);
  useEffect(() => {
    if (seed == null || !comparison) return;
    const pair = comparison.per_seed.find((p) => p.seed === seed);
    const ids = pair?.pairs.flatMap((p) => (p.trial_id ? [p.trial_id] : []));
    if (!ids || ids.length !== 2) return;
    let active = true;
    setLoadingPair(true);
    loadRecordings(ids)
      .then((loaded) => {
        if (!active) return;
        setRecordings(loaded);
        setError(null);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => active && setLoadingPair(false));
    return () => {
      active = false;
    };
  }, [seed, comparison?.comparison_id, comparison?.progress.pairs_done]);
  useEffect(() => {
    if (pendingSeek == null || loadingPair || recordings[0]?.seed !== seed)
      return;
    setSeek({ time: pendingSeek, key: Date.now() });
    setPendingSeek(null);
  }, [pendingSeek, loadingPair, recordings, seed]);
  if (!comparison)
    return (
      <div className="workspace-loading">
        {error ? (
          <p role="alert" className="research-error">
            {error}
          </p>
        ) : (
          <>
            <LoaderCircle className="spin" size={16} /> Loading comparison…
          </>
        )}
      </div>
    );
  const anyPair = comparison.per_seed?.some((p) =>
    p.pairs.some((x) => x.trial_id && finished(x.status)),
  );
  const ended = finished(comparison.status);
  return (
    <div className="stage-workspace">
      <div className="workspace-title">
        <div>
          <div className="eyebrow">
            {live ? "LIVE TRIAL" : "PREVIOUS RESULT"} · MATCHED COMPARISON
          </div>
          <h2>
            v{comparison.versions[0]} vs v{comparison.versions[1]} ·{" "}
            <code>{comparison.comparison_id}</code>
          </h2>
          <p>
            {comparison.status} · {comparison.progress.pairs_done}/
            {comparison.progress.pairs_total} world runs ·{" "}
            {comparison.worker === "llm" ? "Lightning" : "Compiled policy"} ·{" "}
            {comparison.llm.calls} model responses ·{" "}
            {comparison.llm.replayed ?? 0} local response replays
          </p>
        </div>
      </div>
      <StageNav
        label="Comparison stages"
        stage={stage}
        onStage={onStage}
        available={{ launch: true, work: !!anyPair, review: true }}
        status={{
          launch: live ? "Configure a new run" : "Saved configuration",
          work: anyPair ? "Replay matched recordings" : "Waiting for a finished pair",
          review: ended ? "Aggregate results" : "Partial results so far",
        }}
      />
      {error && (
        <p role="alert" className="research-error">
          {error}
        </p>
      )}
      {comparison.error && (
        <p role="alert" className="research-error">
          {comparison.error}
        </p>
      )}
      {stage === "launch" &&
        (launchPanel ?? (
          <section className="research-card saved-config">
            <h3>Saved configuration</h3>
            <dl className="config-grid">
              <div>
                <dt>Brains</dt>
                <dd>
                  v{comparison.versions[0]} and v{comparison.versions[1]}
                </dd>
              </div>
              <div>
                <dt>Seeds</dt>
                <dd>{comparison.seeds.join(", ")}</dd>
              </div>
              <div>
                <dt>Requested tasks</dt>
                <dd>
                  {comparison.tasks
                    .map((t, i) => `R0${i + 1} ${t.type} ${t.slot}`)
                    .join(" · ")}
                </dd>
              </div>
              <div>
                <dt>Robot workers</dt>
                <dd>{workerLabel(comparison.worker)}</dd>
              </div>
              <div>
                <dt>Maximum speed</dt>
                <dd>{comparison.environment.max_speed_mps} m/s</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{comparison.started_at}</dd>
              </div>
              <div>
                <dt>Model usage</dt>
                <dd>
                  {comparison.llm.calls} responses ·{" "}
                  {comparison.llm.prompt_tokens.toLocaleString()} prompt /{" "}
                  {comparison.llm.completion_tokens.toLocaleString()} completion
                  tokens · {comparison.llm.replayed ?? 0} local replays
                </dd>
              </div>
              <div>
                <dt>Provider records</dt>
                <dd>
                  <a
                    className="text-link"
                    href={CRUSOE_LINKS.metrics}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Crusoe inference metrics <ExternalLink size={11} />
                  </a>
                  <small>
                    Project-wide, per model. There is no per-run console page.
                  </small>
                </dd>
              </div>
            </dl>
            <div className="config-actions">
              <button
                className="outline-tag"
                onClick={() => relaunchComparison(comparison)}
              >
                Run this configuration again in Live trial
              </button>
              <button className="text-button" onClick={() => setExplore(!explore)}>
                <GitCompare size={13} />{" "}
                {explore ? "Hide" : "Explore"} the v{comparison.versions[0]} → v
                {comparison.versions[1]} graphs
              </button>
            </div>
            {explore && (
              <BrainExplorer
                embedded
                initialLeft={comparison.versions[0]}
                initialRight={comparison.versions[1]}
              />
            )}
          </section>
        ))}
      {stage === "work" && (
        <>
          <SeedChips comparison={comparison} seed={seed} onSeed={setSeed} />
          {loadingPair && (
            <p className="workspace-loading">
              <LoaderCircle className="spin" size={14} /> Loading recordings…
            </p>
          )}
          {recordings.length === 2 && (
            <SavedReplay
              trials={recordings}
              seek={seek}
              title={`Replay saved trials · seed ${recordings[0].seed} · synchronized`}
            />
          )}
          {!anyPair && (
            <p className="workspace-loading">
              No finished pair yet. Recordings appear here as each seed
              completes.
            </p>
          )}
        </>
      )}
      {stage === "review" && (
        <section className="research-card">
          <h3>Results{ended ? "" : " so far"}</h3>
          <Results
            comparison={comparison}
            onFailure={(s, _v, time) => {
              setSeed(s);
              setPendingSeek(time);
              onStage("work");
            }}
          />
          <details className="graph-drilldown">
            <summary>
              <GitCompare size={13} /> Full graph difference · v
              {comparison.versions[0]} → v{comparison.versions[1]}
            </summary>
            <BrainExplorer
              embedded
              initialLeft={comparison.versions[0]}
              initialRight={comparison.versions[1]}
            />
          </details>
        </section>
      )}
    </div>
  );
}
