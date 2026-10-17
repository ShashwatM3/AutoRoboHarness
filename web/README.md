# Store lab (Person A, Version 1)

The React and TypeScript app uses Three.js to render the authoritative engine layout. Both Kenney packs are local assets, including their required palette textures and original CC0 license files. No API keys belong in this package.

```sh
npm ci
npm run dev
npm run build
```

The app opens at http://127.0.0.1:5173. Start Person B's server on port 8787 for the launch screen and live shifts. Launch selects one or two robots, their PICK or RESTOCK tasks, and a training seed from 1 to 20, and calls `POST /api/shift`. The engine's deterministic generator reconstructs the same initial scenario from the returned tasks and seed, including the server's task IDs. The view never executes its own actions during a live shift.

`GET /api/events` supplies real engine steps. A promise chain per robot preserves action order while allowing both robots to animate concurrently. The app polls the authoritative shift status and checks the saved trajectory at completion. Missing stream messages trigger a full replay from the saved log. The active shift ID is kept in session storage, so a reload can restore the shift. An animation timer fallback advances presentation when an embedded browser suspends animation frames.

`GET /api/brain` supplies the actual graph. Its node types use distinct colors, and the node IDs in the engine's steps and `brain_read` events pulse on the graph. Selecting a node opens its real label and properties. No model verification or improvement score is fabricated.

The separate Motion Preview creates a scenario from training seeds 1 to 20, assigns a PICK and RESTOCK, executes a fixed action list in the actual engine, and animates the resulting trajectory. These are motion checks, with no worker or supervisor model calls. They are labelled accordingly in the UI.

The controls play, stop after the current action, advance one step, change speed, reset, select a robot, focus its camera, switch between perspective and overhead views, and toggle the outside grid. Seed changes rebuild the world from the new engine state. All product positions come from the engine's slots; successful grasps attach the corresponding product object to the gripper, and placement detaches it into the shelf or tote.

`src/scene/StoreScene.ts` owns graphics and exposes `ready`, `playStep(step, speed)`, `setView`, `focusRobot`, `setGrid`, and `dispose`. `src/scene/robot.ts` builds the wheeled base, torso lift, two-part arm, gripper and head from simple shapes. Engine coordinates `(x, y)` map to Three.js `(x, height, z=y)`. `SHELF_HEIGHTS` is imported directly from the engine. Navigation animations follow the engine's recorded waypoint path.

The web dev proxy routes `/api/*` and `/ground_truth/*` to `http://127.0.0.1:8787`, matching Person B's server. Review Shift loads `GET /api/review/:shiftId` and polls until the supervisor finishes. Evidence frames come directly from the supplied RetailAction paths. Run contrasts fetch both referenced trajectories. Failures use `seekToStep` to reconstruct the recorded prefix, then animate the cited step; Return to Final State reconstructs the whole shift. The review displays both supervisor edits and compiled graph operations. The held-out gate is the next dependency; Update Brain remains unavailable until it is connected.

The development build exposes `window.__AUTO_ROBO_PREVIEW__` for local motion checks and `window.__AUTO_ROBO_LIVE__` for live scene and trajectory checks. Both helpers are absent from production builds.
