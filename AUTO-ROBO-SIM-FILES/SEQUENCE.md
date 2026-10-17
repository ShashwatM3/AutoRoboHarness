# Build Sequence

Person A is Shashwat; Person B is the teammate. Each version has two numbered lists, one per person, and both people work down their own list at the same time. A step marked **Waits for** cannot be finished until the other person has finished the step named; where possible, it says what stand-in to build against in the meantime. A version starts only after both people finish the last step of the previous version.

---

## Version 1: The Closed Loop

### Person A

1. **Store engine** (`engine/store.ts`). The engine is plain TypeScript with no graphics: a grid layout with a backroom and aisles A and B, bays, shelf levels 1 to 4, and slots; items with weights; `createScenario(seed)`; the eight robot actions from the contract, each refusing physically impossible moves with a reason; and a trajectory writer with an `onStep` callback. **Waits for:** nothing. Push it as soon as it runs, because Person B's step 3 needs it.
2. **Web project and 3D store** (`web/`). The project is Vite with React and TypeScript plus `three`; Kenney's Mini Market and Food Kit packs go in `web/public/assets/`; the shelves and products are placed at the same positions as the engine's layout. **Waits for:** nothing.
3. **Robot model and animations.** The robot is built from simple shapes (wheeled base, sliding torso, two-part arm, gripper, head), with an animation for each action: drive, raise or lower the torso, reach, grasp (the item attaches to the gripper), place, retract. **Waits for:** nothing.
4. **Animations driven by the server.** The 3D view subscribes to `GET /events` and plays each step as it arrives. **Waits for:** Person B step 3 (worker agents streaming events). Until then, it plays a hand-written list of steps in the trajectory-step shape.
5. **Robot stats panel and launch screen.** The panel shows each robot's task, step number, and last action; the launch screen picks 1 or 2 robots, a task per robot, and a training seed, then calls `POST /shift`. **Waits for:** Person B step 3 (the `POST /shift` endpoint). Until then, the Launch button plays the hand-written steps.
6. **Brain graph panel.** The panel draws the graph from `GET /brain` and pulses the nodes listed in each step's `brain_nodes_read`. **Waits for:** Person B steps 1 and 2 (the brain server and `brain/v1.json`).
7. **Review screen.** The screen shows failures (clicking one replays that step), insights with their grounding (clip frames from `ground_truth/` or two step lists side by side), and brain updates in English with a code block of the operations. **Waits for:** Person B step 5 (the supervisor's output at `GET /review/:shiftId`). Until then, it uses a sample JSON in that shape.
8. **Update Brain button.** The button calls `POST /brain/update`, then shows the graph before and after (from `GET /brain/diff`) and the old and new held-out scores. **Waits for:** Person B step 6 (the gate).
9. **Version 1 check, with Person B.** A launched shift produces a real failure, the supervisor proposes a fix, and Update Brain shows a higher held-out score; both people fix whatever fails until all three are true.

### Person B

1. **Brain server** (`server/brain.ts`). The server uses Express and `graphology`, and offers `GET /brain`, `GET /brain?scope=<slot>` (the slot's nodes plus everything above it), `POST /brain/apply` (writes the next version file), and `GET /brain/diff`. **Waits for:** nothing.
2. **Day-one brain** (`brain/v1.json`). About 40 nodes: the scope tree, PICK and RESTOCK procedures made of linked steps, one speed guardrail, and a few rules, deliberately without a grasp-by-weight rule, a torso-height-by-shelf rule, or a check-the-slot step. **Waits for:** nothing.
3. **Worker agents and shift runner** (`server/worker.ts`). `POST /shift` creates the engine scenario and runs one worker per robot on Lightning; each worker reads its brain scope, puts the brain text at the very start of its system prompt, calls the engine actions as tools, and every step streams out on `GET /events`. **Waits for:** Person A step 1 (the store engine).
4. **Footage library** (`ground_truth/`). The library holds about 20 RetailAction clips from the `Voxel51/RetailAction` dataset, four frames from each action extracted with `ffmpeg`, `library.json` with a description of each clip from the supervisor model, and the Standard AI license and notice. **Waits for:** nothing.
5. **Supervisor** (`server/supervisor.ts`). A tool-calling loop on Nemotron 3.5 Super VL reads a shift's steps, the brain nodes in effect, sibling runs, and the footage library, and returns failures, insights with grounding, and brain updates as operations at `GET /review/:shiftId`. **Waits for:** this list's step 3 (a real shift to review) and step 4.
6. **Gate** (`server/gate.ts`). `POST /brain/update` applies the operations to a candidate version, re-runs the tasks on held-out seeds 101 to 110 with the old and the candidate brain without graphics, keeps the candidate only if the score rises, and returns both scores and the diff. **Waits for:** Person A step 1 (the engine, already done by this point).
7. **Version 1 check, with Person A.** Same as Person A step 9.

---

## Version 2: Grounded, Verified, Governed

### Person A

1. **Worker views.** Each robot gets a camera on its head; a switch toggles between the 3D view and a grid of camera tiles, each with the robot's task and scrolling step list. **Waits for:** nothing.
2. **Shoppers.** Shoppers are added to the engine on seeded walking paths, each step records the distance to the nearest shopper, and Kenney's Mini Characters walk them in the 3D view. **Waits for:** nothing. Tell Person B about the new trajectory field.
3. **More robots.** The launch screen allows 3 or 4 robots. **Waits for:** nothing.
4. **Judge, cache, and citation displays.** The review screen shows the judge's kept and dropped counts and each insight's citations; the live view shows the share of brain tokens served from Crusoe's cache. **Waits for:** Person B steps 1, 2, and 4. Until then, each display uses sample values.
5. **History chart.** The review screen shows the held-out score for every brain version. **Waits for:** Person B step 3 (`GET /brain/history`).
6. **Version 2 check, with Person B.** The Version 1 loop still works end to end with every Version 2 addition switched on.

### Person B

1. **Judge.** DeepSeek V4 Pro checks every failure and insight against the steps and evidence it cites, drops what it cannot confirm, and adds `judge: { kept, dropped }` to `GET /review/:shiftId`. **Waits for:** nothing.
2. **Cache share.** The shift runner sums `cached_tokens` against `prompt_tokens` across all worker calls and exposes `cache_share`. **Waits for:** nothing.
3. **Brain history.** `GET /brain/history` returns each brain version with its held-out score. **Waits for:** nothing.
4. **You.com citations.** The supervisor gets a `research(question)` tool calling `POST https://api.you.com/v1/research`, and each insight carries its citations. **Waits for:** nothing.
5. **OpenShell, only if idle.** The supervisor runs in an OpenShell sandbox that cannot read the held-out seeds folder; dropped if it does not work within 15 minutes. **Waits for:** nothing.
6. **Version 2 check, with Person A.** Same as Person A step 6.

---

## Version 3: The Full Harness

### Person A

1. **Disturbances in the engine.** `applyDisturbance(scenario, kind, params)` supports a fixed list: a box blocking an aisle segment, an item in the wrong slot, a heavy item moved to the top shelf, an item placed behind a fresh one. **Waits for:** nothing.
2. **Adversarial attack button.** The red button calls `POST /adversary`, which plays each disturbed training scenario through the gate's re-run code, keeps the ones that break the current brain, and returns "tried N, broke M"; those failures appear on the review screen labelled "found by adversary." **Waits for:** nothing, since the gate's re-run code exists from Version 1.
3. **Post-training progress panel.** The review screen shows each post-training step as it completes, and the Crusoe job ID, status, and console link. **Waits for:** Person B step 5. Until then, it uses sample progress values.
4. **Final steps, with Person B.** Stop adding features, record the one-minute video, write the "Built during the event" README section, and confirm `.env` is not committed.

### Person B

1. **Collect.** Every step from tasks whose item ended at its target with no refused actions. **Waits for:** nothing.
2. **Task scaler.** Three variants of each successful task (another shelf level, weight, or start position), played with the current brain, keeping only the variants that succeed. **Waits for:** nothing.
3. **Chat-format dataset.** One JSON line per kept step: the brain scope as the system message, the observation as the user message, and the chosen action as the assistant message. **Waits for:** nothing.
4. **Upload.** The file goes to Crusoe's Files API with the purpose "fine-tune," at `https://api.intelligence.crusoecloud.com/v1`. **Waits for:** nothing.
5. **Fine-tuning job.** A supervised LoRA job on Nemotron 3.5 Lightning is created and its ID, status, and console link are returned through `POST /post-training`. **Waits for:** nothing.
6. **Hugging Face copy, if time.** A LeRobot-style copy goes to a public dataset repository on the Hugging Face Hub. **Waits for:** nothing.
7. **Final steps, with Person A.** Same as Person A step 4.
