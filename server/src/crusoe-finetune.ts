// Crusoe Serverless Fine-Tuning and the optional Hugging Face copy (V3, Person B). Plain fetch against the documented
// REST endpoints (docs.crusoecloud.com/serverless-fine-tuning and /api/managed-ai): no SDK retries, so a create is
// sent at most once, and every failure says whether the provider definitely refused it or the outcome is unknown.
// Only the fields the dashboard needs are kept from provider responses; the API key never leaves the headers.

export const DEFAULT_TRAINING_BASE_URL = "https://api.intelligence.crusoecloud.com/v1";
/** The jobs page the docs link to. The docs give no per-job URL, so the job ID is shown next to this link. */
export const CONSOLE_FINE_TUNING_URL = "https://console.crusoecloud.com/foundry/fine-tuning/jobs";
export const TERMINAL_JOB_STATUSES = ["succeeded", "failed", "cancelled"];
/** Documented per-file limit of the Files API for fine-tuning (.jsonl only). */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const LIGHTNING_DOCS_NAME = "nvidia/nemotron-3.5-lightning-30b-a3b";

export type ProviderErrorKind = "config" | "http" | "network" | "timeout" | "bad_response";

/** definitive: the request was refused or never sent, so nothing was created. Otherwise the outcome is unknown. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly definitive: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function trainingBaseUrl() {
  return (process.env.CRUSOE_TRAINING_BASE_URL?.trim() || DEFAULT_TRAINING_BASE_URL).replace(/\/+$/, "");
}

function apiKey(): string {
  const key = process.env.CRUSOE_API_KEY?.trim();
  if (!key) throw new ProviderError("CRUSOE_API_KEY is not set (repo-root .env); nothing was sent to Crusoe", "config", true);
  return key;
}

const clip = (s: unknown, n = 500) => String(s ?? "").slice(0, n);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface RequestOpts {
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

async function request(method: string, route: string, opts: RequestOpts = {}): Promise<any> {
  const key = apiKey();
  const url = new URL(trainingBaseUrl() + route);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(opts.json !== undefined ? { "content-type": "application/json" } : {}) },
      body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
  } catch (e: any) {
    const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    throw new ProviderError(`${method} ${route}: ${timeout ? "no answer before the timeout" : `network error (${clip(e?.cause?.code ?? e?.message, 120)})`}`, timeout ? "timeout" : "network", false);
  }
  const text = await res.text().catch(() => "");
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail = body?.error?.message ?? body?.message ?? body?.detail ?? body?.error ?? text;
    // a 5xx may have been processed before it failed; anything else was refused
    throw new ProviderError(`${method} ${route}: HTTP ${res.status} ${clip(typeof detail === "string" ? detail : JSON.stringify(detail), 400)}`, "http", res.status < 500, res.status);
  }
  if (body === null || typeof body !== "object") throw new ProviderError(`${method} ${route}: HTTP ${res.status} with a body that is not JSON`, "bad_response", false, res.status);
  return body;
}

// ---------- minimal response shapes ----------

export interface ProviderFile {
  id: string;
  bytes: number | null;
  filename: string | null;
  purpose: string | null;
  status: string | null;
  created_at: number | null;
}

export interface ProviderJob {
  id: string;
  status: string | null;
  model: string | null;
  training_file: string | null;
  fine_tuned_model: string | null;
  trained_tokens: number | null;
  created_at: number | null;
  finished_at: number | null;
  estimated_finish: number | null;
  error: { code: string | null; message: string | null } | null;
  hyperparameters: Record<string, unknown> | null;
  suffix: string | null;
  metadata: Record<string, string> | null;
  result_files: string[];
}

export interface ProviderEvent {
  id: string | null;
  created_at: number | null;
  level: string | null;
  type: string | null;
  message: string | null;
}

export interface ProviderCheckpoint {
  id: string | null;
  created_at: number | null;
  step_number: number | null;
  fine_tuned_model_checkpoint: string | null;
  metrics: Record<string, number>;
}

export interface ProviderMetric {
  metric_name: string;
  data: { x: number; value: number }[];
}

function needId(raw: any, what: string): string {
  const id = str(raw?.id);
  if (!id) throw new ProviderError(`${what}: the response has no id`, "bad_response", false);
  return id;
}

export function pickFile(raw: any): ProviderFile {
  return { id: needId(raw, "file"), bytes: num(raw.bytes), filename: str(raw.filename), purpose: str(raw.purpose), status: str(raw.status), created_at: num(raw.created_at) };
}

export function pickJob(raw: any): ProviderJob {
  const hp = raw?.method?.supervised?.hyperparameters ?? raw?.hyperparameters;
  const md = raw?.metadata && typeof raw.metadata === "object" ? Object.fromEntries(Object.entries(raw.metadata).filter(([, v]) => typeof v === "string")) : null;
  return {
    id: needId(raw, "fine-tuning job"),
    status: str(raw.status),
    model: str(raw.model),
    training_file: str(raw.training_file),
    fine_tuned_model: str(raw.fine_tuned_model),
    trained_tokens: num(raw.trained_tokens),
    created_at: num(raw.created_at),
    finished_at: num(raw.finished_at),
    estimated_finish: num(raw.estimated_finish),
    error: raw.error && (raw.error.code || raw.error.message) ? { code: str(raw.error.code), message: raw.error.message == null ? null : clip(raw.error.message) } : null,
    hyperparameters: hp && typeof hp === "object" ? Object.fromEntries(Object.entries(hp).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v) || v === null)) : null,
    suffix: str(raw.suffix),
    metadata: md as Record<string, string> | null,
    result_files: Array.isArray(raw.result_files) ? raw.result_files.filter((f: unknown) => typeof f === "string").slice(0, 50) : [],
  };
}

const pickEvent = (e: any): ProviderEvent => ({ id: str(e?.id), created_at: num(e?.created_at), level: str(e?.level), type: str(e?.type), message: e?.message == null ? null : clip(e.message) });

const pickCheckpoint = (c: any): ProviderCheckpoint => ({
  id: str(c?.id),
  created_at: num(c?.created_at),
  step_number: num(c?.step_number),
  fine_tuned_model_checkpoint: str(c?.fine_tuned_model_checkpoint),
  metrics: Object.fromEntries(Object.entries(c?.metrics ?? {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) as Record<string, number>,
});

const list = (body: any): any[] => (Array.isArray(body?.data) ? body.data : []);

// ---------- calls ----------

export async function uploadTrainingFile(filename: string, content: Buffer): Promise<ProviderFile> {
  if (content.length > MAX_UPLOAD_BYTES) throw new ProviderError(`the dataset is ${content.length} bytes; the Files API accepts up to ${MAX_UPLOAD_BYTES}`, "config", true);
  const form = new FormData();
  form.append("purpose", "fine-tune");
  form.append("file", new Blob([new Uint8Array(content)], { type: "application/jsonl" }), filename);
  return pickFile(await request("POST", "/files", { form, timeoutMs: 300_000 }));
}

export async function findUploadedFile(filename: string): Promise<ProviderFile | null> {
  const body = await request("GET", "/files", { query: { purpose: "fine-tune", limit: 100, order: "desc" } });
  const hit = list(body).find((f) => f?.filename === filename);
  return hit ? pickFile(hit) : null;
}

export interface BaseModel {
  id: string;
  model_name: string | null;
  source: "env" | "models_list";
}

/** CRUSOE_FT_MODEL if set; otherwise the one fine-tunable Lightning base model the project can see. Never guessed. */
export async function resolveBaseModel(): Promise<BaseModel> {
  const fromEnv = process.env.CRUSOE_FT_MODEL?.trim();
  if (fromEnv) return { id: fromEnv, model_name: null, source: "env" };
  const body = await request("GET", "/models", { query: { model_type: "base_model" } });
  const all = list(body).filter((m) => m?.fine_tuning_available === true && typeof m?.id === "string");
  const lightning = all.filter((m) => /lightning/i.test(`${m.model_name ?? ""} ${m.id}`));
  const exact = lightning.filter((m) => String(m.model_name ?? m.id).toLowerCase() === LIGHTNING_DOCS_NAME);
  const pick = exact.length === 1 ? exact[0] : lightning.length === 1 ? lightning[0] : null;
  if (!pick)
    throw new ProviderError(
      lightning.length
        ? `several fine-tunable Lightning models are listed (${lightning.map((m) => m.model_name ?? m.id).join(", ")}); set CRUSOE_FT_MODEL`
        : `GET /models lists no fine-tunable Lightning base model (${all.length} fine-tunable models); set CRUSOE_FT_MODEL`,
      "config",
      true,
    );
  return { id: pick.id, model_name: str(pick.model_name), source: "models_list" };
}

export interface JobBody {
  model: string;
  training_file: string;
  suffix: string;
  metadata: Record<string, string>;
  method: { type: "supervised"; supervised: { hyperparameters: { n_epochs: number; batch_size: number; learning_rate: number } } };
}

export async function estimateJobPrice(body: JobBody): Promise<{ estimated_price: string | null; currency: string | null }> {
  const r = await request("POST", "/fine_tuning/jobs/estimate_price", { json: body, timeoutMs: 30_000 });
  return { estimated_price: r.estimated_price == null ? null : clip(r.estimated_price, 40), currency: str(r.currency) };
}

export async function createJob(body: JobBody): Promise<ProviderJob> {
  return pickJob(await request("POST", "/fine_tuning/jobs", { json: body, timeoutMs: 120_000 }));
}

export async function getJob(id: string): Promise<ProviderJob> {
  return pickJob(await request("GET", `/fine_tuning/jobs/${encodeURIComponent(id)}`));
}

/** Jobs that belong to one run (its unique suffix, its metadata id or its uploaded file), to settle a create whose
 *  answer never arrived. */
export async function findRunJobs(match: { suffix: string; post_training_id: string; training_file: string | null }): Promise<ProviderJob[]> {
  const body = await request("GET", "/fine_tuning/jobs", { query: { suffix: match.suffix, limit: 100 } });
  return list(body)
    .filter((j) => j?.suffix === match.suffix || j?.metadata?.post_training_id === match.post_training_id || (match.training_file !== null && j?.training_file === match.training_file))
    .map(pickJob);
}

export async function listJobEvents(id: string): Promise<ProviderEvent[]> {
  return list(await request("GET", `/fine_tuning/jobs/${encodeURIComponent(id)}/events`, { query: { limit: 100 } })).map(pickEvent);
}

export async function listJobCheckpoints(id: string): Promise<ProviderCheckpoint[]> {
  return list(await request("GET", `/fine_tuning/jobs/${encodeURIComponent(id)}/checkpoints`, { query: { limit: 100 } })).map(pickCheckpoint);
}

export async function getJobMetrics(id: string): Promise<ProviderMetric[]> {
  const body = await request("GET", `/fine_tuning/jobs/${encodeURIComponent(id)}/metrics`);
  const metrics = Array.isArray(body?.metrics) ? body.metrics : [];
  return metrics
    .filter((m: any) => typeof m?.metric_name === "string")
    .map((m: any) => ({
      metric_name: m.metric_name,
      data: (Array.isArray(m.data) ? m.data : []).filter((p: any) => num(p?.x) !== null && num(p?.value) !== null).slice(-500).map((p: any) => ({ x: p.x, value: p.value })),
    }));
}

export async function cancelJob(id: string): Promise<ProviderJob> {
  return pickJob(await request("POST", `/fine_tuning/jobs/${encodeURIComponent(id)}/cancel`, { timeoutMs: 60_000 }));
}

// ---------- Hugging Face Hub (optional) ----------

export function hubConfig(): { token: string; repo: string; endpoint: string } | null {
  const token = process.env.HF_TOKEN?.trim();
  const repo = process.env.HF_DATASET_REPO?.trim();
  if (!token || !repo) return null;
  return { token, repo, endpoint: (process.env.HF_ENDPOINT?.trim() || "https://huggingface.co").replace(/\/+$/, "") };
}

async function hub(cfg: { token: string; endpoint: string }, method: string, route: string, body: string, contentType: string, okStatuses: number[] = []): Promise<{ status: number; body: any }> {
  let res: Response;
  try {
    res = await fetch(cfg.endpoint + route, { method, headers: { authorization: `Bearer ${cfg.token}`, "content-type": contentType }, body, signal: AbortSignal.timeout(120_000) });
  } catch (e: any) {
    throw new Error(`${method} ${route}: ${e?.name === "TimeoutError" ? "no answer before the timeout" : "network error"}`);
  }
  const text = await res.text().catch(() => "");
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok && !okStatuses.includes(res.status)) throw new Error(`${method} ${route}: HTTP ${res.status} ${clip(parsed?.error ?? text, 300)}`);
  return { status: res.status, body: parsed };
}

/** Commit small text files to a dataset repository (created if missing). Succeeds only with a returned commit id. */
export async function publishDataset(files: { path: string; content: Buffer }[], summary: string): Promise<{ repo: string; commit: string; url: string | null }> {
  const cfg = hubConfig();
  if (!cfg) throw new Error("HF_TOKEN and HF_DATASET_REPO are not both set");
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(cfg.repo)) throw new Error("HF_DATASET_REPO must look like owner/name");
  const [organization, name] = cfg.repo.split("/");
  await hub(cfg, "POST", "/api/repos/create", JSON.stringify({ type: "dataset", name, organization, private: false }), "application/json", [409]);
  // inline commits carry regular files only; a path the repository routes to Git LFS is reported, not forced
  const pre = await hub(cfg, "POST", `/api/datasets/${cfg.repo}/preupload/main`, JSON.stringify({ files: files.map((f) => ({ path: f.path, size: f.content.length, sample: f.content.subarray(0, 512).toString("base64") })) }), "application/json");
  const lfs = (pre.body?.files ?? []).filter((f: any) => f?.uploadMode === "lfs").map((f: any) => f.path);
  if (lfs.length) throw new Error(`the Hub wants Git LFS for ${lfs.join(", ")}; LFS upload is not implemented here`);
  const lines = [
    { key: "header", value: { summary: clip(summary, 200), description: "" } },
    ...files.map((f) => ({ key: "file", value: { path: f.path, content: f.content.toString("base64"), encoding: "base64" } })),
  ];
  const r = await hub(cfg, "POST", `/api/datasets/${cfg.repo}/commit/main`, lines.map((l) => JSON.stringify(l)).join("\n"), "application/x-ndjson");
  const commit = str(r.body?.commitOid);
  if (!commit) throw new Error("the Hub answered without a commit id");
  return { repo: cfg.repo, commit, url: str(r.body?.commitUrl) };
}
