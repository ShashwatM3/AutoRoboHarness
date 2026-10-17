import type { Task, TaskScore, TrajectoryStep } from "../../engine/store.ts";

export interface TaskSpec {
  type: "PICK" | "RESTOCK";
  slot: string;
}
export interface LlmUsage {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens?: number;
  cache_share?: number | null;
  replayed?: number;
  crusoe_cache?: { calls_reporting: number; prompt_tokens: number; cached_tokens: number };
}
export interface ShiftInfo {
  shift_id: string;
  status: "running" | "done" | "error";
  error?: string;
  seed: number;
  brain_version: number;
  tasks: Task[];
  scores: TaskScore[];
  cache_share?: number | null;
  llm: LlmUsage;
}
export interface ShiftStep extends TrajectoryStep {
  shift_id: string;
  seed: number;
  brain_version: number;
}
export interface BrainNode {
  id: string;
  type: string;
  label: string;
  props: Record<string, unknown>;
}
export interface BrainEdge {
  from: string;
  to: string;
  type: string;
}
export interface BrainGraphData {
  version: number;
  nodes: BrainNode[];
  edges: BrainEdge[];
}
export interface BrainDiff {
  from: number;
  to: number;
  added_nodes: BrainNode[];
  retired_nodes: BrainNode[];
  changed: { id: string; key: string; from: unknown; to: unknown }[];
  added_edges: BrainEdge[];
  removed_edges: BrainEdge[];
}
export interface GateScore {
  tasks: number;
  complete: number;
  complete_rate: number;
  refused_per_task: number;
  steps_per_task: number;
}
export interface GateInfo {
  gate_id: string;
  shift_id: string;
  status: "running" | "done" | "error";
  error?: string;
  base: number;
  candidate: number;
  seeds: number[];
  worker: "compiled" | "llm";
  progress: { done: number; total: number };
  verdict?: "promoted" | "rejected";
  reason?: string;
  base_score?: GateScore;
  candidate_score?: GateScore;
  delta?: number;
  diff: BrainDiff;
  cache_share?: number | null;
  llm: LlmUsage;
}
export type Grounding =
  | {
      kind: "clip";
      clip_id: string;
      note?: string;
      frames?: string[];
      sheet?: string;
      description?: string;
      verified: boolean;
      judge_supports?: boolean;
    }
  | {
      kind: "run_contrast";
      ok_run: string;
      failed_run: string;
      note?: string;
      verified: boolean;
      judge_supports?: boolean;
    }
  | {
      kind: "citation";
      source_id: string;
      url?: string;
      title?: string;
      snippet?: string;
      note?: string;
      verified: boolean;
      judge_supports?: boolean;
    };
export interface JudgeVerdict { keep: boolean; why: string }
export interface Citation { source_id?: string; url: string; title?: string; snippet?: string; note?: string; judge_supports?: boolean }
export interface ReviewInfo {
  llm?: LlmUsage;
  judge?: { model: string; kept: string[]; dropped: { id: string; why: string }[]; error?: string };
  shift_id: string;
  status: "running" | "done" | "error";
  error?: string;
  brain_version: number;
  model?: string;
  failures: {
    id: string;
    robot: string;
    task_id: string;
    step: number;
    check: string;
    nodes_in_effect: string[];
    cause: string;
    verified: boolean;
    judge?: JudgeVerdict;
  }[];
  insights: {
    id: string;
    claim: string;
    addresses: string[];
    grounding: Grounding[];
    verified: boolean;
    judge?: JudgeVerdict;
    citations?: Citation[];
  }[];
  updates: {
    id: string;
    summary: string;
    ops: Record<string, unknown>[];
    compiled: Record<string, unknown>[];
    valid: boolean;
    errors: string[];
    touches_guardrail: boolean;
    judge_supported?: boolean;
  }[];
  detected: {
    refused_steps: {
      robot: string;
      step: number;
      action: string;
      reason: string;
    }[];
    incomplete_tasks: unknown[];
  };
  tool_calls: { name: string; args: unknown }[];
}
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    let message = `Server returned ${response.status}`;
    try {
      message = (await response.json()).error ?? message;
    } catch {
      /* A proxy error may not be JSON. */
    }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
