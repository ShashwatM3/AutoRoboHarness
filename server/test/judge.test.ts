import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { judgeReview } from "../src/judge.ts";
import { newTally } from "../src/llm.ts";
import type { Review } from "../src/supervisor.ts";
import { getShift, type Shift } from "../src/worker.ts";

// The judge against an in-process provider: no network, credentials or response-cache files.
process.env.CRUSOE_API_KEY = "local-test-key";
process.env.LLM_RPM = "600000";
process.env.LLM_CACHE = "0";

const SHIFTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/shifts");
const written: string[] = [];
const originalFetch = globalThis.fetch;
let requests: any[] = [];
let replies: ((body: any) => Response)[] = [];
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  requests.push(body);
  return replies.shift()!(body);
};
after(() => {
  globalThis.fetch = originalFetch;
  for (const f of written) fs.rmSync(f, { force: true });
});

const completion = (content: string) =>
  new Response(JSON.stringify({ id: "t", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), {
    headers: { "content-type": "application/json" },
  });

const step = (robot: string, task_id: string, n: number, action: string, args: object, ok: boolean, reason: string, torso = 1) =>
  ({ t: n, robot, task_id, step: n, brain_nodes_read: ["rule:grasp-default"], action, args, ok, reason, torso_level: torso, holding: null, item_location: "A-2-3-1", target_location: "tote" }) as any;

/** A saved training shift with one PICK by robot-1 (so describeRun can read it). */
function shift(id: string, weight: number, refused: boolean): Shift {
  const task_id = `${id}-t1`;
  const s = {
    shift_id: id,
    seed: 1,
    brain_version: 1,
    status: "done",
    tasks: [{ id: task_id, robot: "robot-1", type: "PICK", source: "A-2-3-1", target: "tote", card: { item: { id: "item:A-2-3-1", name: "Juice", weight_kg: weight } } }],
    scores: [{ task_id, complete: !refused, refused_actions: refused ? 1 : 0, steps: 2 }],
    trajectory: [
      step("robot-1", task_id, 1, "reach", { slot: "A-2-3-1" }, true, "ok", 3),
      step("robot-1", task_id, 2, "grasp", { mode: "one_hand" }, !refused, refused ? "one-hand payload limit exceeded (2 kg)" : "ok", 3),
    ],
    llm: newTally(),
  } as unknown as Shift;
  const f = path.join(SHIFTS, `${id}.json`);
  fs.mkdirSync(SHIFTS, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s));
  written.push(f);
  return getShift(id)!;
}

function review(shiftId: string): Review {
  const ok = "shift-judgetestok/robot-1";
  const bad = `${shiftId}/robot-1`;
  return {
    shift_id: shiftId,
    status: "done",
    brain_version: 1,
    started_at: "",
    failures: [
      { id: "F1", robot: "robot-1", task_id: "x", step: 2, check: "grasp one_hand refused", cause: "3.2 kg is over the 2 kg one-hand limit", nodes_in_effect: [], verified: true },
      { id: "F2", robot: "robot-1", task_id: "x", step: 1, check: "reach refused", cause: "torso too low", nodes_in_effect: [], verified: true },
      { id: "F3", robot: "robot-1", task_id: "x", step: 2, check: "grasp refused", cause: "weight", nodes_in_effect: [], verified: true },
      { id: "F4", robot: "robot-9", task_id: "x", step: 1, check: "refused", cause: "ghost", nodes_in_effect: [], verified: false },
    ],
    insights: [
      {
        id: "I1",
        claim: "Items over 2 kg need two hands",
        addresses: ["F1"],
        verified: true,
        grounding: [
          { kind: "run_contrast", ok_run: ok, failed_run: bad, note: "", verified: true },
          { kind: "citation", source_id: "S1", url: "https://example.org/a", title: "A", snippet: "lift with two hands", verified: true },
        ],
        citations: [{ source_id: "S1", url: "https://example.org/a", title: "A", snippet: "lift with two hands" }],
      },
      { id: "I2", claim: "Shoppers scan shelves", addresses: ["F2"], verified: false, grounding: [{ kind: "clip", clip_id: "no_such_clip", note: "", verified: false }] },
      {
        id: "I3",
        claim: "Web says so",
        addresses: ["F1"],
        verified: false,
        grounding: [{ kind: "citation", source_id: "S2", url: "https://example.org/b", title: "B", snippet: "", verified: true }],
        citations: [{ source_id: "S2", url: "https://example.org/b", title: "B", snippet: "" }],
      },
    ],
    updates: [
      { id: "U1", summary: "", ops: [{ tool: "add_rule", cites: ["F1", "I1"] }], compiled: [], valid: true, errors: [], touches_guardrail: false },
      { id: "U2", summary: "", ops: [{ tool: "add_rule", cites: ["F2"] }], compiled: [], valid: true, errors: [], touches_guardrail: false },
      { id: "U3", summary: "", ops: [{ tool: "add_rule", cites: [] }], compiled: [], valid: true, errors: [], touches_guardrail: false },
    ] as any,
    detected: { refused_steps: [], incomplete_tasks: [] },
    tool_calls: [],
    llm: newTally(),
  };
}

test("the judge drops what its evidence does not show, without a model call where it can", async () => {
  shift("shift-judgetestok", 0.68, false);
  const s = shift("shift-judgetestbad", 3.24, true);
  const r = review(s.shift_id);
  requests = [];
  // F3 gets no verdict; I1's 2nd evidence item (the citation) is weak
  replies = [
    () =>
      completion(
        JSON.stringify({
          verdicts: [
            { id: "F1", keep: true, why: "step 2 refused for payload" },
            { id: "F2", keep: false, why: "step 1 reach was ok" },
            { id: "I1", keep: true, why: "runs differ by weight", weak_grounding: [2] },
          ],
        }),
      ),
  ];
  const j = await judgeReview(null as any, s, r);

  assert.equal(requests.length, 1, "one model call for everything that could not be decided offline");
  const body = requests[0];
  assert.equal(body.model, "deepseek-ai/DeepSeek-V4-Pro");
  assert.deepEqual(body.chat_template_kwargs, { thinking: true }, "DeepSeek's own thinking key");
  assert.equal(body.response_format.type, "json_schema");
  const prompt = body.messages[1].content as string;
  assert.match(prompt, /Judge these ids: F1, F2, F3, I1\./, "auto-dropped ids are not sent");
  assert.match(prompt, /web source S1: "A" \(https:\/\/example\.org\/a\): lift with two hands/);
  assert.match(prompt, /Juice" 0\.68 kg/, "the run contrast shows both runs' items");

  assert.deepEqual(j.kept, ["F1", "I1"]);
  const why = Object.fromEntries(j.dropped.map((d) => [d.id, d.why]));
  assert.deepEqual(Object.keys(why).sort(), ["F2", "F3", "F4", "I2", "I3"]);
  assert.match(why.F3, /no verdict/);
  assert.match(why.F4, /not in the trajectory/);
  assert.match(why.I2, /no existing clip or run/);
  assert.match(why.I3, /web source alone/);

  assert.deepEqual(r.failures.map((f) => f.judge?.keep), [true, false, false, false]);
  assert.deepEqual(Object.keys(r.failures[0].judge!).sort(), ["keep", "why"], "no internal fields leak into verdicts");
  const i1 = r.insights[0];
  assert.deepEqual(i1.grounding.map((g: any) => g.judge_supports), [true, false]);
  assert.equal(i1.citations![0].judge_supports, false);
  assert.deepEqual(r.updates.map((u) => u.judge_supported), [true, false, false]);
  assert.equal(r.llm!.calls, 1, "the judge call is tallied on the review");
});

test("the judge falls back to json_object when json_schema is refused", async () => {
  const s = shift("shift-judgetestfallback", 3.24, true);
  const r = review(s.shift_id);
  r.insights = [];
  r.failures = r.failures.slice(0, 1);
  requests = [];
  replies = [
    () => new Response(JSON.stringify({ error: { message: "response_format not supported" } }), { status: 400, headers: { "content-type": "application/json" } }),
    () => completion('```json\n{"verdicts":[{"id":"F1","keep":true,"why":"ok"}]}\n```'),
  ];
  const j = await judgeReview(null as any, s, r);
  assert.deepEqual(requests.map((b) => b.response_format.type), ["json_schema", "json_object"]);
  assert.deepEqual(j.kept, ["F1"]);
});
