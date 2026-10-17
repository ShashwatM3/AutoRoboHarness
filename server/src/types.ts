// Shared brain types: the Brain node, edge, and operation contract (Person B).

export const NODE_TYPES = ["Scope", "Procedure", "Step", "Rule", "Guardrail", "Protocol", "Evidence"] as const;
// PART_OF links the scope tree (slot -> level -> bay -> aisle or zone -> store).
export const EDGE_TYPES = ["APPLIES_TO", "STEP_OF", "NEXT", "SUPPORTED_BY", "REPLACES", "PART_OF"] as const;
export const ACTIONS = ["navigate_to", "set_torso", "scan_slot", "reach", "grasp", "retract", "place", "report_issue"] as const;

export type NodeType = (typeof NODE_TYPES)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export type Action = (typeof ACTIONS)[number];

// props by type:
// Scope:     { kind: "store" | "zone" | "aisle" | "bay" | "level" | "slot" }
// Procedure: { task: "PICK" | "RESTOCK" }
// Step:      { action: Action, args?: Record<string, unknown> }   // args may use "$task.source", "$rule.grasp.mode"
// Rule:      { when: Cond[], then: { param: string, value: unknown }, priority: number }
// Guardrail: { param: string, op: "<=" | ">=" | "==", value: number, locked: true }
// Protocol:  { trigger: string, response: { action: Action, args?: object }[], then?: "continue" | "stop" }
// Evidence:  { kind: "doc" | "clip" | "run_contrast" | "citation", ... }
// Any node:  { retired_in?: number, retired_reason?: string }
export interface BrainNode {
  id: string;
  type: NodeType;
  label: string;
  props: Record<string, any>;
}

export interface BrainEdge {
  from: string;
  to: string;
  type: EdgeType;
}

export interface Cond {
  field: "item.weight_kg" | "slot.level" | "task.type" | string;
  op: ">" | ">=" | "<" | "<=" | "==" | "!=";
  value: number | string | boolean;
}

export type BrainOp =
  | { op: "add_node"; node: BrainNode }
  | { op: "add_edge"; edge: BrainEdge }
  | { op: "set_prop"; id: string; key: string; value: unknown }
  | { op: "retire_node"; id: string; reason?: string };

export interface BrainFile {
  version: number;
  parent: number | null;
  created_at: string;
  created_by: "seed" | "supervisor" | "human";
  note: string;
  ops: BrainOp[];
  nodes: BrainNode[];
  edges: BrainEdge[];
}

export type VersionStatus = "live" | "candidate" | "rejected" | "superseded";

export interface BrainIndex {
  live: number;
  versions: { v: number; parent: number | null; status: VersionStatus; created_at: string; note: string; heldout_score?: number }[];
}

export interface ResolvedContext {
  version: number;
  scope_path: string[]; // deepest first: slot -> level -> bay -> aisle -> store
  procedure: { id: string; label: string; steps: { id: string; label: string; action: Action; args: Record<string, unknown> }[] } | null;
  rules: (BrainNode & { scope: string; depth: number })[];
  guardrails: (BrainNode & { scope: string; depth: number })[];
  protocols: (BrainNode & { scope: string; depth: number })[];
  node_ids: string[]; // everything returned; the graph panel pulses these
  text: string; // canonical prompt block, byte-stable for a given version, scope and task
}

export interface BrainDiff {
  from: number;
  to: number;
  added_nodes: BrainNode[];
  retired_nodes: BrainNode[];
  changed: { id: string; key: string; from: unknown; to: unknown }[];
  added_edges: BrainEdge[];
  removed_edges: BrainEdge[];
}
