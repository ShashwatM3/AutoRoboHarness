/** The authoritative store state. This module has no graphics, filesystem or model dependencies. */
export const ACTIONS = ['navigate_to', 'set_torso', 'scan_slot', 'reach', 'grasp', 'place', 'retract', 'report_issue'] as const;
export type Action = typeof ACTIONS[number];
export type TaskType = 'PICK' | 'RESTOCK';
export type GraspMode = 'one_hand' | 'two_hand';
export type Point = { x: number; y: number };
export const SHELF_HEIGHTS = [0, 0.48, 0.94, 1.4, 1.86] as const;
export const ONE_HAND_LIMIT_KG = 2;
export const TWO_HAND_LIMIT_KG = 4;
export const DEFAULT_SPEED = 0.8;

export interface Waypoint extends Point { id: string; neighbors: string[] }
export interface Slot extends Point {
  id: string;
  aisle: 'A' | 'B' | 'backroom';
  bay: number;
  level: number;
  position: number;
  height: number;
  waypoint: string;
  expected_item: string;
}
export interface Item {
  id: string;
  name: string;
  weight_kg: number;
  slot: string;
  home_slot: string;
  asset: string;
  /** V3 stock ordering; older scenes do not have expiry metadata. */
  expiry_day?: number;
}
export interface Robot extends Point {
  id: string;
  waypoint: string;
  torso_level: number;
  arm_out: boolean;
  reaching: string | null;
  holding: string | null;
  grasp_mode: GraspMode | null;
  task_id: string | null;
}
export interface Shopper extends Point { id: string; path: Point[]; speed_mps: number; phase_s: number }
export interface ShopperPosition extends Point { id: string }

export interface Task {
  id: string;
  robot: string;
  type: TaskType;
  item_id: string;
  source: string;
  target: string;
}
export interface TrajectoryStep {
  t: number;
  robot: string;
  task_id: string | null;
  step: number;
  brain_nodes_read: string[];
  action: Action;
  args: Record<string, unknown>;
  ok: boolean;
  reason: string;
  position: Point;
  torso_level: number;
  holding: string | null;
  item_location: string | null;
  target_location: string | null;
  // Extra facts allow the renderer to animate without guessing an action's result.
  robot_state: Robot;
  item_id: string | null;
  /** Actual affected item, distinct from the intended task item when stock is misplaced. */
  item_state?: Item | null;
  path?: Point[];
  duration: number;
  shoppers?: ShopperPosition[];
  nearest_shopper_distance_m?: number | null;
}
export interface Scenario {
  seed: number;
  t: number;
  layout: { waypoints: Record<string, Waypoint>; slots: Record<string, Slot> };
  items: Record<string, Item>;
  robots: Record<string, Robot>;
  shoppers: Record<string, Shopper>;
  tasks: Record<string, Task>;
  trajectory: TrajectoryStep[];
  issues: { robot: string; t: number; kind: string; detail: string }[];
  disturbances?: { kind: string; params: Record<string, unknown> }[];
}
export interface ActionState {
  t: number;
  robot: Robot;
  task: Task | null;
  item: Item | null;
  slot?: Slot;
}
export interface ActionResult { ok: boolean; reason: string; state: ActionState; step: TrajectoryStep }
export interface EngineOptions { onStep?: (step: TrajectoryStep) => void; maxSpeed?: number }
export interface TaskScore { task_id: string; complete: boolean; refused_actions: number; steps: number; item_location: string; target_location: string }

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS = [
  { name: 'Milk', asset: 'milk' }, { name: 'Apple', asset: 'apple' },
  { name: 'Cereal', asset: 'cereal' }, { name: 'Orange', asset: 'orange' },
  { name: 'Juice', asset: 'juice' }, { name: 'Bread', asset: 'bread' },
  { name: 'Tomato', asset: 'tomato' }, { name: 'Coffee', asset: 'coffee' },
];

/** Bay 1–4 is the left side of an aisle; 5–8 is its right side. Two slots per level. */
export function createScenario(seed: number, robotCount = 2): Scenario {
  if (!Number.isSafeInteger(seed)) throw new RangeError('seed must be a safe integer');
  if (!Number.isInteger(robotCount) || robotCount < 1 || robotCount > 4) throw new RangeError('robotCount must be 1 to 4');
  const random = seededRandom(seed);
  const waypoints: Record<string, Waypoint> = {};
  const slots: Record<string, Slot> = {};
  const items: Record<string, Item> = {};
  const addWaypoint = (id: string, x: number, y: number) => { waypoints[id] = { id, x, y, neighbors: [] }; };
  const connect = (a: string, b: string) => { waypoints[a].neighbors.push(b); waypoints[b].neighbors.push(a); };
  addWaypoint('backroom', 0, -3.2);
  addWaypoint('tote', 0, 9.4);
  for (const [aisle, x] of [['A', -3.2], ['B', 3.2]] as const) {
    addWaypoint(`${aisle}-entrance`, x, -1.4);
    addWaypoint(`${aisle}-exit`, x, 8);
    connect('backroom', `${aisle}-entrance`);
    connect('tote', `${aisle}-exit`);
    let prev = `${aisle}-entrance`;
    for (let row = 1; row <= 4; row++) {
      const id = `${aisle}-${row}`;
      addWaypoint(id, x, (row - 1) * 2 + 0.3);
      connect(prev, id);
      prev = id;
    }
    connect(prev, `${aisle}-exit`);
    for (let bay = 1; bay <= 8; bay++) {
      const row = (bay - 1) % 4 + 1;
      for (let level = 1; level <= 4; level++) {
        for (let position = 1; position <= 2; position++) {
          const id = `${aisle}-${bay}-${level}-${position}`;
          const itemId = `item:${id}`;
          slots[id] = {
            id, aisle, bay, level, position, height: SHELF_HEIGHTS[level],
            x: x + (bay <= 4 ? -1 : 1), y: (row - 1) * 2 + 0.3 + (position === 1 ? -0.25 : 0.25),
            waypoint: `${aisle}-${row}`, expected_item: itemId,
          };
          const product = PRODUCTS[Math.floor(random() * PRODUCTS.length)];
          items[itemId] = { id: itemId, ...product, weight_kg: Math.round((0.2 + random() * 3.8) * 100) / 100, slot: id, home_slot: id };
          // Backroom stock has the same product but a separate physical identity.
          const stockId = `stock:${id}`;
          const stockSlot = `backroom:${id}`;
          slots[stockSlot] = { ...slots[id], id: stockSlot, aisle: 'backroom', level: 1, height: SHELF_HEIGHTS[1], x: (position === 1 ? -0.45 : 0.45), y: -3.65, waypoint: 'backroom', expected_item: stockId };
          items[stockId] = { ...items[itemId], id: stockId, slot: stockSlot };
        }
      }
    }
  }
  connect('A-entrance', 'B-entrance');
  connect('A-exit', 'B-exit');
  // Misplaced inventory is part of the seeded world, independent of any robot action.
  const shelfItems = Object.values(items).filter(item => item.id.startsWith('item:'));
  for (let i = 0; i + 1 < shelfItems.length; i += 2) {
    if (random() < 0.08) [shelfItems[i].slot, shelfItems[i + 1].slot] = [shelfItems[i + 1].slot, shelfItems[i].slot];
  }
  // Some products are still in reserve, leaving genuinely empty shelf slots to restock.
  for (const item of shelfItems) {
    if (random() < 0.12) {
      const id = `reserve:${item.home_slot}`;
      slots[id] = { ...slots[`backroom:${item.home_slot}`], id, expected_item: item.id };
      item.slot = id;
    }
  }
  const robots: Record<string, Robot> = {};
  for (let i = 1; i <= robotCount; i++) {
    const id = `robot-${i}`;
    robots[id] = { id, x: (i - 1 - (robotCount - 1) / 2) * 0.85, y: -3.2, waypoint: 'backroom', torso_level: 1, arm_out: false, reaching: null, holding: null, grasp_mode: null, task_id: null };
  }
  // A separate random stream preserves all Version 1 inventory for the same seed.
  const shopperRandom = seededRandom(seed ^ 0x5a17c9);
  const shoppers: Record<string, Shopper> = {};
  for (let i = 0; i < 4; i++) {
    const x = i % 2 === 0 ? -3.2 : 3.2;
    const path = [{ x: x - 0.35, y: -1.2 }, { x: x - 0.35, y: 7.7 }, { x: x + 0.35, y: 7.7 }, { x: x + 0.35, y: -1.2 }];
    const id = `shopper-${i + 1}`;
    shoppers[id] = { id, x, y: 0, path, speed_mps: 0.35 + shopperRandom() * 0.2, phase_s: shopperRandom() * 36 };
    Object.assign(shoppers[id], shopperPosition(shoppers[id], 0));
  }
  return { seed, t: 0, shoppers, layout: { waypoints, slots }, items, robots, tasks: {}, trajectory: [], issues: [] };
}

/** A shopper's position depends only on the scenario clock, never on rendering or wall time. */
export function shopperPosition(shopper: Shopper, t: number): ShopperPosition {
  const path = shopper.path;
  const lengths = path.map((p, i) => Math.hypot(path[(i + 1) % path.length].x - p.x, path[(i + 1) % path.length].y - p.y));
  const perimeter = lengths.reduce((a, b) => a + b, 0);
  let remaining = (((t + shopper.phase_s) * shopper.speed_mps) % perimeter + perimeter) % perimeter;
  for (let i = 0; i < path.length; i++) {
    if (remaining <= lengths[i] || i === path.length - 1) {
      const a = path[i], b = path[(i + 1) % path.length], p = lengths[i] ? remaining / lengths[i] : 0;
      return { id: shopper.id, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
    }
    remaining -= lengths[i];
  }
  return { id: shopper.id, x: shopper.x, y: shopper.y };
}

/** An engine instance belongs to one shift. Every robot in the shift shares this state. */
export class StoreEngine {
  readonly scenario: Scenario;
  readonly maxSpeed: number;
  private onStep?: EngineOptions['onStep'];
  private brainReads = new Map<string, string[]>();

  constructor(scenario: Scenario, options: EngineOptions = {}) {
    this.scenario = scenario;
    this.maxSpeed = options.maxSpeed ?? DEFAULT_SPEED;
    if (!Number.isFinite(this.maxSpeed) || this.maxSpeed <= 0 || this.maxSpeed > DEFAULT_SPEED) throw new RangeError('maxSpeed must be positive and at most 0.8 m/s');
    this.onStep = options.onStep;
  }

  snapshot(): Scenario { return structuredClone(this.scenario); }
  setBrainNodesRead(robotId: string, ids: string[]): void {
    this.robot(robotId);
    this.brainReads.set(robotId, [...new Set(ids)]);
  }
  setTask(task: Task): void {
    const robot = this.robot(task.robot);
    if (!this.scenario.items[task.item_id]) throw new RangeError(`unknown item: ${task.item_id}`);
    if (!this.scenario.layout.slots[task.source]) throw new RangeError(`unknown source: ${task.source}`);
    if (task.target !== 'tote' && !this.scenario.layout.slots[task.target]) throw new RangeError(`unknown target: ${task.target}`);
    if (task.type !== 'PICK' && task.type !== 'RESTOCK') throw new RangeError('unknown task type');
    if (this.scenario.tasks[task.id]) throw new RangeError(`duplicate task: ${task.id}`);
    this.scenario.tasks[task.id] = structuredClone(task);
    robot.task_id = task.id;
  }
  /** A task names the intended item, even when a seed has misplaced that item. */
  createTask(robotId: string, type: TaskType, slotId: string, id = `task-${Object.keys(this.scenario.tasks).length + 1}`): Task {
    const slot = this.scenario.layout.slots[slotId];
    if (!slot || slot.aisle === 'backroom') throw new RangeError(`unknown shelf slot: ${slotId}`);
    const task: Task = { id, robot: robotId, type, item_id: `${type === 'PICK' ? 'item' : 'stock'}:${slotId}`, source: type === 'PICK' ? slotId : `backroom:${slotId}`, target: type === 'PICK' ? 'tote' : slotId };
    this.setTask(task);
    return structuredClone(task);
  }
  score(): TaskScore[] {
    return Object.values(this.scenario.tasks).map(task => {
      const steps = this.scenario.trajectory.filter(step => step.task_id === task.id);
      const item_location = this.scenario.items[task.item_id].slot;
      const refused_actions = steps.filter(step => !step.ok).length;
      return { task_id: task.id, complete: item_location === task.target && refused_actions === 0, refused_actions, steps: steps.length, item_location, target_location: task.target };
    });
  }
  trajectoryJSONL(): string { return this.scenario.trajectory.map(step => JSON.stringify(step)).join('\n') + (this.scenario.trajectory.length ? '\n' : ''); }

  navigate_to(robotId: string, waypointId: string): ActionResult {
    const r = this.robot(robotId);
    const args = { waypoint: waypointId };
    const wp = this.scenario.layout.waypoints[waypointId];
    if (!wp) return this.record(r, 'navigate_to', args, false, 'unknown waypoint');
    if (r.arm_out) return this.record(r, 'navigate_to', args, false, 'retract arm before driving');
    const route = this.route(r.waypoint, waypointId);
    if (!route) return this.record(r, 'navigate_to', args, false, 'no traversable route');
    const path = route.map(id => ({ x: this.scenario.layout.waypoints[id].x, y: this.scenario.layout.waypoints[id].y }));
    if (r.x !== path[0].x || r.y !== path[0].y) path.unshift({ x: r.x, y: r.y });
    const distance = path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);
    r.x = wp.x; r.y = wp.y; r.waypoint = wp.id;
    return this.record(r, 'navigate_to', args, true, 'arrived', distance / this.maxSpeed, path);
  }
  set_torso(robotId: string, level: number): ActionResult {
    const r = this.robot(robotId);
    if (!Number.isInteger(level) || level < 1 || level > 4) return this.record(r, 'set_torso', { level }, false, 'level must be 1 to 4');
    if (r.arm_out) return this.record(r, 'set_torso', { level }, false, 'retract arm before moving torso');
    const duration = Math.abs(level - r.torso_level) * 0.6 + 0.2;
    r.torso_level = level;
    return this.record(r, 'set_torso', { level }, true, 'torso positioned', duration);
  }
  scan_slot(robotId: string, slotId: string): ActionResult {
    const r = this.robot(robotId);
    const slot = this.scenario.layout.slots[slotId];
    if (!slot) return this.record(r, 'scan_slot', { slot: slotId }, false, 'unknown slot');
    if (r.waypoint !== slot.waypoint) return this.record(r, 'scan_slot', { slot: slotId }, false, 'slot is not at robot waypoint');
    const item = this.itemAt(slotId);
    return this.record(r, 'scan_slot', { slot: slotId }, true, item ? `slot contains ${item.id}` : 'slot is empty', 0.4);
  }
  reach(robotId: string, slotId: string): ActionResult {
    const r = this.robot(robotId);
    const slot = this.scenario.layout.slots[slotId];
    const args = { slot: slotId };
    if (!slot) return this.record(r, 'reach', args, false, 'unknown slot');
    if (r.arm_out) return this.record(r, 'reach', args, false, 'arm is already extended');
    if (r.waypoint !== slot.waypoint) return this.record(r, 'reach', args, false, 'slot is not at robot waypoint');
    if (r.torso_level < slot.level) return this.record(r, 'reach', args, false, 'out of reach');
    if (r.torso_level > slot.level) return this.record(r, 'reach', args, false, 'torso is above slot');
    r.arm_out = true; r.reaching = slotId;
    return this.record(r, 'reach', args, true, 'arm extended', 0.8);
  }
  grasp(robotId: string, mode: GraspMode): ActionResult {
    const r = this.robot(robotId);
    const args = { mode };
    if (mode !== 'one_hand' && mode !== 'two_hand') return this.record(r, 'grasp', args, false, 'unknown grasp mode');
    if (r.holding) return this.record(r, 'grasp', args, false, 'gripper already holds an item');
    if (!r.arm_out || !r.reaching) return this.record(r, 'grasp', args, false, 'arm is not extended');
    const item = this.itemAt(r.reaching);
    if (!item) return this.record(r, 'grasp', args, false, 'slot is empty');
    const limit = mode === 'one_hand' ? ONE_HAND_LIMIT_KG : TWO_HAND_LIMIT_KG;
    if (item.weight_kg > limit) return this.record(r, 'grasp', args, false, `${mode === 'one_hand' ? 'one-hand' : 'two-hand'} payload limit exceeded (${limit} kg)`);
    r.holding = item.id; r.grasp_mode = mode; item.slot = `holding:${r.id}`;
    return this.record(r, 'grasp', args, true, 'item secured', 0.6);
  }
  place(robotId: string, targetId: string): ActionResult {
    const r = this.robot(robotId);
    const args = { target: targetId };
    if (!r.holding) return this.record(r, 'place', args, false, 'robot holds nothing');
    if (targetId === 'tote') {
      if (r.waypoint !== 'tote') return this.record(r, 'place', args, false, 'robot is not at tote');
    } else {
      const slot = this.scenario.layout.slots[targetId];
      if (!slot) return this.record(r, 'place', args, false, 'unknown target');
      if (r.waypoint !== slot.waypoint || !r.arm_out || r.reaching !== targetId) return this.record(r, 'place', args, false, 'reach target slot before placing');
      if (this.itemAt(targetId)) return this.record(r, 'place', args, false, 'target slot is occupied');
    }
    const placedItem = this.scenario.items[r.holding];
    placedItem.slot = targetId;
    r.holding = null; r.grasp_mode = null;
    return this.record(r, 'place', args, true, 'item placed', 0.6, undefined, placedItem.id);
  }
  retract(robotId: string): ActionResult {
    const r = this.robot(robotId);
    r.arm_out = false; r.reaching = null;
    return this.record(r, 'retract', {}, true, 'arm retracted', 0.6);
  }
  report_issue(robotId: string, kind: string, detail: string): ActionResult {
    const r = this.robot(robotId);
    if (!kind.trim() || !detail.trim()) return this.record(r, 'report_issue', { kind, detail }, false, 'kind and detail are required');
    this.scenario.issues.push({ robot: robotId, t: this.scenario.t, kind, detail });
    return this.record(r, 'report_issue', { kind, detail }, true, 'issue recorded', 0.1);
  }

  private robot(id: string): Robot {
    const r = this.scenario.robots[id];
    if (!r) throw new RangeError(`unknown robot: ${id}`);
    return r;
  }
  private itemAt(slot: string): Item | undefined {
    return Object.values(this.scenario.items).find(item => item.slot === slot)
      ?? Object.values(this.scenario.items).find(item => item.slot === `behind:${slot}`);
  }
  private route(from: string, to: string): string[] | null {
    const distances = new Map<string, number>([[from, 0]]);
    const previous = new Map<string, string>();
    const open = new Set(Object.keys(this.scenario.layout.waypoints));
    while (open.size) {
      const id = [...open].sort((a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity))[0];
      if (!Number.isFinite(distances.get(id))) break;
      open.delete(id);
      if (id === to) {
        const path = [id];
        while (previous.has(path[0])) path.unshift(previous.get(path[0])!);
        return path;
      }
      const wp = this.scenario.layout.waypoints[id];
      for (const next of wp.neighbors) {
        const n = this.scenario.layout.waypoints[next];
        const distance = distances.get(id)! + Math.hypot(wp.x - n.x, wp.y - n.y);
        if (distance < (distances.get(next) ?? Infinity)) { distances.set(next, distance); previous.set(next, id); }
      }
    }
    return null;
  }
  private record(r: Robot, action: Action, args: Record<string, unknown>, ok: boolean, reason: string, duration = 0.2, path?: Point[], affectedItemId?: string): ActionResult {
    this.scenario.t = Math.round((this.scenario.t + duration) * 1000) / 1000;
    const shoppers = Object.values(this.scenario.shoppers ?? {}).map(shopper => {
      const position = shopperPosition(shopper, this.scenario.t);
      Object.assign(shopper, position);
      return position;
    });
    const nearest_shopper_distance_m = shoppers.length ? Math.min(...shoppers.map(shopper => Math.hypot(shopper.x - r.x, shopper.y - r.y))) : null;
    const task = r.task_id ? this.scenario.tasks[r.task_id] : null;
    const item = task ? this.scenario.items[task.item_id] : affectedItemId ? this.scenario.items[affectedItemId] : r.holding ? this.scenario.items[r.holding] : undefined;
    const slotId = typeof args.slot === 'string' ? args.slot : r.reaching;
    const observedItem = slotId ? this.itemAt(slotId) : undefined;
    const step: TrajectoryStep = structuredClone({
      t: this.scenario.t, robot: r.id, task_id: r.task_id,
      step: this.scenario.trajectory.filter(s => s.robot === r.id).length + 1,
      brain_nodes_read: this.brainReads.get(r.id) ?? [], action, args, ok, reason,
      position: { x: r.x, y: r.y }, torso_level: r.torso_level, holding: r.holding,
      item_location: item?.slot ?? null, target_location: task?.target ?? null,
      robot_state: r, item_id: affectedItemId ?? r.holding ?? (action === 'place' && ok ? item?.id : observedItem?.id) ?? null,
      duration, shoppers, nearest_shopper_distance_m, ...(path ? { path } : {}),
    });
    step.item_state = step.item_id ? structuredClone(this.scenario.items[step.item_id] ?? null) : null;
    this.scenario.trajectory.push(step);
    this.onStep?.(structuredClone(step));
    return { ok, reason, state: structuredClone({ t: this.scenario.t, robot: r, task: task ?? null, item: observedItem ?? item ?? null, ...(slotId ? { slot: this.scenario.layout.slots[slotId] } : {}) }), step: structuredClone(step) };
  }
}

export function createEngine(seed: number, options: EngineOptions & { robotCount?: number } = {}): StoreEngine {
  return new StoreEngine(createScenario(seed, options.robotCount ?? 2), options);
}
