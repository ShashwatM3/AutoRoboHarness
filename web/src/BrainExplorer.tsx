import { useEffect, useMemo, useState } from "react";
import { api, type BrainGraphData } from "./api.ts";
import BrainGraph from "./BrainGraph.tsx";
import {
  compareGraphs,
  edgeKey,
  type PropertyChange,
} from "./brainComparison.ts";

export interface VersionRow {
  v: number;
  parent: number | null;
  status: string;
  note: string;
  created_at: string;
  heldout_score?: number | null;
  heldout?: {
    gate_id: string;
    tasks: number;
    complete: number;
    worker: string;
  } | null;
}
export interface VersionIndex {
  live: number;
  versions: VersionRow[];
}
export interface Evaluation {
  evaluation_id: string;
  brain_version: number;
  tasks: number;
  complete: number;
  complete_rate: number;
  worker: string;
  partition?: "training" | "heldout";
  source?: string;
  replay_available?: boolean;
}

function Changes({
  rows,
}: {
  rows: { key: string; changes: PropertyChange[] }[];
}) {
  return (
    <>
      {rows.map((row) => (
        <details key={row.key}>
          <summary>
            <span className="diff-changed">Changed</span> {row.key} ·{" "}
            {row.changes.length} properties
          </summary>
          <table className="property-diff">
            <thead>
              <tr>
                <th>Property</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {row.changes.map((c) => (
                <tr key={c.path}>
                  <th>{c.path}</th>
                  <td>
                    <code>{JSON.stringify(c.before) ?? "(absent)"}</code>
                  </td>
                  <td>
                    <code>{JSON.stringify(c.after) ?? "(absent)"}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </>
  );
}

function GraphInspector({ graph }: { graph: BrainGraphData }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("nodes");
  const rows =
    kind === "nodes"
      ? graph.nodes.map((n) => ({
          id: n.id,
          label: `${n.type} · ${n.label}`,
          value: n,
        }))
      : graph.edges.map((e, i) => ({
          id: `${edgeKey(e)}-${i}`,
          label: edgeKey(e),
          value: e,
        }));
  const filtered = rows.filter((r) =>
    JSON.stringify(r.value).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="graph-inspector">
      <div className="explorer-controls">
        <label>
          Inspect{" "}
          <select
            aria-label={`Inspect v${graph.version} nodes or edges`}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="nodes">Nodes ({graph.nodes.length})</option>
            <option value="edges">Edges ({graph.edges.length})</option>
          </select>
        </label>
        <label>
          Search{" "}
          <input
            aria-label={`Search v${graph.version} graph`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ID, type, label or property"
          />
        </label>
      </div>
      <div className="graph-records">
        {filtered.map((row) => (
          <details key={row.id}>
            <summary>{row.label}</summary>
            <pre>{JSON.stringify(row.value, null, 2)}</pre>
          </details>
        ))}
        {!filtered.length && <p>No matching graph records.</p>}
      </div>
    </div>
  );
}

export default function BrainExplorer() {
  const [index, setIndex] = useState<VersionIndex | null>(null);
  const [left, setLeft] = useState(4),
    [right, setRight] = useState(5);
  const [graphs, setGraphs] = useState<[BrainGraphData, BrainGraphData] | null>(
    null,
  );
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const i = await api<VersionIndex>("/brain/versions");
        if (active) setIndex(i);
      } catch (e) {
        if (active) setError(String(e));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!index) return;
    if (!index.versions.some((v) => v.v === left))
      setLeft(index.versions[0]?.v ?? index.live);
    if (!index.versions.some((v) => v.v === right)) setRight(index.live);
  }, [index, left, right]);
  useEffect(() => {
    let active = true;
    setGraphs(null);
    Promise.all([
      api<BrainGraphData>(`/brain?v=${left}`),
      api<BrainGraphData>(`/brain?v=${right}`),
    ])
      .then((g) => {
        if (active) {
          setGraphs(g);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [left, right]);
  useEffect(() => {
    let active = true;
    const load = () =>
      api<{
        versions: {
          v: number;
          evaluations: {
            evaluation_id: string;
            tasks: number;
            successes: number;
            success_rate: number;
            worker: string;
          }[];
        }[];
      }>("/evaluations")
        .then((e) => {
          if (active)
            setEvaluations(
              e.versions.flatMap((v) =>
                v.evaluations.map((row) => ({
                  ...row,
                  brain_version: v.v,
                  complete: row.successes,
                  complete_rate: row.success_rate,
                })),
              ),
            );
        })
        .catch((e) => {
          if (active) setError(`Evaluation metadata unavailable: ${String(e)}`);
        });
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const diff = useMemo(
    () => (graphs ? compareGraphs(...graphs) : null),
    [graphs],
  );
  const versionPicker = (
    value: number,
    setter: (n: number) => void,
    label: string,
  ) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => setter(Number(e.target.value))}
      >
        {index?.versions.map((v) => (
          <option key={v.v} value={v.v}>
            v{v.v}
            {v.v === index.live ? " · live" : ""} · {v.status}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <main className="research-main">
      <div className="eyebrow">V2 / SHARED KNOWLEDGE</div>
      <h1>
        Every brain. Every change<span>.</span>
      </h1>
      <p className="research-intro">
        Explore immutable snapshots and compare their actual knowledge.
        Selecting a version leaves the live brain unchanged.
      </p>
      {error && (
        <p role="alert" className="research-error">
          {error}
        </p>
      )}
      <section className="research-card">
        <h2>
          Saved brain versions{" "}
          <span className="subtle-tag">
            {index ? `v${index.live} live` : "Loading"}
          </span>
        </h2>
        <div className="version-table">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Parent / status</th>
                <th>Recorded reason</th>
                <th>Completed evaluations</th>
              </tr>
            </thead>
            <tbody>
              {index?.versions.map((v) => {
                const measured = evaluations.filter(
                  (e) => e.brain_version === v.v,
                );
                return (
                  <tr key={v.v}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setLeft(v.v)}
                      >
                        v{v.v}
                        {v.v === index.live && " · LIVE"}
                      </button>
                    </td>
                    <td>
                      {v.parent == null ? "Root" : `v${v.parent}`}
                      <small>{v.status}</small>
                    </td>
                    <td>
                      {v.note || "No reason recorded"}
                      <small>{v.created_at}</small>
                    </td>
                    <td>
                      {measured.length ? (
                        measured.map((e) => (
                          <div
                            className="evaluation-chip"
                            key={e.evaluation_id}
                          >
                            {e.complete}/{e.tasks} tasks ·{" "}
                            {(e.complete_rate * 100).toFixed(0)}%
                            <small>
                              {e.worker === "llm"
                                ? "Lightning"
                                : "Compiled policy"}{" "}
                              · {e.partition ?? "heldout"} · {e.evaluation_id}
                            </small>
                          </div>
                        ))
                      ) : v.heldout ? (
                        <>
                          {v.heldout.complete}/{v.heldout.tasks} tasks ·{" "}
                          {((v.heldout_score ?? 0) * 100).toFixed(0)}%
                          <small>{v.heldout.gate_id}</small>
                        </>
                      ) : (
                        "Not evaluated"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="research-card">
        <div className="explorer-controls">
          {versionPicker(left, setLeft, "Left brain")}
          {versionPicker(right, setRight, "Right brain")}
          <span className="diff-legend">
            <b className="diff-added">Added</b>
            <b className="diff-removed">Removed</b>
            <b className="diff-changed">Changed</b>
          </span>
        </div>
        {graphs && diff ? (
          <>
            <div className="graph-comparison">
              {graphs.map((graph, i) => (
                <div key={`${i}-${graph.version}`}>
                  <h2>
                    Brain v{graph.version}
                    {graph.version === index?.live ? " · live" : ""}
                  </h2>
                  <p>
                    Parent {graph.parent == null ? "none" : `v${graph.parent}`}{" "}
                    · {graph.note || "No reason recorded"}
                  </p>
                  <BrainGraph
                    data={graph}
                    error={null}
                    readIds={[]}
                    epoch={0}
                    addedIds={i ? diff.nodes.added.map((n) => n.id) : []}
                    retiredIds={!i ? diff.nodes.removed.map((n) => n.id) : []}
                    changedIds={diff.nodes.changed.map((n) => n.key)}
                    addedEdges={i ? diff.edges.added.map(edgeKey) : []}
                    removedEdges={!i ? diff.edges.removed.map(edgeKey) : []}
                    changedEdges={diff.edges.changed.map((e) => e.key)}
                  />
                  <GraphInspector graph={graph} />
                </div>
              ))}
            </div>
            <div className="graph-diff-summary">
              <h3>
                Full difference · v{left} → v{right}
              </h3>
              <p>
                Nodes: {diff.nodes.added.length} added ·{" "}
                {diff.nodes.removed.length} removed ·{" "}
                {diff.nodes.changed.length} changed. Edges:{" "}
                {diff.edges.added.length} added · {diff.edges.removed.length}{" "}
                removed · {diff.edges.changed.length} changed.
              </p>
              {[
                ...diff.nodes.added.map((n) => ({
                  key: n.id,
                  value: n,
                  status: "added",
                })),
                ...diff.nodes.removed.map((n) => ({
                  key: n.id,
                  value: n,
                  status: "removed",
                })),
                ...diff.edges.added.map((e) => ({
                  key: edgeKey(e),
                  value: e,
                  status: "added",
                })),
                ...diff.edges.removed.map((e) => ({
                  key: edgeKey(e),
                  value: e,
                  status: "removed",
                })),
              ].map((r, i) => (
                <details key={`${r.key}-${i}`}>
                  <summary>
                    <span className={`diff-${r.status}`}>{r.status}</span>{" "}
                    {r.key}
                  </summary>
                  <pre>{JSON.stringify(r.value, null, 2)}</pre>
                </details>
              ))}
              <Changes rows={diff.nodes.changed} />
              <Changes rows={diff.edges.changed} />
              {!diff.nodes.added.length &&
                !diff.nodes.removed.length &&
                !diff.nodes.changed.length &&
                !diff.edges.added.length &&
                !diff.edges.removed.length &&
                !diff.edges.changed.length && (
                  <p>
                    These graphs have identical nodes, edges and properties.
                  </p>
                )}
            </div>
          </>
        ) : (
          <p>Loading saved graphs…</p>
        )}
      </section>
    </main>
  );
}
