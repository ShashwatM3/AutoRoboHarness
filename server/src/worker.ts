// Shift runner and worker agents (B3): one engine per shift, one Lightning worker per robot, in parallel.
// Each worker reads its brain scope, puts the brain text at the very start of its system prompt, then loops:
// the model picks one engine action as a tool call, the engine executes it, the result goes back.

import fs from "node:fs";
import path from "node:path";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { ActionResult, StoreEngine, Task, TaskScore, TrajectoryStep } from "../../engine/store.ts";
import type { BrainStore } from "./brain.ts";
import { emit } from "./events.ts";
import { claimInference } from "./inference-lock.ts";
import { chat, MODELS, newTally, tally, type LlmTally } from "./llm.ts";
import { dataDir, safeId } from "./paths.ts";
import { runCompiled } from "./policy.ts";
import { ENGINE_DEFAULT_MAX_SPEED, exactSelection, executeTrial, guardrailSpeed, prepareTrial, type PreparedTrial, type TrialRecord } from "./trials.ts";
import { writeJsonAtomic } from "./paths.ts";
import type { ResolvedContext } from "./types.ts";

const shiftsDir = () => dataDir("shifts");
const MAX_STEPS = 30;

export interface TaskSpec {
  robot?: string;
  type: "PICK" | "RESTOCK";
  slot: string;
}

export interface Shift {
  shift_id: string;
  seed: number;
  brain_version: number;
  worker: "llm" | "compiled";
  status: "running" | "done" | "error";
  error?: string;
  started_at: string;
  finished_at?: string;
  tasks: (Task & { card: TaskCard; finish_summary?: string })[];
  scores: TaskScore[];
  llm: LlmTally;
  trajectory: TrajectoryStep[];
  trial_id?: string; // its full recording (V2 extension); shifts made before it have none
  source?: { kind: "adversary"; adversary_id: string; disturbance: Record<string, unknown> };
}

const shifts = new Map<string, Shift>();

export function getShift(id: string): Shift | undefined {
  const sid = safeId(id, "shift_id");
  if (shifts.has(sid)) return shifts.get(sid);
  const f = path.join(shiftsDir(), `${sid}.json`);
  if (fs.existsSync(f)) {
    const s = JSON.parse(fs.readFileSync(f, "utf8")) as Shift;
    shifts.set(sid, s);
    return s;
  }
  return undefined;
}

/** Training shifts only: held-out and comparison runs are trials, never shifts, so they never appear here. */
export function listShifts(): Omit<Shift, "trajectory">[] {
  const onDisk = fs.existsSync(shiftsDir()) ? fs.readdirSync(shiftsDir()).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];
  const ids = new Set([...shifts.keys(), ...onDisk]);
  return [...ids].flatMap((id) => {
    let s: Shift | undefined;
    try {
      s = getShift(id);
    } catch {
      return []; // a stray file name that is not a valid id
    }
    if (!s) return [];
    const { trajectory, ...rest } = s;
    return [rest];
  });
}

/** Canonical training-run references, including V3 attack ids; tolerate descriptive model suffixes. */
export function normalizeRunReference(value: unknown): string {
  const text = String(value ?? "");
  const run = /\bshift-[A-Za-z0-9_-]+\/robot-[1-4]\b/.exec(text)?.[0];
  if (run && run.split('/')[0].length <= 81) return run;
  const task = /\b(shift-[A-Za-z0-9_-]+)-t[1-4]\b/.exec(text);
  if (task && task[1].length <= 81) {
    const robot = getShift(task[1])?.tasks.find(t => t.id === task[0])?.robot;
    if (robot) return `${task[1]}/${robot}`;
  }
  return text;
}

/** Only a completed, failed training attack may enter the supervisor's ordinary shift pool. */
export function publishAdversarialShift(trial: TrialRecord, adversary_id: string, disturbance: Record<string, unknown>): Shift {
  if (trial.kind !== "adversary" || trial.partition !== "training" || trial.seed < 1 || trial.seed > 20 || trial.status !== "done" || !trial.final || !trial.scores.length || trial.scores.every(s => s.complete))
    throw new RangeError("only failed completed adversarial training trials can become review inputs");
  const shift_id = safeId(trial.provenance.shift_id, "shift_id");
  if (getShift(shift_id)) throw new RangeError("an attack shift with this id already exists");
  const shift: Shift = {
    shift_id, seed: trial.seed, brain_version: trial.brain_version, worker: trial.worker,
    status: "done", started_at: trial.started_at, finished_at: trial.finished_at,
    tasks: trial.tasks, scores: trial.scores, trajectory: trial.trajectory, llm: trial.llm,
    trial_id: trial.trial_id, source: { kind: "adversary", adversary_id, disturbance },
  };
  shifts.set(shift_id, shift);
  writeJsonAtomic(path.join(shiftsDir(), `${shift_id}.json`), shift);
  return shift;
}

// ---------- the task card: what the worker is told about its task ----------

export interface TaskCard {
  task_id: string;
  type: "PICK" | "RESTOCK";
  item: { id: string; name: string; weight_kg: number };
  source: string;
  source_waypoint: string;
  source_level: number | null;
  target: string;
  target_waypoint: string;
  target_level: number | null;
}

export function taskCard(engine: StoreEngine, task: Task): TaskCard {
  const { slots } = engine.scenario.layout;
  const item = engine.scenario.items[task.item_id];
  const src = slots[task.source];
  const tgt = task.target === "tote" ? null : slots[task.target];
  return {
    task_id: task.id,
    type: task.type,
    item: { id: item.id, name: item.name, weight_kg: item.weight_kg },
    source: task.source,
    source_waypoint: src.waypoint,
    source_level: src.level,
    target: task.target,
    target_waypoint: tgt ? tgt.waypoint : "tote",
    target_level: tgt ? tgt.level : null,
  };
}

// ---------- brain context for a task ----------

/** The shelf slot is the task's main scope; the other end (backroom or tote) adds its own rules and protocols. */
export function taskContext(brain: BrainStore, v: number, task: Task) {
  const shelf = task.type === "PICK" ? task.source : task.target;
  const other = task.type === "PICK" ? task.target : task.source;
  const main = brain.resolve(v, shelf, task.type);
  const extra = brain.resolve(v, other, task.type);
  const seen = new Set(main.node_ids);
  const extraLines = [...extra.rules, ...extra.protocols, ...extra.guardrails]
    .filter((n) => !seen.has(n.id))
    .map((n) => extra.text.split("\n").find((l) => l.includes(`[${n.id}]`))!)
    .filter(Boolean);
  const text = extraLines.length ? `${main.text}\nALSO AT ${extra.scope_path[0]}\n${extraLines.join("\n")}` : main.text;
  const node_ids = [...new Set([...main.node_ids, ...extra.node_ids])];
  return { main, extra, text, node_ids };
}

// ---------- tools ----------

const TOOLS: ChatCompletionTool[] = [
  tool("navigate_to", "Drive to a waypoint. The arm must be retracted.", { waypoint: { type: "string", description: "waypoint id, e.g. A-3, backroom, tote" } }),
  tool("set_torso", "Raise or lower the torso to a shelf level's height. The arm must be retracted.", { level: { type: "integer", minimum: 1, maximum: 4 } }),
  tool("scan_slot", "Look at what is currently in a slot at your waypoint.", { slot: { type: "string" } }),
  tool("reach", "Extend the arm into a slot at your waypoint.", { slot: { type: "string" } }),
  tool("grasp", "Close the gripper on the item in the slot you are reaching into.", { mode: { type: "string", enum: ["one_hand", "two_hand"] } }),
  tool("retract", "Pull the arm back in.", {}),
  tool("place", "Put the held item into a slot you are reaching into, or into the tote when at the tote waypoint.", { target: { type: "string", description: "slot id or tote" } }),
  tool("report_issue", "Flag a problem for staff, e.g. a slot holding the wrong item or an empty slot.", { kind: { type: "string" }, detail: { type: "string" } }),
  tool("read_brain", "Read the brain nodes for another scope, e.g. a slot id or backroom.", { scope: { type: "string" } }),
  tool("finish", "End your task: it is done, or it cannot be done.", { summary: { type: "string" } }),
];

function tool(name: string, description: string, properties: Record<string, unknown>): ChatCompletionTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } } };
}

const INSTRUCTIONS = `You are a store robot shaped like PAL TIAGo: a wheeled base, a torso lift with four heights matching shelf levels 1 to 4, one arm and a gripper.
Follow the brain above. Run the PROCEDURE steps in order. Fill $task.* from the task card. Fill $rule.<param> from the RULES whose "when" conditions hold (a deeper scope wins, then higher priority). Obey the GUARDRAILS. Apply a PROTOCOL when its trigger happens.
Call exactly one tool per turn; you will get its result. If an action is refused, use the reason to decide what to do next. When the task is done, or cannot be done, call finish.`;

function observation(res: ActionResult) {
  const { robot, item, slot } = res.state;
  return {
    ok: res.ok,
    reason: res.reason,
    t: res.state.t,
    robot: { waypoint: robot.waypoint, torso_level: robot.torso_level, arm_out: robot.arm_out, reaching: robot.reaching, holding: robot.holding },
    ...(item ? { item: { id: item.id, name: item.name, weight_kg: item.weight_kg, location: item.slot } } : {}),
    ...(slot ? { slot: { id: slot.id, level: slot.level, waypoint: slot.waypoint } } : {}),
  };
}

// ---------- running a shift ----------

export interface StartShiftInput {
  seed: number;
  tasks: TaskSpec[];
  brain?: number | "live";
  worker?: "llm" | "compiled"; // compiled: the brain executed as written, no model calls
}

export function startShift(brain: BrainStore, input: StartShiftInput): Shift {
  const seed = Number(input.seed);
  if (!Number.isInteger(seed) || seed < 1 || seed > 20) throw Object.assign(new Error("training seeds are 1 to 20; held-out seeds are reserved for the gate"), { status: 400 });
  if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 4) throw Object.assign(new Error("tasks: 1 to 4 tasks, one per robot"), { status: 400 });
  const v = brain.resolveVersion(input.brain as any);
  const shift_id = `shift-${Date.now().toString(36)}`;
  const worker = input.worker === "compiled" ? "compiled" : "llm";

  // the guardrail is enforced by the engine
  const guard = guardrailSpeed(brain, v);
  const environment = { max_speed_mps: Math.min(guard ?? ENGINE_DEFAULT_MAX_SPEED, ENGINE_DEFAULT_MAX_SPEED), requested_max_speed_mps: null, guardrail_max_speed_mps: guard, engine_default_max_speed_mps: ENGINE_DEFAULT_MAX_SPEED };
  const release = worker === "llm" ? claimInference("shift", shift_id) : () => {};
  const llm = newTally();
  let prepared: PreparedTrial;
  try {
    prepared = prepareTrial(brain, {
      kind: "shift",
      partition: "training",
      seed,
      version: v,
      worker,
      run_id: shift_id,
      requested_tasks: input.tasks,
      selection: exactSelection(input.tasks, shift_id),
      robot_count: input.tasks.length,
      environment,
      provenance: { shift_id },
      headless: false,
      llm,
      onStep: (step) => emit("step", { ...step, shift_id, seed, brain_version: v }),
    });
  } catch (e: any) {
    release();
    throw Object.assign(new Error(`tasks: ${e.message}`), { status: 400 });
  }

  const shift: Shift = {
    shift_id,
    seed,
    brain_version: v,
    worker,
    status: "running",
    started_at: new Date().toISOString(),
    tasks: prepared.tasks,
    scores: [],
    llm,
    trajectory: [],
    trial_id: prepared.record.trial_id,
  };
  shifts.set(shift_id, shift);

  executeTrial(brain, prepared, worker === "compiled" ? runCompiled : runWorker)
    .then(({ trial, error }) => {
      if (error) console.error(error);
      shift.status = error ? "error" : "done";
      if (error) shift.error = trial.error;
      shift.trajectory = trial.trajectory;
      shift.scores = trial.scores;
    })
    .finally(() => {
      release();
      shift.finished_at = new Date().toISOString();
      fs.mkdirSync(shiftsDir(), { recursive: true });
      fs.writeFileSync(path.join(shiftsDir(), `${shift_id}.json`), JSON.stringify(shift, null, 2));
      emit("shift_done", { shift_id, status: shift.status, scores: shift.scores, llm: shift.llm, trial_id: shift.trial_id });
    });
  return shift;
}

/** What a worker needs from its run: a shift, or a headless gate re-run (no events, not saved as a shift). */
export interface RunCtx {
  shift_id: string;
  brain_version: number;
  llm: Shift["llm"];
  headless?: boolean;
}

export async function runWorker(brain: BrainStore, engine: StoreEngine, shift: RunCtx, task: Shift["tasks"][number]) {
  const robot = task.robot;
  const ctx = taskContext(brain, shift.brain_version, task);
  engine.setBrainNodesRead(robot, ctx.node_ids);
  if (!shift.headless) emit("brain_read", { shift_id: shift.shift_id, robot, version: shift.brain_version, node_ids: ctx.node_ids });

  // The card is what an order system knows: item, weight, slot and waypoint. Shelf heights are store knowledge,
  // so the level is not on the card; it comes from the brain or from scanning the slot.
  const c = task.card;
  const r0 = engine.scenario.robots[robot];
  // $slot.level in a step is the level of the slot being worked: the source until the grasp, then the target
  const levelOf = (slot: string) => engine.scenario.layout.slots[slot]?.level;
  let held = false;
  const plan = (ctx.main.procedure?.steps ?? []).map((s, i) => {
    const slotLevel = levelOf(held ? c.target : c.source);
    if (s.action === "grasp") held = true;
    const fill = (val: unknown) =>
      typeof val !== "string" ? val : val.startsWith("$task.") ? ((c as any)[val.slice(6)] ?? val) : val === "$slot.level" ? (slotLevel ?? val) : val;
    const args = Object.entries(s.args)
      .map(([k, val]) => `${k}=${fill(val)}`)
      .join(" ");
    return `  ${i + 1}. ${s.action}${args ? " " + args : ""}`;
  });
  const card = [
    `TASK ${c.task_id} (${c.type}) for ${robot}`,
    `item: ${c.item.id} "${c.item.name}", ${c.item.weight_kg} kg`,
    `source: ${c.source} (waypoint ${c.source_waypoint})`,
    `target: ${c.target} (waypoint ${c.target_waypoint})`,
    `you are at ${r0.waypoint}, torso level ${r0.torso_level}, arm ${r0.arm_out ? "extended" : "retracted"}, holding ${r0.holding ?? "nothing"}`,
    `the procedure with this task's values ($rule.* comes from the RULES):`,
    ...plan,
    // only once the brain has learned something in terms of $slot.level (day-one brains never mention it)
    ...(ctx.text.includes("$slot.level") ? ["$slot.level means the shelf level of the slot you are working at: the third part of its id (A-3-4-1 is level 4)."] : []),
  ].join("\n");

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: `${ctx.text}\n\n${INSTRUCTIONS}` },
    { role: "user", content: card },
  ];

  let actions = 0;
  let idle = 0;
  while (actions < MAX_STEPS) {
    const res = await chat(
      { model: MODELS.worker, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 1024 },
      { role: shift.headless ? "gate-worker" : "worker", meta: { shift_id: shift.shift_id, robot } },
    );
    tally(shift.llm, res);
    const msg = res.choices[0]?.message;
    const calls = msg?.tool_calls?.filter((tc) => tc.type === "function") ?? [];
    if (!calls.length) {
      if (++idle >= 2) return;
      messages.push({ role: "assistant", content: msg?.content ?? "" });
      messages.push({ role: "user", content: "Call one of the tools." });
      continue;
    }
    idle = 0;
    messages.push({ role: "assistant", content: msg?.content ?? null, tool_calls: calls } as ChatCompletionMessageParam);

    let finished = false;
    for (const tc of calls) {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: false, reason: "arguments were not valid JSON" }) });
        continue;
      }
      let out: unknown;
      if (finished) {
        out = { ok: false, reason: "task already finished" };
      } else if (tc.function.name === "finish") {
        task.finish_summary = String(args.summary ?? "");
        finished = true;
        out = { ok: true };
      } else if (tc.function.name === "read_brain") {
        const rc = brain.resolve(shift.brain_version, String(args.scope ?? "store"), task.type);
        engine.setBrainNodesRead(robot, [...new Set([...ctx.node_ids, ...rc.node_ids])]);
        if (!shift.headless) emit("brain_read", { shift_id: shift.shift_id, robot, version: shift.brain_version, node_ids: rc.node_ids });
        out = { ok: true, brain: rc.text };
      } else {
        out = observation(act(engine, robot, tc.function.name, args));
        actions++;
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
    }
    if (finished) break;
    // done as soon as the item is at its target; saves a model call
    if (engine.scenario.items[task.item_id].slot === task.target) break;
  }
  if (!shift.headless) emit("task_done", { shift_id: shift.shift_id, robot, task_id: task.id, score: engine.score().find((s) => s.task_id === task.id) });
}

/** Execute one contract action on the engine. Unknown actions are recorded as refused by the engine's own checks. */
export function act(engine: StoreEngine, robot: string, action: string, a: Record<string, any>): ActionResult {
  switch (action) {
    case "navigate_to":
      return engine.navigate_to(robot, String(a.waypoint));
    case "set_torso":
      return engine.set_torso(robot, Number(a.level));
    case "scan_slot":
      return engine.scan_slot(robot, String(a.slot));
    case "reach":
      return engine.reach(robot, String(a.slot));
    case "grasp":
      return engine.grasp(robot, a.mode);
    case "retract":
      return engine.retract(robot);
    case "place":
      return engine.place(robot, String(a.target));
    case "report_issue":
      return engine.report_issue(robot, String(a.kind ?? ""), String(a.detail ?? ""));
    default:
      return engine.report_issue(robot, "unknown_action", `worker asked for ${action}`);
  }
}
