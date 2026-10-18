// Optional V3 process: adds the new workflows without restarting the active demo API.
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { BrainStore, httpError } from "./brain.ts";
import { registerAdversaryRoutes, recoverInterruptedAttacks, listAttacks } from "./adversary.ts";
import { registerPostTrainingRoutes } from "./post-training.ts";
import { listShifts } from "./worker.ts";
import { listGates } from "./gate.ts";
import { listComparisons } from "./comparisons.ts";
import { getReview } from "./supervisor.ts";
import { activeInference } from "./inference-lock.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
const brain = new BrainStore(process.env.BRAIN_DIR ?? path.join(root, "brain"));
recoverInterruptedAttacks(true); // recover this service's records, never a legacy demo attack
const app = express(), api = express.Router();
app.use(cors()); app.use(express.json({ limit: "5mb" }));
api.use((req, _res, next) => {
  // Give a demo shift, review or gate priority over a new V3 workload. Read/status requests stay available.
  const dataOnly = req.path === "/post-training" && req.body?.variants_per_task === 0 && req.body?.upload === false;
  if (req.method === "POST" && !dataOnly && !/\/(refresh|cancel)$/.test(req.path)) {
    const running = [...listShifts(), ...listGates(), ...listComparisons(), ...listAttacks()].filter((r) => r.status === "running");
    const reviewing = listShifts().some((s) => getReview(s.shift_id)?.status === "running");
    const evaluating = brain.index().versions.some((v) => v.status === "candidate");
    if (running.length || reviewing || evaluating) return next(httpError(409, "The live demo has active work or a pending brain evaluation. Wait for it to finish, then retry.", { code: "demo_busy" }));
  }
  next();
});
api.get("/health", (_req, res) => res.json({ ok: true, live_brain: brain.index().live, release: 3, active: activeInference() }));
registerAdversaryRoutes(api, brain);
registerPostTrainingRoutes(api, brain);
app.use("/api", api);
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => res.status(err.status ?? 500).json({ error: err.message, ...(err.extra ?? {}) }));
const port = Number(process.env.V3_PORT ?? 8790);
app.listen(port, "127.0.0.1", () => console.log(`V3 workflows on http://127.0.0.1:${port}; demo API unchanged`));
