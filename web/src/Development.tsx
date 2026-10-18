import { ExternalLink } from "lucide-react";
import BrainHistory from "./BrainHistory.tsx";
import {
  CRUSOE_LINKS,
  LIGHTNING_MODEL_CARD,
  MODELS,
  evidenceUrl,
} from "./providers.ts";
import { buildHash } from "./routes.ts";

type Status = "Implemented" | "Measured" | "Planned" | "In progress";
const VERSIONS: {
  id: string;
  title: string;
  status: Status[];
  summary: string;
  items: { text: string; status: Status }[];
  evidence?: { label: string; href: string }[];
}[] = [
  {
    id: "V1",
    title: "The closed loop",
    status: ["Implemented", "Measured"],
    summary:
      "Robot workers act in a deterministic store, a supervisor reviews the run, and a held-out gate decides whether a brain edit is kept.",
    items: [
      { text: "Store engine with physical action checks and refusals", status: "Implemented" },
      { text: "Lightning robot workers reading a scoped knowledge-graph brain", status: "Implemented" },
      { text: "Supervisor review: failures, grounded insights, typed graph edits", status: "Implemented" },
      { text: "Update Brain gate on held-out seeds 101–110", status: "Implemented" },
      { text: "Gate gate-mvcw8wto: 4/10 → 4/10, refusals 0.7 → 0.6 per task", status: "Measured" },
    ],
    evidence: [{ label: "Version 1 gate record", href: evidenceUrl("version-1-gate.json") }],
  },
  {
    id: "V2",
    title: "Grounded, verified, governed",
    status: ["Implemented", "Measured"],
    summary:
      "Shoppers and up to four robots, head cameras, an independent evidence judge, cited research, brain history, a version explorer and recorded replay.",
    items: [
      { text: "Seeded shoppers, 1–4 robots and robot head cameras", status: "Implemented" },
      { text: "DeepSeek V4 Pro judge keeps or drops each finding", status: "Implemented" },
      { text: "You.com research citations on insights", status: "Implemented" },
      { text: "Brain explorer, matched historical comparisons and zero-inference replay", status: "Implemented" },
      { text: "Original gate gate-mvcynupn: v4 6/10 → v5 9/10, scores only, no replay", status: "Measured" },
      { text: "Fresh comparison cmp-mvd0u3kl-2: 20/20 recordings, v4 6/10 → v5 9/10, 147 responses", status: "Measured" },
    ],
    evidence: [
      { label: "Original gate", href: evidenceUrl("version-2-gate.json") },
      { label: "Fresh comparison", href: evidenceUrl("version-2-fresh-comparison.json") },
      { label: "Verification packet", href: evidenceUrl("version-2-verification.json") },
    ],
  },
  {
    id: "V3",
    title: "The full harness",
    status: ["In progress"],
    summary:
      "Adversarial disturbances and a post-training pipeline. Being built separately; not available in this dashboard.",
    items: [
      { text: "Adversarial attack: bounded disturbances that try to break the current brain", status: "In progress" },
      { text: "Post-training: strict-success training data, variants, a Crusoe fine-tuning job", status: "In progress" },
      { text: "Review buttons stay disabled until the work is verified", status: "Planned" },
    ],
  },
];

export default function Development() {
  return (
    <main className="research-main development">
      <div className="eyebrow">DEVELOPMENT</div>
      <h1>
        How the harness was built<span>.</span>
      </h1>
      <p className="research-intro">
        Implemented means the feature runs in this dashboard. Measured means a
        saved evaluation backs the number. Planned and in-progress work is not
        available here.
      </p>
      <div className="version-cards">
        {VERSIONS.map((v) => (
          <section className="research-card version-card" key={v.id}>
            <header>
              <strong>{v.id}</strong>
              <h2>{v.title}</h2>
              <span>
                {v.status.map((s) => (
                  <i key={s} className={`status-chip ${s.replace(" ", "-").toLowerCase()}`}>
                    {s}
                  </i>
                ))}
              </span>
            </header>
            <p>{v.summary}</p>
            <ul>
              {v.items.map((item) => (
                <li key={item.text}>
                  <i className={`status-chip ${item.status.replace(" ", "-").toLowerCase()}`}>
                    {item.status}
                  </i>
                  {item.text}
                </li>
              ))}
            </ul>
            {v.evidence && (
              <p className="evidence-links">
                {v.evidence.map((e) => (
                  <a key={e.href} className="text-link" href={e.href} target="_blank" rel="noreferrer">
                    {e.label} <ExternalLink size={11} />
                  </a>
                ))}
              </p>
            )}
          </section>
        ))}
      </div>
      <section className="research-card">
        <h2>Models and provider records</h2>
        <table className="model-table">
          <tbody>
            <tr><th>Robot workers</th><td><code>{MODELS.worker}</code></td></tr>
            <tr><th>Supervisor</th><td><code>{MODELS.supervisor}</code> (fallback <code>{MODELS.supervisorFallback}</code>)</td></tr>
            <tr><th>Evidence judge</th><td><code>{MODELS.judge}</code></td></tr>
          </tbody>
        </table>
        <p>
          These NVIDIA and DeepSeek models run on Crusoe Managed Inference. Run
          IDs in Previous results are the local records. Crusoe reports usage per
          model for the whole project; there is no per-run console page.
        </p>
        <p className="evidence-links">
          <a className="text-link" href={CRUSOE_LINKS.metrics} target="_blank" rel="noreferrer">
            Crusoe project metrics (select model and time range) <ExternalLink size={11} />
          </a>
          <a className="text-link" href={CRUSOE_LINKS.deployments} target="_blank" rel="noreferrer">
            Serverless deployments <ExternalLink size={11} />
          </a>
          <a className="text-link" href={CRUSOE_LINKS.metricsDocs} target="_blank" rel="noreferrer">
            Metrics documentation <ExternalLink size={11} />
          </a>
          <a className="text-link" href={LIGHTNING_MODEL_CARD} target="_blank" rel="noreferrer">
            Lightning model card (not a run record) <ExternalLink size={11} />
          </a>
        </p>
      </section>
      <BrainHistory />
      <p className="results-note">
        Step through saved runs in{" "}
        <a className="text-link" href={buildHash("results")}>Previous results</a>.
      </p>
    </main>
  );
}
