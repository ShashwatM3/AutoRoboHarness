// Crusoe model calls: one OpenAI client, a per-model rate limiter, retries on 429/5xx,
// a response cache keyed by the request, and an `llm` event per call.
// Temperature 0 is not deterministic on Crusoe, so the cache is what makes re-runs repeatable.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { emit } from "./events.ts";

export const MODELS = {
  worker: "nvidia/Nemotron-3.5-Lightning-30B-A3B",
  supervisor: "nvidia/NVIDIA-Nemotron-3.5-Super-VL",
  supervisor_fallback: "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B",
  judge: "deepseek-ai/DeepSeek-V4-Pro",
} as const;

/** DeepSeek's chat template reads `thinking`; Nemotron's reads `enable_thinking` (and ignores the other key). */
const thinkingKwargs = (model: string, on: boolean) => (/^deepseek-ai\//i.test(model) ? { thinking: on } : { enable_thinking: on });

const CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.cache/llm");

let client: OpenAI | null = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.CRUSOE_API_KEY;
    if (!apiKey) throw new Error("CRUSOE_API_KEY is not set (repo-root .env)");
    client = new OpenAI({ apiKey, baseURL: process.env.CRUSOE_BASE_URL ?? "https://api.inference.crusoecloud.com/v1", maxRetries: 0, timeout: 120_000 });
  }
  return client;
}

// ---------- per-model concurrency, paced starts, and a shared provider cooldown ----------
// A minute-sized burst can exhaust the provider's bucket even below the nominal RPM.
// Reserve a concurrency slot first, then check the clock immediately before sending.
const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const maxInFlight = () => Math.max(1, Math.floor(positive(process.env.LLM_CONCURRENCY, 4)));
const rpm = () => positive(process.env.LLM_RPM, 18);
const inFlight = new Map<string, number>();
const waiters = new Map<string, (() => void)[]>();
const chains = new Map<string, Promise<unknown>>();
const nextStart = new Map<string, number>();
const blockedUntil = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function enter(model: string) {
  while ((inFlight.get(model) ?? 0) >= maxInFlight()) await new Promise<void>((r) => waiters.set(model, [...(waiters.get(model) ?? []), r]));
  inFlight.set(model, (inFlight.get(model) ?? 0) + 1);
}

function leave(model: string) {
  inFlight.set(model, (inFlight.get(model) ?? 1) - 1);
  waiters.get(model)?.shift()?.();
}

async function acquire(model: string) {
  const prev = chains.get(model) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  chains.set(model, prev.then(() => mine));
  await prev;
  try {
    for (;;) {
      const wait = Math.max(nextStart.get(model) ?? 0, blockedUntil.get(model) ?? 0) - Date.now();
      if (wait <= 0) {
        nextStart.set(model, Date.now() + 60_000 / rpm());
        return;
      }
      await sleep(wait);
      // Another in-flight request may have extended the cooldown while we slept.
    }
  } finally {
    release();
  }
}

function retryAfterMs(err: any): number {
  const headers = err?.headers;
  const value = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"];
  if (value == null) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 60_000;
}

function penalize(model: string, ms: number) {
  // Concurrent 429s can extend a cooldown, never shorten it.
  blockedUntil.set(model, Math.max(blockedUntil.get(model) ?? 0, Date.now() + ms));
}

// ---------- the call ----------

export interface ChatOptions {
  role: string; // worker | supervisor | clips | ...  (for the llm event)
  thinking?: boolean; // default false: Nemotron thinks by default and it costs 5-20 s; sent as DeepSeek's own key for deepseek-ai models
  cache?: boolean; // default true unless LLM_CACHE=0
  meta?: Record<string, unknown>; // extra fields for the llm event (shift_id, robot, ...)
}

export type ChatParams = Omit<ChatCompletionCreateParamsNonStreaming, "stream">;

export async function chat(params: ChatParams, opts: ChatOptions): Promise<ChatCompletion> {
  const body: Record<string, unknown> = {
    temperature: 0,
    max_tokens: 1024,
    ...params,
    chat_template_kwargs: thinkingKwargs(String(params.model), !!opts.thinking),
  };
  const useCache = opts.cache !== false && process.env.LLM_CACHE !== "0";
  const key = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (useCache && fs.existsSync(file)) {
    const hit = JSON.parse(fs.readFileSync(file, "utf8")) as ChatCompletion;
    replays.add(hit);
    emit("llm", { role: opts.role, model: body.model, cached: true, latency_s: 0, ...usage(hit), crusoe_cached_tokens: null, ...opts.meta });
    return hit;
  }

  // Allow time for the shared project's quota to recover. Persistent 429s are bounded
  // by LLM_429_WAIT_S (default 600); other errors (5xx, network) get 6 tries.
  const waitUntil = Date.now() + Number(process.env.LLM_429_WAIT_S ?? 600) * 1000;
  let delay = 2000;
  let errors = 0;
  for (let attempt = 1; ; attempt++) {
    const model = String(body.model);
    await enter(model);
    let retryDelay = 0;
    try {
      await acquire(model);
      const t0 = Date.now();
      const res = (await getClient().chat.completions.create(body as any)) as ChatCompletion;
      const latency_s = +((Date.now() - t0) / 1000).toFixed(2);
      emit("llm", { role: opts.role, model: body.model, cached: false, latency_s, ...usage(res), crusoe_cached_tokens: crusoeCached(res), ...opts.meta });
      if (useCache) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(res));
      }
      return res;
    } catch (err: any) {
      const status = err?.status ?? 0;
      const retryable = status === 429 || status >= 500 || status === 0;
      const wait = status === 429 ? retryAfterMs(err) : delay + Math.random() * 500;
      if (status === 429) penalize(model, wait);
      const exhausted = status === 429 ? Date.now() + wait > waitUntil : ++errors >= 6;
      if (!retryable || exhausted) throw err;
      console.warn(`[llm] ${opts.role} ${body.model} ${status || err?.code || "error"}; retry ${attempt} after ${Math.ceil(wait)} ms`);
      // 429 uses the model-wide clock so every queued caller observes the same pause.
      if (status !== 429) retryDelay = wait;
      delay = Math.min(delay * 2, 30_000);
    } finally {
      // Also release on synchronous client/configuration errors.
      leave(model);
    }
    if (retryDelay) await sleep(retryDelay);
  }
}

function usage(r: ChatCompletion) {
  return { prompt_tokens: r.usage?.prompt_tokens ?? null, completion_tokens: r.usage?.completion_tokens ?? null };
}

// ---------- usage tallies and Crusoe's prefix cache (V2-2) ----------
// Crusoe reports usage.prompt_tokens_details.cached_tokens for Super VL, but null for Lightning and DeepSeek
// (checked over every saved response on Oct 17). So cache_share covers only the live calls that reported it,
// and is null when none did; it is never estimated. Replays from our own response cache are not Crusoe cache hits.

const replays = new WeakSet<object>();
const crusoeCached = (r: ChatCompletion) => (replays.has(r) ? null : (r.usage?.prompt_tokens_details?.cached_tokens ?? null));

export interface LlmTally {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  replayed: number; // calls answered from our own response cache
  crusoe_cache: { calls_reporting: number; prompt_tokens: number; cached_tokens: number };
  cache_share: number | null; // crusoe_cache.cached_tokens / crusoe_cache.prompt_tokens
}

export const newTally = (): LlmTally => ({ calls: 0, prompt_tokens: 0, completion_tokens: 0, replayed: 0, crusoe_cache: { calls_reporting: 0, prompt_tokens: 0, cached_tokens: 0 }, cache_share: null });

export function tally(t: LlmTally, r: ChatCompletion) {
  t.calls++;
  t.prompt_tokens += r.usage?.prompt_tokens ?? 0;
  t.completion_tokens += r.usage?.completion_tokens ?? 0;
  if (replays.has(r)) t.replayed++;
  const cached = crusoeCached(r);
  if (typeof cached !== "number") return;
  t.crusoe_cache.calls_reporting++;
  t.crusoe_cache.prompt_tokens += r.usage?.prompt_tokens ?? 0;
  t.crusoe_cache.cached_tokens += cached;
  t.cache_share = t.crusoe_cache.prompt_tokens ? +(t.crusoe_cache.cached_tokens / t.crusoe_cache.prompt_tokens).toFixed(3) : null;
}

/** Parse a JSON object from a model reply, tolerating code fences or text around it. */
export function parseJson<T = any>(text: string | null | undefined): T {
  if (!text) throw new Error("empty model reply");
  const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error(`model reply is not JSON: ${s.slice(0, 200)}`);
  }
}
