// Saved training-run library (V2 UI): every training shift this server has, with its saved review and the gates
// that came from it. Strictly read-only: it never starts a shift, review or gate, never calls a model and never
// writes a file. Only training shifts (listShifts/getShift) are visible; held-out gate and comparison runs are
// trials, never shifts, so their ids are simply not found here.

import { listGates, type Gate } from "./gate.ts";
import { getReview, type Review } from "./supervisor.ts";
import { getShift, listShifts, type Shift } from "./worker.ts";

export interface RunSummary {
  shift_id: string;
  status: Shift["status"];
  seed: number;
  brain_version: number;
  worker: Shift["worker"];
  tasks: Shift["tasks"];
  scores: Shift["scores"];
  llm: Shift["llm"];
  started_at: string;
  finished_at: string | null;
  trial_id: string | null;
  replay_available: boolean;
  review_status: Review["status"] | null; // null: no review was ever made for this shift
  gate_ids: string[]; // gates whose shift_id is this shift, oldest first
  source?: Shift["source"];
}

export interface RunDetail {
  shift: Shift; // the stored shift, trajectory included
  review: Review | null;
  gates: Gate[]; // the full gate records, oldest first
}

const gatesByShift = () => {
  const by = new Map<string, Gate[]>();
  for (const g of listGates()) by.set(g.shift_id, [...(by.get(g.shift_id) ?? []), g]);
  return by;
};

/** GET /runs: newest first. */
export function listRuns(): RunSummary[] {
  const gates = gatesByShift();
  return listShifts()
    .map((s) => ({
      shift_id: s.shift_id,
      status: s.status,
      seed: s.seed,
      brain_version: s.brain_version,
      worker: s.worker,
      tasks: s.tasks,
      scores: s.scores,
      llm: s.llm,
      started_at: s.started_at,
      finished_at: s.finished_at ?? null,
      trial_id: s.trial_id ?? null,
      replay_available: !!s.trial_id,
      review_status: getReview(s.shift_id)?.status ?? null,
      gate_ids: (gates.get(s.shift_id) ?? []).map((g) => g.gate_id),
      ...(s.source ? { source: s.source } : {}),
    }))
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)) || b.shift_id.localeCompare(a.shift_id));
}

/** GET /runs/:id: undefined when no training shift has that id (an invalid id throws 400 bad_id). */
export function getRun(id: string): RunDetail | undefined {
  const shift = getShift(id);
  if (!shift) return undefined;
  return { shift, review: getReview(shift.shift_id) ?? null, gates: gatesByShift().get(shift.shift_id) ?? [] };
}
