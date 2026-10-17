import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { BrainStore } from "../src/brain.ts";
import { selectUpdates, updateBrain } from "../src/gate.ts";
import { newTally } from "../src/llm.ts";
import type { Review } from "../src/supervisor.ts";

// The gate refuses judge-rejected selections before it compiles, applies or runs anything (V2).
// Offline: reviews are fixture files, the brain is a temporary copy of v1, and any model call fails the test.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REVIEW_DIR = path.join(ROOT, "server/data/reviews");
const written: string[] = [];
const temps: string[] = [];

let modelCalls = 0;
const originalFetch = globalThis.fetch;
const originalJudge = process.env.JUDGE;
process.env.CRUSOE_API_KEY = "local-test-key";
globalThis.fetch = async () => {
  modelCalls++;
  throw new Error("the gate made a model call");
};
after(() => {
  globalThis.fetch = originalFetch;
  if (originalJudge === undefined) delete process.env.JUDGE;
  else process.env.JUDGE = originalJudge;
  for (const f of written) fs.rmSync(f, { force: true });
  for (const d of [REVIEW_DIR, path.dirname(REVIEW_DIR)]) {
    try {
      fs.rmdirSync(d); // only if the fixtures left it empty
    } catch {}
  }
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});

function tempBrain<T extends BrainStore>(make: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-test-brain-"));
  temps.push(dir);
  fs.copyFileSync(path.join(ROOT, "brain/v1.json"), path.join(dir, "v1.json"));
  const b = make(dir);
  b.index(); // first boot writes index.json, so later snapshots compare like with like
  return b;
}

/** Stops at brain.apply and records what would have been written, so a passing selection never touches disk. */
class ApplyProbe extends BrainStore {
  applied?: { base: number; ops: unknown[]; note?: string };
  override apply(base: number, ops: any[], meta: { note?: string } = {}): never {
    this.applied = { base, ops, note: meta.note };
    throw new Error("apply reached");
  }
}

const brain = tempBrain((d) => new BrainStore(d));
const brainDir = (brain as any).dir as string;
const snapshot = () => fs.readdirSync(brainDir).sort().map((f) => [f, fs.readFileSync(path.join(brainDir, f), "utf8")]);

const op = (value: number) => ({ op: "set_prop", id: "rule:grasp-default", key: "priority", value });
let n = 0;
function update(id: string, extra: Record<string, unknown> = {}) {
  return { id, summary: `${id} summary`, ops: [{ op: "set_rule", cites: ["F1"] }], compiled: [op(++n)], valid: true, errors: [], touches_guardrail: false, judge_supported: true, ...extra };
}
const judged = { model: "judge-test", kept: ["F1"], dropped: [], finished_at: "2026-10-17T00:00:00.000Z" };

/** Save a finished review where getReview finds it; V2 reviews carry a token tally and judge verdicts. */
function saved(updates: ReturnType<typeof update>[], extra: Record<string, unknown> = { llm: newTally(), judge: judged }): Review {
  const shift_id = `shift-gatetest${(++n).toString(36)}${Date.now().toString(36)}`;
  const review = { shift_id, status: "done", brain_version: 1, started_at: "2026-10-17T00:00:00.000Z", failures: [], insights: [], updates, detected: { refused_steps: [], incomplete_tasks: [] }, tool_calls: [], ...extra };
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  const f = path.join(REVIEW_DIR, `${shift_id}.json`);
  fs.writeFileSync(f, JSON.stringify(review));
  written.push(f);
  return review as unknown as Review;
}

/** updateBrain must throw this status and code, with the brain unchanged on disk and no model called. */
function refused(input: Record<string, unknown>, status: number, code: string) {
  const before = snapshot();
  assert.throws(
    () => updateBrain(brain, input as any),
    (e: any) => {
      assert.equal(e.status, status, `expected ${status} ${code}, got ${e.status}: ${e.message}`);
      assert.equal(e.extra?.code, code, e.message);
      return true;
    },
  );
  assert.deepEqual(snapshot(), before, "the brain changed on disk");
  assert.equal(modelCalls, 0, "the gate called a model");
}

/** updateBrain must get as far as brain.apply; returns what it would have applied. */
function reachesApply(input: Record<string, unknown>) {
  const probe = tempBrain((d) => new ApplyProbe(d));
  assert.throws(() => updateBrain(probe, input as any), /apply reached/);
  assert.equal(modelCalls, 0, "the gate called a model");
  return probe.applied!;
}

test("update_ids: [] is refused instead of meaning every update", () => {
  const r = saved([update("U1"), update("U2")]);
  refused({ shift_id: r.shift_id, update_ids: [] }, 400, "bad_update_ids");
  refused({ shift_id: r.shift_id, update_ids: "U1U2" }, 400, "bad_update_ids"); // a string used to substring-match
  refused({ shift_id: r.shift_id, update_ids: ["U9"] }, 400, "unknown_updates");
  refused({ shift_id: r.shift_id, update_ids: ["U1", "U9"] }, 400, "unknown_updates");
});

test("a failed judge blocks the gate before anything is applied or run", () => {
  const r = saved([update("U1"), update("U2", { touches_guardrail: true })], { llm: newTally(), judge: { ...judged, kept: [], error: "judge timed out" } });
  refused({ shift_id: r.shift_id }, 409, "judge_failed");
  refused({ shift_id: r.shift_id, update_ids: ["U1"] }, 409, "judge_failed");
  refused({ shift_id: r.shift_id, update_ids: ["U2"] }, 409, "judge_failed"); // before the guardrail question
  process.env.JUDGE = "0"; // turning the judge off does not wave through a judge that failed
  try {
    refused({ shift_id: r.shift_id }, 409, "judge_failed");
  } finally {
    delete process.env.JUDGE;
  }
});

test("naming a judge-unsupported update is refused, even next to a supported one", () => {
  const r = saved([update("U1"), update("U2", { judge_supported: false }), update("U3", { judge_supported: undefined })]);
  refused({ shift_id: r.shift_id, update_ids: ["U2"] }, 409, "judge_unsupported");
  refused({ shift_id: r.shift_id, update_ids: ["U1", "U2"] }, 409, "judge_unsupported");
  refused({ shift_id: r.shift_id, update_ids: ["U3"] }, 409, "judge_unsupported"); // judged review, no verdict: not supported
  assert.throws(
    () => updateBrain(brain, { shift_id: r.shift_id, update_ids: ["U1", "U2"] }),
    (e: any) => {
      assert.deepEqual(e.extra.update_ids, ["U2"], "the error names the unsupported update");
      return true;
    },
  );
});

test("automatic selection takes only valid, judge-supported updates once a judge exists", () => {
  const u = [update("U1"), update("U2", { judge_supported: false }), update("U3", { valid: false, errors: ["bad scope"] }), update("U4")];
  const r = saved(u);
  const applied = reachesApply({ shift_id: r.shift_id });
  assert.deepEqual(applied.ops, [...u[0].compiled, ...u[3].compiled]);
  assert.equal(applied.note, "U1: U1 summary | U4: U4 summary");
  assert.deepEqual(selectUpdates(r, undefined).chosen.map((x) => x.id), ["U1", "U4"]);
  assert.equal(selectUpdates(r, undefined).judge_policy, "enforced");
  assert.deepEqual(reachesApply({ shift_id: r.shift_id, update_ids: ["U4"] }).ops, u[3].compiled);

  const none = saved([update("U1", { judge_supported: false }), update("U2", { valid: false, errors: ["x"] })]);
  refused({ shift_id: none.shift_id }, 400, "no_updates");
});

test("a Version 2 review with no judge needs one unless JUDGE=0 turns the judge off", () => {
  const u = [update("U1", { judge_supported: undefined }), update("U2", { judge_supported: undefined })];
  const r = saved(u, { llm: newTally() });
  refused({ shift_id: r.shift_id }, 409, "judge_missing");
  refused({ shift_id: r.shift_id, update_ids: ["U1"] }, 409, "judge_missing");
  process.env.JUDGE = "0";
  try {
    assert.deepEqual(reachesApply({ shift_id: r.shift_id }).ops, [...u[0].compiled, ...u[1].compiled]);
    assert.equal(selectUpdates(r, undefined).judge_policy, "disabled");
  } finally {
    delete process.env.JUDGE;
  }
});

test("a Version 1 review (no judge, no token tally) still gates on valid alone", () => {
  const u = [update("U1", { judge_supported: undefined }), update("U2", { judge_supported: undefined, valid: false, errors: ["bad"] })];
  const r = saved(u, {});
  assert.deepEqual(reachesApply({ shift_id: r.shift_id }).ops, u[0].compiled);
  assert.equal(selectUpdates(r, undefined).judge_policy, "v1_review");
  refused({ shift_id: r.shift_id, update_ids: ["U2"] }, 400, "invalid_updates");
});

test("guardrail approval still applies to judge-supported updates", () => {
  const u = [update("U1", { touches_guardrail: true })];
  const r = saved(u);
  const before = snapshot();
  assert.throws(() => updateBrain(brain, { shift_id: r.shift_id }), (e: any) => e.status === 403);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(reachesApply({ shift_id: r.shift_id, approve_guardrails: true }).ops, u[0].compiled);
});
