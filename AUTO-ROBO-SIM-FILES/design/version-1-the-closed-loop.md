# Version 1: The Closed Loop

**Target:** working end to end by about 1:30 PM on build day
**What it proves:** a fleet of robots gets measurably better at its tasks between two runs, because a supervisor learned something and rewrote their shared brain
**What comes next:** Version 2 makes the same loop grounded, verified, and governed; Version 3 adds post-training and the adversary

---

## Why there are three versions

The full workflow you wrote is the end state, and building it in one pass risks ending the day with an unfinished product. Each version below is a complete, demoable product on its own, and each one is the previous version with more depth, so that whenever time runs out, the team has the most recent finished version rather than an unfinished final one. Version 1 is the smallest product that still answers the Version N+1 problem statement completely: robots work, a supervisor reviews, the brain changes, and a re-run on tasks nobody trained on shows a better score.

---

## The foundation this version locks in

The foundation is the part you asked to keep under 30% of the team's concern, so Version 1 settles all of it at once and the later versions only grow it. Five things have to be decided together, not two. Your two pairs, the human footage with the tasks and the simulator with the robot form, are the first four, and the fifth is the **failure model**, which is how a deterministic simulator produces failures that a change to the brain can actually fix. Two smaller items come with it: the **day-one brain**, which must be deliberately incomplete so there is something to learn, and the **seeds**, which decide what counts as training and what counts as unseen.

### The workspace and the tasks

The workspace is one wing of a convenience store: a backroom where stock arrives in totes, and two aisles of shelving with four shelf levels each. A convenience store is the choice because RetailAction, the human footage we found, shows real people in exactly this kind of space doing exactly these tasks (section "The ground truth" below).

Version 1 has two task types, and each one is built from simple actions but contains real decisions:

| Task | What the robot does | The decisions that need intelligence |
|---|---|---|
| **PICK** | takes an item for an online order from its slot and puts it in a tote | which grasp to use for the item's weight, how high to raise the torso for the shelf level, whether to check the slot first, what to do if the slot holds the wrong item |
| **RESTOCK** | carries an item from the backroom tote and places it in its slot | the same grasp and height decisions, plus whether older stock is already in the slot |

### The robot

The robot is PAL Robotics' TIAGo, a wheeled base with a vertical torso lift, one seven-joint arm, and a two-finger gripper. It is the right amount of robot for this project: the torso lift gives visible up-and-down motion that changes with the shelf level, the arm gives a clear reach-and-grasp moment, and the wheels avoid any walking or balance problem. The model comes from Google DeepMind's MuJoCo Menagerie (`pal_tiago`, Apache 2.0), published as one ready-made model file, with named joints such as `torso_lift_joint` and `arm_1_joint` to `arm_7_joint`, and a `head_camera` that Version 2 uses for the robot's own view.

### The simulator: an integration of two pieces

The simulator is two pieces with one shared state, which is the "smart integration of two" your perspective asked about.

| Piece | What it is | Why it exists |
|---|---|---|
| **The store engine** | our own TypeScript program with a fixed time step, a map of waypoints, shelf slots, items (each with weight and position), and a seeded outcome model | it runs without any graphics, in the browser or in Node, so the gate can re-run many shifts in seconds; it is the single source of truth for what happened |
| **The 3D view** | Three.js in the browser, with TIAGo loaded through MuJoCo's official WebAssembly package (`@mujoco/mujoco`, version 3.16.0, Apache 2.0) and the store built from Kenney's CC0 Mini Market and Food Kit packs | it draws whatever the engine says is happening; MuJoCo only computes where TIAGo's links are for a given set of joint angles, so there is no contact physics to debug |

Every robot action is a plain JavaScript function call on the engine. The 3D view then animates the move: the base drives along waypoints, the torso rises to the stored height for the shelf level, the arm moves through a few stored poses, and the item attaches to the gripper. One known risk is visual: Kenney's assets are low-poly and stylized while TIAGo's meshes are detailed, so the team should decide early whether the mix looks intentional.

### The failure model

A deterministic simulator only produces interesting failures if its rules connect actions to outcomes in ways the brain can learn. Version 1 has three such rules, each seeded so the same seed always gives the same result:

| Failure | When the engine produces it | What a better brain would do |
|---|---|---|
| **ITEM_DROPPED** | the item weighs more than the gripper's one-hand limit and the robot used a one-hand grasp | use a two-hand grasp above a weight threshold |
| **OVERREACH** | the torso is lower than the shelf level requires, so the reach fails and the robot must retry, losing time | set the torso height by shelf level before reaching |
| **WRONG_SLOT** | the seed has placed a different item in the target slot, and the robot took it without checking | check the slot before acting, and report a mismatch instead of taking the wrong item |

Each failure is also a check in the task's **definition of done**, which is the list of conditions that must all be true for the task to count as complete: the right item ended in the right place, nothing was dropped, and it finished within its time limit.

### The day-one brain and the seeds

The day-one brain is version 1 of the knowledge graph, and it is written to look like a new employee's first-day instructions: correct as far as it goes, but missing the experience that the failures expose. It has the scope tree (store, backroom, aisles, bays, shelf levels, slots), a procedure for each task without a slot-check step, one speed guardrail, and a handful of rules, but no grasp rule by weight and no torso rule by shelf level. Seeds 1 to 20 are training seeds the supervisor may see, and seeds 101 to 110 are held-out seeds used only by the gate.

### The ground truth

The human reference is RetailAction, released by Standard AI for the ICCV 2025 Retail Vision Workshop: 21,000 clips of real shoppers in 10 US convenience stores, filmed from two ceiling cameras and labelled "take," "put," or "touch" at the moment of contact. Each clip is at most 32 frames, which suits Nemotron 3 Nano Omni on Crusoe, because Crusoe documents image input for it and the supervisor can send a handful of frames per clip. At the start of the build, the team pulls a small set of clips through the Voxel51 copy on Hugging Face and picks roughly twenty that show the habits our failures need: two-handed lifts, reaches to top and bottom shelves, and touches before takes. The license allows this use with credit to Standard Cognition, a copy of the license, and a notice file.

The second reference is our own runs. When the same task succeeds under one seed and fails under a nearly identical one, the difference between the two trajectories is exact evidence of what mattered, and the supervisor can use it without any outside data.

---

## The workflow in Version 1

### Stage 1: the user launches the robots

The user lands on the launch screen, chooses two robots, and gives each one a task from the catalog, such as "PICK cereal box from aisle A, bay 3, level 4" or "RESTOCK juice to aisle B, bay 1, level 1," and picks a training seed. Pressing Launch starts the shift in the store engine and opens the live view.

### Stage 2: the user watches the robots work

The user lands on the live view, which is the 3D store from above with both robots moving, a small statistics panel per robot (current task, step number, checks passed so far), and the brain drawn as a graph in a side panel.

Each robot is a worker agent running on **Nemotron 3.5 Lightning through Crusoe Managed Inference**. When a task starts, the worker reads its part of the brain by scope: everything attached to its slot, and everything attached to each scope above the slot, with the deeper node winning when two disagree. Each node it reads pulses on the graph panel. Then, step by step, the worker chooses its next action and that action's parameters, the engine executes it, and the result comes back as the worker's next observation.

| Worker tools | What they do |
|---|---|
| `navigate_to(waypoint)` | drive to a point in the store |
| `set_torso(level)` | raise or lower the torso to a shelf level's height |
| `scan_slot(slot)` | look at what is currently in a slot |
| `reach(slot)`, `retract()` | move the arm to the slot and back |
| `grasp(mode)` | close the gripper with `one_hand` or `two_hand` |
| `place(target)` | put the held item in a slot or tote |
| `report_issue(kind, detail)` | flag a problem, such as a mismatched slot |
| `read_brain(scope)` | read the brain nodes for a scope |

The guardrail in the brain is not only text the worker reads. It compiles into the engine's action checker, so a move that breaks the speed limit is refused by the engine even if the model ignores the rule.

### Stage 3: the shift becomes trajectories

Every step is written to a trajectory log, one line per step, with the time, the robot, the task, the step number, the brain nodes read, the action and its parameters, the result, and any check that passed or failed. When both robots finish, the engine evaluates each task's definition of done and records the final pass or fail with the reason.

### Stage 4: the supervisor reviews the shift

The supervisor is an agent on **Nemotron 3 Super through Crusoe**, running a tool-calling loop over the log. Its default path is to list the failed checks, read the steps around each failure, read the brain nodes that were in effect, look for a sibling run where the same task succeeded under a different seed, and pull RetailAction clips whose action and shelf height match the failure, asking **Nemotron 3 Nano Omni** what the person did with their hands and body. It writes three outputs:

| Output | Contents |
|---|---|
| **Failures** | robot, task, step number, the failed check, and the brain nodes in effect |
| **Insights** | the lesson, plus its grounding: the clip and frames, or the two contrasting runs |
| **Brain updates** | each change in plain English, and the same change as typed graph operations such as `add_rule`, `insert_step`, and `set_parameter` |

### Stage 5: the user reviews and updates the brain

The user lands on the review screen. Each failure shows its step number, and clicking it jumps the 3D view to that moment of the shift. Each insight shows its grounding inline: the human clip frames, or the two runs side by side. The brain updates show in plain English above a code block of the typed operations.

The **Update Brain** button is the payoff of Version 1. It applies the operations to a candidate brain version, draws the graph before and after with added nodes in green and retired nodes faded, and then runs the gate: the store engine re-runs the same tasks on held-out seeds 101 to 110 with the old brain and with the candidate brain, headless and in parallel, and shows the two scores side by side. The candidate becomes the live brain only if the score rises. The **Run post-training** and **Adversarial attack** buttons appear on the screen but are marked as coming in Version 3.

---

## Sponsors in Version 1

| Where | Sponsor tool | Exact feature and role |
|---|---|---|
| Stage 2 | Crusoe Managed Inference | Nemotron 3.5 Lightning runs every worker decision |
| Stage 4 | Crusoe Managed Inference | Nemotron 3 Super runs the supervisor |
| Stage 4 | Crusoe Managed Inference | Nemotron 3 Nano Omni reads the human clip frames |
| Stage 5 | Crusoe Managed Inference | the gate's re-runs drive many worker calls in parallel, which needs a payment method on file for 600 requests per minute per model |

Version 1 uses three Nemotron models in three distinct roles, which already gives the Best Use of Nemotron story its shape. It does not yet use OpenShell or You.com.

---

## How Version 1 scores, honestly

| Criterion | Where Version 1 earns it | Where it is still thin |
|---|---|---|
| **Technicality (40%)** | a deterministic engine joined to a 3D view, typed graph operations, a held-out gate, and an agent team on three models | no independent verification yet, so a judge could ask how we know the insights are true |
| **Live Demo (20%)** | a complete loop on screen: robots fail, the brain changes, the score rises | two robots and two aisles look small |
| **Creativity (25%)** | real human footage becomes a rule in a robot's brain | the brain is still fairly small |
| **Future Potential (15%)** | robots that learn a new workspace from footage of people working there | no governance story yet |

**Track fit.** Version 1 answers **Version N+1** completely: after each run the team reviews what worked, rewrites its playbook (the brain), keeps the change only if it measurably helps, and proves it with a before-and-after score on held-out seeds. It also touches **Shared Brain**, because every worker reads one shared brain before it acts.

---

## If we had to stop at Version 1: the three-minute demo

1. **0:00 to 0:20.** The problem: robots arriving in a new store are as clumsy on day 30 as on day one, because nothing turns their mistakes into knowledge.
2. **0:20 to 1:00.** Launch two robots and watch them work; brain nodes pulse as they read; one drops a heavy box and one takes from the wrong slot.
3. **1:00 to 1:45.** The review screen: the drop at step 14, grounded in a real shopper lifting a heavy item with two hands, and the wrong slot grounded in a sibling run that checked first; the proposed brain changes in English and as operations.
4. **1:45 to 2:40.** Update Brain: the graph before and after, then the gate on ten unseen seeds, with the score rising.
5. **2:40 to 3:00.** Built on Crusoe with three Nemotron models; the next steps are verification and governance.

---

## What Version 1 leaves for Version 2

Version 1 deliberately leaves out shoppers, the robots' own camera views, an independent judge, cited store practice, OpenShell, and a larger brain. Each of those makes the same loop more trustworthy or more impressive, and none of them changes its shape, which is why they come next.
