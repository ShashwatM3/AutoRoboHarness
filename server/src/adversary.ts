import path from "node:path";
import crypto from "node:crypto";
import type { Router } from "express";
import { createScenario } from "../../engine/store.ts";
import { applyDisturbance, type Disturbance } from "../../engine/disturbances.ts";
import { httpError, type BrainStore } from "./brain.ts";
import { emit } from "./events.ts";
import { claimInference } from "./inference-lock.ts";
import { chat, newTally, tally, type LlmTally } from "./llm.ts";
import { dataDir, readJsonDir, safeId, writeJsonAtomic } from "./paths.ts";
import { runCompiled } from "./policy.ts";
import { startReview } from "./supervisor.ts";
import { executeTrial, guardrailSpeed, prepareTrial, selectTasks, type Runner, type WorkerKind } from "./trials.ts";
import { getShift, publishAdversarialShift, runWorker, type TaskSpec } from "./worker.ts";

type Status = "running" | "done" | "error" | "interrupted";
export interface AttackAttempt {
  candidate: number; disturbance: Disturbance; rationale: string;
  status: "pending" | "running" | "done" | "error";
  trial_id?: string; shift_id?: string; broken?: boolean; error?: string;
  successes?: number; tasks?: number; refusals?: number;
}
export interface Attack {
  adversary_id: string; status: Status; error?: string;
  brain_version: number; brain_sha256: string; seed: number; task: TaskSpec;
  worker: WorkerKind; proposer: "llm" | "catalog"; model: string | null;
  started_at: string; updated_at: string; finished_at?: string;
  tried: number; broke: number; attempts: AttackAttempt[]; llm: LlmTally;
}
export interface AttackInput { shift_id?: string; seed?: number; task?: TaskSpec; brain?: number | "live"; attempts?: number; worker?: WorkerKind; proposer?: "llm" | "catalog" }
const directory = () => dataDir("adversary");
const save = (a: Attack) => { a.updated_at = new Date().toISOString(); writeJsonAtomic(path.join(directory(), `${a.adversary_id}.json`), a); emit("adversary_progress", { ...a }); };
export const listAttacks = () => readJsonDir<Attack>(directory()).sort((a, b) => b.started_at.localeCompare(a.started_at));
export const getAttack = (id: string) => listAttacks().find(a => a.adversary_id === safeId(id, "adversary_id"));
export function recoverInterruptedAttacks() {
  for (const a of listAttacks()) if (a.status === "running") { a.status = "interrupted"; a.error = "server restarted; no attack or model call was resumed"; a.finished_at = new Date().toISOString(); save(a); }
}

/** The model selects within this finite, engine-validated catalog. It cannot invent physical parameters. */
export function attackCatalog(seed: number, task: TaskSpec): Disturbance[] {
  const s = createScenario(seed, 1), slot = s.layout.slots[task.slot], item = s.items[`item:${task.slot}`];
  if (!slot || !item || !['A', 'B'].includes(slot.aisle)) throw httpError(400, "task needs a real shelf slot");
  const aisle = slot.aisle;
  const target = Object.values(s.layout.slots).find(x => x.aisle === aisle && x.level === 4 && x.id !== item.slot)!;
  const other = Object.values(s.items).find(x => x.id !== item.id && s.layout.slots[x.slot]?.aisle === aisle && x.slot !== task.slot)!;
  const choices: Disturbance[] = [
    { kind: "blocked_aisle", params: { from: `${aisle}-entrance`, to: `${aisle}-1` } },
    { kind: "wrong_slot", params: { item_id: item.id, target_slot: other.slot } },
    { kind: "heavy_top_shelf", params: { item_id: item.id, target_slot: target.id, weight_kg: 3.8 } },
    { kind: "behind_fresh", params: { item_id: item.id, fresh_item_id: other.id } },
  ];
  return choices.filter(c => { try { applyDisturbance(s, c.kind, c.params); return true; } catch { return false; } });
}

export interface AttackDeps {
  choose?: (brain: BrainStore, a: Attack, catalog: Disturbance[], count: number) => Promise<{ candidate: number; rationale: string }[]>;
  runner?: Runner;
}
async function choose(brain: BrainStore, a: Attack, catalog: Disturbance[], count: number) {
  if (a.proposer === "catalog") return catalog.slice(0, count).map((_, candidate) => ({ candidate, rationale: "Catalog sweep; no adversary model call." }));
  const response = await chat({
    model: a.model!, max_tokens: 1200, response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You test store robots. Choose distinct entries from the supplied finite catalog that might reveal gaps in the current brain. Do not invent disturbances. Return JSON {\"choices\":[{\"candidate\":0,\"rationale\":\"why\"}]}. A safe refusal or incomplete delivery can reveal a gap. Keep all choices within the requested count." },
      { role: "user", content: JSON.stringify({ brain: brain.resolve(a.brain_version, a.task.slot, a.task.type).text, seed: a.seed, task: a.task, count, catalog: catalog.map((d, candidate) => ({ candidate, ...d })) }) },
    ],
  }, { role: "adversary", meta: { adversary_id: a.adversary_id } });
  tally(a.llm, response);
  let result: unknown;
  try { result = JSON.parse(response.choices[0]?.message.content ?? ""); } catch { throw new Error("adversary did not return valid JSON; no attacks were invented"); }
  const rows = (result as { choices?: unknown[] })?.choices;
  if (!Array.isArray(rows) || !rows.length || rows.length > count) throw new Error("invalid adversary selection count");
  const seen = new Set<number>();
  return rows.map(value => {
    const r = value as { candidate?: unknown; rationale?: unknown };
    if (typeof r?.candidate !== "number" || !Number.isInteger(r.candidate) || !catalog[r.candidate] || seen.has(r.candidate) || typeof r.rationale !== "string" || !r.rationale.trim()) throw new Error("adversary chose an invalid or duplicate catalog entry");
    seen.add(r.candidate); return { candidate: r.candidate, rationale: r.rationale.slice(0, 1500) };
  });
}

export function startAttack(brain: BrainStore, input: AttackInput, deps: AttackDeps = {}): { attack: Attack; done: Promise<Attack> } {
  const source = input.shift_id ? getShift(safeId(input.shift_id, "shift_id")) : undefined;
  if (input.shift_id && !source) throw httpError(404, "no training shift with that id");
  const seed = input.seed ?? source?.seed ?? 1;
  if (!Number.isInteger(seed) || seed < 1 || seed > 20) throw httpError(400, "adversary uses training seeds 1 to 20 only");
  const raw = input.task ?? (source?.tasks[0] ? { type: source.tasks[0].type, slot: source.tasks[0].type === "PICK" ? source.tasks[0].source : source.tasks[0].target } : { type: "PICK", slot: "A-1-3-1" });
  if (!raw || !['PICK', 'RESTOCK'].includes(raw.type) || typeof raw.slot !== "string") throw httpError(400, "supply a PICK or RESTOCK task and shelf slot");
  const actual = selectTasks(seed, [raw], "probe")[0].actual;
  if (!actual) throw httpError(400, "no feasible training task for this seed");
  const task: TaskSpec = { type: actual.type, slot: actual.slot };
  const version = brain.resolveVersion(input.brain ?? "live");
  const catalog = attackCatalog(seed, task);
  const count = input.attempts ?? Math.min(4, catalog.length);
  if (!Number.isInteger(count) || count < 1 || count > catalog.length) throw httpError(400, `attempts must be 1 to ${catalog.length}`);
  if (input.worker !== undefined && !["llm", "compiled"].includes(input.worker)) throw httpError(400, "worker must be llm or compiled");
  if (input.proposer !== undefined && !["llm", "catalog"].includes(input.proposer)) throw httpError(400, "proposer must be llm or catalog");
  const id = `adv-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const worker = input.worker ?? "llm", proposer = input.proposer ?? "llm";
  const release = worker === "llm" || proposer === "llm" ? claimInference("adversary", id) : () => {};
  const now = new Date().toISOString();
  const attack: Attack = { adversary_id: id, status: "running", brain_version: version, brain_sha256: brain.fileSha256(version), seed, task, worker, proposer, model: proposer === "llm" ? (process.env.ADVERSARY_MODEL ?? "zai-org/GLM-5.3") : null, started_at: now, updated_at: now, tried: 0, broke: 0, attempts: [], llm: newTally() };
  try { save(attack); } catch (e) { release(); throw e; }
  const done = (async () => {
    try {
      const selected = await (deps.choose ?? choose)(brain, attack, catalog, count);
      // Also validate injected chooser output; tests never bypass the physical catalog.
      if (!selected.length || selected.length > count || new Set(selected.map(c => c.candidate)).size !== selected.length || selected.some(c => !Number.isInteger(c.candidate) || !catalog[c.candidate])) throw new Error("invalid catalog selection");
      attack.attempts = selected.map(c => ({ ...c, disturbance: catalog[c.candidate], status: "pending" })); save(attack);
      for (const [i, attempt] of attack.attempts.entries()) {
        attempt.status = "running"; save(attack);
        try {
          const scenario = applyDisturbance(createScenario(seed, 1), attempt.disturbance.kind, attempt.disturbance.params);
          const shift_id = `shift-${id}-${i + 1}`;
          const speed = Math.min(0.8, guardrailSpeed(brain, version) ?? 0.8);
          const p = prepareTrial(brain, { kind: "adversary", partition: "training", seed, version, worker, run_id: shift_id, requested_tasks: [task], selection: [{ index: 0, requested: task, actual: { ...task, robot: "robot-1" }, substituted: task.slot !== raw.slot, robot: "robot-1", task_id: `${shift_id}-t1` }], robot_count: 1, scenario, environment: { max_speed_mps: speed, requested_max_speed_mps: null, guardrail_max_speed_mps: guardrailSpeed(brain, version), engine_default_max_speed_mps: 0.8 }, provenance: { adversary_id: id, shift_id, augmentation: { disturbance: attempt.disturbance } }, headless: true, llm: newTally() });
          attempt.trial_id = p.record.trial_id; save(attack);
          const { trial, error } = await executeTrial(brain, p, deps.runner ?? (worker === "llm" ? runWorker : runCompiled));
          for (const key of ['calls', 'prompt_tokens', 'completion_tokens', 'replayed'] as const) if (key in trial.llm) (attack.llm[key] as number) += trial.llm[key] ?? 0;
          if (error) throw error;
          attempt.status = "done"; attack.tried++;
          attempt.tasks = trial.scores.length; attempt.successes = trial.scores.filter(s => s.complete).length;
          attempt.refusals = trial.scores.reduce((n, s) => n + s.refused_actions, 0);
          attempt.broken = trial.scores.some(s => !s.complete);
          if (attempt.broken) { publishAdversarialShift(trial, id, { ...attempt.disturbance }); attempt.shift_id = shift_id; attack.broke++; }
        } catch (error) { attempt.status = "error"; attempt.error = error instanceof Error ? error.message : String(error); }
        save(attack);
      }
      attack.status = attack.attempts.some(a => a.status === "error") ? "error" : "done";
      if (attack.status === "error") attack.error = "Some attempts failed to execute; errors are not counted as discovered robot failures.";
    } catch (error) { attack.status = "error"; attack.error = error instanceof Error ? error.message : String(error); }
    finally { attack.finished_at = new Date().toISOString(); try { save(attack); } finally { release(); } }
    return attack;
  })();
  return { attack, done };
}

export function registerAdversaryRoutes(router: Router, brain: BrainStore) {
  router.get('/adversary', (_req, res) => res.json({ runs: listAttacks() }));
  router.post('/adversary', (req, res) => { const { attack } = startAttack(brain, req.body ?? {}); res.status(202).json(attack); });
  router.get('/adversary/:id', (req, res) => { const a = getAttack(req.params.id as string); if (!a) return res.status(404).json({ error: 'no such adversary run' }); res.json(a); });
  router.post('/adversary/:id/review', (req, res) => {
    const a = getAttack(req.params.id as string);
    if (!a) throw httpError(404, 'no such adversary run');
    const id = safeId(req.body?.shift_id, 'shift_id');
    if (!a.attempts.some(t => t.shift_id === id && t.broken)) throw httpError(400, 'choose a failed training attack from this run');
    res.status(202).json(startReview(brain, id));
  });
}
