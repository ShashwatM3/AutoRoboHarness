# Version 1, Person B: The Brain, the Agents, and the Supervisor

You build the Node server that holds the brain, runs the worker agents against Person A's engine, runs the supervisor, and runs the before-and-after gate. All model calls go to Crusoe with the OpenAI SDK.

```
base_url = https://api.inference.crusoecloud.com/v1      (key: CRUSOE_API_KEY in .env)
workers     nvidia/Nemotron-3.5-Lightning-30B-A3B
supervisor  nvidia/NVIDIA-Nemotron-3.5-Super-VL          (fallback: nvidia/NVIDIA-Nemotron-3-Super-120B-A12B)
```

Use `max_tokens` of at least 1024 for reasoning models, retry 429 and 503 errors with exponential backoff, and always append the assistant message with `tool_calls` before the tool results.

## B1. The brain server (1:20 to 1:50) — `server/brain.ts`, `brain/v1.json`

- `npm install express graphology openai dotenv`
- Load `brain/vN.json` (`{ version, nodes, edges }`) into a `graphology` graph.
- `GET /brain` returns the whole graph for the web panel.
- `GET /brain?scope=A-3-4-1` walks from the slot up through level, bay, aisle, and store, and returns every Procedure, Rule, Guardrail, and Protocol attached along the way; a deeper node wins over a shallower one with the same key.
- `POST /brain/apply` takes a list of operations, writes `brain/v(N+1).json`, and never edits an older file.
- `GET /brain/diff?from=1&to=2` returns added, changed, and retired nodes.

**Write `brain/v1.json` by hand, about 40 nodes:** the scope tree; a PICK procedure (navigate, reach, grasp, retract, navigate to tote, place) and a RESTOCK procedure, each as Step nodes linked by NEXT; one Guardrail (maximum speed); and a few Rules. Leave out, on purpose, any rule about grasp mode by weight, any rule about torso height by shelf level, and any "scan the slot first" step.

## B2. The worker agent loop (1:50 to 2:15) — `server/worker.ts`

- `POST /shift` with robots, tasks, and a seed creates the engine scenario (Person A's `createScenario`) and starts one worker per robot in parallel.
- Each worker: read its brain scope, put the brain text at the **start** of the system prompt so it is byte-identical for every robot (this is what lets Crusoe's cache serve it), then loop: call Lightning with the engine actions as tools, execute the chosen tool on the engine, and feed the result back, until the task ends or 30 steps pass.
- Record the brain node IDs each worker read in its steps, and forward every engine step to `GET /events`.

## B3. The footage library and the supervisor (2:15 to 2:40)

**Footage library (do this first, about 15 minutes), `ground_truth/`:**
- Download `samples.json` from the Hugging Face dataset `Voxel51/RetailAction`.
- Pick about 20 samples: mostly `take`, plus every usable `put` and `touch`.
- Download those clip files (each 0.3 to 1 MB, under `data/data_N/`), and check how a sample's `filepath` maps to the file names.
- Extract 4 frames from inside each action's frame range: `ffmpeg -i clip.mp4 -vf "select='between(n,START,END)'" -vsync vfr frame_%d.jpg`.
- Write `ground_truth/library.json` with each clip's ID, action, frame paths, and a description from the supervisor model given the frames as base64 images.
- Add the Standard AI license and a notice file, which its license requires.

**Supervisor, `server/supervisor.ts`:** a tool-calling loop on Super VL with these tools:
- `list_steps(shift_id, robot)` and `get_step(shift_id, robot, step)`
- `get_brain_nodes(ids)`
- `find_sibling_runs(task_type)` to compare with runs of the same task that went better
- `get_human_clips(action)` returning frames from the library, which Super VL can look at directly

It returns `{ failures, insights, updates }`: each failure with robot, step, and reason; each insight with its grounding (clip IDs and frames, or the two runs); each update in plain English plus operations. `GET /review/:shiftId` serves it to Person A's review screen.

## B4. The gate (2:40 to 3:00) — `server/gate.ts`

- `POST /brain/update` applies the operations to a candidate version, then re-runs the same tasks on held-out seeds 101 to 110 with the old brain and the candidate brain, headless, with no event stream.
- Score = the share of tasks whose item ended at its target with no refused actions, plus the average number of steps.
- Keep the candidate as the live brain only if the score rises; return both scores and the diff to the review screen.
- Run the 20 re-runs in parallel, and keep an eye on Crusoe's 600 requests per minute per model limit.
