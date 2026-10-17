import type { Task, TaskScore, TrajectoryStep } from '../../engine/store.ts';

export interface TaskSpec { type: 'PICK' | 'RESTOCK'; slot: string }
export interface ShiftInfo {
  shift_id: string;
  status: 'running' | 'done' | 'error';
  error?: string;
  seed: number;
  brain_version: number;
  tasks: Task[];
  scores: TaskScore[];
  llm: { calls: number; prompt_tokens: number; completion_tokens: number };
}
export interface ShiftStep extends TrajectoryStep { shift_id: string; seed: number; brain_version: number }
export interface BrainNode { id: string; type: string; label: string; props: Record<string, unknown> }
export interface BrainEdge { from: string; to: string; type: string }
export interface BrainGraphData { version: number; nodes: BrainNode[]; edges: BrainEdge[] }
export type Grounding =
  | { kind: 'clip'; clip_id: string; note?: string; frames?: string[]; sheet?: string; description?: string; verified: boolean }
  | { kind: 'run_contrast'; ok_run: string; failed_run: string; note?: string; verified: boolean };
export interface ReviewInfo {
  shift_id: string;
  status: 'running' | 'done' | 'error';
  error?: string;
  brain_version: number;
  model?: string;
  failures: { id: string; robot: string; task_id: string; step: number; check: string; nodes_in_effect: string[]; cause: string; verified: boolean }[];
  insights: { id: string; claim: string; addresses: string[]; grounding: Grounding[]; verified: boolean }[];
  updates: { id: string; summary: string; ops: Record<string, unknown>[]; compiled: Record<string, unknown>[]; valid: boolean; errors: string[]; touches_guardrail: boolean }[];
  detected: { refused_steps: { robot: string; step: number; action: string; reason: string }[]; incomplete_tasks: unknown[] };
  tool_calls: { name: string; args: unknown }[];
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) {
    let message = `Server returned ${response.status}`;
    try { message = (await response.json()).error ?? message; } catch { /* A proxy error may not be JSON. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
