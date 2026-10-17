import { TWO_HAND_LIMIT_KG, type Scenario } from './store.ts';

export const DISTURBANCE_KINDS = ['blocked_aisle', 'wrong_slot', 'heavy_top_shelf', 'behind_fresh'] as const;
export type DisturbanceKind = typeof DISTURBANCE_KINDS[number];
export interface Disturbance { kind: DisturbanceKind; params: Record<string, unknown> }

/** Apply one bounded change to a copy. The original world, tasks and saved evidence stay untouched. */
export function applyDisturbance(original: Scenario, kind: DisturbanceKind, params: Record<string, unknown>): Scenario {
  if (!DISTURBANCE_KINDS.includes(kind)) throw new RangeError('unknown disturbance');
  if (original.t !== 0 || original.trajectory.length) throw new RangeError('disturbances apply before execution only');
  const s = structuredClone(original);
  const text = (name: string) => {
    if (typeof params[name] !== 'string' || !params[name]) throw new RangeError(`${name} is required`);
    return params[name] as string;
  };
  const shelf = (id: string) => {
    const slot = s.layout.slots[id];
    if (!slot || !['A', 'B'].includes(slot.aisle) || id.startsWith('behind:')) throw new RangeError('a real shelf slot is required');
    return slot;
  };
  if (kind === 'blocked_aisle') {
    const a = text('from'), b = text('to');
    const first = s.layout.waypoints[a], second = s.layout.waypoints[b];
    if (!first?.neighbors.includes(b) || !second?.neighbors.includes(a) || !/^[AB]-/.test(a) || a[0] !== b[0]) throw new RangeError('choose an existing aisle segment');
    first.neighbors = first.neighbors.filter(id => id !== b);
    second.neighbors = second.neighbors.filter(id => id !== a);
    const seen = new Set([a]), queue = [a];
    for (let i = 0; i < queue.length; i++) for (const id of s.layout.waypoints[queue[i]].neighbors) if (!seen.has(id)) { seen.add(id); queue.push(id); }
    if (!seen.has(b)) throw new RangeError('the blocked segment must have another route');
  } else {
    const id = text('item_id'), item = s.items[id];
    if (!item || !shelf(item.slot)) throw new RangeError('choose an existing shelf item');
    if (kind === 'wrong_slot' || kind === 'heavy_top_shelf') {
      const target = text('target_slot'), slot = shelf(target);
      if (kind === 'wrong_slot' && target === item.slot) throw new RangeError('the destination must differ');
      if (kind === 'heavy_top_shelf') {
        const weight = Number(params.weight_kg ?? 3.8);
        if (slot.level !== 4 || !Number.isFinite(weight) || weight <= 2 || weight > TWO_HAND_LIMIT_KG) throw new RangeError('heavy top-shelf stock must weigh above 2 and at most 4 kg, at level 4');
        item.weight_kg = weight;
      }
      const occupant = Object.values(s.items).find(other => other.id !== id && other.slot === target);
      if (occupant) occupant.slot = item.slot;
      item.slot = target;
    } else {
      const fresh = s.items[text('fresh_item_id')];
      if (!fresh || fresh.id === id) throw new RangeError('a separate fresh item is required');
      shelf(fresh.slot);
      const slot = item.slot, source = fresh.slot;
      if (slot === source || s.layout.slots[`behind:${slot}`]) throw new RangeError('stock is already layered');
      s.layout.slots[`behind:${slot}`] = { ...s.layout.slots[slot], id: `behind:${slot}`, expected_item: id };
      item.slot = `behind:${slot}`; item.expiry_day = -1;
      fresh.slot = slot; fresh.expiry_day = 7;
      // The fresh item's vacated slot remains genuinely empty. Removing it exposes the older stock.
    }
  }
  s.disturbances = [...(s.disturbances ?? []), { kind, params: structuredClone(params) }];
  return s;
}
