import type {
  Scenario,
  Task,
  TaskScore,
  TrajectoryStep,
} from "../../engine/store.ts";
import type { LlmUsage, TaskSpec } from "./api.ts";

export interface SavedTrial {
  trial_id: string;
  brain_version: number;
  seed: number;
  partition: "training" | "heldout";
  status: "running" | "done" | "error" | "interrupted";
  worker: "llm" | "compiled";
  error?: string;
  started_at: string;
  provenance: {
    comparison_id?: string;
    evaluation_id?: string;
    shift_id?: string;
    gate_id?: string;
  };
  tasks: Task[];
  requested_tasks: TaskSpec[];
  task_selection: {
    index: number;
    requested: TaskSpec;
    actual: TaskSpec | null;
    substituted: boolean;
    note?: string;
    robot: string | null;
    task_id: string | null;
  }[];
  scores: TaskScore[];
  initial: Scenario;
  initial_sha256: string;
  final?: Omit<Scenario, "trajectory"> | null;
  trajectory: TrajectoryStep[];
  llm: LlmUsage;
  environment: { max_speed_mps: number };
}
export interface ComparisonScore {
  version: number;
  successes: number;
  expected_tasks: number;
  success_rate: number;
  evaluated_tasks: number;
  complete: boolean;
  infeasible_tasks: number;
  trial_ids: string[];
}
export interface SavedComparison {
  comparison_id: string;
  status: "running" | "done" | "error" | "interrupted";
  error?: string;
  versions: [number, number];
  seeds: number[];
  tasks: TaskSpec[];
  worker: "llm" | "compiled";
  started_at: string;
  finished_at?: string;
  progress: { pairs_done: number; pairs_total: number };
  aggregates: ComparisonScore[];
  per_seed: {
    seed: number;
    task_selection: SavedTrial["task_selection"];
    pairs: {
      version: number;
      status: string;
      trial_id: string | null;
      task_scores: TaskScore[];
    }[];
  }[];
  environment: { max_speed_mps: number };
  llm: LlmUsage;
}
