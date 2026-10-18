import { useEffect, useState } from "react";
import { savedApi } from "./api.ts";
import type { VersionIndex } from "./BrainExplorer.tsx";
import type { SavedTrial } from "./trialTypes.ts";
import SavedReplay from "./SavedReplay.tsx";
import { loadRecordings } from "./recordings.ts";
import { buildHash } from "./routes.ts";

type TrialSummary = Omit<SavedTrial, "initial" | "trajectory" | "final"> & {
  kind?: string;
  steps?: number;
};

const provenanceLink = (t: TrialSummary) =>
  t.provenance.comparison_id
    ? {
        href: buildHash("results", { comparison: t.provenance.comparison_id }),
        label: `comparison ${t.provenance.comparison_id}`,
      }
    : t.provenance.shift_id && t.partition === "training"
      ? {
          href: buildHash("results", { run: t.provenance.shift_id }),
          label: `run ${t.provenance.shift_id}`,
        }
      : null;

/** Every saved recording, filterable, each replayable on its saved clock. Never starts a run. */
export default function TrialExplorer({
  initialTrial,
}: {
  initialTrial?: string | null;
}) {
  const [versions, setVersions] = useState<VersionIndex | null>(null);
  const [trials, setTrials] = useState<TrialSummary[]>([]);
  const [recording, setRecording] = useState<SavedTrial[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brainFilter, setBrainFilter] = useState("all"),
    [partition, setPartition] = useState("all"),
    [kind, setKind] = useState("all");
  const refresh = () =>
    savedApi<{ trials: TrialSummary[] }>("/trials")
      // Version 2 recordings only.
      .then((t) =>
        setTrials(
          t.trials.filter(
            (x) => x.kind !== "adversary" && x.kind !== "posttraining",
          ),
        ),
      )
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void savedApi<VersionIndex>("/brain/versions")
      .then(setVersions)
      .catch((e) => setError(String(e)));
    void refresh();
  }, []);
  const replay = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      setRecording(await loadRecordings([id]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (initialTrial) void replay(initialTrial);
  }, [initialTrial]);
  const kinds = [...new Set(trials.map((t) => t.kind).filter(Boolean))] as string[];
  const filtered = trials.filter(
    (t) =>
      (brainFilter === "all" || t.brain_version === Number(brainFilter)) &&
      (partition === "all" || t.partition === partition) &&
      (kind === "all" || t.kind === kind),
  );
  return (
    <div className="stage-workspace">
      <div className="workspace-title">
        <div>
          <div className="eyebrow">PREVIOUS RESULTS · RECORDINGS</div>
          <h2>Every saved recording</h2>
          <p>
            {trials.length} recordings with a full starting scene, every action
            and the final world. Held-out recordings can be replayed but are
            never sent to the supervisor.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="research-error">
          {error}
        </p>
      )}
      {recording.length > 0 && <SavedReplay trials={recording} />}
      <section className="research-card">
        <div className="explorer-controls">
          <label>
            Brain
            <select
              aria-label="Filter recordings by brain"
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
              aria-label="Recording partition"
              value={partition}
              onChange={(e) => setPartition(e.target.value)}
            >
              <option value="all">All recordings</option>
              <option value="training">Training</option>
              <option value="heldout">Held-out evaluations</option>
            </select>
          </label>
          {kinds.length > 1 && (
            <label>
              Source
              <select
                aria-label="Recording source"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="all">All sources</option>
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          )}
          <button className="outline-tag" onClick={() => void refresh()}>
            Refresh recordings
          </button>
        </div>
        <small>
          Success means the intended item was delivered with zero refusals. A
          finished run can still contain failed tasks.
        </small>
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
              {filtered.map((t) => {
                const link = provenanceLink(t);
                return (
                  <tr key={t.trial_id}>
                    <td>
                      v{t.brain_version} · seed {t.seed}
                      <small>
                        {t.partition} · {t.kind ?? "trial"} ·{" "}
                        {t.worker === "llm" ? "Lightning" : "compiled policy"}
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
                            {s.requested.type} {s.requested.slot} · infeasible
                            · failed
                          </div>
                        ))}
                    </td>
                    <td>
                      {t.scores.filter((s) => s.complete).length}/
                      {t.requested_tasks?.length ?? t.tasks.length} successful
                      <small>
                        {t.status}
                        {t.error && ` · ${t.error}`}
                      </small>
                    </td>
                    <td>
                      <button
                        className="outline-tag"
                        disabled={loading || t.status === "running"}
                        onClick={() => void replay(t.trial_id)}
                      >
                        Replay saved trial
                      </button>
                      <small>{t.trial_id}</small>
                      {link && (
                        <a className="text-link" href={link.href}>
                          Open {link.label}
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <p>No matching recordings. Score-only gates have no replay.</p>
        )}
      </section>
    </div>
  );
}
