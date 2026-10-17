# Build Sequence

Person A is Shashwat; Person B is the teammate. Each version has two numbered lists, one per person, and both people work down their own list at the same time. A step marked **Waits for** cannot be finished until the other person has finished the step named; where possible, it says what stand-in to build against in the meantime. A version starts only after both people finish the last step of the previous version.

---

## Version 1: The Closed Loop

### Person A

- [x] 1. **Store engine** (`engine/store.ts`). The engine is plain TypeScript with no graphics: a grid layout with a backroom and aisles A and B, bays, shelf levels 1 to 4, and slots; items with weights; `createScenario(seed)`; the eight robot actions from the contract, each refusing physically impossible moves with a reason; and a trajectory writer with an `onStep` callback. **Waits for:** nothing. Push it as soon as it runs, because Person B's step 3 needs it.
- [x] 2. **Web project and 3D store** (`web/`). The project is Vite with React and TypeScript plus `three`; Kenney's Mini Market and Food Kit packs go in `web/public/assets/`; the shelves and products are placed at the same positions as the engine's layout. **Waits for:** nothing.
- [x] 3. **Robot model and animations.** The robot is built from simple shapes (wheeled base, sliding torso, two-part arm, gripper, head), with an animation for each action: drive, raise or lower the torso, reach, grasp (the item attaches to the gripper), place, retract. **Waits for:** nothing.
- [x] 4. **Animations driven by the server.** The 3D view subscribes to `GET /events` and plays each step as it arrives. **Waits for:** Person B step 3 (worker agents streaming events). Until then, it plays a hand-written list of steps in the trajectory-step shape.
- [x] 5. **Robot stats panel and launch screen.** The panel shows each robot's task, step number, and last action; the launch screen picks 1 or 2 robots, a task per robot, and a training seed, then calls `POST /shift`. **Waits for:** Person B step 3 (the `POST /shift` endpoint). Until then, the Launch button plays the hand-written steps.
- [x] 6. **Brain graph panel.** The panel draws the graph from `GET /brain` and pulses the nodes listed in each step's `brain_nodes_read`. **Waits for:** Person B steps 1 and 2 (the brain server and `brain/v1.json`).
- [x] 7. **Review screen.** The screen shows failures (clicking one replays that step), insights with their grounding (clip frames from `ground_truth/` or two step lists side by side), and brain updates in English with a code block of the operations. **Waits for:** Person B step 5 (the supervisor's output at `GET /review/:shiftId`). Until then, it uses a sample JSON in that shape.
- [x] 8. **Update Brain button.** The button calls `POST /brain/update`, then shows the graph before and after (from `GET /brain/diff`) and the old and new held-out scores. **Waits for:** Person B step 6 (the gate).
- [x] 9. **Version 1 check, with Person B.** A launched shift produces a real failure, the supervisor proposes a fix, and Update Brain shows a higher held-out score; both people fix whatever fails until all three are true.

### Person B

- [x] ~~1. **Brain server** (`server/brain.ts`). The server uses Express and `graphology`, and offers `GET /brain`, `GET /brain?scope=<slot>` (the slot's nodes plus everything above it), `POST /brain/apply` (writes the next version file), and `GET /brain/diff`. **Waits for:** nothing.~~
- [x] ~~2. **Day-one brain** (`brain/v1.json`). About 40 nodes: the scope tree, PICK and RESTOCK procedures made of linked steps, one speed guardrail, and a few rules, deliberately without a grasp-by-weight rule, a torso-height-by-shelf rule, or a check-the-slot step. **Waits for:** nothing.~~
- [x] ~~3. **Worker agents and shift runner** (`server/worker.ts`). `POST /shift` creates the engine scenario and runs one worker per robot on Lightning; each worker reads its brain scope, puts the brain text at the very start of its system prompt, calls the engine actions as tools, and every step streams out on `GET /events`. **Waits for:** Person A step 1 (the store engine).~~
- [x] ~~4. **Footage library** (`ground_truth/`). The library holds about 20 RetailAction clips from the `Voxel51/RetailAction` dataset, four frames from each action extracted with `ffmpeg`, `library.json` with a description of each clip from the supervisor model, and the Standard AI license and notice. **Waits for:** nothing.~~
- [x] ~~5. **Supervisor** (`server/supervisor.ts`). A tool-calling loop on Nemotron 3.5 Super VL reads a shift's steps, the brain nodes in effect, sibling runs, and the footage library, and returns failures, insights with grounding, and brain updates as operations at `GET /review/:shiftId`. **Waits for:** this list's step 3 (a real shift to review) and step 4.~~
- [x] ~~6. **Gate** (`server/gate.ts`). `POST /brain/update` applies the operations to a candidate version, re-runs the tasks on held-out seeds 101 to 110 with the old and the candidate brain without graphics, keeps the candidate only if the score rises, and returns both scores and the diff. **Waits for:** Person A step 1 (the engine, already done by this point).~~
- [x] ~~7. **Version 1 check, with Person A.** Same as Person A step 9.~~

---

## Version 1 verification checkpoint (Person A)

The shared Version 1 check is complete: Person A steps 1 to 9 and Person B step 7 are checked. A real Lightning shift (`shift-mvcvh66t`, training seed 1) recorded an out-of-reach refusal at robot-1 step 2, recovered, and delivered the item. The Super VL supervisor returned the failure, RetailAction frame evidence, and valid torso-height updates. The browser review and failure replay were verified.

The full Lightning gate `gate-mvcw8wto` evaluated updates U1 and U2 on all ten held-out seeds, with 20 task runs and 155 successful model responses. Completion stayed at **4/10 (40%) for both brains**. Refused actions per task fell from **0.7 to 0.6**, and steps per task fell from **7.5 to 7.4**. The gate promoted candidate **v4** using its existing rule that equal completion with fewer refusals is an improvement. This is a secondary improvement; the completion rate did not increase. The [complete saved gate result](verification/version-1-gate.json) contains the per-seed scores and graph diff so Person B can confirm the shared check without immediately repeating the inference run. The API, saved JSON, recomputed aggregates, live v4 status, and browser's final scores and before/after graphs all agree. Both final Version 1 steps use this same completed check, so Person B may resume Version 2.

Provider scheduling now paces actual per-model starts, applies a shared Retry-After cooldown (60 seconds when absent), and preserves Person B's 600-second recovery window from `94f4ddd`. The gate runs seed/version pairs in sequence and drains current robot workers before reporting a fatal error. Four scheduling regression tests, seven engine tests, engine/server type checks, and the web production build pass. Intermittent provider 429s still occurred, but the full gate recovered and finished. Earlier gate `gate-mvcvkj5q` rejected v2 after a provider error; `gate-mvcw2t14` was stopped and v3 rejected before the manual server restart that loaded the merged fix. Existing brain version files were preserved.

The requested [Crusoe MCP setup guide](CRUSOE-MCP-SETUP.md) is complete. The local Cloud MCP registration and authenticated project, project-quota, and organization-quota queries were verified. Its project quota tools expose serverless RPM and TPM entries. The sponsor hackathon skill has been read and its endpoint, exact model discovery, and rate-limit guidance checked against the running integration. Credentials stay outside the repository.

---

## Version 2: Grounded, Verified, Governed

### Person A

- [x] 1. **Worker views.** Each robot gets a camera on its head; a switch toggles between the 3D view and a grid of camera tiles, each with the robot's task and scrolling step list. **Waits for:** nothing.
- [x] 2. **Shoppers.** Shoppers are added to the engine on seeded walking paths, each step records the distance to the nearest shopper, and Kenney's Mini Characters walk them in the 3D view. **Waits for:** nothing. Tell Person B about the new trajectory field.
- [x] 3. **More robots.** The launch screen allows 3 or 4 robots. **Waits for:** nothing.
- [x] 4. **Judge, cache, and citation displays.** The review screen shows the judge's kept and dropped counts and each insight's citations; the live view shows the share of brain tokens served from Crusoe's cache. **Waits for:** Person B steps 1, 2, and 4. Until then, each display uses sample values.
- [x] 5. **History chart.** The review screen shows the held-out score for every brain version. **Waits for:** Person B step 3 (`GET /brain/history`).
- [x] 6. **Version 2 check, with Person B.** The Version 1 loop still works end to end with every Version 2 addition switched on.

### Person B

- [x] ~~1. **Judge.** DeepSeek V4 Pro checks every failure and insight against the steps and evidence it cites, drops what it cannot confirm, and adds `judge: { kept, dropped }` to `GET /review/:shiftId`. **Waits for:** nothing.~~
- [x] ~~2. **Cache share.** The shift runner sums `cached_tokens` against `prompt_tokens` across all worker calls and exposes `cache_share`. **Waits for:** nothing.~~
- [x] ~~3. **Brain history.** `GET /brain/history` returns each brain version with its held-out score. **Waits for:** nothing.~~
- [x] ~~4. **You.com citations.** The supervisor gets a `research(question)` tool calling `POST https://api.you.com/v1/research`, and each insight carries its citations. **Waits for:** nothing.~~
- [x] ~~5. **OpenShell, only if idle.** The supervisor runs in an OpenShell sandbox that cannot read the held-out seeds folder; dropped if it does not work within 15 minutes. **Waits for:** nothing.~~
- [x] 6. **Version 2 check, with Person A.** Same as Person A step 6.

---

## Version 2 verification checkpoint (complete)

Both Version 2 numbered lists are complete. Person B's optional OpenShell item is resolved by dropping it, as the plan permits; the actual supervisor never ran inside that sandbox. The sandbox probe and cleanup do not establish supervisor isolation.

**Four robots and shoppers.** Real Lightning shift `shift-mvcxwrms` finished 34 actions across four robots, with 7/9/9/9 actions in their respective camera logs. All four items reached the tote; three robots recovered from physical refusals, so the strict completion score is 1/4. Every action records four seeded shopper positions and the exact nearest distance. Three-robot launch rendering, four head cameras, view switching, head/torso following, and a 390px one-column camera grid were verified. The [saved four-robot run](verification/version-2-four-robots.json) contains the real records. Trajectory additions are `shoppers: { id, x, y }[]` and `nearest_shopper_distance_m: number | null`, at action-end `step.t`; older trajectories remain readable.

**Grounded review.** Training shift `shift-mvcy793i` picked a 3.98 kg item on seed 1. Its first one-hand grasp was genuinely refused by the 2 kg limit, then it recovered with two hands and delivered in eight actions. Super VL proposed a weight-based grasp rule. DeepSeek kept F1 and I1 and dropped I2; the browser shows 2 kept and 1 dropped. You.com returned five sources. The cited source was marked unsupported for the exact 2 kg claim and appears in the excluded-source audit. The retained lesson is grounded in actual run contrasts and the explicit refusal. Provider-reported review cache usage is 13,056/40,441 prompt tokens (32.3%), across eight reporting calls; all nine review calls were live, with zero local replays. Lightning omits cache usage, so the live worker view says “Cache not reported.”

**Full held-out check.** Gate `gate-mvcynupn` completed all 20 real Lightning task runs on seeds 101 to 110, with 150 successful model responses and zero local replays. Only judge-supported U1 was selected; `judge_policy` is `enforced`. Completion rose from **6/10 (60%) with v4 to 9/10 (90%) with v5**. Refusals/task fell from **0.5 to 0.2**, and steps/task from **7.5 to 7.2**. Candidate **v5 was promoted**. The API, persisted JSON, recomputed per-seed aggregates, graph diff (+2 nodes/+2 edges), and live graph agree. Immutable brain-file hashes stayed unchanged. The live API also rejects an empty update selection before any brain mutation. See the [complete gate](verification/version-2-gate.json), [verification packet](verification/version-2-verification.json), and [production UI export](verification/version-2-ui.pdf). The history chart connects only versions measured in the same gate; v1's earlier 40% result is a separate point.

**Person B's independent check.** Person B recomputed the 20 scores, checked the promotion, selected update, judge verdicts, cache fraction, history, graph diff, hashes, and rendered UI, and signed off B6. A verified runtime snapshot was imported into an isolated, git-ignored `server/data/verified-v2/brain` on Person B's machine, configured through private `BRAIN_DIR`. Existing root brain files were preserved. Both machines now serve live v5 and the same review, gate and history records; the import made no model calls. A direct cross-machine API audit confirms exact graph, gate, review and history equality. Person B’s backend runs in the user-systemd service `autorobo-b-server.service`, independently of agent tool limits; restart it deliberately after backend code changes. Private environment-file permissions are 0600.

Nine engine tests, fourteen server tests, two camera/grid tests, engine/server/web type checks, and the production build pass. The production UI shows the final scores, judge, citations, cache and history without errors. Public verification files retain web source identity and content hashes while omitting fetched excerpts. Credentials remain outside version control.

---

## Version 3: The Full Harness

### Person A

- [ ] 1. **Disturbances in the engine.** `applyDisturbance(scenario, kind, params)` supports a fixed list: a box blocking an aisle segment, an item in the wrong slot, a heavy item moved to the top shelf, an item placed behind a fresh one. **Waits for:** nothing.
- [ ] 2. **Adversarial attack button.** The red button calls `POST /adversary`, which plays each disturbed training scenario through the gate's re-run code, keeps the ones that break the current brain, and returns "tried N, broke M"; those failures appear on the review screen labelled "found by adversary." **Waits for:** nothing, since the gate's re-run code exists from Version 1.
- [ ] 3. **Post-training progress panel.** The review screen shows each post-training step as it completes, and the Crusoe job ID, status, and console link. **Waits for:** Person B step 5. Until then, it uses sample progress values.
- [ ] 4. **Final steps, with Person B.** Stop adding features, record the one-minute video, write the "Built during the event" README section, and confirm `.env` is not committed.

### Person B

- [ ] 1. **Collect.** Every step from tasks whose item ended at its target with no refused actions. **Waits for:** nothing.
- [ ] 2. **Task scaler.** Three variants of each successful task (another shelf level, weight, or start position), played with the current brain, keeping only the variants that succeed. **Waits for:** nothing.
- [ ] 3. **Chat-format dataset.** One JSON line per kept step: the brain scope as the system message, the observation as the user message, and the chosen action as the assistant message. **Waits for:** nothing.
- [ ] 4. **Upload.** The file goes to Crusoe's Files API with the purpose "fine-tune," at `https://api.intelligence.crusoecloud.com/v1`. **Waits for:** nothing.
- [ ] 5. **Fine-tuning job.** A supervised LoRA job on Nemotron 3.5 Lightning is created and its ID, status, and console link are returned through `POST /post-training`. **Waits for:** nothing.
- [ ] 6. **Hugging Face copy, if time.** A LeRobot-style copy goes to a public dataset repository on the Hugging Face Hub. **Waits for:** nothing.
- [ ] 7. **Final steps, with Person A.** Same as Person A step 4.


## Version 2 extension: brain explorer and saved-trial playback (complete)

The user reopened V2 to finish version browsing and durable replay before any V3 work. The original verified gate remains 6/10 for v4 and 9/10 for v5 (`gate-mvcynupn`); those score-only records have no replay and must remain unchanged. Fresh comparisons have their own evaluation IDs, full denominators and actual results.

### Person A

- [x] 1. Dynamic version explorer, actual graph details and full node/edge/property comparison, with zoom, pan, search, focus and neighbor highlighting.
- [x] 2. Historical brain selector and matched comparison controls, default v4 versus v5.
- [x] 3. Saved-trial browser and synchronized recorded playback with camera views, action logs and timeline controls.
- [x] 4. Run a fresh complete ten-seed Lightning comparison after backend integration. Person A owns inference quota; Person B runs offline tests only.
- [x] 5. Verify restart durability, zero-inference replay, exact recorded scene restoration, unchanged live brain/snapshots and finished dashboard. Publish the explanatory README with pipeline diagrams.

### Person B

- [x] 1. Atomically persist explicit initial scene, actions, shoppers, outcomes and final state for new shifts and gate runs. Keep held-out records isolated from supervisor inputs.
- [x] 2. Read-only trial APIs and historical matched-comparison runner, with identical settings and no brain/index mutation.
- [x] 3. Complete evaluation metadata and meaningful storage, matching, isolation and immutability tests.
- [x] 4. Push isolated backend branch for Person A integration; jointly verify complete V2 extension.

Person B received the backend scope through the authorized Forge Claude session. Existing brain and evidence file hashes were captured before edits. No V3 work has begun.

Extension checkpoint: the frontend compiles and its five tests pass, including every recorded action boundary across four robots and backward seeks. Nine engine tests pass. The explorer includes graph navigation and property comparison; saved playback uses the shared recorded simulation clock. The explanatory README now covers setup, four pipeline/concept diagrams, original evaluation limits and runtime data. Person B published the backend contract and is implementing it in an isolated branch with offline tests. Integration and fresh Lightning recording remain pending.

Integration checkpoint: Person B commit `82bd302` was integrated as `b86ecab`. Engine and web compile; the six web tests include exact forward/back restoration, misplaced products, shared clock, graph property diffs and robot cameras. The server type check and existing 14 tests pass. A local compiled comparison (`cmp-mvd0tvv7-1`) completed all twenty recordings, with identical initial worlds per seed and zero model calls. A historical v4 training shift (`shift-mvd0tw41`) also produced a durable recording. Held-out trial IDs return 404 from shift/review inputs. Every baseline brain, live-index, gate and original verification-file hash remains unchanged.

The fresh Lightning comparison is now running as **`cmp-mvd0u3kl-2`**, ten held-out seeds 101–110, one PICK A-1-3-1 request per seed, v4 versus v5, maximum speed 0.8 m/s. Person A exclusively owns its inference quota; Person B remains on offline regression tests. No backend edits or restart while it runs. Fresh results remain pending and separate from the original gate. Graph zoom, focus and edge inspection were exercised in Orca; actual recorded camera coordinates are being checked before final restart verification. The explanatory README and frontend are already pushed to `person-a/v2-explorer`; integrated main publication follows verification.

### V2 extension completion

All extension items are complete. Person B's implementation and follow-up tests (`82bd302`, `22b8d9e`, `9da16a1`) are integrated. The dynamic catalog includes every saved file, marks unregistered or unavailable versions honestly, and never changes the live index while browsing. Graph navigation supports zoom, pan, search, focus, neighbor highlighting and node/edge details; two actual snapshots can be compared at full property detail. Historical launches and matched comparisons leave the live brain and every snapshot unchanged.

**Fresh recorded Lightning comparison:** `cmp-mvd0u3kl-2`, all twenty trials completed on seeds 101–110 with v4 and v5, one requested PICK A-1-3-1 per seed, identical starting-world hashes and effective environment. Actual results: **v4 6/10 (60%) → v5 9/10 (90%)**, **147 model responses**, **zero local response replays**, **144 physical action records**. Refusals/task: **0.5 → 0.1**; steps/task: **7.5 → 6.9**. This is a separate experiment from original `gate-mvcynupn`, whose immutable result remains **6/10 → 9/10**, 150 responses, score-only and **no replay**. No trial was fabricated for that original gate. Selecting clips never changes aggregates.

**Verification:** all twenty fresh trajectories reconstruct their exact initial and final worlds, including products, robots, shoppers and issue records. An actual API restart left all twenty recordings and the comparison file byte-identical. Saved playback was then exercised with external fetches blocked and counted in the server process: **zero outbound inference attempts** and only browser GET requests. Play/pause, speed controls, timeline, forward/backward steps and refusal jumps work. Four-robot paired playback showed all eight labeled cameras; each final pose, held item, item location and shopper position matched recorded data. The production dashboard was inspected at desktop and 390-pixel widths with no page overflow or UI errors. Every original brain, live-index, gate and verification-file hash is unchanged; v5 remains live. All twenty held-out IDs return 404 from shift/review inputs.

**Checks:** engine 9/9, server 29/29, web 6/6; all three type checks and the web production build pass. The README explains setup, the learning loop, knowledge graph, recording isolation and architecture with four Mermaid diagrams. Detailed API documentation is in `server/TRIALS.md`. Original evidence remains unchanged, while the new comparison, verification packet and two UI PDFs have separate filenames in `verification/`.

Person B ran only offline tests while Person A exclusively used the shared inference quota. The completed runtime recordings were copied to Person B with a 47-file hash manifest, preserving existing data. Main publication and the final peer service refresh are being confirmed. **V3 has not started.**
