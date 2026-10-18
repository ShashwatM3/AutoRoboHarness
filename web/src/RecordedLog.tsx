import { useEffect, useState } from "react";
import { SkipBack, SkipForward } from "lucide-react";
import type { TrajectoryStep } from "../../engine/store.ts";
import { savedApi, type BrainGraphData } from "./api.ts";
import BrainGraph from "./BrainGraph.tsx";
import { RobotLogs } from "./SavedReplay.tsx";

/**
 * A run saved before full recordings existed: its actual action log and the brain nodes each action read.
 * There is no recorded starting scene, so no 3D replay is shown or reconstructed.
 */
export default function RecordedLog({
  steps,
  brainVersion,
  focus,
}: {
  steps: TrajectoryStep[];
  brainVersion: number;
  focus?: { robot: string; step: number; key: number } | null;
}) {
  const [index, setIndex] = useState(steps.length ? steps.length - 1 : -1);
  const [graph, setGraph] = useState<BrainGraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    savedApi<BrainGraphData>(`/brain?v=${brainVersion}`)
      .then((g) => active && setGraph(g))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [brainVersion]);
  useEffect(() => {
    if (!focus) return;
    const i = steps.findIndex(
      (s) => s.robot === focus.robot && s.step === focus.step,
    );
    if (i >= 0) setIndex(i);
  }, [focus?.key]);
  const current = steps[index];
  const robots = [...new Set(steps.map((s) => s.robot))].sort();
  return (
    <section className="research-card recorded-log" aria-label="Recorded action log">
      <div className="replay-heading">
        <div>
          <span className="recorded-badge">RECORDED ACTION LOG · NO SCENE REPLAY</span>
          <h2>What each robot did</h2>
          <p>
            This run predates full recordings: its starting scene was not saved,
            so the 3D store and head cameras are not reconstructed. The actions,
            refusals and brain reads below are the actual saved trajectory.
          </p>
        </div>
      </div>
      <div className="saved-playback-controls">
        <button
          aria-label="Previous recorded action"
          disabled={index <= 0}
          onClick={() => setIndex(index - 1)}
        >
          <SkipBack size={17} /> Back
        </button>
        <button
          aria-label="Next recorded action"
          disabled={index >= steps.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          Step <SkipForward size={17} />
        </button>
        <output>
          {current
            ? `Action ${index + 1} of ${steps.length} · ${current.robot} step ${current.step} · ${current.t.toFixed(2)} s simulated`
            : "No recorded actions"}
        </output>
      </div>
      {current && (
        <p className={`replay-current ${current.ok ? "" : "refused-line"}`}>
          {current.robot} · {current.action}({JSON.stringify(current.args)}) ·{" "}
          {current.ok ? current.reason : `REFUSED: ${current.reason}`}
          {current.nearest_shopper_distance_m != null &&
            ` · nearest shopper ${current.nearest_shopper_distance_m.toFixed(2)} m`}
        </p>
      )}
      <RobotLogs
        steps={steps}
        robots={robots}
        current={current}
        onSeek={(s) => setIndex(steps.indexOf(s))}
        label="Recorded action logs"
      />
      <div className="replay-graph">
        <div className="replay-graph-heading">
          <div>
            <h3>Brain nodes read by the selected action</h3>
            <p>
              {current
                ? `${current.robot} step ${current.step} read ${current.brain_nodes_read.length} nodes from brain v${brainVersion}.`
                : "Choose an action."}
            </p>
          </div>
        </div>
        <BrainGraph
          data={graph}
          error={error}
          readIds={current?.brain_nodes_read ?? []}
          epoch={index}
        />
      </div>
    </section>
  );
}
