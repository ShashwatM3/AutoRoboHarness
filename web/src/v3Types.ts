import type { LlmUsage, ReviewInfo } from "./api.ts";
export interface AttackRun {
  adversary_id: string; status: string; error?: string; brain_version: number; seed: number;
  task: { type: string; slot: string }; worker: string; proposer: string; model: string | null;
  tried: number; broke: number; started_at: string; updated_at: string; llm: LlmUsage;
  attempts: { candidate: number; disturbance: { kind: string }; rationale: string; status: string; trial_id?: string; shift_id?: string; broken?: boolean; error?: string; successes?: number; tasks?: number; refusals?: number }[];
}
export const PIPELINE = ["collect", "scale", "export", "hf_publish", "upload", "job"] as const;
export type PipelineStep = typeof PIPELINE[number];
export interface TrainingRun {
  post_training_id: string; status: string; error?: string; brain_version: number; created_at: string; updated_at: string; llm: LlmUsage;
  steps: Record<PipelineStep, { status: string; error?: string; reason?: string; counts: Record<string, number> }>;
  collect: { tasks_accepted: number; rejected_total: number } | null;
  scale: { variants: { variant_id: string; factor: string; status: string; reason?: string; trial_id: string | null }[] } | null;
  dataset: { examples: number; episodes: number; files: Record<"chat" | "robot" | "manifest", { rows: number; bytes: number; sha256: string }> } | null;
  hf: { status: string; url?: string | null; error?: string };
  provider: {
    console_url: string; model: { id: string; model_name: string | null } | null;
    file: { state: string; id?: string }; job: { state: string; status?: string; id?: string; error?: string; provider?: { fine_tuned_model?: string | null; error?: { message?: string } | null } };
    metrics: { metric_name: string; data: { x: number; value: number }[] }[];
    checkpoints: { id: string | null; step_number: number | null; metrics: Record<string, number> }[];
    events: { id: string | null; message: string | null; level: string | null }[];
    poll_error: string | null; last_polled_at: string | null;
  };
}
export interface TrainingSource { trial_id: string; shift_id: string | null; seed: number; brain_version: number; worker: string; steps: number; task: string }
export type AttackReview = { review: ReviewInfo | null };
