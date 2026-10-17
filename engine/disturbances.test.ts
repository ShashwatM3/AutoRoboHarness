import assert from 'node:assert/strict';
import test from 'node:test';
import { createScenario, StoreEngine } from './store.ts';
import { applyDisturbance } from './disturbances.ts';

test('a blocked segment uses the alternate aisle and never changes the source scene', () => {
  const original = createScenario(1, 1), before = structuredClone(original);
  const changed = applyDisturbance(original, 'blocked_aisle', { from: 'A-entrance', to: 'A-1' });
  const e = new StoreEngine(changed);
  const step = e.navigate_to('robot-1', 'A-1').step;
  assert.equal(step.ok, true);
  assert.ok(step.path!.some(p => p.x > 0));
  assert.ok(!changed.layout.waypoints['A-entrance'].neighbors.includes('A-1'));
  assert.deepEqual(original, before);
  assert.throws(() => applyDisturbance(original, 'blocked_aisle', { from: 'A-1', to: 'B-1' }));
});

test('stock disturbances preserve identities and enforce bounded physical weights', () => {
  const s = createScenario(1, 1);
  const item = Object.values(s.items).find(i => i.slot === i.home_slot && s.layout.slots[i.slot]?.aisle === 'A')!;
  const target = Object.values(s.layout.slots).find(x => x.aisle === 'B' && x.level === 4)!;
  const moved = applyDisturbance(s, 'heavy_top_shelf', { item_id: item.id, target_slot: target.id, weight_kg: 3.8 });
  assert.equal(moved.items[item.id].slot, target.id);
  assert.equal(moved.items[item.id].weight_kg, 3.8);
  assert.equal(new Set(Object.values(moved.items).map(i => i.slot)).size, Object.keys(moved.items).length);
  assert.throws(() => applyDisturbance(s, 'heavy_top_shelf', { item_id: item.id, target_slot: target.id, weight_kg: 4.1 }));
  assert.equal(s.items[item.id].slot, item.slot);
});

test('front stock physically occludes older stock until it is removed', () => {
  const s = createScenario(1, 1);
  const items = Object.values(s.items).filter(i => i.slot === i.home_slot && s.layout.slots[i.slot]?.aisle === 'A');
  const [old, fresh] = items;
  const changed = applyDisturbance(s, 'behind_fresh', { item_id: old.id, fresh_item_id: fresh.id });
  const e = new StoreEngine(changed), slot = changed.layout.slots[old.slot];
  e.navigate_to('robot-1', slot.waypoint); e.set_torso('robot-1', slot.level);
  assert.match(e.scan_slot('robot-1', old.slot).reason, new RegExp(fresh.id));
  e.reach('robot-1', old.slot); assert.equal(e.grasp('robot-1', 'two_hand').step.item_id, fresh.id);
  assert.match(e.scan_slot('robot-1', old.slot).reason, new RegExp(old.id));
  assert.equal(new Set(Object.values(changed.items).map(i => i.slot)).size, Object.keys(changed.items).length);
  assert.throws(() => applyDisturbance(e.snapshot(), 'wrong_slot', { item_id: old.id, target_slot: fresh.slot }));
});
