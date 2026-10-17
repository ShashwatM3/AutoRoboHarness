import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { BrainStore } from "../src/brain.ts";
import { newTally } from "../src/llm.ts";
import { getRun, listRuns } from "../src/runs.ts";
import { startShift } from "../src/worker.ts";

// Offline and read-only: fixtures live in a temporary data folder, and the model endpoint is a stub that counts calls.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "runs-test-"));
const DATA = path.join(TMP, "data");
process.env.AUTOROBO_DATA_DIR = DATA;
process.env.CRUSOE_API_KEY = "local-test-key";
process.env.LLM_CACHE = "0";

let modelCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  modelCalls++;
  return new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
};
after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(TMP, { recursive: true, force: true });
});

const write = (dir: string, id: string, value: object) => {
  fs.mkdirSync(path.join(DATA, dir), { recursive: true });
  fs.writeFileSync(path.join(DATA, dir, `${id}.json`), JSON.stringify(value));
};
const shift = (id: string, started_at: string, extra: object = {}) => ({
  shift_id: id,
  seed: 1,
  brain_version: 4,
  worker: "llm",
  status: "done",
  started_at,
  finished_at: started_at,
  tasks: [{ id: `${id}-t1`, robot: "robot-1", type: "PICK", item_id: "item:A-1-3-1", source: "A-1-3-1", target: "tote" }],
  scores: [{ task_id: `${id}-t1`, complete: false, refused_actions: 1, steps: 8, item_location: "tote", target_location: "tote" }],
  llm: newTally(),
  trajectory: [{ t: 1, robot: "robot-1", task_id: `${id}-t1`, step: 1, action: "grasp", args: { mode: "one_hand" }, ok: false, reason: "one-hand payload limit exceeded (2 kg)" }],
  ...extra,
});
const gate = (id: string, shift_id: string, started_at: string) => ({ gate_id: id, status: "done", shift_id, update_ids: ["U1"], base: 4, candidate: 5, seeds: [101], tasks: [], worker: "llm", progress: { done: 2, total: 2 }, per_seed: [], diff: {}, llm: newTally(), started_at, verdict: "promoted" });

// a reviewed run with two gates, an older run with nothing, and records that are not training shifts
write("shifts", "shift-reviewed", shift("shift-reviewed", "2026-10-17T22:10:00.000Z", { trial_id: "trial-x-1" }));
write("shifts", "shift-plain", shift("shift-plain", "2026-10-17T20:00:00.000Z"));
write("reviews", "shift-reviewed", { shift_id: "shift-reviewed", status: "done", brain_version: 4, failures: [{ id: "F1" }], insights: [], updates: [], judge: { kept: ["F1"], dropped: [] } });
write("gates", "gate-first", gate("gate-first", "shift-reviewed", "2026-10-17T22:20:00.000Z"));
write("gates", "gate-second", gate("gate-second", "shift-reviewed", "2026-10-17T22:40:00.000Z"));
write("gates", "gate-other", gate("gate-other", "shift-elsewhere", "2026-10-17T22:30:00.000Z"));
write("trials/heldout", "trial-heldout-1", { trial_id: "trial-heldout-1", kind: "gate", partition: "heldout", status: "done" });
write("comparisons", "cmp-x-1", { comparison_id: "cmp-x-1", status: "done" });

const snapshot = () => {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else out[path.relative(DATA, p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(DATA);
  return out;
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return `${e.status} ${e.extra?.code ?? ""}`.trim();
  }
  return "no error";
};

test("the run list shows saved training shifts newest first, with review status and their own gates", () => {
  const before = snapshot();
  const runs = listRuns();
  assert.deepEqual(runs.map((r) => r.shift_id), ["shift-reviewed", "shift-plain"]);
  const [reviewed, plain] = runs;
  assert.deepEqual([reviewed.review_status, reviewed.gate_ids, reviewed.trial_id, reviewed.replay_available], ["done", ["gate-first", "gate-second"], "trial-x-1", true]);
  assert.deepEqual([plain.review_status, plain.gate_ids, plain.trial_id, plain.replay_available], [null, [], null, false]);
  assert.equal("trajectory" in reviewed, false, "summaries leave the trajectory out");
  assert.deepEqual(snapshot(), before, "listing writes nothing");
  assert.equal(modelCalls, 0);
});

test("a run's detail is the stored shift, its saved review and every gate made from it", () => {
  const run = getRun("shift-reviewed")!;
  assert.equal(run.shift.trajectory.length, 1);
  assert.equal(run.shift.trajectory[0].ok, false);
  assert.deepEqual(run.review?.judge, { kept: ["F1"], dropped: [] });
  assert.deepEqual(run.gates.map((g) => [g.gate_id, g.shift_id, g.verdict]), [["gate-first", "shift-reviewed", "promoted"], ["gate-second", "shift-reviewed", "promoted"]]);
});

test("a run without a review stays without one: nothing is started or written", () => {
  const before = snapshot();
  const run = getRun("shift-plain")!;
  assert.deepEqual([run.review, run.gates], [null, []]);
  assert.equal(fs.existsSync(path.join(DATA, "reviews", "shift-plain.json")), false);
  assert.deepEqual(snapshot(), before, "no review, shift, gate or trial file was created or changed");
  assert.equal(modelCalls, 0, "no model call");
});

test("held-out trials, comparisons and gates are not training runs; bad ids never reach the disk", () => {
  for (const id of ["trial-heldout-1", "cmp-x-1", "gate-first", "shift-elsewhere"]) assert.equal(getRun(id), undefined, `${id} is not a saved training run`);
  assert.ok(listRuns().every((r) => r.shift_id.startsWith("shift-")));
  for (const bad of ["../trials/heldout/trial-heldout-1", "..", "a/b", "shift-reviewed.json"]) assert.equal(code(() => getRun(bad)), "400 bad_id");
});

test("a training shift still running in memory is listed too", async () => {
  const brainDir = path.join(TMP, "brain");
  fs.mkdirSync(brainDir);
  fs.copyFileSync(path.join(ROOT, "brain/v1.json"), path.join(brainDir, "v1.json"));
  const s = startShift(new BrainStore(brainDir), { seed: 1, tasks: [{ type: "PICK", slot: "A-1-3-1" }], worker: "compiled" });
  const listed = listRuns().find((r) => r.shift_id === s.shift_id)!;
  assert.ok(listed, "listed before it is saved");
  assert.deepEqual([listed.trial_id, listed.review_status, listed.gate_ids], [s.trial_id, null, []]);
  assert.equal(getRun(s.shift_id)!.shift.shift_id, s.shift_id);
  for (let i = 0; i < 100 && getRun(s.shift_id)!.shift.status === "running"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(modelCalls, 0);
});
