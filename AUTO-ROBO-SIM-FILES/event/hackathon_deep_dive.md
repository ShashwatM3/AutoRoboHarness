# The Recursive Agents Hackathon (Crusoe x Cerebral Valley): Complete Competitive Intelligence Deep Dive

**Prepared for**: Shashwat Mahalanobis
**Date**: October 15, 2026 (the hackathon is on Saturday, October 17)
**Purpose**: A research base for a 30 to 40 minute audio deep dive and for idea selection, covering the event, every sponsor's tools, and the past hackathons that Crusoe and NVIDIA have judged
**Sources**: The event page, the participant guide PDF, Crusoe's official hackathon skill file in the `crusoecloud/crusoe-developer-hub` repository (refreshed October 13, 2026), sponsor documentation and GitHub repositories, and public winner posts. A source list is at the end. Anything that could not be confirmed is marked as unverified.

---

## Part 1: The Hackathon at a Glance

The official name is **The Recursive Agents Hackathon**, and it is co-hosted by Cerebral Valley and Crusoe, with NVIDIA and You.com as partners. It runs on Saturday, October 17, 2026 at Shack15, 1 Ferry Building Suite 201, San Francisco, from 9:00 AM to 10:00 PM Pacific time. The event page frames the theme in one line, which is "Build a team of agents you can walk away from." The longer description asks for agents that take a goal, make a plan, spin up sub-agents, delegate work, talk to each other, check their own progress, recover when things break, and keep going until the work is complete.

The schedule is fixed and tight. Doors open at 9:00 AM with breakfast and team formation, the kick-off is at 10:00 AM, and hacking begins at **10:45 AM**. Lunch arrives at 1:00 PM and submissions are due at **5:00 PM**, which gives exactly **6 hours and 15 minutes of building time**. First-round judging runs from 5:00 PM to 6:45 PM, dinner is at 6:00 PM, the final round for the top six teams runs from 7:00 PM to 8:00 PM, and winners are announced at 8:15 PM.

Several logistics details matter for planning. Teams can have at most four members and solo hackers are allowed, every attendee must have been approved through an application, and attendees must bring a government-issued photo ID to the second-floor front desk. The Wi-Fi credentials are printed in the participant guide PDF and are redacted from this copy. The event Discord is the **Crusoe For Developers** server, and its useful channels are `#access` (react with the 🔄 emoji to get in), `#announcements`, `#intros`, `#team-search`, `#questions` (ping `@CV`), and three sponsor channels, `#crusoe`, `#you.com` and `#nvidia`.

Two pieces of context surround the event. Crusoe is hosting a **Field Day** on Friday, October 16 from 1:00 to 5:00 PM on the Civil War Parade Lawn in the Presidio, and the Luma page describes it as outdoor lawn games and relay races themed on the stages of building a model, with "no laptops, no code." It is a networking event with the Crusoe team, which makes it a cheap way to meet the people who will mentor and probably judge. The event page says the hackathon takes place "during the PyTorch Conference in San Francisco," but Crusoe's own LinkedIn post places PyTorch Conference North America 2026 in **San Jose on October 20 and 21**, so the hackathon is really a lead-in to that conference rather than part of it.

### The rules that can disqualify you

The participant guide lists four rules, and two of them are strict. The repository must be public, which means every line of code the team writes will be inspectable by judges. The demo must only highlight features, code and functionality that the team built during the event, and the guide says that failing to clearly identify original contributions "will result in immediate disqualification." This rule has a practical consequence for this event specifically, because the strongest harnesses on offer (OpenClaw, Hermes, Deep Agents) already ship memory and skill-learning features, so the team must draw a visible line between what the harness provides and what the team built.

The banned-project list bans AI mental health advisors, **basic RAG applications**, **Streamlit applications**, image analyzers, "AI for Education" chatbots, job application screeners, nutrition coaches, personality analyzers, medical advice tools, sports analyzers, and **any project where a dashboard is the main feature**. The dashboard ban matters here because a self-improvement project naturally produces score charts, and the chart must be evidence for an agent system rather than the product itself.

---

## Part 2: The Three Problem Statements, Unpacked

This event has three problem statements. Every one of them begins with the same requirement, "Build an agent team on Crusoe Managed Inference," so the team structure and the Crusoe endpoint are not optional for any of them. Each statement ends with a question, and that question is the real grading rubric for the track.

### Problem Statement 1: Done Means Done

The exact wording is: *"Agents fill in vague goals with their own assumptions, then confidently report success. Build an agent team on Crusoe Managed Inference that writes its own definition of done, checks its work with tests or independent verifier agents, catches itself drifting or looping, and decides whether to continue, re-plan, stop or (rarely) ping a human. How can agents turn a one-line goal into checks they can run without you, so you can actually walk away?"*

The core idea is called a **definition of done**. In software teams, a definition of done is the explicit list of conditions that must be true before a piece of work counts as finished, such as "all tests pass" or "the page loads in under one second." The statement asks the agent team to write that list for itself from a one-line goal, and then to turn each condition into a **check**, which is a test or a question that a machine can evaluate as pass or fail. The phrase "checks they can run without you" is the heart of it, because a check that needs a human to judge it does not let you walk away.

The statement names four further behaviors, and each is a separate piece of machinery. **Verification** means that the agent that did the work is not the agent that grades it, which is why the wording says "independent verifier agents." **Drift** means the agent slowly moves away from the original goal, and **looping** means the agent repeats the same failing action, so the team needs a monitor that compares current activity against the original goal and against its own history. The final piece is a **decision policy**, which is a rule that maps the state of the checks to one of four actions: continue, re-plan, stop, or ping a human.

The word "rarely" in "(rarely) ping a human" is a scoring hint. A system that asks for help every few minutes fails the "walk away" test, and a system that never asks fails on safety. The best demo shows the system escalating to a human exactly once, for a reason it can state, after it has exhausted the actions it could take on its own.

### Problem Statement 2: Shared Brain

The exact wording is: *"Every new agent on a team starts from zero and pays again for the same context. Build a shared memory layer for an agent team on Crusoe Managed Inference: a living project that every agent reads before it works and updates afterward. How can a team keep its shared knowledge current, lean and conflict-free while showing measurable gains in output quality?"*

The problem has two parts that the statement spells out. The first is a **read-before, write-after protocol**, which means every agent loads the shared memory before it starts a task and writes back what it learned when it finishes. The second is maintenance, and the statement names three properties: **current** (stale facts are removed or updated), **lean** (the memory does not grow without limit, because a bloated memory costs tokens and distracts the model), and **conflict-free** (two agents writing contradictory facts get resolved rather than both stored).

The phrase "pays again for the same context" connects directly to Crusoe's main technical asset. Crusoe Managed Inference runs on **MemoryAlloy**, a cluster-wide KV cache described in Part 5, and it bills cached input tokens at a fraction of the normal price. A shared memory that every agent reads as an identical prefix would be served from that cache, so the team could show the "pays again" problem being solved in Crusoe's own numbers, using the `cached_tokens` field that every response returns. No other track lets a team make a sponsor's infrastructure feature the measurable result of the project.

The last clause, "showing measurable gains in output quality," means a memory layer on its own is not enough. The team has to run the same tasks with and without the shared brain and show a quality score that moves. This also protects the project from the "basic RAG" ban, because the product is a maintained, conflict-resolved knowledge base with a measured effect, rather than retrieval over documents.

### Problem Statement 3: Version N+1

The exact wording is: *"Most agent teams are exactly as good on run 100 as on run 1. Build an agent team on Crusoe Managed Inference that improves itself over time: after each run it reviews what worked and what didn't, then rewrites its own prompts, playbooks, tools, or team structure, and keeps a change only if it measurably helps. How can a team turn its own history into a better version of itself, and prove it with a before-and-after score on tasks it hasn't seen?"*

This is the most demanding of the three statements, and its bar is precise. The statement lists four things the team may rewrite: **prompts** (the instructions), **playbooks** (written procedures the agents follow), **tools** (the functions agents can call), and **team structure** (which agents exist and how they hand work to each other). The phrase "keeps a change only if it measurably helps" describes an **accept-or-reject gate**, which is a step where each proposed change is scored and discarded unless the score improves.

The final clause is the most important sentence in the whole guide for this track. "Tasks it hasn't seen" means a **held-out set**, which is a group of test tasks that the improvement process never looks at while it is improving. Without a held-out set, a self-improving system can simply memorize the tasks it trains on, which is called **overfitting**, and its score would rise without the system getting better at anything new. A team that shows a train score and a separate held-out score, with the held-out set locked before the first run, is answering the question exactly as asked.

### How the three statements relate

The three statements are three layers of one system rather than three unrelated topics. Done Means Done is about a single run finishing correctly, Shared Brain is about knowledge carrying across agents within and between runs, and Version N+1 is about the system itself changing across many runs. A strong project picks one statement as its headline and answers it completely, because the judging criteria in Part 3 reward depth far more than breadth.

---

## Part 3: Judging Criteria

Judging has two rounds, and both use a demo of about **3 minutes followed by 1 to 2 minutes of questions**. Round one happens in separate rooms with assigned judging groups, and round two puts the top six teams on stage in front of a panel and all attendees.

The round-one weights should shape how the team builds.

| Criterion | Round one weight | The question the judges ask |
|---|---|---|
| Technicality | **40%** | How difficult is this to recreate? Is it beyond an average hackathon project? Are you impressed with what they built in such a short time? |
| Creativity and Originality | **25%** | How creative is it? Is this something you have never seen before? |
| Live Demo | **20%** | Does the demo impress you? Is it well-engineered and working? |
| Future Potential and AI Impact | **15%** | Does it point toward an interesting future for AI? Does it advance how we think about AI capabilities, autonomy, learning, evaluation, or agentic systems? |

In round two, all four criteria are weighted equally at 25% each.

The first implication is that **Technicality is now the single largest lever**. Here, 40% of the round-one score rewards engineering that is hard to recreate, which favors real machinery such as a held-out evaluation harness, a verifier running on a different model, a conflict-resolution step in memory, or a policy-enforced sandbox. The guide's phrase "in such a short time" also means judges will mentally discount anything that existed before the event, which reinforces the original-work rule.

The second implication is that **Creativity jumped from 15% to 25%**. Together with Technicality, it makes up 65% of round one, so the team needs a project that is both hard and unfamiliar. Self-improving agents and shared memory are popular topics in 2026, as Part 9 shows, so originality has to come from the specific mechanism or the specific target domain, not from the general idea.

The third implication concerns the impact criterion, which was rewritten. Many hackathons ask whether a project addresses a real-world pain point, while this event asks whether it "point[s] toward an interesting future for AI" and "advance[s] how we think about AI capabilities, autonomy, learning, evaluation, or agentic systems." That is a research-flavored question. A team that can say what its result teaches about agents in general (for example, "verifiers on a different model family catch errors that self-checks miss, and here is the measured difference") will score better than a team that only quotes market statistics.

The demo still matters, at 20% in round one and 25% in round two, and the guide asks whether it is "well-engineered and working." The safest reading is that the demo must work live, but it no longer needs to be theatrical to reach the final. In the final, every criterion is equal, so the team that reaches the stage with deep technicality must also be ready to perform.

---

## Part 4: Prizes, and How They Stack

The cash and credit prizes are as follows.

| Place or award | Prize |
|---|---|
| 1st place | $14,000 cash and $1,000 in You.com credits |
| 2nd place | $8,000 cash and $500 in You.com credits |
| 3rd place | $3,000 cash and $250 in You.com credits |
| Best Use of NemoClaw and OpenShell | $100 in NVIDIA Brev credits per person |
| Best Use of Nemotron | One NVIDIA RTX 5090 |

The three podium prizes add up to the advertised $25,000 in cash. The two NVIDIA awards are separate category prizes, and nothing in the guide says a podium team cannot also win one of them, so a project could plausibly collect a podium prize and an NVIDIA award together. The RTX 5090 is the most valuable single item after first and second place, and its retail value is well above the Brev credits.

The NVIDIA awards reward depth in specific tools, and past events show what that means. At the AITX x NVIDIA hackathon in July 2026, the "Best Use of NemoClaw + OpenShell" bounty went to a project whose OpenShell policy acted as a publishing gate, and at NVIDIA Spark Hack Seattle in August 2026 the same award went to a team that used OpenShell egress policies to lock a disaster-response agent to local data (details in Part 9). In both cases the winning use of OpenShell was a visible, demonstrated boundary on what the agent could do, not a line in the README.

---

## Part 5: Sponsor 1, Crusoe

### Who Crusoe is

Crusoe describes itself as "the industry's first vertically integrated AI infrastructure provider," which means it controls every layer from power generation through data centers and GPUs to the API that returns tokens. The company launched in 2018 as a cryptocurrency mining business that used otherwise-wasted natural gas, then pivoted to AI infrastructure and divested its crypto operations. Its co-founder and CEO is **Chase Lochmiller**, and the company is headquartered in Denver with offices that include San Francisco, Bellevue and New York.

The company's scale is large and growing quickly. On **September 17, 2026**, Crusoe announced the initial close of a **$3.9 billion Series F at a $30.9 billion post-money valuation**, co-led by Atreides Management, Mubadala Capital and Valor Equity Partners, with participation from Founders Fund, GIC, **NVIDIA**, Qatar Investment Authority, Radical Ventures and TPG. That round came ten months after a $1.38 billion raise at a $10 billion valuation, and Axios reported that Crusoe has discussed a possible IPO with investment banks. Crusoe reports over 6 GW of contracted capacity, over 1 GW delivered and operational, and a workforce of more than 1,800 people across five countries.

Crusoe's best-known project is the **Abilene, Texas campus**, the first Stargate site, which Crusoe designed and built and which OpenAI used to train its model Astra. Crusoe's Series F announcement says buildings three through six are online, with seven and eight expected before the end of 2026. The newer strategy is **Crusoe Spark**, a line of factory-built modular data centers that ship on trucks and plug into 10 to 100 megawatt pockets of spare grid capacity, which Lochmiller describes as the right shape for inference rather than training. Crusoe has also announced a solar and second-life EV battery microgrid with Redwood Materials and a planned nuclear-powered AI factory with Aalo Atomics, with a 2027 proof of concept at Idaho National Laboratory.

NVIDIA is both an investor in Crusoe and its main hardware supplier, and that relationship explains why the two companies appear together at so many hackathons in 2026 (Part 9).

### The product map

Crusoe Cloud has two families of products, and the developer hub README draws them as two branches.

**Infrastructure Cloud** is the layer a customer operates directly.
- GPU virtual machines are available on NVIDIA GB200, B300, B200, H200, H100, A100 and L40S, and on AMD MI355X and MI300X, with InfiniBand or RDMA fabrics for multi-node training.
- Crusoe Managed Kubernetes provides a control plane with GPU drivers preinstalled, and **AutoClusters** adds automatic node remediation.
- Crusoe Managed Slurm provides the familiar `sbatch` and `srun` workflow on a Crusoe-managed control plane.
- Storage, networking, a container registry, and **Command Center** cover topology, health, metrics and logs.
- The tooling includes the Console, a CLI, a Terraform provider, versioned REST APIs, and a **Crusoe MCP server** (in preview) that lets agents such as Claude or Cursor query and analyze a customer's Crusoe infrastructure.

**Intelligence Foundry** is the managed layer, and it is the part this hackathon uses.
- **Managed Inference** serves open-weight models behind one OpenAI-compatible API, in three forms. **Serverless Inference** is billed per token with shared rate limits, **Self-Serve Deployments** (generally available since July 14, 2026) give dedicated H100 or H200 endpoints billed per GPU-hour at $5.50 and $6.00 respectively, and **Tailored Deployments** are custom, SLA-backed setups arranged through sales.
- **Serverless Fine-Tuning** (generally available since July 14, 2026) runs LoRA-based supervised fine-tuning from a JSONL or Parquet dataset of up to 3 GB, stops early when validation loss plateaus, returns weights as `.safetensors`, and can deploy the result to Self-Serve Deployments in one click. An **LLM-as-judge evaluation** feature is in preview.

### MemoryAlloy, the technical asset Crusoe will want to hear about

**MemoryAlloy** is Crusoe's proprietary memory layer for inference, launched with Managed Inference on November 20, 2025. To understand it, the term **KV cache** needs a definition first. When a language model reads a prompt, it computes intermediate values called keys and values for every token, and this first pass over the prompt is called **prefill**. The KV cache stores those values so that a later request beginning with the same text, called the same **prefix**, can skip the prefill work for that part.

In a normal serving stack, each GPU or node keeps its own KV cache, so a request that lands on a different machine has to recompute the prefix from scratch. MemoryAlloy pools the KV cache across the whole cluster, so any machine can fetch a prefix that any other machine already computed. A **KV-aware gateway** sits in front of the cluster, estimates the time to first token for each request on each candidate engine, and routes the request to the engine that already holds the most of its prefix. Crusoe's engineering blog reports up to **9.9x faster time to first token** and up to **5x higher throughput** than vLLM on Llama 3.3 70B, and cross-node cache hits that run nearly as fast as local ones.

For this hackathon, MemoryAlloy turns into a simple, provable behavior. Every response includes `usage.prompt_tokens_details.cached_tokens`, and the skill file explains that a multi-turn agent loop keeps its system prompt, tool definitions and earlier turns byte-identical between requests, so only the newest tokens need fresh compute. The skill file warns that whitespace, tool ordering and JSON key order all break the cache, that rewriting an earlier message invalidates the cache from that point on, and that the first request of a session is always cold. Cached input on DeepSeek V4 Flash costs $0.03 per million tokens against $0.14 uncached, and on DeepSeek V4.1 Flash it costs **$0.007** per million, the lowest of any listed model.

### The model catalog (as of October 13, 2026)

All models are served from `https://api.inference.crusoecloud.com/v1`. Prices are in US dollars per million tokens, in the order input, output, cached input.

| Model ID (exact API spelling) | Context | Price (in / out / cached) | What it is good for |
|---|---|---|---|
| `nvidia/Nemotron-3-Super-120B-A12B` | 262k | $0.30 / $2.40 / $0.15 | Collaborative agents, tool use, long-context reasoning |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | **1M** | $0.05 / $0.20 / $0.03 | Long-running agents and sub-agent workhorse roles |
| `nvidia/Nemotron-3-Nano-30B-A3B` | 262k | $0.05 / $0.20 / $0.03 | Cheap, high-volume calls |
| `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B` | 262k | $0.30 / $1.83 / $0.30 | Video, audio, image and text input, reasoning output |
| `nvidia/Nemotron-3-VoiceChat` | 131k | Contact sales | Speech-to-speech (request format undocumented) |
| Nemotron 3 Ultra 550B (`nvidia/NVIDIA-Nemotron-3-Ultra-550B` in Crusoe's Pi guide) | 262k | $1.00 / $3.20 / $0.25 | Frontier-level planning; confirm availability with `/v1/models` |
| `deepseek-ai/Deepseek-V4-Flash` (lowercase "s") | 1M | $0.14 / $0.28 / $0.03 | Cheap general text |
| `deepseek-ai/DeepSeek-V4.1-Flash` | 1M | $0.29 / $0.20 / $0.007 | Input-heavy agent loops with repeated prefixes |
| `deepseek-ai/DeepSeek-V4-Pro` | 1M | $1.74 / $3.48 / $0.15 | Heavy reasoning |
| `zai-org/GLM-5.3-Flash` | 1M | $0.15 / $0.50 / $0.03 | Image and text |
| GLM-5.3 (docs spell it `zai/GLM-5.3`) | 1M | $1.40 / $4.40 / $0.26 | Coding and long-horizon tasks; confirm the prefix |
| `openai/gpt-oss-120b` | 128k | $0.05 / $0.20 / $0.05 | The most reliable tool calling in OpenCode, according to Crusoe |
| `google/gemma-4-31b-it` | 262k | $0.14 / $0.40 / $0.14 | Image understanding with no reasoning phase |
| `Qwen/Qwen3.8-27B` | 256k | Not listed | Image, video and text |

Two facts in this table are traps. The participant guide says Nemotron 3 has "1M-token context," but on Crusoe only Lightning 3.5 has 1M context; Super, Nano and Omni are served at 262k. Several older Crusoe examples, including the developer hub README itself, still use `meta-llama/Llama-3.3-70B-Instruct`, which was deprecated on September 12, 2026, along with Kimi K2.6 (October 2), GLM-5.1 and 5.2, DeepSeek V3, and Qwen3 235B. Model IDs are case-sensitive, and the only trustworthy source is the `id` field returned by `GET /v1/models`.

### Rate limits, which will shape the architecture

Crusoe applies limits **per project and per model**, and they reset every minute. A project with no payment method gets **30 requests per minute and 500,000 tokens per minute per model**, and a project with a payment method on file gets **600 requests per minute and 2,000,000 tokens per minute per model**. The hackathon README also says a valid credit card is required to claim the free credits, so the team should add one immediately.

These limits matter far more for this event than for an ordinary app. Every turn of an agent loop is one request, so five sub-agents each taking a turn every ten seconds already reach 30 requests per minute on one model. Because limits are per model, spreading roles across different models also spreads the load, which is a technical argument for exactly the kind of model routing that Crusoe's judges praised at past events (Part 9). A `429` response means the project hit its limit, a `503` means the shared endpoint is busy, and both should be retried with exponential backoff and jitter; every response also carries `x-ratelimit-remaining-requests` and `x-ratelimit-remaining-tokens` headers so a scheduler can throttle before it hits the wall.

### Request details that commonly break agent loops

The skill file documents the failures that Crusoe sees most often, and an agent team will hit all of them.
- Reasoning models spend output tokens thinking before they answer, so a small `max_tokens` value returns empty content with `finish_reason` set to `length`; at least 1,024 tokens is the stated minimum.
- Thinking is turned on per model through `chat_template_kwargs`, for example `{"thinking": true}` on DeepSeek V4 Pro or `{"enable_thinking": true}` on Nemotron, and DeepSeek's own `thinking` parameter is blocked with a `403`.
- Tool calling uses the standard OpenAI `tools` format, and the assistant message containing `tool_calls` must be appended before the `tool` result messages or the API returns a `400`.
- API keys can contain `$` characters, so they must be exported in single quotes, and a double-quoted key silently becomes a different string that fails with `401` or `403`.

### Metrics that can serve as proof in a demo

Crusoe exposes per-model metrics in the Console at `console.crusoecloud.com/foundry/metrics`, and they can be queried with **PromQL**, the query language used by the Prometheus monitoring system. The available series include request rate, requests by status code (including 429s), input, output and cached token rates, **prefix cache hit rate**, time to first token, time per output token, and end-to-end latency at any percentile. A monitoring token created with `crusoe monitoring tokens create` lets the same queries run from Grafana or a script. For a Shared Brain project, a live chart of prefix cache hit rate climbing as agents share one memory prefix would be a Crusoe-native piece of evidence that no other team is likely to show.

### Connecting agent harnesses to Crusoe

Any OpenAI-compatible client works by pointing its base URL at the Crusoe endpoint, and the skill file gives tested configurations for three harnesses. **OpenCode** wants the base URL with a trailing slash (`.../v1/`), **Pi** wants it without one, and **OpenClaw** is added as a custom provider with `api: "openai-completions"` and `models.mode: "merge"` so that other providers stay available as fallbacks. For OpenClaw, the skill file stresses that the one-shot `openclaw infer` probe does not exercise the fallback chain, and that the real check is `openclaw agent --session-key ... --json` followed by confirming `executionTrace.winnerProvider` is `crusoe`.

The developer hub also contains integration packages for **LangChain** (a `langchain-crusoe` package published from the repo), **LiteLLM** (with a CrewAI demo), **MLflow**, **Google ADK**, Postman, Hugging Face Spaces, Cursor, Zed and Linkup. The Hugging Face folder contains small example apps, including a debate arena and a chess AI, that show Crusoe's own taste in demos.

### Crusoe's open-source work

Crusoe's GitHub organization is mostly infrastructure tooling, but a few repositories are relevant to an agent builder.
- **`fastokens`** is a Rust-backed BPE tokenizer that Crusoe reports as more than 10x faster than Hugging Face `tokenizers`, with a drop-in patch for `transformers` and support for NVIDIA Dynamo; its README example tokenizes with a Nemotron 3 Nano tokenizer.
- **`crusoe-developer-hub`** holds the hackathon guide, the skill file, GPU-programming lessons in Triton, LoRA lessons, and the integrations listed above.
- The **CLI**, the **Terraform provider**, the **Go client**, `crusoe-watch-agent` (a vector.dev telemetry agent), and Slurm and Kubernetes tooling round out the rest.

### Who from Crusoe is likely in the room

The judges for this event have not been published on the event page, in the PDF, or in the skill file, which explicitly says judges are not covered. The people who organized and judged Crusoe's 2026 hackathon tracks are the most likely mentors and judges. **Emmanuel Acheampong** (Senior Manager, Developer Relations) led the internal hack.crusoe and judged the DevNetwork Crusoe challenge, **Connor Guerrero** (Developer Relations and ML Engineer) co-organized hack.crusoe and judged at DevNetwork and RAISE, **Aryan Raikar** judged the RAISE multimodal agents track, and **Judy Wu** was credited with the backend for both DevNetwork and RAISE. This is an inference from past events, not a published list.

---

## Part 6: Sponsor 2, NVIDIA

NVIDIA's presence at this event is concentrated in two products named in the guide, **NemoClaw with OpenShell** and **Nemotron**, and each has its own prize. Behind those two products sits a large open-source toolkit for building, measuring and improving agents, and several of those tools map almost exactly onto the three problem statements.

### NemoClaw and OpenShell

The guide describes NemoClaw in one paragraph: run always-on agents in a sandbox instead of on your machine, install OpenClaw, Hermes or LangChain Deep Agents with one command, apply OpenShell guardrails for network, filesystem, process and inference, and keep provider keys on the host. The two names refer to different layers, and the distinction matters for the prize.

**OpenShell** is the runtime. NVIDIA announced it at GTC on March 16, 2026, it is open source under Apache 2.0, it is now on a 0.1.x release line, and its GitHub repository has about 16,300 stars. OpenShell runs each agent in an isolated sandbox and enforces policy at the operating-system level rather than through prompts, using Linux security features such as seccomp (which restricts system calls), Landlock (which restricts filesystem access), network namespaces, privilege dropping, and a no-new-privileges flag. NVIDIA's blog calls this **out-of-process policy enforcement**, which means the rules live outside the agent's process, so a compromised or confused agent cannot talk its way past them.

OpenShell has four further features that make strong demo moments.
- **Providers** replace real credentials inside the sandbox with placeholder tokens, and an outbound proxy swaps in the real values only for requests to approved endpoints, so the agent never sees the actual key.
- **Operator approval** means that when an agent tries to reach an unlisted host, the request is blocked and shown to a human in the `openshell term` interface, who can allow it for the session or deny it; a permanent rule is added with a command such as `nemoclaw <sandbox> policy-add`.
- **Live policy updates** apply without restarting the sandbox, and every allow or deny decision is written to an audit trail.
- **The policy prover and advisor** use formal verification, which is a mathematical check of what a policy permits, to flag any new access that a proposed policy change would grant before a human approves it.

The NVIDIA blog adds a point that fits this hackathon closely. When an agent hits a constraint, it "can reason about the roadblock and propose a policy update, leaving you with the final approval." That is a built-in version of the "rarely ping a human" behavior from Done Means Done, enforced by the environment rather than by the agent's good behavior. OpenShell installs with `curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh`, a sandbox starts with `openshell sandbox create --name demo`, and a community OpenClaw sandbox starts with `openshell sandbox create --from openclaw`. It requires Linux, macOS on Apple Silicon, or Windows with WSL 2, plus Docker, Podman or host virtualization.

**NemoClaw** is the reference stack that sits on top of OpenShell. It was announced at the same GTC keynote, its GitHub repository has about 22,700 stars, and its current release line is around v0.0.133. NemoClaw adds guided onboarding (`nemoclaw onboard`), hardened and digest-pinned images, a versioned blueprint with stricter default policies, automatic credential handling that filters sensitive environment variables out of the sandbox, managed inference routing, a Telegram bridge for remote control, and state-preserving rebuilds. It supports three agent harnesses: **OpenClaw** (the default), **Hermes**, and **LangChain Deep Agents Code**. NVIDIA still calls it early-stage and warns developers to "expect rough edges," so the team should test the install on its own machines before Saturday.

The NemoClaw documentation draws a clear line between the two paths, and it helps decide what to build. The NemoClaw path adopts NVIDIA's tested reference setup with the least integration work, while the OpenShell path supplies a custom container, custom policy YAML and custom provider setup, with OpenShell as the sandbox and policy engine. A team that writes its own policies for its own multi-agent system, and shows them blocking something live, demonstrates more original work than a team that only runs the default installer.

### Nemotron, the model family

**Nemotron** is NVIDIA's family of open models, and NVIDIA's distinguishing claim is that it releases not only weights but also training data and training recipes. The current generation, **Nemotron 3**, uses a hybrid architecture that mixes **Mamba-2 layers** (a type of sequence layer whose cost grows linearly with length, unlike attention), **Mixture-of-Experts layers** (where a router sends each token to a few expert sub-networks so only a fraction of parameters run per token), and a small number of attention layers. The newer models are released under the **OpenMDW license** from the Linux Foundation.

| Model | Size (total / active parameters) | Release | Role |
|---|---|---|---|
| Nemotron 3 Nano | 30B / about 3B | December 2025 | Cheap, efficient general model |
| Nemotron 3 Super | 120B / 12B | March 2026 | Collaborative agents and high-volume reasoning |
| Nemotron 3 Ultra | 550B / 55B | Announced at Computex in May 2026, research release June 4, 2026 | The family's frontier model for planning and orchestration |
| Nemotron 3.5 Lightning | 30B / 3B | August 11, 2026 | Execution layer of long-running agents |
| Nemotron 3 Nano Omni | 30B / about 3B | 2026 | Video, audio, image and text perception |
| Nemotron 3.5 Super | 120B / 12B, multimodal | Technical report published | Now listed on our Crusoe project as nvidia/NVIDIA-Nemotron-3.5-Super-VL |

**Nemotron 3.5 Lightning** deserves special attention because its launch materials describe this hackathon's theme almost word for word. NVIDIA says long-running agents spend most of their time on "high-volume execution: tool calls, result validation, and subagent delegation," and positions Lightning as the model for that execution layer while a frontier model handles planning. Lightning was distilled from Nemotron 3 Ultra, trained specifically for harnesses such as OpenClaw and Hermes, supports a 1M-token context, and ships with three **speculative decoding** methods (MTP, DFlash and DSpark), which are techniques where a small fast drafter proposes several tokens and the main model verifies them in one step. NVIDIA reports 86% accuracy on PinchBench, up to 4x higher throughput than similar open models, and 30% faster task completion than Qwen3.6 35B.

**Nemotron 3 Ultra** is the planner in NVIDIA's own reference picture. Its technical report describes 20 trillion pre-training tokens in NVFP4 (NVIDIA's 4-bit floating-point format), LatentMoE, multi-token prediction, multi-environment reinforcement learning with verifiable rewards, and reasoning budget control, and it reports 5.9x the throughput of GLM-5.1 and 4.8x that of Kimi K2.6 at similar accuracy. The **Nemotron Coalition**, announced at GTC in March 2026, is a group of labs including Mistral AI, Cursor, LangChain, Perplexity, Thinking Machines Lab, Black Forest Labs, Reflection AI and Sarvam, later joined by H Company, NAVER Cloud, Nous Research and Prime Intellect, that will co-develop the base model for Nemotron 4.

To win the **Best Use of Nemotron** prize, the evidence from past events (Part 9) points one way. The winners used Nemotron for load-bearing roles, often several Nemotron models in different roles, and they could say why each model was chosen. A team that runs Ultra or Super as planner, Lightning as the executor fleet, and Nano Omni as a perception layer, and that shows the cost and latency effect of that split, is using Nemotron the way NVIDIA itself recommends.

### NVIDIA's agent-improvement toolkit

NVIDIA publishes several open-source tools that are not mentioned in the guide but map directly onto the problem statements.

- **NeMo Agent Toolkit** (`NVIDIA/NeMo-Agent-Toolkit`, version 1.8) is a framework-agnostic library that adds profiling, evaluation and optimization to agents built in LangChain, LlamaIndex, CrewAI, Semantic Kernel, Google ADK or plain Python. Its **profiler** tracks tokens and timing down to each tool call, its **evaluator** scores workflows, and its **optimizer** tunes numeric parameters with Optuna and evolves prompts with a genetic algorithm that uses an LLM to mutate and recombine candidate prompts. It also has a **finetuning harness** for on-policy reinforcement learning (GRPO, PPO or DPO) from agent trajectories.
- **The NeMo Platform Agent Optimizer** inspects a deployed agent and writes suggestions, including model swaps, prompt optimization, and `nemo agents optimize-skills`, which improves an agent's skill files and **keeps only the changes that pass evaluation**. That last behavior is exactly the accept-or-reject gate that Version N+1 asks for, which makes it both an inspiration and a warning, because a team that simply runs it would not be presenting original work.
- **NeMo Switchyard**, released August 11, 2026, is an open-source model-routing library. It separates routing logic from provider endpoints and ships tuning-free routers (an LLM classifier, a stage router, an escalation router) and tunable prefill routers that learn to predict which model will succeed on a request.
- **NeMo Gym** builds training and evaluation environments for agents, **NeMo RL** runs reinforcement learning post-training, **Data Designer** generates synthetic data, and **Curator** cleans and curates datasets.
- **NeMo Guardrails** adds programmable rails to conversations, and **garak** is an LLM vulnerability scanner, both of which could support a verifier or safety layer.
- **The Data Flywheel Blueprint** collects agent traces and uses them to fine-tune and evaluate smaller replacement models, which is a production version of "turning history into a better version of itself."
- **Dynamo** is NVIDIA's distributed inference-serving framework, and **TensorRT-LLM** is its optimized inference library, both relevant only if the team self-hosts.

### NVIDIA Brev and DGX Spark

The NemoClaw prize pays in **Brev credits**, so the team should know what Brev is. **NVIDIA Brev** is a developer cloud that launches GPU instances across more than 20 cloud providers from one console or terminal, and its **Launchables** are one-click templates that bundle GPU hardware, a software environment and code into a shareable link. Brev credits are an organization-wide balance consumed by running instances, and NVIDIA's own hackathons use Brev as the cloud track for teams without local hardware. **DGX Spark** is NVIDIA's desktop AI computer built on the GB10 Grace Blackwell chip, and it appears as a prize or a provided machine at most of NVIDIA's 2026 hackathons.

---

## Part 7: Sponsor 3, You.com

You.com appears in the guide as a provider of "web search and research APIs that give your agent real-time, cited results from the web," and it puts credits on all three podium prizes. You.com runs its own web crawler, web index and news index, so its results are not resold from Google or Bing, a point it emphasizes because Microsoft retired the Bing Search APIs in August 2025.

### The five APIs

| API | Endpoint | What it returns | Listed price |
|---|---|---|---|
| Web Search | `POST https://ydc-index.io/v1/search` | Ranked web and news results as JSON, with snippets, query-relevant highlights, or full-page Markdown | $5.00 per 1,000 calls |
| Contents | `POST https://ydc-index.io/v1/contents` | Clean Markdown or HTML from URLs you supply | $1.00 per 1,000 pages |
| Answer | `POST https://api.you.com/v1/answer` | One cited, synthesized answer | See pricing page |
| Research | `POST https://api.you.com/v1/research` | Multi-step, cited research with a `research_effort` setting from `lite` through `standard`, `deep`, `exhaustive` and `frontier` | $12 per 1,000 (`lite`) up to $1,200 per 1,000 (`frontier`) |
| Finance Research | `POST https://api.you.com/v1/finance_research` | Cited answers from a finance index of filings, prices and fundamentals | See pricing page |

One detail causes confusing failures. Search and Contents live on `ydc-index.io`, while Answer, Research, Finance Research and the MCP server live on `api.you.com`, and sending a Research request to the wrong host returns a `403` even with a valid key. Every request sends the key in the `X-API-Key` header. New accounts receive $100 in free credits, which You.com estimates at roughly 20,000 searches.

### The MCP server and agent skills

You.com hosts an **MCP server** at `https://api.you.com/mcp`, and MCP (Model Context Protocol) is the open standard that lets an agent discover and call external tools. The server exposes `you-search`, `you-contents`, `you-research`, `you-finance`, `you-balance` and `you-discover`, and a keyless free profile at `https://api.you.com/mcp?profile=free` allows `you-search` and `you-discover` for 100 queries per day. A separate Docs MCP server at `https://you.com/docs/_mcp/server` searches You.com's own documentation without a key.

The guide points to **`youdotcom-oss/agent-skills`**, a repository of instruction packs that tell an agent which You.com tool to use for which job. The skills are `you-web`, `you-research`, `you-finance`, `you-discover`, and a keyless `you-free`, and they install into the same harnesses NemoClaw supports: OpenClaw with `openclaw plugins install clawhub:you`, Hermes with `hermes plugins install youdotcom-oss/agent-skills` followed by `hermes plugins enable you`, Pi with `pi install npm:@youdotcom-oss/pi`, and OpenCode with `opencode plugin @youdotcom-oss/opencode`. The `you-web` skill encodes a simple routing rule: use Contents when the user supplied URLs, Research when a cited synthesis is needed, Search with live crawling when full pages are needed, and plain Search otherwise.

### You.com's open-source work and its links to NVIDIA

You.com's GitHub organization (`youdotcom-oss`) has more than the skills. It publishes **`web-search-api-evals`** and **`ydc-deep-research-evals`**, two evaluation frameworks for search and deep-research systems, and You.com states that its evaluation methodology won a Best Paper Award at AAAI 2026 (this is You.com's own claim). It maintains SDKs for Python and TypeScript, a LangChain integration, a Vercel AI SDK plugin, a Temporal plugin, and example agents built with LangChain Deep Agents. It also maintains forks of NVIDIA's **NeMo Gym**, of OpenAI's gpt-oss, and of the Strands Agents harness SDK, which suggests active work on agent training environments. A Cerebral Valley event listing describes a talk in which CoreWeave, NVIDIA and You.com "achieved 15x faster model reloads while post-training Nemotron 3.5 Lightning," which, if accurate, means You.com has worked directly on the Nemotron model this hackathon features.

### What You.com hackathon winners look like

You.com keeps a public list called **`awesome-you`** of projects built on its APIs at hackathons, with winners marked, and the list is unusually useful because it shows what You.com's judges reward. At the **Build with YOU Hackathon NYC** (September 11 and 12, 2026, co-hosted with CrewAI and Daytona), most submissions were self-improving agents. Examples include **Kojable**, a "self-improving Answer Alignment agent" that reported improving from 63% to 90% alignment in one verified run; **REPAIR**, a safety layer that learns rules from mistakes, tests them in sandboxes, and enforces them deterministically; and the second-place winner **Cleanroom**, which learns to extract datasets by recalling past failures and uses a contextual bandit to decide how much context each page deserves. The third-place winner, **F You Money**, drafts claims paperwork but "stops before sending," which is the same human gate pattern that appears across NVIDIA's winners.

The lesson for using You.com here is that it fits naturally as the **grounding source for a verifier**. A Done Means Done verifier that checks factual claims against cited web sources, or a Shared Brain that records the source URL and date of every fact so that stale facts can be re-checked, uses You.com for a core function rather than a decorative search box.

---

## Part 8: The Agent Harnesses You Can Build On

The term **agent harness** means the software around a model that turns it into an agent: the loop that calls the model, the tool definitions, the memory, the sandbox, and the rules for when to stop. NemoClaw supports three harnesses, Crusoe documents three, and they overlap.

| Harness | GitHub stars | What it is | Fit for this event |
|---|---|---|---|
| **OpenClaw** | about 392,000 | A self-hosted assistant gateway that connects agents to Discord, Slack, Telegram, WhatsApp and many other channels, with memory and plugins, stewarded by the OpenClaw Foundation | The default NemoClaw harness and the one NVIDIA's examples use most |
| **Hermes Agent** (Nous Research) | about 254,000 | "The self-improving AI agent" with a built-in learning loop that creates skills from experience, improves them during use, searches its own past sessions, spawns isolated subagents, and runs cron jobs | Strong for always-on teams, but its built-in learning loop overlaps Version N+1, so original work must be clearly separate |
| **LangChain Deep Agents** | about 30,300 | "The batteries-included agent harness" on LangGraph, with sub-agents in isolated context windows, a pluggable filesystem, context summarization, persistent memory, human-in-the-loop approval, and skills | The most programmable option for a custom team structure; Deep Agents Code is the NemoClaw-supported variant |
| **OpenCode** | n/a | An open-source terminal coding agent | Crusoe recommends `gpt-oss-120b` for its tool calling |
| **Pi** | n/a | A community coding agent with a simple provider config | Documented by Crusoe, not endorsed |

The choice of harness is partly a strategic question about the original-work rule. A team that builds on Hermes and demonstrates "the agent learned a new skill" risks a judge asking whether Hermes already does that, and Hermes's README says it does. A team that builds its own orchestration on Deep Agents or plain Python, runs the agents inside OpenShell, and writes its own evaluation and memory logic has an easier time showing what is new. The DevNetwork winner Leavitt (Part 9) handled this well by running Hermes as the outer harness and its own open-source state-machine runtime as the inner one, so the boundary between borrowed and built was obvious.

---

## Part 9: Past Hackathons Judged by Crusoe and NVIDIA

The research covered three groups of events, matching the three questions asked: events where Crusoe and NVIDIA appeared together, events where Crusoe sponsored and judged with other partners, and events where NVIDIA sponsored and judged. The surprise is how many there are in 2026, and how consistent their winners are.

### Group A: Crusoe and NVIDIA together

**DevNetwork [AI + ML] Hackathon 2026 (May 11 to 28, 2026, South San Francisco and online).** This is the closest precedent to the October event, because the Crusoe challenge was titled "Your Harness, Our Inference: Build a Nemotron Agent" and its brief was to build a Nous Research Hermes or NemoClaw agent running NVIDIA Nemotron on Crusoe Managed Inference. NVIDIA supplied a **DGX Spark** as the first prize through its Developer Champions program, and a Mac mini was second. The event drew 1,126 participants and over 200 projects, 33 of them in the Crusoe track, and Crusoe reported "millions of tokens generated on Nemotron-3-Nano-30B over the run." The judges included Emmanuel Acheampong, Connor Guerrero, Joseph Kolko and Rahul Dhide from Crusoe, and the overall round-one criteria were progress, concept, and feasibility as a business.

The winners show what Crusoe's DevRel team rewards. **Argus** (first place, Aditya Rawat) is a "dual-cognition" SRE agent, meaning it runs two models in lockstep: a primary Claude reasoner through the TrueFoundry gateway and a shadow Nemotron on Crusoe. If one degrades mid-investigation, the other takes over with no context loss, and "cross-model disagreement becomes a real-time signal for hallucination." **Leavitt** (second place, Adam Rahman) is a read-only on-call agent that reads Prometheus, Loki, k6 and feature-flag state through MCP and reports a root cause "with a confidence it can defend." Its key idea is **Theodosia**, an open-source runtime the author shipped the same week that mounts a workflow written as a state machine (in Apache Burr) as an MCP server, so the agent can only move along validated transitions and every step is recorded and replayable. The author evaluated it against Microsoft's AIOpsLab incident-management benchmark and argued that "the bare agent drifts to confident wrong answers" under chaos, while the state machine holds.

The **overall** DevNetwork winner was also a Crusoe project. **crusoe-nemotron-harness** (Mukunda Katta) wraps any Nemotron provider on Crusoe and produces a single run report with total cost, p50 and p95 latency, tool failures, blocked off-allowlist network calls, token usage against a cap, and whether the run aborted on budget. It has six modules for cost, egress, tool-argument vetting, snapshots, traces and budget, sixty tests that pass in under a tenth of a second, and a seed-deterministic fake provider so that "judges see the same numbers I do."

**RAISE Summit Hackathon (July 4 to 5, 2026, Paris).** Cerebral Valley ran this event, which drew more than 6,000 builders, and Crusoe sponsored a "multi-modal AI agents" track for 150 onsite builders with the brief of going "from a raw API call to tool-calling, operator-in-the-loop agents." NVIDIA was a partner and gave a separate **Best Use of Nemotron** award. The Crusoe track results were **Roboss** (first, autonomous agents that generate photorealistic video-to-action robot training data from text and check whether the actions are physically plausible), **PRAETOR** (second, a factory digital twin built on physics-informed neural networks, where alerts must pass "an LLM jury (NVIDIA Nemotron Ultra, served through Crusoe Managed Inference)" scoring grounding, safety and actionability, and where operator overrides feed back into how the agents judge the next case), and **Call of Dauty** (third, decision support for Ebola test-kit resupply in the DRC). NVIDIA's Nemotron award went to **Robinsun**, a solar-farm agent that fused more than 11 data sources and dispatched a real drone to check suspected panel damage.

The most useful single piece of judging insight in this research comes from RAISE. **Aryan Raikar**, who judged the Crusoe track, wrote that "the teams I scored highest kept the cheap model running the whole time to monitor live data streams, and only reached for the expensive one when something needed judgement," and that "if you cared about latency, you didn't ask one model to do everything." He added that the number nobody could give him was where a small perception model plus a heavy reasoner "actually beats a single big model on latency and cost per decision." A team that brings that measurement to the October event would be answering a question a Crusoe judge publicly said he wanted answered. A separate LinkedIn post claims a first place in "the Crusoe Track at the RAISE Hackathon in Paris" for an EV-depot agent called DepotOps; it may refer to the online track, and it could not be verified.

**hack.crusoe (May 2026, internal).** Crusoe's first company-wide hackathon was organized by Emmanuel Acheampong and Connor Guerrero, run on Devpost for Teams, and judged by VP-level and C-suite executives on creativity, technical execution and business impact. The one rule was to use Managed Inference. The winners were **Patou** (a Chrome overlay that turns a click and a comment into a source-aware engineering plan), **Soap** (a browser extension that filters website content in real time), and **Sherpas** (Slack-triggered background agents). Crusoe's own summary of what stood out was "real builds on real infra, shipping in days, mixing models for the right job rather than defaulting to one."

**Hacking for Clean Energy (June 28 to 29, 2024, Crusoe's San Francisco office).** This older event was co-hosted by Crusoe, Lowercarbon Capital and OpenAI, and its judges included Crusoe CEO **Chase Lochmiller** and **Vanessa Ching** of NVIDIA's Inception startup program. The criteria were technical execution and design, ambition and scalability, and presentation. The winner, **Verdigris**, identified homeowners eligible for zero-cost energy upgrades and generated personalized outreach, and second place, **Daylight**, mapped stakeholder relationships across thousands of permitting documents into a graph database. It shows that Crusoe and NVIDIA have judged together since at least 2024, and that Crusoe's leadership cares about scale and real deployment.

### Group B: Crusoe as a primary judge with other partners

The DevNetwork and RAISE tracks above are the main examples, because in both Crusoe wrote its own brief and chose its own winners, while other sponsors ran other tracks. The pattern across all four Crusoe events is consistent. Crusoe's judges favor **SRE and operations agents that survive failure** (Argus, Leavitt), **systems that mix cheap and expensive models deliberately** (RAISE, hack.crusoe), **measured, reproducible numbers** (crusoe-nemotron-harness), and **operator-in-the-loop designs** where the human has the final word but is rarely needed (PRAETOR, the RAISE brief).

### Group C: NVIDIA as a primary judge

**AITX Community x NVIDIA Claw Agent Hackathon (July 17 to 19, 2026, Austin).** This is the most relevant NVIDIA precedent, because one of its three tracks was literally named **"Recursive Intelligence"** and defined as measurable self-improvement across runs. It ran at Antler's Austin office with about 130 attendees and 30 submissions, built on Nemotron, NemoClaw and vLLM, with Red Hat, HiddenLayer, Featherless, Supabase and Atlassian as co-sponsors. The Recursive Intelligence winner and Best Use of Nemotron was **8kEdu**, an autonomous tutor that "runs on a heartbeat," discovers educational videos, watches them with Nemotron, builds a personalized curriculum, and reports that its recursive memory cut repeated vision-model calls by 87.5% (from 64 to 8) with full recall of previously learned concepts.

The **Best Use of NemoClaw and OpenShell** at AITX went to **MasteryWrite** (Logan May), and it is the single best model for Version N+1. It is a writing-assessment engine that grades essays like a trained state rater, measured against real Texas STAAR essays it never saw, reporting 0.88 quadratic weighted kappa agreement with human raters (a standard agreement statistic for graded scores). Its self-improvement loop uses "a fresh AI builder per iteration, a pure-code referee that keeps only worst-case-confidence improvements, and a locked holdout scored exactly once," and its README says the loop "caught its own builder trying to game the eval," a loophole the author documented publicly. Its OpenShell policy acts as a publishing gate, and a runtime evidence gate refuses to let the agent write in any domain until it has measurably earned permission.

Other AITX entries show how crowded the self-improvement idea already is, and therefore what counts as creative. **Helixis** froze 30 AutomationBench tasks into 20 training and 10 held-out tasks, used an empty "Experience Wiki" as an honest epoch-zero baseline, and had Nemotron Nano read failure traces and distill skills for Nemotron Ultra. **NixClaw** let a Hermes agent inside OpenShell propose changes to its own operating environment as NixOS generations, which a privileged activator applied under a five-minute rollback lease and kept only if benchmarks improved. **DELPHI** turned verified failures into typed "lesson candidates," checked them for scope and contradictions with deterministic gates, and tested whether each lesson transferred to related tasks before activating it, including a control project that should receive nothing.

**NemoClaw NVIDIA x ASUS Hackathon at UC Santa Cruz (June 2026).** This 24-hour event provided 40 DGX Spark units and had an Edge track, a Cloud track on Brev, and a NemoClaw track judged separately, with "use of NVIDIA tools" as an explicit criterion. The NemoClaw track went to **MonkeyClaw**, a tool for "probing, patching, and protecting the NVIDIA NemoClaw ecosystem," and the Cloud track to **ClawForge**, which lets small businesses build NemoClaw-sandboxed agents without code. A security tool that attacks NemoClaw winning NVIDIA's NemoClaw prize suggests NVIDIA rewards projects that stress-test its sandbox, not only ones that use it.

**NVIDIA Spark Hack series (2026, including Toronto in June and Seattle in August).** The Seattle event had three tracks, "See" (vision), "Do" (described as "long-running agentic workflows that orchestrate across multiple tools and data sources") and "Spark" (open-ended), on Acer GN100 machines with the GB10 chip. The Do track went to **VELA**, a voice-first healthcare agent that turns a request and insurance details into verified options and "ask[s] for explicit approval before taking action." The Best Use of NemoClaw and OpenShell went to **First Light**, a disaster-triage agent that ranks rescue priorities from drone imagery with zero cloud connection, using OpenShell egress policies to block external calls and lock the agent to local data. A judge at the Toronto edition wrote that the strongest teams had decided "what tasks should be automated, what information should be retrieved, when agents should call tools, and when they should ask for human input," and could "explain why they chose a particular architecture and where the limitations were."

**Red Hat Open Accelerator x NVIDIA vLLM Hackathon (late April 2026).** This event had an "Agentic Edge powered by NemoClaw" track whose first prize was an **NVIDIA RTX 5090**, the same prize as this event's Best Use of Nemotron. The winner, **PR Genie**, was a multi-agent digital twin that learns the personas of GitHub maintainers to predict how they approve or reject pull requests. Another team in the same track won two awards with **SOC claw**, a three-agent security pipeline on NemoClaw and Nemotron whose "self-correcting verifier agent catches and adjusts misclassifications," reporting 76.7% triage accuracy on 30 synthetic alerts and a rule that "humans approve before anything executes."

**NVIDIA Agentic AI Open Hackathon, India (July 2026).** This event drew more than 6,000 registrations and 15 finalists presenting in Bangalore, all built with Nemotron, NemoClaw, NeMo Curator and Data Designer. The winner, **VentureOS** from a Microsoft team, turned scattered business signals into "governed decisions, human-approved actions, and measurable business outcomes," and won a DGX Spark.

**Nemotron Developer Days Seoul (April 21 to 22, 2026).** NVIDIA's first hackathon in Korea had tracks for agents, domain post-training, and synthetic data pipelines, and the grand prize went to **Nota AI**, which used a Nemotron 3 Super agent to build a quantization dataset for Mixture-of-Experts models. The winning team's account is the clearest statement of what NVIDIA judges valued: the closing remarks praised "a team that demonstrated not only qualitative but also quantitative evaluation," at a time when "other teams build very flashy demos" with tools like Claude. NVIDIA's model-optimization team then approached the winners about a collaboration.

**NVIDIA GTC 2026 events (March 2026, San Jose).** The **Agents for Impact Hackathon** at San Jose State University gave more than 300 students two hours and produced 119 submissions, which NVIDIA described as a record, judged by more than 15 NVIDIA experts and professors. Its winners were **CarbonSense AI** (carbon-aware AI operations), **LoominAi** (physics notes turned into interactive 3D simulations with Nemotron Ultra), and **AccessAudit** (ADA compliance reports for urban spaces), all using Nemotron and NIM microservices. NVIDIA also ran a **GTC Vibe Hack** with more than 100 teams.

**Cerebral Valley events with NVIDIA judges.** Cerebral Valley's **PyTorch Helion Hackathon** (March 14, 2026, Shack15) was judged by Luis Ceze (Vice President of AI Systems Software, NVIDIA) and Ujval Kapasi (Vice President of AI and HPC Frameworks and Libraries, NVIDIA) alongside Meta and Thinking Machines Lab, and Ujval Kapasi gave the opening keynote at **Nebius.Build SF** the next day, which used the same Shack15 schedule as this event.

### The patterns across all of these winners

Eight patterns repeat across Crusoe's and NVIDIA's winners, and each one translates into a design decision.

1. **Measured numbers beat polish.** Nota AI, MasteryWrite, Helixis, Kojable and crusoe-nemotron-harness all won with quantitative evidence, and Nota AI's account says this was the differentiator against flashier demos.
2. **Honest held-out evaluation is the credibility test.** MasteryWrite's locked holdout scored once, Helixis's 20/10 split with an empty baseline, and DELPHI's control project that should receive nothing all exist to stop a self-improvement claim from being a measurement artifact.
3. **Independent verification uses a different model or a different mechanism.** Argus uses cross-model disagreement, PRAETOR uses an LLM jury, SOC claw uses a verifier agent, and MasteryWrite uses a pure-code referee.
4. **Cheap models run constantly, and expensive models are called for judgment.** This is the RAISE judge's stated scoring preference, NVIDIA's own reference design for Lightning and Ultra, and the reason Crusoe's per-model rate limits favor multi-model teams.
5. **Rules are enforced by the environment, not by the prompt.** NixClaw, First Light and MasteryWrite put the boundary in OpenShell or the operating system, which is precisely what wins the NemoClaw prize.
6. **Humans are a rare, explicit gate.** VELA, VentureOS, SOC claw, F You Money and PRAETOR all keep the human as the final word on irreversible actions while the agents handle everything else.
7. **Operations and infrastructure targets resonate with Crusoe.** Both Crusoe DevNetwork winners were SRE agents that survive chaos, and Crusoe's internal winners were developer tools.
8. **Reproducibility is part of the demo.** crusoe-nemotron-harness reproduces every number from a fixed seed, and MasteryWrite says "everything above is reproducible from the repo README. Proven, not promised."

---

## Part 10: Research Ideas Behind Each Problem Statement

Each problem statement has published research behind it, and naming the right idea in the Q&A signals depth to judges who care about "how we think about AI capabilities." The descriptions below are based on the papers' reported results and should be cited as reported.

For **Done Means Done**, the closest public reference is Anthropic's November 2025 engineering post on **effective harnesses for long-running agents**, which describes an initializer agent that expands a short goal into a structured feature list where every item starts marked as failing, plus a progress file that each new session reads first. The broader idea is **spec-first agents**, where acceptance criteria are written and turned into tests before work starts. The drift and loop detection asked for in the statement relates to **Reflexion** (Shinn et al., 2023), in which an agent writes a verbal reflection on each failure and reads it before retrying, and to the general practice of comparing each step against the original goal.

For **Shared Brain**, the most directly relevant paper is **ACE, Agentic Context Engineering** (Stanford and SambaNova, 2025), which treats an agent's context as an "evolving playbook" updated by separate generator, reflector and curator roles through small incremental edits. ACE names two failure modes that map onto the statement's words: **brevity bias**, where repeated rewriting compresses away useful detail, and **context collapse**, where a full rewrite of the memory destroys accumulated knowledge. A memory that is "current, lean and conflict-free" has to avoid both, which is a crisp technical framing for the pitch. Earlier work on skill libraries, such as **Voyager** (Wang et al., 2023), stored verified code skills that later tasks could retrieve.

For **Version N+1**, the relevant line of work is automated agent design. **ADAS, Automated Design of Agentic Systems** (Hu, Lu and Clune, 2024) used a meta-agent to write new agent designs in code and keep an archive of the best ones. The **Darwin Gödel Machine** (Sakana AI and collaborators, 2025) let a coding agent edit its own code and keep variants in an archive based on benchmark scores, and reported SWE-bench performance rising from about 20% to about 50%. **GEPA** (2025) evolved prompts through natural-language reflection on execution traces and reported beating reinforcement learning with far fewer rollouts. The common warning across all of them is **reward hacking**, which means the system improves the score without improving the skill the score was meant to measure, and MasteryWrite's builder trying to game its evaluation is a live example from an NVIDIA-judged event.

---

## Part 11: Mapping the Sponsors Onto Each Problem Statement

A lesson from past hackathons is that sponsor tools must implement core features, not side features. The table below shows where each sponsor could carry real weight in each problem statement, as a starting point for brainstorming rather than a chosen idea.

| | Crusoe Managed Inference | NVIDIA (Nemotron, OpenShell, NemoClaw) | You.com |
|---|---|---|---|
| **Done Means Done** | Different models for executor and verifier spread rate limits and give independent judgments; PromQL metrics prove the loop ran unattended | Ultra or Super writes the definition of done, Lightning executes; OpenShell enforces "stop" and turns "ping a human" into an operator-approval event | Verifier grounds factual checks in cited sources |
| **Shared Brain** | The shared memory as a stable prefix, with `cached_tokens` and prefix cache hit rate as the measured saving | Lightning's 1M context holds a large memory; OpenShell scopes which agents may write which parts of it | Each fact stores its source and date so stale facts can be re-verified |
| **Version N+1** | Serverless Fine-Tuning could turn accepted trajectories into a LoRA adapter as one possible "change," deployable in one click | Nemotron models in planner and executor roles; OpenShell sandboxes self-modification so a bad change cannot escape | Fresh, unseen research tasks for the held-out set |

---

## Part 12: Demo Strategy

### The one-minute submission video

The submission form asks for a one-minute video that highlights only what the team built during the event. The structure is simple, with one emphasis: given the weight on Technicality, the middle of the video should show the mechanism and the measured result rather than only the user experience.
- **0:00 to 0:08**: The problem in one sentence, using the statement's own framing, for example "agents report success on vague goals."
- **0:08 to 0:20**: The solution in one sentence, naming the specific mechanism.
- **0:20 to 0:50**: The system running, ending on the before-and-after number or the moment a check catches a failure.
- **0:50 to 1:00**: A clear statement of what was built today versus what came from a harness, plus the sponsor stack.

### The three-minute live demo

The format is about three minutes of demo and one to two minutes of questions in both rounds. The rules are simple: one speaker presents, the other teammates own specific question types, and the speaker stops at three minutes so that judges can ask questions.
- **0:00 to 0:20**: The problem and the one-line answer.
- **0:20 to 2:15**: The live system. The strongest moment for this event is a failure being caught and handled without a human, or a change being proposed, tested and rejected because it did not help, because both show machinery rather than output.
- **2:15 to 2:45**: The number, on held-out tasks, with the baseline on screen.
- **2:45 to 3:00**: One sentence on what this teaches about agents, aimed at the Future Potential criterion, and one sentence on the sponsor stack.

Three items should be ready to show on demand during questions: the public repository with a clear "built during the hackathon" section, the Crusoe metrics page or a PromQL chart, and the OpenShell audit log or policy file. Judges at NVIDIA and Crusoe events repeatedly rewarded teams who could open the evidence instantly.

### The original-work line

Because disqualification is immediate for unclear contributions, the repository README should have a section near the top titled something like "What we built at the hackathon," listing the team's modules and stating which harness, model and library features were used unmodified. The demo should say the same thing in one sentence. MasteryWrite's README, which labels every integration as "proven live" or "in progress," is a good model of this honesty.

---

## Part 13: The Development Plan for 6 Hours and 15 Minutes

The working window runs from 10:45 AM to 5:00 PM. The plan below follows the dependency order for any of the three statements.

| Time | Goal |
|---|---|
| Before Saturday | Create the Crusoe organization, add a payment method, claim the $50 credits, create keys that expire on October 18, list models with `/v1/models`, install OpenShell or NemoClaw on at least one laptop, and get a You.com key |
| 10:45 to 11:15 | Write the demo moment, the three core features, the owner of each, and the interface contract between components |
| 11:15 to 12:45 | A single agent completes one task end to end on Crusoe, and the evaluation harness scores it; the held-out task set is written and locked |
| 12:45 to 2:30 | The core mechanism: the verifier and decision policy, the shared memory protocol, or the accept-or-reject improvement loop |
| 2:30 to 3:30 | Sandboxing in OpenShell, the second and third models in their roles, You.com grounding, and the evidence views |
| 3:30 to 5:00 | No new features; run the full measured experiment, harden, record the video, write the README section, and rehearse twice |

Two technical risks deserve early attention. The first is rate limits, which a multi-agent loop can exhaust in minutes, so backoff and per-model role assignment should be in the first version of the client, not added later. The second is the measured result, because a self-improvement or shared-memory experiment needs several full runs to produce a before-and-after number, and those runs take real time; the experiment should start by about 3:00 PM so the number exists before 5:00 PM.

---

## Part 14: A Practical Checklist of Known Pitfalls

- **Credits and limits.** A payment method is required for the free credits and raises the limit from 30 to 600 requests per minute per model.
- **Model IDs.** IDs are case-sensitive and differ between Crusoe's web pages and the API, so the team should copy them from `/v1/models`.
- **Deprecated examples.** Any example using Llama 3.3 70B, Kimi K2.6, GLM-5.1, GLM-5.2, DeepSeek V3, or the hostnames `api.crusoe.ai` or `managed-inference-api-proxy.crusoecloud.com` is outdated.
- **Context sizes.** Only Lightning 3.5, the DeepSeek V4 models and GLM-5.3 have 1M context on Crusoe; Nemotron Super, Nano and Omni have 262k.
- **Reasoning budgets.** Reasoning models need `max_tokens` of at least 1,024, or they return empty content.
- **Tool-call ordering.** The assistant message with `tool_calls` must come before the tool results.
- **Cache hits.** The shared prefix must be byte-identical, with stable tool order and JSON key order, and changing content belongs at the end.
- **Keys with `$` characters.** Keys must be exported in single quotes.
- **NemoClaw maturity.** NVIDIA calls it early-stage, so the install should be tested before the event.
- **Public repository.** The repository must be public before submission, and keys must never be committed; OpenClaw and Pi config files store keys in plain text.

---

## Part 15: Questions Judges Are Likely to Ask

**"How do you know it actually improved, and not just memorized?"** The answer should name the held-out set, say when it was locked, show the baseline and final scores on it, and state how many runs produced the number. If the team has a confidence interval or a worst-case comparison, as MasteryWrite did, it should show it.

**"Why does the verifier catch things the worker misses?"** A strong answer explains that the verifier runs on a different model family or uses deterministic code, so its errors are not correlated with the worker's errors, and then shows one recorded case where the verifier disagreed and was right.

**"What happens when it gets stuck?"** The answer should walk through the decision policy: which signals count as drift or looping, what triggers a re-plan, what triggers a stop, and the one condition that pings a human. The live demo should include at least one of these transitions.

**"Why Crusoe and not any other endpoint?"** A specific answer cites the per-model rate limits that shaped the multi-model design, the cached-token pricing and prefix cache hit rate that make shared context cheap, and the metrics endpoint used as evidence. A generic answer about "fast inference" will not land with Crusoe's own team.

**"Why Nemotron?"** The answer should give the role of each Nemotron model and the reason, using NVIDIA's own framing of Ultra or Super for planning and Lightning for high-volume execution, and ideally a measured cost or latency comparison, which is the number the RAISE judge said nobody had.

**"What does OpenShell stop that a prompt could not?"** The answer should show a specific denied action from the audit log, explain that the rule is enforced outside the agent's process, and, if relevant, show an operator approval or a policy change being proposed by the agent.

**"What did you build today, and what came from the harness?"** The team should answer in one sentence and point to the README section, because this question decides eligibility.

**"Where does this go next for AI?"** The answer should state the general lesson the experiment supports, for example about verification, shared context, or safe self-modification, because the Future Potential criterion asks about the future of agentic systems rather than the size of a market.

---

## Summary: The Winning Formula for October 17

The evidence from this research points to a clear formula. Judges at this event will weight Technicality and Creativity at 65% of round one, Crusoe's and NVIDIA's past judges consistently rewarded measured, reproducible results over polished demos, and every problem statement ends with a demand for proof: checks that run without you, measurable quality gains, or a before-and-after score on unseen tasks.

1. Pick one problem statement as the headline and answer its final question exactly, including the measurement it asks for.
2. Build the evaluation and the held-out set first, because the number is the product's proof.
3. Use an agent team with deliberate model roles on Crusoe: a strong planner, a cheap high-volume executor such as Nemotron 3.5 Lightning, and an independent verifier on a different model or in deterministic code.
4. Put the rules in OpenShell, show one action being denied or escalated, and aim for the NemoClaw prize with a visible boundary.
5. Use Crusoe's own signals, such as `cached_tokens`, prefix cache hit rate and rate-limit-aware routing, as evidence rather than decoration.
6. Use You.com where grounding in fresh, cited facts is part of the checking or memory logic.
7. Draw a bright line between what the team built and what the harness provides, in the README and in the pitch.
8. Stop adding features at 3:30 PM, run the measured experiment, and rehearse a three-minute demo that leaves time for questions.

---

## Sources

- Event page: https://cerebralvalley.ai/e/crusoe-recursive-agents-hackathon
- Participant guide PDF: "Details – The Recursive Agents Hackathon – Cerebral Valley" (downloaded October 15, 2026)
- Crusoe hackathon guide and skill file: https://github.com/crusoecloud/crusoe-developer-hub/tree/main/examples/hackathons/crusoe-cv-recursive-agents-hackathon
- Crusoe Field Day: https://luma.com/pcfayy36
- Crusoe Series F: https://www.crusoe.ai/resources/newsroom/crusoe-announces-series-f-funding and TechCrunch, Reuters and DCD coverage from September 17 and 18, 2026
- Crusoe Managed Inference and MemoryAlloy: https://www.crusoe.ai/resources/newsroom/crusoe-launches-managed-inference-delivering-breakthrough-speed-for-production-ai and https://www.crusoe.ai/resources/blog/crusoe-memoryalloy-reinventing-kv-caching-for-cluster-scale-inference
- Crusoe Serverless Fine-Tuning and Self-Serve Deployments: https://www.crusoe.ai/resources/newsroom/crusoe-launches-serverless-fine-tuning-and-self-serve-inference-deployments
- NVIDIA NemoClaw announcement: https://nvidianews.nvidia.com/news/nvidia-announces-nemoclaw
- OpenShell blog: https://developer.nvidia.com/blog/run-autonomous-self-evolving-agents-more-safely-with-nvidia-openshell/
- NemoClaw and OpenShell repositories: https://github.com/NVIDIA/NemoClaw and https://github.com/NVIDIA/OpenShell
- Nemotron 3.5 Lightning: https://developer.nvidia.com/blog/nvidia-nemotron-3-5-lightning-delivers-fast-accurate-specialized-task-execution-for-long-running-agents/
- Nemotron 3 Ultra: https://research.nvidia.com/labs/nemotron/Nemotron-3-Ultra/
- Nemotron Coalition: https://nvidianews.nvidia.com/news/nvidia-launches-nemotron-coalition-of-leading-global-ai-labs-to-advance-open-frontier-models
- NeMo Agent Toolkit: https://docs.nvidia.com/nemo/agent-toolkit/latest/
- NeMo Switchyard: https://developer.nvidia.com/blog/route-ai-agent-workloads-across-models-with-nvidia-nemo-switchyard/
- NVIDIA Brev: https://developer.nvidia.com/brev
- You.com docs and agent skills: https://you.com/docs/quickstart.md and https://github.com/youdotcom-oss/agent-skills
- You.com hackathon winners list: https://github.com/youdotcom-oss/awesome-you
- DevNetwork [AI + ML] Hackathon 2026: https://devnetwork-ai-ml-hack-2026.devpost.com/ and https://devpost.com/software/crusoe-nemotron-harness
- Leavitt repository: https://github.com/abhixz13/leavitt
- RAISE Summit Hackathon results: RAISE Summit, Crusoe and participant LinkedIn posts from July 5 to 16, 2026
- hack.crusoe: Crusoe and Crusoe for Developers LinkedIn posts from May 2026, and https://info.devpost.com/customer-stories/crusoe
- Hacking for Clean Energy: https://www.crusoe.ai/resources/newsroom/crusoe-and-lowercarbon-to-host-clean-energy-ai-hackathon and https://hacking-for-clean-energy.devpost.com/
- AITX x NVIDIA Claw Agent Hackathon: https://claw-recap.vercel.app/ and https://github.com/supe-log/writing-engine
- NemoClaw NVIDIA x ASUS Hackathon at UCSC: https://nemoclaw.devpost.com/
- NVIDIA Spark Hack Seattle: https://luma.com/spark-hack-seattle and winner LinkedIn posts from August 15 to 20, 2026
- Nemotron Developer Days Seoul: https://blog.nota.ai/insights/nemotron-hackathon-winner
- GTC 2026 Agents for Impact: https://news.ucsc.edu/2026/04/engineering-student-wins-nvidia-agents-for-impact-hackathon/
- PyTorch Helion Hackathon: https://cerebralvalley.ai/e/helion-hackathon
- Hermes Agent, Deep Agents and OpenClaw repositories: https://github.com/NousResearch/hermes-agent, https://github.com/langchain-ai/deepagents, https://github.com/openclaw/openclaw
