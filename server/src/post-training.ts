// Post-training (V3, Person B): POST /post-training collects verified training decisions, multiplies the best tasks
// with one-factor variants played by the chosen brain, exports a Crusoe chat file and a LeRobot-style copy, then, if
// asked, uploads the chat file and creates one supervised LoRA job on Lightning. Each step is saved when it starts
// and ends with its real counts. A restart marks an unfinished run interrupted; an upload or a job create is never
// sent twice, and an answer that never arrived is recorded as unknown and settled only by looking it up.
// Nothing here promotes a brain or deploys the fine-tuned model.

import fs from "node:fs";
import path from "node:path";
import type { Router } from "express";
import type { TaskScore } from "../../engine/store.ts";
import { httpError, type BrainStore } from "./brain.ts";
import * as crusoe from "./crusoe-finetune.ts";
import { emit } from "./events.ts";
import { claimInference } from "./inference-lock.ts";
import { mergeTally, newTally, type LlmTally } from "./llm.ts";
import { dataDir, safeId, sha256, writeJsonAtomic } from "./paths.ts";
import { runCompiled } from "./policy.ts";
import {
  buildDataset,
  checkVariant,
  collectTrainingTasks,
  pickParents,
  planVariants,
  validateTrial,
  type Change,
  type DecisionSource,
  type Rejection,
  type ValidatedTask,
  type VariantFactor,
  type VariantPlan,
} from "./post-training-data.ts";
import {
  ENGINE_DEFAULT_MAX_SPEED,
  exactSelection,
  executeTrial,
  finishTrial,
  getTrial,
  guardrailSpeed,
  listTrials,
  prepareTrial,
  type TrialEnvironment,
  type WorkerKind,
} from "./trials.ts";
import { runWorker } from "./worker.ts";

export const STEP_NAMES = ["collect", "scale", "export", "hf_publish", "upload", "job"] as const;
export type StepName = (typeof STEP_NAMES)[number];
export type StepStatus = "pending" | "started" | "completed" | "error" | "skipped";
export type RunStatus = "running" | "done" | "error" | "interrupted" | "cancelled";
export type VariantStatus = "rejected" | "pending" | "running" | "kept" | "failed" | "error" | "interrupted" | "not_run";
export type FileState = "not_started" | "submitting" | "uploaded" | "unknown" | "error";
export type JobState = "not_started" | "submitting" | "submitted" | "unknown" | "error";

export interface StepState {
  status: StepStatus;
  started_at: string | null;
  finished_at: string | null;
  error?: string;
  reason?: string;
  counts: Record<string, number>;
}

export interface PostTrainingRequest {
  shift_id: string | null;
  brain_version: number;
  worker: WorkerKind;
  upload: boolean;
  variants_per_task: number;
  max_tasks: number;
}

export interface TaskRef {
  trial_id: string;
  task_id: string;
  kind: string;
  seed: number;
  brain_version: number;
  worker: WorkerKind;
  decision_source: DecisionSource;
  type: "PICK" | "RESTOCK";
  source: string;
  target: string;
  item_id: string;
  steps: number;
  origin: "recorded" | "variant";
  variant_id?: string;
}

export interface VariantRecord {
  variant_id: string;
  parent_trial_id: string;
  parent_task_id: string;
  seed: number;
  factor: VariantFactor;
  task: { type: "PICK" | "RESTOCK"; slot: string } | null;
  changes: Change[];
  status: VariantStatus;
  reason?: string;
  trial_id: string | null;
  score: TaskScore | null;
  started_at?: string;
  finished_at?: string;
}

export interface FileRef {
  name: string;
  bytes: number;
  sha256: string;
  rows: number;
}

export interface PostTrainingRun {
  post_training_id: string;
  status: RunStatus;
  error?: string;
  request: PostTrainingRequest;
  brain_version: number;
  brain_sha256: string;
  created_at: string;
  updated_at: string;
  finished_at?: string;
  cancel_requested_at?: string;
  steps: Record<StepName, StepState>;
  collect: {
    trials_considered: number;
    tasks_accepted: number;
    accepted: TaskRef[];
    rejected: Rejection[];
    rejected_total: number;
    rejected_by_reason: Record<string, number>;
  } | null;
  scale: { parents: TaskRef[]; variants: VariantRecord[] } | null;
  dataset: {
    examples: number;
    episodes: number;
    by_source: Record<DecisionSource, number>;
    by_origin: { recorded: number; variant: number };
    files: { chat: FileRef; robot: FileRef; manifest: FileRef };
  } | null;
  hf: { status: "pending" | "not_configured" | "published" | "error"; repo?: string; commit?: string; url?: string | null; error?: string; local_files: string[] };
  provider: {
    base_url: string;
    console_url: string;
    model: crusoe.BaseModel | null;
    file: { state: FileState; id?: string; filename?: string; bytes?: number; sha256?: string; status?: string | null; submitted_at?: string; error?: string; reconciled_at?: string };
    job: {
      state: JobState;
      id?: string;
      suffix?: string;
      request?: { model: string; training_file: string; hyperparameters: crusoe.JobBody["method"]["supervised"]["hyperparameters"] };
      status?: string | null;
      submitted_at?: string;
      error?: string;
      reconciled_at?: string;
      provider?: crusoe.ProviderJob;
    };
    estimate: { estimated_price: string | null; currency: string | null } | null;
    estimate_error?: string;
    events: crusoe.ProviderEvent[];
    checkpoints: crusoe.ProviderCheckpoint[];
    metrics: crusoe.ProviderMetric[];
    last_polled_at: string | null;
    poll_error: string | null;
    cancel?: { requested_at: string; status?: string | null; error?: string };
  };
  llm: LlmTally;
}

export const DATASET_FILES = {
  chat: { file: "train.chat.jsonl", type: "application/x-ndjson" },
  robot: { file: "robot.steps.jsonl", type: "application/x-ndjson" },
  manifest: { file: "manifest.json", type: "application/json" },
} as const;
export const HYPERPARAMETERS = { n_epochs: 3, learning_rate: 0.0001 } as const;
const REFRESH_MIN_INTERVAL_MS = 5000;

const now = () => new Date().toISOString();
const runDir = (id: string) => dataDir("post-training", id);
const persist = (r: PostTrainingRun) => {
  r.updated_at = now();
  writeJsonAtomic(path.join(runDir(r.post_training_id), "run.json"), r);
};
const message = (e: unknown) => String((e as any)?.message ?? e ?? "error");
let idCounter = 0;

const live = new Map<string, PostTrainingRun>(); // runs whose pipeline is executing in this process
const cancelRequested = new Set<string>();
const refreshing = new Map<string, Promise<PostTrainingRun>>();

class Cancelled extends Error {
  constructor() {
    super("cancelled by request");
  }
}

function writeTextAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ---------- request ----------

const bad = (msg: string, field: string | null) => httpError(400, msg, { code: "bad_request", field });
const FIELDS = ["shift_id", "brain", "worker", "upload", "variants_per_task", "max_tasks"];

export function validateRequest(brain: BrainStore, body: unknown): PostTrainingRequest {
  if (body !== undefined && body !== null && (typeof body !== "object" || Array.isArray(body))) throw bad("the body must be a JSON object", null);
  const b = (body ?? {}) as Record<string, any>;
  const unknown = Object.keys(b).filter((k) => !FIELDS.includes(k));
  if (unknown.length) throw bad(`unknown field(s): ${unknown.join(", ")}`, unknown[0]);
  let shift_id: string | null = null;
  if (b.shift_id !== undefined && b.shift_id !== null) {
    shift_id = safeId(b.shift_id, "shift_id");
    if (!listTrials({ partition: "training", shift_id }).length) throw httpError(404, `shift ${shift_id} has no training recording`, { code: "no_shift_recording" });
  }
  if (b.brain !== undefined && b.brain !== "live" && !Number.isInteger(b.brain)) throw bad('brain must be a saved version number or "live"', "brain");
  const brain_version = brain.resolveVersion(b.brain);
  const worker = b.worker ?? "llm";
  if (worker !== "llm" && worker !== "compiled") throw bad('worker must be "llm" or "compiled"', "worker");
  const upload = b.upload ?? true;
  if (typeof upload !== "boolean") throw bad("upload must be true or false", "upload");
  const int = (k: string, def: number, lo: number, hi: number) => {
    const v = b[k] ?? def;
    if (!Number.isInteger(v) || v < lo || v > hi) throw bad(`${k} must be an integer from ${lo} to ${hi}`, k);
    return v as number;
  };
  return { shift_id, brain_version, worker, upload, variants_per_task: int("variants_per_task", 3, 0, 3), max_tasks: int("max_tasks", 2, 1, 4) };
}

function newRun(brain: BrainStore, request: PostTrainingRequest, id: string): PostTrainingRun {
  const t0 = now();
  const step = (): StepState => ({ status: "pending", started_at: null, finished_at: null, counts: {} });
  return {
    post_training_id: id,
    status: "running",
    request,
    brain_version: request.brain_version,
    brain_sha256: brain.fileSha256(request.brain_version),
    created_at: t0,
    updated_at: t0,
    steps: Object.fromEntries(STEP_NAMES.map((n) => [n, step()])) as Record<StepName, StepState>,
    collect: null,
    scale: null,
    dataset: null,
    hf: { status: "pending", local_files: [] },
    provider: {
      base_url: crusoe.trainingBaseUrl(),
      console_url: crusoe.CONSOLE_FINE_TUNING_URL,
      model: null,
      file: { state: "not_started" },
      job: { state: "not_started" },
      estimate: null,
      events: [],
      checkpoints: [],
      metrics: [],
      last_polled_at: null,
      poll_error: null,
    },
    llm: newTally(),
  };
}

/** POST /post-training: validate, record, and run the pipeline in the background. One run at a time. */
export function startPostTraining(brain: BrainStore, body: unknown): { run: PostTrainingRun; done: Promise<PostTrainingRun> } {
  const request = validateRequest(brain, body);
  const active = [...live.values()].find((r) => r.status === "running");
  if (active) throw httpError(409, `post-training ${active.post_training_id} is still running`, { code: "post_training_active", post_training_id: active.post_training_id });
  const id = `pt-${Date.now().toString(36)}-${(++idCounter).toString(36)}`;
  // Lightning is needed only to play variants; the claim is taken before anything is saved
  const release = request.worker === "llm" && request.variants_per_task > 0 ? claimInference("post-training", id) : () => {};
  let run: PostTrainingRun;
  try {
    run = newRun(brain, request, id);
    persist(run);
  } catch (e) {
    release();
    throw e;
  }
  live.set(id, run);
  const done = runPipeline(brain, run, release);
  return { run, done };
}

// ---------- the pipeline ----------

function progress(run: PostTrainingRun, step: StepName) {
  const s = run.steps[step];
  emit("post_training_progress", { post_training_id: run.post_training_id, step, status: s.status, counts: s.counts, ...(s.error ? { error: s.error } : {}) });
}

async function runStep<T>(run: PostTrainingRun, name: StepName, fn: (s: StepState) => T | Promise<T>): Promise<T> {
  if (cancelRequested.has(run.post_training_id)) throw new Cancelled();
  const s = run.steps[name];
  s.status = "started";
  s.started_at = now();
  persist(run);
  progress(run, name);
  try {
    const out = await fn(s);
    s.status = "completed";
    return out;
  } catch (e) {
    s.status = "error";
    s.error = message(e);
    throw e;
  } finally {
    s.finished_at = now();
    persist(run);
    progress(run, name);
  }
}

function skip(run: PostTrainingRun, name: StepName, reason: string) {
  const s = run.steps[name];
  if (s.status !== "pending") return;
  s.status = "skipped";
  s.reason = reason;
  s.finished_at = now();
  persist(run);
  progress(run, name);
}

const ref = (t: ValidatedTask): TaskRef => ({
  trial_id: t.trial_id,
  task_id: t.task.id,
  kind: t.kind,
  seed: t.seed,
  brain_version: t.brain_version,
  worker: t.worker,
  decision_source: t.decision_source,
  type: t.task.type,
  source: t.task.source,
  target: t.task.target,
  item_id: t.task.item_id,
  steps: t.steps.length,
  origin: t.variant ? "variant" : "recorded",
  ...(t.variant ? { variant_id: t.variant.variant_id } : {}),
});

async function runPipeline(brain: BrainStore, run: PostTrainingRun, release: () => void): Promise<PostTrainingRun> {
  const id = run.post_training_id;
  const tasks: ValidatedTask[] = [];
  let fatal: string | null = null;
  try {
    // 1. collect
    const collected = await runStep(run, "collect", (s) => {
      const c = collectTrainingTasks(brain, run.request.shift_id ? { shift_id: run.request.shift_id } : {});
      run.collect = { trials_considered: c.trials_considered, tasks_accepted: c.accepted.length, accepted: c.accepted.map(ref), rejected: c.rejected, rejected_total: c.rejected_total, rejected_by_reason: c.rejected_by_reason };
      s.counts = { trials_considered: c.trials_considered, tasks_accepted: c.accepted.length, tasks_rejected: c.rejected_total, actions: c.accepted.reduce((n, t) => n + t.steps.length, 0) };
      if (!c.accepted.length) throw new Error("no strict-success training task replayed exactly, so there is nothing to learn from");
      return c.accepted;
    });
    tasks.push(...collected);

    // 2. scale (a variant error stops the remaining variants; the verified tasks so far are still exported)
    if (run.request.variants_per_task === 0) skip(run, "scale", "variants_per_task is 0");
    else await runStep(run, "scale", (s) => runVariants(brain, run, collected, tasks, s)).catch((e) => {
      if (e instanceof Cancelled) throw e;
    });
    release(); // Lightning is no longer needed

    // 3. export
    await runStep(run, "export", (s) => exportDataset(brain, run, tasks, s));

    // 4. optional Hugging Face copy (its failure never blocks the Crusoe steps)
    if (!crusoe.hubConfig()) {
      run.hf = { status: "not_configured", local_files: [DATASET_FILES.robot.file, DATASET_FILES.manifest.file] };
      skip(run, "hf_publish", "HF_TOKEN and HF_DATASET_REPO are not set; the LeRobot-style copy is kept locally (GET /post-training/:id/dataset?format=robot)");
    } else await runStep(run, "hf_publish", (s) => publishCopy(run, s)).catch((e) => {
      if (e instanceof Cancelled) throw e;
    });

    // 5. upload and 6. job
    if (!run.request.upload) {
      skip(run, "upload", "upload: false in the request; the dataset stays local");
      skip(run, "job", "upload: false in the request; no job is created");
    } else {
      await runStep(run, "upload", (s) => upload(run, s));
      await runStep(run, "job", (s) => createJob(run, s));
    }
  } catch (e) {
    fatal = e instanceof Cancelled ? null : message(e);
  } finally {
    release();
    const cancelled = cancelRequested.has(id);
    const why = cancelled ? "not run: cancelled by request" : `not run: ${STEP_NAMES.find((n) => run.steps[n].status === "error") ?? "an earlier step"} failed`;
    for (const n of STEP_NAMES) skip(run, n, why);
    const errored = STEP_NAMES.filter((n) => run.steps[n].status === "error");
    run.status = cancelled ? "cancelled" : errored.length ? "error" : "done";
    if (errored.length) run.error = `${errored[0]}: ${run.steps[errored[0]].error}`;
    else if (fatal) run.error = fatal;
    run.finished_at = now();
    persist(run);
    live.delete(id);
    cancelRequested.delete(id);
    emit("post_training_done", { post_training_id: id, status: run.status, job_id: run.provider.job.id ?? null, job_state: run.provider.job.state });
  }
  return run;
}

function variantEnvironment(brain: BrainStore, v: number): TrialEnvironment {
  const guard = guardrailSpeed(brain, v);
  return { max_speed_mps: Math.min(guard ?? ENGINE_DEFAULT_MAX_SPEED, ENGINE_DEFAULT_MAX_SPEED), requested_max_speed_mps: null, guardrail_max_speed_mps: guard, engine_default_max_speed_mps: ENGINE_DEFAULT_MAX_SPEED };
}

function variantCounts(vs: VariantRecord[]) {
  const c: Record<string, number> = { planned: vs.length };
  for (const v of vs) c[v.status] = (c[v.status] ?? 0) + 1;
  return c;
}

/** Plan every variant first (so each rejection is recorded before any run), then play them one at a time. */
async function runVariants(brain: BrainStore, run: PostTrainingRun, collected: ValidatedTask[], out: ValidatedTask[], s: StepState) {
  const id = run.post_training_id;
  const parents = pickParents(collected, run.request.max_tasks);
  run.scale = { parents: parents.map(ref), variants: [] };
  const plans = new Map<string, { plan: VariantPlan; expected: string; prefix: string }>();
  parents.forEach((p, i) => {
    const { plans: ps, rejected } = planVariants(p, run.request.variants_per_task, `v${i + 1}`);
    for (const r of rejected)
      run.scale!.variants.push({ variant_id: `v${i + 1}-${r.factor}`, parent_trial_id: p.trial_id, parent_task_id: p.task.id, seed: p.seed, factor: r.factor, task: null, changes: [], status: "rejected", reason: r.reason, trial_id: null, score: null });
    for (const plan of ps) {
      const prefix = `${id}-${plan.variant_id}`;
      const check = checkVariant(plan, `${prefix}-t1`);
      run.scale!.variants.push({
        variant_id: plan.variant_id,
        parent_trial_id: plan.parent_trial_id,
        parent_task_id: plan.parent_task_id,
        seed: plan.seed,
        factor: plan.factor,
        task: { type: plan.spec.type, slot: plan.spec.slot },
        changes: plan.changes,
        status: check.ok ? "pending" : "rejected",
        ...(check.ok ? {} : { reason: check.reason }),
        trial_id: null,
        score: null,
      });
      if (check.ok) plans.set(plan.variant_id, { plan, expected: check.initial_sha256, prefix });
    }
  });
  s.counts = variantCounts(run.scale.variants);
  persist(run);

  const env = variantEnvironment(brain, run.brain_version);
  const runner = run.request.worker === "llm" ? runWorker : runCompiled;
  let stop: string | null = null;
  let firstError: string | null = null;
  for (const v of run.scale.variants) {
    if (v.status !== "pending") continue;
    if (!stop && cancelRequested.has(id)) stop = "not run: cancelled by request";
    if (stop) {
      v.status = "not_run";
      v.reason = stop;
      continue;
    }
    const { plan, expected, prefix } = plans.get(v.variant_id)!;
    v.status = "running";
    v.started_at = now();
    persist(run);
    try {
      const prepared = prepareTrial(brain, {
        kind: "posttraining",
        partition: "training",
        seed: plan.seed,
        version: run.brain_version,
        worker: run.request.worker,
        run_id: prefix,
        requested_tasks: [plan.spec],
        selection: exactSelection([plan.spec], prefix),
        robot_count: 1,
        environment: env,
        provenance: { post_training_id: id, parent_trial_id: plan.parent_trial_id, augmentation: { variant_id: plan.variant_id, factor: plan.factor, parent_task_id: plan.parent_task_id, changes: plan.changes } },
        headless: true,
        scenario: structuredClone(plan.scenario),
      });
      v.trial_id = prepared.record.trial_id;
      // the recorded world must be exactly the planned one before any action is played
      if (prepared.record.initial_sha256 !== expected) {
        const err = new Error("the recorded initial world is not the planned variant world; the variant was not run");
        finishTrial(prepared, "error", err);
        throw err;
      }
      persist(run);
      const { trial, error } = await executeTrial(brain, prepared, runner);
      mergeTally(run.llm, trial.llm);
      v.score = trial.scores[0] ?? null;
      if (error) throw new Error(trial.error ?? message(error));
      // validate what was saved, not the object in memory
      const saved = getTrial(trial.trial_id);
      const r = saved ? validateTrial(brain, saved, { expectedInitialSha256: expected }) : { accepted: [], rejected: [{ trial_id: trial.trial_id, reason: "the recording was not saved" }] };
      if (r.accepted.length === 1) {
        v.status = "kept";
        out.push({ ...r.accepted[0], variant: { variant_id: plan.variant_id, factor: plan.factor, parent_trial_id: plan.parent_trial_id, parent_task_id: plan.parent_task_id } });
      } else {
        v.status = "failed";
        v.reason = r.rejected.map((x) => x.reason).join("; ") || "not a strict success";
      }
    } catch (e) {
      v.status = "error";
      v.reason = message(e);
      firstError ??= `${v.variant_id}: ${v.reason}`;
      stop = `not run: the scaler stopped after an error in ${v.variant_id}`;
    }
    v.finished_at = now();
    s.counts = variantCounts(run.scale.variants);
    persist(run);
    progress(run, "scale");
  }
  if (firstError) throw new Error(firstError);
  if (stop && cancelRequested.has(id)) throw new Cancelled();
}

function fileRef(name: string, text: string, rows: number): FileRef {
  return { name, bytes: Buffer.byteLength(text), sha256: sha256(text), rows };
}

function exportDataset(brain: BrainStore, run: PostTrainingRun, tasks: ValidatedTask[], s: StepState) {
  const ds = buildDataset(brain, tasks);
  if (!ds.rows) throw new Error("no examples to export");
  const dir = runDir(run.post_training_id);
  writeTextAtomic(path.join(dir, DATASET_FILES.chat.file), ds.chat);
  writeTextAtomic(path.join(dir, DATASET_FILES.robot.file), ds.robot);
  const chat = fileRef(DATASET_FILES.chat.file, ds.chat, ds.rows);
  const robot = fileRef(DATASET_FILES.robot.file, ds.robot, ds.rows);
  const by_source: Record<DecisionSource, number> = { lightning_worker: 0, compiled_brain_policy: 0 };
  const by_origin = { recorded: 0, variant: 0 };
  for (const e of ds.episodes) {
    by_source[e.decision_source] += e.frames;
    by_origin[e.variant ? "variant" : "recorded"] += e.frames;
  }
  const manifest = {
    post_training_id: run.post_training_id,
    created_at: now(),
    format: "named-action JSONL, LeRobot-style",
    official_lerobot_format: false,
    contains_images: false,
    contains_joint_actions: false,
    action_space: "named store-robot actions: navigate_to, set_torso, scan_slot, reach, grasp, retract, place, report_issue",
    observation_source: "reconstructed by replaying the recorded actions from each trial's recorded initial world; these are not the original model prompts",
    decision_sources: {
      lightning_worker: "chosen by the Nemotron 3.5 Lightning worker during the recorded run",
      compiled_brain_policy: "chosen by the deterministic compiled brain policy (no model call); not model-generated",
    },
    selection: "only tasks whose trial replayed exactly, whose item ended at its target and which had zero refused actions; training seeds 1 to 20 only, never held-out seeds 101 to 110 or gate trials",
    not_included: "finish and read_brain tool calls (not recorded in trials) and anything a model said in text",
    chat: { file: chat.name, rows: chat.rows, turns: "single", roles: ["system", "user", "assistant"], assistant: 'one JSON object {"action","args"} exactly as executed by the engine' },
    robot: { file: robot.name, rows: robot.rows },
    files: { chat, robot },
    counts: { examples: ds.rows, episodes: ds.episodes.length, by_source, by_origin },
    episodes: ds.episodes,
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  writeTextAtomic(path.join(dir, DATASET_FILES.manifest.file), manifestText);
  run.dataset = { examples: ds.rows, episodes: ds.episodes.length, by_source, by_origin, files: { chat, robot, manifest: fileRef(DATASET_FILES.manifest.file, manifestText, ds.episodes.length) } };
  s.counts = { examples: ds.rows, episodes: ds.episodes.length, recorded_examples: by_origin.recorded, variant_examples: by_origin.variant, lightning_examples: by_source.lightning_worker, compiled_examples: by_source.compiled_brain_policy, chat_bytes: chat.bytes };
}

async function publishCopy(run: PostTrainingRun, s: StepState) {
  const dir = runDir(run.post_training_id);
  const files = [DATASET_FILES.robot.file, DATASET_FILES.manifest.file].map((f) => ({ path: `post-training/${run.post_training_id}/${f}`, content: fs.readFileSync(path.join(dir, f)) }));
  run.hf = { status: "pending", local_files: [DATASET_FILES.robot.file, DATASET_FILES.manifest.file] };
  try {
    const r = await crusoe.publishDataset(files, `AutoRoboHarness post-training ${run.post_training_id}`);
    run.hf = { ...run.hf, status: "published", repo: r.repo, commit: r.commit, url: r.url };
    s.counts = { files: files.length, bytes: files.reduce((n, f) => n + f.content.length, 0) };
  } catch (e) {
    run.hf = { ...run.hf, status: "error", error: message(e) };
    throw e;
  }
}

function readChatFile(run: PostTrainingRun): Buffer {
  const ref = run.dataset?.files.chat;
  if (!ref) throw new Error("no exported dataset");
  const buf = fs.readFileSync(path.join(runDir(run.post_training_id), ref.name));
  if (sha256(buf) !== ref.sha256) throw new Error("the exported chat file changed after export; not uploading it");
  return buf;
}

async function upload(run: PostTrainingRun, s: StepState) {
  const f = run.provider.file;
  if (f.state !== "not_started") throw new Error(`the upload is already ${f.state}; it is never repeated`);
  const buf = readChatFile(run);
  run.provider.file = { state: "submitting", filename: `autorobo-${run.post_training_id}.jsonl`, bytes: buf.length, sha256: sha256(buf), submitted_at: now() };
  persist(run);
  try {
    const pf = await crusoe.uploadTrainingFile(run.provider.file.filename!, buf);
    Object.assign(run.provider.file, { state: "uploaded", id: pf.id, status: pf.status });
    s.counts = { bytes: buf.length, rows: run.dataset!.files.chat.rows };
  } catch (e) {
    run.provider.file.state = e instanceof crusoe.ProviderError && !e.definitive ? "unknown" : "error";
    run.provider.file.error = message(e);
    throw e;
  }
}

export function jobBody(run: PostTrainingRun, model: string, trainingFile: string): crusoe.JobBody {
  const rows = run.dataset?.examples ?? 0;
  return {
    model,
    training_file: trainingFile,
    suffix: `autorobo-${run.post_training_id}`,
    metadata: { post_training_id: run.post_training_id, dataset_sha256: run.dataset?.files.chat.sha256 ?? "", brain_version: String(run.brain_version) },
    method: { type: "supervised", supervised: { hyperparameters: { n_epochs: HYPERPARAMETERS.n_epochs, batch_size: Math.max(2, Math.min(8, Math.round(rows / 16))), learning_rate: HYPERPARAMETERS.learning_rate } } },
  };
}

async function createJob(run: PostTrainingRun, s: StepState) {
  const job = run.provider.job;
  if (job.state !== "not_started") throw new Error(`the job is already ${job.state}; it is never created twice`);
  if (run.provider.file.state !== "uploaded" || !run.provider.file.id) throw new Error("no uploaded training file");
  let model: crusoe.BaseModel;
  try {
    model = await crusoe.resolveBaseModel();
  } catch (e) {
    run.provider.job = { state: "error", error: `no job was created: ${message(e)}` };
    throw e;
  }
  run.provider.model = model;
  const body = jobBody(run, model.id, run.provider.file.id);
  try {
    run.provider.estimate = await crusoe.estimateJobPrice(body);
  } catch (e) {
    run.provider.estimate_error = message(e);
  }
  run.provider.job = { state: "submitting", suffix: body.suffix, request: { model: body.model, training_file: body.training_file, hyperparameters: body.method.supervised.hyperparameters }, submitted_at: now() };
  persist(run);
  try {
    const j = await crusoe.createJob(body);
    Object.assign(run.provider.job, { state: "submitted", id: j.id, status: j.status, provider: j });
    s.counts = { examples: run.dataset!.examples, ...body.method.supervised.hyperparameters };
  } catch (e) {
    const unknown = e instanceof crusoe.ProviderError && !e.definitive;
    run.provider.job.state = unknown ? "unknown" : "error";
    run.provider.job.error = unknown ? `${message(e)}; the job may or may not exist. It is not resubmitted; POST /post-training/${run.post_training_id}/refresh looks it up by suffix` : message(e);
    throw e;
  }
}

// ---------- reading, refresh, cancel, restart ----------

export function getRun(id: string): PostTrainingRun | undefined {
  const rid = safeId(id, "post_training_id");
  const mem = live.get(rid);
  if (mem) return mem;
  const f = path.join(runDir(rid), "run.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : undefined;
}

function mustGet(id: string): PostTrainingRun {
  const r = getRun(id);
  if (!r) throw httpError(404, "no post-training run with that id", { code: "no_post_training" });
  return r;
}

export function listRuns(): PostTrainingRun[] {
  const root = dataDir("post-training");
  if (!fs.existsSync(root)) return [];
  const out: PostTrainingRun[] = [];
  for (const d of fs.readdirSync(root)) {
    try {
      const r = getRun(d);
      if (r) out.push(r);
    } catch {
      // not a run folder, or a damaged record: skip it rather than fail the listing
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** A run without its long lists (rejections, provider events, checkpoints and metric series). */
export function summarizeRun(r: PostTrainingRun) {
  const { events, checkpoints, metrics, ...provider } = r.provider;
  return {
    ...r,
    collect: r.collect && { trials_considered: r.collect.trials_considered, tasks_accepted: r.collect.tasks_accepted, rejected_total: r.collect.rejected_total },
    scale: r.scale && { parents: r.scale.parents.length, variants: variantCounts(r.scale.variants) },
    provider: { ...provider, events_count: events.length, checkpoints_count: checkpoints.length, latest_checkpoint: checkpoints.reduce<crusoe.ProviderCheckpoint | null>((a, c) => (!a || (c.step_number ?? 0) > (a.step_number ?? 0) ? c : a), null) },
  };
}

/** POST /post-training/:id/refresh: settle unknown provider states by looking them up, then poll a known job. It
 *  never uploads or creates anything. */
export function refreshRun(id: string): Promise<PostTrainingRun> {
  const run = mustGet(id);
  const pending = refreshing.get(run.post_training_id);
  if (pending) return pending;
  const p = (async () => {
    const { file, job } = run.provider;
    if (file.state !== "unknown" && job.state !== "unknown" && !job.id) return run; // nothing at the provider to ask about
    if (run.provider.last_polled_at && Date.now() - Date.parse(run.provider.last_polled_at) < REFRESH_MIN_INTERVAL_MS) return run;
    run.provider.last_polled_at = now();
    const errors: string[] = [];
    const attempt = async (what: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        errors.push(`${what}: ${message(e)}`);
      }
    };
    if (file.state === "unknown" && file.filename)
      await attempt("file lookup", async () => {
        const f = await crusoe.findUploadedFile(file.filename!);
        file.reconciled_at = now();
        if (f) Object.assign(file, { state: "uploaded", id: f.id, status: f.status });
      });
    if (job.state === "unknown" && job.suffix)
      await attempt("job lookup", async () => {
        const found = await crusoe.findRunJobs({ suffix: job.suffix!, post_training_id: run.post_training_id, training_file: file.id ?? null });
        job.reconciled_at = now();
        if (found.length === 1) Object.assign(job, { state: "submitted", id: found[0].id, status: found[0].status, provider: found[0] });
        else if (found.length > 1) throw new Error(`${found.length} jobs match this run (${found.map((j) => j.id).join(", ")}); none adopted automatically`);
      });
    if (job.id) {
      const jid = job.id;
      await attempt("job", async () => {
        const j = await crusoe.getJob(jid);
        Object.assign(job, { status: j.status, provider: j });
      });
      await attempt("events", async () => void (run.provider.events = await crusoe.listJobEvents(jid)));
      await attempt("checkpoints", async () => void (run.provider.checkpoints = await crusoe.listJobCheckpoints(jid)));
      await attempt("metrics", async () => void (run.provider.metrics = await crusoe.getJobMetrics(jid)));
    }
    run.provider.poll_error = errors.length ? errors.join("; ") : null;
    persist(run);
    return run;
  })().finally(() => refreshing.delete(run.post_training_id));
  refreshing.set(run.post_training_id, p);
  return p;
}

/** POST /post-training/:id/cancel: an explicit request only. Stops a running local pipeline before its next variant
 *  or step, and cancels a known provider job that has not finished. */
export async function cancelRun(id: string): Promise<PostTrainingRun> {
  await refreshing.get(safeId(id, "post_training_id"))?.catch(() => {}); // read the record after any refresh has saved it
  const run = mustGet(id);
  let acted = false;
  if (run.status === "running" && live.has(run.post_training_id)) {
    cancelRequested.add(run.post_training_id);
    run.cancel_requested_at = now();
    persist(run);
    acted = true;
  }
  const job = run.provider.job;
  if (job.id && !crusoe.TERMINAL_JOB_STATUSES.includes(job.status ?? "")) {
    run.provider.cancel = { requested_at: now() };
    try {
      const j = await crusoe.cancelJob(job.id);
      Object.assign(job, { status: j.status, provider: j });
      run.provider.cancel.status = j.status;
    } catch (e) {
      run.provider.cancel.error = message(e);
      persist(run);
      throw httpError(502, `the provider did not cancel job ${job.id}: ${message(e)}`, { code: "provider_error" });
    }
    acted = true;
  }
  if (!acted)
    throw httpError(409, job.id ? `job ${job.id} is already ${job.status}` : job.state === "unknown" ? "the job's existence is unknown; refresh first" : "nothing to cancel: the pipeline is not running and no provider job exists", {
      code: "nothing_to_cancel",
    });
  persist(run);
  return run;
}

/** On server start: a run still marked running was cut off by a restart. Record that; never resume or resend. */
export function recoverInterruptedPostTraining(): string[] {
  const fixed: string[] = [];
  for (const r of listRuns()) {
    if (r.status !== "running" || live.has(r.post_training_id)) continue;
    for (const n of STEP_NAMES) {
      const s = r.steps[n];
      if (s.status === "started") Object.assign(s, { status: "error", error: "the server stopped during this step; it was not resumed", finished_at: now() });
      else if (s.status === "pending") Object.assign(s, { status: "skipped", reason: "not run: the server stopped before this step", finished_at: now() });
    }
    for (const v of r.scale?.variants ?? []) {
      if (v.status === "running") Object.assign(v, { status: "interrupted", reason: "the server stopped during this variant; it was not resumed" });
      else if (v.status === "pending") Object.assign(v, { status: "not_run", reason: "not run: the server stopped first" });
    }
    const unknown = "the server stopped before the answer arrived; it is not resent. POST /post-training/:id/refresh looks it up";
    if (r.provider.file.state === "submitting") Object.assign(r.provider.file, { state: "unknown", error: unknown });
    if (r.provider.job.state === "submitting") Object.assign(r.provider.job, { state: "unknown", error: unknown });
    r.status = "interrupted";
    r.error ??= "the server stopped while this run was in progress; it was not resumed";
    r.finished_at = now();
    persist(r);
    fixed.push(r.post_training_id);
  }
  return fixed;
}

// ---------- routes ----------

/** Mount the post-training API on the server's router (Person A wires this one call into index.ts). */
export function registerPostTrainingRoutes(router: Router, brain: BrainStore): void {
  const cut = recoverInterruptedPostTraining();
  if (cut.length) console.log(`marked ${cut.length} interrupted post-training run(s): ${cut.join(", ")}`);

  // POST /post-training { shift_id?, brain?, worker?, upload?, variants_per_task?, max_tasks? } -> 202 at once
  router.post("/post-training", (req, res) => {
    const { run, done } = startPostTraining(brain, req.body);
    done.catch((e) => console.error(e));
    res.status(202).json({ post_training_id: run.post_training_id, status: run.status, request: run.request, steps: run.steps, created_at: run.created_at, console_url: run.provider.console_url });
  });
  router.get("/post-training", (_req, res) => res.json({ runs: listRuns().map(summarizeRun) }));
  router.get("/post-training/:id", (req, res) => res.json(mustGet(req.params.id as string)));
  router.post("/post-training/:id/refresh", async (req, res) => res.json(await refreshRun(req.params.id as string)));
  router.post("/post-training/:id/cancel", async (req, res) => res.json(await cancelRun(req.params.id as string)));
  // GET /post-training/:id/dataset?format=chat|robot|manifest -> the exported file itself
  router.get("/post-training/:id/dataset", (req, res) => {
    const format = String(req.query.format ?? "chat");
    if (!Object.hasOwn(DATASET_FILES, format)) throw httpError(400, "format must be chat, robot or manifest", { code: "bad_format" });
    const run = mustGet(req.params.id as string);
    const f = DATASET_FILES[format as keyof typeof DATASET_FILES];
    const file = path.join(runDir(run.post_training_id), f.file);
    if (!run.dataset || !fs.existsSync(file)) throw httpError(404, "this run has no exported dataset", { code: "no_dataset" });
    res.type(f.type).setHeader("content-disposition", `inline; filename="${run.post_training_id}-${f.file}"`);
    res.send(fs.readFileSync(file));
  });
}
