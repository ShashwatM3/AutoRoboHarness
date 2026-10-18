import type { TrajectoryStep } from "../../engine/store.ts";
import { savedApi, type TaskSpec } from "./api.ts";
import { buildHash } from "./routes.ts";
import type { SavedTrial } from "./trialTypes.ts";

/** Full recordings for replay. Legacy records without a recorded starting scene are refused, never rebuilt. */
export async function loadRecordings(ids: string[]): Promise<SavedTrial[]> {
  const loaded = await Promise.all(
    ids.map((id) => savedApi<SavedTrial>(`/trials/${encodeURIComponent(id)}`)),
  );
  if (loaded.some((t) => !t.initial || !Array.isArray(t.trajectory)))
    throw new Error(
      "This legacy record has no complete recorded scene. No replay is available.",
    );
  if (
    loaded.length === 2 &&
    (loaded[0].seed !== loaded[1].seed ||
      loaded[0].brain_version === loaded[1].brain_version ||
      loaded[0].initial_sha256 !== loaded[1].initial_sha256 ||
      !loaded[0].provenance.evaluation_id ||
      loaded[0].provenance.evaluation_id !== loaded[1].provenance.evaluation_id)
  )
    throw new Error(
      "Synchronized playback requires two matched recordings from the same evaluation and starting scene.",
    );
  return loaded;
}

/** A matched comparison's settings, used to prefill Live trial. Launching still needs an explicit click. */
export interface ComparisonConfig {
  versions: [number, number];
  seeds: number[];
  tasks: TaskSpec[];
  max_speed_mps: number;
}
export interface ShiftConfig {
  seed: number;
  tasks: TaskSpec[];
  brain: number | "live";
}
export const COMPARISON_PREFILL = "autorobo-comparison-prefill";
export const SHIFT_PREFILL = "autorobo-shift-prefill";

export function readPrefill<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Middle of a recorded action, so a refusal is shown while it happens. */
export const stepMoment = (step: TrajectoryStep) =>
  Math.max(0, step.t - step.duration / 2);

/** Loads a training shift into Live trial, where its review can be started explicitly. */
export function openInLiveTrial(shiftId: string, stage = "review") {
  sessionStorage.setItem("autorobo-active-shift", shiftId);
  location.hash = buildHash("live", { stage });
}
