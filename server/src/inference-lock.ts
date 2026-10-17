// Who is spending Lightning quota on this server right now (V2 extension). A comparison with Lightning workers
// runs alone: it starts only when no Lightning shift, gate or comparison is running, and while it runs new
// Lightning shifts and gates are refused. Shifts and gates may still overlap each other, as before.
// Compiled runs make no model calls and are never blocked.

import { httpError } from "./brain.ts";

export type InferenceKind = "shift" | "gate" | "comparison" | "adversary" | "post-training";
const active = new Map<string, { kind: InferenceKind; id: string }>();

export function activeInference() {
  return [...active.values()];
}

/** Claim the quota for a Lightning run, or throw 409 inference_busy; returns the release function. */
export function claimInference(kind: InferenceKind, id: string): () => void {
  const exclusive = (k: InferenceKind) => ["comparison", "adversary", "post-training"].includes(k);
  const blockers = [...active.values()].filter((a) => exclusive(kind) || exclusive(a.kind));
  if (blockers.length)
    throw httpError(409, `Lightning workers are busy (${blockers.map((b) => `${b.kind} ${b.id}`).join(", ")}); try again when they finish`, {
      code: "inference_busy",
      active: blockers,
    });
  active.set(id, { kind, id });
  let released = false;
  return () => {
    if (!released) active.delete(id);
    released = true;
  };
}
