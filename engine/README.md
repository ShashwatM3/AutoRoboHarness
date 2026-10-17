# Store engine (Person A, Version 1 step 1)

The engine is the single source of truth for inventory, robot positions and action results. It runs in Node or the browser with no graphics or model dependencies. Every refusal follows from the current state and physical limits. The engine records facts; the supervisor identifies failures.

```sh
cd engine
npm install
npm test
npm run typecheck
npm run demo
```

## Server integration

```ts
import { createScenario, StoreEngine } from '../../engine/store.ts';

const engine = new StoreEngine(createScenario(seed, robots.length), {
  onStep: step => emit('step', step),
});
const task = engine.createTask('robot-1', 'PICK', 'A-3-4-1');
engine.setBrainNodesRead('robot-1', resolvedContext.node_ids);
const result = engine.navigate_to('robot-1', 'A-3');
```

`createScenario(seed, robotCount = 2)` returns serializable state. `new StoreEngine(scenario, { onStep, maxSpeed })` attaches the eight action methods in the shared contract. `createEngine(seed, options)` is shorthand. Methods are synchronous and return `{ ok, reason, state, step }`. `state` contains the acting robot, active task, relevant item, observed slot and simulation time. `snapshot()` returns a detached copy of the whole scenario. The `scenario` property is the live state.

The action arguments are `navigate_to(robotId, waypointId)`, `set_torso(robotId, level)`, `scan_slot(robotId, slotId)`, `reach(robotId, slotId)`, `grasp(robotId, mode)`, `place(robotId, targetId)`, `retract(robotId)`, and `report_issue(robotId, kind, detail)`. Mode is `one_hand` or `two_hand`. Level is 1 to 4. Targets are a slot ID or `tote`. The one-hand payload limit is 2 kg, and the supported two-hand mode accepts up to 4 kg. The maximum driving speed is 0.8 m/s; `maxSpeed` may lower that limit.

## Coordinates and tasks

Engine `(x, y)` maps to Three.js `(x, height, z=y)`. Aisle A is centered at x=-3.2, aisle B at x=3.2. Each has four bays on each side: bays 1–4 left and 5–8 right. Each bay has levels 1–4 and positions 1–2. `A-3-4-1` is a shelf slot; its `waypoint` tells the worker where to navigate. Opposite bays share an approach waypoint. `backroom` and `tote` are also waypoint IDs. Routes go through aisle entrances and exits rather than through shelves.

`createTask(robotId, type, shelfSlotId, optionalTaskId)` creates and assigns a PICK or RESTOCK task. A PICK names `item:<shelfSlotId>` and targets `tote`. A RESTOCK names `stock:<shelfSlotId>`, starts at `backroom:<shelfSlotId>`, and targets the shelf. Alternatively, `setTask(task)` assigns an explicit `{ id, robot, type, item_id, source, target }`. The worker should use the returned task and the engine's observations. All items have an identity, weight, current `slot`, intended `home_slot`, and asset key. A seed can swap inventory or leave a shelf empty with its original item in backroom reserve. RESTOCK must not overwrite occupied inventory.

`score()` returns one result per task. `complete` means the intended item reached its target and the task had no refused actions. Step count and refused-action count are separate metrics, for Person B's gate to aggregate. The trajectory includes every required shared field plus `robot_state`, `item_id`, `duration` and navigation `path` for animation. Times are simulated seconds. Callbacks, results and snapshots are detached, so a consumer cannot mutate logged history. `trajectoryJSONL()` returns the log as newline-delimited JSON.

Training and held-out seeds use the same generator. Only the gate should run held-out seeds; no seed is treated specially by the engine.
