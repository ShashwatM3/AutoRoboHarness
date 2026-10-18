import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  GitBranch,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  savedApi,
  type BrainDiff,
  type BrainGraphData,
  type GateInfo,
  type ReviewInfo,
} from "./api.ts";
import BrainGraph from "./BrainGraph.tsx";
import { buildHash } from "./routes.ts";

/** Scores, before/after graphs and the recorded diff of one gate. Reads saved data only. */
export function GateResult({
  gate,
  recorded = false,
}: {
  gate: GateInfo;
  recorded?: boolean;
}) {
  const [before, setBefore] = useState<BrainGraphData | null>(null);
  const [after, setAfter] = useState<BrainGraphData | null>(null);
  const [diff, setDiff] = useState<BrainDiff | null>(null);
  const [recordings, setRecordings] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      savedApi<BrainGraphData>(`/brain?v=${gate.base}`),
      savedApi<BrainGraphData>(`/brain?v=${gate.candidate}`),
      savedApi<BrainDiff>(`/brain/diff?from=${gate.base}&to=${gate.candidate}`),
    ])
      .then(([a, b, d]) => {
        if (active) {
          setBefore(a);
          setAfter(b);
          setDiff(d);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [gate.base, gate.candidate]);
  useEffect(() => {
    if (!recorded) return;
    let active = true;
    savedApi<{ trials: unknown[] }>(
      `/trials?gate_id=${encodeURIComponent(gate.gate_id)}`,
    )
      .then((r) => {
        if (active) setRecordings(r.trials.length);
      })
      .catch(() => {
        if (active) setRecordings(null);
      });
    return () => {
      active = false;
    };
  }, [recorded, gate.gate_id]);
  const score = (s: GateInfo["base_score"]) =>
    s ? `${Math.round(s.complete_rate * 100)}%` : "—";
  return (
    <>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="gate-status">
        <span
          className={`gate-icon ${gate.verdict === "promoted" ? "promoted" : ""}`}
        >
          {gate.status === "running" ? (
            <LoaderCircle className="spin" size={18} />
          ) : gate.verdict === "promoted" ? (
            <Check size={19} />
          ) : (
            <ShieldCheck size={19} />
          )}
        </span>
        <div>
          <strong>
            {gate.status === "running"
              ? "The candidate is being tested."
              : gate.status === "error"
                ? "The evaluation stopped."
                : gate.verdict === "promoted"
                  ? `Brain v${gate.candidate} ${recorded ? "was promoted" : "earned the next shift"}.`
                  : recorded
                    ? `Brain v${gate.candidate} was rejected; v${gate.base} stayed live.`
                    : "The current brain stays live."}
          </strong>
          <p>
            {gate.reason ??
              `${gate.progress.done} of ${gate.progress.total || "…"} task runs complete.`}
          </p>
          {recorded && (
            <small>
              <code>{gate.gate_id}</code>
              {gate.update_ids?.length
                ? ` · updates ${gate.update_ids.join(", ")}`
                : ""}
              {gate.judge_policy ? ` · judge ${gate.judge_policy}` : ""}
              {` · seeds ${gate.seeds[0]}–${gate.seeds.at(-1)}`}
              {gate.finished_at ? ` · finished ${gate.finished_at}` : ""}
            </small>
          )}
        </div>
        <span>
          {gate.llm.calls} MODEL CALLS
          {gate.llm.replayed ? ` · ${gate.llm.replayed} REPLAYED` : ""}
        </span>
      </div>
      {!recorded && (
        <div className="gate-progress">
          <span
            style={{
              width: `${gate.progress.total ? (gate.progress.done / gate.progress.total) * 100 : 0}%`,
            }}
          />
        </div>
      )}
      {gate.worker !== "llm" && (
        <div className="inline-notice">
          This result used the server's compiled policy. It does not measure
          Lightning workers.
        </div>
      )}
      {recorded && (
        <p className="recorded-note">
          {recordings
            ? `${recordings} recordings were saved for this gate.`
            : "Score records only. No trajectories were saved for this gate, so it has no replay."}
        </p>
      )}
      <div className="score-comparison">
        {(
          [
            ["BEFORE", gate.base, gate.base_score, ""],
            ["CANDIDATE", gate.candidate, gate.candidate_score, "candidate-score"],
          ] as const
        ).flatMap(([role, v, s, className], i) => [
          ...(i === 1 ? [<ArrowRight key="arrow" size={22} />] : []),
          <div key={role} className={className}>
            <span>
              {role} / BRAIN v{v}
            </span>
            <strong>{score(s)}</strong>
            <p>
              {s
                ? `${s.complete} / ${s.tasks} tasks passed`
                : "Awaiting the complete run"}
            </p>
            <small>
              {s
                ? `${s.refused_per_task} refused actions · ${s.steps_per_task} steps per task`
                : `${gate.worker === "llm" ? "Lightning workers" : "Compiled policy"} · ${gate.seeds.length} held-out seeds`}
            </small>
          </div>,
        ])}
      </div>
      {recorded && gate.per_seed && gate.per_seed.length > 0 && (
        <details className="per-seed-scores">
          <summary>
            Per-seed scores · {gate.per_seed.length} seeds · every task counts
          </summary>
          <table>
            <thead>
              <tr>
                <th>Seed</th>
                <th>v{gate.base}</th>
                <th>v{gate.candidate}</th>
              </tr>
            </thead>
            <tbody>
              {gate.per_seed.map((row) => (
                <tr key={row.seed}>
                  <th>{row.seed}</th>
                  {[row.base, row.candidate].map((scores, i) => (
                    <td key={i}>
                      {scores.map((s) => (
                        <span
                          key={s.task_id}
                          className={s.complete ? "diff-added" : "diff-removed"}
                        >
                          {s.complete ? "Passed" : "Failed"} · {s.refused_actions}{" "}
                          refused · {s.steps} steps · item at {s.item_location}
                        </span>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <div className="graph-comparison">
        <div>
          <h3>
            Before <span>v{gate.base}</span>
          </h3>
          <BrainGraph
            data={before}
            readIds={[]}
            epoch={0}
            error={null}
            retiredIds={diff?.retired_nodes.map((n) => n.id)}
          />
        </div>
        <div>
          <h3>
            Candidate <span>v{gate.candidate}</span>
          </h3>
          <BrainGraph
            data={after}
            readIds={[]}
            epoch={0}
            error={null}
            addedIds={diff?.added_nodes.map((n) => n.id)}
            retiredIds={diff?.retired_nodes.map((n) => n.id)}
          />
        </div>
      </div>
      {diff && (
        <div className="diff-legend">
          <span>
            <i />
            {diff.added_nodes.length} added
          </span>
          <span>{diff.changed.length} properties changed</span>
          <span className="retired-count">
            {diff.retired_nodes.length} retired
          </span>
          <span>
            {gate.worker === "llm"
              ? "LIGHTNING EVALUATION"
              : "COMPILED POLICY EVALUATION"}
          </span>
          <a
            className="text-link"
            href={buildHash("results", {
              view: "brains",
              left: gate.base,
              right: gate.candidate,
            })}
          >
            Full graph difference ↗
          </a>
        </div>
      )}
    </>
  );
}

/** Update Brain for a live training review: select judge-supported edits, then run the held-out gate. */
export default function GatePanel({
  review,
  onBrainUpdated,
}: {
  review: ReviewInfo;
  onBrainUpdated: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [approved, setApproved] = useState(false);
  const [starting, setStarting] = useState(false);
  const [gate, setGate] = useState<GateInfo | null>(null);
  const [gateId, setGateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notified = useRef(false);
  const busy = starting || gate?.status === "running" || (!!gateId && !gate);
  const guardrailSelected = review.updates.some(
    (u) => selected.includes(u.id) && u.touches_guardrail,
  );
  const blocked = (u: ReviewInfo["updates"][number]) =>
    (review.judge ? u.judge_supported !== true : u.judge_supported === false) ||
    !!review.judge?.error;

  useEffect(() => {
    setSelected(
      review.updates
        .filter((u) => u.valid && !u.touches_guardrail && !blocked(u))
        .map((u) => u.id),
    );
  }, [review.updates]);

  useEffect(() => {
    const saved = sessionStorage.getItem(`autorobo-gate:${review.shift_id}`);
    if (saved) setGateId(saved);
  }, [review.shift_id]);

  useEffect(() => {
    if (!gateId) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<GateInfo>(
          `/gate/${encodeURIComponent(gateId)}`,
        );
        if (!active) return;
        setGate(result);
        if (result.status === "error")
          setError(result.error ?? "The held-out run could not finish.");
        if (result.status === "running") timer = setTimeout(poll, 3000);
        else if (result.status === "done" && !notified.current) {
          notified.current = true;
          onBrainUpdated();
        }
      } catch (e) {
        if (active) {
          setError(
            e instanceof Error ? e.message : "The gate could not be loaded.",
          );
          timer = setTimeout(poll, 6000);
        }
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [gateId]);

  const update = async () => {
    if (!selected.length || busy || (guardrailSelected && !approved)) return;
    setStarting(true);
    setError(null);
    notified.current = false;
    try {
      const result = await api<{ gate_id: string }>("/brain/update", {
        method: "POST",
        body: JSON.stringify({
          shift_id: review.shift_id,
          update_ids: selected,
          approve_guardrails: guardrailSelected && approved,
          worker: "llm",
          seeds: 10,
        }),
      });
      sessionStorage.setItem(
        `autorobo-gate:${review.shift_id}`,
        result.gate_id,
      );
      setGateId(result.gate_id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The brain update could not start.",
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="gate-panel" aria-label="Held-out evaluation">
      <div className="gate-heading">
        <div>
          <div className="eyebrow">UPDATE BRAIN / KEEP ONLY WHAT HELPS</div>
          <h2>
            A change has to earn its place<span>.</span>
          </h2>
          <p>
            The old and candidate brains face the same ten held-out seeds, using
            Lightning workers on Crusoe. About 150 model calls; held-out runs
            are never sent to the supervisor.
          </p>
        </div>
        <span className="outline-tag">SAME WORKERS · UNSEEN SEEDS</span>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          {gate?.status === "error" && (
            <button
              onClick={() => {
                sessionStorage.removeItem(`autorobo-gate:${review.shift_id}`);
                setGateId(null);
                setGate(null);
                setError(null);
              }}
            >
              Prepare another evaluation
            </button>
          )}
        </div>
      )}
      {!gate && (
        <div className="gate-setup">
          <div className="update-options">
            {review.updates.map((u) => (
              <label key={u.id} className={u.valid ? "" : "invalid-update"}>
                <input
                  type="checkbox"
                  checked={selected.includes(u.id)}
                  disabled={!u.valid || busy || blocked(u)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, u.id]
                        : ids.filter((id) => id !== u.id),
                    )
                  }
                />
                <span>
                  <strong>
                    {u.id} · {u.summary}
                  </strong>
                  <small>
                    {(
                      review.judge
                        ? u.judge_supported !== true
                        : u.judge_supported === false
                    )
                      ? "Not confirmed by the independent judge."
                      : review.judge?.error
                        ? "Waiting for a successful judge check."
                        : u.valid
                          ? u.touches_guardrail
                            ? "Changes a guardrail; explicit approval is required."
                            : `${u.compiled.length} graph operations`
                          : `Not applicable: ${u.errors.join("; ")}`}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <div className="gate-start">
            {guardrailSelected && (
              <label className="guardrail-approval">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                I approve the selected guardrail changes.
              </label>
            )}
            <button
              className="update-brain-button"
              disabled={
                review.status !== "done" ||
                !selected.length ||
                busy ||
                (guardrailSelected && !approved)
              }
              onClick={() => void update()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <GitBranch size={15} />
              )}
              Update Brain
              <ArrowRight size={15} />
            </button>
            <p>
              The candidate becomes live only if the gate records an
              improvement.
            </p>
          </div>
        </div>
      )}
      {gate && <GateResult gate={gate} />}
    </section>
  );
}
