# Version 1: The Closed Loop (1:20 PM to 3:00 PM)

**Goal:** robots work a shift, the supervisor finds a failure and proposes a brain change, and Update Brain shows a higher score on unseen seeds.

**Done when:** a launched shift produces at least one real failure, the supervisor proposes a fix, and the re-run on held-out seeds 101 to 110 scores higher with the new brain.

| Person | Plan | Owns |
|---|---|---|
| A | [person-A/BUILD-PLAN.md](person-A/BUILD-PLAN.md) | the store engine (simulator), the 3D web view, the launch, live, and review screens |
| B | [person-B/BUILD-PLAN.md](person-B/BUILD-PLAN.md) | the brain server, the worker agents, the supervisor, the gate, the footage library |

## The shared contracts (agree these first, 1:10 to 1:20)

**Engine actions.** Every action is a function on the engine and returns `{ ok: boolean, reason: string, state }`.

```
navigate_to(robotId, waypointId)
set_torso(robotId, level)            // level 1 to 4
scan_slot(robotId, slotId)           // returns what is in the slot
reach(robotId, slotId)               // fails with "out of reach" if torso level < slot level
grasp(robotId, mode)                 // mode: "one_hand" | "two_hand"
retract(robotId)
place(robotId, targetId)             // a slot ID or "tote"
report_issue(robotId, kind, detail)
```

**Trajectory step.** One JSON line per action, written by the engine.

```
{ t, robot, task_id, step, brain_nodes_read, action, args, ok, reason,
  position, torso_level, holding, item_location, target_location }
```

**Brain node, edge, and operation.**

```
node  { id, type, label, props }     // type: Scope | Procedure | Step | Rule | Guardrail | Protocol | Evidence
edge  { from, to, type }             // type: APPLIES_TO | STEP_OF | NEXT | SUPPORTED_BY | REPLACES
op    { op: "add_node" | "add_edge" | "set_prop" | "retire_node", ...fields }
```

**Event stream.** The server pushes every engine step to the web page over server-sent events at `GET /events`, using the trajectory step shape, so the 3D view can animate it.
