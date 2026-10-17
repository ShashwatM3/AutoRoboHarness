# Server (Person B)

Node and Express: the brain API now; the shift runner, supervisor and gate next.

```
cd server && npm install && npm run dev        # http://localhost:8787 (PORT to change)
```

Keys come from the repo-root `.env` (see `.env.example`). Every route answers both at `/` and at `/api`, with CORS on.

## Brain (step 1)

| Route | Returns |
|---|---|
| `GET /brain` | live graph `{ version, parent, note, nodes, edges }`; `?v=2` for another version |
| `GET /brain?scope=A-3-4-1&task=PICK` | the slot's context: `{ version, scope_path, procedure: { id, steps }, rules, guardrails, protocols, node_ids, text }`; also emits a `brain_read` event with `node_ids` |
| `GET /brain/versions` | `{ live, versions: [{ v, parent, status, note, heldout_score? }] }` |
| `GET /brain/diff?from=1&to=2` | `{ added_nodes, retired_nodes, changed: [{ id, key, from, to }], added_edges, removed_edges }` |
| `POST /brain/apply` | body `{ base: "live" \| n, ops, note? }`; writes `brain/v(N+1).json` as a candidate and returns `{ candidate, diff }` |
| `GET /events` | server-sent events. Trajectory steps arrive as plain messages (`onmessage`), in the trajectory-step shape plus `type: "step"`. Other events are named: `brain_read`, `brain_version` |

## Shifts (step 3)

| Route | Returns |
|---|---|
| `POST /shift` | body `{ seed: 1-20, tasks: [{ type: "PICK" \| "RESTOCK", slot: "A-2-3-1", robot? }], brain?: "live" \| n }`; returns `{ shift_id, brain_version, tasks }` at once, then the robots work in parallel |
| `GET /shift/:id` | `{ status: "running" \| "done" \| "error", seed, brain_version, tasks, scores, llm: { calls, prompt_tokens, completion_tokens }, steps }`; `scores` is the engine's `score()` once done |
| `GET /shift/:id/trajectory?robot=` | the engine's trajectory steps |
| `GET /shifts` | every shift (finished shifts are saved in `server/data/shifts/`) |

Events on `GET /events` during a shift: each engine step as a plain message (`{ type: "step", ...TrajectoryStep, shift_id, seed, brain_version }`), and named events `brain_read { shift_id, robot, version, node_ids }`, `llm { role, model, latency_s, robot }`, `task_done { shift_id, robot, task_id, score }`, `shift_done { shift_id, status, scores }`.

RESTOCK needs an empty shelf slot (the engine refuses to place into an occupied one). Seeds 101 to 110 are refused here; only the gate runs them. Each worker makes one Lightning call per action, about 0.5 s each.

## Review (step 5)

`GET /review/:shiftId` returns the supervisor's review, starting one if none exists (`POST /review/:shiftId?refresh=1` redoes it). It takes 1 to 3 minutes; poll until `status` is `done`, or listen for the `review_progress` and `review_done` events.

```
{ shift_id, status: "running" | "done" | "error", brain_version, model,
  failures: [{ id: "F1", robot, task_id, step, check, nodes_in_effect, cause, verified }],
  insights: [{ id: "I1", claim, addresses: ["F1"], verified,
               grounding: [{ kind: "clip", clip_id, note, frames, sheet, description, verified }
                         | { kind: "run_contrast", ok_run: "shift-x/robot-1", failed_run, note, verified }] }],
  updates:  [{ id: "U1", summary, ops: [supervisor edits], compiled: [BrainOps], valid, errors, touches_guardrail }],
  detected: { refused_steps, incomplete_tasks },   // the engine's facts, before any model
  tool_calls: [{ name, args }] }
```

`step` matches the trajectory's `step` for that robot. Clip images are served at `/ground_truth/...`, so `frames` and `sheet` paths can be used as URLs directly (for example `http://localhost:8787/ground_truth/frames/d16_rank0_8264/sheet.jpg`).

Scope ids: `store`, `zone:backroom`, `zone:packing`, `aisle:A`, `bay:A-3`, `level:A-3-4`, `slot:A-3-4-1`. A bare slot id such as `A-3-4-1` works too.

## The brain contract

```
node  { id, type, label, props }   type: Scope | Procedure | Step | Rule | Guardrail | Protocol | Evidence
edge  { from, to, type }           type: APPLIES_TO | STEP_OF | NEXT | SUPPORTED_BY | REPLACES | PART_OF
op    { op: "add_node", node } | { op: "add_edge", edge } | { op: "set_prop", id, key, value } | { op: "retire_node", id, reason }
```

`PART_OF` links the scope tree (slot → level → bay → aisle or zone → store). Version files are never edited; a retired node keeps its place with `props.retired_in`. When a step has two outgoing `NEXT` edges, the one added last wins, which is how a step is inserted.
