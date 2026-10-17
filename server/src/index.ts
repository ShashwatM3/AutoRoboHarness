// AutoRoboHarness server (Person B): brain API, and later the shift runner, supervisor and gate.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { BrainStore } from "./brain.ts";
import { emit, sseHandler } from "./events.ts";
import type { BrainOp } from "./types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

export const brain = new BrainStore(process.env.BRAIN_DIR ?? path.join(ROOT, "brain"));

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

api.get("/events", sseHandler);
api.get("/health", (_req, res) => res.json({ ok: true, live_brain: brain.index().live }));

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
