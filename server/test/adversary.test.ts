import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createScenario } from "../../engine/store.ts";
import { BrainStore } from "../src/brain.ts";
import { attackCatalog, getAttack, recoverInterruptedAttacks, startAttack } from "../src/adversary.ts";
import { claimInference } from "../src/inference-lock.ts";
import { getReview } from "../src/supervisor.ts";
import { getTrial, prepareTrial } from "../src/trials.ts";
import { getShift, listShifts, publishAdversarialShift } from "../src/worker.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adversary-test-"));
process.env.AUTOROBO_DATA_DIR = path.join(tmp, "data");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.join(tmp, "brain"); fs.mkdirSync(dir);
fs.copyFileSync(path.join(root, "brain/v1.json"), path.join(dir, "v1.json"));
const brain = new BrainStore(dir);
brain.index(); // normal fresh-checkout initialization precedes the immutability audit
const digest = () => Object.fromEntries(fs.readdirSync(dir).map(f => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest('hex')]));
const originalFetch = globalThis.fetch; let calls = 0;
globalThis.fetch = async () => { calls++; throw new Error('no network in adversary tests'); };
after(() => { globalThis.fetch = originalFetch; fs.rmSync(tmp, { recursive: true, force: true }); });

test("only failed completed training attacks enter review; recordings preserve disturbances and immutable brains", async () => {
  const before = digest();
  const { attack, done } = startAttack(brain, { seed: 1, task: { type: 'PICK', slot: 'A-1-3-1' }, worker: 'compiled', proposer: 'catalog', attempts: 4 });
  const a = await done;
  assert.equal(a.status, 'done'); assert.equal(a.tried, 4); assert.ok(a.broke > 0);
  assert.deepEqual(getAttack(a.adversary_id), a);
  assert.deepEqual(digest(), before); assert.equal(calls, 0);
  for (const attempt of a.attempts) {
    const t = getTrial(attempt.trial_id!)!;
    assert.equal(t.partition, 'training'); assert.equal(t.kind, 'adversary');
    assert.deepEqual(t.initial.disturbances, [attempt.disturbance]); assert.ok(t.final);
    if (attempt.broken) {
      const shift = getShift(attempt.shift_id!)!;
      assert.equal(shift.source?.adversary_id, attack.adversary_id);
      assert.equal(shift.trial_id, t.trial_id); assert.deepEqual(shift.trajectory, t.trajectory);
      assert.equal(getReview(shift.shift_id), undefined, 'reading the attack never starts a review');
    } else assert.ok(!listShifts().some(s => s.trial_id === t.trial_id));
  }
  assert.throws(() => publishAdversarialShift({ ...getTrial(a.attempts[0].trial_id!)!, partition: 'heldout' }, a.adversary_id, {}));
});

test("held-out seeds, invalid model selections, and altered evaluation worlds are rejected", async () => {
  assert.throws(() => startAttack(brain, { seed: 101 }));
  const a = await startAttack(brain, { worker: 'compiled', proposer: 'catalog' }, { choose: async () => [{ candidate: 999, rationale: 'invented' }] }).done;
  assert.equal(a.status, 'error'); assert.equal(a.tried, 0); assert.equal(a.attempts.length, 0);
  assert.throws(() => prepareTrial(brain, { scenario: createScenario(101, 1), seed: 101, partition: 'heldout' } as any), /training world/);
  assert.equal(calls, 0);
});

test("V3 inference is exclusive, releases on errors, and interrupted jobs never resume", async () => {
  const release = claimInference('post-training', 'post-test');
  assert.throws(() => claimInference('shift', 'blocked'));
  assert.throws(() => startAttack(brain, { proposer: 'llm', worker: 'compiled' }));
  release();
  const releaseAttack = claimInference('adversary', 'attack-test');
  assert.throws(() => claimInference('comparison', 'blocked')); releaseAttack();
  const a = await startAttack(brain, { worker: 'compiled', proposer: 'catalog', attempts: 1 }, { runner: async () => { throw new Error('worker failed'); } }).done;
  assert.equal(a.tried, 0); assert.equal(a.broke, 0); assert.equal(a.attempts[0].status, 'error');
  const file = path.join(process.env.AUTOROBO_DATA_DIR!, 'adversary', `${a.adversary_id}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...a, status: 'running' }));
  recoverInterruptedAttacks(); assert.equal(getAttack(a.adversary_id)!.status, 'interrupted'); assert.equal(calls, 0);
  assert.equal(attackCatalog(1, { type: 'PICK', slot: 'A-1-3-1' }).length, 4);
});
