# Iteration 03: Your Workflow, End to End
October 17, 2026

## What this document covers

This iteration takes the five-stage workflow you wrote and fleshes out each stage: what happens, which entity does it, its inputs and outputs, and which sponsor tool it uses and how. Each topic appears in exactly one section, and every open variable and decision is collected in the last section only.

---

## 1. Your workflow, and the three things I would add

Your workflow is sound, and it already answers the hardest design question, which is what the supervisor actually does. The pipeline below is your five stages in order, with my three additions marked with a plus sign.

```
  STAGE 1  Launch          user picks how many robots and which task each one does
  STAGE 2  Live shift      robots work in the simulated store, reading the brain before each decision; nodes light up
         + every task carries pass-or-fail checks (its definition of done), recorded as it runs
  STAGE 3  Trajectories    every tool call, physical move, and check result is stored per robot
  STAGE 4  Harness review  the supervisor produces FAILURES, INSIGHTS, and proposed BRAIN UPDATES
         + an independent judge model confirms every failure and insight points to real evidence
  STAGE 5  Review screen   failures with step numbers, insights with their grounding, updates in plain English and as tool calls
           [Update Brain]   applies the updates and shows the brain before and after
         + then re-runs the same tasks and unseen tasks with the old and new brain, and keeps the update only if the score rises
           [Run post-training]  builds the dataset, publishes it, and creates the Crusoe fine-tuning job
           [Adversarial attack] to be designed after the rest is wired
```

The re-run after Update Brain is the most important addition. The Version N+1 problem statement asks for a team that "keeps a change only if it measurably helps" and proves it "with a before-and-after score on tasks it hasn't seen," and a before-and-after picture of the graph alone shows that the brain changed, not that it improved. One item from earlier rounds has also disappeared from your workflow: the supervisor phoning the human. In your version the human's role is the review screen and its buttons, which may be the better design, and I list it as a decision at the end rather than assume.

---

## 2. Workspace, tasks, robot, and ground truth, decided together

You were right that these four cannot be chosen separately, because human footage is only useful as ground truth when it shows the same workspace and the same tasks the robots perform. I checked the footage options against that test, and only one dataset shows real people doing our tasks in a single, buildable kind of space: RetailAction, released by Standard AI for the ICCV 2025 Retail Vision Workshop. It contains 21,000 samples, about 41 hours, of real shoppers in 10 US convenience stores, each filmed by two synchronized ceiling cameras and labelled "take," "put," or "touch" at the exact moment and point of contact. NVIDIA's SDG-Warehouse, by contrast, is synthetic and only its box-pickup scenario matches a task, and SmartSpaces is synthetic tracking of people walking, not handling products.

My recommendation is therefore a convenience store as the workspace, TIAGo as the robot, and store-associate tasks that mirror what RetailAction shows. The robot picks items for online orders (the shoppers' "take"), restocks shelves from the backroom and returns misplaced items (the "put"), and checks a shelf slot before acting (the "touch"), at shelf levels 1 to 4, while real-looking shoppers move through the aisles. TIAGo fits this naturally, because its torso lift sets the reach height for each shelf level and it is a mobile manipulator built for indoor spaces.

```
  Option               Ground truth                      Fit with our tasks                    Weakness
  Convenience store    RetailAction (real, ceiling cams)  take, put, touch at shelves: direct   97.2% of labels are "take"; put and touch are rare
  Warehouse            SDG-Warehouse (synthetic)          box pickup only                       synthetic people follow scripted animations
  Factory              no matching dataset found          none                                  no ground truth
```

---

## 3. Ground truth: what the supervisor actually compares against

The root problem, stated plainly, is that the supervisor needs two things: proof that something went wrong, and a reference for what better behavior looks like. The pass-or-fail checks in section 6 supply the first without any data. For the second, an earlier idea was an oracle planner inside the simulator, but it was being fitted in rather than solving the root problem, so it is dropped as a ground-truth source. The reference now comes from three places, and each one is real evidence rather than a planner we wrote.

```
  Source                    What it gives the supervisor                                  Sponsor
  RetailAction clips        how real people take, put, and check items at each shelf      read by Nemotron 3 Nano Omni on Crusoe
                            height, and with one or two hands
  Contrast within our runs  the same task in nearly the same situation, succeeding in      none; our own trajectory log
                            one run and failing in another, so the difference is exact
  Published practice        cited store procedures such as FIFO rotation and planogram     You.com Research API
                            compliance
```

The contrast source is new and it replaces the oracle's useful part without its ceiling. The task scaler from the post-training lever already produces variants of each task, so the supervisor can compare a failed attempt with a successful sibling and name the single condition that differed, which is evidence the system generates itself. RetailAction also suits the vision model well: each clip has at most 32 frames, and Crusoe's Omni accepts images as standard image parts while its video format is undocumented, so the supervisor sends a handful of frames per clip. On your note about stock clips, I meant downloading free stock video from libraries such as Pixabay, never filming, and with RetailAction that is no longer needed.

The dataset's license, the Standard.AI Dataset License, allows use and derivative works with three duties: credit Standard Cognition, include the license, and keep a notice file, and it requires a separate license only if revenue from the product exceeds $10,000. The test split is 3.84 GB, and the Voxel51 copy on Hugging Face can be loaded with a sample limit, so the team can pull a few hundred clips rather than the whole set.

---

## 4. The simulator: JavaScript you can command

The requirement is a simulator the team can command from plain JavaScript, and the recommended stack is exactly that. The scene is Three.js in the browser, and each robot is the TIAGo model from Google DeepMind's MuJoCo Menagerie, which is published as a single model file with STL meshes under Apache 2.0, so no ROS xacro processing is needed. MuJoCo's official WebAssembly package, @mujoco/mujoco (version 3.16.0 on npm, Apache 2.0, updated October 14), loads that file in the page, our code sets joint positions such as torso_lift_joint and arm_1_joint to arm_7_joint, and the computed link positions are copied to the Three.js meshes. Every robot action is therefore an ordinary JavaScript function call, and the model includes a head_camera, which gives each robot its on-board view for the worker tiles.

Physics stays simple on purpose, following the simulation report's rule to fake low-value physics while keeping task outcomes real. The robot drives along waypoints, its torso and arm move through a few stored poses per shelf level, the item attaches to the gripper, and a seeded outcome model decides results such as a drop when a heavy item is held one-handed, so every failure is deterministic and replayable. Shoppers are simple walking figures on seeded paths, and each seed fixes item weights, shopper routes, and stock positions, which is what makes held-out seeds meaningful. NVIDIA's SimReady warehouse assets are OpenUSD files built for Isaac Sim, and a convenience store does not need them, so I am not pursuing the conversion; the store is built from free CC0 shelving and product models, whose exact source is still to be chosen.

---

## 5. The brain: a hierarchical knowledge graph worth showing

A brain that is only a tree of places (site, zones, tasks) with a few settings hanging off it looks simple. A store's real operating knowledge has more kinds of things in it, and giving each kind its own node type is what makes the graph both richer and genuinely useful to the robots. The schema below keeps the scope tree but adds five kinds of knowledge and the relationships between them.

```
  Scope tree      Store > Zone (backroom, aisles, checkout, entrance) > Aisle > Bay > Shelf level > Slot
  Knowledge       PROCEDURE   ordered steps for a task, e.g. RESTOCK: check slot, rotate old stock forward, place new behind, face labels
                  RULE        conditional guidance, e.g. items over 2 kg use a two-handed grasp
                  GUARDRAIL   a hard limit the environment enforces, e.g. 0.3 m/s when a shopper is within 1 m; changing one needs approval
                  PROTOCOL    coordination between agents, e.g. one robot per aisle segment; shoppers always have right of way
                  EVIDENCE    why a node exists: a clip and frame, a run contrast, or a citation
  Relationships   APPLIES_TO (knowledge to scope), STEP_OF and NEXT (procedure order), OVERRIDES (a deeper scope wins),
                  CONFLICTS_WITH (flagged for the supervisor), SUPPORTED_BY (knowledge to evidence), REPLACES (version lineage)
```

A robot reads the brain by scope: before a task in aisle 3, level 4, it receives every procedure, rule, guardrail, and protocol attached to that slot and to each scope above it, with deeper nodes overriding shallower ones, and each of those nodes lights up on screen. Guardrails are not just text the model reads; they compile into the simulator's action checker, so a guardrail is enforced even if the model ignores it, which is also where OpenShell's approval comes in when one changes. The supervisor's brain updates are typed operations, such as add_rule, set_parameter, insert_step, reorder_steps, add_protocol, retire_node, and link_evidence, which is what the code block on the review screen shows.

---

## 6. Stages 1 to 3: launching, running, and recording a shift

On the launch screen the user chooses one to four robots and gives each a task from the catalog, which is a task type (PICK, RESTOCK, RETURN, or CHECK) at a specific slot, plus a seed. During the shift each robot is a worker agent running on Nemotron 3.5 Lightning through Crusoe. At the start of a task it reads its scope from the brain, then at each step it chooses the next action and its parameters, and the simulator executes it and reports the result.

```
  Worker actions    navigate_to, set_torso_height, reach, grasp(one_hand or two_hand), place, scan_slot, wait, yield_to, report_issue
  Information tools read_brain(scope), read_procedure(task)
  Logged per step   time, robot, task, step number, brain nodes read, action and parameters, result, check events, camera frame ID
```

Failures become identifiable because every task type carries its definition of done, and each check is computed by the simulator rather than judged by a model. Each failure type also has a matching human habit in RetailAction, so the supervisor always has somewhere to look.

```
  Check that fails      Typical cause                               Brain fix                              Human evidence
  ITEM_DROPPED          heavy item held one-handed                  rule: two-handed grasp above a weight  take clips with two hands
  OVERREACH             torso too low for the shelf level           rule: torso height per shelf level     reaches to top and bottom shelves
  WRONG_SLOT            slot not checked before acting              procedure: insert scan_slot step       "touch" clips before a take
  SHOPPER_CONFLICT      entered or blocked an aisle with a shopper  protocol: wait at aisle end            shoppers pausing at aisle ends
  STOCK_NOT_ROTATED     new stock placed in front of old            procedure: rotate old stock forward    published FIFO practice (You.com)
  LATE                  waiting behind another robot                protocol: one robot per aisle segment  run contrast
```

---

## 7. Stage 4: how the harness reviews a shift

The supervisor runs on Nemotron 3 Super through Crusoe, or Nemotron 3 Ultra if our project can call it, as a tool-calling loop over the trajectory log. It starts from the failed checks, reads the steps around each failure and the brain nodes that were in effect, looks for a successful sibling run of the same task, retrieves RetailAction clips with the matching action and shelf level and asks Omni what the person did, and calls You.com Research when a store practice is involved. It then writes three outputs.

```
  FAILURES       robot, task, step number, failed check, brain nodes in effect, cause
  INSIGHTS       the claim, plus its grounding: clip ID and frames, the contrasting run, or a citation
  BRAIN UPDATES  each change in plain English, and the same change as typed operations
```

Before anything reaches the screen, a judge from a different model family, DeepSeek V4 Pro on Crusoe, checks that every failure points to a real step and every insight to real evidence, and it drops what it cannot confirm. This is the independent verification that MasteryWrite, PRAETOR, and SOC claw used to win, and it keeps the supervisor from presenting a confident but unsupported insight.

---

## 8. Stage 5: the review screen and its three buttons

The screen shows the three outputs from Stage 4. A failure links to its step, so clicking it replays that moment in the robot's camera tile, and an insight shows its grounding inline: the clip frames, the two contrasting runs side by side, or the citation. The brain updates show as plain English above a code block of the typed operations.

Update Brain applies the operations to a candidate version, draws the graph before and after with added, changed, and retired nodes marked, then re-runs the shift's tasks and a set of unseen tasks from locked seeds with both versions and shows the two scores. The candidate becomes the live brain only if the score rises without any new guardrail violation, and an operation that changes a guardrail is held for the user's approval through OpenShell before it applies. The locked seeds live in a folder the supervisor's sandbox cannot read, which OpenShell enforces at the kernel level.

Run post-training builds a dataset from the steps of tasks that passed every check, uses the task scaler to create three or four variants of each successful task, runs them with the current brain, and keeps only the variants that pass. It then pushes a LeRobot-style copy to the Hugging Face Hub and uploads a chat-format copy to Crusoe. On your note about only showing a job: Crusoe has no documented draft state, so creating a job launches it, but a small dataset costs cents at $0.40 per million tokens, the console shows live loss, an ETA, and checkpoints, and a cancel endpoint exists. Showing the running job and its loss curve therefore costs almost nothing, and skipping the deployment avoids its 40-minute provisioning time.

The adversarial attack button is left open, as you asked.

---

## 9. Where each sponsor sits

```
  Stage   Entity                Sponsor tool and feature                                  Input -> output
  2       Worker agents         Crusoe: Nemotron 3.5 Lightning                            brain scope + observation -> next action
  2       Shared brain          Crusoe MemoryAlloy: the brain sent as an identical         brain text -> cached_tokens per call,
                                prefix, so cached_tokens and the cache hit rate show it    shown as a live dashboard number
  4       Supervisor            Crusoe: Nemotron 3 Super or Ultra                         trajectory log -> failures, insights, updates
  4       Clip reader           Crusoe: Nemotron 3 Nano Omni with image input             clip frames + question -> described habit
  4       Practice lookup       You.com Research API                                      question -> cited answer
  4       Judge                 Crusoe: DeepSeek V4 Pro                                   claims + evidence -> confirmed or dropped
  5       Locked seeds          NVIDIA OpenShell filesystem policy                        supervisor sandbox -> no read access
  5       Guardrail approval    NVIDIA OpenShell network rule + Policy Advisor            blocked request -> human approves or rejects
  5       Dataset               Hugging Face Hub (LeRobot-style)                          passing steps -> public dataset
  5       Fine-tuning           Crusoe Serverless Fine-Tuning on Lightning                chat JSONL -> running job, loss curve
```

This uses Crusoe at every stage for a reason the stage needs, which is the "heavily but logically" you asked for. It uses Nemotron in four roles with a stated reason for each, which is what the Best Use of Nemotron winners did, and it uses OpenShell as a visible boundary on the supervisor, which is what the NemoClaw and OpenShell winners did.

---

## 10. Current variables and open decisions


**Workflow**

- Do we add the re-run and score after Update Brain, so a change is kept only if it measurably helps (section 1, section 8)?
  - Your notes:
- Is the phone call with the human dropped, with the review screen as the human's role, or does a "talk to the supervisor" option stay (section 1)?
  - Your notes:
- Which problem statement do we lead with: Version N+1, which the re-run answers directly, with Shared Brain as supporting?
  - Your notes:

**Workspace and ground truth**

- Do we commit to a convenience store, TIAGo, and RetailAction, with tasks PICK, RESTOCK, RETURN, and CHECK (sections 2 and 3)?
  - Your notes:
- Do we accept dropping the oracle and using run contrast, RetailAction, and You.com as the three references (section 3)?
  - Your notes:
- Does RetailAction's mostly "take" labelling leave enough evidence for restocking, or do we lean on run contrast and cited practice for "put" (section 2)?
  - Your notes:

**Simulator and brain**

- Do we build on Three.js with @mujoco/mujoco and the Menagerie TIAGo, with a seeded outcome model instead of real contact physics (section 4)?
  - Your notes:
- Which CC0 store assets do we use for shelving, products, and shoppers (section 4)?
  - Your notes:
- Does the brain schema in section 5 match what you want the graph to show, and which node types are must-haves?
  - Your notes:
- Is the failure table in section 6 the right set of failures to design the tasks around?
  - Your notes:

**Agents and buttons**

- Do workers decide every step, as in section 6, or only at exception points?
  - Your notes:
- Is Nemotron 3 Super enough for the supervisor, or must we confirm Ultra on our Crusoe project first?
  - Your notes:
- Do we create a real but small fine-tuning job and show it running, then cancel or let it finish, as in section 8?
  - Your notes:
- Do guardrail approvals happen in OpenShell's own interface, or do we need them inside our dashboard (section 8)?
  - Your notes:
- When do we design the adversarial attack button?
  - Your notes:

**Before the event**

- Who loads the Menagerie TIAGo in a browser page with @mujoco/mujoco and sets torso_lift_joint, to prove the simulator path?
  - Your notes:
- Who pulls a few hundred RetailAction clips through the Voxel51 copy and sends a few frames to Omni on Crusoe?
  - Your notes:
- Who tests OpenShell on a Mac through Docker Desktop with the Landlock setting at hard_requirement?
  - Your notes:
- Who confirms the model IDs with GET /v1/models and adds a payment method for 600 requests per minute per model?
  - Your notes:
