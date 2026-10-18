import { Check, Lock } from "lucide-react";
import type { Stage } from "./routes.ts";

const STAGES: { id: Stage; title: string; hint: string }[] = [
  { id: "launch", title: "Launch", hint: "Robots, tasks, seed and brain" },
  {
    id: "work",
    title: "Robots at work",
    hint: "Store, head cameras, actions, graph",
  },
  {
    id: "review",
    title: "Review",
    hint: "Failures, insights and brain updates",
  },
];

/** The three dashboard stages shared by live trials and saved results. */
export default function StageNav({
  stage,
  available,
  status = {},
  onStage,
  label,
}: {
  stage: Stage;
  available: Record<Stage, boolean>;
  status?: Partial<Record<Stage, string>>;
  onStage: (stage: Stage) => void;
  label: string;
}) {
  const current = STAGES.findIndex((s) => s.id === stage);
  return (
    <nav className="stage-nav" aria-label={label}>
      <ol>
        {STAGES.map((s, i) => (
          <li key={s.id}>
            <button
              className={`${stage === s.id ? "current" : ""} ${i < current ? "passed" : ""}`}
              aria-current={stage === s.id ? "step" : undefined}
              disabled={!available[s.id]}
              onClick={() => onStage(s.id)}
            >
              <span className="stage-number">
                {!available[s.id] ? (
                  <Lock size={11} />
                ) : i < current ? (
                  <Check size={12} />
                ) : (
                  i + 1
                )}
              </span>
              <span className="stage-text">
                <strong>{s.title}</strong>
                <small>{status[s.id] ?? s.hint}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
