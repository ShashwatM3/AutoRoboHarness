import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  Code2,
  FileSearch,
  GitBranch,
  LoaderCircle,
  Layers3,
  Play,
  ShieldCheck,
  Sparkles,
  Swords,
  Wrench,
} from "lucide-react";
import type { TrajectoryStep } from "../../engine/store.ts";
import {
  api,
  savedApi,
  type GateInfo,
  type Grounding,
  type ReviewInfo,
  type RunSource,
} from "./api.ts";
import GatePanel, { GateResult } from "./GatePanel.tsx";
import BrainHistory from "./BrainHistory.tsx";

function assetURL(path: string): string {
  const clean = path.replace(/^\//, "");
  return clean.startsWith("ground_truth/") && !clean.includes("..")
    ? `/${clean}`
    : "";
}

function RunSteps({ id, label }: { id: string; label: string }) {
  const [steps, setSteps] = useState<TrajectoryStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const [shift, robot] = id.split("/");
    if (!shift || !robot) {
      setError("The reference is missing a shift or robot ID.");
      return;
    }
    savedApi<TrajectoryStep[]>(
      `/shift/${encodeURIComponent(shift)}/trajectory?robot=${encodeURIComponent(robot)}`,
    )
      .then((data) => {
        if (active) setSteps(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <div className="contrast-run">
      <strong>{label}</strong>
      <span>{id}</span>
      {error ? (
        <p>{error}</p>
      ) : !steps ? (
        <p>Loading trajectory…</p>
      ) : (
        <ol>
          {steps.map((step) => (
            <li key={step.step} className={step.ok ? "" : "contrast-refused"}>
              <span>{step.step}</span>
              <div>
                {step.action}
                <small>{step.reason}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Evidence({ grounding }: { grounding: Grounding }) {
  if (grounding.kind === "clip") {
    const frames = grounding.frames?.map(assetURL).filter(Boolean) ?? [];
    return (
      <div className="clip-evidence">
        <div className="evidence-caption">
          <span>RETAILACTION FOOTAGE / {grounding.clip_id}</span>
          <span>
            {grounding.verified ? "REFERENCE FOUND" : "UNVERIFIED REFERENCE"}
          </span>
        </div>
        {frames.length ? (
          <div className="evidence-frames">
            {frames.map((path, i) => (
              <a
                key={path}
                href={path}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open evidence frame ${i + 1}`}
              >
                <img
                  src={path}
                  alt={`RetailAction ${grounding.clip_id}, action frame ${i + 1}`}
                  loading="lazy"
                />
                <span>0{i + 1}</span>
              </a>
            ))}
          </div>
        ) : grounding.sheet && assetURL(grounding.sheet) ? (
          <img
            className="evidence-sheet"
            src={assetURL(grounding.sheet)}
            alt={`Contact sheet for ${grounding.clip_id}`}
          />
        ) : (
          <p>The reference has no available frames.</p>
        )}
        <p>{grounding.note ?? grounding.description}</p>
      </div>
    );
  }
  // Web sources are displayed once in the insight's research source list.
  if (grounding.kind === "citation") return null;
  return (
    <div className="contrast-evidence">
      <div className="evidence-caption">
        <span>RUN CONTRAST</span>
        <span>
          {grounding.verified ? "REFERENCES FOUND" : "UNVERIFIED REFERENCE"}
        </span>
      </div>
      <div className="contrast-grid">
        <RunSteps id={grounding.failed_run} label="Failed run" />
        <RunSteps id={grounding.ok_run} label="Successful sibling" />
      </div>
      {grounding.note && <p>{grounding.note}</p>}
    </div>
  );
}

function ReviewBody({
  review,
  onReplay,
  recorded,
  v3,
}: {
  review: ReviewInfo;
  onReplay: (robot: string, step: number) => void;
  recorded: boolean;
  v3?: ReactNode;
}) {
  const kept = <T extends { judge?: { keep: boolean } }>(rows: T[]) =>
    rows.filter((row) => row.judge?.keep !== false);
  return (
    <div className="review-columns">
      <section className="review-section failures-section">
        <div className="review-section-title">
          <span>01</span>
          <h3>Failures</h3>
          <small>
            {kept(review.failures).length.toString().padStart(2, "0")}
          </small>
        </div>
        <p className="section-intro">
          The moment it went wrong. Each failure links to its exact recorded
          step.
        </p>
        {kept(review.failures).map((failure) => (
          <button
            key={failure.id}
            className="failure-card"
            onClick={() => onReplay(failure.robot, failure.step)}
          >
            <div>
              <span>
                {failure.id} / {failure.robot.toUpperCase()}
              </span>
              <span>
                <Play size={9} fill="currentColor" />
                STEP {failure.step}
              </span>
            </div>
            <h4>{failure.check.replaceAll("_", " ")}</h4>
            <p>{failure.cause}</p>
            {failure.judge && (
              <small className="judge-verdict">
                Judge confirmed: {failure.judge.why}
              </small>
            )}
            {failure.nodes_in_effect.length > 0 && (
              <small className="nodes-in-effect">
                Brain nodes in effect: {failure.nodes_in_effect.join(" · ")}
              </small>
            )}
            <span className="reference-state">
              {failure.verified ? <Check size={10} /> : "!"}
              {failure.verified
                ? "Step exists in trajectory"
                : "Step reference is unverified"}
              <ChevronRight size={12} />
            </span>
          </button>
        ))}
        {review.status === "done" && !kept(review.failures).length && (
          <p className="empty-review">No failures survived this review.</p>
        )}
        {review.status === "running" &&
          review.detected.refused_steps.map((step, i) => (
            <button
              className="failure-card engine-fact"
              key={`${step.robot}-${step.step}-${i}`}
              onClick={() => onReplay(step.robot, step.step)}
            >
              <div>
                <span>ENGINE FACT / {step.robot}</span>
                <span>STEP {step.step}</span>
              </div>
              <h4>{step.action}</h4>
              <p>{step.reason}</p>
            </button>
          ))}
      </section>
      <section className="review-section insights-section">
        <div className="review-section-title">
          <span>02</span>
          <h3>Insights</h3>
          <small>
            {kept(review.insights).length.toString().padStart(2, "0")}
          </small>
        </div>
        <p className="section-intro">
          What better behavior looks like, grounded in footage, run contrasts
          and cited sources.
        </p>
        {kept(review.insights).map((insight) => (
          <article className="insight-card" key={insight.id}>
            <div className="insight-label">
              <Sparkles size={12} />
              <span>
                {insight.id} / {insight.addresses.join(", ")}
              </span>
            </div>
            <h4>{insight.claim}</h4>
            {insight.judge && (
              <p className="judge-verdict">
                Judge confirmed: {insight.judge.why}
              </p>
            )}
            {!!insight.citations?.length && (
              <div className="research-citations">
                {insight.citations.some((c) => c.judge_supports !== false) && (
                  <>
                    <strong>Research sources</strong>
                    <ol>
                      {insight.citations
                        .filter(
                          (c) =>
                            c.judge_supports !== false &&
                            /^https?:\/\//i.test(c.url),
                        )
                        .map((citation, i) => (
                          <li key={`${citation.url}-${i}`}>
                            <a
                              href={citation.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {citation.title || citation.url}
                            </a>
                            {citation.snippet && <p>{citation.snippet}</p>}
                          </li>
                        ))}
                    </ol>
                  </>
                )}
                {insight.citations.some((c) => c.judge_supports === false) && (
                  <details>
                    <summary>Sources excluded by the judge</summary>
                    <p>These sources do not support this insight's claim.</p>
                    <ul>
                      {insight.citations
                        .filter(
                          (c) =>
                            c.judge_supports === false &&
                            /^https?:\/\//i.test(c.url),
                        )
                        .map((citation, i) => (
                          <li key={i}>
                            <a
                              href={citation.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {citation.title || citation.url}
                            </a>
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
            {!insight.verified && (
              <p className="unverified-note">
                The evidence references could not be confirmed.
              </p>
            )}
            {insight.grounding
              .filter((g) => g.judge_supports !== false)
              .map((grounding, i) => (
                <Evidence key={i} grounding={grounding} />
              ))}
          </article>
        ))}
        {review.status === "done" && !kept(review.insights).length && (
          <p className="empty-review">No insights survived this review.</p>
        )}
      </section>
      <section className="review-section updates-section">
        <div className="review-section-title">
          <span>03</span>
          <h3>Brain updates</h3>
          <small>{review.updates.length.toString().padStart(2, "0")}</small>
        </div>
        <p className="section-intro">
          Each proposed lesson in plain English, then the exact graph
          operations it would apply.
        </p>
        {review.updates.map((update) => (
          <article key={update.id} className="update-card">
            <div className="update-label">
              <GitBranch size={12} />
              <span>
                {update.id} /{" "}
                {update.valid ? "VALID OPERATIONS" : "NEEDS REPAIR"}
              </span>
            </div>
            <h4>{update.summary}</h4>
            {update.judge_supported === false && (
              <p className="unverified-note">
                Excluded: its supporting findings did not pass the judge.
              </p>
            )}
            {update.touches_guardrail && (
              <p className="unverified-note">
                This update changes a guardrail and needs approval.
              </p>
            )}
            {update.errors.length > 0 && (
              <p className="unverified-note">{update.errors.join(" · ")}</p>
            )}
            <div className="update-code">
              <span>
                <Code2 size={12} /> Graph operations
              </span>
              <pre>{JSON.stringify(update.compiled, null, 2)}</pre>
            </div>
            <details>
              <summary>
                Supervisor edit calls
                <ChevronRight size={12} />
              </summary>
              <pre>{JSON.stringify(update.ops, null, 2)}</pre>
            </details>
          </article>
        ))}
        {review.status === "done" && !review.updates.length && (
          <p className="empty-review">The supervisor proposed no updates.</p>
        )}
        {review.tool_calls.length > 0 && (
          <details className="tool-call-log">
            <summary>
              <Wrench size={12} /> Supervisor tool calls ·{" "}
              {review.tool_calls.length}
              {recorded ? " recorded" : ""}
            </summary>
            <ol>
              {review.tool_calls.map((call, i) => (
                <li key={i}>
                  <code>
                    {call.name}({JSON.stringify(call.args)})
                  </code>
                </li>
              ))}
            </ol>
          </details>
        )}
        {v3 ?? (
          <div className="future-buttons">
            <button disabled>
              Run post-training
              <span>VERSION 3</span>
            </button>
            <button disabled>
              Adversarial attack
              <span>VERSION 3</span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function ReviewFacts({ review }: { review: ReviewInfo }) {
  return (
    <>
      <div className="review-facts">
        <span>
          <FileSearch size={15} />
          {review.detected.refused_steps.length} refused actions in the engine
          log
        </span>
        <span>
          <ShieldCheck size={15} />
          {review.detected.incomplete_tasks.length} tasks need review
        </span>
        <span>
          <GitBranch size={15} />
          Brain v{review.brain_version}
        </span>
        {review.llm && (
          <span
            title={`${review.llm.crusoe_cache?.cached_tokens ?? 0} cached / ${review.llm.crusoe_cache?.prompt_tokens ?? 0} reported prompt tokens; local response replays excluded`}
          >
            <Layers3 size={15} />
            {review.llm.calls} model calls ·{" "}
            {review.llm.cache_share == null
              ? "review cache not reported"
              : `${(review.llm.cache_share * 100).toFixed(1)}% review prompt cache`}
          </span>
        )}
      </div>
    </>
  );
}

function JudgeSummary({
  review,
  recorded,
  onRejudge,
  rejudging,
  judgeError,
}: {
  review: ReviewInfo;
  recorded: boolean;
  onRejudge?: () => void;
  rejudging?: boolean;
  judgeError?: string | null;
}) {
  return (
    <section className="judge-summary" aria-label="Independent judge">
      <ShieldCheck size={19} />
      <div>
        <strong>Independent evidence check</strong>
        {review.judge?.error ? (
          <p role="alert">
            Judge unavailable: {review.judge.error}. Findings are awaiting
            verification.
          </p>
        ) : review.judge ? (
          <p>
            {review.judge.kept.length} kept · {review.judge.dropped.length}{" "}
            dropped <small>{review.judge.model}</small>
          </p>
        ) : (
          <p>
            {review.status === "running"
              ? "Waiting for the independent judge."
              : "This earlier review has no judge verdict."}
          </p>
        )}
      </div>
      {!recorded &&
        onRejudge &&
        review.status === "done" &&
        (!review.judge || review.judge.error) && (
          <button
            className="check-evidence"
            disabled={rejudging}
            onClick={onRejudge}
          >
            {rejudging ? "Checking evidence…" : "Check evidence"}
          </button>
        )}
      {judgeError && <p role="alert">{judgeError}</p>}
      {!!review.judge?.dropped.length && (
        <details>
          <summary>Excluded findings</summary>
          <ul>
            {review.judge.dropped.map((item) => (
              <li key={item.id}>
                <strong>{item.id}</strong> {item.why}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function SourceLabel({ source }: { source?: RunSource }) {
  if (source?.kind !== "adversary") return null;
  return (
    <p className="adversary-label">
      <Swords size={13} /> Found by adversary · {source.adversary_id} ·{" "}
      {String(source.disturbance.kind ?? "disturbance")}
    </p>
  );
}

/** A saved review, shown exactly as recorded. It never calls a model or starts a review. */
export function SavedReview({
  review,
  gates,
  source,
  onReplay,
  liveAction,
}: {
  review: ReviewInfo;
  gates: GateInfo[];
  source?: RunSource;
  onReplay: (robot: string, step: number) => void;
  liveAction?: ReactNode;
}) {
  return (
    <section className="review-panel" aria-label="Recorded review">
      <div className="review-heading">
        <div>
          <div className="eyebrow">STAGE 3 / RECORDED REVIEW</div>
          <h2>
            What the harness concluded<span>.</span>
          </h2>
          <p>
            Recorded{review.finished_at ? ` ${review.finished_at}` : ""} by{" "}
            <code>{review.model ?? "the supervisor"}</code>. Shown as saved; no
            model is called on this page.
          </p>
          <SourceLabel source={source} />
        </div>
        <span className="outline-tag">RECORDED · NOT LIVE</span>
      </div>
      {review.status !== "done" && (
        <div className="inline-notice" role="status">
          This saved review has status “{review.status}”
          {review.error ? `: ${review.error}` : ""}.
        </div>
      )}
      <ReviewFacts review={review} />
      <JudgeSummary review={review} recorded />
      <ReviewBody review={review} onReplay={onReplay} recorded />
      <section className="gate-panel recorded-gates" aria-label="Recorded gates">
        <div className="gate-heading">
          <div>
            <div className="eyebrow">UPDATE BRAIN / RECORDED GATES</div>
            <h2>
              {gates.length
                ? `${gates.length} gate${gates.length === 1 ? "" : "s"} used this review`
                : "No gate used this review"}
              <span>.</span>
            </h2>
            <p>
              Gates appear exactly as saved, with their own scores and graph
              differences. Update Brain runs only from Live trial.
            </p>
          </div>
          {liveAction}
        </div>
        {gates.map((gate) => (
          <div className="recorded-gate" key={gate.gate_id}>
            <GateResult gate={gate} recorded />
          </div>
        ))}
      </section>
    </section>
  );
}

/** Live training review. Mounting it requests the supervisor, so it appears only after an explicit click. */
export default function ReviewPanel({
  shiftId,
  source,
  onReplay,
  onBrainUpdated,
  v3,
}: {
  shiftId: string;
  source?: RunSource;
  onReplay: (robot: string, step: number) => void;
  onBrainUpdated: () => void;
  v3?: ReactNode;
}) {
  const [review, setReview] = useState<ReviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(
    "The supervisor is reading the shift.",
  );
  const [retry, setRetry] = useState(0);
  const [rejudging, setRejudging] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const checkEvidence = async () => {
    setRejudging(true);
    setJudgeError(null);
    try {
      setReview(
        await api<ReviewInfo>(`/review/${encodeURIComponent(shiftId)}/judge`, {
          method: "POST",
        }),
      );
    } catch (e) {
      setJudgeError(
        e instanceof Error ? e.message : "The evidence check could not finish.",
      );
    } finally {
      setRejudging(false);
    }
  };

  useEffect(() => {
    let active = true,
      timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<ReviewInfo>(
          `/review/${encodeURIComponent(shiftId)}`,
        );
        if (!active) return;
        setReview(result);
        setError(
          result.status === "error"
            ? (result.error ?? "The supervisor could not finish.")
            : null,
        );
        if (result.status === "running") timeout = setTimeout(poll, 3000);
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "The review could not be loaded.",
          );
      }
    };
    void poll();
    const events = new EventSource("/api/events");
    events.addEventListener("review_progress", (event) => {
      try {
        const update = JSON.parse((event as MessageEvent).data);
        if (active && update.shift_id === shiftId) setProgress(update.msg);
      } catch {
        /* Polling retains the authoritative status. */
      }
    });
    events.addEventListener("review_done", () => {
      if (active) {
        clearTimeout(timeout);
        void poll();
      }
    });
    return () => {
      active = false;
      clearTimeout(timeout);
      events.close();
    };
  }, [shiftId, retry]);

  const redo = async () => {
    setError(null);
    try {
      await api(`/review/${encodeURIComponent(shiftId)}?refresh=1`, {
        method: "POST",
      });
      setRetry((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The review could not restart.",
      );
    }
  };

  return (
    <section className="review-panel" aria-label="Shift review">
      <div className="review-heading">
        <div>
          <div className="eyebrow">STAGE 3 / HARNESS REVIEW</div>
          <h2>
            Every mistake has a lesson<span>.</span>
          </h2>
          <p>
            The supervisor connects the facts to evidence, then proposes what
            the shared brain should learn. Training shifts only.
          </p>
          <SourceLabel source={source} />
        </div>
        <span className="outline-tag">LIVE · CRUSOE</span>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button onClick={() => void redo()}>Retry review</button>
        </div>
      )}
      {(!review || review.status === "running") && !error && (
        <div className="review-working">
          <LoaderCircle className="spin" size={18} />
          <div>
            <strong>The supervisor is working.</strong>
            <p>{progress}</p>
          </div>
          {review && <span>{review.tool_calls.length} evidence tool calls</span>}
        </div>
      )}
      {review && (
        <>
          <ReviewFacts review={review} />
          <JudgeSummary
            review={review}
            recorded={false}
            onRejudge={() => void checkEvidence()}
            rejudging={rejudging}
            judgeError={judgeError}
          />
          <ReviewBody
            review={review}
            onReplay={onReplay}
            recorded={false}
            v3={review.status === "done" ? v3 : undefined}
          />
          {review.status === "done" && (
            <>
              <GatePanel review={review} onBrainUpdated={onBrainUpdated} />
              <BrainHistory />
            </>
          )}
        </>
      )}
    </section>
  );
}
