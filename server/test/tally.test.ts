import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { chat, newTally, tally } from "../src/llm.ts";

const CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.cache/llm");
const before = new Set(fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : []);
const originalFetch = globalThis.fetch;
let details: unknown = null;
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      id: "test",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: details },
    }),
    { headers: { "content-type": "application/json" } },
  );
after(() => {
  globalThis.fetch = originalFetch;
  // remove only the response-cache files this test wrote
  for (const f of fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : []) if (!before.has(f)) fs.rmSync(path.join(CACHE_DIR, f));
});

// cache_share counts only live calls whose usage reports cached_tokens; replays from our own cache never count
test("cache_share covers reporting live calls only", async () => {
  process.env.CRUSOE_API_KEY = "local-test-key";
  process.env.LLM_RPM = "600000";
  const t = newTally();
  const ask = (content: string, cache: boolean) => chat({ model: "tally-test", messages: [{ role: "user", content }] }, { role: "test", cache });

  details = { cached_tokens: 60 };
  tally(t, await ask(`reporting ${Date.now()}`, false));
  details = null; // Lightning and DeepSeek report null
  tally(t, await ask(`silent ${Date.now()}`, false));
  assert.equal(t.calls, 2);
  assert.deepEqual(t.crusoe_cache, { calls_reporting: 1, prompt_tokens: 100, cached_tokens: 60 });
  assert.equal(t.cache_share, 0.6);

  details = { cached_tokens: 100 };
  const prompt = `replayed ${Date.now()}`;
  tally(t, await ask(prompt, true)); // live, written to the response cache
  tally(t, await ask(prompt, true)); // replayed from the response cache
  assert.equal(t.calls, 4);
  assert.equal(t.replayed, 1);
  assert.deepEqual(t.crusoe_cache, { calls_reporting: 2, prompt_tokens: 200, cached_tokens: 160 });
  assert.equal(t.cache_share, 0.8);

  const none = newTally();
  details = null;
  tally(none, await ask(`none ${Date.now()}`, false));
  assert.equal(none.cache_share, null, "no reporting call must give null, not 0");
});
