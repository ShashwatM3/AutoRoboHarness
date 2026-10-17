# Build Plan: Feature Sequence per Version, with Owners

Build window: **1:10 PM to 4:00 PM**. Person A owns everything the user sees and the simulator; Person B owns the brain, the agents, and the supervisor. The two meet at three contracts, written first.

## The code layout

| Folder | What lives there | Owner |
|---|---|---|
| `engine/` | the store engine in TypeScript, with no DOM code, so it runs in Node and in the browser | A |
| `server/` | a Node and Express server: brain API, shift runner, worker agents, supervisor, gate, and a server-sent event stream of everything that happens | B |
| `web/` | Vite, React, and Three.js: launch screen, live view, review screen | A |
| `brain/` | `v1.json`, `v2.json`, and so on | B |
| `ground_truth/` | RetailAction clips, extracted frames, `library.json`, and the Standard AI license and notice | B |

## The three contracts (1:10 to 1:20, both people, together)

| Contract | Fields | Written by |
|---|---|---|
| **Engine action API** | `navigate_to(robot, waypoint)`, `set_torso(robot, level)`, `scan_slot(robot, slot)`, `reach(robot, slot)`, `grasp(robot, mode)`, `place(robot, target)`, `retract(robot)`, `report_issue(robot, kind, detail)`; each returns `{ok, reason, state}` | A |
| **Trajectory step** | `t, robot, task_id, step, brain_nodes_read, action, args, ok, reason, position, holding, item_location, target_location` | A |
| **Brain node, edge, and operation** | node `{id, type, label, props}`, edge `{from, to, type}`, operation `{op: add_node or add_edge or set_prop or retire_node, ...}` | B |

---

## Version 1: The Closed Loop (1:20 to 3:00)

Trunk order: engine, then worker loop, then supervisor, then Update Brain with the re-run. Each person's list runs top to bottom.

| Time | Person A | Person B |
|---|---|---|
| 1:20 to 1:50 | **A1.** Engine core: store layout (backroom, aisles A and B, bays, levels 1 to 4, slots), items with weights, seed-based scenario generator, the action functions with physical feasibility, the trajectory writer | **B1.** Brain server: load `brain/vN.json` into `graphology`; `GET /brain?scope=` returns the scope path's nodes; `POST /brain/apply` writes the next version; `GET /brain/diff`. Write the day-one `brain/v1.json` |
| 1:50 to 2:15 | **A2.** Web live view: Three.js store from Kenney Mini Market and Food Kit; the robot from simple shapes; animations for drive, torso, reach, grasp, place, driven by the server's event stream | **B2.** Worker agent loop on Lightning: reads its brain scope, then calls the engine actions as tools until the task ends; two robots in parallel; streams events to the web view |
| 2:15 to 2:40 | **A3.** Live view panels: per-robot stats and the brain graph with nodes lighting up when read (data from B1); the launch screen (robots, tasks, seed) | **B3.** Supervisor on Nemotron 3.5 Super VL: reads trajectories, the brain nodes in effect, sibling runs, and the RetailAction library; returns failures, insights with grounding, and brain operations as JSON |
| 2:40 to 3:00 | **A4.** Review screen: failures with step numbers that jump the 3D view to that step, insights with their grounding (frames or two runs), updates as English and as a code block, and the Update Brain button with the before-and-after graph | **B4.** The gate: re-run the tasks on held-out seeds 101 to 110 with the old and the new brain, headless, and return both scores; Update Brain keeps the new version only if the score rises |

**Version 1 is done when** a launched shift produces at least one real failure, the supervisor proposes a fix, and Update Brain shows a higher held-out score.

---

## Version 2: Grounded, Verified, Governed (3:00 to 3:40, only if Version 1 is done)

Pick from the top down; stop when time runs out.

| Order | Person A | Person B |
|---|---|---|
| 1 | **A5.** Worker views: one camera tile per robot from a camera attached to the robot's head, with its task and step list | **B5.** Judge on DeepSeek V4 Pro: confirms every failure points to a real step and every insight to real evidence; the review screen shows kept and dropped counts |
| 2 | **A6.** Shoppers walking seeded paths (Kenney Mini Characters), and a third and fourth robot | **B6.** Cache number: read `cached_tokens` from each worker call and show the share of brain tokens served from Crusoe's cache |
| 3 | **A7.** History chart of the held-out score per brain version | **B7.** You.com Research as a supervisor tool, with citations shown in insights |

OpenShell (locked seeds and guardrail approval) is a Version 2 item, but its Docker setup is the riskiest step here, so it is attempted only if someone is idle.

---

## Version 3: The Full Harness (only if time remains)

| Order | Owner | Feature |
|---|---|---|
| 1 | B | **Run post-training:** export passing steps as chat JSONL, upload to Crusoe Files, create a small Lightning fine-tuning job, show its status and loss |
| 2 | B | Push a LeRobot-style copy of the dataset to the Hugging Face Hub |
| 3 | A | **Adversarial attack** button: the adversary picks disturbances from a fixed realistic list and keeps the ones that break the current brain |

---

## The last 20 minutes (3:40 to 4:00, both people)

- Freeze features; fix only what breaks the demo path.
- Record the one-minute submission video of the Version 1 loop.
- Write a README section titled "Built during the event" that lists our code and names every open-source dependency and dataset with its license.
- Confirm the repository is public and the `.env` file is not committed.
