# Store lab (Person A, Version 1 steps 2 and 3)

The React and TypeScript app uses Three.js to render the authoritative engine layout. Both Kenney packs are local assets, including their required palette textures and original CC0 license files. No API keys belong in this package.

```sh
npm ci
npm run dev
npm run build
```

The app opens at http://127.0.0.1:5173. The local preview creates a scenario from training seeds 1 to 20, assigns a PICK and RESTOCK, executes a fixed action list in the actual engine, and animates the resulting trajectory. These are motion checks, with no worker or supervisor model calls. They are labelled accordingly in the UI.

The controls play, stop after the current action, advance one step, change speed, reset, select a robot, focus its camera, switch between perspective and overhead views, and toggle the outside grid. Seed changes rebuild the world from the new engine state. All product positions come from the engine's slots; successful grasps attach the corresponding product object to the gripper, and placement detaches it into the shelf or tote.

`src/scene/StoreScene.ts` owns graphics and exposes `ready`, `playStep(step, speed)`, `setView`, `focusRobot`, `setGrid`, and `dispose`. `src/scene/robot.ts` builds the wheeled base, torso lift, two-part arm, gripper and head from simple shapes. Engine coordinates `(x, y)` map to Three.js `(x, height, z=y)`. `SHELF_HEIGHTS` is imported directly from the engine. Navigation animations follow the engine's recorded waypoint path.

Step 4 is the integration boundary: Person B's worker runner must provide the real shift scenario, `POST /shift`, and trajectory events on `GET /events`. The existing brain server has the event hub but does not yet run shifts. The web dev proxy routes `/api/*` to `http://127.0.0.1:8787`, matching Person B's server. Live shifts should instantiate the scene from the server's initial scenario and feed each engine event to `playStep`, preserving event order per robot.

The development build exposes `window.__AUTO_ROBO_PREVIEW__` for inspecting the actual scene, engine-generated preview steps and current playback cursor in browser checks. This helper is absent from production builds.
