# Server (Person B)

Node and Express: the brain API now; the shift runner, supervisor and gate next.

```
cd server && npm install && npm run dev        # http://localhost:8787 (PORT to change)
```

Keys come from the repo-root `.env` (see `.env.example`). Every route answers both at `/` and at `/api`, with CORS on.

`npm start` runs without file watching, so a pull does not interrupt a long evaluation. `npm test` runs the provider scheduling regressions with a simulated clock and no API calls. Calls are paced per model at `LLM_RPM` (default 18), with at most `LLM_CONCURRENCY` (default 4) requests in flight. A 429 pauses all queued calls for that model using `Retry-After`, or 60 seconds when the provider omits it. Limits apply to the whole Crusoe project, so other processes sharing that project also consume its allowance. The gate runs seed/version pairs in sequence and drains current robot workers before reporting a fatal error.

A call retries 429s for up to `LLM_429_WAIT_S` seconds (default 600); 5xx and network errors get 6 tries. Responses are cached in `server/.cache/llm/` (`LLM_CACHE=0` turns that off).

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
  failures: [{ id: "F1", robot, task_id, step, check, nodes_in_effect, cause, verified, judge: { keep, why } }],
  insights: [{ id: "I1", claim, addresses: ["F1"], verified, judge: { keep, why },
               grounding: [{ kind: "clip", clip_id, note, frames, sheet, description, verified, judge_supports }
                         | { kind: "run_contrast", ok_run: "shift-x/robot-1", failed_run, note, verified, judge_supports }] }],
  updates:  [{ id: "U1", summary, ops: [supervisor edits], compiled: [BrainOps], valid, errors, touches_guardrail, judge_supported }],
  detected: { refused_steps, incomplete_tasks },   // the engine's facts, before any model
  judge: { model, kept: ["F1", "I1"], dropped: [{ id, why }], finished_at, error? },
  tool_calls: [{ name, args }] }
```

`step` matches the trajectory's `step` for that robot.

**Judge (Version 2).** After the supervisor answers, DeepSeek V4 Pro (`deepseek-ai/DeepSeek-V4-Pro`, thinking on, about 20 s, one call) checks every failure and insight against the evidence it cites: the cited step's facts, the clip's library entry, or both runs' items, results and steps. It keeps what that evidence shows and drops the rest, with a reason. A finding that cites a missing step, clip or run is dropped without a model call. `judge_supports: false` marks a citation that doesn't back its claim even when the insight is kept on other evidence, and `judge_supported: false` marks an update whose cited findings were all dropped. The judge never changes `valid` or the gate. If it fails, the review still finishes, with `judge.error` set. `JUDGE=0` turns it off; `POST /review/:shiftId/judge` re-runs it on a finished review (also for reviews made before the judge existed) and returns the review. `review_done` events carry `judge: { kept, dropped }` counts. Clip images are served at `/ground_truth/...`, so `frames` and `sheet` paths can be used as URLs directly (for example `http://localhost:8787/ground_truth/frames/d16_rank0_8264/sheet.jpg`).

## Update Brain and the gate (step 6)

`POST /brain/update` with `{ shift_id, update_ids?: ["U1", "U2"], approve_guardrails?: false, wait?: false, worker?: "compiled" | "llm", seeds?: 10 }`:

1. applies the chosen updates from that shift's review (default: every valid one) to the live brain as candidate `brain/v(N+1).json`;
2. re-runs the shift's tasks on held-out seeds 101 to 110 with the live and the candidate brain, headless;
3. makes the candidate live only if the score rises (more tasks complete, or as many with fewer refused actions); otherwise marks it rejected.

It returns `{ gate_id, base, candidate, diff, status }` at once (or the whole result with `wait: true`; the compiled gate takes well under a second). `GET /gate/:id` returns:

```
{ gate_id, status, verdict: "promoted" | "rejected", reason, base, candidate, seeds, worker,
  base_score:      { tasks, complete, complete_rate, refused_per_task, steps_per_task },
  candidate_score: { ...same },  delta,
  per_seed: [{ seed, base: [TaskScore], candidate: [TaskScore], skipped: [notes] }],
  diff }          // same shape as GET /brain/diff, for the before-and-after graph
```

Events: `gate_progress { gate_id, done, total }`, `gate_done { gate_id, verdict, base_score, candidate_score }`, `brain_version { v, status }`.

- **Worker.** The gate defaults to the compiled policy (`server/src/policy.ts`), which runs the brain exactly as written, with no model calls. `worker: "llm"` uses the Lightning workers instead. That's about 9 calls per task, and our key allows roughly 15 to 20 calls a minute, so a full LLM gate takes about 20 minutes; use `seeds: 1` for a spot check. `POST /shift` also accepts `worker: "compiled"` for a fast run with no model calls.
- **Substitutes.** When a task can't be done in a held-out seed (a RESTOCK slot already stocked, or a PICK item in reserve), the gate uses the nearest slot of the same type on the same aisle and level. Both brains get the same substitute, and `skipped` lists each one.
- **Guardrails.** An update that touches a guardrail is refused with 403 unless `approve_guardrails: true`, which is the human's click.

Scope ids: `store`, `zone:backroom`, `zone:packing`, `aisle:A`, `bay:A-3`, `level:A-3-4`, `slot:A-3-4-1`. A bare slot id such as `A-3-4-1` works too.

## The brain contract

```
node  { id, type, label, props }   type: Scope | Procedure | Step | Rule | Guardrail | Protocol | Evidence
edge  { from, to, type }           type: APPLIES_TO | STEP_OF | NEXT | SUPPORTED_BY | REPLACES | PART_OF
op    { op: "add_node", node } | { op: "add_edge", edge } | { op: "set_prop", id, key, value } | { op: "retire_node", id, reason }
```

`PART_OF` links the scope tree (slot → level → bay → aisle or zone → store). Version files are never edited; a retired node keeps its place with `props.retired_in`. When a step has two outgoing `NEXT` edges, the one added last wins, which is how a step is inserted.
