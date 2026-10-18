import { useEffect, useState } from "react";
import { ExternalLink, GitCompare, LoaderCircle, Swords } from "lucide-react";
import type { TrajectoryStep } from "../../engine/store.ts";
import { ApiError, probe, savedApi } from "./api.ts";
import BrainExplorer from "./BrainExplorer.tsx";
import RecordedLog from "./RecordedLog.tsx";
import { SavedReview } from "./ReviewPanel.tsx";
import SavedReplay from "./SavedReplay.tsx";
import StageNav from "./StageNav.tsx";
import { ROBOT_NAMES } from "./WorkerViews.tsx";
import { CRUSOE_LINKS, MODELS, workerLabel } from "./providers.ts";
import {
  loadRecordings,
  openInLiveTrial,
  SHIFT_PREFILL,
  stepMoment,
  type ShiftConfig,
} from "./recordings.ts";
import type { Stage } from "./routes.ts";
import type { RunDetail, ShiftRecord } from "./runTypes.ts";
import type { SavedTrial } from "./trialTypes.ts";

function loadIntoLive(shift: ShiftRecord) {
  const config: ShiftConfig = {
    seed: shift.seed,
    brain: shift.brain_version,
    tasks: shift.tasks.map((t) => ({
      type: t.type,
      slot: t.type === "PICK" ? t.source : t.target,
    })),
  };
  sessionStorage.setItem(SHIFT_PREFILL, JSON.stringify(config));
  location.hash = "#live";
}

/** A saved training run through Launch, Robots at work and Review. Strictly read-only. */
export default function RunWorkspace({
  shiftId,
  stage,
  onStage,
}: {
  shiftId: string;
  stage: Stage;
  onStage: (stage: Stage) => void;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [library, setLibrary] = useState(true);
  const [trial, setTrial] = useState<SavedTrial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seek, setSeek] = useState<{ time: number; key: number } | null>(null);
  const [focus, setFocus] = useState<{
    robot: string;
    step: number;
    key: number;
  } | null>(null);
  const [explore, setExplore] = useState(false);
  useEffect(() => {
    let active = true;
    setDetail(null);
    setTrial(null);
    setError(null);
    (async () => {
      try {
        const d = await savedApi<RunDetail>(`/runs/${encodeURIComponent(shiftId)}`);
        if (active) setDetail(d);
      } catch (e) {
        const routeMissing =
          e instanceof ApiError &&
          e.status === 404 &&
          (await probe("/runs")) === "missing";
        if (!routeMissing) {
          if (active) setError(e instanceof Error ? e.message : String(e));
          return;
        }
        // Older servers: the stored shift and its trajectory are readable; the saved review is not.
        const [info, trajectory] = await Promise.all([
          savedApi<Omit<ShiftRecord, "trajectory">>(
            `/shift/${encodeURIComponent(shiftId)}`,
          ),
          savedApi<TrajectoryStep[]>(
            `/shift/${encodeURIComponent(shiftId)}/trajectory`,
          ),
        ]);
        if (active) {
          setLibrary(false);
          setDetail({
            shift: { ...info, trajectory, trial_id: info.trial_id ?? undefined },
            review: null,
            gates: [],
          });
        }
      }
    })().catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [shiftId]);
  useEffect(() => {
    const id = detail?.shift.trial_id;
    if (!id) return;
    let active = true;
    loadRecordings([id])
      .then(([t]) => active && setTrial(t))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [detail?.shift.trial_id]);
  if (!detail)
    return (
      <div className="workspace-loading">
        {error ? (
          <p role="alert" className="research-error">
            {error}
          </p>
        ) : (
          <>
            <LoaderCircle className="spin" size={16} /> Loading saved run…
          </>
        )}
      </div>
    );
  const { shift, review, gates } = detail;
  const recorded = !!shift.trial_id;
  const passed = shift.scores.filter((s) => s.complete).length;
  const refused = shift.trajectory.filter((s) => !s.ok).length;
  const itemName = (id: string) =>
    trial?.initial.items[id]?.name ?? id.replace(/^item:/, "item at ");
  const replayStep = (robot: string, step: number) => {
    const source = trial?.trajectory ?? shift.trajectory;
    const s = source.find((x) => x.robot === robot && x.step === step);
    if (!s) {
      setError(`Step ${step} of ${robot} is not in the saved trajectory.`);
      return;
    }
    if (trial) setSeek({ time: stepMoment(s), key: Date.now() });
    else setFocus({ robot, step, key: Date.now() });
    onStage("work");
  };
  return (
    <div className="stage-workspace">
      <div className="workspace-title">
        <div>
          <div className="eyebrow">PREVIOUS RESULT · TRAINING RUN</div>
          <h2>
            <code>{shift.shift_id}</code>
          </h2>
          <p>
            Brain v{shift.brain_version} · seed {shift.seed} ·{" "}
            {shift.tasks.length} robot{shift.tasks.length === 1 ? "" : "s"} ·{" "}
            {passed}/{shift.tasks.length} tasks passed · {refused} refused
            action{refused === 1 ? "" : "s"} · {shift.status}
          </p>
          {shift.source?.kind === "adversary" && (
            <p className="adversary-label">
              <Swords size={13} /> Found by adversary ·{" "}
              {shift.source.adversary_id} ·{" "}
              {String(shift.source.disturbance.kind ?? "disturbance")}
            </p>
          )}
        </div>
      </div>
      <StageNav
        label="Saved run stages"
        stage={stage}
        onStage={onStage}
        available={{ launch: true, work: true, review: true }}
        status={{
          launch: "Saved configuration",
          work: recorded ? "Replay saved trial" : "Recorded action log",
          review: review
            ? `Recorded review${gates.length ? ` · ${gates.length} gate${gates.length === 1 ? "" : "s"}` : ""}`
            : "No saved review",
        }}
      />
      {error && (
        <p role="alert" className="research-error">
          {error}
        </p>
      )}
      {!library && (
        <p className="inline-notice" role="status">
          This server has no read-only run library (GET /runs), so saved
          reviews and gate links cannot be shown here. The legacy review route
          is never called from saved results.
        </p>
      )}
      {stage === "launch" && (
        <section className="research-card saved-config">
          <h3>Saved configuration</h3>
          <dl className="config-grid">
            <div>
              <dt>Brain</dt>
              <dd>v{shift.brain_version}</dd>
            </div>
            <div>
              <dt>Training seed</dt>
              <dd>{shift.seed}</dd>
            </div>
            <div className="wide">
              <dt>Robots and tasks</dt>
              <dd>
                {shift.tasks.map((t, i) => {
                  const score = shift.scores.find((s) => s.task_id === t.id);
                  return (
                    <span key={t.id} className="config-task">
                      R0{i + 1} {ROBOT_NAMES[i]} · {t.type} {itemName(t.item_id)}{" "}
                      · {t.source} → {t.target}
                      {score && (
                        <em className={score.complete ? "diff-added" : "diff-removed"}>
                          {score.complete ? "passed" : "failed"} ·{" "}
                          {score.refused_actions} refused · {score.steps} steps
                        </em>
                      )}
                    </span>
                  );
                })}
              </dd>
            </div>
            <div>
              <dt>Robot workers</dt>
              <dd>{workerLabel(shift.worker)}</dd>
            </div>
            <div>
              <dt>Recording</dt>
              <dd>
                {recorded ? (
                  <>
                    Full scene · <code>{shift.trial_id}</code>
                  </>
                ) : (
                  "Action log only (predates full recordings)"
                )}
              </dd>
            </div>
            <div>
              <dt>Started / finished</dt>
              <dd>
                {shift.started_at ?? "not recorded"}
                {shift.finished_at ? ` → ${shift.finished_at}` : ""}
              </dd>
            </div>
            <div>
              <dt>Worker model usage</dt>
              <dd>
                {shift.llm.calls} responses ·{" "}
                {shift.llm.prompt_tokens.toLocaleString()} prompt /{" "}
                {shift.llm.completion_tokens.toLocaleString()} completion tokens
                {shift.llm.replayed ? ` · ${shift.llm.replayed} local replays` : ""}
              </dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>
                {review
                  ? `${review.status} · ${review.model ?? MODELS.supervisor}${review.judge ? ` · judge ${review.judge.model}` : ""}`
                  : "None saved"}
              </dd>
            </div>
            <div>
              <dt>Gates from this run</dt>
              <dd>
                {gates.length
                  ? gates.map((g) => g.gate_id).join(", ")
                  : library
                    ? "None"
                    : "Unknown on this server"}
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
                  Project-wide, per model. The run ID above is the local record;
                  there is no per-run console page.
                </small>
              </dd>
            </div>
          </dl>
          {shift.error && (
            <p role="alert" className="research-error">
              {shift.error}
            </p>
          )}
          <div className="config-actions">
            <button className="outline-tag" onClick={() => loadIntoLive(shift)}>
              Load this configuration into Live trial
            </button>
            <button className="text-button" onClick={() => setExplore(!explore)}>
              <GitCompare size={13} /> {explore ? "Hide" : "Explore"} brain v
              {shift.brain_version}
            </button>
          </div>
          <small>
            Loading a configuration does not start anything; Launch in Live
            trial makes the model calls.
          </small>
          {explore && (
            <BrainExplorer
              embedded
              initialLeft={Math.max(1, shift.brain_version - 1)}
              initialRight={shift.brain_version}
            />
          )}
        </section>
      )}
      {stage === "work" &&
        (recorded ? (
          trial ? (
            <SavedReplay trials={[trial]} seek={seek} />
          ) : (
            <p className="workspace-loading">
              <LoaderCircle className="spin" size={14} /> Loading recording…
            </p>
          )
        ) : (
          <RecordedLog
            steps={shift.trajectory}
            brainVersion={shift.brain_version}
            focus={focus}
          />
        ))}
      {stage === "review" &&
        (review ? (
          <SavedReview
            review={review}
            gates={gates}
            source={shift.source}
            onReplay={replayStep}
            liveAction={
              recorded && shift.status === "done" ? (
                <button
                  className="outline-tag"
                  onClick={() => openInLiveTrial(shift.shift_id)}
                >
                  Continue in Live trial
                </button>
              ) : undefined
            }
          />
        ) : (
          <section className="research-card empty-stage">
            <h3>No saved review</h3>
            <p>
              {library
                ? "No supervisor review was saved for this run."
                : "Saved reviews are not readable from this server version."}{" "}
              Saved results never start the supervisor.
            </p>
            {recorded && shift.status === "done" ? (
              <button
                className="outline-tag"
                onClick={() => openInLiveTrial(shift.shift_id)}
              >
                Open in Live trial to start a review · Crusoe
              </button>
            ) : (
              <small>
                {shift.status !== "done"
                  ? "Only finished training runs can be reviewed."
                  : "This run predates full recordings. Start new reviews from a fresh Live trial."}
              </small>
            )}
          </section>
        ))}
    </div>
  );
}
