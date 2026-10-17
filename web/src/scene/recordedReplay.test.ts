import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createScenario,
  StoreEngine,
  type Scenario,
} from "../../../engine/store.ts";
import {
  recordedStateAt,
  replayBoundaries,
  replayCursor,
  sampleRecordedPath,
} from "./recordedReplay.ts";
import { compareGraphs } from "../brainComparison.ts";

test("recorded facts restore every action boundary, refusals, shoppers, misplaced stock and backward seeks", () => {
  const snapshots: Scenario[] = [];
  const engine = new StoreEngine(createScenario(1, 4), {
    onStep: () => snapshots.push(engine.snapshot()),
  });
  const slots = ["A-1-3-1", "A-2-1-1", "B-1-1-1", "B-2-1-2"];
  slots.forEach((s, i) => engine.createTask(`robot-${i + 1}`, "PICK", s));
  const initial = engine.snapshot(),
    untouched = JSON.stringify(initial);
  for (const [i, id] of slots.entries()) {
    const r = `robot-${i + 1}`,
      slot = initial.layout.slots[id];
    engine.navigate_to(r, slot.waypoint);
    engine.reach(r, id); // preserves real refusal whenever this shelf is above the starting torso
    if (!engine.scenario.robots[r].arm_out) {
      engine.set_torso(r, slot.level);
      engine.reach(r, id);
    }
    engine.grasp(r, "one_hand");
    if (!engine.scenario.robots[r].holding) engine.grasp(r, "two_hand");
    engine.retract(r);
    engine.navigate_to(r, "tote");
    engine.place(r, "tote");
    engine.report_issue(r, "audit", "Recorded replay test");
  }
  const final = engine.snapshot();
  assert.ok(final.trajectory.some((s) => !s.ok));
  for (const expected of [...snapshots, ...snapshots.toReversed()]) {
    assert.deepEqual(
      recordedStateAt(initial, final.trajectory, expected.t),
      expected,
    );
  }
  assert.deepEqual(recordedStateAt(initial, final.trajectory, 0), initial);
  assert.equal(JSON.stringify(initial), untouched);
  assert.deepEqual(recordedStateAt(initial, final.trajectory, Infinity), final);
});

test("shared replay clock steps over both recordings and interpolates recorded paths by distance", () => {
  const engine = new StoreEngine(createScenario(2, 1));
  engine.navigate_to("robot-1", "A-1");
  engine.set_torso("robot-1", 4);
  const steps = engine.snapshot().trajectory;
  const time = steps[0].t / 2,
    cursor = replayCursor(steps, time);
  assert.equal(cursor.index, -1);
  assert.ok(Math.abs(cursor.progress - 0.5) < 0.001);
  assert.deepEqual(
    replayBoundaries([{ trajectory: steps }, { trajectory: steps }]),
    [0, ...steps.map((s) => s.t)],
  );
  assert.deepEqual(
    sampleRecordedPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 2 },
        { x: 4, y: 2 },
      ],
      0.5,
    ),
    { x: 1, y: 2, heading: Math.PI / 2 },
  );
});

test("graph comparison includes removals, nested properties, labels, types and edge properties", () => {
  const a = {
    version: 4,
    nodes: [
      {
        id: "same",
        label: "Old",
        type: "Rule",
        props: { nested: { limit: 2 }, removed: true },
      },
      { id: "gone", label: "Gone", type: "Step", props: {} },
    ],
    edges: [{ from: "same", to: "same", type: "NEXT", props: { order: 1 } }],
  };
  const b = {
    version: 5,
    nodes: [
      {
        id: "same",
        label: "New",
        type: "Guardrail",
        props: { nested: { limit: 4 }, retired_in: 5 },
      },
      { id: "new", label: "New", type: "Step", props: {} },
    ],
    edges: [
      { from: "same", to: "same", type: "NEXT", props: { order: 2 } },
      { from: "new", to: "same", type: "NEXT" },
    ],
  };
  const diff = compareGraphs(a, b);
  assert.deepEqual(
    diff.nodes.added.map((n) => n.id),
    ["new"],
  );
  assert.deepEqual(
    diff.nodes.removed.map((n) => n.id),
    ["gone"],
  );
  assert.deepEqual(
    diff.nodes.changed[0].changes.map((c) => c.path),
    [
      "label",
      "props.nested.limit",
      "props.removed",
      "props.retired_in",
      "type",
    ],
  );
  assert.equal(diff.edges.changed[0].changes[0].path, "props.order");
  assert.equal(diff.edges.added.length, 1);
});

test("a misplaced product replays its own physical location, independently of the intended task item", () => {
  const engine = new StoreEngine(createScenario(1, 1));
  const displaced = Object.values(engine.scenario.items).find(
    (i) =>
      i.id.startsWith("item:") &&
      i.slot !== i.home_slot &&
      engine.scenario.layout.slots[i.slot]?.aisle !== "backroom",
  );
  assert.ok(displaced);
  const task = engine.createTask("robot-1", "PICK", displaced.slot);
  assert.notEqual(task.item_id, displaced.id);
  const initial = engine.snapshot(),
    slot = initial.layout.slots[displaced.slot];
  engine.navigate_to("robot-1", slot.waypoint);
  engine.set_torso("robot-1", slot.level);
  engine.reach("robot-1", slot.id);
  engine.grasp("robot-1", "two_hand");
  engine.retract("robot-1");
  engine.navigate_to("robot-1", "tote");
  engine.place("robot-1", "tote");
  const final = engine.snapshot();
  assert.equal(final.items[displaced.id].slot, "tote");
  assert.notEqual(final.items[task.item_id].slot, "tote");
  assert.deepEqual(recordedStateAt(initial, final.trajectory, final.t), final);
});
