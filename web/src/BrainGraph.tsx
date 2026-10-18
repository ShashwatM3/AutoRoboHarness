import { useEffect, useId, useMemo, useRef, useState } from "react";
import { GitBranch, Maximize2, Minus, Plus } from "lucide-react";
import { seededRandom } from "../../engine/store.ts";
import type { BrainGraphData } from "./api.ts";
import { edgeKey } from "./brainComparison.ts";

const COLORS: Record<string, string> = {
  Scope: "#aebc91",
  Procedure: "#db9a63",
  Step: "#809cbd",
  Rule: "#a68bb7",
  Guardrail: "#ca8779",
  Protocol: "#a89060",
  Evidence: "#7da792",
};
type Positioned = {
  id: string;
  x: number;
  y: number;
  type: string;
  label: string;
  retired: boolean;
};

function layout(data: BrainGraphData) {
  const rand = seededRandom(1729);
  const nodes: Positioned[] = data.nodes.map((n) => ({
    ...n,
    retired: !!n.props.retired_in,
    x: 70 + rand() * 450,
    y: 20 + rand() * 170,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let tick = 0; tick < 220; tick++) {
    const alpha = 1 - tick / 240;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const o = nodes[j],
          dx = n.x - o.x,
          dy = n.y - o.y;
        const distance = Math.max(6, Math.hypot(dx, dy)),
          f = (40 * alpha) / (distance * distance);
        n.x += dx * f;
        n.y += dy * f;
        o.x -= dx * f;
        o.y -= dy * f;
      }
      n.x +=
        ((n.type === "Scope" ? 170 : n.type === "Step" ? 420 : 300) - n.x) *
        0.002 *
        alpha;
      n.y += (110 - n.y) * 0.008 * alpha;
    }
    for (const edge of data.edges) {
      const a = byId.get(edge.from),
        b = byId.get(edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        distance = Math.max(1, Math.hypot(dx, dy));
      const f = ((distance - 37) / distance) * 0.035 * alpha;
      a.x += dx * f;
      a.y += dy * f;
      b.x -= dx * f;
      b.y -= dy * f;
    }
  }
  if (nodes.length) {
    const minX = Math.min(...nodes.map((n) => n.x)),
      maxX = Math.max(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y)),
      maxY = Math.max(...nodes.map((n) => n.y));
    for (const n of nodes) {
      n.x = 22 + ((n.x - minX) / Math.max(1, maxX - minX)) * 556;
      n.y = 16 + ((n.y - minY) / Math.max(1, maxY - minY)) * 188;
    }
  }
  return { nodes, byId };
}

export default function BrainGraph({
  data,
  readIds,
  epoch,
  error,
  addedIds = [],
  retiredIds = [],
  changedIds = [],
  addedEdges = [],
  removedEdges = [],
  changedEdges = [],
  nodeAccents,
  heading = "Shared brain",
}: {
  data: BrainGraphData | null;
  readIds: string[];
  epoch: number;
  error: string | null;
  addedIds?: string[];
  retiredIds?: string[];
  changedIds?: string[];
  addedEdges?: string[];
  removedEdges?: string[];
  changedEdges?: string[];
  nodeAccents?: Record<string, { color: string; label: string }>;
  heading?: string;
}) {
  const positions = useMemo(() => (data ? layout(data) : null), [data]);
  const markerId = `graph-arrow-${useId().replaceAll(":", "")}`;
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 600 });
  const [query, setQuery] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    scale: number;
  } | null>(null);
  useEffect(() => {
    setViewport({ x: 0, y: 0, width: 600 });
    setSelected(null);
    setSelectedEdge(null);
    setQuery("");
  }, [data?.version]);
  const zoom = (factor: number, anchor?: { x: number; y: number }) =>
    setViewport((v) => {
      const width = Math.max(40, Math.min(1800, v.width / factor));
      const point = anchor ?? {
        x: v.x + v.width / 2,
        y: v.y + (v.width * 220) / 600 / 2,
      };
      const ratio = width / v.width;
      return {
        x: point.x - (point.x - v.x) * ratio,
        y: point.y - (point.y - v.y) * ratio,
        width,
      };
    });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      );
      zoom(Math.exp(-event.deltaY * 0.0015), p);
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [!!data]);
  const focusNode = (id: string) => {
    const p = positions?.byId.get(id);
    if (!p) return;
    setSelected(id);
    setSelectedEdge(null);
    setQuery("");
    setViewport({ x: p.x - 100, y: p.y - (100 * 220) / 600, width: 200 });
  };
  const selectedNode = data?.nodes.find((n) => n.id === selected);
  const edge = selectedEdge == null ? null : data?.edges[selectedEdge];
  const active = new Set(readIds);
  const neighbors = new Set(
    selected
      ? [
          selected,
          ...(data?.edges
            .filter((e) => e.from === selected || e.to === selected)
            .flatMap((e) => [e.from, e.to]) ?? []),
        ]
      : [],
  );
  return (
    <section className="brain-card">
      <div className="card-toolbar">
        <div>
          <GitBranch size={15} />
          <strong>{heading}</strong>
          {data && <span className="subtle-tag">v{data.version}</span>}
        </div>
        <span className="graph-count">
          {data
            ? `${data.nodes.length} NODES · ${data.edges.length} CONNECTIONS`
            : "CONNECTING"}
        </span>
      </div>
      {data && (
        <div className="graph-navigation">
          <label>
            <input
              aria-label={`Find a node in brain v${data.version}`}
              placeholder="Find node by name or ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="graph-zoom-buttons">
            <button
              title="Zoom in"
              aria-label={`Zoom in brain v${data.version}`}
              onClick={() => zoom(1.5)}
            >
              <Plus size={14} />
            </button>
            <button
              title="Zoom out"
              aria-label={`Zoom out brain v${data.version}`}
              onClick={() => zoom(1 / 1.5)}
            >
              <Minus size={14} />
            </button>
            <button
              title="Fit graph"
              aria-label={`Fit brain v${data.version} graph`}
              onClick={() => {
                setViewport({ x: 0, y: 0, width: 600 });
                setSelected(null);
                setSelectedEdge(null);
              }}
            >
              <Maximize2 size={14} />
            </button>
            <span>{Math.round((600 / viewport.width) * 100)}%</span>
          </div>
          {query && (
            <div className="graph-search-results">
              {data.nodes
                .filter((n) =>
                  `${n.id} ${n.label} ${n.type}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .slice(0, 20)
                .map((n) => (
                  <button key={n.id} onClick={() => focusNode(n.id)}>
                    <strong>{n.label}</strong>
                    <small>
                      {n.type} · {n.id}
                    </small>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
      <div className="brain-body">
        {positions && data ? (
          <svg
            ref={svgRef}
            viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${(viewport.width * 220) / 600}`}
            role="group"
            tabIndex={0}
            aria-label={`Interactive knowledge graph for brain version ${data.version}. Scroll to zoom, drag to pan, double-click a node to focus.`}
            style={{
              touchAction: "none",
              cursor: drag.current ? "grabbing" : "grab",
            }}
            onPointerDown={(e) => {
              if ((e.target as Element).closest(".graph-node, line")) return;
              const scale = svgRef.current?.getScreenCTM()?.a ?? 1;
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                startX: viewport.x,
                startY: viewport.y,
                scale,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d)
                setViewport((v) => ({
                  ...v,
                  x: d.startX - (e.clientX - d.x) / d.scale,
                  y: d.startY - (e.clientY - d.y) / d.scale,
                }));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onKeyDown={(e) => {
              if (e.key === "+" || e.key === "=") zoom(1.5);
              if (e.key === "-") zoom(1 / 1.5);
              if (e.key === "Escape" || e.key === "0") {
                setViewport({ x: 0, y: 0, width: 600 });
                setSelected(null);
                setSelectedEdge(null);
              }
            }}
          >
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#8fa77b" />
              </marker>
            </defs>
            {data.edges.map((edge, i) => {
              const a = positions.byId.get(edge.from),
                b = positions.byId.get(edge.to);
              return a && b ? (
                <line
                  key={`${i}-${edge.from}`}
                  x1={a.x}
                  y1={a.y}
                  x2={
                    b.x -
                    ((b.x - a.x) /
                      Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) *
                      7
                  }
                  y2={
                    b.y -
                    ((b.y - a.y) /
                      Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) *
                      7
                  }
                  markerEnd={`url(#${markerId})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Edge ${edgeKey(edge)}`}
                  onClick={() => {
                    setSelected(null);
                    setSelectedEdge(i);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSelected(null);
                      setSelectedEdge(i);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                  opacity={
                    selected && edge.from !== selected && edge.to !== selected
                      ? 0.2
                      : 1
                  }
                  stroke={
                    removedEdges.includes(edgeKey(edge))
                      ? "#bd644d"
                      : addedEdges.includes(edgeKey(edge))
                        ? "#378557"
                        : changedEdges.includes(edgeKey(edge))
                          ? "#d29135"
                          : active.has(a.id) && active.has(b.id)
                            ? "#a4b788"
                            : selected &&
                                (edge.from === selected || edge.to === selected)
                              ? "#648a5c"
                              : "#c8d3b8"
                  }
                  strokeWidth={
                    selectedEdge === i ||
                    addedEdges.includes(edgeKey(edge)) ||
                    removedEdges.includes(edgeKey(edge)) ||
                    changedEdges.includes(edgeKey(edge))
                      ? 3
                      : 1.5
                  }
                />
              ) : null;
            })}
            {positions.nodes.map((n) => (
              <g
                key={n.id}
                opacity={
                  selected && !neighbors.has(n.id)
                    ? 0.2
                    : n.retired || retiredIds.includes(n.id)
                      ? 0.5
                      : 1
                }
                role="button"
                tabIndex={0}
                aria-label={`${n.type}: ${n.label}`}
                onClick={() => {
                  setSelected(n.id);
                  setSelectedEdge(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setSelected(n.id);
                    setSelectedEdge(null);
                  }
                }}
                className="graph-node"
                onDoubleClick={() => focusNode(n.id)}
              >
                <title>
                  {n.type}: {n.label}
                </title>
                {active.has(n.id) && (
                  <circle
                    key={`${n.id}-${epoch}`}
                    cx={n.x}
                    cy={n.y}
                    r={10}
                    fill="none"
                    stroke="#88a864"
                    strokeWidth={1.5}
                    className="node-pulse"
                  />
                )}
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.type === "Scope" ? 5 : n.type === "Procedure" ? 6 : 4}
                  fill={
                    changedIds.includes(n.id)
                      ? "#d29135"
                      : retiredIds.includes(n.id)
                        ? "#bd644d"
                        : addedIds.includes(n.id)
                          ? "#4b995b"
                          : (nodeAccents?.[n.id]?.color ?? COLORS[n.type] ?? "#b3bd9e")
                  }
                  stroke={selected === n.id ? "#294d38" : "#f7f9f0"}
                  strokeWidth={selected === n.id ? 2 : 1.5}
                />
                {(viewport.width < 350 ||
                  n.type === "Procedure" ||
                  selected === n.id ||
                  n.id === "store") && (
                  <text x={n.x + 9} y={n.y + 3} fontSize={7} fill="#657958">
                    {n.label.slice(0, 28)}
                  </text>
                )}
              </g>
            ))}
          </svg>
        ) : (
          <div className="brain-empty">
            {error ?? "Loading the live knowledge graph…"}
          </div>
        )}
        <div className="graph-description">
          {edge ? (
            <>
              <strong>{edge.type}</strong>
              <span>
                {edge.from} → {edge.to}
              </span>
              <pre>{JSON.stringify(edge, null, 2)}</pre>
            </>
          ) : selectedNode ? (
            <>
              <strong>{selectedNode.label}</strong>
              <span>
                {selectedNode.type} · {selectedNode.id}{nodeAccents?.[selectedNode.id] ? ` · ${nodeAccents[selectedNode.id].label}` : ""}
              </span>
              <p>
                {Object.entries(selectedNode.props)
                  .map(
                    ([k, v]) =>
                      `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
                  )
                  .join(" · ")}
              </p>
            </>
          ) : (
            <>
              <strong>Knowledge every robot shares.</strong>
              <p>
                Scroll to zoom. Drag empty space to pan. Double-click a node to
                focus; click a node or edge for its data. Selecting a node
                highlights its neighbors.
              </p>
              <div className="graph-legend">
                {[
                  "Scope",
                  "Procedure",
                  "Step",
                  "Rule",
                  "Guardrail",
                  "Protocol",
                ].map((type) => (
                  <span key={type}>
                    <i style={{ background: COLORS[type] }} />
                    {type}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
