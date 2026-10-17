import type { BrainEdge, BrainGraphData } from "./api.ts";

export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
};
export const edgeKey = (edge: BrainEdge) =>
  `${edge.from} → ${edge.to} · ${edge.type}`;
export interface PropertyChange {
  path: string;
  before: unknown;
  after: unknown;
}
export function propertyChanges(
  before: unknown,
  after: unknown,
  path = "",
): PropertyChange[] {
  if (stableJson(before) === stableJson(after)) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .sort()
      .flatMap((k) => propertyChanges(a[k], b[k], path ? `${path}.${k}` : k));
  }
  return [{ path, before, after }];
}
export function compareGraphs(a: BrainGraphData, b: BrainGraphData) {
  const compare = <T>(left: T[], right: T[], key: (v: T) => string) => {
    const l = new Map(left.map((n) => [key(n), n])),
      r = new Map(right.map((n) => [key(n), n]));
    return {
      added: right.filter((n) => !l.has(key(n))),
      removed: left.filter((n) => !r.has(key(n))),
      changed: right.flatMap((n) =>
        l.has(key(n))
          ? (() => {
              const changes = propertyChanges(l.get(key(n)), n);
              return changes.length ? [{ key: key(n), changes }] : [];
            })()
          : [],
      ),
    };
  };
  return {
    nodes: compare(a.nodes, b.nodes, (n) => n.id),
    edges: compare(a.edges, b.edges, edgeKey),
  };
}
