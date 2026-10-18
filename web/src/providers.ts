/** Models configured in server/src/llm.ts. NVIDIA and DeepSeek models are served by Crusoe Managed Inference. */
export const MODELS = {
  worker: "nvidia/Nemotron-3.5-Lightning-30B-A3B",
  supervisor: "nvidia/NVIDIA-Nemotron-3.5-Super-VL",
  supervisorFallback: "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B",
  judge: "deepseek-ai/DeepSeek-V4-Pro",
} as const;

/**
 * Crusoe console pages linked from the official inference-metrics documentation. Metrics are reported per model
 * for the whole project, not per run: there is no per-run console page, so none is linked or invented.
 */
export const CRUSOE_LINKS = {
  metrics: "https://console.crusoecloud.com/foundry/metrics",
  deployments: "https://console.crusoecloud.com/foundry/serverless-deployments",
  projects: "https://console.crusoecloud.com/projects",
  metricsDocs:
    "https://docs.crusoecloud.com/serverless-inference/inference-metrics/index.html",
} as const;

/** A model card describes the model; it is not a record of any run. */
export const LIGHTNING_MODEL_CARD =
  "https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/modelcard";

export const REPO_URL = "https://github.com/ShashwatM3/AutoRoboHarness";
export const evidenceUrl = (file: string) =>
  `${REPO_URL}/blob/main/AUTO-ROBO-SIM-FILES/verification/${file}`;

export function workerLabel(worker: string | undefined): string {
  return worker === "compiled"
    ? "Compiled policy · no model calls"
    : worker === "llm"
      ? `${MODELS.worker} on Crusoe`
      : "Worker not recorded";
}
