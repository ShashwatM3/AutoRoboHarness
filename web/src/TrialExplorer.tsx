import { useEffect, useState } from "react";
import { api, type GateInfo, type TaskSpec } from "./api.ts";
import type { VersionIndex } from "./BrainExplorer.tsx";
import type { SavedComparison, SavedTrial } from "./trialTypes.ts";
import SavedReplay from "./SavedReplay.tsx";

export default function TrialExplorer() {
  const [versions, setVersions] = useState<VersionIndex | null>(null);
  const [trials, setTrials] = useState<SavedTrial[]>([]),
    [comparisons, setComparisons] = useState<SavedComparison[]>([]);
  const [original, setOriginal] = useState<GateInfo | null>(null);
  const [left, setLeft] = useState(4),
    [right, setRight] = useState(5);
  const [tasks, setTasks] = useState<TaskSpec[]>([
    { type: "PICK", slot: "A-1-3-1" },
  ]);
  const [seeds, setSeeds] = useState("101,102,103,104,105,106,107,108,109,110");
  const [maxSpeed, setMaxSpeed] = useState(0.8);
  const [selected, setSelected] = useState<string | null>(() =>
    localStorage.getItem("autorobo-saved-comparison"),
  );
  const [comparison, setComparison] = useState<SavedComparison | null>(null);
  const [recordings, setRecordings] = useState<SavedTrial[]>([]);
  const [loading, setLoading] = useState(false),
    [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brainFilter, setBrainFilter] = useState("all"),
    [partition, setPartition] = useState("all");
  const refresh = async () => {
    const [t, c] = await Promise.all([
      api<{ trials: SavedTrial[] }>("/trials"),
      api<{ comparisons: SavedComparison[] }>("/comparisons"),
    ]);
    setTrials(t.trials);
    setComparisons(c.comparisons);
  };
  useEffect(() => {
    void api<VersionIndex>("/brain/versions")
      .then(setVersions)
      .catch((e) => setError(String(e)));
    void api<GateInfo>("/gate/gate-mvcynupn")
      .then(setOriginal)
      .catch(() => {});
    void refresh().catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (!selected) {
      setComparison(null);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const c = await api<SavedComparison>(
          `/comparisons/${encodeURIComponent(selected)}`,
        );
        if (active) setComparison(c);
      } catch (e) {
        if (active) setError(String(e));
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
      void refresh().catch(() => {});
    }, 3500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selected]);
  const openComparison = (id: string) => {
    setSelected(id);
    localStorage.setItem("autorobo-saved-comparison", id);
  };
  const replay = async (ids: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await Promise.all(
        ids.map((id) => api<SavedTrial>(`/trials/${encodeURIComponent(id)}`)),
      );
      if (loaded.some((t) => !t.initial || !Array.isArray(t.trajectory)))
        throw new Error(
          "This legacy record has no complete recorded scene. No replay is available.",
        );
      setRecordings(loaded);
      localStorage.setItem("autorobo-saved-replay", JSON.stringify(ids));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    try {
      const ids = JSON.parse(
        localStorage.getItem("autorobo-saved-replay") ?? "[]",
      );
      if (
        Array.isArray(ids) &&
        ids.length > 0 &&
        ids.length <= 2 &&
        ids.every((id) => typeof id === "string")
      )
        void replay(ids);
    } catch {
      /* Invalid local selection does not launch a run. */
    }
  }, []);
  const launch = async () => {
    setLaunching(true);
    setError(null);
    try {
      const list = seeds.split(",").map((s) => Number(s.trim()));
      if (
        !list.length ||
        list.some((n) => !Number.isInteger(n) || n < 101 || n > 110) ||
        new Set(list).size !== list.length
      )
        throw new Error(
          "Choose distinct held-out seeds from 101 to 110, separated by commas.",
        );
      if (left === right)
        throw new Error("Choose two different brain versions.");
      const c = await api<{ comparison_id: string }>("/comparisons", {
        method: "POST",
        body: JSON.stringify({
          versions: [left, right],
          seeds: list,
          tasks,
          worker: "llm",
          environment: { max_speed_mps: maxSpeed },
        }),
      });
      openComparison(c.comparison_id);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
  };
  const picker = (n: number, change: (n: number) => void, label: string) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={n}
        onChange={(e) => change(Number(e.target.value))}
      >
        {versions?.versions.map((v) => (
          <option key={v.v} value={v.v}>
            v{v.v}
            {versions.live === v.v ? " · live" : ""}
          </option>
        ))}
      </select>
    </label>
  );
  const filtered = trials.filter(
    (t) =>
      (brainFilter === "all" || t.brain_version === Number(brainFilter)) &&
      (partition === "all" || t.partition === partition),
  );
  return (
    <main className="research-main">
      <div className="eyebrow">V2 / RECORDED EXPERIMENTS</div>
      <h1>
        See what changed<span>.</span>
      </h1>
      <p className="research-intro">
        Run a controlled comparison or replay a saved trial. Replays read
        recordings and never call a model.
      </p>
      {error && (
        <p role="alert" className="research-error">
          {error}
        </p>
      )}
      <section className="research-card original-evaluation">
        <div>
          <div className="eyebrow">
            ORIGINAL VERIFIED EVALUATION · SCORE RECORDS ONLY
          </div>
          <h2>
            v4 → v5:{" "}
            {original?.base_score
              ? `${original.base_score.complete}/${original.base_score.tasks} → ${original.candidate_score?.complete}/${original.candidate_score?.tasks}`
              : "6/10 → 9/10"}{" "}
            successful tasks
          </h2>
          <p>
            60% → 90% · evaluation <code>gate-mvcynupn</code> · 10 held-out
            tasks per brain, Lightning.
          </p>
          <p>
            No full trajectories were saved for this original gate.{" "}
            <strong>No replay available.</strong>
          </p>
        </div>
        <span className="original-score">
          60% <span>→</span> 90%
        </span>
      </section>
      <section className="research-card">
        <h2>Run new trial comparison</h2>
        <p>
          Both brains receive identical seeds, actual task specifications, robot
          counts, shoppers and environment settings. These fresh results are
          separate from the original evaluation. Neither brain is promoted or
          changed.
        </p>
        <div className="explorer-controls">
          {picker(left, setLeft, "First brain")}
          {picker(right, setRight, "Second brain")}
          <label>
            Robots
            <select
              aria-label="Comparison robot count"
              value={tasks.length}
              onChange={(e) =>
                setTasks((ts) =>
                  Array.from(
                    { length: Number(e.target.value) },
                    (_, i) =>
                      ts[i] ?? {
                        type: "PICK",
                        slot: ["A-1-3-1", "A-2-1-1", "B-1-1-1", "B-2-1-2"][i],
                      },
                  ),
                )
              }
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            Maximum speed (m/s)
            <input
              type="number"
              min="0.1"
              max="0.8"
              step="0.1"
              value={maxSpeed}
              onChange={(e) => setMaxSpeed(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="comparison-task-forms">
          {tasks.map((t, i) => (
            <div className="explorer-controls" key={i}>
              <strong>Robot {i + 1}</strong>
              <label>
                Task
                <select
                  aria-label={`Comparison robot ${i + 1} task`}
                  value={t.type}
                  onChange={(e) =>
                    setTasks((ts) =>
                      ts.map((r, j) =>
                        j === i
                          ? { ...r, type: e.target.value as TaskSpec["type"] }
                          : r,
                      ),
                    )
                  }
                >
                  <option>PICK</option>
                  <option>RESTOCK</option>
                </select>
              </label>
              <label>
                Shelf slot
                <input
                  aria-label={`Comparison robot ${i + 1} slot`}
                  value={t.slot}
                  onChange={(e) =>
                    setTasks((ts) =>
                      ts.map((r, j) =>
                        j === i ? { ...r, slot: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <div className="explorer-controls">
          <label className="seeds-input">
            Held-out seeds
            <input
              aria-label="Comparison seeds"
              value={seeds}
              onChange={(e) => setSeeds(e.target.value)}
            />
          </label>
          <button
            className="play-button"
            disabled={
              launching || !versions || comparison?.status === "running"
            }
            onClick={() => void launch()}
          >
            {launching ? "Starting…" : "Run new comparison · Crusoe"}
          </button>
        </div>
        <small>
          New runs make model calls and use the shared quota. A task unavailable
          at the requested slot may use a recorded equivalent slot, matched for
          both brains. Success requires delivery with zero refused actions.
        </small>
      </section>
      <section className="research-card">
        <h2>Fresh comparison results</h2>
        <label>
          Saved comparison
          <select
            aria-label="Saved comparison"
            value={selected ?? ""}
            onChange={(e) => openComparison(e.target.value)}
          >
            <option value="">Choose a comparison</option>
            {comparisons.map((c) => (
              <option key={c.comparison_id} value={c.comparison_id}>
                {c.comparison_id} ·{" "}
                {c.versions.map((v) => `v${v}`).join(" vs ")} · {c.status} ·{" "}
                {c.worker}
              </option>
            ))}
          </select>
        </label>
        {comparison ? (
          <>
            <p>
              <code>{comparison.comparison_id}</code> · {comparison.status} ·{" "}
              {comparison.progress.pairs_done}/{comparison.progress.pairs_total}{" "}
              world runs ·{" "}
              {comparison.worker === "llm" ? "Lightning" : "Compiled policy"}
            </p>
            {comparison.error && <p role="alert">{comparison.error}</p>}
            <div className="comparison-scores">
              {comparison.versions.map((v) => {
                const s = comparison.aggregates?.find((s) => s.version === v);
                const expected =
                  comparison.seeds.length * comparison.tasks.length;
                return (
                  <div key={v}>
                    <span>Brain v{v}</span>
                    <strong>
                      {s
                        ? `${s.successes}/${s.expected_tasks}`
                        : `0/${expected}`}
                    </strong>
                    <span>
                      {s ? (s.success_rate * 100).toFixed(1) : "0"}% successful
                      tasks
                    </span>
                    <small>
                      {comparison.status === "done"
                        ? "Complete comparison"
                        : "Partial results · pending tasks remain in denominator"}
                    </small>
                  </div>
                );
              })}
            </div>
            <p>
              Aggregate includes every requested task, including failures.
              Choosing a replay below does not change these totals. Different
              evaluation IDs are separate experiments.
            </p>
            <div className="matched-trials">
              {comparison.per_seed?.map((pair) => {
                const ids = pair.pairs.flatMap((p) =>
                  p.trial_id ? [p.trial_id] : [],
                );
                return (
                  <div key={pair.seed}>
                    <span>
                      <strong>Seed {pair.seed}</strong>
                      <small>
                        {pair.task_selection
                          .map((t) =>
                            t.actual
                              ? `${t.actual.type} ${t.actual.slot}`
                              : "Infeasible task · failed",
                          )
                          .join(" · ")}
                      </small>
                      <small>
                        {pair.pairs
                          .map((p) => `v${p.version}: ${p.status}`)
                          .join(" · ")}
                      </small>
                    </span>
                    <button
                      className="outline-tag"
                      disabled={
                        loading ||
                        ids.length !== 2 ||
                        pair.pairs.some(
                          (p) =>
                            p.status === "running" || p.status === "pending",
                        )
                      }
                      onClick={() => void replay(ids)}
                    >
                      Replay matched trials
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p>
            No comparison selected. Completed fresh results will appear here
            with their own evaluation ID.
          </p>
        )}
      </section>
      {recordings.length > 0 && <SavedReplay trials={recordings} />}
      <section className="research-card">
        <h2>Saved-trial browser</h2>
        <div className="explorer-controls">
          <label>
            Brain
            <select
              aria-label="Filter trials by brain"
              value={brainFilter}
              onChange={(e) => setBrainFilter(e.target.value)}
            >
              <option value="all">All versions</option>
              {versions?.versions.map((v) => (
                <option key={v.v} value={v.v}>
                  v{v.v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Partition
            <select
              aria-label="Trial partition"
              value={partition}
              onChange={(e) => setPartition(e.target.value)}
            >
              <option value="all">All recordings</option>
              <option value="training">Training shifts</option>
              <option value="heldout">Held-out evaluations</option>
            </select>
          </label>
          <button
            className="outline-tag"
            onClick={() => void refresh().catch((e) => setError(String(e)))}
          >
            Refresh recordings
          </button>
        </div>
        <p>
          Held-out recordings can be replayed here. They are isolated from
          supervisor training, review and sibling-run inputs.
        </p>
        <div className="version-table">
          <table>
            <thead>
              <tr>
                <th>Brain / seed</th>
                <th>Task</th>
                <th>Result</th>
                <th>Recording</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.trial_id}>
                  <td>
                    v{t.brain_version} · seed {t.seed}
                    <small>
                      {t.partition} · {t.worker}
                    </small>
                  </td>
                  <td>
                    {t.tasks.map((task) => (
                      <div key={task.id}>
                        {task.robot} · {task.type} · {task.source} →{" "}
                        {task.target}
                      </div>
                    ))}
                    {t.task_selection
                      ?.filter((s) => !s.actual)
                      .map((s) => (
                        <div className="diff-removed" key={s.index}>
                          {s.requested.type} {s.requested.slot} · infeasible ·
                          failed
                        </div>
                      ))}
                  </td>
                  <td>
                    {t.scores.filter((s) => s.complete).length}/{t.tasks.length}{" "}
                    successful
                    <small>
                      {t.status}
                      {t.error && ` · ${t.error}`}
                    </small>
                  </td>
                  <td>
                    <button
                      className="outline-tag"
                      disabled={loading || t.status === "running"}
                      onClick={() => void replay([t.trial_id])}
                    >
                      Replay saved trial
                    </button>
                    <small>{t.trial_id}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <p>No recorded trials yet. Legacy score-only gates have no replay.</p>
        )}
      </section>
    </main>
  );
}
