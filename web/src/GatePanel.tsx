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
  type BrainDiff,
  type BrainGraphData,
  type GateInfo,
  type ReviewInfo,
} from "./api.ts";
import BrainGraph from "./BrainGraph.tsx";

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
  const [before, setBefore] = useState<BrainGraphData | null>(null);
  const [after, setAfter] = useState<BrainGraphData | null>(null);
  const [diff, setDiff] = useState<BrainDiff | null>(null);
  const notified = useRef(false);
  const busy = starting || gate?.status === "running" || (!!gateId && !gate);
  const guardrailSelected = review.updates.some(
    (u) => selected.includes(u.id) && u.touches_guardrail,
  );

  useEffect(() => {
    setSelected(
      review.updates
        .filter((u) => u.valid && !u.touches_guardrail && u.judge_supported !== false && !review.judge?.error)
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

  useEffect(() => {
    if (!gate) return;
    let active = true;
    Promise.all([
      api<BrainGraphData>(`/brain?v=${gate.base}`),
      api<BrainGraphData>(`/brain?v=${gate.candidate}`),
      api<BrainDiff>(`/brain/diff?from=${gate.base}&to=${gate.candidate}`),
    ])
      .then(([a, b, d]) => {
        if (active) {
          setBefore(a);
          setAfter(b);
          setDiff(d);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [gate?.base, gate?.candidate]);

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
          <div className="eyebrow">THE NEXT SHIFT / KEEP ONLY WHAT HELPS</div>
          <h2>
            A change has to earn its place<span>.</span>
          </h2>
          <p>
            The old and candidate brains face the same ten held-out seeds, using
            Lightning workers on Crusoe.
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
                  disabled={!u.valid || busy || u.judge_supported === false || !!review.judge?.error}
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
                    {u.judge_supported === false
                      ? "Excluded by the independent judge."
                      : review.judge?.error ? "Waiting for a successful judge check." : u.valid
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
      {gate && (
        <>
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
                      ? `Brain v${gate.candidate} earned the next shift.`
                      : "The current brain stays live."}
              </strong>
              <p>
                {gate.reason ??
                  `${gate.progress.done} of ${gate.progress.total || "…"} task runs complete. The view stays separate from the held-out evaluation.`}
              </p>
            </div>
            <span>{gate.llm.calls} MODEL CALLS</span>
          </div>
          <div className="gate-progress">
            <span
              style={{
                width: `${gate.progress.total ? (gate.progress.done / gate.progress.total) * 100 : 0}%`,
              }}
            />
          </div>
          {gate.worker !== "llm" && (
            <div className="inline-notice">
              This result used the server's compiled policy. It does not measure
              Lightning workers.
            </div>
          )}
          <div className="score-comparison">
            <div>
              <span>BEFORE / BRAIN v{gate.base}</span>
              <strong>
                {gate.base_score
                  ? `${Math.round(gate.base_score.complete_rate * 100)}%`
                  : "—"}
              </strong>
              <p>
                {gate.base_score
                  ? `${gate.base_score.complete} / ${gate.base_score.tasks} tasks passed`
                  : "Awaiting the complete run"}
              </p>
              <small>
                {gate.base_score
                  ? `${gate.base_score.refused_per_task} refused actions · ${gate.base_score.steps_per_task} steps per task`
                  : "Lightning workers · 10 held-out seeds"}
              </small>
            </div>
            <ArrowRight size={22} />
            <div className="candidate-score">
              <span>CANDIDATE / BRAIN v{gate.candidate}</span>
              <strong>
                {gate.candidate_score
                  ? `${Math.round(gate.candidate_score.complete_rate * 100)}%`
                  : "—"}
              </strong>
              <p>
                {gate.candidate_score
                  ? `${gate.candidate_score.complete} / ${gate.candidate_score.tasks} tasks passed`
                  : "Awaiting the complete run"}
              </p>
              <small>
                {gate.candidate_score
                  ? `${gate.candidate_score.refused_per_task} refused actions · ${gate.candidate_score.steps_per_task} steps per task`
                  : "Lightning workers · 10 held-out seeds"}
              </small>
            </div>
          </div>
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
            </div>
          )}
        </>
      )}
    </section>
  );
}
