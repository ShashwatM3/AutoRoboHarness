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

Scope ids: `store`, `zone:backroom`, `zone:packing`, `aisle:A`, `bay:A-3`, `level:A-3-4`, `slot:A-3-4-1`. A bare slot id such as `A-3-4-1` works too.

## The brain contract

```
node  { id, type, label, props }   type: Scope | Procedure | Step | Rule | Guardrail | Protocol | Evidence
edge  { from, to, type }           type: APPLIES_TO | STEP_OF | NEXT | SUPPORTED_BY | REPLACES | PART_OF
op    { op: "add_node", node } | { op: "add_edge", edge } | { op: "set_prop", id, key, value } | { op: "retire_node", id, reason }
```

`PART_OF` links the scope tree (slot → level → bay → aisle or zone → store). Version files are never edited; a retired node keeps its place with `props.retired_in`. When a step has two outgoing `NEXT` edges, the one added last wins, which is how a step is inserted.
