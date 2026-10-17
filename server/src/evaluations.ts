// Evaluations per brain version (V2 extension): every completed held-out or training measurement of a version,
// read from the saved gates and comparisons. History keeps only a version's latest score; this keeps them all.
// Read-only: nothing here writes a file or calls a model.

import type { BrainStore } from "./brain.ts";
import { listComparisons, setIdentity } from "./comparisons.ts";
import type { Gate } from "./gate.ts";
import { canonicalJson, dataDir, readJsonDir } from "./paths.ts";
import { ENGINE_DEFAULT_MAX_SPEED, guardrailSpeed, type Partition, type WorkerKind } from "./trials.ts";
import type { BrainDiff } from "./types.ts";

export interface Evaluation {
  evaluation_id: string;
  kind: "gate" | "comparison";
  role: "base" | "candidate" | "a" | "b";
  compared_with: number;
  worker: WorkerKind;
  partition: Partition;
  set_id: string;
  set: { seeds: number[]; tasks: { type: "PICK" | "RESTOCK"; slot: string }[]; max_speed_mps: number };
  tasks: number;
  successes: number;
  success_rate: number;
  refused_per_task: number | null;
  finished_at: string;
  verdict?: "promoted" | "rejected";
}

export interface VersionEvaluations {
  v: number;
  status: string;
  evaluations: Evaluation[];
}

/** What a diff changed, independent of order and of node contents. */
function diffKey(d: BrainDiff): string {
  return canonicalJson({
    added: d.added_nodes.map((n) => n.id).sort(),
    retired: d.retired_nodes.map((n) => n.id).sort(),
    changed: d.changed.map((c) => `${c.id}.${c.key}`).sort(),
    added_edges: d.added_edges.map((e) => `${e.from}>${e.type}>${e.to}`).sort(),
    removed_edges: d.removed_edges.map((e) => `${e.from}>${e.type}>${e.to}`).sort(),
  });
}

export function evaluationsByVersion(brain: BrainStore): VersionEvaluations[] {
  const idx = brain.index();
  const rows = new Map(idx.versions.map((r) => [r.v, r]));
  const out = new Map<number, Evaluation[]>(idx.versions.map((r) => [r.v, []]));
  const shas = new Map<number, string | null>();
  const sha = (v: number) => {
    if (!shas.has(v)) {
      try {
        shas.set(v, brain.fileSha256(v));
      } catch {
        shas.set(v, null);
      }
    }
    return shas.get(v);
  };
  const createdBy = (v: number, iso: string) => Date.parse(rows.get(v)!.created_at) <= Date.parse(iso);

  for (const g of readJsonDir<Gate>(dataDir("gates"))) {
    if (g.status !== "done" || !g.base_score || !g.candidate_score || !Array.isArray(g.per_seed)) continue;
    if (!rows.has(g.base) || !rows.has(g.candidate)) continue;
    // Count a gate for a version only if today's file is the one it measured. New gates saved the hashes; older
    // ones are matched by creation time, and the candidate also by the exact change the gate applied.
    let sameDiff = false;
    try {
      sameDiff = diffKey(brain.diff(g.base, g.candidate)) === diffKey(g.diff);
    } catch {}
    const ok = {
      base: g.brain_sha256 ? sha(g.base) === g.brain_sha256.base : createdBy(g.base, g.started_at),
      candidate: g.brain_sha256 ? sha(g.candidate) === g.brain_sha256.candidate : createdBy(g.candidate, g.started_at) && sameDiff,
    };
    let speed = g.environment?.max_speed_mps;
    if (speed === undefined) {
      try {
        speed = Math.min(guardrailSpeed(brain, g.base) ?? ENGINE_DEFAULT_MAX_SPEED, ENGINE_DEFAULT_MAX_SPEED);
      } catch {
        speed = ENGINE_DEFAULT_MAX_SPEED;
      }
    }
    const { set_id, set } = setIdentity("heldout", g.seeds, g.tasks, speed);
    for (const role of ["base", "candidate"] as const) {
      if (!ok[role]) continue;
      // the denominator is the tasks the gate actually ran (its per-seed results), as its saved score counted them
      const scores = g.per_seed.flatMap((p) => p[role] ?? []);
      const successes = scores.filter((s) => s.complete).length;
      out.get(g[role])!.push({
        evaluation_id: g.gate_id,
        kind: "gate",
        role,
        compared_with: role === "base" ? g.candidate : g.base,
        worker: g.worker,
        partition: "heldout",
        set_id,
        set,
        tasks: scores.length,
        successes,
        success_rate: scores.length ? +(successes / scores.length).toFixed(3) : 0,
        refused_per_task: scores.length ? +(scores.reduce((n, s) => n + s.refused_actions, 0) / scores.length).toFixed(2) : null,
        finished_at: g.finished_at ?? g.started_at,
        ...(g.verdict ? { verdict: g.verdict } : {}),
      });
    }
  }

  for (const c of listComparisons()) {
    if (c.status !== "done") continue;
    const { set } = setIdentity(c.partition, c.seeds, c.tasks, c.environment.max_speed_mps);
    c.aggregates.forEach((a, r) => {
      const v = c.versions[r];
      if (!a.complete || !rows.has(v) || sha(v) !== c.brain_sha256[v]) return;
      out.get(v)!.push({
        evaluation_id: c.comparison_id,
        kind: "comparison",
        role: r === 0 ? "a" : "b",
        compared_with: c.versions[1 - r],
        worker: c.worker,
        partition: c.partition,
        set_id: c.set_id,
        set,
        tasks: a.expected_tasks,
        successes: a.successes,
        success_rate: a.success_rate,
        refused_per_task: a.refused_per_evaluated_task,
        finished_at: c.finished_at ?? c.updated_at,
      });
    });
  }

  return idx.versions.map((r) => ({ v: r.v, status: r.status, evaluations: out.get(r.v)!.sort((a, b) => a.finished_at.localeCompare(b.finished_at)) }));
}
