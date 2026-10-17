// The judge (V2-1): a second model from another family (DeepSeek V4 Pro, thinking on) re-checks every failure
// and insight in a supervisor review against the evidence it cites, and drops what that evidence does not show.
// Citations that point at nothing (no such step, clip or run) are dropped without asking the model.

import type { BrainStore } from "./brain.ts";
import { chat, MODELS, parseJson, tally } from "./llm.ts";
import { clips, fmtStep, type Review } from "./supervisor.ts";
import { getShift, type Shift } from "./worker.ts";

export interface JudgeResult {
  model: string;
  kept: string[];
  dropped: { id: string; why: string }[];
  finished_at: string;
  error?: string;
}

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          keep: { type: "boolean" },
          why: { type: "string" },
          weak_grounding: { type: "array", items: { type: "integer" } },
        },
        required: ["id", "keep", "why"],
      },
    },
  },
  required: ["verdicts"],
};

const SYSTEM = `You are an independent judge auditing another model's review of a robot shift in a simulated convenience store. The reviewer reported failures (F1, F2, ...) and insights (I1, I2, ...), each citing evidence. For each one you get the claim and the evidence it cites, taken straight from the logs and the footage library. Decide whether the evidence shows the claim.

Keep a failure only if the cited step's facts (its action, its outcome, the refusal reason, the item weight, the shelf level, the torso level) agree with the stated check and cause. Drop it if the step did not fail the way it says, or the cause contradicts the facts.
Keep an insight only if at least one cited clip or run contrast actually shows what the claim says: a clip must show the behaviour the claim relies on; a run contrast must differ in the way the claim says (for example the run that went well really had the lighter item or the matching torso level). A web source's excerpt can add support but cannot carry an insight alone, and it supports the claim only if the excerpt says so. Plausible is not enough. Also list, in weak_grounding, the numbers of the evidence items that do not support the claim, even when you keep the insight.

Reply with JSON only: { "verdicts": [{ "id": "F1", "keep": true, "why": "...", "weak_grounding": [] }] }, one verdict per id, each "why" at most 25 words.`;

/** "shift-x/robot-1" -> that run's task, result and steps, from the saved shift. */
function describeRun(runId: string): string {
  const m = /^(shift-[A-Za-z0-9_-]{1,75})\/(robot-[1-4])$/.exec(runId);
  const s = m && getShift(m[1]);
  const t = s?.tasks.find((x) => x.robot === m![2]);
  if (!s || !t) return `${runId}: no such run`;
  const sc = s.scores.find((x) => x.task_id === t.id);
  const steps = s.trajectory.filter((x) => x.task_id === t.id).map((x) => `    ${fmtStep(x)}`);
  return [
    `${runId}: seed ${s.seed}, brain v${s.brain_version}, ${t.type} item "${t.card.item.name}" ${t.card.item.weight_kg} kg, ${t.source} -> ${t.target}`,
    `  result: ${sc?.complete ? "COMPLETE" : "INCOMPLETE"}, ${sc?.refused_actions} refused actions`,
    ...steps,
  ].join("\n");
}

function taskLine(shift: Shift, robot: string) {
  const t = shift.tasks.find((x) => x.robot === robot);
  return t ? `${t.type} item "${t.card.item.name}" ${t.card.item.weight_kg} kg, ${t.source} -> ${t.target} (slot ids are aisle-bay-level-position)` : "no task for this robot";
}

/** Judge a finished review in place: sets judge verdicts on its failures, insights and updates, and review.judge. */
export async function judgeReview(_brain: BrainStore, shift: Shift, review: Review): Promise<JudgeResult> {
  const lib = new Map(clips().map((c) => [c.clip_id, c]));
  const auto: Record<string, string> = {};
  const L: string[] = [`SHIFT ${shift.shift_id}: seed ${shift.seed}, brain v${shift.brain_version}`, ""];

  for (const f of review.failures) {
    const step = shift.trajectory.find((s) => s.robot === f.robot && s.step === Number(f.step));
    if (!step) {
      auto[f.id] = `cites ${f.robot} step ${f.step}, which is not in the trajectory`;
      continue;
    }
    L.push(`${f.id} (failure) ${f.robot} step ${f.step}`);
    L.push(`  claimed check: ${f.check}`);
    L.push(`  claimed cause: ${f.cause}`);
    L.push(`  EVIDENCE task: ${taskLine(shift, f.robot)}`);
    L.push(`  EVIDENCE step: ${fmtStep(step)}`);
    L.push(`  EVIDENCE brain nodes the robot had read: ${step.brain_nodes_read.join(", ") || "none"}`);
    L.push("");
  }

  for (const ins of review.insights) {
    const real = ins.grounding.filter((g: any) => g.verified && g.kind !== "citation");
    if (!real.length) {
      auto[ins.id] = "it cites no existing clip or run (a web source alone does not ground a lesson about these robots)";
      continue;
    }
    L.push(`${ins.id} (insight, addresses ${ins.addresses.join(", ") || "nothing"})`);
    L.push(`  claim: ${ins.claim}`);
    ins.grounding.forEach((g: any, i: number) => {
      const n = i + 1;
      if (g.kind === "clip") {
        const c = lib.get(g.clip_id);
        L.push(`  EVIDENCE ${n} clip ${g.clip_id}: ${c ? `${c.action}, hands ${c.hands}, ${c.shelf_height} shelf, ${c.item_size} item, looked or touched first: ${c.looked_or_touched_first}. ${c.description}` : "no such clip"}`);
      } else if (g.kind === "citation") {
        L.push(`  EVIDENCE ${n} web source ${g.source_id}: ${g.verified ? `"${g.title}" (${g.url}): ${g.snippet || "no excerpt"}` : "no such source"}`);
      } else {
        L.push(`  EVIDENCE ${n} run contrast, run that went well vs run that failed:`);
        L.push(describeRun(g.ok_run).replace(/^/gm, "    "));
        L.push(describeRun(g.failed_run).replace(/^/gm, "    "));
      }
      if (g.note) L.push(`    reviewer's note on evidence ${n}: ${g.note}`);
    });
    L.push("");
  }

  const asked = [...review.failures, ...review.insights].map((x) => x.id).filter((id) => !auto[id]);
  const verdicts = new Map<string, { keep: boolean; why: string; weak_grounding?: number[] }>();
  let model: string = MODELS.judge;
  if (asked.length) {
    const messages = [
      { role: "system" as const, content: SYSTEM },
      { role: "user" as const, content: `${L.join("\n")}\nJudge these ids: ${asked.join(", ")}.` },
    ];
    const call = async (m: string, response_format: unknown) =>
      chat({ model: m, messages, max_tokens: 8192, response_format } as any, { role: "judge", thinking: true, meta: { shift_id: shift.shift_id } });
    const ask = async (m: string) => {
      try {
        return await call(m, { type: "json_schema", json_schema: { name: "judge", schema: JUDGE_SCHEMA } });
      } catch (e: any) {
        if (e?.status !== 400) throw e;
        return await call(m, { type: "json_object" });
      }
    };
    let res;
    try {
      res = await ask(model);
    } catch (e: any) {
      if (!(e?.status === 404 || e?.status >= 500)) throw e;
      console.warn(`[judge] ${model} failed (${e?.status}); falling back to ${MODELS.supervisor_fallback}`);
      model = MODELS.supervisor_fallback;
      res = await ask(model);
    }
    if (review.llm) tally(review.llm, res);
    const out = parseJson<{ verdicts?: any[] }>(res.choices[0]?.message?.content);
    for (const v of Array.isArray(out.verdicts) ? out.verdicts : []) {
      if (asked.includes(String(v?.id))) verdicts.set(String(v.id), { keep: v.keep === true, why: String(v.why ?? ""), weak_grounding: Array.isArray(v.weak_grounding) ? v.weak_grounding.map(Number) : [] });
    }
  }

  const verdict = (id: string) => {
    if (auto[id]) return { keep: false, why: auto[id] };
    const v = verdicts.get(id);
    return v ? { keep: v.keep, why: v.why } : { keep: false, why: "the judge returned no verdict for this id, so it is not confirmed" };
  };
  for (const f of review.failures) f.judge = verdict(f.id);
  for (const ins of review.insights) {
    ins.judge = verdict(ins.id);
    const weak = new Set(verdicts.get(ins.id)?.weak_grounding ?? []);
    ins.grounding.forEach((g: any, i: number) => (g.judge_supports = !!g.verified && !weak.has(i + 1)));
    for (const c of ins.citations ?? []) c.judge_supports = ins.grounding.some((g: any) => g.kind === "citation" && g.source_id === c.source_id && g.judge_supports);
  }
  const kept = [...review.failures, ...review.insights].filter((x) => x.judge!.keep).map((x) => x.id);
  // an update stays supported while at least one finding it cites survives the judge
  for (const u of review.updates) {
    const cites = new Set(u.ops.flatMap((op: any) => (Array.isArray(op?.cites) ? op.cites : [])));
    u.judge_supported = [...cites].some((id) => kept.includes(String(id)));
  }
  return {
    model,
    kept,
    dropped: [...review.failures, ...review.insights].filter((x) => !x.judge!.keep).map((x) => ({ id: x.id, why: x.judge!.why })),
    finished_at: new Date().toISOString(),
  };
}
