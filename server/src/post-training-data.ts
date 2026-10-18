// Post-training data (V3, Person B): which recorded decisions may become training data, the task scaler, and the
// two exported files. Nothing here calls a model, the network or the brain index.
//
// A task is training data only when its whole trial replays exactly: the recorded initial world is rebuilt from the
// seed (or, for a variant, from the planned mutated world), every recorded action is executed again on the engine
// and must give the recorded step, final world and scores, and the task itself ended with its item at the target
// and zero refused actions. Held-out seeds and gate trials are never read for training.

import { createScenario, StoreEngine, ONE_HAND_LIMIT_KG, type Robot, type Scenario, type Task, type TaskScore, type TrajectoryStep } from "../../engine/store.ts";
import type { BrainStore } from "./brain.ts";
import { canonicalJson, sha256 } from "./paths.ts";
import { getTrial, HELDOUT_SEEDS, listTrials, TRAINING_SEEDS, type TrialRecord, type TrialTask } from "./trials.ts";
import { act, taskCard, taskContext, type TaskSpec } from "./worker.ts";

export type DecisionSource = "lightning_worker" | "compiled_brain_policy";
export type VariantFactor = "level" | "weight" | "start_location";
export const VARIANT_FACTORS: VariantFactor[] = ["level", "weight", "start_location"];

/** Only these recorded kinds are collected. Gates are held-out by construction; variants belong to their own run. */
const COLLECTED_KINDS: string[] = ["shift", "comparison"];
const MAX_REJECTION_ROWS = 200;

export interface PreState {
  t: number;
  robot: Robot;
}

/** One recorded task whose trial replayed exactly, with the world state before each of its actions. */
export interface ValidatedTask {
  trial_id: string;
  kind: string;
  seed: number;
  brain_version: number;
  brain_sha256: string;
  worker: "llm" | "compiled";
  decision_source: DecisionSource;
  task: TrialTask;
  score: TaskScore;
  steps: { index: number; step: TrajectoryStep; pre: PreState }[];
  variant?: { variant_id: string; factor: VariantFactor; parent_trial_id: string; parent_task_id: string };
}

export interface Rejection {
  trial_id: string;
  task_id?: string;
  reason: string;
}

const taskOnly = (t: TrialTask): Task => ({ id: t.id, robot: t.robot, type: t.type, item_id: t.item_id, source: t.source, target: t.target });
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export const decisionSource = (worker: string): DecisionSource => (worker === "llm" ? "lightning_worker" : "compiled_brain_policy");

// ---------- exact replay ----------

export type ReplayResult = { ok: true; pre: PreState[]; scores: TaskScore[] } | { ok: false; reason: string };

/** Execute every recorded action again from the recorded initial world; any difference rejects the whole trial. */
export function replayTrial(trial: TrialRecord): ReplayResult {
  if (!trial.initial || !Array.isArray(trial.trajectory) || !trial.final || !Array.isArray(trial.scores)) return { ok: false, reason: "incomplete recording (missing initial world, steps, final world or scores)" };
  if (sha256(canonicalJson(trial.initial)) !== trial.initial_sha256) return { ok: false, reason: "initial world does not match its recorded hash" };
  if (trial.initial.trajectory?.length) return { ok: false, reason: "initial world already contains steps" };
  let engine: StoreEngine;
  try {
    engine = new StoreEngine(structuredClone(trial.initial), { maxSpeed: trial.environment?.max_speed_mps });
  } catch (e: any) {
    return { ok: false, reason: `recorded environment is not valid: ${e?.message ?? e}` };
  }
  const pre: PreState[] = [];
  for (const [i, rec] of trial.trajectory.entries()) {
    const robot = engine.scenario.robots[rec?.robot];
    if (!robot) return { ok: false, reason: `step ${i + 1}: unknown robot ${rec?.robot}` };
    pre.push({ t: engine.scenario.t, robot: structuredClone(robot) });
    try {
      engine.setBrainNodesRead(rec.robot, Array.isArray(rec.brain_nodes_read) ? rec.brain_nodes_read : []);
      const res = act(engine, rec.robot, rec.action, rec.args ?? {});
      if (!same(res.step, rec)) return { ok: false, reason: `step ${i + 1} (${rec.robot} ${rec.action}) does not replay as recorded` };
    } catch (e: any) {
      return { ok: false, reason: `step ${i + 1} (${rec.robot} ${rec.action}) cannot be replayed: ${e?.message ?? e}` };
    }
  }
  const { trajectory: _t, ...final } = engine.snapshot();
  if (!same(final, trial.final)) return { ok: false, reason: "replayed final world differs from the recorded final world" };
  const scores = engine.score();
  if (!same(scores, trial.scores)) return { ok: false, reason: "replayed scores differ from the recorded scores" };
  return { ok: true, pre, scores };
}

/** The world a recorded shift or comparison must have started from: its seed's world plus its recorded tasks. */
export function seedWorldMatches(trial: TrialRecord): boolean {
  try {
    const engine = new StoreEngine(createScenario(trial.seed, trial.robot_count));
    for (const t of trial.tasks) engine.setTask(taskOnly(t));
    if (!same(engine.snapshot(), trial.initial)) return false;
    return trial.tasks.every((t) => same(taskCard(engine, taskOnly(t)), t.card));
  } catch {
    return false;
  }
}

/** The tasks of one trial that are strict successes, after the trial has replayed exactly. `expectedInitialSha256`
 *  replaces the seed check for a variant (its world is the planned mutation, not the plain seed). */
export function validateTrial(brain: BrainStore, trial: TrialRecord, opts: { expectedInitialSha256?: string } = {}): { accepted: ValidatedTask[]; rejected: Rejection[] } {
  const reject = (reason: string, task_id?: string) => ({ accepted: [], rejected: [{ trial_id: trial.trial_id, ...(task_id ? { task_id } : {}), reason }] });
  if (trial.partition !== "training") return reject("not a training trial");
  if (!TRAINING_SEEDS.includes(trial.seed) || HELDOUT_SEEDS.includes(trial.seed)) return reject(`seed ${trial.seed} is not a training seed (1 to 20)`);
  if (trial.provenance?.gate_id || trial.provenance?.role === "base" || trial.provenance?.role === "candidate") return reject("gate trials are never collected");
  if (trial.status !== "done") return reject(`trial status is ${trial.status}`);
  let fileSha: string;
  try {
    fileSha = brain.fileSha256(trial.brain_version);
  } catch {
    return reject(`brain v${trial.brain_version} is not saved here`);
  }
  if (fileSha !== trial.brain_sha256) return reject(`brain v${trial.brain_version} changed since this trial was recorded`);
  if (opts.expectedInitialSha256 !== undefined) {
    if (trial.initial_sha256 !== opts.expectedInitialSha256) return reject("initial world is not the planned variant world");
  } else if (!seedWorldMatches(trial)) return reject(`initial world is not seed ${trial.seed}'s world with the recorded tasks`);
  const replay = replayTrial(trial);
  if (!replay.ok) return reject(replay.reason);

  const accepted: ValidatedTask[] = [];
  const rejected: Rejection[] = [];
  for (const task of trial.tasks) {
    const score = replay.scores.find((s) => s.task_id === task.id);
    const steps = trial.trajectory.flatMap((step, index) => (step.robot === task.robot && step.task_id === task.id ? [{ index, step, pre: replay.pre[index] }] : []));
    const why = !score
      ? "no score"
      : score.refused_actions > 0
        ? `${score.refused_actions} refused action(s)`
        : !score.complete
          ? `item ended at ${score.item_location}, not ${score.target_location}`
          : !steps.length
            ? "no recorded actions"
            : steps.some((s) => s.step.action === "report_issue" && s.step.args?.kind === "unknown_action")
              ? "the worker asked for an action that does not exist"
              : null;
    if (why) {
      rejected.push({ trial_id: trial.trial_id, task_id: task.id, reason: why });
      continue;
    }
    accepted.push({
      trial_id: trial.trial_id,
      kind: trial.kind,
      seed: trial.seed,
      brain_version: trial.brain_version,
      brain_sha256: trial.brain_sha256,
      worker: trial.worker,
      decision_source: decisionSource(trial.worker),
      task,
      score: score!,
      steps,
    });
  }
  return { accepted, rejected };
}

export interface CollectResult {
  trials_considered: number;
  accepted: ValidatedTask[];
  rejected: Rejection[];
  rejected_total: number;
  rejected_by_reason: Record<string, number>;
}

/** Collect: strict-success tasks from finished training trials, newest first, duplicates dropped. */
export function collectTrainingTasks(brain: BrainStore, opts: { shift_id?: string } = {}): CollectResult {
  const summaries = listTrials({ partition: "training", status: "done", ...(opts.shift_id ? { shift_id: opts.shift_id } : {}) });
  const accepted: ValidatedTask[] = [];
  const rejected: Rejection[] = [];
  const seen = new Map<string, string>();
  for (const s of summaries) {
    if (!COLLECTED_KINDS.includes(s.kind)) {
      rejected.push({ trial_id: s.trial_id, reason: `kind ${s.kind} is not collected` });
      continue;
    }
    const trial = getTrial(s.trial_id);
    if (!trial) {
      rejected.push({ trial_id: s.trial_id, reason: "recording is no longer readable" });
      continue;
    }
    const r = validateTrial(brain, trial);
    rejected.push(...r.rejected);
    for (const t of r.accepted) {
      // identical decisions in an identical world (e.g. a compiled run repeated) would only duplicate rows
      const key = sha256(canonicalJson({ seed: t.seed, brain: t.brain_sha256, task: taskOnly(t.task), start: t.steps[0].pre, steps: t.steps.map((x) => [x.step.action, x.step.args]) }));
      const dup = seen.get(key);
      if (dup) {
        rejected.push({ trial_id: t.trial_id, task_id: t.task.id, reason: `duplicate of ${dup}` });
        continue;
      }
      seen.set(key, `${t.trial_id}/${t.task.id}`);
      accepted.push(t);
    }
  }
  const rejected_by_reason: Record<string, number> = {};
  for (const r of rejected) {
    const k = r.reason.replace(/\b(trial|shift|cmp)-[A-Za-z0-9_-]+/g, "<id>").replace(/\bstep \d+/g, "step N");
    rejected_by_reason[k] = (rejected_by_reason[k] ?? 0) + 1;
  }
  return { trials_considered: summaries.length, accepted, rejected: rejected.slice(0, MAX_REJECTION_ROWS), rejected_total: rejected.length, rejected_by_reason };
}

/** Scaler parents: up to `max` tasks, the requested shift first, then Lightning decisions, newest first; one per
 *  seed and slot so variants differ. */
export function pickParents(tasks: ValidatedTask[], max: number, shift_trial_ids: Set<string> = new Set()): ValidatedTask[] {
  const rank = (t: ValidatedTask) => (shift_trial_ids.has(t.trial_id) ? 0 : 2) + (t.worker === "llm" ? 0 : 1);
  const ordered = tasks.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i);
  const out: ValidatedTask[] = [];
  const used = new Set<string>();
  for (const { t } of ordered) {
    const key = `${t.seed}:${t.task.type}:${shelfSlot(t.task)}`;
    if (used.has(key)) continue;
    used.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// ---------- the task scaler ----------

export interface Change {
  path: string;
  from: unknown;
  to: unknown;
  note?: string;
}

export interface VariantPlan {
  variant_id: string;
  factor: VariantFactor;
  parent_trial_id: string;
  parent_task_id: string;
  seed: number;
  spec: TaskSpec & { robot: "robot-1" };
  changes: Change[];
  scenario: Scenario; // the mutated single-robot world, before the task is created
}

const shelfSlot = (t: Pick<Task, "type" | "source" | "target">) => (t.type === "PICK" ? t.source : t.target);
const hashFraction = (s: string) => parseInt(sha256(s).slice(0, 8), 16) / 0x100000000;
const round2 = (x: number) => Math.round(x * 100) / 100;
export const START_WAYPOINTS = ["tote", "A-entrance", "B-entrance", "A-exit", "B-exit"];

/** Whether the task can be done exactly as asked: a PICK whose item sits in its own slot, or a RESTOCK into an empty
 *  slot whose stock waits in its backroom slot. */
export function exactlyFeasible(s: Scenario, type: "PICK" | "RESTOCK", slot: string): boolean {
  const sl = s.layout.slots[slot];
  if (!sl || sl.aisle === "backroom") return false;
  if (type === "PICK") return s.items[`item:${slot}`]?.slot === slot;
  return !Object.values(s.items).some((i) => i.slot === slot) && s.items[`stock:${slot}`]?.slot === `backroom:${slot}`;
}

const taskItemId = (type: "PICK" | "RESTOCK", slot: string) => `${type === "PICK" ? "item" : "stock"}:${slot}`;

/** Up to `count` one-factor variants of a validated parent task, in the order level, weight, start location. A factor
 *  that has no valid change in this seed is reported, never replaced by another factor. */
export function planVariants(parent: ValidatedTask, count: number, idPrefix: string): { plans: VariantPlan[]; rejected: { factor: VariantFactor; reason: string }[] } {
  const plans: VariantPlan[] = [];
  const rejected: { factor: VariantFactor; reason: string }[] = [];
  const type = parent.task.type;
  const slot = shelfSlot(parent.task);
  const weight = parent.task.card.item.weight_kg;
  const key = `${parent.trial_id}/${parent.task.id}`;
  for (const factor of VARIANT_FACTORS.slice(0, Math.max(0, Math.min(3, count)))) {
    const variant_id = `${idPrefix}-${factor === "start_location" ? "start" : factor}`;
    const base: Omit<VariantPlan, "spec" | "changes" | "scenario"> = { variant_id, factor, parent_trial_id: parent.trial_id, parent_task_id: parent.task.id, seed: parent.seed };
    if (!TRAINING_SEEDS.includes(parent.seed) || HELDOUT_SEEDS.includes(parent.seed)) {
      rejected.push({ factor, reason: `seed ${parent.seed} is not a training seed` });
      continue;
    }
    const s = createScenario(parent.seed, 1);
    if (!exactlyFeasible(s, type, slot)) {
      rejected.push({ factor, reason: `${type} ${slot} is not feasible in seed ${parent.seed}'s single-robot world` });
      continue;
    }
    if (factor === "level") {
      const [aisle, bay, level, pos] = slot.split("-");
      const options = [1, 2, 3, 4]
        .filter((l) => String(l) !== level && exactlyFeasible(s, type, `${aisle}-${bay}-${l}-${pos}`))
        .sort((a, b) => Math.abs(b - Number(level)) - Math.abs(a - Number(level)) || a - b);
      if (!options.length) {
        rejected.push({ factor, reason: `no other shelf level of ${aisle}-${bay}-*-${pos} is feasible in seed ${parent.seed}` });
        continue;
      }
      const next = `${aisle}-${bay}-${options[0]}-${pos}`;
      const item = s.items[taskItemId(type, next)];
      const changes: Change[] = [{ path: "task.slot", from: slot, to: next }];
      if (item.weight_kg !== weight) {
        changes.push({ path: `items.${item.id}.weight_kg`, from: item.weight_kg, to: weight, note: "held equal to the parent item's weight so only the shelf level changes" });
        item.weight_kg = weight;
      }
      plans.push({ ...base, spec: { type, slot: next, robot: "robot-1" }, changes, scenario: s });
    } else if (factor === "weight") {
      const item = s.items[taskItemId(type, slot)];
      const f = hashFraction(`${key}:weight`);
      const to = weight <= ONE_HAND_LIMIT_KG ? round2(2.4 + f * 1.5) : round2(0.4 + f * 1.4);
      const changes: Change[] = [{ path: `items.${item.id}.weight_kg`, from: item.weight_kg, to, note: `moved across the ${ONE_HAND_LIMIT_KG} kg one-hand limit` }];
      item.weight_kg = to;
      plans.push({ ...base, spec: { type, slot, robot: "robot-1" }, changes, scenario: s });
    } else {
      const robot = s.robots["robot-1"];
      const sourceWaypoint = s.layout.slots[type === "PICK" ? slot : `backroom:${slot}`].waypoint;
      const options = START_WAYPOINTS.filter((w) => w !== robot.waypoint && w !== sourceWaypoint && s.layout.waypoints[w]);
      const w = s.layout.waypoints[options[Math.floor(hashFraction(`${key}:start`) * options.length)]];
      const changes: Change[] = [
        { path: "robots.robot-1.waypoint", from: robot.waypoint, to: w.id },
        { path: "robots.robot-1.x", from: robot.x, to: w.x },
        { path: "robots.robot-1.y", from: robot.y, to: w.y },
      ].filter((c) => c.from !== c.to);
      Object.assign(robot, { waypoint: w.id, x: w.x, y: w.y });
      plans.push({ ...base, spec: { type, slot, robot: "robot-1" }, changes, scenario: s });
    }
  }
  return { plans, rejected };
}

/** Every leaf path where two worlds differ (tasks and trajectory excluded). */
export function worldDiff(a: unknown, b: unknown, prefix = ""): string[] {
  if (a === b) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].flatMap((k) => (prefix === "" && (k === "tasks" || k === "trajectory") ? [] : worldDiff((a as any)[k], (b as any)[k], prefix ? `${prefix}.${k}` : k)));
  }
  return [prefix || "(root)"];
}

/** Check a plan before any run: training seed, exactly one factor changed against the plain seed world, physical
 *  limits, and a task the engine accepts. Returns the expected recorded initial world hash, or a rejection. */
export function checkVariant(plan: VariantPlan, taskId: string): { ok: true; initial_sha256: string } | { ok: false; reason: string } {
  if (!TRAINING_SEEDS.includes(plan.seed) || HELDOUT_SEEDS.includes(plan.seed) || plan.scenario.seed !== plan.seed) return { ok: false, reason: `seed ${plan.seed} is not a training seed` };
  if (Object.keys(plan.scenario.robots).length !== 1 || plan.spec.robot !== "robot-1") return { ok: false, reason: "variants run one robot" };
  if (Object.keys(plan.scenario.tasks).length || plan.scenario.trajectory.length) return { ok: false, reason: "variant world already has tasks or steps" };
  const base = createScenario(plan.seed, 1);
  const diff = worldDiff(base, plan.scenario);
  const weightPath = /^items\.(item|stock):[AB]-\d-\d-\d\.weight_kg$/;
  const slotChanged = plan.changes.some((c) => c.path === "task.slot");
  const allowed =
    plan.factor === "start_location"
      ? diff.length > 0 && diff.every((p) => /^robots\.robot-1\.(x|y|waypoint)$/.test(p)) && diff.includes("robots.robot-1.waypoint")
      : plan.factor === "weight"
        ? diff.length === 1 && weightPath.test(diff[0])
        : diff.length <= 1 && diff.every((p) => weightPath.test(p));
  if (!allowed) return { ok: false, reason: `a ${plan.factor} variant may change only its factor; changed: ${diff.join(", ") || "nothing"}` };
  if ((plan.factor === "level") !== slotChanged) return { ok: false, reason: `a ${plan.factor} variant ${plan.factor === "level" ? "must" : "must not"} move the task to another slot` };
  if (slotChanged) {
    const from = String(plan.changes.find((c) => c.path === "task.slot")!.from).split("-");
    const to = plan.spec.slot.split("-");
    if (from[0] !== to[0] || from[1] !== to[1] || from[3] !== to[3] || from[2] === to[2]) return { ok: false, reason: `a level variant keeps aisle, bay and position and changes only the level (${from.join("-")} -> ${plan.spec.slot})` };
  }
  for (const it of Object.values(plan.scenario.items)) if (!(it.weight_kg >= 0.2 && it.weight_kg <= 4)) return { ok: false, reason: `${it.id} weighs ${it.weight_kg} kg, outside the store's 0.2 to 4 kg range` };
  if (!exactlyFeasible(plan.scenario, plan.spec.type, plan.spec.slot)) return { ok: false, reason: `${plan.spec.type} ${plan.spec.slot} is not feasible in the variant world` };
  try {
    const engine = new StoreEngine(structuredClone(plan.scenario));
    engine.createTask("robot-1", plan.spec.type, plan.spec.slot, taskId);
    return { ok: true, initial_sha256: sha256(canonicalJson(engine.snapshot())) };
  } catch (e: any) {
    return { ok: false, reason: `the engine refused the variant task: ${e?.message ?? e}` };
  }
}

// ---------- export ----------

export const EXPORT_INSTRUCTIONS = `You are a store robot shaped like PAL TIAGo: a wheeled base, a torso lift with four heights matching shelf levels 1 to 4, one arm and a gripper.
Follow the brain above. Choose the single next action for your task. Actions: navigate_to {waypoint}, set_torso {level}, scan_slot {slot}, reach {slot}, grasp {mode: one_hand | two_hand}, retract {}, place {target}, report_issue {kind, detail}.
Reply with only one JSON object: {"action": "<name>", "args": {...}}.`;

const fmtArgs = (a: Record<string, unknown>) =>
  Object.entries(a ?? {})
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");

/** The user message: the task card and the robot's state before this action, rebuilt from the recording. */
export function observationText(t: ValidatedTask, j: number): string {
  const c = t.task.card;
  const { robot, t: time } = t.steps[j].pre;
  const history = t.steps.slice(0, j).map((s, i) => `  ${i + 1}. ${s.step.action}${Object.keys(s.step.args ?? {}).length ? " " + fmtArgs(s.step.args) : ""} -> ${s.step.ok ? "ok" : "refused"}: ${s.step.reason}`);
  return [
    `TASK ${c.task_id} (${c.type}) for ${t.task.robot}`,
    `item: ${c.item.id} "${c.item.name}", ${c.item.weight_kg} kg`,
    `source: ${c.source} (waypoint ${c.source_waypoint})`,
    `target: ${c.target} (waypoint ${c.target_waypoint})`,
    `now (t=${time} s): at ${robot.waypoint}, torso level ${robot.torso_level}, arm ${robot.arm_out ? `extended${robot.reaching ? ` into ${robot.reaching}` : ""}` : "retracted"}, holding ${robot.holding ?? "nothing"}`,
    `actions so far in this task:`,
    ...(history.length ? history : ["  (none yet)"]),
    `What is your next action?`,
  ].join("\n");
}

export interface ChatLine {
  messages: [{ role: "system"; content: string }, { role: "user"; content: string }, { role: "assistant"; content: string }];
}

export interface ExportedDataset {
  chat: string; // JSONL
  robot: string; // JSONL
  rows: number;
  episodes: EpisodeMeta[];
}

export interface EpisodeMeta {
  episode_index: number;
  trial_id: string;
  task_id: string;
  kind: string;
  seed: number;
  brain_version: number;
  brain_sha256: string;
  worker: "llm" | "compiled";
  decision_source: DecisionSource;
  frames: number;
  variant: ValidatedTask["variant"] | null;
}

/** One chat line and one robot line per kept action. Each line is checked to parse back to the same value. */
export function buildDataset(brain: BrainStore, tasks: ValidatedTask[]): ExportedDataset {
  const chat: string[] = [];
  const robot: string[] = [];
  const episodes: EpisodeMeta[] = [];
  tasks.forEach((t, e) => {
    const system = `${taskContext(brain, t.brain_version, taskOnly(t.task)).text}\n\n${EXPORT_INSTRUCTIONS}`;
    const c = t.task.card;
    const taskText = `${c.type} ${c.item.id} (${c.item.name}, ${c.item.weight_kg} kg) from ${c.source} to ${c.target}`;
    t.steps.forEach((s, j) => {
      const line: ChatLine = {
        messages: [
          { role: "system", content: system },
          { role: "user", content: observationText(t, j) },
          { role: "assistant", content: JSON.stringify({ action: s.step.action, args: s.step.args ?? {} }) },
        ],
      };
      const r = s.pre.robot;
      const frame = {
        episode_index: e,
        frame_index: j,
        timestamp: s.pre.t,
        task: taskText,
        "observation.state": { x: r.x, y: r.y, waypoint: r.waypoint, torso_level: r.torso_level, arm_out: r.arm_out, reaching: r.reaching, holding: r.holding, grasp_mode: r.grasp_mode },
        action: { name: s.step.action, args: s.step.args ?? {} },
        "next.result": { ok: s.step.ok, reason: s.step.reason, t: s.step.t },
        "next.done": j === t.steps.length - 1,
        "next.success": j === t.steps.length - 1,
        source: { trial_id: t.trial_id, task_id: t.task.id, step_index: s.index, kind: t.kind, seed: t.seed, brain_version: t.brain_version, decision_source: t.decision_source, observation: "reconstructed", variant: t.variant ?? null },
      };
      for (const [value, out] of [
        [line, chat],
        [frame, robot],
      ] as const) {
        const text = JSON.stringify(value);
        if (text.includes("\n") || !same(JSON.parse(text), value)) throw new Error(`episode ${e} frame ${j} does not serialize to one JSON line`);
        out.push(text);
      }
      if (line.messages.some((m) => !m.content.trim())) throw new Error(`episode ${e} frame ${j} has an empty message`);
    });
    episodes.push({ episode_index: e, trial_id: t.trial_id, task_id: t.task.id, kind: t.kind, seed: t.seed, brain_version: t.brain_version, brain_sha256: t.brain_sha256, worker: t.worker, decision_source: t.decision_source, frames: t.steps.length, variant: t.variant ?? null });
  });
  return { chat: chat.length ? chat.join("\n") + "\n" : "", robot: robot.length ? robot.join("\n") + "\n" : "", rows: chat.length, episodes };
}
