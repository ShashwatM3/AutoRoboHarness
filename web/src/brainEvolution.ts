import type { BrainGraphData } from "./api.ts";
import type { VersionRow } from "./BrainExplorer.tsx";
import { compareGraphs, edgeKey } from "./brainComparison.ts";

/** Recorded parents determine ancestry; rejected branches are not intermediate versions. */
export function ancestry(versions: VersionRow[], tip: number) {
  const byVersion = new Map(versions.map((v) => [v.v, v]));
  const result: number[] = [], seen = new Set<number>();
  let current: number | null = tip;
  while (current != null && !seen.has(current)) {
    const row = byVersion.get(current);
    if (!row) break;
    seen.add(current); result.unshift(current); current = row.parent;
  }
  return result;
}

export function evolutionGraph(graphs: Map<number, BrainGraphData>, path: number[]) {
  const first = graphs.get(path[0]), last = graphs.get(path.at(-1)!);
  if (!first || !last) return null;
  const origins = new Map(first.nodes.map((n) => [n.id, first.version]));
  for (let i = 1; i < path.length; i++) {
    const parent = graphs.get(path[i - 1]), child = graphs.get(path[i]);
    if (!parent || !child) return null;
    compareGraphs(parent, child).nodes.added.forEach((n) => origins.set(n.id, child.version));
  }
  const diff = compareGraphs(first, last);
  const changed = new Set([
    ...diff.nodes.added.map((n) => n.id), ...diff.nodes.removed.map((n) => n.id),
    ...diff.nodes.changed.map((n) => n.key),
    ...diff.edges.added.flatMap((e) => [e.from, e.to]),
    ...diff.edges.removed.flatMap((e) => [e.from, e.to]),
    ...diff.edges.changed.flatMap((e) => {
      const edge = last.edges.find((v) => edgeKey(v) === e.key);
      return edge ? [edge.from, edge.to] : [];
    }),
  ]);
  const nodes = [...last.nodes, ...diff.nodes.removed].filter((n) => changed.has(n.id));
  const edges = [...last.edges, ...diff.edges.removed].filter((e) => changed.has(e.from) && changed.has(e.to));
  return { first, last, diff, origins, focus: { ...last, nodes, edges } };
}
