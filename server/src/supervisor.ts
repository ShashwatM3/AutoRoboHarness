// The supervisor (B5): a tool-calling loop on Nemotron 3.5 Super VL that reviews a shift and returns
// { failures, insights, updates }. Evidence: the trajectories, the brain nodes in effect, sibling runs from
// other training shifts, and the RetailAction footage library. Every update is validated and compiled to BrainOps.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { TrajectoryStep } from "../../engine/store.ts";
import type { BrainStore } from "./brain.ts";
import { emit } from "./events.ts";
import { judgeReview, type JudgeResult } from "./judge.ts";
import { chat, MODELS, newTally, parseJson, tally, type LlmTally } from "./llm.ts";
import { compileUpdates, REVIEW_SCHEMA, type CompiledUpdate, type EvidenceById, type Update } from "./supervisor-ops.ts";
import { getShift, listShifts, taskContext, type Shift } from "./worker.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REVIEW_DIR = path.join(ROOT, "server/data/reviews");
const LIBRARY = path.join(ROOT, "ground_truth/library.json");
const MAX_ROUNDS = 8;

interface Clip {
  clip_id: string;
  action: string;
  frames: string[];
  sheet: string;
  description: string;
  hands: string;
  shelf_height: string;
  looked_or_touched_first: boolean | string;
  item_size: string;
}

export interface Review {
  shift_id: string;
  status: "running" | "done" | "error";
  error?: string;
  brain_version: number;
  model?: string;
  started_at: string;
  finished_at?: string;
  failures: { id: string; robot: string; task_id: string; step: number; check: string; nodes_in_effect: string[]; cause: string; verified: boolean; judge?: Verdict }[];
  insights: { id: string; claim: string; addresses: string[]; grounding: any[]; verified: boolean; judge?: Verdict }[];
  updates: (Update & CompiledUpdate & { judge_supported?: boolean })[];
  detected: ReturnType<typeof detectFailures>;
  evidence?: EvidenceById;
  tool_calls: { name: string; args: unknown }[];
  judge?: JudgeResult;
  llm?: LlmTally; // supervisor, clip and judge calls; reviews made before V2-2 have none
}

type Verdict = { keep: boolean; why: string };

const reviews = new Map<string, Review>();

export function getReview(shiftId: string): Review | undefined {
  if (reviews.has(shiftId)) return reviews.get(shiftId);
  const f = path.join(REVIEW_DIR, `${shiftId}.json`);
  if (fs.existsSync(f)) {
    const r = JSON.parse(fs.readFileSync(f, "utf8")) as Review;
    reviews.set(shiftId, r);
    return r;
  }
  return undefined;
}

let library: Clip[] | null = null;
export function clips(): Clip[] {
  if (!library) library = fs.existsSync(LIBRARY) ? (JSON.parse(fs.readFileSync(LIBRARY, "utf8")).clips as Clip[]) : [];
  return library;
}

// ---------- deterministic failure detection (what the engine's facts say, before any model) ----------

export function detectFailures(shift: Shift) {
  const out: { robot: string; task_id: string; step: number; action: string; args: unknown; reason: string; brain_nodes_read: string[] }[] = [];
  for (const s of shift.trajectory) if (!s.ok) out.push({ robot: s.robot, task_id: s.task_id ?? "", step: s.step, action: s.action, args: s.args, reason: s.reason, brain_nodes_read: s.brain_nodes_read });
  const incomplete = shift.scores.filter((s) => !s.complete).map((s) => ({ ...s, robot: shift.tasks.find((t) => t.id === s.task_id)?.robot }));
  return { refused_steps: out, incomplete_tasks: incomplete };
}

export const fmtStep = (s: TrajectoryStep) =>
  `${s.step}. ${s.action} ${JSON.stringify(s.args)} -> ${s.ok ? "ok" : "REFUSED"}: ${s.reason} | torso ${s.torso_level}, holding ${s.holding ?? "-"}, item at ${s.item_location ?? "-"}`;

// ---------- tools ----------

const TOOLS: ChatCompletionTool[] = [
  fn("list_steps", "All trajectory steps of one robot in this shift.", { robot: { type: "string" } }, ["robot"]),
  fn("get_step", "One step in full, including the brain nodes the robot had read.", { robot: { type: "string" }, step: { type: "integer" } }, ["robot", "step"]),
  fn("get_brain_nodes", "Brain nodes by id, with their props and edges.", { ids: { type: "array", items: { type: "string" } } }, ["ids"]),
  fn("find_sibling_runs", "Runs of the same task type in other training shifts, to compare a run that went better with one that failed.", { task_type: { type: "string", enum: ["PICK", "RESTOCK"] } }, ["task_type"]),
  fn(
    "get_human_clips",
    "Real ceiling-camera footage of shoppers in US convenience stores (RetailAction), with what each person's hands and body do.",
    {
      action: { type: "string", enum: ["take", "put", "touch"] },
      shelf_height: { type: "string", enum: ["top", "middle", "bottom"] },
      looked_or_touched_first: { type: "boolean" },
    },
    [],
  ),
  fn("inspect_clip", "Look at one clip's frames yourself and answer a question about it.", { clip_id: { type: "string" }, question: { type: "string" } }, ["clip_id", "question"]),
];

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[]): ChatCompletionTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

async function runTool(brain: BrainStore, shift: Shift, name: string, a: any, usage?: LlmTally): Promise<unknown> {
  switch (name) {
    case "list_steps":
      return shift.trajectory.filter((s) => s.robot === a.robot).map(fmtStep);
    case "get_step": {
      const s = shift.trajectory.find((x) => x.robot === a.robot && x.step === Number(a.step));
      if (!s) return { error: "no such step" };
      const { robot_state, path: _p, ...rest } = s as any;
      return rest;
    }
    case "get_brain_nodes": {
      const g = brain.graph(shift.brain_version);
      return (Array.isArray(a.ids) ? a.ids : []).slice(0, 20).map((id: string) =>
        g.hasNode(id)
          ? { ...g.getNodeAttributes(id), out: g.outEdges(id).map((e) => g.getEdgeAttributes(e)), in: g.inEdges(id).map((e) => g.getEdgeAttributes(e)) }
          : { id, error: "no such node" },
      );
    }
    case "find_sibling_runs": {
      // training shifts only: shifts are created with seeds 1-20, and gate re-runs are never saved as shifts
      const out: unknown[] = [];
      for (const s of listShifts()) {
        if (s.shift_id === shift.shift_id || s.status !== "done" || s.seed > 20) continue;
        const full = getShift(s.shift_id)!;
        for (const t of full.tasks.filter((t) => t.type === a.task_type)) {
          const score = full.scores.find((x) => x.task_id === t.id);
          out.push({
            run: `${full.shift_id}/${t.robot}`,
            seed: full.seed,
            brain_version: full.brain_version,
            item: t.card.item,
            source: t.source,
            target: t.target,
            complete: score?.complete,
            refused_actions: score?.refused_actions,
            steps: full.trajectory.filter((x) => x.task_id === t.id).map(fmtStep),
          });
        }
      }
      return out.slice(-6);
    }
    case "get_human_clips":
      return clips()
        .filter((c) => (!a.action || c.action === a.action) && (!a.shelf_height || c.shelf_height === a.shelf_height))
        .filter((c) => a.looked_or_touched_first === undefined || c.looked_or_touched_first === a.looked_or_touched_first)
        .slice(0, 6)
        .map(({ clip_id, action, description, hands, shelf_height, looked_or_touched_first, item_size }) => ({ clip_id, action, description, hands, shelf_height, looked_or_touched_first, item_size }));
    case "inspect_clip": {
      // Super VL takes one image per request, so each look is its own call on the clip's contact sheet
      const c = clips().find((x) => x.clip_id === a.clip_id);
      if (!c) return { error: "no such clip" };
      const b64 = fs.readFileSync(path.join(ROOT, c.sheet)).toString("base64");
      const res = await chat(
        {
          model: MODELS.supervisor,
          max_tokens: 400,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `Four frames of a shopper in a convenience store (red box: where the hand touches the item). ${String(a.question)}` },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
              ],
            },
          ],
        },
        { role: "clips", meta: { shift_id: shift.shift_id, clip_id: c.clip_id } },
      );
      if (usage) tally(usage, res);
      return { clip_id: c.clip_id, answer: res.choices[0]?.message?.content ?? "" };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

// ---------- prompts ----------

const SYSTEM = `You are the supervisor of a fleet of store robots (TIAGo-style: wheeled base, torso lift with 4 heights for shelf levels 1-4, one arm, gripper). After a shift you review the robots' trajectories, find the failures, work out why they happened, and propose edits to the robots' shared brain, a knowledge graph every robot reads before it acts.

An edit is kept only if robots using the edited brain score higher on store layouts nobody has seen, so propose general lessons, not fixes for one seed or one slot. A task scores as complete only if its item reaches the target with no refused actions; a refused action that the robot recovers from still fails the task.

How robots use the brain: they run the PROCEDURE steps in order, filling $task.* from their task card and $rule.<param> from the RULES whose conditions hold (deeper scope first, then higher priority); they apply a PROTOCOL when its trigger happens. A robot's task card gives the item (with weight), the source and target slot ids and waypoints, but not the shelf level. Slot ids are aisle-bay-level-position, so A-3-4-1 is level 4. Rule and step labels are what robots read, so write labels a robot can act on.

The engine's physical limits are not given to you. Infer them from refusal reasons, item weights and shelf levels in the trajectories and sibling runs.

Evidence: the shift's trajectories (list_steps, get_step), the brain nodes in effect (get_brain_nodes), runs of the same task in other training shifts (find_sibling_runs), and real ceiling-camera footage of shoppers in US convenience stores, RetailAction (get_human_clips, inspect_clip). Ground every insight in at least one clip or one contrast between two runs. Cite only clip ids and runs that the tools returned.

The only allowed brain edits:
- add_rule { scope, label, when: [{ field, op, value }], then: { param, value }, priority, cites }
  params: "grasp.mode" = "one_hand" | "two_hand"; "torso.level" = 1..4 or "$slot.level" (the level of the slot being reached)
  fields: "item.weight_kg", "slot.level", "task.type"; ops: > >= < <= == !=
  scopes: store, zone:backroom, zone:packing, aisle:A, bay:A-3, level:A-3-4, slot:A-3-4-1
  use a priority above 0 to override a default rule at the same scope
- insert_step { procedure, after_step (a step id, or null to go first), action, args, label, cites }
  actions: navigate_to {waypoint}, set_torso {level}, scan_slot {slot}, reach {slot}, grasp {mode}, retract {}, place {target}, report_issue {kind, detail}
  args may use $task.source, $task.target, $task.source_waypoint, $task.target_waypoint, $rule.grasp.mode, $rule.torso.level, $slot.level (the level of the slot the robot is working at)
- add_protocol { scope, label, trigger: slot_mismatch | slot_empty | grasp_refused | out_of_reach, response: [{ action, args }], then: "stop" | "continue", cites }
- set_parameter { node, key, value, cites }   (edits to a Guardrail need human approval)
- retire_node { node, reason, cites }
Every edit cites the failure ids (F1, F2, ...) and insight ids (I1, I2, ...) it addresses.

Use the tools to gather evidence (a few calls are enough), then reply with a short plain-text summary of what you found. You will then be asked for the final JSON.`;

function shiftDigest(brain: BrainStore, shift: Shift) {
  const det = detectFailures(shift);
  const L: string[] = [];
  L.push(`SHIFT ${shift.shift_id}: seed ${shift.seed}, brain v${shift.brain_version}`);
  for (const t of shift.tasks) {
    const sc = shift.scores.find((s) => s.task_id === t.id);
    L.push("");
    L.push(`TASK ${t.id} (${t.type}) by ${t.robot}: item ${t.card.item.id} "${t.card.item.name}" ${t.card.item.weight_kg} kg, ${t.source} -> ${t.target}`);
    L.push(`result: ${sc?.complete ? "COMPLETE" : "INCOMPLETE"}, ${sc?.refused_actions} refused actions, ${sc?.steps} steps, item ended at ${sc?.item_location}`);
    L.push("brain the robot read:");
    L.push(taskContext(brain, shift.brain_version, t).text.replace(/^/gm, "  "));
    L.push("steps:");
    for (const s of shift.trajectory.filter((x) => x.task_id === t.id)) L.push("  " + fmtStep(s));
  }
  L.push("");
  L.push(`REFUSED STEPS (engine facts): ${det.refused_steps.length ? det.refused_steps.map((r) => `${r.robot} step ${r.step} ${r.action} ${JSON.stringify(r.args)}: ${r.reason}`).join("; ") : "none"}`);
  return L.join("\n");
}

// ---------- the review ----------

export function startReview(brain: BrainStore, shiftId: string): Review {
  const shift = getShift(shiftId);
  if (!shift) throw Object.assign(new Error("no such shift"), { status: 404 });
  if (shift.status !== "done") throw Object.assign(new Error(`shift is ${shift.status}`), { status: 409 });
  const existing = getReview(shiftId);
  if (existing?.status === "running") return existing;

  const review: Review = {
    shift_id: shiftId,
    status: "running",
    brain_version: shift.brain_version,
    started_at: new Date().toISOString(),
    failures: [],
    insights: [],
    updates: [],
    detected: detectFailures(shift),
    tool_calls: [],
    llm: newTally(),
  };
  reviews.set(shiftId, review);
  runReview(brain, shift, review)
    .then(() => (review.status = "done"))
    .catch((e) => {
      console.error(e);
      review.status = "error";
      review.error = String(e?.message ?? e);
    })
    .finally(() => {
      review.finished_at = new Date().toISOString();
      saveReview(review);
      emit("review_done", { shift_id: shiftId, status: review.status, failures: review.failures.length, insights: review.insights.length, updates: review.updates.length, judge: judgeCounts(review), cache_share: review.llm?.cache_share ?? null });
    });
  return review;
}

function saveReview(review: Review) {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  fs.writeFileSync(path.join(REVIEW_DIR, `${review.shift_id}.json`), JSON.stringify(review, null, 2));
}

const judgeCounts = (r: Review) => (r.judge && !r.judge.error ? { kept: r.judge.kept.length, dropped: r.judge.dropped.length } : null);

/** Run the judge on a finished review, replacing any earlier verdicts (V2-1; works on reviews made before the judge). */
async function runJudge(brain: BrainStore, shift: Shift, review: Review) {
  emit("review_progress", { shift_id: shift.shift_id, stage: "judge", msg: `${MODELS.judge} is checking ${review.failures.length} failures and ${review.insights.length} insights` });
  try {
    review.judge = await judgeReview(brain, shift, review);
  } catch (e: any) {
    console.error(e);
    review.judge = { model: MODELS.judge, kept: [], dropped: [], finished_at: new Date().toISOString(), error: String(e?.message ?? e) };
  }
}

export async function rejudgeReview(brain: BrainStore, shiftId: string): Promise<Review> {
  const review = getReview(shiftId);
  if (!review) throw Object.assign(new Error("no review for that shift"), { status: 404 });
  if (review.status !== "done") throw Object.assign(new Error(`review is ${review.status}`), { status: 409 });
  await runJudge(brain, getShift(shiftId)!, review);
  saveReview(review);
  emit("review_done", { shift_id: shiftId, status: review.status, failures: review.failures.length, insights: review.insights.length, updates: review.updates.length, judge: judgeCounts(review), cache_share: review.llm?.cache_share ?? null });
  return review;
}

async function runReview(brain: BrainStore, shift: Shift, review: Review) {
  const progress = (stage: string, msg: string) => emit("review_progress", { shift_id: shift.shift_id, stage, msg });
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: shiftDigest(brain, shift) },
  ];

  let model: string = MODELS.supervisor;
  const send = async (params: Record<string, unknown>) => {
    const res = await chat({ model, messages, max_tokens: 2048, ...params } as any, { role: "supervisor", meta: { shift_id: shift.shift_id } });
    tally(review.llm!, res);
    return res;
  };
  const call = async (params: Record<string, unknown>) => {
    try {
      return await send(params);
    } catch (e: any) {
      if (model !== MODELS.supervisor_fallback && (e?.status === 400 || e?.status === 404 || e?.status >= 500)) {
        console.warn(`[supervisor] ${model} failed (${e?.status}); falling back to ${MODELS.supervisor_fallback}`);
        model = MODELS.supervisor_fallback;
        return await send(params);
      }
      throw e;
    }
  };

  progress("evidence", `reading ${shift.trajectory.length} steps`);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await call({ tools: TOOLS, tool_choice: "auto" });
    const msg = res.choices[0]?.message;
    const tcs = msg?.tool_calls?.filter((t) => t.type === "function") ?? [];
    if (!tcs.length) {
      messages.push({ role: "assistant", content: msg?.content ?? "" });
      break;
    }
    messages.push({ role: "assistant", content: msg?.content ?? null, tool_calls: tcs } as ChatCompletionMessageParam);
    for (const tc of tcs) {
      let args: any = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {}
      review.tool_calls.push({ name: tc.function.name, args });
      progress(tc.function.name === "get_human_clips" || tc.function.name === "inspect_clip" ? "clips" : tc.function.name === "find_sibling_runs" ? "siblings" : "evidence", `${tc.function.name} ${JSON.stringify(args)}`);
      const out = await runTool(brain, shift, tc.function.name, args, review.llm);
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 12000) });
    }
  }
  review.model = model;

  progress("updates", "writing failures, insights and brain edits");
  messages.push({
    role: "user",
    content:
      "Now write your review as one JSON object: { failures: [{ id, robot, task_id, step, check, nodes_in_effect, cause }], insights: [{ id, claim, addresses, grounding: [{ kind: \"clip\", clip_id, note } | { kind: \"run_contrast\", ok_run, failed_run, note }] }], updates: [{ id, summary, ops: [ ...brain edits with all their fields and cites ] }] }. One update per lesson, at most 3 updates, at most 5 ops each.",
  });
  let parsed: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await call({ response_format: { type: "json_schema", json_schema: { name: "review", schema: REVIEW_SCHEMA } } });
    } catch (e: any) {
      if (e?.status !== 400) throw e;
      res = await call({ response_format: { type: "json_object" } });
    }
    const text = res.choices[0]?.message?.content;
    try {
      parsed = parseJson(text);
    } catch (e: any) {
      if (attempt) throw e;
      messages.push({ role: "assistant", content: text ?? "" }, { role: "user", content: `That was not valid JSON (${e.message}). Reply with the JSON object only.` });
      continue;
    }
    const result = finalize(brain, shift, review, parsed);
    const bad = Object.entries(result).filter(([, c]) => !c.valid);
    if (!bad.length || attempt) break;
    // one repair round with the validator's errors
    progress("updates", `repairing ${bad.length} invalid update(s)`);
    messages.push(
      { role: "assistant", content: text ?? "" },
      { role: "user", content: `Some brain edits are invalid:\n${bad.map(([id, c]) => `${id}: ${c.errors.join("; ")}`).join("\n")}\nReturn the whole JSON again with these fixed.` },
    );
  }
  if (process.env.JUDGE !== "0") await runJudge(brain, shift, review);
}

/** Verify failures and insights against the facts, then validate and compile the updates. */
function finalize(brain: BrainStore, shift: Shift, review: Review, j: any): Record<string, CompiledUpdate> {
  const runs = new Set(shift.tasks.map((t) => `${shift.shift_id}/${t.robot}`));
  for (const s of listShifts()) for (const t of s.tasks) runs.add(`${s.shift_id}/${t.robot}`);
  const clipIds = new Map(clips().map((c) => [c.clip_id, c]));

  review.failures = (Array.isArray(j.failures) ? j.failures : []).map((f: any) => ({
    ...f,
    verified: shift.trajectory.some((s) => s.robot === f.robot && s.step === Number(f.step)),
  }));
  review.insights = (Array.isArray(j.insights) ? j.insights : []).map((ins: any) => {
    const grounding = (Array.isArray(ins.grounding) ? ins.grounding : []).map((g: any) => {
      if (g.kind === "clip") {
        const c = clipIds.get(g.clip_id);
        return { ...g, verified: !!c, frames: c?.frames, sheet: c?.sheet, label: c?.action, description: c?.description };
      }
      // the model sometimes decorates run ids ("shift-x/robot-1 (PICK, ...)"); keep the id, move the rest to the note.
      // It also cites the reviewed shift's runs by task id ("shift-x-t1"), as the digest lists them; map those to their robot.
      const runId = (s: unknown) => {
        const run = /shift-[a-z0-9]+\/robot-\d+/.exec(String(s ?? ""))?.[0];
        if (run) return run;
        const task = /(shift-[a-z0-9]+)-t\d+/.exec(String(s ?? ""));
        const robot = task && getShift(task[1])?.tasks.find((t) => t.id === task[0])?.robot;
        return robot ? `${task![1]}/${robot}` : String(s ?? "");
      };
      const ok_run = runId(g.ok_run);
      const failed_run = runId(g.failed_run);
      const extra = [g.ok_run, g.failed_run].filter((s) => s && !runs.has(s)).join("; ");
      return { ...g, ok_run, failed_run, note: extra ? `${g.note ?? ""} (${extra})`.trim() : g.note, verified: runs.has(ok_run) && runs.has(failed_run) && ok_run !== failed_run };
    });
    return { ...ins, grounding, verified: grounding.some((g: any) => g.verified) };
  });

  const known = new Set<string>([...review.failures.map((f) => f.id), ...review.insights.map((i) => i.id)]);
  const evidence: EvidenceById = {};
  for (const ins of review.insights) {
    const g = ins.grounding.find((x: any) => x.verified);
    if (!g) continue;
    evidence[ins.id] =
      g.kind === "clip"
        ? { type: "Evidence", label: `RetailAction clip ${g.clip_id}: ${ins.claim}`.slice(0, 160), props: { kind: "clip", clip_id: g.clip_id, frames: g.frames, sheet: g.sheet, note: g.note, shift_id: shift.shift_id } }
        : { type: "Evidence", label: `Runs ${g.ok_run} vs ${g.failed_run}: ${ins.claim}`.slice(0, 160), props: { kind: "run_contrast", ok_run: g.ok_run, failed_run: g.failed_run, note: g.note, shift_id: shift.shift_id } };
  }
  review.evidence = evidence;
  const updates: Update[] = (Array.isArray(j.updates) ? j.updates : []).slice(0, 3);
  const compiled = compileUpdates(brain, shift.brain_version, updates, known, evidence);
  review.updates = updates.map((u) => ({ ...u, ...compiled[u.id] }));
  return compiled;
}
