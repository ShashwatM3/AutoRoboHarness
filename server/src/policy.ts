// The compiled policy: a deterministic worker that executes the brain exactly as written, with no model calls.
// The gate uses it so its score measures the brain itself, and so 40 re-runs fit in a second instead of the
// ~20 minutes Lightning would need at our rate limit. It has the same inputs as the Lightning worker:
//   - PROCEDURE steps in NEXT order, with $task.* from the task card and $rule.<param> from matching rules
//   - RULES as standing instructions: before reaching into a slot, a matching torso.level rule sets the torso
//   - PROTOCOLS on their triggers (slot_mismatch and slot_empty after a scan, grasp_refused, out_of_reach)
// When an action is refused and no protocol covers it, it recovers the way the Lightning worker does (raise or
// lower the torso to the slot, retry a grasp with two hands, retract before driving). Those refusals still count.

import type { ActionResult, StoreEngine } from "../../engine/store.ts";
import type { BrainStore } from "./brain.ts";
import type { BrainNode, Cond } from "./types.ts";
import { act, taskContext, type RunCtx, type Shift } from "./worker.ts";

const MAX_ACTIONS = 30;

type Facts = Record<string, number | string>;

function holds(c: Cond, f: Facts): boolean {
  const v = f[c.field];
  if (v === undefined) return false;
  switch (c.op) {
    case ">":
      return Number(v) > Number(c.value);
    case ">=":
      return Number(v) >= Number(c.value);
    case "<":
      return Number(v) < Number(c.value);
    case "<=":
      return Number(v) <= Number(c.value);
    case "==":
      return v == c.value;
    case "!=":
      return v != c.value;
  }
  return false;
}

/** The first rule for a param whose conditions hold; rules arrive deeper scope first, then higher priority. */
function ruleValue(rules: BrainNode[], param: string, f: Facts): unknown {
  const r = rules.find((n) => n.props.then?.param === param && ((n.props.when ?? []) as Cond[]).every((c) => holds(c, f)));
  if (!r) return undefined;
  const v = r.props.then.value;
  return v === "$slot.level" ? f["slot.level"] : v;
}

export async function runCompiled(brain: BrainStore, engine: StoreEngine, run: RunCtx, task: Shift["tasks"][number]) {
  const robot = task.robot;
  const ctx = taskContext(brain, run.brain_version, task);
  engine.setBrainNodesRead(robot, ctx.node_ids);
  const card = task.card;
  const slots = engine.scenario.layout.slots;
  const levelOf = (slot: string) => slots[slot]?.level ?? 1;
  const scopeCtx = (slot: string) => brain.resolve(run.brain_version, slot, task.type);
  const facts = (slot: string): Facts => ({ "item.weight_kg": card.item.weight_kg, "slot.level": levelOf(slot), "task.type": card.type });
  const r = () => engine.scenario.robots[robot];

  let actions = 0;
  let stopped = false;
  const doAct = (action: string, args: Record<string, unknown>): ActionResult | null => {
    if (stopped || actions >= MAX_ACTIONS) return null;
    actions++;
    return act(engine, robot, action, args);
  };
  const fire = (slot: string, trigger: string): boolean => {
    const p = scopeCtx(slot).protocols.find((n) => n.props.trigger === trigger);
    if (!p) return false;
    for (const step of p.props.response ?? []) {
      const args = { ...(step.args ?? {}) } as Record<string, unknown>;
      if (step.action === "report_issue" && !args.detail) args.detail = `${trigger} at ${slot} for ${card.item.id}`;
      doAct(step.action, resolveArgs(args, slot));
    }
    if ((p.props.then ?? "stop") === "stop") stopped = true;
    return true;
  };
  const resolveArgs = (args: Record<string, unknown>, slot: string) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === "string" && v.startsWith("$task.")) out[k] = (card as any)[v.slice(6)];
      else if (typeof v === "string" && v.startsWith("$rule.")) out[k] = ruleValue(scopeCtx(slot).rules, v.slice(6), facts(slot));
      else out[k] = v;
    }
    return out;
  };
  // the slot the robot is working at: the source until it holds the item, then the target
  const currentSlot = () => (r().holding === card.item.id || engine.scenario.items[card.item.id].slot === `holding:${robot}` ? card.target : card.source);

  const torsoFor = (slot: string) => {
    if (slot === "tote" || r().arm_out) return;
    const want = ruleValue(scopeCtx(slot).rules, "torso.level", facts(slot));
    if (want !== undefined && Number(want) !== r().torso_level) doAct("set_torso", { level: Number(want) });
  };

  for (const step of ctx.main.procedure?.steps ?? []) {
    if (stopped) break;
    const slot = currentSlot();
    const args = resolveArgs(step.args, slot);
    if (step.action === "navigate_to" && r().arm_out) doAct("retract", {});
    if (step.action === "reach") torsoFor(String(args.slot));
    if (step.action === "grasp" && args.mode === undefined) args.mode = "one_hand";

    let res = doAct(step.action, args);
    if (!res) break;

    if (step.action === "scan_slot" && res.ok) {
      const inSlot = res.state.item && res.state.item.slot === args.slot ? res.state.item.id : null;
      if (!/^slot contains/.test(res.reason)) {
        if (fire(String(args.slot), "slot_empty")) break;
      } else if (inSlot !== card.item.id && !res.reason.endsWith(card.item.id)) {
        if (fire(String(args.slot), "slot_mismatch")) break;
      }
      continue;
    }
    if (res.ok) continue;

    // refused: a protocol first, then the generic recovery
    const reason = res.reason;
    if (/out of reach|torso is above slot/.test(reason)) {
      if (fire(String(args.slot), "out_of_reach")) break;
      doAct("set_torso", { level: levelOf(String(args.slot)) });
      res = doAct(step.action, args);
    } else if (/payload limit exceeded/.test(reason)) {
      if (fire(slot, "grasp_refused")) break;
      res = doAct("grasp", { mode: "two_hand" });
    } else if (/slot is empty/.test(reason)) {
      if (!fire(slot, "slot_empty")) stopped = true;
      break;
    } else if (/retract arm/.test(reason)) {
      doAct("retract", {});
      res = doAct(step.action, args);
    } else if (/reach target slot before placing/.test(reason) && step.action === "place") {
      torsoFor(String(args.target));
      if (!doAct("reach", { slot: args.target })?.ok) {
        doAct("set_torso", { level: levelOf(String(args.target)) });
        doAct("reach", { slot: args.target });
      }
      res = doAct("place", args);
    }
    if (!res?.ok) break;
    if (engine.scenario.items[card.item.id].slot === card.target) break;
  }
}
