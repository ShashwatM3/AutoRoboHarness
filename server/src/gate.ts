// The gate (B6): apply the supervisor's updates to a candidate brain, re-run the same tasks on held-out seeds
// 101-110 with the old and the candidate brain (same Lightning workers, headless, no event stream), and keep the
// candidate as the live brain only if the score rises. Only this module knows the held-out seeds; gate runs are
// never saved as shifts, so the supervisor cannot see them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createScenario, StoreEngine, type TaskScore } from "../../engine/store.ts";
import { httpError, type BrainStore } from "./brain.ts";
import { emit } from "./events.ts";
import { getReview, type Review } from "./supervisor.ts";
import { compileUpdates } from "./supervisor-ops.ts";
import type { BrainDiff, BrainOp } from "./types.ts";
import { getShift, runWorker, taskCard, type RunCtx, type TaskSpec } from "./worker.ts";
import { runCompiled } from "./policy.ts";
import { newTally } from "./llm.ts";

const HELDOUT_SEEDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
const GATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/gates");

interface Score {
  tasks: number;
  complete: number;
  complete_rate: number;
  refused_per_task: number;
  steps_per_task: number;
}

export interface Gate {
  gate_id: string;
  status: "running" | "done" | "error";
  error?: string;
  shift_id: string;
  update_ids: string[];
  judge_policy?: JudgePolicy; // how the review's judge bore on update_ids; gates made before V2 have none
  base: number;
  candidate: number;
  seeds: number[];
  tasks: TaskSpec[];
  worker: "compiled" | "llm";
  progress: { done: number; total: number };
  per_seed: { seed: number; skipped: string[]; base: TaskScore[]; candidate: TaskScore[] }[]; // skipped also lists substitutions
  base_score?: Score;
  candidate_score?: Score;
  delta?: number;
  verdict?: "promoted" | "rejected";
  reason?: string;
  diff: BrainDiff;
  llm: RunCtx["llm"];
  started_at: string;
  finished_at?: string;
}

const gates = new Map<string, Gate>();

export function getGate(id: string): Gate | undefined {
  if (gates.has(id)) return gates.get(id);
  const f = path.join(GATE_DIR, `${id}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : undefined;
}

export interface UpdateBrainInput {
  shift_id: string;
  update_ids?: string[];
  approve_guardrails?: boolean;
  worker?: "compiled" | "llm"; // compiled (default): the brain executed as written; llm: Lightning workers, slow at our rate limit
  seeds?: number; // how many held-out seeds to use, 1 to 10 (default 10)
}

/** enforced: only updates the judge supported can be gated. disabled: JUDGE=0 and the review has no verdicts.
 *  v1_review: a review made before Version 2 (no judge, no token tally), gated on `valid` alone as in Version 1. */
export type JudgePolicy = "enforced" | "disabled" | "v1_review";

/** Choose a review's updates for the gate (V2), or throw before anything is compiled, applied or run.
 *  Omitting update_ids takes every valid update the judge supported; naming them takes exactly those, and each
 *  must be valid and judge-supported. A failed judge, or a missing one on a Version 2 review, blocks the gate
 *  until POST /review/:shiftId/judge succeeds, unless JUDGE=0 turns the judge off. */
export function selectUpdates(review: Review, update_ids: unknown, judgeOn = process.env.JUDGE !== "0"): { chosen: Review["updates"]; judge_policy: JudgePolicy } {
  const named = update_ids !== undefined && update_ids !== null;
  if (named && (!Array.isArray(update_ids) || !update_ids.length))
    throw httpError(400, "update_ids must list at least one update id; leave it out to take every valid, judge-supported update", { code: "bad_update_ids" });
  const ids = named ? (update_ids as unknown[]).map(String) : [];
  const unknown = ids.filter((id) => !review.updates.some((u) => u.id === id));
  if (unknown.length) throw httpError(400, `no such updates in this review: ${unknown.join(", ")}`, { code: "unknown_updates", update_ids: unknown });

  const rejudge = `POST /review/${review.shift_id}/judge`;
  let judge_policy: JudgePolicy;
  if (review.judge?.error) throw httpError(409, `the judge failed on this review (${review.judge.error}); re-run ${rejudge} before updating the brain`, { code: "judge_failed" });
  if (review.judge) judge_policy = "enforced";
  else if (!review.llm) judge_policy = "v1_review";
  else if (!judgeOn) judge_policy = "disabled";
  else throw httpError(409, `this review has no judge verdicts; run ${rejudge} first (or turn the judge off with JUDGE=0)`, { code: "judge_missing" });

  const supported = (u: Review["updates"][number]) => judge_policy !== "enforced" || u.judge_supported === true;
  const chosen = named ? review.updates.filter((u) => ids.includes(u.id)) : review.updates.filter((u) => u.valid && supported(u));
  if (!chosen.length) throw httpError(400, judge_policy === "enforced" ? "no valid, judge-supported updates in this review" : "no valid updates in this review", { code: "no_updates" });
  const invalid = chosen.filter((u) => !u.valid);
  if (invalid.length) throw httpError(400, `invalid updates: ${invalid.map((u) => `${u.id} (${u.errors.join("; ")})`).join(", ")}`, { code: "invalid_updates", update_ids: invalid.map((u) => u.id) });
  const unsupported = chosen.filter((u) => !supported(u));
  if (unsupported.length)
    throw httpError(409, `the judge does not support ${unsupported.map((u) => u.id).join(", ")}: no finding they cite survived it`, { code: "judge_unsupported", update_ids: unsupported.map((u) => u.id) });
  return { chosen, judge_policy };
}

/** POST /brain/update: apply the chosen updates as a candidate version, then start the gate. */
export function updateBrain(brain: BrainStore, input: UpdateBrainInput): { gate: Gate; done: Promise<Gate> } {
  const review = getReview(input.shift_id);
  if (!review || review.status !== "done") throw Object.assign(new Error("no finished review for that shift"), { status: 409 });
  const shift = getShift(input.shift_id)!;
  const { chosen, judge_policy } = selectUpdates(review, input.update_ids);
  if (chosen.some((u) => u.touches_guardrail) && !input.approve_guardrails)
    throw Object.assign(new Error("an update changes a guardrail; resend with approve_guardrails: true to approve it"), { status: 403 });

  // compile against the live brain; the stored compilation is reused when the review was made on it
  const base = brain.index().live;
  let ops: BrainOp[];
  if (review.brain_version === base) {
    ops = chosen.flatMap((u) => u.compiled);
  } else {
    const known = new Set([...review.failures.map((f) => f.id), ...review.insights.map((i) => i.id)]);
    const fresh = compileUpdates(brain, base, chosen, known, review.evidence ?? {});
    const bad = Object.entries(fresh).filter(([, c]) => !c.valid);
    if (bad.length) throw Object.assign(new Error(`updates no longer apply to live brain v${base}: ${bad.map(([id, c]) => `${id}: ${c.errors.join("; ")}`).join(", ")}`), { status: 409 });
    ops = chosen.flatMap((u) => fresh[u.id].compiled);
  }
  const note = chosen.map((u) => `${u.id}: ${u.summary}`).join(" | ");
  const { version: candidate, diff } = brain.apply(base, ops, { created_by: "supervisor", note });
  emit("brain_version", { v: candidate, status: "candidate" });

  const tasks: TaskSpec[] = shift.tasks.map((t) => ({ type: t.type, slot: t.type === "PICK" ? t.source : t.target }));
  const gate: Gate = {
    gate_id: `gate-${Date.now().toString(36)}`,
    status: "running",
    shift_id: input.shift_id,
    update_ids: chosen.map((u) => u.id),
    judge_policy,
    base,
    candidate,
    seeds: HELDOUT_SEEDS.slice(0, Math.min(10, Math.max(1, Number(input.seeds ?? 10)))),
    tasks,
    worker: input.worker === "llm" ? "llm" : "compiled",
    progress: { done: 0, total: 0 },
    per_seed: [],
    diff,
    llm: newTally(),
    started_at: new Date().toISOString(),
  };
  gates.set(gate.gate_id, gate);
  const done = runGate(brain, gate)
    .then(() => {
      gate.status = "done";
    })
    .catch((e) => {
      console.error(e);
      gate.status = "error";
      gate.error = String(e?.message ?? e);
      brain.setStatus(candidate, "rejected");
    })
    .then(() => {
      gate.finished_at = new Date().toISOString();
      fs.mkdirSync(GATE_DIR, { recursive: true });
      fs.writeFileSync(path.join(GATE_DIR, `${gate.gate_id}.json`), JSON.stringify(gate, null, 2));
      emit("gate_done", { gate_id: gate.gate_id, status: gate.status, verdict: gate.verdict, base_score: gate.base_score, candidate_score: gate.candidate_score, reason: gate.reason });
      return gate;
    });
  return { gate, done };
}

/** Whether a task can be done in a seed's world: not a PICK whose item is in reserve, not a RESTOCK into a
 *  slot that is already stocked. */
function feasible(s: ReturnType<typeof createScenario>, type: TaskSpec["type"], slot: string): boolean {
  if (type === "RESTOCK") return !Object.values(s.items).some((i) => i.slot === slot);
  return !s.items[`item:${slot}`]?.slot.startsWith("reserve:");
}

/** The task as given if it can be done in this seed; otherwise the nearest slot of the same type on the same
 *  aisle and shelf level (same difficulty), the same for both brains. Null if there is none. */
function taskForSeed(seed: number, t: TaskSpec): { task: TaskSpec; note?: string } | null {
  const s = createScenario(seed, 1);
  if (feasible(s, t.type, t.slot)) return { task: t };
  const [aisle, bay, level, pos] = t.slot.split("-");
  const options = Object.values(s.layout.slots)
    .filter((x) => x.aisle === aisle && String(x.level) === level && x.id !== t.slot && feasible(s, t.type, x.id))
    .sort((a, b) => Math.abs(a.bay - Number(bay)) - Math.abs(b.bay - Number(bay)) || Math.abs(a.position - Number(pos)) - Math.abs(b.position - Number(pos)));
  if (!options.length) return null;
  return { task: { type: t.type, slot: options[0].id }, note: `${t.type} ${t.slot} -> ${options[0].id} (${t.type === "RESTOCK" ? "slot already stocked" : "item in reserve"} in seed ${seed})` };
}

async function runGate(brain: BrainStore, gate: Gate) {
  const guard = brain.resolve(gate.base, "store").guardrails.find((g) => g.props.param === "max_speed_mps");
  const maxSpeed = guard ? Math.min(Number(guard.props.value), 0.8) : undefined;

  const plan = gate.seeds.map((seed) => {
    const skipped: string[] = [];
    const tasks: TaskSpec[] = [];
    for (const t of gate.tasks) {
      const r = taskForSeed(seed, t);
      if (!r) skipped.push(`${t.type} ${t.slot}: no feasible slot on that level in seed ${seed}`);
      else {
        tasks.push(r.task);
        if (r.note) skipped.push(r.note);
      }
    }
    return { seed, skipped, tasks };
  });
  gate.progress.total = plan.reduce((n, p) => n + p.tasks.length * 2, 0);

  const runOne = async (seed: number, tasks: TaskSpec[], v: number): Promise<TaskScore[]> => {
    if (!tasks.length) return [];
    const engine = new StoreEngine(createScenario(seed, tasks.length), { maxSpeed });
    const ctx: RunCtx = { shift_id: `${gate.gate_id}-s${seed}-v${v}`, brain_version: v, llm: gate.llm, headless: true };
    const created = tasks.map((t, i) => {
      const task = engine.createTask(`robot-${i + 1}`, t.type, t.slot, `${ctx.shift_id}-t${i + 1}`);
      return { ...task, card: taskCard(engine, task) };
    });
    const workers = await Promise.allSettled(
      created.map((t) =>
        (gate.worker === "llm" ? runWorker : runCompiled)(brain, engine, ctx, t).finally(() => {
          gate.progress.done++;
          emit("gate_progress", { gate_id: gate.gate_id, done: gate.progress.done, total: gate.progress.total });
        }),
      ),
    );
    // Do not report a terminal gate while a sibling worker still spends quota.
    const failed = workers.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    return engine.score();
  };

  // Keep the evaluation bounded: finish a seed/version before starting the next.
  // A fatal provider error stops new work; only the current robot workers drain.
  gate.per_seed = [];
  for (const p of plan) {
    const base = await runOne(p.seed, p.tasks, gate.base);
    const candidate = await runOne(p.seed, p.tasks, gate.candidate);
    gate.per_seed.push({ seed: p.seed, skipped: p.skipped, base, candidate });
  }

  const agg = (key: "base" | "candidate"): Score => {
    const all = gate.per_seed.flatMap((p) => p[key]);
    const n = all.length || 1;
    const complete = all.filter((s) => s.complete).length;
    return {
      tasks: all.length,
      complete,
      complete_rate: +(complete / n).toFixed(3),
      refused_per_task: +(all.reduce((a, s) => a + s.refused_actions, 0) / n).toFixed(2),
      steps_per_task: +(all.reduce((a, s) => a + s.steps, 0) / n).toFixed(2),
    };
  };
  gate.base_score = agg("base");
  gate.candidate_score = agg("candidate");
  gate.delta = +(gate.candidate_score.complete_rate - gate.base_score.complete_rate).toFixed(3);

  // the score rises if more tasks complete, or as many complete with fewer refused actions
  const b = gate.base_score;
  const c = gate.candidate_score;
  const rises = c.tasks > 0 && (c.complete_rate > b.complete_rate || (c.complete_rate === b.complete_rate && c.refused_per_task < b.refused_per_task));
  gate.verdict = rises ? "promoted" : "rejected";
  gate.reason = rises
    ? `held-out completion ${pct(b.complete_rate)} -> ${pct(c.complete_rate)}, refused actions per task ${b.refused_per_task} -> ${c.refused_per_task}`
    : `no gain on held-out seeds: completion ${pct(b.complete_rate)} -> ${pct(c.complete_rate)}, refused actions per task ${b.refused_per_task} -> ${c.refused_per_task}`;

  const statusOf = (v: number) => brain.index().versions.find((r) => r.v === v)?.status ?? "candidate";
  // record how each score was measured: compiled and Lightning scores are not comparable
  const measured = (s: Score) => ({ gate_id: gate.gate_id, worker: gate.worker, seeds: gate.seeds.length, tasks: s.tasks, complete: s.complete, refused_per_task: s.refused_per_task, measured_at: new Date().toISOString() });
  brain.setStatus(gate.base, statusOf(gate.base), { heldout_score: b.complete_rate, heldout: measured(b) });
  brain.setStatus(gate.candidate, rises ? "live" : "rejected", { heldout_score: c.complete_rate, heldout: measured(c) });
  emit("brain_version", { v: gate.candidate, status: rises ? "live" : "rejected" });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
