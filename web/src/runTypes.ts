import type { Task, TaskScore, TrajectoryStep } from "../../engine/store.ts";
import type { GateInfo, LlmUsage, ReviewInfo, RunSource } from "./api.ts";

/** GET /runs: saved training shifts, newest first. Read-only; never starts a shift, review or gate. */
export interface RunSummary {
  shift_id: string;
  status: "running" | "done" | "error";
  seed: number;
  brain_version: number;
  worker?: "llm" | "compiled";
  tasks: Task[];
  scores: TaskScore[];
  llm: LlmUsage;
  started_at?: string;
  finished_at?: string | null;
  trial_id: string | null;
  replay_available: boolean;
  /** null: no review was ever made for this shift. */
  review_status: string | null;
  gate_ids: string[];
  source?: RunSource;
}

export interface ShiftRecord {
  shift_id: string;
  seed: number;
  brain_version: number;
  worker?: "llm" | "compiled";
  status: "running" | "done" | "error";
  error?: string;
  started_at?: string;
  finished_at?: string;
  tasks: Task[];
  scores: TaskScore[];
  llm: LlmUsage;
  trajectory: TrajectoryStep[];
  trial_id?: string;
  source?: RunSource;
}

/** GET /runs/:id: the stored shift, its saved review (or null) and the actual gates made from it. */
export interface RunDetail {
  shift: ShiftRecord;
  review: ReviewInfo | null;
  gates: GateInfo[];
}
