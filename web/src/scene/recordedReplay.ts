import {
  shopperPosition,
  type Point,
  type Scenario,
  type TrajectoryStep,
} from "../../../engine/store.ts";

/** Recorded facts only. No scenario generation, physical actions, network or inference. */
export function recordedStateAt(
  initial: Scenario,
  steps: TrajectoryStep[],
  time: number,
): Scenario {
  const state = structuredClone(initial);
  state.trajectory = [];
  const end = Math.max(initial.t, steps.at(-1)?.t ?? initial.t);
  state.t = Math.max(initial.t, Math.min(time, end));
  for (const step of steps) {
    if (step.t > state.t) break;
    state.robots[step.robot] = structuredClone(step.robot_state);
    if (step.item_state)
      state.items[step.item_state.id] = structuredClone(step.item_state);
    else if (
      step.ok &&
      step.action === "grasp" &&
      step.holding &&
      state.items[step.holding]
    )
      state.items[step.holding].slot = `holding:${step.robot}`;
    else if (
      step.ok &&
      step.action === "place" &&
      step.item_id &&
      state.items[step.item_id]
    )
      state.items[step.item_id].slot = String(step.args.target);
    if (step.ok && step.action === "report_issue")
      state.issues.push({
        robot: step.robot,
        t: Math.round((step.t - step.duration) * 1000) / 1000,
        kind: String(step.args.kind),
        detail: String(step.args.detail),
      });
    state.trajectory.push(structuredClone(step));
  }
  for (const shopper of Object.values(state.shoppers))
    Object.assign(shopper, shopperPosition(shopper, state.t));
  // Action-boundary shopper facts take precedence over presentation interpolation.
  const exact = state.trajectory.at(-1);
  if (exact?.t === state.t)
    for (const p of exact.shoppers ?? [])
      if (state.shoppers[p.id]) Object.assign(state.shoppers[p.id], p);
  return state;
}

export function replayCursor(steps: TrajectoryStep[], time: number) {
  let index = -1;
  while (index + 1 < steps.length && steps[index + 1].t <= time) index++;
  const next = steps[index + 1];
  // The engine rounds its cumulative clock to milliseconds. Raw duration can have more precision.
  const start = next
    ? (steps[index]?.t ?? Math.round((next.t - next.duration) * 1000) / 1000)
    : time;
  const progress = next
    ? Math.max(0, Math.min(1, (time - start) / Math.max(next.t - start, 0.001)))
    : 0;
  return { index, next, progress };
}

export function sampleRecordedPath(
  points: Point[],
  fraction: number,
): Point & { heading: number } {
  if (!points.length) return { x: 0, y: 0, heading: 0 };
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left =
    Math.max(0, Math.min(1, fraction)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const a = points[i],
        b = points[i + 1],
        p = lengths[i] ? left / lengths[i] : 1;
      return {
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
        heading: Math.atan2(b.x - a.x, b.y - a.y),
      };
    }
    left -= lengths[i];
  }
  return { ...points[0], heading: 0 };
}

export function replayBoundaries(
  recordings: { trajectory: TrajectoryStep[] }[],
) {
  return [
    ...new Set([0, ...recordings.flatMap((r) => r.trajectory.map((s) => s.t))]),
  ].sort((a, b) => a - b);
}
