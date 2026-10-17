import { useEffect, useState } from "react";
import { GitBranch, LoaderCircle } from "lucide-react";
import { api } from "./api.ts";

interface HistoryVersion { v: number; status: string; heldout_score: number | null }
interface History { live: number; versions: HistoryVersion[] }

/** Missing evaluations stay missing; a rejected candidate still belongs in the history. */
export default function BrainHistory() {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = await api<History>("/brain/history");
        if (active) { setHistory(value); setError(null); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "History could not be loaded.");
      }
    };
    void load();
    const events = new EventSource("/api/events");
    events.addEventListener("gate_done", load);
    events.addEventListener("brain_version", load);
    return () => { active = false; events.close(); };
  }, []);
  const versions = history?.versions ?? [];
  const measured = versions.filter(v => typeof v.heldout_score === "number" && Number.isFinite(v.heldout_score));
  const x = (v: number) => 50 + (versions.length <= 1 ? 250 : versions.findIndex(row => row.v === v) * 500 / (versions.length - 1));
  const y = (score: number) => 185 - score * 150;
  return <section className="brain-history" aria-label="Held-out score history">
    <div className="history-heading"><GitBranch size={17} /><div><h3>What the shared brain has learned</h3><p>Held-out task completion by brain version. Unevaluated versions have no score.</p></div></div>
    {error ? <p role="alert">{error}</p> : !history ? <p><LoaderCircle size={14} className="spin" /> Loading brain history…</p> : <>
      <svg viewBox="0 0 610 230" role="img" aria-label="Held-out task completion, from zero to one hundred percent">
        {[0, .5, 1].map(score => <g key={score}><line x1="50" x2="570" y1={y(score)} y2={y(score)} stroke="#dce2d7" /><text x="6" y={y(score) + 4}>{score * 100}%</text></g>)}
        {measured.length > 1 && <polyline points={measured.map(v => `${x(v.v)},${y(v.heldout_score!)}`).join(" ")} fill="none" stroke="#4b775c" strokeWidth="3" strokeDasharray="6 4" />}
        {versions.map(v => <text key={v.v} textAnchor="middle" x={x(v.v)} y="213">v{v.v}</text>)}
        {measured.map(v => <g key={v.v}><circle cx={x(v.v)} cy={y(v.heldout_score!)} r={v.v === history.live ? 7 : 5} fill={v.v === history.live ? "#d48c47" : "#4b775c"}><title>v{v.v}: {(v.heldout_score! * 100).toFixed(1)}% · {v.status}</title></circle><text x={x(v.v)} y={y(v.heldout_score!) - 14} textAnchor="middle">{(v.heldout_score! * 100).toFixed(0)}%</text></g>)}
      </svg>
      {!measured.length && <p>No held-out evaluations have been recorded yet.</p>}
      <div className="history-versions">{versions.map(v => <span key={v.v}><strong>v{v.v}{v.v === history.live ? " · live" : ""}</strong><span>{v.heldout_score == null ? "Not evaluated" : `${(v.heldout_score * 100).toFixed(1)}%`}</span><small>{v.status}</small></span>)}</div>
    </>}
  </section>;
}
