import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { TrajectoryStep } from "../../engine/store.ts";
import { savedApi, type BrainGraphData } from "./api.ts";
import BrainGraph from "./BrainGraph.tsx";
import { StoreScene } from "./scene/StoreScene.ts";
import { replayBoundaries, replayCursor } from "./scene/recordedReplay.ts";
import WorkerViews, { ROBOT_COLORS, ROBOT_NAMES } from "./WorkerViews.tsx";
import type { SavedTrial } from "./trialTypes.ts";

declare global {
  interface Window {
    __AUTO_ROBO_REPLAYS__?: Map<
      string,
      { scene: StoreScene; trial: SavedTrial; time: number }
    >;
  }
}

/** The action being performed at `time`, or the last finished one: the brain nodes it read pulse on the graph. */
export function activeStep(
  steps: TrajectoryStep[],
  time: number,
): TrajectoryStep | undefined {
  const { index, next, progress } = replayCursor(steps, time);
  return next && progress > 0 ? next : steps[index];
}

export function RobotLogs({
  steps,
  robots,
  current,
  onSeek,
  label,
}: {
  steps: TrajectoryStep[];
  robots: string[];
  current?: TrajectoryStep;
  onSeek: (step: TrajectoryStep) => void;
  label: string;
}) {
  const refs = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => {
    if (!current) return;
    const node = refs.current.get(`${current.robot}:${current.step}`);
    const list = node?.parentElement;
    if (node && list)
      list.scrollTop = node.offsetTop - list.offsetTop - list.clientHeight / 2;
  }, [current]);
  return (
    <div className="robot-logs" aria-label={label}>
      {robots.map((robot, i) => {
        const own = steps.filter((s) => s.robot === robot);
        return (
          <section key={robot}>
            <header>
              <span className={`robot-tab-dot ${ROBOT_COLORS[i]}`} />
              R0{i + 1} · {ROBOT_NAMES[i]}
              <small>{own.length} actions</small>
            </header>
            <ol>
              {own.map((s) => (
                <li
                  key={s.step}
                  ref={(node) => {
                    const k = `${robot}:${s.step}`;
                    if (node) refs.current.set(k, node);
                    else refs.current.delete(k);
                  }}
                  className={`${s.ok ? "" : "refused-step"} ${current === s ? "current-step" : ""}`}
                >
                  <button onClick={() => onSeek(s)}>
                    <span>{String(s.step).padStart(2, "0")}</span>
                    <strong>{s.action}</strong>
                    <small>
                      {s.t.toFixed(2)} s · {s.ok ? s.reason : `REFUSED: ${s.reason}`}
                    </small>
                  </button>
                </li>
              ))}
              {!own.length && <li className="waiting-step">No recorded actions.</li>}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function ReplayView({
  trial,
  time,
  view,
  onSeek,
}: {
  trial: SavedTrial;
  time: number;
  view: "workers" | "perspective" | "overhead";
  onSeek: (time: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<StoreScene | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!host.current) return;
    let active = true;
    let instance: StoreScene;
    try {
      instance = new StoreScene(host.current, trial.initial);
      scene.current = instance;
    } catch (e) {
      setError(String(e));
      return;
    }
    instance.setView(view);
    instance.ready
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    if (import.meta.env.DEV) {
      window.__AUTO_ROBO_REPLAYS__ ??= new Map();
      window.__AUTO_ROBO_REPLAYS__.set(trial.trial_id, {
        scene: instance,
        trial,
        time: 0,
      });
    }
    return () => {
      active = false;
      instance.dispose();
      scene.current = null;
      window.__AUTO_ROBO_REPLAYS__?.delete(trial.trial_id);
    };
  }, [trial]);
  useEffect(() => {
    scene.current?.setView(view);
  }, [view]);
  useEffect(() => {
    if (!ready) return;
    scene.current?.seekToTime(trial.trajectory, time);
    const debug = window.__AUTO_ROBO_REPLAYS__?.get(trial.trial_id);
    if (debug) debug.time = time;
  }, [ready, time, trial]);
  const { index, next, progress } = replayCursor(trial.trajectory, time);
  const shown = useMemo(
    () => trial.trajectory.slice(0, index + 1),
    [trial, index],
  );
  const latest = useMemo(
    () => Object.fromEntries(shown.map((s) => [s.robot, s])),
    [shown],
  );
  const score = trial.scores.filter((s) => s.complete).length;
  const refusals = trial.trajectory.filter((s) => !s.ok);
  const delivered = trial.scores.filter(
    (s) => s.item_location === s.target_location,
  ).length;
  const current = activeStep(trial.trajectory, time);
  return (
    <section
      className="replay-view"
      aria-label={`Brain v${trial.brain_version} recorded trial`}
    >
      <header>
        <h3>Brain v{trial.brain_version}</h3>
        <span>
          Seed {trial.seed} · {score}/{trial.requested_tasks.length} successful
          · {trial.status}
        </span>
      </header>
      <small className="recording-id">
        {trial.trial_id} · {trial.partition} ·{" "}
        {trial.worker === "llm"
          ? "Lightning recording"
          : "Compiled policy recording"}
        {trial.provenance.evaluation_id &&
          ` · evaluation ${trial.provenance.evaluation_id}`}
        {trial.provenance.shift_id && ` · shift ${trial.provenance.shift_id}`}
      </small>
      <div className="trial-outcome-facts">
        <strong>
          {delivered}/{trial.requested_tasks.length} delivered
        </strong>
        <span className={refusals.length ? "diff-removed" : "diff-added"}>
          {refusals.length} refused action{refusals.length === 1 ? "" : "s"}
        </span>
        <span>
          {trial.status === "done"
            ? `${score}/${trial.requested_tasks.length} strict successes`
            : "Partial recording"}
        </span>
      </div>
      <div
        className={`viewport-wrap trial-viewport ${view === "workers" ? "worker-mode" : ""}`}
        data-robots={Object.keys(trial.initial.robots).length}
      >
        <div className="scene-host" ref={host} />
        {ready && view === "workers" && (
          <WorkerViews
            scenario={trial.initial}
            steps={shown}
            latest={latest}
            brainVersion={trial.brain_version}
          />
        )}
        {!ready && (
          <p className="replay-loading">{error ?? "Loading recorded scene…"}</p>
        )}
      </div>
      <p className="replay-current" aria-live="off">
        {next && progress > 0
          ? `v${trial.brain_version} · ${next.robot} · ${next.action} · ${next.ok ? "recorded action" : `REFUSED: ${next.reason}`}`
          : shown.at(-1)
            ? `v${trial.brain_version} · ${shown.at(-1)!.robot} · ${shown.at(-1)!.action}: ${shown.at(-1)!.reason}`
            : "Recorded starting scene"}
      </p>
      {refusals.length > 0 && (
        <details className="recorded-refusals" open>
          <summary>
            {refusals.length} recorded refusal{refusals.length === 1 ? "" : "s"}{" "}
            · jump to evidence
          </summary>
          {refusals.map((s) => (
            <button
              key={`${s.robot}-${s.step}`}
              className="text-button"
              onClick={() => onSeek(s.t)}
            >
              v{trial.brain_version} · {s.robot} · step {s.step}: {s.reason}
            </button>
          ))}
        </details>
      )}
      <RobotLogs
        steps={trial.trajectory}
        robots={Object.keys(trial.initial.robots)}
        current={current}
        onSeek={(s) => onSeek(s.t)}
        label={`Brain v${trial.brain_version} recorded action logs`}
      />
      <details>
        <summary>Recorded tasks, environment and outcomes</summary>
        <pre>
          {JSON.stringify(
            {
              tasks: trial.tasks,
              requested_tasks: trial.requested_tasks,
              task_selection: trial.task_selection,
              seed: trial.seed,
              environment: trial.environment,
              scores: trial.scores,
              error: trial.error,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}

/** Recorded playback on the saved simulation clock. Reads recordings only and never calls a model. */
export default function SavedReplay({
  trials,
  title,
  seek,
  showGraph = true,
}: {
  trials: SavedTrial[];
  title?: string;
  /** Change `key` to move the shared clock to `time` (for example, from a failure link). */
  seek?: { time: number; key: number } | null;
  showGraph?: boolean;
}) {
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const [view, setView] = useState<"workers" | "perspective" | "overhead">(
    "workers",
  );
  const [graphSide, setGraphSide] = useState(0);
  const [graphs, setGraphs] = useState<Record<number, BrainGraphData>>({});
  const [graphError, setGraphError] = useState<string | null>(null);
  const boundaries = useMemo(() => replayBoundaries(trials), [trials]);
  const duration = boundaries.at(-1) ?? 0;
  useEffect(() => {
    setTime(0);
    setPlaying(false);
    setGraphSide(0);
  }, [trials]);
  useEffect(() => {
    if (!seek) return;
    setPlaying(false);
    setTime(Math.max(0, Math.min(seek.time, duration)));
  }, [seek?.key]);
  const graphTrial = trials[graphSide] ?? trials[0];
  useEffect(() => {
    if (!showGraph || !graphTrial || graphs[graphTrial.brain_version]) return;
    let active = true;
    savedApi<BrainGraphData>(`/brain?v=${graphTrial.brain_version}`)
      .then((g) => {
        if (active) setGraphs((all) => ({ ...all, [g.version]: g }));
      })
      .catch((e) => {
        if (active) setGraphError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [showGraph, graphTrial?.brain_version]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0,
      last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.25);
      last = now;
      setTime((t) => {
        const n = Math.min(duration, t + delta * speed);
        if (n >= duration) setPlaying(false);
        return n;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, duration]);
  const doSeek = (t: number) => {
    setPlaying(false);
    setTime(t);
  };
  const reading = graphTrial ? activeStep(graphTrial.trajectory, time) : undefined;
  return (
    <section
      className="research-card saved-replay"
      aria-label="Replay saved trial"
    >
      <div className="replay-heading">
        <div>
          <span className="recorded-badge">RECORDED · ZERO MODEL CALLS</span>
          <h2>
            {title ??
              `Replay saved trial${trials.length > 1 ? "s · synchronized" : ""}`}
          </h2>
          <p>
            Plays the stored recording on its saved simulation clock. Both views
            share elapsed simulation time; a finished trial holds its final
            scene.
          </p>
        </div>
        <label>
          Camera
          <select
            value={view}
            onChange={(e) => setView(e.target.value as typeof view)}
          >
            <option value="workers">Robot head cameras</option>
            <option value="perspective">Store perspective</option>
            <option value="overhead">Store overhead</option>
          </select>
        </label>
      </div>
      <div className="saved-playback-controls">
        <button
          aria-label="Step backward"
          disabled={time <= 0}
          onClick={() =>
            doSeek([...boundaries].reverse().find((t) => t < time - 0.001) ?? 0)
          }
        >
          <SkipBack size={17} /> Back
        </button>
        <button
          className="play-button"
          onClick={() => {
            if (time >= duration) setTime(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
          {playing ? "Pause" : "Play saved trial"}
        </button>
        <button
          aria-label="Step forward"
          disabled={time >= duration}
          onClick={() =>
            doSeek(boundaries.find((t) => t > time + 0.001) ?? duration)
          }
        >
          Step <SkipForward size={17} />
        </button>
        <label>
          Speed
          <select
            aria-label="Replay speed"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[0.25, 0.5, 1, 2, 4, 8].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <output>
          {time.toFixed(2)} / {duration.toFixed(2)} s simulated
        </output>
      </div>
      <input
        className="replay-timeline"
        aria-label="Replay timeline"
        type="range"
        min={0}
        max={duration || 1}
        step="0.001"
        value={time}
        onChange={(e) => doSeek(Number(e.target.value))}
      />
      <div className={`replay-grid ${trials.length > 1 ? "paired" : ""}`}>
        {trials.map((t) => (
          <ReplayView
            key={t.trial_id}
            trial={t}
            time={time}
            view={view}
            onSeek={doSeek}
          />
        ))}
      </div>
      {showGraph && graphTrial && (
        <div className="replay-graph">
          <div className="replay-graph-heading">
            <div>
              <h3>Brain nodes read at this moment</h3>
              <p>
                {reading
                  ? `${reading.robot} step ${reading.step} (${reading.action}) read ${reading.brain_nodes_read.length} nodes from brain v${graphTrial.brain_version}.`
                  : "Press play or choose an action to see which knowledge it read."}
              </p>
            </div>
            {trials.length > 1 && (
              <div className="view-switch">
                {trials.map((t, i) => (
                  <button
                    key={t.trial_id}
                    className={graphSide === i ? "selected" : ""}
                    onClick={() => setGraphSide(i)}
                  >
                    v{t.brain_version}
                  </button>
                ))}
              </div>
            )}
          </div>
          <BrainGraph
            data={graphs[graphTrial.brain_version] ?? null}
            error={graphError}
            readIds={reading?.brain_nodes_read ?? []}
            epoch={reading ? reading.step * 10 + reading.t : 0}
          />
        </div>
      )}
    </section>
  );
}
