// The gate (B6): apply the supervisor's updates to a candidate brain, re-run the same tasks on held-out seeds
// 101-110 with the old and the candidate brain (same Lightning workers, headless, no event stream), and keep the
// candidate as the live brain only if the score rises. Only this module knows the held-out seeds; gate runs are
// never saved as shifts, so the supervisor cannot see them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createScenario, StoreEngine, type TaskScore } from "../../engine/store.ts";
import type { BrainStore } from "./brain.ts";
import { emit } from "./events.ts";
import { getReview } from "./supervisor.ts";
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

/** POST /brain/update: apply the chosen updates as a candidate version, then start the gate. */
export function updateBrain(brain: BrainStore, input: UpdateBrainInput): { gate: Gate; done: Promise<Gate> } {
  const review = getReview(input.shift_id);
  if (!review || review.status !== "done") throw Object.assign(new Error("no finished review for that shift"), { status: 409 });
  const shift = getShift(input.shift_id)!;
  const chosen = review.updates.filter((u) => (input.update_ids?.length ? input.update_ids.includes(u.id) : u.valid));
  if (!chosen.length) throw Object.assign(new Error("no updates selected"), { status: 400 });
  const invalid = chosen.filter((u) => !u.valid);
  if (invalid.length) throw Object.assign(new Error(`invalid updates: ${invalid.map((u) => `${u.id} (${u.errors.join("; ")})`).join(", ")}`), { status: 400 });
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
  brain.setStatus(gate.base, statusOf(gate.base), { heldout_score: b.complete_rate });
  brain.setStatus(gate.candidate, rises ? "live" : "rejected", { heldout_score: c.complete_rate });
  emit("brain_version", { v: gate.candidate, status: rises ? "live" : "rejected" });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
