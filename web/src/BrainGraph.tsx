import { useMemo, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { seededRandom } from '../../engine/store.ts';
import type { BrainGraphData } from './api.ts';

const COLORS: Record<string, string> = { Scope: '#aebc91', Procedure: '#db9a63', Step: '#809cbd', Rule: '#a68bb7', Guardrail: '#ca8779', Protocol: '#a89060', Evidence: '#7da792' };
type Positioned = { id: string; x: number; y: number; type: string; label: string };

function layout(data: BrainGraphData) {
  const rand = seededRandom(data.version);
  const nodes: Positioned[] = data.nodes.filter(n => !n.props.retired_in).map(n => ({ ...n, x: 70 + rand() * 450, y: 20 + rand() * 170 }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (let tick = 0; tick < 220; tick++) {
    const alpha = 1 - tick / 240;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const o = nodes[j], dx = n.x - o.x, dy = n.y - o.y;
        const distance = Math.max(6, Math.hypot(dx, dy)), f = 40 * alpha / (distance * distance);
        n.x += dx * f; n.y += dy * f; o.x -= dx * f; o.y -= dy * f;
      }
      n.x += ((n.type === 'Scope' ? 170 : n.type === 'Step' ? 420 : 300) - n.x) * 0.002 * alpha;
      n.y += (110 - n.y) * 0.008 * alpha;
      n.x = Math.max(20, Math.min(580, n.x)); n.y = Math.max(14, Math.min(206, n.y));
    }
    for (const edge of data.edges) {
      const a = byId.get(edge.from), b = byId.get(edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const f = (distance - 37) / distance * 0.035 * alpha;
      a.x += dx * f; a.y += dy * f; b.x -= dx * f; b.y -= dy * f;
    }
  }
  return { nodes, byId };
}

export default function BrainGraph({ data, readIds, epoch, error }: { data: BrainGraphData | null; readIds: string[]; epoch: number; error: string | null }) {
  const positions = useMemo(() => data ? layout(data) : null, [data]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedNode = data?.nodes.find(n => n.id === selected);
  const active = new Set(readIds);
  return <section className="brain-card">
    <div className="card-toolbar"><div><GitBranch size={15} /><strong>Shared brain</strong>{data && <span className="subtle-tag">v{data.version}</span>}</div><span className="graph-count">{data ? `${data.nodes.length} NODES · ${data.edges.length} CONNECTIONS` : 'CONNECTING'}</span></div>
    <div className="brain-body">{positions && data ? <svg viewBox="0 0 600 220" role="img" aria-label={`Knowledge graph for brain version ${data.version}. Read nodes pulse as robots act.`}>
      {data.edges.map((edge, i) => { const a = positions.byId.get(edge.from), b = positions.byId.get(edge.to); return a && b ? <line key={`${i}-${edge.from}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={active.has(a.id) && active.has(b.id) ? '#a4b788' : '#e1e5d4'} strokeWidth={active.has(a.id) && active.has(b.id) ? 1.4 : 0.8} /> : null; })}
      {positions.nodes.map(n => <g key={n.id} role="button" tabIndex={0} aria-label={`${n.type}: ${n.label}`} onClick={() => setSelected(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelected(n.id); }} className="graph-node">
        <title>{n.type}: {n.label}</title>{active.has(n.id) && <circle key={`${n.id}-${epoch}`} cx={n.x} cy={n.y} r={10} fill="none" stroke="#88a864" strokeWidth={1.5} className="node-pulse" />}
        <circle cx={n.x} cy={n.y} r={n.type === 'Scope' ? 5 : n.type === 'Procedure' ? 6 : 4} fill={COLORS[n.type] ?? '#b3bd9e'} stroke={selected === n.id ? '#294d38' : '#f7f9f0'} strokeWidth={selected === n.id ? 2 : 1.5} />
        {(n.type === 'Procedure' || selected === n.id || n.id === 'store') && <text x={n.x + 9} y={n.y + 3} fontSize={7} fill="#657958">{n.label.slice(0, 28)}</text>}
      </g>)}
    </svg> : <div className="brain-empty">{error ?? 'Loading the live knowledge graph…'}</div>}
    <div className="graph-description">{selectedNode ? <><strong>{selectedNode.label}</strong><span>{selectedNode.type} · {selectedNode.id}</span><p>{Object.entries(selectedNode.props).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</p></> : <><strong>Knowledge every robot shares.</strong><p>A pulse shows the nodes a worker read before choosing its action. Each node opens its actual brain data.</p><div className="graph-legend">{['Scope', 'Procedure', 'Step', 'Rule', 'Guardrail', 'Protocol'].map(type => <span key={type}><i style={{ background: COLORS[type] }} />{type}</span>)}</div></>}</div>
    </div>
  </section>;
}
