// Crusoe model calls: one OpenAI client, a per-model rate limiter, retries on 429/503,
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
} as const;

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

// ---------- rate limiter: requests in flight per model, plus a sliding one-minute window ----------
// Measured on our key (Oct 17, 1:45-1:50 PM): a bucket of roughly 48 requests that refills at about 15-20 per
// minute (429 max_requests_limit). A burst drains it, and then a gate-sized run fails. So: a per-minute window
// (LLM_RPM, default 18) and a small concurrency cap (LLM_CONCURRENCY, default 4).

const maxInFlight = () => Number(process.env.LLM_CONCURRENCY ?? 4);
const inFlight = new Map<string, number>();
const waiters = new Map<string, (() => void)[]>();

async function enter(model: string) {
  while ((inFlight.get(model) ?? 0) >= maxInFlight()) await new Promise<void>((r) => waiters.set(model, [...(waiters.get(model) ?? []), r]));
  inFlight.set(model, (inFlight.get(model) ?? 0) + 1);
}

function leave(model: string) {
  inFlight.set(model, (inFlight.get(model) ?? 1) - 1);
  const q = waiters.get(model);
  q?.shift()?.();
}

const rpm = () => Number(process.env.LLM_RPM ?? 18);
const windows = new Map<string, number[]>();
const chains = new Map<string, Promise<unknown>>();

async function acquire(model: string) {
  // serialize acquisition per model so the window check and the push are atomic
  const prev = chains.get(model) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  chains.set(model, prev.then(() => mine));
  await prev;
  try {
    for (;;) {
      const now = Date.now();
      const w = (windows.get(model) ?? []).filter((t) => now - t < 60_000);
      if (w.length < rpm()) {
        w.push(now);
        windows.set(model, w);
        return;
      }
      await sleep(60_000 - (now - w[0]) + 50);
    }
  } finally {
    release();
  }
}

/** Pause a model's window after a 429, so queued calls back off together. */
function penalize(model: string, ms: number) {
  const until = Date.now() + ms - 60_000;
  windows.set(model, Array.from({ length: rpm() }, () => until));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- the call ----------

export interface ChatOptions {
  role: string; // worker | supervisor | clips | ...  (for the llm event)
  thinking?: boolean; // default false: Nemotron thinks by default and it costs 5-20 s
  cache?: boolean; // default true unless LLM_CACHE=0
  meta?: Record<string, unknown>; // extra fields for the llm event (shift_id, robot, ...)
}

export type ChatParams = Omit<ChatCompletionCreateParamsNonStreaming, "stream">;

export async function chat(params: ChatParams, opts: ChatOptions): Promise<ChatCompletion> {
  const body: Record<string, unknown> = {
    temperature: 0,
    max_tokens: 1024,
    ...params,
    chat_template_kwargs: { enable_thinking: !!opts.thinking },
  };
  const useCache = opts.cache !== false && process.env.LLM_CACHE !== "0";
  const key = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (useCache && fs.existsSync(file)) {
    const hit = JSON.parse(fs.readFileSync(file, "utf8")) as ChatCompletion;
    emit("llm", { role: opts.role, model: body.model, cached: true, latency_s: 0, ...usage(hit), ...opts.meta });
    return hit;
  }

  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    const model = String(body.model);
    await acquire(model);
    await enter(model);
    const t0 = Date.now();
    try {
      const res = (await getClient().chat.completions.create(body as any).finally(() => leave(model))) as ChatCompletion;
      const latency_s = +((Date.now() - t0) / 1000).toFixed(2);
      emit("llm", { role: opts.role, model: body.model, cached: false, latency_s, ...usage(res), ...opts.meta });
      if (useCache) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(res));
      }
      return res;
    } catch (err: any) {
      const status = err?.status ?? 0;
      const retryable = status === 429 || status >= 500 || status === 0;
      if (!retryable || attempt >= 6) throw err;
      if (status === 429) penalize(String(body.model), delay);
      console.warn(`[llm] ${opts.role} ${body.model} ${status || err?.code || "error"}; retry ${attempt} in ${delay} ms`);
      await sleep(delay + Math.random() * 500);
      delay = Math.min(delay * 2, 30_000);
    }
  }
}

function usage(r: ChatCompletion) {
  return { prompt_tokens: r.usage?.prompt_tokens ?? null, completion_tokens: r.usage?.completion_tokens ?? null };
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
