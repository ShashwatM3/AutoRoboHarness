import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIONS, shopperPosition, createEngine, createScenario, StoreEngine, type TrajectoryStep } from './store.ts';

test('seeds reproduce the complete world and preserve unique inventory locations', () => {
  assert.deepEqual(createScenario(1), createScenario(1));
  assert.notDeepEqual(createScenario(1).items, createScenario(2).items);
  for (const seed of [1, 2, 7, 13, 20]) {
    const s = createScenario(seed);
    assert.equal(Object.keys(s.items).length, 256);
    assert.equal(new Set(Object.values(s.items).map(i => i.slot)).size, 256);
    for (const item of Object.values(s.items)) {
      assert.ok(item.weight_kg >= 0.2 && item.weight_kg <= 4);
      assert.ok(s.layout.slots[item.slot]);
    }
    for (const aisle of ['A', 'B']) for (let bay = 1; bay <= 8; bay++) for (let level = 1; level <= 4; level++) {
      assert.ok(s.layout.slots[`${aisle}-${bay}-${level}-1`]);
    }
  }
});

function pick(engine: StoreEngine, slotId: string) {
  const task = engine.createTask('robot-1', 'PICK', slotId);
  const slot = engine.scenario.layout.slots[slotId];
  engine.navigate_to('robot-1', slot.waypoint);
  engine.set_torso('robot-1', slot.level);
  engine.scan_slot('robot-1', slotId);
  engine.reach('robot-1', slotId);
  engine.grasp('robot-1', 'two_hand');
  engine.retract('robot-1');
  engine.navigate_to('robot-1', 'tote');
  engine.place('robot-1', 'tote');
  return task;
}

test('a complete PICK emits immutable facts and meets the gate definition', () => {
  const emitted: TrajectoryStep[] = [];
  const engine = createEngine(1, { onStep: s => { emitted.push(structuredClone(s)); s.position.x = 999; } });
  engine.setBrainNodesRead('robot-1', ['pick', 'speed', 'pick']);
  const task = pick(engine, 'A-3-4-1');
  assert.equal(engine.scenario.items[task.item_id].slot, 'tote');
  assert.equal(engine.score()[0].complete, true);
  assert.equal(emitted.length, 8);
  assert.equal(engine.scenario.trajectory[0].position.x, -3.2);
  assert.equal(engine.scenario.trajectory[0].holding, null);
  assert.equal(engine.scenario.trajectory[4].holding, task.item_id);
  assert.deepEqual(emitted[0].brain_nodes_read, ['pick', 'speed']);
  assert.equal(engine.trajectoryJSONL().trim().split('\n').length, 8);
  assert.ok(emitted.every((s, i) => s.step === i + 1 && s.t > (emitted[i - 1]?.t ?? 0)));
});

test('RESTOCK moves a separate stock item into an empty shelf', () => {
  const engine = createEngine(2);
  const target = Object.values(engine.scenario.layout.slots).find(slot => slot.aisle !== 'backroom' && !Object.values(engine.scenario.items).some(i => i.slot === slot.id))!;
  assert.ok(target);
  const task = engine.createTask('robot-1', 'RESTOCK', target.id);
  assert.equal(engine.reach('robot-1', task.source).ok, true);
  assert.equal(engine.grasp('robot-1', 'two_hand').ok, true);
  engine.retract('robot-1');
  engine.navigate_to('robot-1', target.waypoint);
  engine.set_torso('robot-1', target.level);
  engine.reach('robot-1', target.id);
  assert.equal(engine.place('robot-1', target.id).ok, true);
  assert.equal(engine.score()[0].complete, true);
  assert.equal(engine.scenario.items[task.item_id].slot, target.id);
});

test('out-of-reach and overweight refusals come from state and do not move items', () => {
  const engine = createEngine(1);
  engine.createTask('robot-1', 'PICK', 'A-3-4-1');
  engine.navigate_to('robot-1', 'A-3');
  assert.equal(engine.reach('robot-1', 'A-3-4-1').reason, 'out of reach');
  engine.set_torso('robot-1', 4);
  engine.reach('robot-1', 'A-3-4-1');
  const item = engine.scenario.items['item:A-3-4-1'];
  item.weight_kg = 3.5;
  assert.equal(engine.grasp('robot-1', 'one_hand').ok, false);
  assert.equal(item.slot, 'A-3-4-1');
  assert.equal(engine.scenario.robots['robot-1'].holding, null);
  assert.equal(engine.grasp('robot-1', 'two_hand').ok, true);
  engine.retract('robot-1'); engine.navigate_to('robot-1', 'tote'); engine.place('robot-1', 'tote');
  assert.equal(engine.score()[0].complete, false);
  assert.equal(engine.score()[0].refused_actions, 2);
});

test('physical preconditions protect arm, gripper, slots and inventory', () => {
  const engine = createEngine(1);
  assert.equal(engine.place('robot-1', 'tote').reason, 'robot holds nothing');
  assert.equal(engine.grasp('robot-1', 'one_hand').reason, 'arm is not extended');
  assert.equal(engine.reach('robot-1', 'A-1-1-1').ok, false);
  assert.equal(engine.scan_slot('robot-1', 'A-1-1-1').ok, false);
  assert.equal(engine.navigate_to('robot-1', 'missing').ok, false);
  assert.equal(engine.set_torso('robot-1', 5).ok, false);
  engine.reach('robot-1', 'backroom:A-1-1-1');
  assert.equal(engine.navigate_to('robot-1', 'A-1').reason, 'retract arm before driving');
  assert.equal(engine.set_torso('robot-1', 2).ok, false);
  engine.grasp('robot-1', 'two_hand');
  assert.equal(engine.grasp('robot-1', 'two_hand').ok, false);
  engine.retract('robot-1'); engine.navigate_to('robot-1', 'A-1'); engine.reach('robot-1', 'A-1-1-1');
  assert.equal(engine.place('robot-1', 'A-1-1-1').reason, 'target slot is occupied');
  assert.equal(engine.report_issue('robot-1', 'occupied', 'Target contains another item').ok, true);
  assert.equal(engine.scenario.issues.length, 1);
  assert.equal(Object.keys(engine.scenario.items).length, 256);
  assert.deepEqual(new Set(engine.scenario.trajectory.map(s => s.action)), new Set(ACTIONS));
});

test('driving follows connected waypoints and time scales with distance and speed', () => {
  const a = createEngine(1);
  const b = createEngine(1, { maxSpeed: 0.4 });
  const fast = a.navigate_to('robot-1', 'B-4');
  const slow = b.navigate_to('robot-1', 'B-4');
  assert.equal(slow.step.duration, fast.step.duration * 2);
  assert.ok(fast.step.path!.length >= 4);
  assert.deepEqual(fast.step.path!.at(-1), fast.step.position);
});

test('two robots share inventory and cannot both grasp the same item', () => {
  const engine = createEngine(1);
  for (const id of ['robot-1', 'robot-2']) {
    engine.navigate_to(id, 'A-3'); engine.set_torso(id, 4); engine.reach(id, 'A-3-4-1');
  }
  assert.equal(engine.grasp('robot-1', 'two_hand').ok, true);
  assert.equal(engine.grasp('robot-2', 'two_hand').reason, 'slot is empty');
  const snapshot = engine.snapshot();
  snapshot.robots['robot-1'].x = 100;
  assert.equal(engine.scenario.robots['robot-1'].x, -3.2);
});


test('shoppers follow a separate seeded clock and each immutable step records real proximity', () => {
  const a = createEngine(7), b = createEngine(7);
  assert.deepEqual(a.scenario.shoppers, b.scenario.shoppers);
  assert.notDeepEqual(a.scenario.shoppers, createScenario(8).shoppers);
  assert.equal(createScenario(1).items['item:A-1-4-1'].weight_kg, 1.73);
  const initial = structuredClone(a.scenario.shoppers);
  const first = a.navigate_to('robot-1', 'A-3').step;
  const again = b.navigate_to('robot-1', 'A-3').step;
  assert.deepEqual(first, again);
  assert.equal(first.shoppers?.length, 4);
  assert.deepEqual(first.shoppers, Object.values(initial).map(shopper => shopperPosition(shopper, first.t)));
  assert.ok(first.shoppers!.some(s => s.x !== initial[s.id].x || s.y !== initial[s.id].y));
  const measured = Math.min(...first.shoppers!.map(s => Math.hypot(s.x-first.position.x, s.y-first.position.y)));
  assert.equal(first.nearest_shopper_distance_m, measured);
  const saved = structuredClone(first);
  a.navigate_to('robot-1', 'tote');
  assert.deepEqual(first, saved);
  assert.notDeepEqual(a.scenario.shoppers, initial);
});

test('four robots retain independent task ownership, step numbers and shopper facts', () => {
  const engine = createEngine(3, { robotCount: 4 });
  for (let i = 1; i <= 4; i++) {
    const id = `robot-${i}`;
    engine.createTask(id, 'PICK', `A-${i}-1-1`);
    const step = engine.navigate_to(id, `A-${i}`).step;
    assert.equal(step.robot, id);
    assert.equal(step.step, 1);
    assert.equal(step.task_id, engine.scenario.robots[id].task_id);
    assert.ok(Number.isFinite(step.nearest_shopper_distance_m));
  }
  assert.equal(engine.score().length, 4);
  assert.equal(new Set(engine.scenario.trajectory.map(s => s.robot)).size, 4);
});
