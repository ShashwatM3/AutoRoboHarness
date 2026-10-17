// You.com Research (V2-4): the supervisor's research(question) tool. One lite call (about 6 s) returns a short
// cited answer; each source gets a review-wide id (S1, S2, ...) that insights cite as { kind: "citation", source_id }.
// Retrieved text is evidence for people and the judge only: it is never compiled into the brain.
// Answers are cached by question in server/.cache/youcom/ (LLM_CACHE=0 turns that off), so demos replay.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emit } from "./events.ts";

const URL = "https://api.you.com/v1/research";
const CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.cache/youcom");
export const MAX_RESEARCH_CALLS = 2; // per review

export interface Source {
  id: string; // S1, S2, ... unique within a review
  url: string;
  title: string;
  snippet: string;
}
export interface Research {
  question: string;
  answer: string;
  sources: Source[];
}

interface Raw {
  output?: { content?: string; sources?: { url?: string; title?: string; snippets?: string[] | string }[] };
}

async function fetchResearch(question: string): Promise<Raw> {
  const key = process.env.YDC_API_KEY ?? process.env.YOU_API_KEY;
  if (!key) throw new Error("YDC_API_KEY is not set (repo-root .env)");
  const useCache = process.env.LLM_CACHE !== "0";
  const file = path.join(CACHE_DIR, `${crypto.createHash("sha256").update(`lite\n${question}`).digest("hex").slice(0, 32)}.json`);
  if (useCache && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: "POST",
    headers: { "X-API-Key": key, "content-type": "application/json" },
    body: JSON.stringify({ input: question, research_effort: "lite" }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`You.com research returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = (await res.json()) as Raw;
  emit("research", { question, latency_s: +((Date.now() - t0) / 1000).toFixed(2), sources: raw.output?.sources?.length ?? 0 });
  if (useCache) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(raw));
  }
  return raw;
}

/** Ask one question; `firstId` numbers the sources after the ones the review already has. */
export async function research(question: string, firstId: number): Promise<Research> {
  const raw = await fetchResearch(question);
  const sources = (raw.output?.sources ?? [])
    .filter((s) => /^https?:\/\//i.test(String(s.url ?? "")))
    .slice(0, 6)
    .map((s, i) => {
      const snips = Array.isArray(s.snippets) ? s.snippets : s.snippets ? [s.snippets] : [];
      return { id: `S${firstId + i}`, url: String(s.url), title: String(s.title ?? s.url), snippet: snips.join(" … ").slice(0, 500) };
    });
  return { question, answer: String(raw.output?.content ?? "").slice(0, 2000), sources };
}
