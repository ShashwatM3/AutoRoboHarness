# Version 1, Person A: The Simulator and the Screens

You build the store engine (the simulator's logic), the 3D view that draws it, and the three screens. Person B's server imports your engine and calls its functions, and your web page listens to the server's event stream.

## A1. The store engine (1:20 to 1:50) — `engine/store.ts`

Plain TypeScript, no DOM and no Three.js imports, so it runs inside Person B's Node server.

**State.**
- A floor plan on a simple grid: a backroom, aisle A, and aisle B, with named waypoints (backroom, aisle ends, and one in front of each bay).
- Each aisle has 4 bays per side; each bay has 4 shelf levels; each level has slots. A slot ID looks like `A-3-4-1` (aisle, bay, level, position).
- Items: `{ id, name, weight_kg, slot }`. Robots: `{ id, x, y, waypoint, torso_level, arm_out, holding }`.

**Scenario generator.** `createScenario(seed)` uses a seeded random function (for example `mulberry32(seed)`) to place items, set weights between 0.2 and 4 kg, and occasionally put an item in the wrong slot. The same seed always gives the same store.

**Actions.** Implement the contract functions in the Version 1 README. Each one checks only physical feasibility and returns a reason when it refuses:
- `reach` refuses with `"out of reach"` when `torso_level` is below the slot's level.
- `grasp` refuses when the arm is not out or the slot is empty.
- `place` refuses when the robot holds nothing.
- `navigate_to` moves the robot and takes time proportional to distance.

There are no scripted failures. The engine records facts, and the supervisor decides what counts as a failure.

**Trajectory writer.** Every action appends one step in the contract shape to the shift's log and calls an `onStep` callback, which the server uses for the event stream.

**Done when:** a script can create a scenario, run a PICK by calling the actions in order, and print the trajectory.

## A2. The 3D view (1:50 to 2:15) — `web/`

**Setup.**
```
npm create vite@latest web -- --template react-ts
cd web && npm install three
```
Download Kenney's **Mini Market** and **Food Kit** packs (kenney.nl/assets/mini-market and kenney.nl/assets/food-kit, both CC0) and put the `.glb` files in `web/public/assets/`.

**The store.** Load the floor, walls, `shelf-boxes.glb`, and `shelf-bags.glb` with Three.js's `GLTFLoader`, placed at the same grid positions as the engine's layout. Put Food Kit items on the shelves where the engine's scenario says items are.

**The robot.** Build it from simple Three.js shapes in a `Group`, in TIAGo's form:
- base: a short, wide cylinder
- torso: a tall box whose `position.y` slides between 4 heights, one per shelf level
- arm: two boxes joined at an elbow, attached to the torso, that rotate out toward the shelf
- gripper: two small boxes that close together
- head: a small box on top (it carries the camera in Version 2)

**Animation.** Subscribe to `GET /events` with `EventSource`. For each step, tween the robot: drive to the waypoint, slide the torso, rotate the arm out, close the gripper, re-parent the item mesh to the gripper on a successful grasp, and back to the shelf or tote on place.

**Done when:** a shift run by the server plays in the browser with robots visibly driving, lifting, reaching, and carrying.

## A3. Live view panels and launch screen (2:15 to 2:40)

- **Per-robot stats:** current task, step number, the last action and whether it succeeded.
- **Brain panel:** draw the graph from `GET /brain` with a force-directed layout (for example `react-force-graph-2d`); when a step lists `brain_nodes_read`, pulse those nodes.
- **Launch screen:** choose 1 or 2 robots, a task for each (PICK or RESTOCK, a slot), and a training seed (1 to 20); the Launch button calls `POST /shift`.

## A4. Review screen (2:40 to 3:00)

Data comes from Person B's `GET /review/:shiftId`.
- **Failures:** robot, task, step number, reason; clicking one replays the 3D view to that step.
- **Insights:** the lesson, with its grounding shown inline (clip frames from `ground_truth/`, or two step lists side by side).
- **Brain updates:** each change in plain English, with a code block of the operations underneath.
- **Update Brain button:** calls `POST /brain/update`, then shows the graph before and after (added nodes green, retired nodes faded) and the two held-out scores side by side.
- **Run post-training** and **Adversarial attack** buttons appear but are disabled, labelled "Version 3."
