// The brain: versioned knowledge graph files in brain/, loaded with graphology.
// Version files are immutable; status (live, candidate, rejected) lives in brain/index.json.

import fs from "node:fs";
import path from "node:path";
import Graph from "graphology";
import {
  ACTIONS,
  EDGE_TYPES,
  NODE_TYPES,
  type BrainDiff,
  type BrainEdge,
  type BrainFile,
  type BrainIndex,
  type BrainNode,
  type BrainOp,
  type ResolvedContext,
  type VersionStatus,
} from "./types.ts";

const edgeKey = (e: BrainEdge) => `${e.from}|${e.type}|${e.to}`;
const isRetired = (n: BrainNode) => n.props?.retired_in != null;

// ---------- scope ids ----------

// Slot ids follow the engine: "<aisle>-<bay>-<level>-<position>", for example A-3-4-1.
const SLOT_RE = /^([A-Z])-(\d+)-(\d+)-(\d+)$/;

/** The scope path from the deepest scope to the store, for a slot id, a waypoint/zone name, or a scope id. */
export function scopePath(scope: string): string[] {
  const [prefix, bare] = scope.includes(":") ? scope.split(":", 2) : [null, scope];
  // engine locations: backroom stock "backroom:A-3-4-1", reserve "reserve:A-3-4-1", the packing tote "tote"
  if (prefix === "backroom" || prefix === "reserve" || scope === "backroom") return ["zone:backroom", "store"];
  if (scope === "tote" || scope === "packing") return ["zone:packing", "store"];
  const m = SLOT_RE.exec(bare);
  if (m && (!prefix || prefix === "slot")) {
    const [, a, b, l] = m;
    return [`slot:${bare}`, `level:${a}-${b}-${l}`, `bay:${a}-${b}`, `aisle:${a}`, "store"];
  }
  if (prefix === "level" || /^[A-Z]-\d+-\d+$/.test(bare)) {
    const [a, b, l] = bare.split("-");
    return [`level:${a}-${b}-${l}`, `bay:${a}-${b}`, `aisle:${a}`, "store"];
  }
  if (prefix === "bay" || /^[A-Z]-\d+$/.test(bare)) {
    const [a, b] = bare.split("-");
    return [`bay:${a}-${b}`, `aisle:${a}`, "store"];
  }
  if (prefix === "aisle" || /^[A-Z]$/.test(bare)) return [`aisle:${bare}`, "store"];
  if (bare === "store") return ["store"];
  return [`zone:${bare}`, "store"];
}

function scopeKind(id: string): string {
  return id === "store" ? "store" : id.split(":")[0];
}

// ---------- the store ----------

export class BrainStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private cache = new Map<number, { file: BrainFile; graph: Graph }>();

  // ----- files -----

  private filePath(v: number) {
    return path.join(this.dir, `v${v}.json`);
  }

  versionsOnDisk(): number[] {
    return fs
      .readdirSync(this.dir)
      .map((f) => /^v(\d+)\.json$/.exec(f)?.[1])
      .filter((x): x is string => !!x)
      .map(Number)
      .sort((a, b) => a - b);
  }

  index(): BrainIndex {
    const p = path.join(this.dir, "index.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    // first boot: the lowest version on disk is live
    const vs = this.versionsOnDisk();
    if (!vs.length) throw new Error(`no brain versions in ${this.dir}`);
    const idx: BrainIndex = {
      live: vs[0],
      versions: vs.map((v) => {
        const f = this.file(v);
        return { v, parent: f.parent, status: v === vs[0] ? "live" : "candidate", created_at: f.created_at, note: f.note };
      }),
    };
    this.writeIndex(idx);
    return idx;
  }

  private writeIndex(idx: BrainIndex) {
    fs.writeFileSync(path.join(this.dir, "index.json"), JSON.stringify(idx, null, 2) + "\n");
  }

  resolveVersion(v: number | string | undefined): number {
    if (v === undefined || v === "live" || v === "") return this.index().live;
    const n = Number(v);
    if (!Number.isInteger(n) || !fs.existsSync(this.filePath(n))) throw httpError(404, `brain version ${v} not found`);
    return n;
  }

  file(v: number): BrainFile {
    return this.load(v).file;
  }

  graph(v: number): Graph {
    return this.load(v).graph;
  }

  private load(v: number) {
    const hit = this.cache.get(v);
    if (hit) return hit;
    const file: BrainFile = JSON.parse(fs.readFileSync(this.filePath(v), "utf8"));
    const graph = new Graph({ type: "directed", multi: true });
    for (const n of file.nodes) graph.addNode(n.id, n);
    for (const e of file.edges) graph.addEdgeWithKey(edgeKey(e), e.from, e.to, e);
    const entry = { file, graph };
    this.cache.set(v, entry);
    return entry;
  }

  setStatus(v: number, status: VersionStatus, extra: { heldout_score?: number } = {}) {
    const idx = this.index();
    const row = idx.versions.find((r) => r.v === v);
    if (!row) throw httpError(404, `brain version ${v} not in index`);
    if (status === "live") {
      for (const r of idx.versions) if (r.status === "live") r.status = "superseded";
      idx.live = v;
    }
    row.status = status;
    Object.assign(row, extra);
    this.writeIndex(idx);
  }

  // ----- reads -----

  node(v: number, id: string): BrainNode | undefined {
    const g = this.graph(v);
    return g.hasNode(id) ? (g.getNodeAttributes(id) as BrainNode) : undefined;
  }

  /** Every Procedure, Rule, Guardrail and Protocol attached along the scope path; a deeper node wins over a shallower one with the same key. */
  resolve(v: number, scope: string, task?: string): ResolvedContext {
    const g = this.graph(v);
    const sp = scopePath(scope);
    const attached = (scopeId: string) =>
      g.hasNode(scopeId)
        ? g
            .inEdges(scopeId)
            .map((e) => g.getEdgeAttributes(e) as BrainEdge)
            .filter((e) => e.type === "APPLIES_TO")
            .map((e) => g.getNodeAttributes(e.from) as BrainNode)
            .filter((n) => !isRetired(n))
        : [];

    // walk store -> slot so deeper scopes overwrite shallower ones on the same key
    const byKey = new Map<string, BrainNode & { scope: string; depth: number }>();
    const rev = [...sp].reverse();
    rev.forEach((scopeId, depth) => {
      for (const n of attached(scopeId).sort((a, b) => a.id.localeCompare(b.id))) {
        if (n.type === "Procedure" && task && n.props.task !== task) continue;
        byKey.set(nodeKey(n), { ...n, scope: scopeId, depth });
      }
    });
    const picked = [...byKey.values()];
    const ofType = (t: string) =>
      picked.filter((n) => n.type === t).sort((a, b) => b.depth - a.depth || (b.props.priority ?? 0) - (a.props.priority ?? 0) || a.id.localeCompare(b.id));

    const procNode = ofType("Procedure")[0];
    const procedure = procNode ? { id: procNode.id, label: procNode.label, steps: this.steps(v, procNode.id) } : null;
    const rules = ofType("Rule");
    const guardrails = ofType("Guardrail");
    const protocols = ofType("Protocol");

    const node_ids = [
      ...sp.filter((id) => g.hasNode(id)),
      ...(procedure ? [procedure.id, ...procedure.steps.map((s) => s.id)] : []),
      ...rules.map((n) => n.id),
      ...guardrails.map((n) => n.id),
      ...protocols.map((n) => n.id),
    ];
    const ctx: ResolvedContext = { version: v, scope_path: sp, procedure, rules, guardrails, protocols, node_ids, text: "" };
    ctx.text = renderContext(ctx, task);
    return ctx;
  }

  /** A procedure's live steps in NEXT order. */
  steps(v: number, procId: string) {
    const g = this.graph(v);
    const steps = g
      .inEdges(procId)
      .map((e) => g.getEdgeAttributes(e) as BrainEdge)
      .filter((e) => e.type === "STEP_OF")
      .map((e) => g.getNodeAttributes(e.from) as BrainNode)
      .filter((n) => !isRetired(n));
    const ids = new Set(steps.map((s) => s.id));
    const next = new Map<string, string>();
    const hasPrev = new Set<string>();
    for (const s of steps) {
      for (const e of g.outEdges(s.id)) {
        const ea = g.getEdgeAttributes(e) as BrainEdge;
        if (ea.type === "NEXT" && ids.has(ea.to)) {
          next.set(s.id, ea.to);
          hasPrev.add(ea.to);
        }
      }
    }
    const ordered: BrainNode[] = [];
    let cur = steps.find((s) => !hasPrev.has(s.id))?.id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      ordered.push(g.getNodeAttributes(cur) as BrainNode);
      cur = next.get(cur);
    }
    // steps not on the chain (a broken edit) go last, so nothing silently disappears
    for (const s of steps) if (!seen.has(s.id)) ordered.push(s);
    return ordered.map((s) => ({ id: s.id, label: s.label, action: s.props.action, args: s.props.args ?? {} }));
  }

  diff(a: number, b: number): BrainDiff {
    const A = this.file(a);
    const B = this.file(b);
    const an = new Map(A.nodes.map((n) => [n.id, n]));
    const added_nodes: BrainNode[] = [];
    const retired_nodes: BrainNode[] = [];
    const changed: BrainDiff["changed"] = [];
    for (const n of B.nodes) {
      const o = an.get(n.id);
      if (!o) {
        added_nodes.push(n);
        continue;
      }
      if (!isRetired(o) && isRetired(n)) retired_nodes.push(n);
      if (o.label !== n.label) changed.push({ id: n.id, key: "label", from: o.label, to: n.label });
      const keys = new Set([...Object.keys(o.props ?? {}), ...Object.keys(n.props ?? {})]);
      for (const k of keys) {
        if (k === "retired_in" || k === "retired_reason") continue;
        if (JSON.stringify(o.props?.[k]) !== JSON.stringify(n.props?.[k])) changed.push({ id: n.id, key: k, from: o.props?.[k], to: n.props?.[k] });
      }
    }
    const ae = new Set(A.edges.map(edgeKey));
    const be = new Set(B.edges.map(edgeKey));
    return {
      from: a,
      to: b,
      added_nodes,
      retired_nodes,
      changed,
      added_edges: B.edges.filter((e) => !ae.has(edgeKey(e))),
      removed_edges: A.edges.filter((e) => !be.has(edgeKey(e))),
    };
  }

  // ----- writes -----

  /** Check storage operations against a base version without writing anything. */
  validate(base: number, ops: BrainOp[]): { ok: boolean; errors: { i: number; msg: string }[]; nodes: BrainNode[]; edges: BrainEdge[] } {
    const src = this.file(base);
    const nodes = new Map(src.nodes.map((n) => [n.id, structuredClone(n)]));
    const edges = new Map(src.edges.map((e) => [edgeKey(e), e]));
    const errors: { i: number; msg: string }[] = [];
    const nextV = Math.max(...this.versionsOnDisk()) + 1;

    // a rule may target a scope that has no node yet (for example a level); create the scope chain
    const ensureScope = (id: string) => {
      const sp = scopePath(id);
      if (sp[0] !== id) return false;
      for (let i = 0; i < sp.length; i++) {
        if (!nodes.has(sp[i])) {
          nodes.set(sp[i], { id: sp[i], type: "Scope", label: sp[i], props: { kind: scopeKind(sp[i]) } });
          if (i + 1 < sp.length) {
            const e: BrainEdge = { from: sp[i], to: sp[i + 1], type: "PART_OF" };
            edges.set(edgeKey(e), e);
          }
        }
      }
      return true;
    };

    ops.forEach((op, i) => {
      const err = (msg: string) => errors.push({ i, msg });
      switch (op?.op) {
        case "add_node": {
          const n = op.node;
          if (!n?.id || !n.type || typeof n.label !== "string") return err("add_node needs node.id, node.type and node.label");
          if (!NODE_TYPES.includes(n.type)) return err(`unknown node type ${n.type}`);
          if (nodes.has(n.id)) return err(`node ${n.id} already exists`);
          if (n.type === "Step" && !ACTIONS.includes(n.props?.action)) return err(`step ${n.id} has unknown action ${n.props?.action}`);
          nodes.set(n.id, { id: n.id, type: n.type, label: n.label, props: n.props ?? {} });
          return;
        }
        case "add_edge": {
          const e = op.edge;
          if (!e?.from || !e.to || !EDGE_TYPES.includes(e.type)) return err("add_edge needs from, to and a known type");
          if (!nodes.has(e.to) && !(e.type === "APPLIES_TO" && ensureScope(e.to))) return err(`edge target ${e.to} does not exist`);
          if (!nodes.has(e.from)) return err(`edge source ${e.from} does not exist`);
          if (edges.has(edgeKey(e))) return err(`edge ${edgeKey(e)} already exists`);
          edges.set(edgeKey(e), { from: e.from, to: e.to, type: e.type });
          return;
        }
        case "set_prop": {
          const n = nodes.get(op.id);
          if (!n) return err(`node ${op.id} does not exist`);
          if (isRetired(n)) return err(`node ${op.id} is retired`);
          if (!op.key || op.key === "retired_in") return err("set_prop needs a key (and cannot set retired_in)");
          if (op.key === "label") n.label = String(op.value);
          else n.props[op.key] = op.value;
          return;
        }
        case "retire_node": {
          const n = nodes.get(op.id);
          if (!n) return err(`node ${op.id} does not exist`);
          if (isRetired(n)) return err(`node ${op.id} is already retired`);
          n.props.retired_in = nextV;
          if (op.reason) n.props.retired_reason = op.reason;
          return;
        }
        default:
          err(`unknown op ${(op as any)?.op}`);
      }
    });
    return { ok: errors.length === 0, errors, nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  /** Write brain/v(N+1).json from a base version plus operations. Never edits an existing file. */
  apply(base: number, ops: BrainOp[], meta: { note?: string; created_by?: BrainFile["created_by"]; promote?: boolean } = {}) {
    const res = this.validate(base, ops);
    if (!res.ok) throw httpError(400, "invalid operations", { errors: res.errors });
    const v = Math.max(...this.versionsOnDisk()) + 1;
    const file: BrainFile = {
      version: v,
      parent: base,
      created_at: new Date().toISOString(),
      created_by: meta.created_by ?? "human",
      note: meta.note ?? "",
      ops,
      nodes: res.nodes,
      edges: res.edges,
    };
    fs.writeFileSync(this.filePath(v), JSON.stringify(file, null, 2) + "\n", { flag: "wx" });
    const idx = this.index();
    idx.versions.push({ v, parent: base, status: "candidate", created_at: file.created_at, note: file.note });
    this.writeIndex(idx);
    if (meta.promote) this.setStatus(v, "live");
    return { version: v, diff: this.diff(base, v) };
  }
}

// ---------- helpers ----------

/** Nodes with the same key compete; the deeper scope wins. */
function nodeKey(n: BrainNode): string {
  switch (n.type) {
    case "Procedure":
      return `Procedure:${n.props.task}`;
    case "Rule":
      return `Rule:${n.props.then?.param}:${JSON.stringify(n.props.when ?? [])}`;
    case "Guardrail":
      return `Guardrail:${n.props.param}`;
    case "Protocol":
      return `Protocol:${n.props.trigger}`;
    default:
      return `${n.type}:${n.id}`;
  }
}

const fmtArgs = (a: Record<string, unknown>) =>
  Object.keys(a).length ? " " + Object.entries(a).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : "";
const fmtCond = (c: any) => `${c.field} ${c.op} ${JSON.stringify(c.value)}`;

/** The canonical brain block for a worker prompt. Same version, scope and task always give the same bytes. */
function renderContext(ctx: ResolvedContext, task?: string): string {
  const L: string[] = [];
  L.push(`BRAIN v${ctx.version} | scope ${ctx.scope_path.join(" < ")}${task ? ` | task ${task}` : ""}`);
  if (ctx.procedure) {
    L.push(`PROCEDURE [${ctx.procedure.id}] ${ctx.procedure.label}`);
    ctx.procedure.steps.forEach((s, i) => L.push(`  ${i + 1}. [${s.id}] ${s.action}${fmtArgs(s.args)} | ${s.label}`));
  }
  if (ctx.rules.length) {
    L.push("RULES (deeper scope first, then higher priority)");
    for (const r of ctx.rules) {
      const when = (r.props.when ?? []).length ? ` when ${(r.props.when as any[]).map(fmtCond).join(" and ")}` : "";
      L.push(`  [${r.id}] @${r.scope}${when}: ${r.props.then?.param} = ${JSON.stringify(r.props.then?.value)} | ${r.label}`);
    }
  }
  if (ctx.guardrails.length) {
    L.push("GUARDRAILS (enforced)");
    for (const gd of ctx.guardrails) L.push(`  [${gd.id}] @${gd.scope}: ${gd.props.param} ${gd.props.op} ${gd.props.value} | ${gd.label}`);
  }
  if (ctx.protocols.length) {
    L.push("PROTOCOLS");
    for (const p of ctx.protocols) {
      const resp = (p.props.response ?? []).map((r: any) => `${r.action}${fmtArgs(r.args ?? {})}`).join(", ");
      L.push(`  [${p.id}] @${p.scope} on ${p.props.trigger}: ${resp}${p.props.then ? `, then ${p.props.then}` : ""} | ${p.label}`);
    }
  }
  return L.join("\n");
}

export function httpError(status: number, message: string, extra: object = {}) {
  return Object.assign(new Error(message), { status, extra });
}
