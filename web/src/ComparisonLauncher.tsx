import { useEffect, useMemo, useState } from "react";
import { ArrowRight, LoaderCircle, Play } from "lucide-react";
import { createScenario } from "../../engine/store.ts";
import { api, type TaskSpec } from "./api.ts";
import type { VersionIndex } from "./BrainExplorer.tsx";
import type { ComparisonConfig } from "./recordings.ts";
import { MODELS } from "./providers.ts";

const DEFAULT_SLOTS = ["A-1-3-1", "A-2-1-1", "B-1-1-1", "B-2-1-2"];
const ALL_HELDOUT = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];

/** Stage 1 for a matched comparison: two historical brains on identical held-out worlds. Makes model calls. */
export default function ComparisonLauncher({
  versions,
  prefill,
  disabled,
  onLaunched,
}: {
  versions: VersionIndex | null;
  prefill?: ComparisonConfig | null;
  disabled?: boolean;
  onLaunched: (comparisonId: string) => void;
}) {
  const [left, setLeft] = useState(prefill?.versions[0] ?? 4),
    [right, setRight] = useState(prefill?.versions[1] ?? 5);
  const [tasks, setTasks] = useState<TaskSpec[]>(
    prefill?.tasks.map(({ type, slot }) => ({ type, slot })) ?? [
      { type: "PICK", slot: "A-1-3-1" },
    ],
  );
  const [seeds, setSeeds] = useState<number[]>(prefill?.seeds ?? ALL_HELDOUT);
  const [maxSpeed, setMaxSpeed] = useState(prefill?.max_speed_mps ?? 0.8);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slots = useMemo(
    () =>
      Object.values(createScenario(1, 1).layout.slots).filter(
        (slot) => slot.aisle !== "backroom",
      ),
    [],
  );
  useEffect(() => {
    if (!versions || prefill) return;
    const available = versions.versions.filter((v) => v.available !== false);
    if (!available.some((v) => v.v === left))
      setLeft(available[0]?.v ?? left);
    if (!available.some((v) => v.v === right))
      setRight(
        available.find((v) => v.v === versions.live)?.v ??
          available.at(-1)?.v ??
          right,
      );
  }, [versions]);
  const launch = async () => {
    setLaunching(true);
    setError(null);
    try {
      if (!seeds.length) throw new Error("Choose at least one held-out seed.");
      if (left === right)
        throw new Error("Choose two different brain versions.");
      const c = await api<{ comparison_id: string }>("/comparisons", {
        method: "POST",
        body: JSON.stringify({
          versions: [left, right],
          seeds: [...seeds].sort((a, b) => a - b),
          tasks,
          worker: "llm",
          environment: { max_speed_mps: maxSpeed },
        }),
      });
      onLaunched(c.comparison_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(false);
    }
  };
  const picker = (n: number, change: (n: number) => void, label: string) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={n}
        disabled={launching}
        onChange={(e) => change(Number(e.target.value))}
      >
        {versions?.versions.map((v) => (
          <option key={v.v} value={v.v} disabled={v.available === false}>
            v{v.v}
            {versions.live === v.v ? " · live" : ""} · {v.status}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="launch-card comparison-launch">
      <div className="section-title">
        MATCHED COMPARISON<span>01</span>
      </div>
      <h2>Two brains. Identical worlds.</h2>
      <p className="launch-intro">
        Both brains receive the same held-out seeds, task specifications, robot
        count, shoppers and environment. Neither brain is promoted or changed.
      </p>
      {prefill && (
        <p className="inline-notice" role="status">
          Loaded from a saved comparison. Review the settings, then launch a new
          run.
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-row">
        {picker(left, setLeft, "First brain")}
        {picker(right, setRight, "Second brain")}
      </div>
      <div className="form-row">
        <label>
          Robots
          <select
            aria-label="Comparison robot count"
            value={tasks.length}
            disabled={launching}
            onChange={(e) =>
              setTasks((ts) =>
                Array.from(
                  { length: Number(e.target.value) },
                  (_, i) => ts[i] ?? { type: "PICK", slot: DEFAULT_SLOTS[i] },
                ),
              )
            }
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} robot{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Maximum speed (m/s)
          <input
            type="number"
            min="0.1"
            max="0.8"
            step="0.1"
            value={maxSpeed}
            disabled={launching}
            onChange={(e) => setMaxSpeed(Number(e.target.value))}
          />
        </label>
      </div>
      {tasks.map((t, i) => (
        <div className="task-form" key={i}>
          <div className="task-form-title">R0{i + 1}</div>
          <label>
            Task
            <select
              aria-label={`Comparison robot ${i + 1} task`}
              value={t.type}
              disabled={launching}
              onChange={(e) =>
                setTasks((ts) =>
                  ts.map((r, j) =>
                    j === i
                      ? { ...r, type: e.target.value as TaskSpec["type"] }
                      : r,
                  ),
                )
              }
            >
              <option value="PICK">PICK · Shelf to tote</option>
              <option value="RESTOCK">RESTOCK · Backroom to shelf</option>
            </select>
          </label>
          <label>
            Shelf slot
            <select
              aria-label={`Comparison robot ${i + 1} slot`}
              value={t.slot}
              disabled={launching}
              onChange={(e) =>
                setTasks((ts) =>
                  ts.map((r, j) =>
                    j === i ? { ...r, slot: e.target.value } : r,
                  ),
                )
              }
            >
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.id} · Level {slot.level}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}
      <fieldset className="seed-picker">
        <legend>Held-out seeds</legend>
        {ALL_HELDOUT.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={seeds.includes(s)}
              disabled={launching}
              onChange={(e) =>
                setSeeds((list) =>
                  e.target.checked
                    ? [...list, s]
                    : list.filter((n) => n !== s),
                )
              }
            />
            {s}
          </label>
        ))}
      </fieldset>
      <button
        className="launch-button"
        disabled={disabled || launching || !versions || left === right}
        onClick={() => void launch()}
      >
        {launching ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Play size={13} fill="currentColor" />
        )}{" "}
        {launching ? "Starting comparison…" : "Run new comparison"}
        <ArrowRight size={15} />
      </button>
      <p className="launch-footnote">
        Makes model calls with {MODELS.worker} on Crusoe, two task runs per
        seed; the recorded ten-seed run <code>cmp-mvd0u3kl-2</code> used 147
        responses. Only one inference job runs at a time on the shared quota. Success requires delivery with zero refused actions. A task
        unavailable at its slot uses a recorded equivalent slot for both brains.
      </p>
    </section>
  );
}
