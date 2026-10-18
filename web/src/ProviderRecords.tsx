import { useRef, useState } from "react";
import { Copy, ExternalLink, X } from "lucide-react";
import type { LlmUsage } from "./api.ts";
import { CRUSOE_LINKS, MODELS } from "./providers.ts";

const utc = (date: Date) => `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;

/** Crusoe's model and custom-range selectors are page state, not URL parameters. */
export default function ProviderRecords({
  id,
  worker,
  usage,
  startedAt,
  finishedAt,
  recordPath,
}: {
  id: string;
  worker?: string;
  usage: LlmUsage;
  startedAt?: string;
  finishedAt?: string | null;
  recordPath: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState("");
  if (worker === "compiled")
    return <small>Compiled policy · no Crusoe inference calls for this run.</small>;

  const model = worker === "llm" ? MODELS.worker : null;
  const start = startedAt ? new Date(startedAt) : null;
  const finish = finishedAt ? new Date(finishedAt) : null;
  const validStart = start && Number.isFinite(start.getTime()) ? start : null;
  const validFinish = finish && Number.isFinite(finish.getTime()) ? finish : null;
  // Metrics have minute-sized buckets. Round outward and include two minutes on each side.
  const rangeStart = validStart ? new Date(Math.floor(validStart.getTime() / 60000) * 60000 - 120000) : null;
  const rangeEnd = validFinish ? new Date(Math.min(Date.now(), Math.ceil(validFinish.getTime() / 60000) * 60000 + 120000)) : null;
  const filters = [
    `Run: ${id}`,
    `Model: ${model ?? "Not recorded"}`,
    `Custom range start: ${rangeStart ? utc(rangeStart) : "Not recorded"}`,
    `Custom range end: ${rangeEnd ? utc(rangeEnd) : "Run in progress; use the current time"}`,
    "Project: select the project that issued this run's inference API key.",
  ].join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(filters);
      setCopyStatus("Model and time range copied.");
    } catch {
      setCopyStatus("Copy the model and UTC range shown below.");
    }
  };
  return (
    <div className="provider-records">
      <button className="text-button text-link" onClick={() => { setCopyStatus(""); dialog.current?.showModal(); }}>
        View this run’s recorded usage
      </button>
      <small>Crusoe’s project dashboard needs its own model and time filters.</small>
      <dialog ref={dialog} className="provider-dialog" aria-label="Recorded usage and Crusoe metrics filters">
        <header>
          <div>
            <div className="eyebrow">SAVED MODEL RESPONSES</div>
            <h2>Crusoe usage for this run</h2>
            <code>{id}</code>
          </div>
          <button className="provider-close" aria-label="Close provider records" onClick={() => dialog.current?.close()}><X size={20} /></button>
        </header>
        <div className="provider-usage-counts">
          <div><strong>{usage.calls}</strong><span>recorded responses</span></div>
          <div><strong>{usage.prompt_tokens.toLocaleString()}</strong><span>prompt tokens</span></div>
          <div><strong>{usage.completion_tokens.toLocaleString()}</strong><span>output tokens</span></div>
        </div>
        <p>{usage.replayed ?? 0} local response replays · prefix cache {usage.cache_share == null ? "not reported" : `${(usage.cache_share * 100).toFixed(1)}% of reported prompt tokens`}.</p>
        <p>These are this run’s saved counts. Crusoe’s charts include other requests in the selected project and time range.</p>
        <a className="text-link" href={recordPath} target="_blank" rel="noreferrer">Open saved run record <ExternalLink size={12} /></a>
        <section className="provider-filter-guide">
          <h3>Find this activity in Crusoe</h3>
          <p>The console opens a general dashboard and may default to DeepSeek. Its link cannot preselect a model or time range.</p>
          <ol>
            <li>Use the project that issued this run’s inference API key.</li>
            <li>Select <strong>{model ? "NVIDIA Nemotron 3.5 Lightning" : "the recorded worker model"}</strong> in the model dropdown. {model && <code>{model}</code>}</li>
            <li>Choose <strong>Custom range</strong> using the UTC window below, then refresh.</li>
          </ol>
          <dl>
            <div><dt>From</dt><dd>{rangeStart ? utc(rangeStart) : "Start time not recorded"}</dd></div>
            <div><dt>To</dt><dd>{rangeEnd ? utc(rangeEnd) : "Current time (run still active or finish not recorded)"}</dd></div>
          </dl>
          <small>{validStart && validFinish ? `Actual run: ${utc(validStart)} → ${utc(validFinish)}. The wider filter window includes the surrounding metric buckets.` : "Use a range that contains the run; unavailable timestamps are not reconstructed."}</small>
          <div className="provider-actions">
            <button className="outline-tag" onClick={() => void copy()}><Copy size={13} /> Copy model + time range</button>
            <a className="play-button" href={CRUSOE_LINKS.metrics} target="_blank" rel="noreferrer">Open Crusoe project metrics <ExternalLink size={13} /></a>
          </div>
          <p className="provider-copy-status" role="status">{copyStatus}</p>
        </section>
      </dialog>
    </div>
  );
}
