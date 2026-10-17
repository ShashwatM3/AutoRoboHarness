# Trial recording and comparison API

This is the Version 2 recording contract. All routes are available under `/api` and at `/`. Read endpoints never start work or make model calls. Historical comparisons never promote a brain or write its index.

## 1. Trials (persistent recordings of every NEW run)

A **trial** is one engine world run with one brain version: one robot per task, robots in parallel. Trials are created by:
- every new `POST /shift` (one trial; partition `training`)
- every new gate (`POST /brain/update`): one trial per seed × version (partition `heldout`)
- every new comparison: one trial per seed × version (partition `heldout` or `training`, set by the seeds)

Storage: `server/data/trials/training/<trial_id>.json` and `server/data/trials/heldout/<trial_id>.json`. These are separate from `data/shifts`, so held-out trials never appear in `GET /shifts`, `getShift`, the supervisor's sibling runs or reviews. A trial is written atomically (temp file plus rename) when it is created, after **every** engine action (refused actions included), and at completion. On server start, any trial still `running` becomes `interrupted`; its model calls are **not** resumed.

```ts
type Partition = "training" | "heldout";
type TrialStatus = "running" | "done" | "error" | "interrupted";
type TrialKind = "shift" | "gate" | "comparison";

interface TaskSpec { type: "PICK" | "RESTOCK"; slot: string; robot?: string }

interface TaskSelection {           // how each requested task became the task actually run in this seed
  index: number;                    // position in the requested task list (0-based)
  requested: TaskSpec;
  actual: TaskSpec | null;          // null = no feasible slot in this seed; recorded as a failed task, never omitted
  substituted: boolean;             // true when actual.slot !== requested.slot (same aisle and level, nearest feasible)
  note?: string;                    // e.g. "PICK A-1-3-1 -> A-1-3-2 (item in reserve in seed 104)"
  robot: string | null;             // robot that ran it (null when infeasible)
  task_id: string | null;           // engine task id (null when infeasible)
}

interface TrialEnvironment {
  max_speed_mps: number;                    // effective speed limit the engine enforced
  requested_max_speed_mps: number | null;   // what the caller asked for (comparisons only; null = not given)
  guardrail_max_speed_mps: number | null;   // the brain guardrail applied (gates and shifts: this brain's; comparisons: the min over both versions)
  engine_default_max_speed_mps: 0.8;
}

interface TrialTask {                       // the engine task as created, plus its task card
  id: string; robot: string; type: "PICK" | "RESTOCK"; item_id: string; source: string; target: string;
  card: { task_id: string; type: "PICK" | "RESTOCK"; item: { id: string; name: string; weight_kg: number };
          source: string; source_waypoint: string; source_level: number | null;
          target: string; target_waypoint: string; target_level: number | null };
}

interface TrialProvenance {
  shift_id?: string;                        // kind "shift"
  gate_id?: string;                         // kind "gate"
  comparison_id?: string;                   // kind "comparison"
  evaluation_id?: string;                   // = gate_id or comparison_id
  role?: "base" | "candidate" | "a" | "b";  // gate: base or candidate; comparison: a = versions[0], b = versions[1]
}

interface TrialSummary {                    // GET /trials items: no initial, final or trajectory
  trial_id: string;                         // "trial-<base36>"
  kind: TrialKind;
  partition: Partition;
  status: TrialStatus;
  error?: string;
  seed: number;
  brain_version: number;
  brain_sha256: string;                     // sha256 of brain/v<N>.json bytes when the trial started
  worker: "llm" | "compiled";
  robot_count: number;
  environment: TrialEnvironment;
  provenance: TrialProvenance;
  requested_tasks: TaskSpec[];
  task_selection: TaskSelection[];
  tasks: TrialTask[];
  initial_sha256: string;                   // sha256 of the canonical JSON of `initial`; equal for both versions of a matched seed
  scores: TaskScore[];                      // engine.score() (empty until done; partial on error)
  steps: number;                            // trajectory length so far
  llm: LlmTally;                            // same shape as shift.llm
  started_at: string; updated_at: string; finished_at?: string;
  replay_available: true;
}

interface TrialRecord extends TrialSummary { // GET /trials/:id
  initial: Scenario;                        // engine snapshot right after task creation, before any action
  trajectory: TrajectoryStep[];             // every action, in order, refused actions included
  final: Omit<Scenario, "trajectory"> | null; // engine snapshot at completion, with trajectory left out (it's above); null while running
}
// TaskScore, Scenario and TrajectoryStep are the engine's types (engine/store.ts).
// LlmTally = { calls, prompt_tokens, completion_tokens, replayed, crusoe_cache: { calls_reporting, prompt_tokens, cached_tokens }, cache_share: number | null }
```

Routes:
- `GET /trials` → `{ trials: TrialSummary[] }`, newest first. Optional filters: `?partition=training|heldout`, `?kind=shift|gate|comparison`, `?comparison_id=`, `?gate_id=`, `?shift_id=`, `?status=`.
- `GET /trials/:trial_id` → `TrialRecord`. Errors: 400 `bad_id` (anything other than `[A-Za-z0-9_-]`), 404 `no_trial` with `{ error, code: "no_trial", replay_available: false }`.
- **Old shifts and gates made before this change have no trial.** The server never reconstructs or fabricates their replays. The original gate `gate-mvcynupn` is score-only.
- `GET /shift/:id` gains `trial_id: string | null` and `replay_available: boolean` (false for old shifts).
- New gates gain `per_seed[i].trial_ids: { base: string | null, candidate: string | null }`, `per_seed[i].task_selection: TaskSelection[]` and `brain_sha256: { base: string, candidate: string }`. Old gate files are never rewritten, and their bytes are preserved.

---

## 2. Matched comparisons (no promotion, no brain or index writes)

`POST /comparisons`, body:
```ts
interface ComparisonRequest {
  versions: [number, number];        // two different saved brain versions, e.g. [4, 5]
  seeds: number[];                   // unique; ALL in 101..110 (heldout) or ALL in 1..20 (training); 1..10 (heldout) / 1..20 (training)
  tasks: TaskSpec[];                 // 1..4; robot optional (default robot-<i+1>); robots unique among robot-1..robot-<tasks.length>
  worker?: "llm" | "compiled";       // default "compiled"
  environment?: { max_speed_mps?: number }; // 0 < x <= 0.8
}
```
Response `202`: `{ comparison_id, status: "running", versions, seeds, partition, worker, expected_tasks_per_version, total_pairs }`.

Errors are `{ error, code }`:
- 400 `bad_versions`: not two distinct integers.
- 404 `no_such_version`: a version file is missing.
- 400 `bad_seeds`: empty, not unique, not integers, or mixed partitions.
- 400 `bad_tasks`: count, type, unknown slot, or robots not unique/in range.
- 400 `bad_environment`.
- 409 `inference_busy`: worker `llm` while any local `llm` shift, gate or comparison is running. Body `{ active: [{ kind, id }] }`.
- While an `llm` comparison runs, new `llm` shifts and gates are refused with the same 409 `inference_busy`. Compiled runs are never blocked.

Execution: async and strictly sequential. For each seed in request order, run version `a`, then version `b`. Within a run, the robots act in parallel, as in shifts and gates. For each seed:
- `taskForSeed` is applied **once** per requested task. The resulting `task_selection`, robot count, world (`createScenario(seed, robot_count)`), task ids (`<comparison_id>-s<seed>-t<i>`) and effective environment are **identical** for both versions. The server checks that both trials' `initial_sha256` are equal; a mismatch makes that pair `error`.
- An infeasible task (no slot in that seed) is recorded in `task_selection` with `actual: null`. It counts as a **failed expected task for both versions** and is never dropped.
- A run error (for example persistent 429s past the 600 s recovery window) marks that pair `error` and stops the comparison (`status: "error"`). Later pairs are `not_run`.
- A server restart marks a running comparison `interrupted`: the running pair becomes `interrupted` and later pairs `not_run`.
- Nothing calls `brain.setStatus`, `brain.apply` or `index` writes; `heldout_score` and history are untouched. Records are stored in `server/data/comparisons/<comparison_id>.json` and written atomically at creation, after each pair, and at the end.

```ts
type ComparisonStatus = "running" | "done" | "error" | "interrupted";
type PairStatus = "pending" | "running" | "done" | "error" | "interrupted" | "not_run";

interface ComparisonPair {                      // one seed × one version
  version: number;
  role: "a" | "b";
  status: PairStatus;
  error?: string;
  trial_id: string | null;                      // null until started (and for not_run)
  task_scores: (TaskScore & { index: number })[]; // one per EXPECTED task; infeasible ones are { complete: false, refused_actions: 0, steps: 0, item_location: "", target_location: "", task_id: "" } with index
}

interface ComparisonSeed {
  seed: number;
  robot_count: number;                          // number of requested tasks (same for both versions); infeasible tasks leave their robots idle
  task_selection: TaskSelection[];
  initial_sha256: string | null;                // the shared world hash, once both runs started
  pairs: [ComparisonPair, ComparisonPair];      // [a, b]
}

interface VersionAggregate {
  version: number;
  role: "a" | "b";
  expected_tasks: number;                       // seeds.length × tasks.length, ALWAYS the denominator
  evaluated_tasks: number;                      // tasks with a final outcome (done pairs plus infeasible tasks)
  infeasible_tasks: number;
  successes: number;                            // complete === true
  success_rate: number;                         // successes / expected_tasks (3 dp)
  refused_per_evaluated_task: number | null;
  steps_per_evaluated_task: number | null;
  complete: boolean;                            // status === "done" && evaluated_tasks === expected_tasks
  trial_ids: string[];
}

interface Comparison {
  comparison_id: string;                        // "cmp-<base36>"; also its evaluation_id
  evaluation_id: string;
  status: ComparisonStatus;
  error?: string;
  request: ComparisonRequest;                   // as received, after validation and defaults (canonical)
  versions: [number, number];
  brain_sha256: Record<string, string>;         // version → sha256 of its file at start
  partition: Partition;
  seeds: number[];
  tasks: TaskSpec[];                            // canonical requested specs (robot filled in)
  worker: "llm" | "compiled";
  environment: TrialEnvironment & { guardrail_max_speed_mps_by_version: Record<string, number | null> };
  set_id: string;                               // see section 3; equals a gate's set_id when seeds, tasks and speed match
  per_seed: ComparisonSeed[];                   // every requested seed, in order, always present
  progress: { pairs_done: number; pairs_total: number };
  aggregates: [VersionAggregate, VersionAggregate];
  llm: LlmTally;                                // sum over its trials
  created_at: string; started_at: string; updated_at: string; finished_at?: string;
}
```

Routes:
- `GET /comparisons` → `{ comparisons: Omit<Comparison, "per_seed">[] }`, newest first.
- `GET /comparisons/:id` → `Comparison`. Errors: 400 `bad_id`, 404 `no_comparison`.
- SSE named events: `comparison_progress { comparison_id, pairs_done, pairs_total, seed, version, status }` and `comparison_done { comparison_id, status, aggregates }`. Trial steps of comparisons and gates are **not** streamed (headless), as for gates today.

---

## 3. Evaluations per brain version (read-only; all completed measurements)

`GET /evaluations` → `{ versions: VersionEvaluations[] }`, every brain version oldest first, even unevaluated ones.

```ts
interface Evaluation {
  evaluation_id: string;                 // gate_id or comparison_id
  kind: "gate" | "comparison";
  role: "base" | "candidate" | "a" | "b";
  compared_with: number;                 // the other version in that evaluation
  worker: "llm" | "compiled";
  partition: Partition;                  // gates: always "heldout"
  set_id: string;                        // sha256(canonical { partition, seeds sorted, tasks [{type,slot}], max_speed_mps })[0:12]
  set: { seeds: number[]; tasks: { type: "PICK" | "RESTOCK"; slot: string }[]; max_speed_mps: number };
  tasks: number;                         // denominator: old gates = tasks actually run (per_seed lengths, matching its saved score); comparisons = expected_tasks
  successes: number;
  success_rate: number;                  // successes / tasks (3 dp)
  refused_per_task: number | null;
  finished_at: string;
  verdict?: "promoted" | "rejected";     // gates only
}
interface VersionEvaluations { v: number; status: string; evaluations: Evaluation[] /* oldest first; [] = "Not evaluated" */ }
```

Rules:
- Only `status: "done"` gates and comparisons with `complete: true` count. Errored, interrupted and incomplete ones are ignored.
- A gate counts for a version only if that version's current file is the one the gate measured. For a candidate, the gate's saved diff must equal today's `brain.diff(base, candidate)`. For a base, the version must have been created before the gate started; when the gate saved `brain_sha256`, that is compared instead. This prevents a recreated v2 from inheriting another v2's score.
- Comparisons count only if each version's current `brain_sha256` equals the one recorded.
- Example on the verified Version 2 data: v4 gets **two** evaluations, `gate-mvcw8wto` as candidate (4/10) and `gate-mvcynupn` as base (6/10). History's single `heldout_score` keeps only the latest.

`GET /brain/history` stays as it is and gains `evaluations: Evaluation[]` on each version (backward compatible; `heldout_score` and `heldout` are unchanged).

---

## 4. Path and ID safety
`shift_id`, `gate_id`, `trial_id`, `comparison_id` and review ids must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$`. Otherwise the response is 400 `bad_id`, so a path such as `../` can never reach the file system. A trial or comparison id is never a shift id, so `POST /review/<trial_id>` gets 404.

## 5. Saved training runs (read-only library)

These two routes list and open the training shifts this server already has, with their saved review and the gates that came from them. They are strictly read-only:
- They never start a shift, review or gate, never call a model and never write a file. A shift with no review stays without one; use `POST /review/:shiftId` to start one deliberately.
- Only training shifts are visible: shifts saved under `data/shifts`, plus any still running in memory. Held-out gate runs and comparison runs are trials, never shifts, so their ids, like gate and comparison ids, get 404 here.

```ts
interface RunSummary {
  shift_id: string;
  status: "running" | "done" | "error";
  seed: number;
  brain_version: number;
  worker: "llm" | "compiled";
  tasks: Shift["tasks"];                  // as stored, with task cards
  scores: TaskScore[];                    // empty while running
  llm: LlmTally;
  started_at: string;
  finished_at: string | null;
  trial_id: string | null;                // the shift's recording; null for shifts made before trials existed
  replay_available: boolean;              // trial_id !== null
  review_status: "running" | "done" | "error" | null; // null: no review was ever made for this shift
  gate_ids: string[];                     // every gate whose shift_id is this shift (saved or running), oldest first
}
interface RunDetail {
  shift: Shift;                           // the stored shift, trajectory included (empty while still running)
  review: Review | null;                  // the saved review exactly as GET /review/:shiftId would show it; null if none
  gates: Gate[];                          // the full gate records for gate_ids, oldest first
}
```

- `GET /runs` → `{ runs: RunSummary[] }`, newest first (by `started_at`). It has no trajectories; open one with the next route.
- `GET /runs/:shift_id` → `RunDetail`.
- Errors: 400 `bad_id` (see section 4); 404 `{ error, code: "no_run" }` when no training shift has that id.

The review is read from saved storage with no side effects, unlike `GET /review/:shiftId`, which starts a review when none exists. Gates are matched by the `shift_id` recorded in each gate file, so every gate made from a shift is listed, including errored ones (check `status` and `verdict`).

## Runtime details

`AUTOROBO_DATA_DIR` optionally relocates shifts, reviews, gates, trials and comparisons together. The default is `server/data`. `BRAIN_DIR` independently selects the brain snapshot directory. Both are read on the server, never in the browser.

New gate task IDs are version-independent (`<gate_id>-s<seed>-t<i>`), so both starting scenes hash identically. A requested robot stays present and idle if its task is infeasible. Gate model totals update after each recorded trial. The shared Lightning limiter and 600-second 429 recovery behavior remain in effect.

New trajectory steps also contain `item_state`, the affected physical item snapshot. This differs from the intended task item when products are misplaced and allows replay to restore the actual item correctly.

## Dynamic version catalog

`GET /brain/versions` returns `{ live: number | null, indexed: boolean, versions: CatalogEntry[] }`. It combines index metadata with every `vN.json` on disk without writing either. Each row includes `indexed`, `available`, and an optional `unavailable_reason`. A valid file without an index row has status `unregistered`; an indexed file that is missing or unreadable has `available: false`. `created_at` and `created_by` can be null for unreadable files. The live value is null only when there is no index.

History and evaluations use the same catalog; unavailable snapshots have no current attributable evaluations. A legacy candidate evaluation is recognized only when the full saved diff matches its actual diff, including labels, properties and changed values. New evaluations use the saved snapshot hashes.
