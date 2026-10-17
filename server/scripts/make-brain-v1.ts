// Writes brain/v1.json, the day-one brain: a new employee's first-day instructions.
// Correct as far as it goes, and deliberately missing three things the shift will expose:
//   - no rule for grasp mode by item weight (the default one-hand grasp drops heavy items)
//   - no rule for torso height by shelf level (reaches to high shelves are refused)
//   - no "scan the slot first" step (a misplaced item is taken without checking; the
//     slot-mismatch protocol exists but nothing ever triggers it)
// Run: npx tsx scripts/make-brain-v1.ts  (refuses to overwrite an existing v1)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrainEdge, BrainFile, BrainNode } from "../src/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(ROOT, "brain", "v1.json");

const nodes: BrainNode[] = [];
const edges: BrainEdge[] = [];
const node = (id: string, type: BrainNode["type"], label: string, props: Record<string, unknown> = {}) => nodes.push({ id, type, label, props });
const edge = (from: string, type: BrainEdge["type"], to: string) => edges.push({ from, to, type });

// ---------- scope tree ----------
node("store", "Scope", "Convenience store, east wing", { kind: "store" });
node("zone:backroom", "Scope", "Backroom (stock arrives in totes)", { kind: "zone" });
node("zone:packing", "Scope", "Packing station (order totes)", { kind: "zone" });
edge("zone:backroom", "PART_OF", "store");
edge("zone:packing", "PART_OF", "store");
for (const aisle of ["A", "B"]) {
  node(`aisle:${aisle}`, "Scope", `Aisle ${aisle}`, { kind: "aisle" });
  edge(`aisle:${aisle}`, "PART_OF", "store");
  for (let bay = 1; bay <= 4; bay++) {
    node(`bay:${aisle}-${bay}`, "Scope", `Aisle ${aisle}, bay ${bay} (shelf levels 1 to 4)`, { kind: "bay" });
    edge(`bay:${aisle}-${bay}`, "PART_OF", `aisle:${aisle}`);
  }
}

// ---------- procedures ----------
// Step args are templates: $task.* comes from the task card, $rule.<param> from the matching rule.
type StepDef = [slug: string, action: string, args: Record<string, unknown>, label: string];
function procedure(id: string, task: string, label: string, steps: StepDef[]) {
  node(id, "Procedure", label, { task });
  edge(id, "APPLIES_TO", "store");
  edge(id, "SUPPORTED_BY", "ev:onboarding");
  let prev: string | null = null;
  for (const [slug, action, args, stepLabel] of steps) {
    const sid = `step:${task.toLowerCase()}:${slug}`;
    node(sid, "Step", stepLabel, { action, args });
    edge(sid, "STEP_OF", id);
    if (prev) edge(prev, "NEXT", sid);
    prev = sid;
  }
}

procedure("proc:pick", "PICK", "Pick an order item from its shelf slot into the packing tote", [
  ["go-to-item", "navigate_to", { waypoint: "$task.source_waypoint" }, "Drive to the bay that holds the item"],
  ["reach", "reach", { slot: "$task.source" }, "Reach into the item's slot"],
  ["grasp", "grasp", { mode: "$rule.grasp.mode" }, "Close the gripper on the item"],
  ["retract", "retract", {}, "Pull the arm back in before driving"],
  ["go-to-tote", "navigate_to", { waypoint: "$task.target_waypoint" }, "Drive to the packing tote"],
  ["place", "place", { target: "$task.target" }, "Put the item in the tote"],
]);

procedure("proc:restock", "RESTOCK", "Restock an item from the backroom tote into its shelf slot", [
  ["go-to-backroom", "navigate_to", { waypoint: "$task.source_waypoint" }, "Drive to the backroom tote"],
  ["reach", "reach", { slot: "$task.source" }, "Reach into the tote"],
  ["grasp", "grasp", { mode: "$rule.grasp.mode" }, "Close the gripper on the item"],
  ["retract", "retract", {}, "Pull the arm back in before driving"],
  ["go-to-slot", "navigate_to", { waypoint: "$task.target_waypoint" }, "Drive to the item's bay"],
  ["place", "place", { target: "$task.target" }, "Put the item in its slot"],
]);

// ---------- rules ----------
node("rule:grasp-default", "Rule", "Use a one-hand grasp; it is the fastest way to pick", {
  when: [],
  then: { param: "grasp.mode", value: "one_hand" },
  priority: 0,
});
edge("rule:grasp-default", "APPLIES_TO", "store");
edge("rule:grasp-default", "SUPPORTED_BY", "ev:onboarding");

node("rule:backroom-torso", "Rule", "Backroom totes sit on the low rack; keep the torso at level 1 there", {
  when: [],
  then: { param: "torso.level", value: 1 },
  priority: 0,
});
edge("rule:backroom-torso", "APPLIES_TO", "zone:backroom");
edge("rule:backroom-torso", "SUPPORTED_BY", "ev:onboarding");

node("rule:packing-torso", "Rule", "The packing tote is at level 1; lower the torso to place into it", {
  when: [],
  then: { param: "torso.level", value: 1 },
  priority: 0,
});
edge("rule:packing-torso", "APPLIES_TO", "zone:packing");
edge("rule:packing-torso", "SUPPORTED_BY", "ev:onboarding");

node("rule:retract-before-drive", "Rule", "Never drive with the arm extended", {
  when: [],
  then: { param: "arm.retract_before_drive", value: true },
  priority: 0,
});
edge("rule:retract-before-drive", "APPLIES_TO", "store");
edge("rule:retract-before-drive", "SUPPORTED_BY", "ev:safety");

// ---------- guardrail ----------
node("guard:max-speed", "Guardrail", "Drive no faster than 1.0 m/s on the shop floor", {
  param: "max_speed_mps",
  op: "<=",
  value: 1.0,
  locked: true,
});
edge("guard:max-speed", "APPLIES_TO", "store");
edge("guard:max-speed", "SUPPORTED_BY", "ev:safety");

// ---------- protocols ----------
node("proto:slot-mismatch", "Protocol", "If a slot holds the wrong item, report it and do not take it", {
  trigger: "slot_mismatch",
  response: [{ action: "report_issue", args: { kind: "slot_mismatch" } }],
  then: "stop",
});
edge("proto:slot-mismatch", "APPLIES_TO", "store");
edge("proto:slot-mismatch", "SUPPORTED_BY", "ev:onboarding");

node("proto:item-dropped", "Protocol", "If an item is dropped, report it so staff can clear the floor", {
  trigger: "item_dropped",
  response: [{ action: "report_issue", args: { kind: "item_dropped" } }],
  then: "stop",
});
edge("proto:item-dropped", "APPLIES_TO", "store");
edge("proto:item-dropped", "SUPPORTED_BY", "ev:safety");

// ---------- evidence ----------
node("ev:onboarding", "Evidence", "Store onboarding sheet, day one", { kind: "doc" });
node("ev:safety", "Evidence", "Fleet safety policy", { kind: "doc" });

// ---------- write ----------
const file: BrainFile = {
  version: 1,
  parent: null,
  created_at: new Date().toISOString(),
  created_by: "seed",
  note: "Day-one brain: no grasp-by-weight rule, no torso-by-shelf rule, no check-the-slot step",
  ops: [],
  nodes,
  edges,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(file, null, 2) + "\n", { flag: "wx" });
const count = (t: string) => nodes.filter((n) => n.type === t).length;
console.log(
  `wrote ${path.relative(ROOT, out)}: ${nodes.length} nodes, ${edges.length} edges`,
  Object.fromEntries(["Scope", "Procedure", "Step", "Rule", "Guardrail", "Protocol", "Evidence"].map((t) => [t, count(t)])),
);
