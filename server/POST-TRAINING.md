# Post-training API (Version 3)

`POST /post-training` turns the robots' verified good decisions into fine-tuning data and, if asked, starts one supervised LoRA job on Nemotron 3.5 Lightning through Crusoe Serverless Fine-Tuning. All routes are available under `/api` and at `/`. Read endpoints never start work or contact the provider. Nothing here promotes a brain, changes the brain index or deploys the fine-tuned model.

Code: `src/post-training.ts` (pipeline, records, routes), `src/post-training-data.ts` (collect, replay, scaler, export), `src/crusoe-finetune.ts` (provider and Hub calls). The server mounts the routes with one call: `registerPostTrainingRoutes(api, brain)`, which also marks unfinished runs interrupted when the server starts.

## 1. Endpoints

| Route | What it does |
|---|---|
| `POST /post-training` | Validates the request, saves a new run and answers `202` at once; the pipeline continues in the background |
| `GET /post-training` | `{ runs }`: every saved run, newest first, without long lists (rejections, provider events, checkpoints, metric series) |
| `GET /post-training/sources` | Replay-verified strict-success training sources; never inspects held-out trials or starts work |
| `GET /post-training/:id` | The full saved run. Read-only |
| `POST /post-training/:id/refresh` | Asks the provider about this run's job (job, events, checkpoints, metrics) and saves the actual answers. Settles an `unknown` upload or create by looking it up. Never uploads or creates. At most one provider poll per run every 5 seconds |
| `GET /post-training/:id/dataset?format=chat\|robot\|manifest` | The exported file itself. Any other format is `400 bad_format`; a run without an export is `404 no_dataset` |
| `POST /post-training/:id/cancel` | Explicit only. Stops a running local pipeline before its next variant or step, and cancels the provider job (`POST /fine_tuning/jobs/{id}/cancel`) when one is known and not finished |

### Request

```ts
POST /post-training
{
  shift_id?: string;                // a training shift with a recording; default: every finished training trial
  brain?: number | "live";          // the brain version that plays the variants; default "live"
  worker?: "llm" | "compiled";      // "llm" = Lightning workers (default); "compiled" = the brain policy, no model calls
  upload?: boolean;                 // default true; false keeps the dataset local and creates no job
  variants_per_task?: 0 | 1 | 2 | 3; // default 3
  max_tasks?: 1 | 2 | 3 | 4;        // scaler parents, default 2
}
-> 202 { post_training_id, status: "running", request, steps, created_at, console_url }
```

Errors: `400 bad_request` (`field` names the field; unknown fields are refused), `400 bad_id`, `404 no_shift_recording`, `404` for an unsaved brain version, `409 post_training_active` (one run at a time; carries the active `post_training_id`), `409 inference_busy` (Lightning variants need the shared quota). Errors happen before anything is saved.

## 2. The run record

Saved at `data/post-training/<id>/run.json` with atomic writes at every state change, next to the three exported files.

```ts
type StepStatus = "pending" | "started" | "completed" | "error" | "skipped";
interface StepState { status: StepStatus; started_at: string | null; finished_at: string | null; error?: string; reason?: string; counts: Record<string, number> }

interface PostTrainingRun {
  post_training_id: string;
  status: "running" | "done" | "error" | "interrupted" | "cancelled"; // the local pipeline; the provider job has its own status
  error?: string;                    // the first failed step and why
  request: { shift_id: string | null; brain_version: number; worker: "llm" | "compiled"; upload: boolean; variants_per_task: number; max_tasks: number };
  brain_version: number; brain_sha256: string;
  created_at: string; updated_at: string; finished_at?: string; cancel_requested_at?: string;
  steps: Record<"collect" | "scale" | "export" | "hf_publish" | "upload" | "job", StepState>;
  collect: { trials_considered; tasks_accepted; accepted: TaskRef[]; rejected: { trial_id; task_id?; reason }[] /* first 200 */; rejected_total; rejected_by_reason } | null;
  scale: { parents: TaskRef[]; variants: VariantRecord[] } | null;
  dataset: { examples; episodes; by_source: { lightning_worker; compiled_brain_policy }; by_origin: { recorded; variant }; files: { chat; robot; manifest: { name; bytes; sha256; rows } } } | null;
  hf: { status: "pending" | "not_configured" | "published" | "error"; repo?; commit?; url?; error?; local_files: string[] };
  provider: {
    base_url: string;
    console_url: "https://console.crusoecloud.com/foundry/fine-tuning/jobs";
    model: { id: string; model_name: string | null; source: "env" | "models_list" } | null;
    file: { state: "not_started" | "submitting" | "uploaded" | "unknown" | "error"; id?; filename?; bytes?; sha256?; status?; submitted_at?; error?; reconciled_at? };
    job: { state: "not_started" | "submitting" | "submitted" | "unknown" | "error"; id?; suffix?; request?: { model; training_file; hyperparameters }; status?; submitted_at?; error?; reconciled_at?; provider?: ProviderJob };
    estimate: { estimated_price: string | null; currency: string | null } | null; estimate_error?: string;
    events: { id; created_at; level; type; message }[];
    checkpoints: { id; created_at; step_number; fine_tuned_model_checkpoint; metrics: Record<string, number> }[];
    metrics: { metric_name: string; data: { x: number; value: number }[] }[];
    last_polled_at: string | null; poll_error: string | null;
    cancel?: { requested_at; status?; error? };
  };
  llm: LlmTally;                     // the variant workers' model calls
}

interface VariantRecord {
  variant_id: string;                // v<parent>-level | v<parent>-weight | v<parent>-start_location
  parent_trial_id: string; parent_task_id: string; seed: number;
  factor: "level" | "weight" | "start_location";
  task: { type: "PICK" | "RESTOCK"; slot: string } | null;
  changes: { path: string; from: unknown; to: unknown; note?: string }[];
  status: "rejected" | "pending" | "running" | "kept" | "failed" | "error" | "interrupted" | "not_run";
  reason?: string; trial_id: string | null; score: TaskScore | null; started_at?; finished_at?;
}
```

`ProviderJob` keeps only `id, status, model, training_file, fine_tuned_model, trained_tokens, created_at, finished_at, estimated_finish, error { code, message }, hyperparameters, suffix, metadata, result_files`. The API key is only ever in request headers.

Server-sent events: `post_training_progress { post_training_id, step, status, counts, error? }` at every step change and after each variant, and `post_training_done { post_training_id, status, job_id, job_state }`.

## 3. The steps

**1. Collect.** Reads `listTrials({ partition: "training", status: "done" })` (only that shift's trials when `shift_id` is given) and accepts only kinds `shift` and `comparison`. For each full record it checks: partition `training`, seed 1 to 20, no gate provenance, status `done`, the trial's `brain_sha256` equals the current file hash of that version, the recorded `initial` world equals the seed's world plus the recorded tasks and task cards, and `initial_sha256` matches. It then executes every recorded action again on the engine from `initial` and requires each replayed step, the final world and the scores to equal the recording exactly. A task is kept only if its item ended at its target with zero refused actions; a task in which the worker asked for an action that does not exist is dropped. Identical decisions in an identical world are kept once. Held-out trials are never listed or opened.

**2. Scale.** Picks up to `max_tasks` parents (Lightning decisions before compiled ones, newest first, one per seed and slot) and plans up to `variants_per_task` variants each, one factor per variant, on `createScenario(parent.seed, 1)` with one robot:
- `level`: the same aisle, bay and position on another shelf level (the largest height change first); the new item's weight is set to the parent item's weight so only the level changes.
- `weight`: the same slot; the item's weight moves across the 2 kg one-hand limit (to 2.4 to 3.9 kg, or 0.4 to 1.8 kg).
- `start_location`: the robot starts at another waypoint (tote, an aisle entrance or exit), never the task's first destination.

Before any run, each plan must be on a training seed, differ from the plain seed world only in its factor, keep weights within 0.2 to 4 kg and give a task the engine accepts; otherwise it is `rejected` with the reason. A factor with no valid change is reported, never replaced. Variants run one at a time with the requested brain and worker, recorded as trials of kind `posttraining` in the training partition with `provenance { post_training_id, parent_trial_id, augmentation { variant_id, factor, parent_task_id, changes } }`. A variant is `kept` only after its saved recording passes the same replay check against the planned world and is a strict success; otherwise it is `failed` with the reason. An error (for example a provider failure) stops the remaining variants (`not_run`), marks the step `error`, and the pipeline still exports the verified tasks so far.

**3. Export.** One line per action of every kept task, in recorded order:
- `train.chat.jsonl` (Crusoe format, single turn): `{"messages":[{"role":"system","content":<the resolved brain text for that task and brain version + fixed output instructions>},{"role":"user","content":<task card, the robot's state before this action, and this task's earlier actions with their results>},{"role":"assistant","content":"{\"action\":...,\"args\":{...}}"}]}`. The assistant content is the action exactly as the engine executed it.
- `robot.steps.jsonl` (LeRobot-style): `episode_index, frame_index, timestamp, task, observation.state { x, y, waypoint, torso_level, arm_out, reaching, holding, grasp_mode }, action { name, args }, next.result { ok, reason, t }, next.done, next.success, source { trial_id, task_id, step_index, kind, seed, brain_version, decision_source, observation: "reconstructed", variant }`.
- `manifest.json`: format notes, counts, file hashes and one entry per episode.

**4. Hugging Face copy.** Only when `HF_TOKEN` and `HF_DATASET_REPO` (`owner/name`) are set: the robot file and manifest are committed to `post-training/<id>/` in that public dataset repository (created if missing) through the Hub commit API. `published` only with a returned commit id; any failure is recorded and does not block the Crusoe steps. Without configuration the step is `skipped` and the copy stays local.

**5. Upload.** `POST {base}/files` (multipart `file`, `purpose=fine-tune`), Bearer `CRUSOE_API_KEY`. The base is `CRUSOE_TRAINING_BASE_URL` or `https://api.intelligence.crusoecloud.com/v1`. The file is checked against its export hash first. The state is saved as `submitting` before the request.

**6. Job.** The base model is `CRUSOE_FT_MODEL` when set; otherwise the single model from `GET {base}/models?model_type=base_model` with `fine_tuning_available: true` and a Lightning name (the docs list `nvidia/nemotron-3.5-lightning-30b-a3b`). None or several is an error, never a guess. A price estimate (`POST /fine_tuning/jobs/estimate_price`) is recorded when the provider gives one. Then, once:

```json
POST {base}/fine_tuning/jobs
{ "model": "<base model id>", "training_file": "<file id>", "suffix": "autorobo-<post_training_id>",
  "metadata": { "post_training_id": "...", "dataset_sha256": "...", "brain_version": "5" },
  "method": { "type": "supervised", "supervised": { "hyperparameters": { "n_epochs": 3, "batch_size": "auto", "learning_rate": 0.0001 } } } }
```

`batch_size` uses Crusoe's `auto` setting. The live API accepts `auto` or 16, 32, 64, 128, 256, 512 and 1024; smaller numeric values are rejected. LoRA settings use the provider defaults. Without a validation file Crusoe holds out 10% of the rows itself.

## 4. Never twice, never invented

- No ID, status or metric is ever written unless the provider returned it. Missing `CRUSOE_API_KEY` fails the upload before anything is sent.
- A refused request (HTTP 4xx, or a configuration problem) is `error`: nothing was created. A timeout, network failure, 5xx or unreadable answer is `unknown`: it may or may not exist, and it is **not** resent. `refresh` settles it by listing files (matching the run's unique filename) or jobs (matching the run's suffix, metadata id or file id), adopting exactly one match. Several matches are reported, never adopted.
- On server start, a run still `running` becomes `interrupted`: a started step becomes `error`, pending steps `skipped`, a running variant `interrupted`, pending variants `not_run`, and an in-flight upload or create `unknown`. The pipeline is not resumed. A job that was submitted stays queryable through `refresh` and cancellable through `cancel`.
- The job is created at most once per run. A new attempt is a new run.

## 5. Isolation and provenance

- Training seeds 1 to 20 only. Held-out seeds 101 to 110, held-out trials and gate trials are never read, collected or used as a variant seed; the original gate and fresh held-out comparisons are not touched.
- `decision_source` is `lightning_worker` for actions a Lightning worker chose and `compiled_brain_policy` for actions of the deterministic compiled policy, which made no model call. Compiled decisions are never described as model-generated.
- Observations are **reconstructed** by replaying the recorded actions from each recorded initial world. They are accurate states but not the original prompts: the Lightning worker saw a multi-turn conversation with its full instructions and a procedure plan.
- `finish` and `read_brain` calls are not recorded in trials and are not in the data; text a model wrote is never used.
- Existing trial recordings, brain snapshots and evidence are only read.

## 6. Limitations

- Variants use `TrialInput.scenario` from the V3 core. After `prepareTrial`, the recorded `initial_sha256` must equal the hash of the planned world with its task; otherwise the trial is closed as `error` and the variant is never played or used.
- Variants run one robot, so other robots of a multi-robot parent are absent.
- The LeRobot-style copy holds named actions and robot state only: it is not the official LeRobot format and has no joint motions and no camera frames.
- The docs give no per-job console URL; `console_url` is the fine-tuning jobs page, shown next to the job ID.
- Provider refusals are recorded as returned. An unsuccessful request is retained, never rewritten into a successful attempt.
- The Hub upload sends small regular files inline; if the repository routes a path to Git LFS, the step reports it instead of uploading.
- Lightning variants take the shared inference claim `post-training`; with workers on Lightning, a running comparison blocks a new run.
- Serving the fine-tuned model requires a Self-Serve Deployment in the Crusoe console; this API does not create one.
