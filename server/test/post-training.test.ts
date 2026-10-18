import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { createScenario, ONE_HAND_LIMIT_KG } from "../../engine/store.ts";
import { BrainStore } from "../src/brain.ts";
import { claimInference } from "../src/inference-lock.ts";
import { canonicalJson, sha256 } from "../src/paths.ts";
import { runCompiled } from "../src/policy.ts";
import {
  cancelRun,
  getRun,
  recoverInterruptedPostTraining,
  refreshRun,
  registerPostTrainingRoutes,
  startPostTraining,
  validateRequest,
  type PostTrainingRun,
} from "../src/post-training.ts";
import { buildDataset, checkVariant, collectTrainingTasks, exactlyFeasible, planVariants, replayTrial, validateTrial, worldDiff, type ValidatedTask } from "../src/post-training-data.ts";
import { exactSelection, executeTrial, getTrial, prepareTrial, type TrialRecord } from "../src/trials.ts";
import { taskContext, type TaskSpec } from "../src/worker.ts";

// Offline: records go to a temporary data folder, the brain is a temporary copy of the tracked v1 plus test versions,
// Crusoe and the Hub are a local fake behind globalThis.fetch, and any inference request is counted and refused.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "post-training-test-"));
const KEY = "local-test-key-not-a-real-credential";
process.env.AUTOROBO_DATA_DIR = path.join(TMP, "data");
process.env.CRUSOE_API_KEY = KEY;
process.env.CRUSOE_TRAINING_BASE_URL = "https://ft.test/v1";
process.env.LLM_CACHE = "0";
process.env.LLM_RPM = "600000";
for (const k of ["CRUSOE_FT_MODEL", "HF_TOKEN", "HF_DATASET_REPO", "HF_ENDPOINT"]) delete process.env[k];
const DATA = process.env.AUTOROBO_DATA_DIR;

// ---------- fake HTTP ----------

type Call = { method: string; host: string; path: string; query: URLSearchParams; auth: string | null; body: any };
type Route = [method: string, pattern: RegExp, handler: (c: Call) => Response | Promise<Response>];
const calls: Call[] = [];
let routes: Route[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "127.0.0.1") return originalFetch(input, init);
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
  let body: any = init?.body ?? null;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {}
  }
  const call: Call = { method, host: url.hostname, path: url.pathname, query: url.searchParams, auth: headers.get("authorization"), body };
  calls.push(call);
  const r = routes.find(([m, p]) => m === method && p.test(url.pathname));
  if (!r) return json(400, { error: { message: `stub: no route for ${method} ${url.hostname}${url.pathname}` } });
  return r[2](call);
}) as typeof fetch;
const count = (method: string, p: RegExp) => calls.filter((c) => c.method === method && p.test(c.path)).length;
const inferenceCalls = () => calls.filter((c) => c.host !== "ft.test" && c.host !== "hub.test").length;

// ---------- brain ----------

const BRAIN_DIR = path.join(TMP, "brain");
fs.mkdirSync(BRAIN_DIR);
fs.copyFileSync(path.join(ROOT, "brain/v1.json"), path.join(BRAIN_DIR, "v1.json"));
const brain = new BrainStore(BRAIN_DIR);
const rule = (id: string, label: string, when: unknown[], param: string, value: unknown) => [
  { op: "add_node", node: { id, type: "Rule", label, props: { when, then: { param, value }, priority: 1 } } },
  { op: "add_edge", edge: { from: id, to: "store", type: "APPLIES_TO" } },
];
const TWO_HAND = rule("rule:two-hand-over-2kg", "Use two-hand grasp for items over 2 kg", [{ field: "item.weight_kg", op: ">", value: 2 }], "grasp.mode", "two_hand");
const TORSO = rule("rule:torso-to-slot", "Raise the torso to the slot's shelf level", [], "torso.level", "$slot.level");
brain.apply(1, TWO_HAND as any, { created_by: "human", note: "test v2" });
brain.apply(2, TORSO as any, { created_by: "human", note: "test v3" });

const ENV = { max_speed_mps: 0.8, requested_max_speed_mps: null, guardrail_max_speed_mps: null, engine_default_max_speed_mps: 0.8 };
let runN = 0;
async function record(seed: number, tasks: TaskSpec[], version: number, opts: { kind?: "shift" | "gate"; partition?: "training" | "heldout" } = {}): Promise<TrialRecord> {
  const run_id = `shift-ptt${++runN}`;
  const kind = opts.kind ?? "shift";
  const prepared = prepareTrial(brain, {
    kind,
    partition: opts.partition ?? "training",
    seed,
    version,
    worker: "compiled",
    run_id,
    requested_tasks: tasks,
    selection: exactSelection(tasks, run_id),
    robot_count: tasks.length,
    environment: ENV,
    provenance: kind === "gate" ? { gate_id: `gate-ptt${runN}`, role: "candidate" } : { shift_id: run_id },
    headless: true,
  });
  const { error } = await executeTrial(brain, prepared, runCompiled);
  assert.equal(error, undefined);
  return getTrial(prepared.record.trial_id)!;
}
const trialFile = (t: TrialRecord) => path.join(DATA, "trials", t.partition, `${t.trial_id}.json`);
function tamper(t: TrialRecord, edit: (r: TrialRecord) => void): TrialRecord {
  const r = structuredClone(t);
  r.trial_id = `trial-tampered-${++runN}`;
  r.started_at = new Date(Date.parse(t.started_at) - 1000 * runN).toISOString();
  edit(r);
  fs.writeFileSync(trialFile(r), JSON.stringify(r));
  return r;
}

// slots in seed 1 for each fixture: level-1 light, level-1 heavy, level-3 light; and a held-out slot in seed 101
const s1 = createScenario(1, 1);
const shelf = (s: typeof s1, pred: (level: number, kg: number) => boolean) =>
  Object.values(s.layout.slots).find((sl) => sl.aisle === "A" && exactlyFeasible(s, "PICK", sl.id) && pred(sl.level, s.items[`item:${sl.id}`].weight_kg) && [1, 2, 3, 4].filter((l) => l !== sl.level && exactlyFeasible(s, "PICK", `${sl.id.split("-").slice(0, 2).join("-")}-${l}-${sl.position}`)).length > 0)!.id;
const LIGHT1 = shelf(s1, (l, kg) => l === 1 && kg <= ONE_HAND_LIMIT_KG);
const HEAVY1 = shelf(s1, (l, kg) => l === 1 && kg > ONE_HAND_LIMIT_KG);
const LIGHT3 = shelf(s1, (l, kg) => l === 3 && kg <= ONE_HAND_LIMIT_KG);
const HELD = shelf(createScenario(101, 1), (l) => l === 1);

let strict: TrialRecord; // seed 1, v3, PICK LIGHT1: strict success
let mixed: TrialRecord; // seed 1, v1, two robots: LIGHT1 strict, LIGHT3 refused then recovered
let heldout: TrialRecord;

let server: ReturnType<ReturnType<typeof express>["listen"]>;
let BASE = "";
const api = async (method: string, p: string, body?: unknown) => {
  const r = await originalFetch(BASE + p, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: r.status, body: parsed, text, type: r.headers.get("content-type") ?? "" };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settle(id: string): Promise<PostTrainingRun> {
  for (let i = 0; i < 400; i++) {
    const r = getRun(id)!;
    if (r.status !== "running") return r;
    await sleep(10);
  }
  throw new Error(`run ${id} did not finish`);
}

before(async () => {
  strict = await record(1, [{ type: "PICK", slot: LIGHT1 }], 3);
  mixed = await record(1, [{ type: "PICK", slot: LIGHT1 }, { type: "PICK", slot: LIGHT3 }], 1);
  heldout = await record(101, [{ type: "PICK", slot: HELD }], 3, { kind: "gate", partition: "heldout" });

  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerPostTrainingRoutes(router, brain);
  app.use(router);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => res.status(err.status ?? 500).json({ error: err.message, ...(err.extra ?? {}) }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  globalThis.fetch = originalFetch;
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ---------- fake Crusoe ----------

const LIGHTNING = { id: "ftmodel-lightning-test", model_name: "nvidia/nemotron-3.5-lightning-30b-a3b", fine_tuning_available: true };
let jobs: Record<string, any> = {};
let uploads: { purpose: string; filename: string; text: string }[] = [];
function crusoeRoutes(overrides: Route[] = []): Route[] {
  return [
    ...overrides,
    [
      "POST",
      /^\/v1\/files$/,
      async (c) => {
        const form = c.body as FormData;
        const file = form.get("file") as File;
        uploads.push({ purpose: String(form.get("purpose")), filename: file.name, text: await file.text() });
        return json(200, { id: `file-${uploads.length}`, object: "file", bytes: file.size, filename: file.name, purpose: "fine-tune", status: "uploaded", created_at: 1 });
      },
    ],
    ["GET", /^\/v1\/files$/, () => json(200, { data: uploads.map((u, i) => ({ id: `file-${i + 1}`, filename: u.filename, bytes: u.text.length, purpose: "fine-tune", status: "uploaded" })) })],
    ["GET", /^\/v1\/models$/, () => json(200, { data: [LIGHTNING, { id: "ftmodel-qwen", model_name: "qwen/Qwen3-8B", fine_tuning_available: true }, { id: "inference-only", model_name: "nvidia/Nemotron-3.5-Lightning-30B-A3B", fine_tuning_available: false }] })],
    ["POST", /^\/v1\/fine_tuning\/jobs\/estimate_price$/, () => json(200, { object: "fine_tuning.job.price_estimate", estimated_price: "0.02", currency: "usd" })],
    [
      "POST",
      /^\/v1\/fine_tuning\/jobs$/,
      (c) => {
        const id = `ftjob-${Object.keys(jobs).length + 1}`;
        jobs[id] = { id, object: "fine_tuning.job", status: "validating_files", organization_id: "org-should-not-be-stored", ...c.body };
        return json(200, jobs[id]);
      },
    ],
    ["GET", /^\/v1\/fine_tuning\/jobs$/, (c) => json(200, { object: "list", has_more: false, data: Object.values(jobs).filter((j) => j.suffix === c.query.get("suffix")) })],
    ["GET", /^\/v1\/fine_tuning\/jobs\/[^/]+\/events$/, () => json(200, { object: "list", data: [{ id: "ev-1", created_at: 5, level: "info", type: "message", message: "Training started", data: { secret: "dropped" } }] })],
    ["GET", /^\/v1\/fine_tuning\/jobs\/[^/]+\/checkpoints$/, () => json(200, { object: "list", data: [{ id: "cp-1", created_at: 6, step_number: 10, fine_tuned_model_checkpoint: "adapter:cp-1", metrics: { step: 10, train_loss: 0.42, valid_loss: 0.5 } }] })],
    ["GET", /^\/v1\/fine_tuning\/jobs\/[^/]+\/metrics$/, () => json(200, { object: "fine_tuning.job.metrics", metrics: [{ metric_name: "ev_train_loss", data: [{ x: 1, value: 0.9 }, { x: 10, value: 0.42 }] }] })],
    [
      "POST",
      /^\/v1\/fine_tuning\/jobs\/[^/]+\/cancel$/,
      (c) => {
        const j = jobs[c.path.split("/")[4]];
        j.status = "cancelled";
        return json(200, j);
      },
    ],
    ["GET", /^\/v1\/fine_tuning\/jobs\/[^/]+$/, (c) => {
      const j = jobs[c.path.split("/").pop()!];
      if (!j) return json(404, { error: { message: "no such job" } });
      if (j.status === "validating_files") j.status = "running";
      return json(200, { ...j, trained_tokens: 1234, estimated_finish: 99 });
    }],
  ];
}
function resetProvider(overrides: Route[] = []) {
  calls.length = 0;
  jobs = {};
  uploads = [];
  routes = crusoeRoutes(overrides);
}

// ---------- collect ----------

test("collect keeps only exactly replayed, strict-success training tasks and never reads held-out trials", () => {
  const dupe = tamper(strict, () => {}); // same decisions in the same world: a duplicate row, not new data
  const badStep = tamper(strict, (r) => (r.trajectory[1].reason = "edited after the run"));
  const badInitial = tamper(strict, (r) => (r.initial.items[`item:${LIGHT1}`].weight_kg += 0.01));
  const badHash = tamper(strict, (r) => (r.initial_sha256 = "f".repeat(64)));
  const badBrain = tamper(strict, (r) => (r.brain_sha256 = "0".repeat(64)));
  const heldSeed = tamper(strict, (r) => (r.seed = 101));
  const running = tamper(strict, (r) => (r.status = "running"));
  const otherKind = tamper(strict, (r) => (r.kind = "posttraining"));
  const attack = tamper(strict, (r) => (r.kind = "adversary"));

  const c = collectTrainingTasks(brain);
  const keys = c.accepted.map((t) => `${t.trial_id}/${t.task.id}`);
  const reasons = Object.fromEntries(c.rejected.map((r) => [`${r.trial_id}${r.task_id ? "/" + r.task_id : ""}`, r.reason]));

  assert.ok(c.accepted.every((t) => t.seed >= 1 && t.seed <= 20 && t.score.complete && t.score.refused_actions === 0));
  assert.equal(keys.filter((k) => k.startsWith(strict.trial_id) || k.startsWith(dupe.trial_id)).length, 1, "duplicate decisions are kept once");
  assert.ok(keys.includes(`${mixed.trial_id}/${mixed.tasks[0].id}`), "the strict task of a two-robot trial is kept");
  assert.match(reasons[`${mixed.trial_id}/${mixed.tasks[1].id}`], /refused action/);
  assert.match(reasons[badStep.trial_id], /does not replay as recorded/);
  assert.match(reasons[badInitial.trial_id], /initial world is not seed 1's world with the recorded tasks/);
  assert.match(reasons[badHash.trial_id], /initial world does not match its recorded hash/);
  assert.match(reasons[badBrain.trial_id], /changed since this trial was recorded/);
  assert.match(reasons[heldSeed.trial_id], /not a training seed/);
  assert.match(reasons[otherKind.trial_id], /kind posttraining is not collected/);
  assert.match(reasons[attack.trial_id], /kind adversary is not collected/);
  assert.ok(!(running.trial_id in reasons) && !keys.some((k) => k.startsWith(running.trial_id)), "unfinished trials are not even listed");
  assert.ok(!JSON.stringify(c).includes(heldout.trial_id), "held-out trials are never considered");
  assert.ok(c.accepted.every((t) => getTrial(t.trial_id)!.partition === "training"));

  const onlyShift = collectTrainingTasks(brain, { shift_id: strict.provenance.shift_id });
  assert.deepEqual(onlyShift.accepted.map((t) => t.trial_id), [strict.trial_id]);
  for (const f of [dupe, badStep, badInitial, badHash, badBrain, heldSeed, running, otherKind, attack]) fs.rmSync(trialFile(f));
});

test("a gate trial is rejected even if it is copied into the training folder", () => {
  const moved = structuredClone(heldout);
  moved.partition = "training";
  moved.seed = 1;
  const r = validateTrial(brain, moved);
  assert.equal(r.accepted.length, 0);
  assert.match(r.rejected[0].reason, /gate trials are never collected/);
});

// ---------- scaler ----------

const parentOf = (t: TrialRecord) => validateTrial(brain, t).accepted[0];

test("the scaler changes exactly one factor on a training seed and rejects anything else", () => {
  const parent = parentOf(strict);
  const { plans, rejected } = planVariants(parent, 3, "v1");
  assert.deepEqual(rejected, []);
  assert.deepEqual(plans.map((p) => p.factor), ["level", "weight", "start_location"]);
  const base = createScenario(1, 1);
  const [level, weight, start] = plans;

  const [a, b, , pos] = LIGHT1.split("-");
  assert.match(level.spec.slot, new RegExp(`^${a}-${b}-[1-4]-${pos}$`));
  assert.notEqual(level.spec.slot, LIGHT1);
  assert.equal(level.scenario.items[`item:${level.spec.slot}`].weight_kg, parent.task.card.item.weight_kg, "weight held equal to the parent's");
  assert.ok(worldDiff(base, level.scenario).every((p) => p === `items.item:${level.spec.slot}.weight_kg`));

  assert.equal(weight.spec.slot, LIGHT1);
  assert.deepEqual(worldDiff(base, weight.scenario), [`items.item:${LIGHT1}.weight_kg`]);
  assert.ok(weight.scenario.items[`item:${LIGHT1}`].weight_kg > ONE_HAND_LIMIT_KG, "a light item becomes heavy");
  assert.ok(weight.scenario.items[`item:${LIGHT1}`].weight_kg <= 3.98);

  assert.equal(start.spec.slot, LIGHT1);
  assert.ok(worldDiff(base, start.scenario).every((p) => /^robots\.robot-1\.(x|y|waypoint)$/.test(p)));
  assert.notEqual(start.scenario.robots["robot-1"].waypoint, "backroom");
  assert.notEqual(start.scenario.robots["robot-1"].waypoint, base.layout.slots[LIGHT1].waypoint);

  for (const p of plans) assert.equal(checkVariant(p, `x-${p.variant_id}-t1`).ok, true);
  assert.deepEqual(planVariants(parent, 1, "v1").plans.map((p) => p.factor), ["level"]);
  assert.equal(planVariants(parent, 0, "v1").plans.length, 0);

  // rejections
  const held = planVariants({ ...parent, seed: 101 }, 3, "v9");
  assert.equal(held.plans.length, 0);
  assert.ok(held.rejected.every((r) => /not a training seed/.test(r.reason)));
  const two = structuredClone(weight);
  Object.assign(two.scenario.robots["robot-1"], { waypoint: "tote", x: 0, y: 9.4 });
  assert.match((checkVariant(two, "t") as any).reason, /may change only its factor/);
  const heavy = structuredClone(weight);
  heavy.scenario.items[`item:${LIGHT1}`].weight_kg = 4.5;
  assert.match((checkVariant(heavy, "t") as any).reason, /outside the store's 0.2 to 4 kg range/);
  const otherBay = structuredClone(level);
  const bay = Number(b) === 1 ? 2 : 1;
  otherBay.spec.slot = `${a}-${bay}-${level.spec.slot.split("-")[2]}-${pos}`;
  assert.equal(checkVariant(otherBay, "t").ok, false);
  const heldWorld = structuredClone(start);
  heldWorld.scenario.seed = 101;
  assert.match((checkVariant(heldWorld, "t") as any).reason, /not a training seed/);
  const noop = structuredClone(start);
  noop.scenario = createScenario(1, 1);
  assert.match((checkVariant(noop, "t") as any).reason, /changed: nothing/);
});

// ---------- export ----------

test("export rebuilds each pre-action state and keeps the executed action exactly", () => {
  const t = parentOf(strict);
  const ds = buildDataset(brain, [t]);
  const chat = ds.chat.trim().split("\n").map((l) => JSON.parse(l));
  const robot = ds.robot.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(chat.length, strict.trajectory.length);
  assert.equal(robot.length, chat.length);
  const system = taskContext(brain, 3, strict.tasks[0]).text;
  chat.forEach((line, j) => {
    const step = strict.trajectory[j];
    assert.deepEqual(line.messages.map((m: any) => m.role), ["system", "user", "assistant"]);
    assert.ok(line.messages[0].content.startsWith(system));
    assert.deepEqual(JSON.parse(line.messages[2].content), { action: step.action, args: step.args });
    // the state before action j is the state the engine recorded after action j-1
    const prev = j === 0 ? strict.initial.robots["robot-1"] : strict.trajectory[j - 1].robot_state;
    assert.ok(line.messages[1].content.includes(`at ${prev.waypoint}, torso level ${prev.torso_level}`));
    assert.equal(robot[j]["observation.state"].waypoint, prev.waypoint);
    assert.equal(robot[j]["observation.state"].holding, prev.holding);
    assert.deepEqual(robot[j].action, { name: step.action, args: step.args });
    assert.equal(robot[j].source.decision_source, "compiled_brain_policy");
    assert.equal(robot[j].source.observation, "reconstructed");
    assert.equal(robot[j]["next.done"], j === chat.length - 1);
  });
  assert.match(chat[0].messages[1].content, /\(none yet\)/);
  assert.ok(chat[1].messages[1].content.includes(`1. ${strict.trajectory[0].action}`));
  assert.ok(!ds.chat.includes(heldout.trial_id) && !ds.robot.includes(heldout.trial_id));
  assert.equal(replayTrial(strict).ok, true);
});

// ---------- the pipeline over HTTP with a fake Crusoe ----------

test("POST /post-training runs collect, scale, export, upload and job, and refresh/cancel use the real provider values", async () => {
  resetProvider();
  const start = await api("POST", "/post-training", { shift_id: strict.provenance.shift_id, brain: 3, worker: "compiled", max_tasks: 1 });
  assert.equal(start.status, 202);
  const id = start.body.post_training_id;
  assert.match(id, /^pt-/);
  const run = await settle(id);

  assert.equal(run.status, "done", run.error);
  assert.equal(run.steps.collect.status, "completed");
  assert.equal(run.collect!.tasks_accepted, 1);
  assert.equal(run.steps.scale.status, "completed");
  const variants = run.scale!.variants;
  assert.equal(variants.length, 3);
  assert.ok(variants.every((v) => v.status === "kept"), JSON.stringify(variants.map((v) => [v.variant_id, v.status, v.reason])));
  for (const v of variants) {
    const t = getTrial(v.trial_id!)!;
    assert.equal(t.partition, "training");
    assert.equal(t.kind, "posttraining");
    assert.equal(t.provenance.parent_trial_id, strict.trial_id);
    assert.equal(t.provenance.post_training_id, id);
    assert.equal(t.robot_count, 1);
  }
  assert.equal(run.dataset!.by_origin.variant > 0, true);
  assert.equal(run.steps.export.status, "completed");
  assert.equal(run.steps.hf_publish.status, "skipped");
  assert.match(run.steps.hf_publish.reason!, /HF_TOKEN and HF_DATASET_REPO are not set/);
  assert.equal(run.steps.upload.status, "completed");
  assert.equal(run.steps.job.status, "completed");
  for (const n of ["collect", "export", "upload", "job"] as const) assert.ok(run.steps[n].started_at && run.steps[n].finished_at && run.steps[n].finished_at! >= run.steps[n].started_at!);

  // one upload, one create, with the documented shapes
  assert.equal(count("POST", /^\/v1\/files$/), 1);
  assert.equal(count("POST", /^\/v1\/fine_tuning\/jobs$/), 1);
  assert.equal(inferenceCalls(), 0, "a compiled run makes no model calls");
  assert.ok(calls.every((c) => c.auth === `Bearer ${KEY}`));
  assert.equal(uploads[0].purpose, "fine-tune");
  const chatFile = fs.readFileSync(path.join(DATA, "post-training", id, "train.chat.jsonl"), "utf8");
  assert.equal(uploads[0].text, chatFile);
  assert.equal(run.provider.file.state, "uploaded");
  assert.equal(run.provider.file.id, "file-1");
  const create = calls.find((c) => c.method === "POST" && c.path === "/v1/fine_tuning/jobs")!.body;
  assert.equal(create.model, LIGHTNING.id);
  assert.equal(create.training_file, "file-1");
  assert.equal(create.suffix, `autorobo-${id}`);
  assert.equal(create.metadata.post_training_id, id);
  assert.equal(create.method.type, "supervised");
  const hp = create.method.supervised.hyperparameters;
  assert.equal(hp.n_epochs, 3);
  assert.ok(hp.batch_size >= 2 && hp.batch_size <= 8);
  assert.equal(hp.learning_rate, 0.0001);
  assert.equal(run.provider.job.state, "submitted");
  assert.equal(run.provider.job.id, "ftjob-1");
  assert.equal(run.provider.job.status, "validating_files");
  assert.equal(run.provider.console_url, "https://console.crusoecloud.com/foundry/fine-tuning/jobs");
  assert.deepEqual(run.provider.estimate, { estimated_price: "0.02", currency: "usd" });
  const saved = fs.readFileSync(path.join(DATA, "post-training", id, "run.json"), "utf8");
  assert.ok(!saved.includes(KEY), "the API key is never saved");
  assert.ok(!saved.includes("org-should-not-be-stored"), "only the needed provider fields are kept");

  // the dataset endpoint serves only the three exported files
  const chat = await api("GET", `/post-training/${id}/dataset?format=chat`);
  assert.equal(chat.status, 200);
  assert.match(chat.type, /ndjson/);
  assert.equal(chat.text, chatFile);
  assert.equal(chat.text.trim().split("\n").length, run.dataset!.examples);
  const manifest = (await api("GET", `/post-training/${id}/dataset?format=manifest`)).body;
  assert.equal(manifest.official_lerobot_format, false);
  assert.equal(manifest.contains_images, false);
  assert.equal(manifest.contains_joint_actions, false);
  assert.equal(manifest.files.chat.sha256, sha256(chatFile));
  assert.equal((await api("GET", `/post-training/${id}/dataset?format=robot`)).text.trim().split("\n").length, run.dataset!.examples);
  assert.equal((await api("GET", `/post-training/${id}/dataset?format=run.json`)).status, 400);
  assert.equal((await api("GET", `/post-training/${id}/dataset?format=../../.env`)).status, 400);
  assert.equal((await api("GET", `/post-training/pt-none/dataset`)).status, 404);
  assert.equal((await api("GET", `/post-training/..%2F..%2Fetc`)).status, 400);

  // list and read are read-only
  const before = calls.length;
  const listed = (await api("GET", "/post-training")).body.runs;
  assert.equal(listed[0].post_training_id, id);
  assert.equal((await api("GET", `/post-training/${id}`)).body.post_training_id, id);
  assert.equal(calls.length, before, "GET never contacts the provider");

  // refresh stores the provider's actual values; a second refresh within 5 s is not sent
  const refreshed = (await api("POST", `/post-training/${id}/refresh`)).body as PostTrainingRun;
  assert.equal(refreshed.provider.job.status, "running");
  assert.equal(refreshed.provider.job.provider!.trained_tokens, 1234);
  assert.equal(refreshed.provider.checkpoints[0].metrics.train_loss, 0.42);
  assert.equal(refreshed.provider.events[0].message, "Training started");
  assert.equal((refreshed.provider.events[0] as any).data, undefined);
  assert.equal(refreshed.provider.metrics[0].metric_name, "ev_train_loss");
  assert.equal(refreshed.provider.poll_error, null);
  const polls = calls.length;
  await api("POST", `/post-training/${id}/refresh`);
  assert.equal(calls.length, polls, "throttled");
  assert.equal(count("POST", /^\/v1\/fine_tuning\/jobs$/), 1, "refresh never creates");

  // cancel is explicit and real; a finished job cannot be cancelled again
  const cancelled = await api("POST", `/post-training/${id}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.provider.job.status, "cancelled");
  assert.equal(count("POST", /\/cancel$/), 1);
  const again = await api("POST", `/post-training/${id}/cancel`);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "nothing_to_cancel");
});

test("missing credentials, refusals and an unlisted model are recorded without any invented id", async () => {
  // no key: nothing is sent and the upload says why
  resetProvider();
  delete process.env.CRUSOE_API_KEY;
  try {
    const { done } = startPostTraining(brain, { brain: 3, worker: "compiled", variants_per_task: 0 });
    const run = await done;
    assert.equal(run.status, "error");
    assert.equal(run.steps.export.status, "completed");
    assert.equal(run.steps.upload.status, "error");
    assert.match(run.steps.upload.error!, /CRUSOE_API_KEY is not set/);
    assert.equal(run.provider.file.state, "error");
    assert.equal(run.provider.file.id, undefined);
    assert.equal(run.steps.job.status, "skipped");
    assert.equal(run.provider.job.id, undefined);
    assert.equal(calls.length, 0);
  } finally {
    process.env.CRUSOE_API_KEY = KEY;
  }

  // the provider refuses the create: a definite error, no id
  resetProvider([["POST", /^\/v1\/fine_tuning\/jobs$/, () => json(400, { error: { message: "batch_size is not allowed for this model" } })]]);
  let run = await startPostTraining(brain, { brain: 3, worker: "compiled", variants_per_task: 0 }).done;
  assert.equal(run.provider.file.state, "uploaded");
  assert.equal(run.provider.job.state, "error");
  assert.match(run.provider.job.error!, /HTTP 400 batch_size is not allowed/);
  assert.equal(run.provider.job.id, undefined);
  assert.equal(run.status, "error");

  // no fine-tunable Lightning model is listed: no create is sent
  resetProvider([["GET", /^\/v1\/models$/, () => json(200, { data: [{ id: "ftmodel-qwen", model_name: "qwen/Qwen3-8B", fine_tuning_available: true }] })]]);
  run = await startPostTraining(brain, { brain: 3, worker: "compiled", variants_per_task: 0 }).done;
  assert.equal(run.provider.job.state, "error");
  assert.match(run.provider.job.error!, /no fine-tunable Lightning base model/);
  assert.equal(count("POST", /^\/v1\/fine_tuning\/jobs$/), 0);

  // upload: false keeps everything local
  resetProvider();
  run = await startPostTraining(brain, { brain: 3, worker: "compiled", variants_per_task: 0, upload: false }).done;
  assert.equal(run.status, "done");
  assert.equal(run.steps.upload.status, "skipped");
  assert.equal(run.steps.job.status, "skipped");
  assert.equal(calls.length, 0);
});

test("an unanswered create is unknown, survives a restart and is settled by lookup, never resubmitted", async () => {
  // the request reaches the provider, which creates the job, but the answer is lost
  resetProvider([
    [
      "POST",
      /^\/v1\/fine_tuning\/jobs$/,
      (c) => {
        jobs["ftjob-lost"] = { id: "ftjob-lost", status: "queued", ...c.body };
        throw new TypeError("fetch failed");
      },
    ],
  ]);
  const run = await startPostTraining(brain, { brain: 3, worker: "compiled", variants_per_task: 0 }).done;
  assert.equal(run.provider.job.state, "unknown");
  assert.equal(run.provider.job.id, undefined);
  assert.match(run.provider.job.error!, /may or may not exist/);
  assert.equal(count("POST", /^\/v1\/fine_tuning\/jobs$/), 1);

  // a restart in the middle of a create: the run is interrupted and the create is unknown, not resent
  const crashedId = `${run.post_training_id}x`;
  const crashed = structuredClone(run);
  crashed.post_training_id = crashedId;
  crashed.status = "running";
  crashed.steps.job = { status: "started", started_at: run.steps.job.started_at, finished_at: null, counts: {} };
  crashed.provider.job = { state: "submitting", suffix: run.provider.job.suffix, submitted_at: run.provider.job.submitted_at };
  delete crashed.error;
  delete crashed.finished_at;
  fs.mkdirSync(path.join(DATA, "post-training", crashedId), { recursive: true });
  fs.writeFileSync(path.join(DATA, "post-training", crashedId, "run.json"), JSON.stringify(crashed));
  assert.deepEqual(recoverInterruptedPostTraining(), [crashedId]);
  const recovered = getRun(crashedId)!;
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.steps.job.status, "error");
  assert.match(recovered.steps.job.error!, /server stopped during this step/);
  assert.equal(recovered.provider.job.state, "unknown");
  assert.deepEqual(recoverInterruptedPostTraining(), [], "recovery runs once");

  // refresh finds the one job with this run's suffix and adopts it; nothing is created
  const settled = await refreshRun(run.post_training_id);
  assert.equal(settled.provider.job.state, "submitted");
  assert.equal(settled.provider.job.id, "ftjob-lost");
  assert.ok(settled.provider.job.reconciled_at);
  assert.equal(count("POST", /^\/v1\/fine_tuning\/jobs$/), 1, "never resubmitted");
  const lookup = calls.find((c) => c.method === "GET" && c.path === "/v1/fine_tuning/jobs")!;
  assert.equal(lookup.query.get("suffix"), `autorobo-${run.post_training_id}`);

  // a 5xx is just as uncertain as a lost answer
  resetProvider([["POST", /^\/v1\/fine_tuning\/jobs$/, () => json(503, { error: { message: "upstream unavailable" } })]]);
  const r503 = await startPostTraining(brain, { brain: 3, worker: "compiled", variants_per_task: 0 }).done;
  assert.equal(r503.provider.job.state, "unknown");
  const nothing = await refreshRun(r503.post_training_id);
  assert.equal(nothing.provider.job.state, "unknown", "no matching job: still unknown, still not resent");
  assert.equal(count("POST", /^\/v1\/fine_tuning\/jobs$/), 1);
  const noCancel = await cancelRun(r503.post_training_id).catch((e) => e);
  assert.equal(noCancel.status, 409);
});

test("a restart during the scaler interrupts the running variant and skips what had not started", () => {
  const id = "pt-restart-scale";
  const dir = path.join(DATA, "post-training", id);
  fs.mkdirSync(dir, { recursive: true });
  const step = (status: string) => ({ status, started_at: status === "pending" ? null : new Date().toISOString(), finished_at: status === "completed" ? new Date().toISOString() : null, counts: {} });
  const r = {
    post_training_id: id,
    status: "running",
    request: { shift_id: null, brain_version: 3, worker: "llm", upload: true, variants_per_task: 3, max_tasks: 1 },
    brain_version: 3,
    brain_sha256: brain.fileSha256(3),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    steps: { collect: step("completed"), scale: step("started"), export: step("pending"), hf_publish: step("pending"), upload: step("pending"), job: step("pending") },
    collect: null,
    scale: {
      parents: [],
      variants: [
        { variant_id: "v1-level", status: "kept", trial_id: "trial-a", score: null, changes: [], task: null, factor: "level", seed: 1, parent_trial_id: "p", parent_task_id: "t" },
        { variant_id: "v1-weight", status: "running", trial_id: "trial-b", score: null, changes: [], task: null, factor: "weight", seed: 1, parent_trial_id: "p", parent_task_id: "t" },
        { variant_id: "v1-start", status: "pending", trial_id: null, score: null, changes: [], task: null, factor: "start_location", seed: 1, parent_trial_id: "p", parent_task_id: "t" },
      ],
    },
    dataset: null,
    hf: { status: "pending", local_files: [] },
    provider: { base_url: "https://ft.test/v1", console_url: "x", model: null, file: { state: "not_started" }, job: { state: "not_started" }, estimate: null, events: [], checkpoints: [], metrics: [], last_polled_at: null, poll_error: null },
    llm: {},
  };
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(r));
  assert.deepEqual(recoverInterruptedPostTraining(), [id]);
  const after = getRun(id)!;
  assert.equal(after.status, "interrupted");
  assert.equal(after.steps.scale.status, "error");
  assert.deepEqual(STEPS_AFTER_SCALE.map((n) => after.steps[n].status), ["skipped", "skipped", "skipped", "skipped"]);
  assert.deepEqual(after.scale!.variants.map((v) => v.status), ["kept", "interrupted", "not_run"]);
});
const STEPS_AFTER_SCALE = ["export", "hf_publish", "upload", "job"] as const;

// ---------- requests, exclusivity, Lightning failures ----------

test("bad requests are refused before anything is recorded, and only one run is active", async () => {
  const code = (body: unknown) => {
    try {
      validateRequest(brain, body);
      return "ok";
    } catch (e: any) {
      return `${e.status} ${e.extra?.code ?? ""}`.trim();
    }
  };
  assert.equal(code({}), "ok");
  for (const b of [{ variants_per_task: 4 }, { variants_per_task: -1 }, { variants_per_task: 1.5 }, { max_tasks: 0 }, { max_tasks: 5 }, { worker: "gpt" }, { upload: "yes" }, { seeds: [101] }, [], "x", { brain: "abc" }])
    assert.equal(code(b), "400 bad_request", JSON.stringify(b));
  assert.equal(code({ shift_id: "../etc" }), "400 bad_id");
  assert.equal(code({ shift_id: "shift-none" }), "404 no_shift_recording");
  assert.equal(code({ brain: 99 }), "404");
  const r = validateRequest(brain, {});
  assert.deepEqual({ worker: r.worker, upload: r.upload, variants_per_task: r.variants_per_task, max_tasks: r.max_tasks, brain_version: r.brain_version }, { worker: "llm", upload: true, variants_per_task: 3, max_tasks: 2, brain_version: brain.index().live });

  // hold the first run at its upload so the second request really overlaps it
  let releaseUpload!: () => void;
  const uploadHeld = new Promise<void>((r) => (releaseUpload = r));
  resetProvider([["POST", /^\/v1\/files$/, async () => (await uploadHeld, json(400, { error: { message: "test: refused after the overlap check" } }))]]);
  const first = startPostTraining(brain, { brain: 3, worker: "compiled", variants_per_task: 0 });
  const second = await api("POST", "/post-training", { brain: 3, worker: "compiled" });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "post_training_active");
  assert.equal(second.body.post_training_id, first.run.post_training_id);
  assert.equal(getRun(first.run.post_training_id)!.provider.file.state, "submitting", "the in-flight upload is saved before it is sent");
  releaseUpload();
  assert.equal((await first.done).provider.file.state, "error");

  // Lightning variants need the shared quota: a running comparison blocks them
  const releaseCmp = claimInference("comparison", "cmp-holding-quota");
  try {
    const busy = await api("POST", "/post-training", { brain: 3 });
    assert.equal(busy.status, 409);
    assert.equal(busy.body.code, "inference_busy");
  } finally {
    releaseCmp();
  }
});

test("Lightning variant failures are recorded as errors and never turned into training data", async () => {
  resetProvider(); // every inference request is refused with a 400
  const { run: started, done } = startPostTraining(brain, { shift_id: strict.provenance.shift_id, brain: 3, worker: "llm", upload: false, max_tasks: 1 });
  assert.equal(started.request.worker, "llm");
  const run = await done;
  const vs = run.scale!.variants;
  assert.equal(run.steps.scale.status, "error");
  assert.equal(vs[0].status, "error");
  assert.ok(vs.slice(1).every((v) => v.status === "not_run" && /stopped after an error/.test(v.reason!)));
  assert.equal(run.steps.export.status, "completed", "the verified recorded tasks are still exported");
  assert.equal(run.dataset!.by_origin.variant, 0);
  assert.equal(run.dataset!.by_origin.recorded, strict.trajectory.length);
  assert.equal(run.status, "error");
  assert.ok(inferenceCalls() >= 1, "the Lightning worker was actually asked");
  const again = startPostTraining(brain, { brain: 3, worker: "llm", upload: false, variants_per_task: 0 });
  await again.done; // the quota claim was released
});

// ---------- Hugging Face ----------

test("the Hugging Face copy is published only with configuration and a returned commit", async () => {
  const hubRoutes = (commit: unknown): Route[] => [
    ["POST", /^\/api\/repos\/create$/, () => json(409, { error: "You already created this dataset repo" })],
    ["POST", /^\/api\/datasets\/team\/robot-steps\/preupload\/main$/, (c) => json(200, { files: c.body.files.map((f: any) => ({ path: f.path, uploadMode: "regular" })) })],
    ["POST", /^\/api\/datasets\/team\/robot-steps\/commit\/main$/, () => json(200, commit)],
  ];
  Object.assign(process.env, { HF_TOKEN: "hf-local-test-token", HF_DATASET_REPO: "team/robot-steps", HF_ENDPOINT: "https://hub.test" });
  try {
    resetProvider(hubRoutes({ commitOid: "abc123", commitUrl: "https://hub.test/datasets/team/robot-steps/commit/abc123" }));
    let run = await startPostTraining(brain, { brain: 3, worker: "compiled", variants_per_task: 0, upload: false }).done;
    assert.equal(run.steps.hf_publish.status, "completed");
    assert.equal(run.hf.status, "published");
    assert.equal(run.hf.commit, "abc123");
    const commit = calls.find((c) => c.path.endsWith("/commit/main"))!;
    const lines = String(commit.body).split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.slice(1).map((l) => l.value.path), [`post-training/${run.post_training_id}/robot.steps.jsonl`, `post-training/${run.post_training_id}/manifest.json`]);
    assert.ok(!fs.readFileSync(path.join(DATA, "post-training", run.post_training_id, "run.json"), "utf8").includes("hf-local-test-token"));

    resetProvider(hubRoutes({}));
    run = await startPostTraining(brain, { brain: 3, worker: "compiled", variants_per_task: 0, upload: false }).done;
    assert.equal(run.hf.status, "error");
    assert.match(run.hf.error!, /without a commit id/);
    assert.equal(run.steps.export.status, "completed");
  } finally {
    for (const k of ["HF_TOKEN", "HF_DATASET_REPO", "HF_ENDPOINT"]) delete process.env[k];
  }
});

test("every recorded trial and brain file is left byte-identical", () => {
  // the strict trial was read by every run above
  assert.equal(sha256(canonicalJson(getTrial(strict.trial_id))), sha256(canonicalJson(strict)));
  assert.equal(getTrial(heldout.trial_id)!.partition, "heldout");
  assert.deepEqual(brain.versionsOnDisk(), [1, 2, 3]);
});
