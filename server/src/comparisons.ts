// Matched comparisons (V2 extension): run two saved brain versions on exactly the same seeds, tasks, robots,
// worlds and speed limit, one seed × version at a time, and record every pair. A comparison measures; it never
// promotes, applies or edits a brain, the brain index or an earlier measurement. Its trials are recorded under
// data/trials (held-out ones apart from training), and its record under data/comparisons. Neither is a shift,
// so the supervisor never sees them.

import fs from "node:fs";
import path from "node:path";
import { createScenario, type TaskScore } from "../../engine/store.ts";
import { httpError, type BrainStore } from "./brain.ts";
import { emit } from "./events.ts";
import { claimInference } from "./inference-lock.ts";
import { mergeTally, newTally, type LlmTally } from "./llm.ts";
import { canonicalJson, dataDir, readJsonDir, safeId, sha256, writeJsonAtomic } from "./paths.ts";
import { runCompiled } from "./policy.ts";
import {
  ENGINE_DEFAULT_MAX_SPEED,
  executeTrial,
  finishTrial,
  guardrailSpeed,
  HELDOUT_SEEDS,
  prepareTrial,
  selectTasks,
  TRAINING_SEEDS,
  type Partition,
  type TaskSelection,
  type TrialEnvironment,
  type WorkerKind,
} from "./trials.ts";
import { runWorker, type TaskSpec } from "./worker.ts";

export interface ComparisonRequest {
  versions: [number, number];
  seeds: number[];
  tasks: TaskSpec[];
  worker: WorkerKind;
  environment: { max_speed_mps?: number };
}

export type ComparisonStatus = "running" | "done" | "error" | "interrupted";
export type PairStatus = "pending" | "running" | "done" | "error" | "interrupted" | "not_run";
export type ExpectedTaskScore = TaskScore & { index: number; infeasible?: true };

export interface ComparisonPair {
  version: number;
  role: "a" | "b";
  status: PairStatus;
  error?: string;
  trial_id: string | null;
  task_scores: ExpectedTaskScore[];
}

export interface ComparisonSeed {
  seed: number;
  robot_count: number;
  task_selection: TaskSelection[];
  initial_sha256: string | null;
  pairs: [ComparisonPair, ComparisonPair];
}

export interface VersionAggregate {
  version: number;
  role: "a" | "b";
  expected_tasks: number;
  evaluated_tasks: number;
  infeasible_tasks: number;
  successes: number;
  success_rate: number;
  refused_per_evaluated_task: number | null; // over the tasks that actually ran
  steps_per_evaluated_task: number | null;
  complete: boolean;
  trial_ids: string[];
}

export interface Comparison {
  comparison_id: string;
  evaluation_id: string;
  status: ComparisonStatus;
  error?: string;
  request: ComparisonRequest;
  versions: [number, number];
  brain_sha256: Record<string, string>;
  partition: Partition;
  seeds: number[];
  tasks: TaskSpec[];
  worker: WorkerKind;
  environment: TrialEnvironment & { guardrail_max_speed_mps_by_version: Record<string, number | null> };
  set_id: string;
  per_seed: ComparisonSeed[];
  progress: { pairs_done: number; pairs_total: number };
  aggregates: [VersionAggregate, VersionAggregate];
  llm: LlmTally;
  created_at: string;
  started_at: string;
  updated_at: string;
  finished_at?: string;
}

export type ComparisonSummary = Omit<Comparison, "per_seed">;

const cmpDir = () => dataDir("comparisons");
const now = () => new Date().toISOString();
const persist = (c: Comparison) => writeJsonAtomic(path.join(cmpDir(), `${c.comparison_id}.json`), c);
const SLOT = /^[AB]-[1-8]-[1-4]-[12]$/;
let idCounter = 0;

/** The identity of a measured set: same seeds, same requested tasks (in order) and the same speed limit. A gate
 *  and a comparison with equal set_id faced exactly the same task selections and worlds. */
export function setIdentity(partition: Partition, seeds: number[], tasks: { type: string; slot: string }[], max_speed_mps: number) {
  const set = { seeds: [...seeds].sort((a, b) => a - b), tasks: tasks.map((t) => ({ type: t.type as "PICK" | "RESTOCK", slot: t.slot })), max_speed_mps };
  return { set_id: sha256(canonicalJson({ partition, ...set })).slice(0, 12), set };
}

const bad = (code: string, msg: string) => httpError(400, msg, { code });

/** Check a request and fill in its defaults; everything later uses only this canonical form. */
export function validateComparison(brain: BrainStore, body: any): ComparisonRequest & { partition: Partition } {
  const b = body ?? {};
  const versions = b.versions;
  if (!Array.isArray(versions) || versions.length !== 2 || !versions.every((v: unknown) => Number.isInteger(v)) || versions[0] === versions[1])
    throw bad("bad_versions", "versions must be two different integer brain versions, e.g. [4, 5]");
  for (const v of versions) {
    try {
      brain.resolveVersion(v);
    } catch {
      throw httpError(404, `brain version ${v} is not saved`, { code: "no_such_version" });
    }
  }

  const seeds = b.seeds;
  if (!Array.isArray(seeds) || !seeds.length || !seeds.every((s: unknown) => Number.isInteger(s)) || new Set(seeds).size !== seeds.length)
    throw bad("bad_seeds", "seeds must be a non-empty list of unique integers");
  const partition: Partition | null = seeds.every((s: number) => HELDOUT_SEEDS.includes(s)) ? "heldout" : seeds.every((s: number) => TRAINING_SEEDS.includes(s)) ? "training" : null;
  if (!partition) throw bad("bad_seeds", "seeds must all be held-out (101 to 110) or all training (1 to 20)");

  const tasks = b.tasks;
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 4) throw bad("bad_tasks", "tasks: 1 to 4 tasks, one per robot");
  const layout = createScenario(seeds[0], 1).layout.slots;
  const canon: TaskSpec[] = tasks.map((t: any, i: number) => {
    if (t?.type !== "PICK" && t?.type !== "RESTOCK") throw bad("bad_tasks", `task ${i + 1}: type must be PICK or RESTOCK`);
    if (typeof t.slot !== "string" || !SLOT.test(t.slot) || !layout[t.slot]) throw bad("bad_tasks", `task ${i + 1}: ${t?.slot} is not a shelf slot (e.g. A-1-3-1)`);
    const robot = t.robot ?? `robot-${i + 1}`;
    if (typeof robot !== "string" || !/^robot-[1-4]$/.test(robot) || Number(robot.slice(6)) > tasks.length) throw bad("bad_tasks", `task ${i + 1}: robot must be robot-1 to robot-${tasks.length}`);
    return { type: t.type, slot: t.slot, robot };
  });
  if (new Set(canon.map((t) => t.robot)).size !== canon.length) throw bad("bad_tasks", "each task needs its own robot");
  if (new Set(canon.map((t) => t.slot)).size !== canon.length) throw bad("bad_tasks", "each task needs its own slot");

  const worker = b.worker ?? "compiled";
  if (worker !== "llm" && worker !== "compiled") throw bad("bad_worker", 'worker must be "llm" or "compiled"');

  const env = b.environment ?? {};
  if (typeof env !== "object" || Array.isArray(env) || Object.keys(env).some((k) => k !== "max_speed_mps"))
    throw bad("bad_environment", "environment may only set max_speed_mps");
  if (env.max_speed_mps !== undefined && !(typeof env.max_speed_mps === "number" && env.max_speed_mps > 0 && env.max_speed_mps <= ENGINE_DEFAULT_MAX_SPEED))
    throw bad("bad_environment", `max_speed_mps must be a number above 0 and at most ${ENGINE_DEFAULT_MAX_SPEED}`);

  return { versions: [versions[0], versions[1]], seeds: [...seeds], tasks: canon, worker, environment: env.max_speed_mps === undefined ? {} : { max_speed_mps: env.max_speed_mps }, partition };
}

/** One score per EXPECTED task, in request order; an infeasible task is a recorded failure, never left out. */
function expectedScores(selection: TaskSelection[], scores: TaskScore[]): ExpectedTaskScore[] {
  return selection.map((s) => {
    const found = s.task_id ? scores.find((x) => x.task_id === s.task_id) : undefined;
    if (found) return { ...found, index: s.index };
    return { index: s.index, task_id: s.task_id ?? "", complete: false, refused_actions: 0, steps: 0, item_location: "", target_location: "", ...(s.actual ? {} : { infeasible: true as const }) };
  });
}

/** Totals that always divide by every expected task, so an unfinished comparison never looks complete. */
export function aggregate(c: Pick<Comparison, "per_seed" | "versions" | "status" | "tasks" | "seeds">): [VersionAggregate, VersionAggregate] {
  return ([0, 1] as const).map((r) => {
    const expected = c.seeds.length * c.tasks.length;
    let evaluated = 0,
      infeasible = 0,
      successes = 0,
      refused = 0,
      steps = 0,
      ran = 0;
    const trial_ids: string[] = [];
    for (const ps of c.per_seed) {
      const pair = ps.pairs[r];
      const nInfeasible = ps.task_selection.filter((s) => !s.actual).length;
      infeasible += nInfeasible;
      evaluated += nInfeasible; // a task that cannot exist in this seed is a known failure for both versions
      if (pair.trial_id) trial_ids.push(pair.trial_id);
      if (pair.status !== "done") continue;
      for (const s of pair.task_scores) {
        if (s.infeasible) continue;
        evaluated++;
        ran++;
        if (s.complete) successes++;
        refused += s.refused_actions;
        steps += s.steps;
      }
    }
    return {
      version: c.versions[r],
      role: r === 0 ? "a" : "b",
      expected_tasks: expected,
      evaluated_tasks: evaluated,
      infeasible_tasks: infeasible,
      successes,
      success_rate: expected ? +(successes / expected).toFixed(3) : 0,
      refused_per_evaluated_task: ran ? +(refused / ran).toFixed(2) : null,
      steps_per_evaluated_task: ran ? +(steps / ran).toFixed(2) : null,
      complete: c.status === "done" && evaluated === expected,
      trial_ids,
    } satisfies VersionAggregate;
  }) as [VersionAggregate, VersionAggregate];
}

const pairsDone = (c: Comparison) => c.per_seed.reduce((n, ps) => n + ps.pairs.filter((p) => p.status === "done" || p.status === "error").length, 0);

/** POST /comparisons: validate, record, and start the run in the background. */
export function startComparison(brain: BrainStore, body: unknown): { comparison: Comparison; done: Promise<Comparison> } {
  const req = validateComparison(brain, body);
  const comparison_id = `cmp-${Date.now().toString(36)}-${(++idCounter).toString(36)}`;
  const release = req.worker === "llm" ? claimInference("comparison", comparison_id) : () => {};
  let c: Comparison;
  try {
    // anything that fails while setting up (guardrails, file hashes, task selection, the first save) gives the
    // Lightning claim back before the error leaves, so a failed request never blocks later runs
    c = buildComparison(brain, req, comparison_id);
    persist(c);
  } catch (e) {
    release();
    throw e;
  }
  const done = runComparison(brain, c).finally(release);
  return { comparison: c, done };
}

function buildComparison(brain: BrainStore, req: ReturnType<typeof validateComparison>, comparison_id: string): Comparison {
  const [va, vb] = req.versions;
  const guards = { [va]: guardrailSpeed(brain, va), [vb]: guardrailSpeed(brain, vb) } as Record<string, number | null>;
  const known = Object.values(guards).filter((g): g is number => g !== null);
  const requested = req.environment.max_speed_mps ?? null;
  // one speed for both versions: the strictest of the request, both guardrails and the engine's limit
  const max_speed_mps = Math.min(requested ?? ENGINE_DEFAULT_MAX_SPEED, ...known, ENGINE_DEFAULT_MAX_SPEED);
  const t0 = now();
  const c: Comparison = {
    comparison_id,
    evaluation_id: comparison_id,
    status: "running",
    request: { versions: req.versions, seeds: req.seeds, tasks: req.tasks, worker: req.worker, environment: req.environment },
    versions: req.versions,
    brain_sha256: { [va]: brain.fileSha256(va), [vb]: brain.fileSha256(vb) },
    partition: req.partition,
    seeds: req.seeds,
    tasks: req.tasks,
    worker: req.worker,
    environment: {
      max_speed_mps,
      requested_max_speed_mps: requested,
      guardrail_max_speed_mps: known.length ? Math.min(...known) : null,
      engine_default_max_speed_mps: ENGINE_DEFAULT_MAX_SPEED,
      guardrail_max_speed_mps_by_version: guards,
    },
    set_id: setIdentity(req.partition, req.seeds, req.tasks, max_speed_mps).set_id,
    per_seed: req.seeds.map((seed) => ({
      seed,
      robot_count: req.tasks.length,
      task_selection: selectTasks(seed, req.tasks, `${comparison_id}-s${seed}`),
      initial_sha256: null,
      pairs: [
        { version: va, role: "a", status: "pending", trial_id: null, task_scores: [] },
        { version: vb, role: "b", status: "pending", trial_id: null, task_scores: [] },
      ],
    })),
    progress: { pairs_done: 0, pairs_total: req.seeds.length * 2 },
    aggregates: undefined as any,
    llm: newTally(),
    created_at: t0,
    started_at: t0,
    updated_at: t0,
  };
  c.aggregates = aggregate(c);
  return c;
}

async function runComparison(brain: BrainStore, c: Comparison): Promise<Comparison> {
  const { environment: env } = c;
  const trialEnv: TrialEnvironment = { max_speed_mps: env.max_speed_mps, requested_max_speed_mps: env.requested_max_speed_mps, guardrail_max_speed_mps: env.guardrail_max_speed_mps, engine_default_max_speed_mps: env.engine_default_max_speed_mps };
  const runner = c.worker === "llm" ? runWorker : runCompiled;
  let stop: string | null = null;
  for (const ps of c.per_seed)
    for (const pair of ps.pairs) {
      if (stop) {
        pair.status = "not_run";
        pair.error = stop;
        continue;
      }
      pair.status = "running";
      c.updated_at = now();
      persist(c);
      try {
        const prepared = prepareTrial(brain, {
          kind: "comparison",
          partition: c.partition,
          seed: ps.seed,
          version: pair.version,
          worker: c.worker,
          run_id: `${c.comparison_id}-s${ps.seed}-v${pair.version}`,
          requested_tasks: c.tasks,
          selection: ps.task_selection,
          robot_count: ps.robot_count,
          environment: trialEnv,
          provenance: { comparison_id: c.comparison_id, evaluation_id: c.comparison_id, role: pair.role },
          headless: true,
        });
        pair.trial_id = prepared.record.trial_id;
        if (ps.initial_sha256 === null) ps.initial_sha256 = prepared.record.initial_sha256;
        if (ps.initial_sha256 !== prepared.record.initial_sha256) {
          const err = new Error(`seed ${ps.seed}: v${pair.version}'s initial world differs from the other version's`);
          finishTrial(prepared, "error", err);
          throw err;
        }
        persist(c);
        const { trial, error } = await executeTrial(brain, prepared, runner);
        mergeTally(c.llm, trial.llm);
        pair.task_scores = expectedScores(ps.task_selection, trial.scores);
        if (error) throw Object.assign(new Error(trial.error ?? String(error)), { recorded: true });
        pair.status = "done";
      } catch (e: any) {
        pair.status = "error";
        pair.error = String(e?.message ?? e);
        stop = `not run: the comparison stopped after an error at seed ${ps.seed}, v${pair.version}`;
        c.error ??= `seed ${ps.seed}, v${pair.version}: ${pair.error}`;
      }
      c.progress.pairs_done = pairsDone(c);
      c.aggregates = aggregate(c);
      c.updated_at = now();
      persist(c);
      emit("comparison_progress", { comparison_id: c.comparison_id, pairs_done: c.progress.pairs_done, pairs_total: c.progress.pairs_total, seed: ps.seed, version: pair.version, status: pair.status });
    }
  c.status = stop ? "error" : "done";
  c.aggregates = aggregate(c);
  c.finished_at = c.updated_at = now();
  persist(c);
  emit("comparison_done", { comparison_id: c.comparison_id, status: c.status, aggregates: c.aggregates });
  return c;
}

// ---------- reading ----------

export function getComparison(id: string): Comparison | undefined {
  const f = path.join(cmpDir(), `${safeId(id, "comparison_id")}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : undefined;
}

export function listComparisons(): Comparison[] {
  return readJsonDir<Comparison>(cmpDir()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function summarizeComparison(c: Comparison): ComparisonSummary {
  const { per_seed: _p, ...rest } = c;
  return rest;
}

/** On server start: a comparison still marked running was cut off by a restart. Record that; never resume it. */
export function recoverInterruptedComparisons(): string[] {
  const fixed: string[] = [];
  for (const c of readJsonDir<Comparison>(cmpDir())) {
    if (c.status !== "running") continue;
    for (const ps of c.per_seed)
      for (const p of ps.pairs) {
        if (p.status === "running") {
          p.status = "interrupted";
          p.error = "the server stopped during this run; it was not resumed";
        } else if (p.status === "pending") {
          p.status = "not_run";
          p.error = "not run: the server stopped before this pair started";
        }
      }
    c.status = "interrupted";
    c.error ??= "the server stopped while this comparison was running; it was not resumed";
    c.progress.pairs_done = pairsDone(c);
    c.aggregates = aggregate(c);
    c.finished_at = c.updated_at = now();
    persist(c);
    fixed.push(c.comparison_id);
  }
  return fixed;
}
