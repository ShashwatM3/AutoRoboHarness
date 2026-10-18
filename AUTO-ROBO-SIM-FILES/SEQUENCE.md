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

Person B ran only offline tests while Person A exclusively used the shared inference quota. The completed runtime recordings were copied to Person B with a 47-file hash manifest, preserving existing data. Main was published as `c6177d6`. Person B fast-forwarded to the same commit, restarted the persistent service manually, and independently served the same v5 graph, complete fresh comparison and all twenty recordings. Canonical API hashes for the graph, comparison and trial summaries match across machines. The private environment remains mode 0600; Person B made zero inference calls. **V3 has not started.**


## Version 2 dashboard redesign (in progress)

The user requested Live trial and Previous results, then added a Development tab. Both trial experiences follow the original three dashboard stages: **1. Launch**, **2. Robots at work**, **3. Failures, insights and brain updates**. Saved runs must feel like an inspectable recorded workflow, with actual camera playback and step navigation, rather than a long report. Historical browsing never starts review, inference or promotion. Keep original score-only gate evidence separate from fresh recordings. Link actual Crusoe inference dashboards; NVIDIA Nemotron is hosted on Crusoe, and the user confirmed that Crusoe links are sufficient. Post-training and adversarial attack remain clearly identified V3 work. Simplify the README for a new machine's setup and first run.

- [ ] Person A: three-tab navigation, shared three-stage trial flow, interactive recorded-results workspace, Development roadmap and beginner setup guide.
- [ ] Person B: read-only saved training-run/review/gate API, without the legacy review endpoint's auto-start behavior. No inference calls or edits to existing evidence.
- [ ] Verify responsive dashboard, recorded playback, review isolation, provider destinations, checks and evidence hashes; publish and synchronize both machines.


### Parallel ownership update

The user explicitly reassigned the complete dashboard redesign and beginner README to Person B's machine and asked Person A to start V3 now. This supersedes the earlier instruction to finish the redesign before V3. Person B owns existing web files and README in an isolated branch, plus the separate read-only run-library API task. Person A owns engine disturbances, adversarial execution and post-training backend, plus a new `V3Controls.tsx` integration component. Only Person A may use Crusoe inference; Person B uses offline checks. All existing evidence remains immutable. V3 status is in progress, never presented as completed or measured until verified.


### V3 checkpoint: bounded adversary

Person A implemented four engine disturbances with alternate-route and physical-weight validation. Adversarial runs select only from the engine-validated catalog, preserve explicit initial scenes and complete action recordings, and retain only completed failures as ordinary training shifts for explicit supervisor review. Held-out seeds are rejected, model/runtime errors are not counted as discovered failures, and no brain is promoted automatically. Adversary and post-training worker runs claim the same exclusive inference lock as comparisons. Original V2 snapshots and evidence remain untouched. Engine 12/12 and server 37/37 offline tests pass. Person B's read-only run-library API (`8a292a2`) is integrated as `4224d07`; the full dashboard redesign and post-training backend continue in separate Forge worktrees. Crusoe confirms the GLM-5.3 and Lightning model IDs and accepts read-only fine-tuning API access. No new fine-tuning job has been created yet.


### V3 live verification checkpoint

The actual GLM-5.3 adversary run **`adv-mvd1z8gx-114e18`** completed four Lightning trials on training seed 1 with brain v5: **tried 4, found 3 failures**. The blocked-aisle trial succeeded; misplaced stock, the heavy top-shelf displacement and stock hidden behind a fresh item failed the strict task check. All four have full recorded scenes and actions. The run used **33 model responses, zero local response replays**. Two earlier GLM output-format failures remain recorded honestly with zero attempted scenarios; neither was counted as a discovered robot failure. The successful proposal is an actual bounded tool selection. Original 74-file evidence baseline remains unchanged. A fresh v5 Lightning training shift (`shift-mvd22etr`) is now collecting a clean success for post-training; the misplaced-stock attack's supervisor review is running. These are training-only and separate from all held-out evaluations. No model-weight improvement is claimed.


The fresh training source completed: **`shift-mvd22etr` / `trial-mvd22etu-1`**, v5, seed 1, PICK A-1-3-1 (3.98 kg Orange), **1/1 strict success, 7 actions, 7 model responses, zero refusals and response replays**. The adversarial review finished with an actual DeepSeek verdict: I2 kept, F1 and I1 dropped, and U1 marked unsupported; the gate correctly remains unavailable for that update. All five V3 recordings reconstruct their exact initial and final worlds (35 physical action records). Crusoe's fine-tuning registry exposes the 30B BF16 Nemotron under a legacy Nano name; NVIDIA's official Nano BF16 URL redirects to Lightning BF16. The actual registry ID and descriptor will be preserved in the job record. An explicit local registry-model setting is configured; credentials remain private and the environment file is ignored. Hugging Face publication is optional and currently unconfigured; local dataset exports must remain downloadable.


The user additionally requested a separate submission-video subagent on Prithvi's machine. A third Forge worker now owns a one-minute, 16:9 actual-dashboard walkthrough in an isolated temporary video project. It will coordinate with the UI and post-training workers, capture only actual recorded runs and true provider status, and produce an MP4 plus transcript and verification. It has no model quota and will not submit or publish the video. Existing source ownership and evidence preservation remain in force.


### UI release boundary: V2 only

The user clarified that the redesigned dashboard must depend **only on completed V2**, while V3 is developed separately. This supersedes the earlier request to wire V3 controls into the current redesign. Person B has been explicitly redirected: release Live trial / Previous results / Development, with Launch → Robots at work → Review, using V2 APIs, graph exploration, read-only saved reviews and actual recorded comparisons. No adversary/post-training probes or controls in the V2 release; those buttons remain disabled as V3 roadmap items. Filter V3 attack and post-training records out of the V2 results browser. The submission video must capture this completed V2 UI; unfinished V3 features must not delay or appear as shipped. The dashboard redesign is **not live yet**; the user has been told that integration and main publication are still pending. V3 backend work continues independently.


### V2 dashboard redesign completed

Person B delivered **`d901b4b`**, integrated as **`a073f91`**. The V2 dashboard now has Live trial / Previous results / Development, with Launch → Robots at work → Review in both live and saved workflows. Saved runs show actual camera playback or legacy action logs, recorded graph-read pulses, exact-step navigation, saved judge/grounding/graph changes and actual Crusoe metrics links. The original score-only gate remains separate from fresh replayable comparisons. V3 controls and API probes are absent; V3-generated records are filtered out of this V2 library. README setup now explains first launch, the three tabs, runtime-data limits and troubleshooting.

Per the user's explicit instruction, the UI test suite was skipped. Person B and Person A each verified the production build. Person A inspected the actual dashboard in Orca: all three tabs render, matched playback advances its recorded timeline with two robot cameras and graph reads, and the original saved review shows its actual 2-kept/1-dropped judge result. Saved browsing made **zero legacy review calls and zero V3 API calls**, with no UI alerts. Two final labels distinguish a completed saved shift from live inference and identify the historical gate's base accurately. Main publication follows the whole-file credential/reference scan. V3 backend and the separate video worker continue independently; neither blocks this V2 release.


### V3 paused; V2 provider-records correction

The user explicitly stopped V3 and made the V2 UI the priority. The goal is paused, the owned Forge V3 backend and preview workers were stopped, and unpublished integration work is preserved on `person-a/v3-posttraining-wip` with a named stash. No new fine-tuning job was launched. The separate V2 video remains authorized.

The user's `shift-mvd22etr` provider link opened Crusoe's unfiltered project metrics page, which defaulted to DeepSeek. Inspection of the current console shows that its model and custom time selectors are local page state, not URL filters. The V2 UI now opens a recorded-usage panel first: this shift has **7 model responses, 17,261 prompt tokens, 180 output tokens, zero local response replays**, and unavailable prefix-cache usage is labeled not reported. It identifies Lightning, the actual run timestamps and a copyable padded UTC range, with a separate honestly labeled project-metrics link and a saved run record link. Compiled runs state that they made no inference calls. The same correction applies to comparisons. V3 remains hidden and paused. Verification is limited to the production build and an actual browser check of this shift's panel; no UI test suite or model calls.


### V2 submission video delivered

The Forge video worker captured all seven actual V2 dashboard clips, then stopped at its session usage limit before final export. Person A completed asset assembly, documented the intentional chapter-label layering, passed HyperFrames checks with zero errors and rendered the full 60-second 1920×1080, 30 fps H.264 MP4. The complete video decoded successfully, section frames were visually inspected, and the local copy matches the remote SHA-256: `d87990c89a877bbf404d866a9f5e0cdcb3aeacc8500d5bc801d289124ee272d6`.

Delivery is outside Git in `AutoRoboHarness-submission/AutoRoboHarness-V2-submission.mp4`, with English captions burned in, matching SRT, a contact sheet and verification metadata. It is silent. Footage comes from V2 main `7ed4828`, with the original score-only gate and separate fresh recorded comparison explicitly distinguished. No video was submitted or publicly uploaded. V3 remains paused.


### Autonomous improvement preflight stopped before inference

The user authorized a separate improvement-cycle subagent. It locked the second held-out set (111–130) against the unchanged v5 snapshot and prepared a stricter dual-set Lightning gate in an isolated checkout, with targeted promotion/isolation checks passing. The baseline has **not** been scored. Forge explicitly reported that mutual exclusion is not established across all active agents and the demo API, so the subagent stopped under the requested stop-if-human-fix condition. There were **zero model calls, zero completed cycles and zero brain mutations**. The locked manifest and runner remain outside the served checkout. Active Forge agents must agree to the shared lock before this loop can start; no cycle result was fabricated.

### V2 visual brain evolution

Previous results → Explore → Brain versions now opens a visual map of every saved version together. Directed connections follow actual snapshot parents: v2 and v3 are rejected branches from v1, while the live ancestry is **v1 → v4 → v5**. Per-version cards show the actual added knowledge and parent-relative node/link deltas. The current live ancestry adds **8 nodes and 10 links** (44 → 52 nodes); a zoomable change graph colors inherited v1 knowledge and additions from v4 and v5, with the complete graph and exact node/edge/property inspection available. Natural-language lesson cards show torso positioning, its procedure step and supporting evidence, then grasp-by-weight and its evidence. All values come from saved snapshots.

Evaluation tables and the detailed two-version comparison remain available in a collapsed section, keeping different evaluation sets separate. The dashboard loads new saved versions dynamically. The production build and actual desktop/mobile browser checks pass: five visible version cards, correct rejected branches, zoom, node property/source-version inspection, full 52-node graph and no page overflow at 390 pixels. All 74 existing brain/evidence hashes match the prior baseline. No model calls, brain changes, or demo-service restarts were needed.
