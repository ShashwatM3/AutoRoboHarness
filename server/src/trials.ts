// Trials (V2 extension): a persistent, replayable recording of one engine run with one brain version. Shifts,
// gates and comparisons all run through prepareTrial/executeTrial. A trial is saved atomically when it is created
// (with the initial world), after every engine action (refused ones too), and at the end (scores, final world).
// Held-out trials live in their own folder: they are never shifts, so the supervisor cannot see them.

import fs from "node:fs";
import path from "node:path";
import { createScenario, StoreEngine, type Scenario, type TaskScore, type TrajectoryStep } from "../../engine/store.ts";
import type { BrainStore } from "./brain.ts";
import { newTally, type LlmTally } from "./llm.ts";
import { canonicalJson, dataDir, readJsonDir, safeId, sha256, writeJsonAtomic } from "./paths.ts";
import { taskCard, type RunCtx, type Shift, type TaskSpec } from "./worker.ts";

export type Partition = "training" | "heldout";
export type TrialStatus = "running" | "done" | "error" | "interrupted";
export type TrialKind = "shift" | "gate" | "comparison";
export type WorkerKind = "llm" | "compiled";

export const ENGINE_DEFAULT_MAX_SPEED = 0.8;
export const HELDOUT_SEEDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
export const TRAINING_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

export interface TaskSelection {
  index: number; // position in the requested task list
  requested: TaskSpec;
  actual: TaskSpec | null; // null: no feasible slot in this seed, recorded as a failed task, never dropped
  substituted: boolean;
  note?: string;
  robot: string | null;
  task_id: string | null;
}

export interface TrialEnvironment {
  max_speed_mps: number; // what the engine enforced
  requested_max_speed_mps: number | null;
  guardrail_max_speed_mps: number | null;
  engine_default_max_speed_mps: number;
}

export interface TrialProvenance {
  shift_id?: string;
  gate_id?: string;
  comparison_id?: string;
  evaluation_id?: string;
  role?: "base" | "candidate" | "a" | "b";
}

export type TrialTask = Shift["tasks"][number];

export interface TrialRecord {
  trial_id: string;
  kind: TrialKind;
  partition: Partition;
  status: TrialStatus;
  error?: string;
  seed: number;
  brain_version: number;
  brain_sha256: string;
  worker: WorkerKind;
  robot_count: number;
  environment: TrialEnvironment;
  provenance: TrialProvenance;
  requested_tasks: TaskSpec[];
  task_selection: TaskSelection[];
  tasks: TrialTask[];
  initial_sha256: string;
  scores: TaskScore[];
  steps: number;
  llm: LlmTally;
  started_at: string;
  updated_at: string;
  finished_at?: string;
  replay_available: true;
  initial: Scenario;
  trajectory: TrajectoryStep[];
  final: Omit<Scenario, "trajectory"> | null;
}

export type TrialSummary = Omit<TrialRecord, "initial" | "trajectory" | "final">;

const trialsDir = (partition: Partition) => dataDir("trials", partition);
const now = () => new Date().toISOString();
let idCounter = 0;
const newTrialId = () => `trial-${Date.now().toString(36)}-${(++idCounter).toString(36)}`;

// ---------- which task actually runs in a seed ----------

/** Whether a task can be done in a seed's world: not a PICK whose item is in reserve, not a RESTOCK into a
 *  slot that is already stocked. */
function feasible(s: Scenario, type: TaskSpec["type"], slot: string): boolean {
  if (type === "RESTOCK") return !Object.values(s.items).some((i) => i.slot === slot);
  return !s.items[`item:${slot}`]?.slot.startsWith("reserve:");
}

/** The task as given if it can be done in this seed; otherwise the nearest slot of the same type on the same
 *  aisle and shelf level (same difficulty). Null if there is none. */
export function taskForSeed(seed: number, t: TaskSpec): { task: TaskSpec; note?: string } | null {
  const s = createScenario(seed, 1);
  if (feasible(s, t.type, t.slot)) return { task: { type: t.type, slot: t.slot } };
  const [aisle, bay, level, pos] = t.slot.split("-");
  const options = Object.values(s.layout.slots)
    .filter((x) => x.aisle === aisle && String(x.level) === level && x.id !== t.slot && feasible(s, t.type, x.id))
    .sort((a, b) => Math.abs(a.bay - Number(bay)) - Math.abs(b.bay - Number(bay)) || Math.abs(a.position - Number(pos)) - Math.abs(b.position - Number(pos)));
  if (!options.length) return null;
  return { task: { type: t.type, slot: options[0].id }, note: `${t.type} ${t.slot} -> ${options[0].id} (${t.type === "RESTOCK" ? "slot already stocked" : "item in reserve"} in seed ${seed})` };
}

/** One selection per requested task, applied once per seed so every brain version gets exactly the same tasks,
 *  robots and task ids. Robot i keeps its slot in the world even when its task is infeasible (it stays idle). */
export function selectTasks(seed: number, requested: TaskSpec[], idPrefix: string): TaskSelection[] {
  return requested.map((t, i) => {
    const robot = t.robot ?? `robot-${i + 1}`;
    const r = taskForSeed(seed, t);
    if (!r) return { index: i, requested: t, actual: null, substituted: false, note: `${t.type} ${t.slot}: no feasible slot on that aisle and level in seed ${seed}`, robot: null, task_id: null };
    return { index: i, requested: t, actual: { ...r.task, robot }, substituted: r.task.slot !== t.slot, ...(r.note ? { note: r.note } : {}), robot, task_id: `${idPrefix}-t${i + 1}` };
  });
}

/** A shift runs its tasks exactly as requested (an impossible task is the caller's 400). */
export function exactSelection(requested: TaskSpec[], idPrefix: string): TaskSelection[] {
  return requested.map((t, i) => {
    const robot = t.robot ?? `robot-${i + 1}`;
    return { index: i, requested: t, actual: { type: t.type, slot: t.slot, robot }, substituted: false, robot, task_id: `${idPrefix}-t${i + 1}` };
  });
}

/** The speed limit a brain's guardrail sets, or null when it has none. */
export function guardrailSpeed(brain: BrainStore, v: number): number | null {
  const g = brain.resolve(v, "store").guardrails.find((n) => n.props.param === "max_speed_mps");
  return g ? Number(g.props.value) : null;
}

// ---------- recording ----------

export interface TrialInput {
  kind: TrialKind;
  partition: Partition;
  seed: number;
  version: number;
  worker: WorkerKind;
  run_id: string; // what workers see as their run id (task ids come from the selection)
  requested_tasks: TaskSpec[];
  selection: TaskSelection[];
  robot_count: number;
  environment: TrialEnvironment;
  provenance: TrialProvenance;
  headless: boolean;
  llm?: LlmTally; // share a tally (a shift's); default: the trial's own
  onStep?: (step: TrajectoryStep) => void; // extra hook (a shift's event stream)
}

export interface PreparedTrial {
  record: TrialRecord;
  engine: StoreEngine;
  tasks: TrialTask[];
  ctx: RunCtx;
}

export type Runner = (brain: BrainStore, engine: StoreEngine, ctx: RunCtx, task: TrialTask) => Promise<void>;

function persist(r: TrialRecord) {
  writeJsonAtomic(path.join(trialsDir(r.partition), `${r.trial_id}.json`), r);
}

/** Build the world, create the tasks and save the trial with its initial world. Throws (nothing saved) if a task
 *  cannot be created. */
export function prepareTrial(brain: BrainStore, input: TrialInput): PreparedTrial {
  let record: TrialRecord | null = null;
  const engine = new StoreEngine(createScenario(input.seed, input.robot_count), {
    maxSpeed: input.environment.max_speed_mps,
    onStep: (step) => {
      input.onStep?.(step);
      if (!record) return;
      record.trajectory.push(step);
      record.steps = record.trajectory.length;
      record.updated_at = now();
      persist(record);
    },
  });
  const tasks = input.selection
    .filter((s) => s.actual)
    .map((s) => {
      const task = engine.createTask(s.robot!, s.actual!.type, s.actual!.slot, s.task_id!);
      return { ...task, card: taskCard(engine, task) };
    });
  const initial = engine.snapshot();
  const t0 = now();
  record = {
    trial_id: newTrialId(),
    kind: input.kind,
    partition: input.partition,
    status: "running",
    seed: input.seed,
    brain_version: input.version,
    brain_sha256: brain.fileSha256(input.version),
    worker: input.worker,
    robot_count: input.robot_count,
    environment: input.environment,
    provenance: input.provenance,
    requested_tasks: input.requested_tasks,
    task_selection: input.selection,
    tasks,
    initial_sha256: sha256(canonicalJson(initial)),
    scores: [],
    steps: 0,
    llm: input.llm ?? newTally(),
    started_at: t0,
    updated_at: t0,
    replay_available: true,
    initial,
    trajectory: [],
    final: null,
  };
  persist(record);
  return { record, engine, tasks, ctx: { shift_id: input.run_id, brain_version: input.version, llm: record.llm, headless: input.headless } };
}

/** Run every robot of a prepared trial in parallel and save the result. Never throws: a failed robot makes the
 *  trial `error` (after all robots have stopped, so no worker keeps spending quota), and the error is returned. */
export async function executeTrial(brain: BrainStore, p: PreparedTrial, runner: Runner, onTaskDone?: () => void): Promise<{ trial: TrialRecord; error?: unknown }> {
  const results = await Promise.allSettled(p.tasks.map((t) => runner(brain, p.engine, p.ctx, t).finally(() => onTaskDone?.())));
  const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  finishTrial(p, failed ? "error" : "done", failed?.reason);
  return { trial: p.record, error: failed?.reason };
}

export function finishTrial(p: PreparedTrial, status: "done" | "error", error?: unknown) {
  const { trajectory, ...final } = p.engine.snapshot();
  p.record.trajectory = trajectory; // the engine's own record is authoritative
  p.record.steps = trajectory.length;
  p.record.final = final;
  p.record.scores = p.engine.score();
  p.record.status = status;
  if (status === "error") p.record.error = String((error as any)?.message ?? error ?? "error");
  p.record.finished_at = p.record.updated_at = now();
  persist(p.record);
}

// ---------- reading ----------

export function getTrial(id: string): TrialRecord | undefined {
  const tid = safeId(id, "trial_id");
  for (const part of ["training", "heldout"] as const) {
    const f = path.join(trialsDir(part), `${tid}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  }
  return undefined;
}

export interface TrialFilter {
  partition?: string;
  kind?: string;
  status?: string;
  shift_id?: string;
  gate_id?: string;
  comparison_id?: string;
}

export function summarize(r: TrialRecord): TrialSummary {
  const { initial: _i, trajectory: _t, final: _f, ...rest } = r;
  return rest;
}

export function listTrials(f: TrialFilter = {}): TrialSummary[] {
  const parts: Partition[] = f.partition === "training" || f.partition === "heldout" ? [f.partition] : ["training", "heldout"];
  return parts
    .flatMap((p) => readJsonDir<TrialRecord>(trialsDir(p)))
    .filter((r) => (!f.kind || r.kind === f.kind) && (!f.status || r.status === f.status))
    .filter((r) => (!f.shift_id || r.provenance.shift_id === f.shift_id) && (!f.gate_id || r.provenance.gate_id === f.gate_id) && (!f.comparison_id || r.provenance.comparison_id === f.comparison_id))
    .map(summarize)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}

/** On server start: a trial still marked running was cut off by a restart. Record that; never resume it. */
export function recoverInterruptedTrials(): string[] {
  const fixed: string[] = [];
  for (const part of ["training", "heldout"] as const)
    for (const r of readJsonDir<TrialRecord>(trialsDir(part))) {
      if (r.status !== "running") continue;
      r.status = "interrupted";
      r.error = "the server stopped while this run was in progress; it was not resumed";
      r.finished_at = r.updated_at = now();
      persist(r);
      fixed.push(r.trial_id);
    }
  return fixed;
}
