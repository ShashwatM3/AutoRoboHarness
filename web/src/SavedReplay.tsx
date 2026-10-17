import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { StoreScene } from "./scene/StoreScene.ts";
import { replayBoundaries, replayCursor } from "./scene/recordedReplay.ts";
import WorkerViews from "./WorkerViews.tsx";
import type { SavedTrial } from "./trialTypes.ts";

declare global {
  interface Window {
    __AUTO_ROBO_REPLAYS__?: Map<
      string,
      { scene: StoreScene; trial: SavedTrial; time: number }
    >;
  }
}

function ReplayView({
  trial,
  time,
  view,
}: {
  trial: SavedTrial;
  time: number;
  view: "workers" | "perspective" | "overhead";
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
      </small>
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
      <details>
        <summary>
          v{trial.brain_version} · full action log ({shown.length}/
          {trial.trajectory.length})
        </summary>
        <ol className="replay-full-log">
          {shown.map((s, i) => (
            <li key={i} className={s.ok ? "" : "diff-removed"}>
              v{trial.brain_version} · {s.robot} · {s.t.toFixed(2)}s ·{" "}
              {s.action}({JSON.stringify(s.args)}) · {s.ok ? "OK" : "REFUSED"}:{" "}
              {s.reason}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

export default function SavedReplay({ trials }: { trials: SavedTrial[] }) {
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const [view, setView] = useState<"workers" | "perspective" | "overhead">(
    "workers",
  );
  const boundaries = useMemo(() => replayBoundaries(trials), [trials]);
  const duration = boundaries.at(-1) ?? 0;
  useEffect(() => {
    setTime(0);
    setPlaying(false);
  }, [trials]);
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
  const seek = (t: number) => {
    setPlaying(false);
    setTime(t);
  };
  return (
    <section
      className="research-card saved-replay"
      aria-label="Replay saved trial"
    >
      <div className="replay-heading">
        <div>
          <h2>
            Replay saved trial{trials.length > 1 ? "s · synchronized" : ""}
          </h2>
          <p>
            Recorded data only · zero model calls. Both views share elapsed
            simulation time; a finished trial holds its final scene.
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
            seek([...boundaries].reverse().find((t) => t < time - 0.001) ?? 0)
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
            seek(boundaries.find((t) => t > time + 0.001) ?? duration)
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
          {time.toFixed(2)} / {duration.toFixed(2)} s
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
        onChange={(e) => seek(Number(e.target.value))}
      />
      <div className={`replay-grid ${trials.length > 1 ? "paired" : ""}`}>
        {trials.map((t) => (
          <ReplayView key={t.trial_id} trial={t} time={time} view={view} />
        ))}
      </div>
    </section>
  );
}
