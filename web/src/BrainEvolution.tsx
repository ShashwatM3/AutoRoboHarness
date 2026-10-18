import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { ArrowRight, GitBranch, Layers3 } from "lucide-react";
import { savedApi, type BrainGraphData } from "./api.ts";
import type { VersionIndex, VersionRow } from "./BrainExplorer.tsx";
import BrainGraph from "./BrainGraph.tsx";
import { compareGraphs, edgeKey } from "./brainComparison.ts";
import { ancestry, evolutionGraph } from "./brainEvolution.ts";
import "./BrainEvolution.css";

const PALETTE = ["#547f9c", "#b57730", "#8562a0", "#3c8468", "#ad5961"];
const statusLabel = (v: VersionRow) => v.status === "live" ? "Live brain" : v.status === "rejected" ? "Not promoted" : v.status === "superseded" ? "Previously live" : v.status;

export default function BrainEvolution({ index }: { index: VersionIndex | null }) {
  const [graphs, setGraphs] = useState<Map<number, BrainGraphData>>(new Map());
  const [errors, setErrors] = useState<string[]>([]);
  const [full, setFull] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const marker = `evolution-${useId().replaceAll(":", "")}`;
  const availableKey = index?.versions.filter((v) => v.available !== false).map((v) => v.v).sort((a, b) => a - b).join(",") ?? "";
  useEffect(() => {
    if (!availableKey) return;
    let active = true;
    const versions = availableKey.split(",").map(Number);
    void Promise.allSettled(versions.map((v) => savedApi<BrainGraphData>(`/brain?v=${v}`))).then((results) => {
      if (!active) return;
      const loaded = new Map<number, BrainGraphData>(), failures: string[] = [];
      results.forEach((r, i) => r.status === "fulfilled" ? loaded.set(versions[i], r.value) : failures.push(`v${versions[i]} snapshot unavailable`));
      setGraphs(loaded); setErrors(failures);
    });
    return () => { active = false; };
  }, [availableKey]);
  const versions = useMemo(() => [...(index?.versions ?? [])].sort((a, b) => a.v - b.v), [index]);
  const path = useMemo(() => index?.live != null ? ancestry(versions, index.live) : [], [versions, index?.live]);
  const model = useMemo(() => evolutionGraph(graphs, path), [graphs, path]);
  const colors = new Map(path.map((v, i) => [v, i === 0 ? "#9ba99b" : PALETTE[(i - 1) % PALETTE.length]]));
  const rows = versions.map((version) => {
    const graph = graphs.get(version.v), parent = graphs.get(version.parent!);
    return { version, graph, diff: graph && parent ? compareGraphs(parent, graph) : null };
  });
  const nodeAccents = model ? Object.fromEntries([...model.origins].map(([id, v]) => [id, { color: colors.get(v) ?? "#9ba99b", label: v === path[0] ? `Inherited v${v}` : `Added in v${v}` }])) : {};
  const selected = rows.find((r) => r.version.v === expanded);
  return <section className="brain-evolution" aria-label="Brain evolution across all saved versions">
    <header className="evolution-heading">
      <div><div className="eyebrow">THE BRAIN LEARNS</div><h2>One brain. Every lesson, connected.</h2><p>All saved versions together. The lines follow their actual parents.</p></div>
      {model && <div className="evolution-total"><span>v{model.first.version}<ArrowRight size={17} />v{model.last.version}</span><strong>+{model.diff.nodes.added.length} nodes <i>·</i> +{model.diff.edges.added.length} links</strong><small>{model.first.nodes.length} → {model.last.nodes.length} knowledge nodes</small></div>}
    </header>
    {!index && <p>Loading saved brain history…</p>}
    {errors.length > 0 && <p role="status">{errors.join(" · ")}. Available snapshots remain explorable.</p>}
    <div className="evolution-lineage-scroll"><div className="evolution-lineage" style={{ minWidth: Math.max(660, versions.length * 158) }}>
      <svg className="evolution-connectors" viewBox={`0 0 ${versions.length * 200 || 1000} 74`} role="img" aria-label={versions.map((v) => v.parent == null ? `v${v.v} is the root` : `v${v.parent} is parent of v${v.v}`).join(". ")}>
        <defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#8a9b87" /></marker></defs>
        {versions.map((v, i) => {
          const parentIndex = versions.findIndex((p) => p.v === v.parent);
          if (parentIndex < 0) return null;
          const from = parentIndex * 200 + 100, to = i * 200 + 100, top = Math.max(4, 53 - Math.abs(i - parentIndex) * 17);
          return <path key={v.v} d={`M${from} 68 C${from} ${top},${to} ${top},${to} 64`} fill="none" stroke={v.status === "rejected" ? "#afaea4" : colors.get(v.v) ?? "#547f9c"} strokeWidth={v.status === "rejected" ? 1.5 : 2.8} strokeDasharray={v.status === "rejected" ? "5 5" : undefined} markerEnd={`url(#${marker})`} />;
        })}
      </svg>
      <div className="evolution-versions" style={{ gridTemplateColumns: `repeat(${versions.length || 1}, minmax(0,1fr))` }}>
        {rows.map(({ version: v, graph, diff }) => {
          const additions = diff?.nodes.added.filter((n) => n.type !== "Evidence") ?? [];
          return <button key={v.v} className={`evolution-version ${v.status === "rejected" ? "rejected" : ""} ${v.v === index?.live ? "is-live" : ""} ${expanded === v.v ? "is-expanded" : ""}`} onClick={() => setExpanded(expanded === v.v ? null : v.v)} aria-expanded={expanded === v.v} style={{ "--version-color": colors.get(v.v) ?? "#9a9c91" } as CSSProperties}>
            <span className="evolution-version-top"><b>v{v.v}</b><span>{statusLabel(v)}</span></span>
            <small>{v.parent == null ? "The starting brain" : `Branches from v${v.parent}`}</small>
            <strong>{v.parent == null ? "Workspace knowledge" : additions.find((n) => n.type === "Rule")?.label ?? additions[0]?.label ?? (diff ? "Properties & connections" : "Saved snapshot")}</strong>
            <span className="evolution-delta">{diff ? `+${diff.nodes.added.length} nodes · +${diff.edges.added.length} links` : graph ? `${graph.nodes.length} nodes · ${graph.edges.length} links` : v.available === false ? "Snapshot unavailable" : "Loading snapshot…"}</span>
            {diff && (diff.nodes.removed.length + diff.nodes.changed.length + diff.edges.removed.length + diff.edges.changed.length > 0) && <small>{diff.nodes.removed.length + diff.edges.removed.length} removed · {diff.nodes.changed.length + diff.edges.changed.length} changed</small>}
          </button>;
        })}
      </div>
    </div></div>
    <div className="evolution-path"><GitBranch size={15} /><span>Live ancestry <strong>{path.map((v) => `v${v}`).join(" → ")}</strong></span>{versions.some((v) => v.status === "rejected") && <small>Dashed branches were not promoted.</small>}</div>
    {selected && <div className="evolution-expanded"><h3>v{selected.version.v} · {statusLabel(selected.version)}</h3><p>{selected.version.note || "No reason recorded."}</p>{selected.diff && <details><summary>Inspect exact node, edge and property changes</summary><pre>{JSON.stringify(selected.diff, null, 2)}</pre></details>}</div>}
    {model && <div className="evolution-knowledge">
      <div className="evolution-map">
        <div className="evolution-map-heading"><div><h3>The knowledge that changed</h3><p>{full ? "Full saved graph" : "Changed knowledge and its connections; inherited context is muted."}</p></div><button className="text-button" onClick={() => setFull(!full)}>{full ? "Focus on changes" : `Full graph · ${model.last.nodes.length} nodes`}</button></div>
        <div className="evolution-legend">{path.map((v, i) => <span key={v}><i style={{ background: colors.get(v) }} />{i === 0 ? `Inherited v${v}` : `Added in v${v}`}</span>)}</div>
        <BrainGraph key={`${model.last.version}-${full}`} data={full ? model.last : model.focus} readIds={[]} epoch={0} error={null} nodeAccents={nodeAccents} addedEdges={model.diff.edges.added.map(edgeKey)} retiredIds={model.diff.nodes.removed.map((n) => n.id)} changedIds={model.diff.nodes.changed.map((n) => n.key)} changedEdges={model.diff.edges.changed.map((e) => e.key)} removedEdges={model.diff.edges.removed.map(edgeKey)} heading={`v${model.first.version} → v${model.last.version} · knowledge growth`} />
        {!full && <small className="evolution-context">Showing {model.focus.nodes.length} of {model.last.nodes.length} nodes. Click a node or link to inspect; scroll to zoom.</small>}
      </div>
      <aside className="evolution-lessons" aria-label="Lessons added along the live ancestry"><div className="eyebrow">WHAT THE ROBOTS LEARNED</div>
        {path.slice(1).map((v, i) => {
          const parent = graphs.get(path[i]), graph = graphs.get(v);
          if (!parent || !graph) return null;
          const diff = compareGraphs(parent, graph), lessons = diff.nodes.added.filter((n) => n.type === "Rule" || n.type === "Procedure" || n.type === "Step");
          return <article key={v} style={{ "--lesson-color": colors.get(v) } as CSSProperties}>
            <span className="evolution-lesson-version"><Layers3 size={14} />v{v}<small>from v{path[i]}</small></span>
            {lessons.map((n) => <div key={n.id} className="evolution-lesson"><small>{n.type === "Step" ? "PROCEDURE STEP" : n.type.toUpperCase()}</small><strong>{n.label}</strong></div>)}
            {!lessons.length && <strong>{graph.note || "Updated knowledge"}</strong>}
            <footer>{diff.nodes.added.filter((n) => n.type === "Evidence").length} evidence {diff.nodes.added.filter((n) => n.type === "Evidence").length === 1 ? "node" : "nodes"} · {diff.edges.added.filter((e) => e.type === "SUPPORTED_BY").length} grounding {diff.edges.added.filter((e) => e.type === "SUPPORTED_BY").length === 1 ? "link" : "links"}</footer>
          </article>;
        })}<p>Drawn from the saved snapshots. Evaluation sets remain separate in the records below.</p>
      </aside>
    </div>}
    {index && !model && <p>{errors.length || path.some((v) => versions.find((row) => row.v === v)?.available === false) ? "An ancestry snapshot is unavailable. Its saved version is listed above." : versions.length ? "Loading the snapshots along the live ancestry…" : "No saved snapshots are available yet."}</p>}
  </section>;
}
