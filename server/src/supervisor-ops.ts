// The closed set of brain edits the supervisor may propose, their validation, and their compilation to BrainOps.
// No free text compiles: every edit is one of these typed tools, checked against the base brain.

import { scopePath, type BrainStore } from "./brain.ts";
import { ACTIONS, type BrainNode, type BrainOp, type Cond } from "./types.ts";

export const RULE_PARAMS = {
  "grasp.mode": (v: unknown) => v === "one_hand" || v === "two_hand",
  "torso.level": (v: unknown) => v === "$slot.level" || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 4),
} as const;
export const COND_FIELDS = ["item.weight_kg", "slot.level", "task.type"] as const;
export const TRIGGERS = ["slot_mismatch", "slot_empty", "grasp_refused", "out_of_reach"] as const;

export type SupervisorOp =
  | { tool: "add_rule"; scope: string; label: string; when: Cond[]; then: { param: keyof typeof RULE_PARAMS; value: unknown }; priority: number; cites: string[] }
  | { tool: "insert_step"; procedure: string; after_step: string | null; action: string; args: Record<string, unknown>; label: string; cites: string[] }
  | { tool: "add_protocol"; scope: string; label: string; trigger: string; response: { action: string; args?: Record<string, unknown> }[]; then: "stop" | "continue"; cites: string[] }
  | { tool: "set_parameter"; node: string; key: string; value: unknown; cites: string[] }
  | { tool: "retire_node"; node: string; reason: string; cites: string[] };

export interface Update {
  id: string;
  summary: string;
  ops: SupervisorOp[];
}

/** Evidence nodes to attach, keyed by insight id. */
export type EvidenceById = Record<string, Omit<BrainNode, "id">>;

export interface CompiledUpdate {
  valid: boolean;
  errors: string[];
  touches_guardrail: boolean;
  compiled: BrainOp[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "x";

/**
 * Compile one or more updates against a base brain version. Ids are made unique against the base and each other.
 * `known` lists the failure and insight ids an op may cite; `evidence` turns cited insights into Evidence nodes.
 */
export function compileUpdates(brain: BrainStore, base: number, updates: Update[], known: Set<string>, evidence: EvidenceById = {}): Record<string, CompiledUpdate> {
  const file = brain.file(base);
  const nodes = new Map(file.nodes.map((n) => [n.id, n]));
  const taken = new Set(nodes.keys());
  const uid = (prefix: string, label: string) => {
    let id = `${prefix}:${slug(label)}`;
    for (let i = 2; taken.has(id); i++) id = `${prefix}:${slug(label)}-${i}`;
    taken.add(id);
    return id;
  };
  const live = (id: string) => {
    const n = nodes.get(id);
    return n && n.props?.retired_in == null ? n : undefined;
  };
  // NEXT edges added so far in this batch, so two insertions after the same step chain correctly
  const nextOf = new Map<string, string | undefined>();
  const stepsOf = (proc: string) => brain.steps(base, proc).map((s) => s.id);

  const out: Record<string, CompiledUpdate> = {};
  for (const u of updates) {
    const errors: string[] = [];
    const ops: BrainOp[] = [];
    let touches_guardrail = false;
    if (!Array.isArray(u.ops) || !u.ops.length) errors.push("an update needs at least one op");
    if ((u.ops?.length ?? 0) > 5) errors.push("at most 5 ops per update");
    const newIds: string[] = [];
    const cited = new Set<string>();

    for (const [i, op] of (u.ops ?? []).entries()) {
      const err = (m: string) => errors.push(`op ${i + 1} (${(op as any)?.tool}): ${m}`);
      const cites = Array.isArray((op as any)?.cites) ? ((op as any).cites as string[]) : [];
      if (!cites.length) err("must cite at least one failure or insight id");
      for (const c of cites) {
        if (!known.has(c)) err(`cites unknown id ${c}`);
        else cited.add(c);
      }
      switch (op?.tool) {
        case "add_rule": {
          if (scopePath(op.scope)[0] !== op.scope) {
            err(`scope ${op.scope} is not a scope id (store, zone:backroom, aisle:A, bay:A-3, level:A-3-4, slot:A-3-4-1)`);
            break;
          }
          const check = RULE_PARAMS[op.then?.param as keyof typeof RULE_PARAMS];
          if (!check) {
            err(`then.param must be one of ${Object.keys(RULE_PARAMS).join(", ")}`);
            break;
          }
          if (!check(op.then.value)) {
            err(`value ${JSON.stringify(op.then.value)} is not allowed for ${op.then.param}`);
            break;
          }
          const when = Array.isArray(op.when) ? op.when : [];
          const badCond = when.find((c) => !COND_FIELDS.includes(c?.field as any) || ![">", ">=", "<", "<=", "==", "!="].includes(c?.op));
          if (badCond) {
            err(`condition ${JSON.stringify(badCond)}: field must be one of ${COND_FIELDS.join(", ")}`);
            break;
          }
          const id = uid("rule", op.label);
          ops.push({ op: "add_node", node: { id, type: "Rule", label: op.label, props: { when, then: op.then, priority: Number(op.priority ?? 10) } } });
          ops.push({ op: "add_edge", edge: { from: id, to: op.scope, type: "APPLIES_TO" } });
          newIds.push(id);
          break;
        }
        case "insert_step": {
          const proc = live(op.procedure);
          if (!proc || proc.type !== "Procedure") {
            err(`procedure ${op.procedure} does not exist`);
            break;
          }
          if (!ACTIONS.includes(op.action as any)) {
            err(`action must be one of ${ACTIONS.join(", ")}`);
            break;
          }
          const chain = stepsOf(op.procedure);
          if (op.after_step != null && !chain.includes(op.after_step) && !newIds.includes(op.after_step)) {
            err(`after_step ${op.after_step} is not a step of ${op.procedure}`);
            break;
          }
          const id = uid(`step:${String(proc.props.task).toLowerCase()}`, op.label || op.action);
          ops.push({ op: "add_node", node: { id, type: "Step", label: op.label || op.action, props: { action: op.action, args: op.args ?? {} } } });
          ops.push({ op: "add_edge", edge: { from: id, to: op.procedure, type: "STEP_OF" } });
          // the last-added NEXT edge wins, so prev -> new, then new -> old next
          const prev = op.after_step;
          const oldNext = prev ? (nextOf.has(prev) ? nextOf.get(prev) : chain[chain.indexOf(prev) + 1]) : chain[0];
          if (prev) ops.push({ op: "add_edge", edge: { from: prev, to: id, type: "NEXT" } });
          if (oldNext) ops.push({ op: "add_edge", edge: { from: id, to: oldNext, type: "NEXT" } });
          if (prev) nextOf.set(prev, id);
          nextOf.set(id, oldNext);
          newIds.push(id);
          break;
        }
        case "add_protocol": {
          if (scopePath(op.scope)[0] !== op.scope) {
            err(`scope ${op.scope} is not a scope id`);
            break;
          }
          if (!TRIGGERS.includes(op.trigger as any)) {
            err(`trigger must be one of ${TRIGGERS.join(", ")}`);
            break;
          }
          if (!Array.isArray(op.response) || !op.response.length || op.response.some((r) => !ACTIONS.includes(r?.action as any))) {
            err("response must be a list of { action, args } with engine actions");
            break;
          }
          const id = uid("proto", op.label);
          ops.push({ op: "add_node", node: { id, type: "Protocol", label: op.label, props: { trigger: op.trigger, response: op.response, then: op.then === "continue" ? "continue" : "stop" } } });
          ops.push({ op: "add_edge", edge: { from: id, to: op.scope, type: "APPLIES_TO" } });
          newIds.push(id);
          break;
        }
        case "set_parameter": {
          const n = live(op.node);
          if (!n) {
            err(`node ${op.node} does not exist or is retired`);
            break;
          }
          if (n.type === "Guardrail") touches_guardrail = true;
          if (n.type === "Rule" && op.key === "then") {
            const v = op.value as any;
            const check = RULE_PARAMS[v?.param as keyof typeof RULE_PARAMS];
            if (!check || !check(v.value)) {
              err("then must be { param, value } with an allowed param and value");
              break;
            }
          }
          if (["retired_in", "id", "type"].includes(op.key)) {
            err(`key ${op.key} cannot be set`);
            break;
          }
          ops.push({ op: "set_prop", id: op.node, key: op.key, value: op.value });
          break;
        }
        case "retire_node": {
          const n = live(op.node);
          if (!n) {
            err(`node ${op.node} does not exist or is already retired`);
            break;
          }
          if (n.type === "Scope") {
            err("scope nodes cannot be retired");
            break;
          }
          if (n.type === "Guardrail") touches_guardrail = true;
          ops.push({ op: "retire_node", id: op.node, reason: op.reason });
          break;
        }
        default:
          err(`unknown tool; use add_rule, insert_step, add_protocol, set_parameter or retire_node`);
      }
    }

    // ground the new nodes: one Evidence node per cited insight that has evidence
    for (const c of cited) {
      const ev = evidence[c];
      if (!ev || !newIds.length) continue;
      const evId = uid("ev", `${u.id}-${c}`);
      ops.push({ op: "add_node", node: { id: evId, ...ev } });
      for (const nid of newIds) ops.push({ op: "add_edge", edge: { from: nid, to: evId, type: "SUPPORTED_BY" } });
    }

    if (!errors.length) {
      const res = brain.validate(base, ops);
      for (const e of res.errors) errors.push(`compiled op ${e.i + 1}: ${e.msg}`);
    }
    out[u.id] = { valid: errors.length === 0, errors, touches_guardrail, compiled: errors.length ? [] : ops };
  }
  return out;
}

/** JSON schema for the supervisor's final answer (guides the model; the server still validates every op). */
export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    failures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "F1, F2, ..." },
          robot: { type: "string" },
          task_id: { type: "string" },
          step: { type: "integer" },
          check: { type: "string", description: "e.g. GRASP_REFUSED, OVERREACH, WRONG_SLOT, EMPTY_SLOT, NOT_DELIVERED" },
          nodes_in_effect: { type: "array", items: { type: "string" } },
          cause: { type: "string" },
        },
        required: ["id", "robot", "task_id", "step", "check", "nodes_in_effect", "cause"],
      },
    },
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "I1, I2, ..." },
          claim: { type: "string" },
          addresses: { type: "array", items: { type: "string" }, description: "failure ids" },
          grounding: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["clip", "run_contrast", "citation"] },
                clip_id: { type: "string" },
                source_id: { type: "string", description: "S1, S2, ...: a source the research tool returned" },
                ok_run: { type: "string", description: "shift_id/robot of the run that went better" },
                failed_run: { type: "string", description: "shift_id/robot of the failed run" },
                note: { type: "string" },
              },
              required: ["kind", "note"],
            },
          },
        },
        required: ["id", "claim", "addresses", "grounding"],
      },
    },
    updates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "U1, U2, ..." },
          summary: { type: "string", description: "the change in plain English" },
          ops: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", enum: ["add_rule", "insert_step", "add_protocol", "set_parameter", "retire_node"] },
                cites: { type: "array", items: { type: "string" } },
              },
              required: ["tool", "cites"],
              additionalProperties: true,
            },
          },
        },
        required: ["id", "summary", "ops"],
      },
    },
  },
  required: ["failures", "insights", "updates"],
} as const;
