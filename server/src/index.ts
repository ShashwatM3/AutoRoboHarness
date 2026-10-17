// AutoRoboHarness server (Person B): brain API, and later the shift runner, supervisor and gate.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { BrainStore } from "./brain.ts";
import { emit, sseHandler } from "./events.ts";
import type { BrainOp } from "./types.ts";
import { getShift, listShifts, startShift, type TaskSpec } from "./worker.ts";
import { getReview, rejudgeReview, startReview } from "./supervisor.ts";
import { getGate, updateBrain } from "./gate.ts";
import { getComparison, listComparisons, recoverInterruptedComparisons, startComparison, summarizeComparison } from "./comparisons.ts";
import { evaluationsByVersion } from "./evaluations.ts";
import { getTrial, listTrials, recoverInterruptedTrials } from "./trials.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

export const brain = new BrainStore(process.env.BRAIN_DIR ?? path.join(ROOT, "brain"));

// runs cut off by a restart are recorded as interrupted; their model calls are never resumed
const cut = [...recoverInterruptedTrials(), ...recoverInterruptedComparisons()];
if (cut.length) console.log(`marked ${cut.length} interrupted run(s): ${cut.join(", ")}`);

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const api = express.Router();

// ---------- brain (B1) ----------

// GET /brain                       -> the live graph { version, nodes, edges }
// GET /brain?v=2                   -> a given version
// GET /brain?scope=A-3-4-1&task=PICK[&v=][&robot=] -> resolved context for a slot (and everything above it)
api.get("/brain", (req, res) => {
  const v = brain.resolveVersion(req.query.v as string | undefined);
  const scope = req.query.scope as string | undefined;
  if (scope) {
    const ctx = brain.resolve(v, scope, req.query.task as string | undefined);
    emit("brain_read", { version: v, scope, robot: req.query.robot ?? null, node_ids: ctx.node_ids });
    return res.json(ctx);
  }
  const f = brain.file(v);
  res.json({ version: f.version, parent: f.parent, note: f.note, nodes: f.nodes, edges: f.edges });
});

api.get("/brain/versions", (_req, res) => res.json(brain.index()));
// history keeps each version's latest score; `evaluations` adds every completed measurement (V2 extension)
api.get("/brain/history", (_req, res) => {
  const evals = new Map(evaluationsByVersion(brain).map((e) => [e.v, e.evaluations]));
  const h = brain.history();
  res.json({ ...h, versions: h.versions.map((v) => ({ ...v, evaluations: evals.get(v.v) ?? [] })) });
});
api.get("/evaluations", (_req, res) => res.json({ versions: evaluationsByVersion(brain) }));

// GET /brain/diff?from=1&to=2
api.get("/brain/diff", (req, res) => {
  const to = brain.resolveVersion((req.query.to ?? req.query.b) as string | undefined);
  const fromQ = (req.query.from ?? req.query.a) as string | undefined;
  const from = fromQ !== undefined ? brain.resolveVersion(fromQ) : (brain.file(to).parent ?? to);
  res.json(brain.diff(from, to));
});

// POST /brain/apply { base?: number | "live", ops: BrainOp[], note?, created_by?, promote? }
// Writes brain/v(N+1).json as a candidate (live only with promote: true; normally the gate promotes).
api.post("/brain/apply", (req, res) => {
  const { base, ops, note, created_by, promote } = req.body ?? {};
  if (!Array.isArray(ops) || !ops.length) return res.status(400).json({ error: "ops must be a non-empty array" });
  const b = brain.resolveVersion(base);
  const out = brain.apply(b, ops as BrainOp[], { note, created_by, promote: !!promote });
  emit("brain_version", { v: out.version, status: promote ? "live" : "candidate" });
  res.json({ candidate: out.version, diff: out.diff });
});

// ---------- shifts (B3) ----------

// POST /shift { seed: 1-20, tasks: [{ robot?, type: "PICK" | "RESTOCK", slot: "A-3-4-1" }], brain?: "live" | n }
// (also accepts robots: [{ robot_id, task: { type, slot } }]); returns { shift_id } and streams steps on /events
api.post(["/shift", "/shifts"], (req, res) => {
  const b = req.body ?? {};
  const tasks: TaskSpec[] = Array.isArray(b.tasks)
    ? b.tasks
    : Array.isArray(b.robots)
      ? b.robots.map((r: any) => ({ robot: r.robot_id ?? r.robot, type: r.task?.type, slot: r.task?.slot }))
      : [];
  const shift = startShift(brain, { seed: b.seed, tasks, brain: b.brain, worker: b.worker });
  res.json({ shift_id: shift.shift_id, brain_version: shift.brain_version, tasks: shift.tasks });
});

api.get("/shifts", (_req, res) => res.json(listShifts()));

api.get(["/shift/:id", "/shifts/:id"], (req, res) => {
  const s = getShift(req.params.id as string);
  if (!s) return res.status(404).json({ error: "no such shift" });
  const { trajectory, ...rest } = s;
  res.json({ ...rest, steps: trajectory.length, trial_id: s.trial_id ?? null, replay_available: !!s.trial_id });
});

api.get(["/shift/:id/trajectory", "/shifts/:id/trajectory"], (req, res) => {
  const s = getShift(req.params.id as string);
  if (!s) return res.status(404).json({ error: "no such shift" });
  const robot = req.query.robot as string | undefined;
  res.json(robot ? s.trajectory.filter((st) => st.robot === robot) : s.trajectory);
});

// ---------- review (B5) ----------

// POST /review/:shiftId starts the supervisor (?refresh=1 to redo a finished one).
// GET  /review/:shiftId returns the review; it starts one if none exists yet.
api.post("/review/:shiftId", (req, res) => {
  const id = req.params.shiftId as string;
  const old = getReview(id);
  if (old && old.status !== "error" && !req.query.refresh) return res.json(old);
  res.json(startReview(brain, id));
});
api.get("/review/:shiftId", (req, res) => {
  const id = req.params.shiftId as string;
  res.json(getReview(id) ?? startReview(brain, id));
});
// POST /review/:shiftId/judge re-runs the judge (V2-1) on a finished review and returns it (about 10-60 s)
api.post("/review/:shiftId/judge", async (req, res) => {
  res.json(await rejudgeReview(brain, req.params.shiftId as string));
});

// ---------- Update Brain and the gate (B6) ----------

// POST /brain/update { shift_id, update_ids?: ["U1"], approve_guardrails?: boolean, wait?: boolean }
// Applies the chosen updates from that shift's review as a candidate brain, then re-runs the shift's tasks on
// held-out seeds with the live and the candidate brain. Returns { gate_id, base, candidate, diff } at once,
// or the whole gate result with wait: true (about a minute). Progress: gate_progress and gate_done events.
api.post("/brain/update", async (req, res) => {
  const { gate, done } = updateBrain(brain, req.body ?? {});
  if (req.body?.wait || req.query.wait) return res.json(await done);
  res.json({ gate_id: gate.gate_id, base: gate.base, candidate: gate.candidate, diff: gate.diff, status: gate.status });
});

api.get("/gate/:id", (req, res) => {
  const g = getGate(req.params.id as string);
  if (!g) return res.status(404).json({ error: "no such gate" });
  res.json(g);
});

// ---------- trials, matched comparisons (V2 extension) ----------

// GET /trials?partition=&kind=&status=&shift_id=&gate_id=&comparison_id= -> { trials: summaries, newest first }
api.get("/trials", (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json({ trials: listTrials({ partition: q.partition, kind: q.kind, status: q.status, shift_id: q.shift_id, gate_id: q.gate_id, comparison_id: q.comparison_id }) });
});
// GET /trials/:id -> the full recording: initial world, every step, final world. Only runs recorded since trials
// existed have one; older shifts and gates are never reconstructed.
api.get("/trials/:id", (req, res) => {
  const t = getTrial(req.params.id as string);
  if (!t) return res.status(404).json({ error: "no recording with that id", code: "no_trial", replay_available: false });
  res.json(t);
});

// POST /comparisons { versions: [a, b], seeds, tasks, worker?, environment?: { max_speed_mps? } } -> 202 at once
api.post("/comparisons", (req, res) => {
  const { comparison: c } = startComparison(brain, req.body);
  res.status(202).json({
    comparison_id: c.comparison_id,
    status: c.status,
    versions: c.versions,
    seeds: c.seeds,
    partition: c.partition,
    worker: c.worker,
    expected_tasks_per_version: c.aggregates[0].expected_tasks,
    total_pairs: c.progress.pairs_total,
  });
});
api.get("/comparisons", (_req, res) => res.json({ comparisons: listComparisons().map(summarizeComparison) }));
api.get("/comparisons/:id", (req, res) => {
  const c = getComparison(req.params.id as string);
  if (!c) return res.status(404).json({ error: "no comparison with that id", code: "no_comparison" });
  res.json(c);
});

api.get("/events", sseHandler);
api.get("/health", (_req, res) => res.json({ ok: true, live_brain: brain.index().live }));

// clip frames and contact sheets for the review screen, e.g. /ground_truth/frames/<clip>/sheet.jpg
app.use("/ground_truth", express.static(path.join(ROOT, "ground_truth")));

// the same routes answer at / and at /api
app.use("/api", api);
app.use("/", api);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message, ...(err.extra ?? {}) });
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => console.log(`server on http://localhost:${PORT} (live brain v${brain.index().live})`));
