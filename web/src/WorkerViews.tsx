import { useEffect, useRef } from "react";
import type { Scenario, TrajectoryStep } from "../../engine/store.ts";

export const ROBOT_NAMES = ["Scout", "Atlas", "Piper", "Moss"];
export const ROBOT_COLORS = ["orange", "blue", "purple", "green"];

/** Text overlays occupy the lower 36% of each matching WebGL camera tile. */
export default function WorkerViews({
  scenario,
  steps,
  latest,
  brainVersion,
}: {
  scenario: Scenario;
  steps: TrajectoryStep[];
  latest: Record<string, TrajectoryStep>;
  brainVersion?: number;
}) {
  const logs = useRef(new Map<string, HTMLOListElement>());
  useEffect(() => {
    logs.current.forEach((log) => {
      log.scrollTop = log.scrollHeight;
    });
  }, [latest]);
  return (
    <div className="worker-tiles" aria-label="Robot head camera views">
      {Object.values(scenario.robots).map((robot, i) => {
        const task = Object.values(scenario.tasks).find(
          (t) => t.robot === robot.id,
        );
        const last = latest[robot.id];
        const history = steps.filter(
          (s) => s.robot === robot.id && s.step <= (last?.step ?? 0),
        );
        return (
          <section
            className="worker-tile"
            key={robot.id}
            aria-label={`${brainVersion == null ? "" : `Brain v${brainVersion} · `}${ROBOT_NAMES[i]} camera and actions`}
          >
            <div className="worker-camera-label">
              <span className={`robot-tab-dot ${ROBOT_COLORS[i]}`} />
              {brainVersion != null && `v${brainVersion} · `}R0{i + 1} ·{" "}
              {ROBOT_NAMES[i]} <span>HEAD CAMERA</span>
            </div>
            <div className="worker-info">
              <strong>
                {task
                  ? `${task.type} · ${task.source} → ${task.target}`
                  : "No task assigned"}
              </strong>
              <small>
                {last?.nearest_shopper_distance_m != null
                  ? `Nearest shopper ${last.nearest_shopper_distance_m.toFixed(2)} m`
                  : "Shopper distance appears with each action"}
              </small>
              <ol
                ref={(node) => {
                  if (node) logs.current.set(robot.id, node);
                  else logs.current.delete(robot.id);
                }}
                aria-label={`${brainVersion == null ? "" : `Brain v${brainVersion} · `}${ROBOT_NAMES[i]} action log`}
              >
                {history.map((step) => (
                  <li key={step.step} className={step.ok ? "" : "refused-step"}>
                    <span>{String(step.step).padStart(2, "0")}</span>
                    <strong>{step.action}</strong>
                    <span>{step.reason}</span>
                  </li>
                ))}
                {!history.length && (
                  <li>Waiting for the worker's first action…</li>
                )}
              </ol>
            </div>
          </section>
        );
      })}
    </div>
  );
}
