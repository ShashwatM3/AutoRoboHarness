import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { BrainStore } from "../src/brain.ts";
import { aggregate, getComparison, listComparisons, recoverInterruptedComparisons, startComparison, type Comparison } from "../src/comparisons.ts";
import { evaluationsByVersion } from "../src/evaluations.ts";
import { updateBrain } from "../src/gate.ts";
import { claimInference } from "../src/inference-lock.ts";
import { newTally } from "../src/llm.ts";
import { getReview, startReview } from "../src/supervisor.ts";
import { executeTrial, getTrial, HELDOUT_SEEDS, listTrials, prepareTrial, recoverInterruptedTrials, taskForSeed, type Runner } from "../src/trials.ts";
import { act, getShift, listShifts, startShift } from "../src/worker.ts";

// Offline: every record goes to a temporary data folder, the brain is a temporary copy of the tracked v1 plus a
// v2 made from v5's two-hand rule, and the model endpoint is a local stub that counts calls and answers 400.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "trials-test-"));
process.env.AUTOROBO_DATA_DIR = path.join(TMP, "data");
process.env.CRUSOE_API_KEY = "local-test-key";
process.env.LLM_CACHE = "0";
process.env.LLM_RPM = "600000";
const DATA = process.env.AUTOROBO_DATA_DIR;

let modelCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  modelCalls++;
  return new Response(JSON.stringify({ error: { message: "stubbed: no inference in tests" } }), { status: 400, headers: { "content-type": "application/json" } });
};
after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(TMP, { recursive: true, force: true });
});

const BRAIN_DIR = path.join(TMP, "brain");
fs.mkdirSync(BRAIN_DIR);
fs.copyFileSync(path.join(ROOT, "brain/v1.json"), path.join(BRAIN_DIR, "v1.json"));
const brain = new BrainStore(BRAIN_DIR);
const TWO_HAND = [
  { op: "add_node", node: { id: "rule:two-hand-over-2kg", type: "Rule", label: "Use two-hand grasp for items over 2 kg", props: { when: [{ field: "item.weight_kg", op: ">", value: 2 }], then: { param: "grasp.mode", value: "two_hand" }, priority: 1 } } },
  { op: "add_edge", edge: { from: "rule:two-hand-over-2kg", to: "store", type: "APPLIES_TO" } },
] as any;
brain.apply(1, TWO_HAND, { created_by: "human", note: "test v2" });

const hashDir = (d: string) =>
  fs.existsSync(d) ? Object.fromEntries(fs.readdirSync(d).sort().map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(d, f))).digest("hex")])) : {};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return `${e.status} ${e.extra?.code ?? ""}`.trim();
  }
  return "no error";
};
const PICK = { type: "PICK" as const, slot: "A-1-3-1" };

test("a comparison runs both versions on identical worlds, records every pair, and never touches a brain or the index", async () => {
  const before = hashDir(BRAIN_DIR);
  const { comparison, done } = startComparison(brain, { versions: [1, 2], seeds: [101, 102, 103], tasks: [PICK], worker: "compiled" });
  assert.equal(comparison.status, "running");
  assert.ok(getComparison(comparison.comparison_id), "saved before any pair runs");
  const c = await done;
  assert.equal(c.status, "done");
  assert.deepEqual(hashDir(BRAIN_DIR), before, "brain files and index.json unchanged byte for byte");
  for (const ps of c.per_seed) {
    const [a, b] = ps.pairs.map((p) => getTrial(p.trial_id!)!);
    assert.equal(a.initial_sha256, b.initial_sha256);
    assert.deepEqual(a.initial, b.initial, "the same world, items, robots and task ids for both versions");
    assert.deepEqual(a.task_selection, b.task_selection);
    assert.deepEqual(a.environment, b.environment);
    assert.equal(a.robot_count, b.robot_count);
    assert.deepEqual([a.brain_version, b.brain_version], [1, 2]);
    assert.deepEqual([a.partition, a.kind, a.provenance.comparison_id, a.provenance.role, b.provenance.role], ["heldout", "comparison", c.comparison_id, "a", "b"]);
    assert.ok(a.final && !("trajectory" in a.final) && a.trajectory.length === a.steps && a.steps > 0);
  }
  for (const a of c.aggregates) assert.deepEqual([a.expected_tasks, a.evaluated_tasks, a.complete], [3, 3, true]);
  assert.equal(modelCalls, 0, "compiled workers make no model calls");
});

test("an infeasible task is a recorded failure for both versions, never dropped from the denominator", async () => {
  const slot = ["A-1-3-1", "A-1-4-1", "B-1-2-1"].find((s) => HELDOUT_SEEDS.some((seed) => !taskForSeed(seed, { type: "RESTOCK", slot: s })))!;
  const seeds = HELDOUT_SEEDS.filter((seed) => !taskForSeed(seed, { type: "RESTOCK", slot })).slice(0, 1).concat(HELDOUT_SEEDS.filter((seed) => taskForSeed(seed, { type: "RESTOCK", slot })).slice(0, 1));
  const c = await startComparison(brain, { versions: [1, 2], seeds, tasks: [{ type: "RESTOCK", slot }], worker: "compiled" }).done;
  const bad = c.per_seed[0];
  assert.equal(bad.task_selection[0].actual, null);
  for (const p of bad.pairs) {
    assert.equal(p.status, "done");
    assert.deepEqual(p.task_scores.map((s) => [s.complete, s.infeasible]), [[false, true]]);
  }
  for (const a of c.aggregates) {
    assert.equal(a.expected_tasks, 2);
    assert.equal(a.evaluated_tasks, 2);
    assert.equal(a.infeasible_tasks, 1);
    assert.ok(a.success_rate <= 0.5, "at most the feasible task can succeed, out of 2");
  }
});

test("each engine action is saved as it happens, refused ones and failures included", async () => {
  const prepared = prepareTrial(brain, {
    kind: "comparison",
    partition: "heldout",
    seed: 101,
    version: 1,
    worker: "compiled",
    run_id: "persist-test",
    requested_tasks: [PICK],
    selection: [{ index: 0, requested: PICK, actual: { ...PICK, robot: "robot-1" }, substituted: false, robot: "robot-1", task_id: "persist-test-t1" }],
    robot_count: 1,
    environment: { max_speed_mps: 0.8, requested_max_speed_mps: null, guardrail_max_speed_mps: 0.8, engine_default_max_speed_mps: 0.8 },
    provenance: { comparison_id: "persist-test" },
    headless: true,
  });
  const file = path.join(DATA, "trials/heldout", `${prepared.record.trial_id}.json`);
  const disk = () => JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual([disk().status, disk().steps, !!disk().initial], ["running", 0, true], "saved at creation with its initial world");
  const runner: Runner = async (_b, engine, _ctx, task) => {
    act(engine, task.robot, "grasp", { mode: "one_hand" }); // refused: not reaching into anything
    assert.deepEqual([disk().steps, disk().trajectory[0].ok], [1, false]);
    act(engine, task.robot, "navigate_to", { waypoint: task.card.source_waypoint });
    assert.deepEqual([disk().steps, disk().trajectory[1].ok], [2, true]);
    throw new Error("worker crashed");
  };
  const { error } = await executeTrial(brain, prepared, runner);
  assert.ok(error);
  const end = disk();
  assert.deepEqual([end.status, end.steps, end.error, !!end.final, end.scores.length], ["error", 2, "worker crashed", true, 1]);
});

test("held-out trials stay out of the supervisor's shifts, sibling runs and reviews", async () => {
  const before = listShifts().map((s) => s.shift_id);
  const c = await startComparison(brain, { versions: [1, 2], seeds: [104], tasks: [PICK], worker: "compiled" }).done;
  const ids = c.per_seed.flatMap((ps) => ps.pairs.map((p) => p.trial_id!));
  assert.deepEqual(listShifts().map((s) => s.shift_id), before, "no new shifts");
  for (const id of [...ids, c.comparison_id]) {
    assert.equal(getShift(id), undefined);
    assert.equal(getReview(id), undefined);
    assert.equal(code(() => startReview(brain, id)), "404");
  }
  assert.ok(ids.every((id) => fs.existsSync(path.join(DATA, "trials/heldout", `${id}.json`))));
  assert.equal(fs.readdirSync(path.join(DATA, "trials")).includes("training"), false, "nothing held-out lands in training");
});

test("a training shift is recorded as a training trial linked both ways", async () => {
  const s = startShift(brain, { seed: 1, tasks: [PICK], worker: "compiled", brain: 2 });
  for (let i = 0; i < 100 && getShift(s.shift_id)!.status === "running"; i++) await new Promise((r) => setTimeout(r, 20));
  const shift = getShift(s.shift_id)!;
  const t = getTrial(shift.trial_id!)!;
  assert.deepEqual([t.kind, t.partition, t.provenance.shift_id, t.status], ["shift", "training", s.shift_id, "done"]);
  assert.equal(t.steps, shift.trajectory.length);
  assert.deepEqual(t.trajectory, shift.trajectory);
  assert.deepEqual(listTrials({ shift_id: s.shift_id }).map((x) => x.trial_id), [t.trial_id]);
});

test("a gate records both brains as held-out trials on identical worlds and saves the file hashes it measured", async () => {
  fs.mkdirSync(path.join(DATA, "shifts"), { recursive: true });
  fs.mkdirSync(path.join(DATA, "reviews"), { recursive: true });
  const shift_id = "shift-gatetest";
  fs.writeFileSync(path.join(DATA, "shifts", `${shift_id}.json`), JSON.stringify({ shift_id, seed: 1, brain_version: 1, worker: "compiled", status: "done", started_at: "", tasks: [{ id: "t1", robot: "robot-1", type: "PICK", item_id: "item:A-1-3-1", source: "A-1-3-1", target: "tote" }], scores: [], llm: newTally(), trajectory: [] }));
  const review = { shift_id, status: "done", brain_version: 1, started_at: "", failures: [{ id: "F1" }], insights: [], detected: {}, tool_calls: [], llm: newTally(), judge: { model: "test", kept: ["F1"], dropped: [], finished_at: "" }, updates: [{ id: "U1", summary: "two hands over 2 kg", ops: [{ cites: ["F1"] }], compiled: TWO_HAND, valid: true, errors: [], touches_guardrail: false, judge_supported: true }] };
  fs.writeFileSync(path.join(DATA, "reviews", `${shift_id}.json`), JSON.stringify(review));
  const live = brain.index().live;
  const { gate, done } = updateBrain(brain, { shift_id, update_ids: ["U1"], worker: "compiled", seeds: 2 });
  const g = await done;
  assert.equal(g.status, "done");
  assert.deepEqual(g.brain_sha256, { base: brain.fileSha256(live), candidate: brain.fileSha256(gate.candidate) });
  for (const p of g.per_seed) {
    const base = getTrial(p.trial_ids!.base!)!;
    const cand = getTrial(p.trial_ids!.candidate!)!;
    assert.equal(base.initial_sha256, cand.initial_sha256, "task ids no longer depend on the version");
    assert.deepEqual([base.partition, base.kind, base.provenance.gate_id, base.provenance.role, cand.provenance.role], ["heldout", "gate", g.gate_id, "base", "candidate"]);
    assert.deepEqual(p.task_selection, base.task_selection);
  }
  const ev = evaluationsByVersion(brain);
  for (const v of [g.base, g.candidate]) assert.ok(ev.find((e) => e.v === v)!.evaluations.some((e) => e.evaluation_id === g.gate_id), `v${v} lists ${g.gate_id}`);
});

test("evaluations count every completed measurement once, by its real denominator, and only for the file it measured", async () => {
  const gates = path.join(DATA, "gates");
  fs.mkdirSync(gates, { recursive: true });
  const score = (complete: boolean) => ({ task_id: "x", complete, refused_actions: complete ? 0 : 1, steps: 7, item_location: "tote", target_location: "tote" });
  const diff12 = brain.diff(1, 2);
  const created2 = brain.index().versions.find((r) => r.v === 2)!.created_at;
  const later = new Date(Date.parse(created2) + 1000).toISOString();
  const old = (id: string, extra: object) => ({ gate_id: id, status: "done", shift_id: "s", update_ids: ["U1"], base: 1, candidate: 2, seeds: [101, 102], tasks: [PICK], worker: "llm", progress: { done: 3, total: 3 }, per_seed: [{ seed: 101, skipped: [], base: [score(true)], candidate: [score(true)] }, { seed: 102, skipped: ["no feasible slot"], base: [], candidate: [] }], base_score: {}, candidate_score: {}, verdict: "promoted", diff: diff12, llm: newTally(), started_at: later, finished_at: later, ...extra });
  const write = (g: any) => fs.writeFileSync(path.join(gates, `${g.gate_id}.json`), JSON.stringify(g));
  write(old("gate-oldok", {}));
  write(old("gate-olderror", { status: "error" }));
  write(old("gate-otherv2", { diff: { ...diff12, added_nodes: [{ id: "rule:something-else" }] } }));
  write(old("gate-beforev2", { started_at: "2000-01-01T00:00:00.000Z" }));
  const gateBytes = hashDir(gates);
  const calls = modelCalls;

  const ev = evaluationsByVersion(brain);
  const v1 = ev.find((e) => e.v === 1)!.evaluations.filter((e) => e.evaluation_id.startsWith("gate-o") || e.evaluation_id === "gate-beforev2");
  const v2 = ev.find((e) => e.v === 2)!.evaluations.filter((e) => e.evaluation_id.startsWith("gate-o") || e.evaluation_id === "gate-beforev2");
  assert.deepEqual(v1.map((e) => e.evaluation_id).sort(), ["gate-oldok", "gate-otherv2"], "errored gates and gates older than the base file don't count");
  assert.deepEqual(v2.map((e) => e.evaluation_id), ["gate-oldok"], "a gate that applied a different change never counts for today's v2");
  assert.deepEqual([v2[0].tasks, v2[0].successes, v2[0].success_rate, v2[0].worker, v2[0].role], [1, 1, 1, "llm", "candidate"], "the denominator is the tasks the gate actually ran");

  const errored = { ...(listComparisons()[0] as Comparison), comparison_id: "cmp-unfinished", evaluation_id: "cmp-unfinished", status: "error" as const };
  fs.writeFileSync(path.join(DATA, "comparisons", "cmp-unfinished.json"), JSON.stringify(errored));
  assert.ok(evaluationsByVersion(brain).every((v) => v.evaluations.every((e) => e.evaluation_id !== "cmp-unfinished")), "incomplete comparisons don't count");
  assert.deepEqual(hashDir(gates), gateBytes, "reading never rewrites a gate file");
  assert.equal(modelCalls, calls, "reading makes no model calls");
});

test("totals divide by every expected task, and a run cut short is never complete", () => {
  const sel = (i: number) => ({ index: i, requested: PICK, actual: PICK, substituted: false, robot: "robot-1", task_id: `t${i}` });
  const ts = (complete: boolean) => [{ index: 0, task_id: "t0", complete, refused_actions: 0, steps: 5, item_location: "", target_location: "" }];
  const c: any = {
    versions: [1, 2],
    seeds: [101, 102],
    tasks: [PICK],
    status: "error",
    per_seed: [
      { seed: 101, task_selection: [sel(0)], pairs: [{ status: "done", trial_id: "a1", task_scores: ts(true) }, { status: "done", trial_id: "b1", task_scores: ts(true) }] },
      { seed: 102, task_selection: [sel(0)], pairs: [{ status: "error", trial_id: "a2", task_scores: ts(true) }, { status: "not_run", trial_id: null, task_scores: [] }] },
    ],
  };
  const [a, b] = aggregate(c);
  assert.deepEqual([a.expected_tasks, a.evaluated_tasks, a.successes, a.success_rate, a.complete], [2, 1, 1, 0.5, false], "1 of 2 expected, not 1 of 1");
  assert.deepEqual([b.expected_tasks, b.evaluated_tasks, b.complete], [2, 1, false]);
  c.status = "running";
  c.per_seed[1].pairs = [{ status: "done", trial_id: "a2", task_scores: ts(false) }, { status: "done", trial_id: "b2", task_scores: ts(true) }];
  assert.equal(aggregate(c)[0].complete, false, "a running comparison is never complete");
});

test("a failed Lightning run stops the comparison: the pair is an error, later pairs are not_run, nothing is promoted", async () => {
  const before = hashDir(BRAIN_DIR);
  const c = await startComparison(brain, { versions: [1, 2], seeds: [101, 102], tasks: [PICK], worker: "llm" }).done;
  assert.equal(c.status, "error");
  assert.deepEqual(c.per_seed.flatMap((ps) => ps.pairs.map((p) => p.status)), ["error", "not_run", "not_run", "not_run"]);
  assert.equal(getTrial(c.per_seed[0].pairs[0].trial_id!)!.status, "error");
  for (const a of c.aggregates) assert.deepEqual([a.expected_tasks, a.evaluated_tasks, a.successes, a.complete], [2, 0, 0, false]);
  assert.deepEqual(hashDir(BRAIN_DIR), before);
});

test("a restart marks running trials and comparisons interrupted and never resumes them", () => {
  const t = listTrials({ partition: "heldout" })[0];
  const tf = path.join(DATA, "trials/heldout", `${t.trial_id}.json`);
  fs.writeFileSync(tf, JSON.stringify({ ...JSON.parse(fs.readFileSync(tf, "utf8")), status: "running" }));
  const src = listComparisons().find((c) => c.status === "done")!;
  const running = { ...src, comparison_id: "cmp-cutoff", status: "running", per_seed: src.per_seed.map((ps, i) => ({ ...ps, pairs: ps.pairs.map((p, j) => ({ ...p, status: i === 0 && j === 0 ? "running" : i === 0 ? "done" : "pending" })) })) };
  fs.writeFileSync(path.join(DATA, "comparisons", "cmp-cutoff.json"), JSON.stringify(running));
  const calls = modelCalls;
  assert.ok(recoverInterruptedTrials().includes(t.trial_id));
  assert.ok(recoverInterruptedComparisons().includes("cmp-cutoff"));
  assert.equal(getTrial(t.trial_id)!.status, "interrupted");
  const c = getComparison("cmp-cutoff")!;
  assert.equal(c.status, "interrupted");
  assert.equal(c.per_seed[0].pairs[0].status, "interrupted");
  assert.ok(c.per_seed.slice(1).every((ps) => ps.pairs.every((p) => p.status === "not_run")));
  assert.ok(c.aggregates.every((a) => !a.complete));
  assert.equal(modelCalls, calls, "nothing was resumed");
});

test("requests are validated, and ids can never reach the file system as paths", () => {
  const req = (over: object) => code(() => startComparison(brain, { versions: [1, 2], seeds: [101], tasks: [PICK], worker: "compiled", ...over }));
  assert.equal(req({ versions: [1, 1] }), "400 bad_versions");
  assert.equal(req({ versions: [1, 9] }), "404 no_such_version");
  assert.equal(req({ seeds: [101, 101] }), "400 bad_seeds");
  assert.equal(req({ seeds: [5, 105] }), "400 bad_seeds");
  assert.equal(req({ seeds: [111] }), "400 bad_seeds");
  assert.equal(req({ tasks: [] }), "400 bad_tasks");
  assert.equal(req({ tasks: [PICK, PICK] }), "400 bad_tasks");
  assert.equal(req({ tasks: [{ type: "PICK", slot: "backroom:A-1-3-1" }] }), "400 bad_tasks");
  assert.equal(req({ worker: "gpt" }), "400 bad_worker");
  assert.equal(req({ environment: { max_speed_mps: 2 } }), "400 bad_environment");
  for (const bad of ["../../etc/passwd", "..", "a/b", "x.json"]) {
    assert.equal(code(() => getTrial(bad)), "400 bad_id");
    assert.equal(code(() => getComparison(bad)), "400 bad_id");
    assert.equal(code(() => getReview(bad)), "400 bad_id");
    assert.equal(code(() => getShift(bad)), "400 bad_id");
  }
});

test("a Lightning comparison runs alone; compiled comparisons are never blocked", async () => {
  const release = claimInference("shift", "shift-busy");
  try {
    assert.equal(code(() => startComparison(brain, { versions: [1, 2], seeds: [101], tasks: [PICK], worker: "llm" })), "409 inference_busy");
    await startComparison(brain, { versions: [1, 2], seeds: [101], tasks: [PICK], worker: "compiled" }).done;
  } finally {
    release();
  }
});

test("a comparison that fails while being set up gives its Lightning claim back", () => {
  class UnreadableBrain extends BrainStore {
    fileSha256(): string {
      throw new Error("disk read failed");
    }
  }
  assert.throws(() => startComparison(new UnreadableBrain(BRAIN_DIR), { versions: [1, 2], seeds: [101], tasks: [PICK], worker: "llm" }), /disk read failed/);
  const release = claimInference("comparison", "after-failed-setup"); // would be 409 if the claim had leaked
  release();
});

test("an old gate never counts for a candidate that has the same node ids but different rule values", () => {
  const gates = path.join(DATA, "gates");
  const diff12 = brain.diff(1, 2);
  const changed = structuredClone(diff12);
  changed.added_nodes[0].props.when[0].value = 3; // same id, a different weight threshold
  const created2 = brain.index().versions.find((r) => r.v === 2)!.created_at;
  const later = new Date(Date.parse(created2) + 1000).toISOString();
  const s = { task_id: "x", complete: true, refused_actions: 0, steps: 7, item_location: "tote", target_location: "tote" };
  for (const [id, diff] of [["gate-samechange", diff12], ["gate-sameids", changed]] as const)
    fs.writeFileSync(path.join(gates, `${id}.json`), JSON.stringify({ gate_id: id, status: "done", shift_id: "s", update_ids: ["U1"], base: 1, candidate: 2, seeds: [101], tasks: [PICK], worker: "llm", progress: {}, per_seed: [{ seed: 101, skipped: [], base: [s], candidate: [s] }], base_score: {}, candidate_score: {}, diff, llm: newTally(), started_at: later, finished_at: later }));
  const ev = evaluationsByVersion(brain);
  const ids = (v: number) => ev.find((e) => e.v === v)!.evaluations.map((e) => e.evaluation_id);
  assert.ok(ids(2).includes("gate-samechange"), "the identical change still counts");
  assert.ok(!ids(2).includes("gate-sameids"), "same ids, different rule value: not this v2's measurement");
  assert.ok(ids(1).includes("gate-sameids"), "the base it ran on is unaffected");
});

test("every saved snapshot is listed, unregistered or unavailable ones included, and browsing writes nothing", () => {
  const next = Math.max(...brain.versionsOnDisk()) + 1;
  const [extra, missing, broken] = [next, next + 1, next + 2];
  const v2 = JSON.parse(fs.readFileSync(path.join(BRAIN_DIR, "v2.json"), "utf8"));
  fs.writeFileSync(path.join(BRAIN_DIR, `v${extra}.json`), JSON.stringify({ ...v2, version: extra, parent: 2, created_by: "human", note: "copied in by hand" }));
  fs.writeFileSync(path.join(BRAIN_DIR, `v${broken}.json`), "{ not json");
  const idxFile = path.join(BRAIN_DIR, "index.json");
  const idx = JSON.parse(fs.readFileSync(idxFile, "utf8"));
  idx.versions.push({ v: missing, parent: 1, status: "rejected", created_at: new Date().toISOString(), note: "its file was deleted" });
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2) + "\n");
  const before = hashDir(BRAIN_DIR);

  const cat = brain.catalog();
  const entry = (v: number) => cat.versions.find((e) => e.v === v)!;
  assert.equal(cat.live, idx.live, "the live version is the index's, unchanged");
  assert.deepEqual(
    [entry(extra).status, entry(extra).indexed, entry(extra).available, entry(extra).parent, entry(extra).note, entry(extra).created_by],
    ["unregistered", false, true, 2, "copied in by hand", "human"],
  );
  assert.deepEqual([entry(missing).status, entry(missing).indexed, entry(missing).available, entry(missing).note], ["rejected", true, false, "its file was deleted"]);
  assert.match(entry(missing).unavailable_reason!, /missing/);
  assert.deepEqual([entry(broken).status, entry(broken).available], ["unregistered", false]);
  assert.equal(entry(1).status, idx.versions.find((r: any) => r.v === 1).status, "index statuses are kept as they are");

  const h = brain.history().versions;
  assert.equal(h.find((e) => e.v === extra)!.nodes, v2.nodes.length);
  assert.deepEqual([h.find((e) => e.v === missing)!.nodes, h.find((e) => e.v === extra)!.heldout_score], [null, null]);
  const ev = evaluationsByVersion(brain).find((e) => e.v === extra)!;
  assert.deepEqual([ev.status, ev.indexed, ev.evaluations.length], ["unregistered", false, 0], "listed as Not evaluated");
  assert.equal(brain.resolveVersion(extra), extra, "a comparison can name it");
  assert.deepEqual(hashDir(BRAIN_DIR), before, "listing wrote neither the index nor a snapshot");
});
