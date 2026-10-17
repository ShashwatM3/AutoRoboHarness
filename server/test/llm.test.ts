import assert from "node:assert/strict";
import { after, test } from "node:test";
import { chat } from "../src/llm.ts";

let provider: typeof fetch;
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => provider(...args);
after(() => { globalThis.fetch = originalFetch; });

// Exercise the real chat wrapper with an in-process provider and a virtual clock.
// No network calls, credentials, cache files, or minute-long waits are needed.
test("queued calls respect a provider-wide Retry-After before starting", async (t) => {
  process.env.CRUSOE_API_KEY = "local-test-key";
  process.env.LLM_RPM = "60";
  process.env.LLM_CONCURRENCY = "2";
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100_000 });
  const starts: number[] = [];
  provider = async () => {
    starts.push(Date.now());
    if (starts.length === 1) {
      return new Response(JSON.stringify({ error: { message: "max_requests_limit (orchestrator)" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      });
    }
    return new Response(JSON.stringify({ id: "test", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  const calls = Promise.all(Array.from({ length: 3 }, () => chat({ model: "retry-after-test", messages: [{ role: "user", content: "test" }] }, { role: "test", cache: false })));
  // Let the rejected request reach the wrapper and install its shared cooldown.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const premature = starts.filter((time) => time < 160_000).length;
  for (let i = 0; i < 20; i++) {
    t.mock.timers.tick(60_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await calls;
  assert.equal(premature, 1, "queued callers bypassed the provider's 60-second Retry-After");
  assert.ok(starts[1] >= 160_000, "the next request started before the provider cooldown expired");
});

test("twenty concurrent gate callers are paced at actual request start", async (t) => {
  process.env.LLM_RPM = "60";
  process.env.LLM_CONCURRENCY = "4";
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 2_000_000 });
  const starts: number[] = [];
  provider = async () => {
    starts.push(Date.now());
    return new Response(JSON.stringify({ id: "test", object: "chat.completion", choices: [] }), { headers: { "content-type": "application/json" } });
  };
  const calls = Promise.all(Array.from({ length: 20 }, () => chat({ model: "gate-burst-test", messages: [{ role: "user", content: "test" }] }, { role: "test", cache: false })));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(starts.length, 1, "a gate-sized batch started as a burst");
  for (let i = 0; i < 25; i++) {
    t.mock.timers.tick(1000);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await calls;
  assert.equal(starts.length, 20);
  assert.ok(starts.slice(1).every((time, i) => time - starts[i] >= 1000), "calls reserved quota before their actual start time");
});
