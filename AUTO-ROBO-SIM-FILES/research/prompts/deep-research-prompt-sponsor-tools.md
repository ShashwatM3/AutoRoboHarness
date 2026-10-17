# Deep Research Brief: Every Sponsor Tool, Documented for a One-Day Build

**Your task:** Research the official documentation of every product, model, API, and open-source repository offered by Crusoe (Crusoe Cloud, Managed Inference, Managed Fine-Tuning, MemoryAlloy), NVIDIA (every Nemotron model, OpenShell, NemoClaw, NeMo Agent Toolkit, NeMo Switchyard, NeMo Gym, NVIDIA AI Blueprints), and You.com (Search, Contents, Answer, Research APIs and MCP server), plus the open-source robot-simulation libraries listed below. Then produce a link-rich technical reference for a team building a self-improving warehouse-robot agent system at the Crusoe x Cerebral Valley "Recursive Agents Hackathon" on October 17, 2026. The full requirements, the project design, the questions that need answers, the starting links, and the output format are all below. Do not ask clarifying questions; everything needed is in this brief.

## Who this is for and why

This brief is for a deep research agent. The result becomes the technical reference that a two-person team builds from at The Recursive Agents Hackathon (Cerebral Valley and Crusoe, with NVIDIA and You.com as partners), held on Saturday, October 17, 2026 at Shack15 in San Francisco. Building runs from 10:45 AM to 5:00 PM Pacific, which is 6 hours and 15 minutes. The goal of this research is zero ambiguity, because discovering a tool incompatibility halfway through a one-day build is costly. For every tool, the team needs to know exactly what it does, exactly how to call it, what it costs, what limits apply, what breaks, and whether it fits a specific role in the project.

The research must be broad as well as deep. The tools named below are a starting list, not a boundary. If a sponsor offers another product, model, open-source repository, blueprint, or API that fits one of the project's roles better, the agent should find it and report it.

## The event rules that constrain tool choices

- Every project must build "an agent team on Crusoe Managed Inference," so every agent's language model calls must go through Crusoe's OpenAI-compatible endpoint at `https://api.inference.crusoecloud.com/v1`. Other services (speech, search, sandboxes, datasets) may come from elsewhere.
- The repository must be public, and the demo may only highlight work built during the event. Open-source third-party code is allowed as a declared dependency, but the team's own pre-written code is not.
- Banned project types include basic RAG apps, Streamlit apps, and any project where a dashboard is the main feature.
- Round one judging weights are Technicality 40%, Creativity and Originality 25%, Live Demo 20%, and Future Potential and AI Impact 15%. The final round weights all four equally.
- Prizes include $14,000 / $8,000 / $3,000 plus You.com credits for the podium, an NVIDIA RTX 5090 for **Best Use of Nemotron**, and $100 in NVIDIA Brev credits per person for **Best Use of NemoClaw and OpenShell**.
- The team builds on Apple Silicon MacBooks. Anything that needs a local NVIDIA GPU must be flagged, along with any hosted alternative.

The three problem statements are:
1. **Done Means Done**: agents write their own definition of done, verify their work with tests or independent verifier agents, catch drift and looping, and decide whether to continue, re-plan, stop, or (rarely) ping a human.
2. **Shared Brain**: a shared memory layer every agent reads before working and updates afterward, kept current, lean and conflict-free, with measurable quality gains.
3. **Version N+1**: an agent team that reviews each run, rewrites its own prompts, playbooks, tools or team structure, keeps a change only if it measurably helps, and proves it with a before-and-after score on tasks it has not seen.

## The project, so the agent can judge fit

The project is a self-improving onboarding harness for a fleet of warehouse robots. The robots are simulated TIAGo mobile manipulators (a wheeled base, a vertical torso lift, a 7-joint arm and a gripper) working in a browser-based 3D warehouse. They perform a catalog of tasks across zones: PICK, REPLENISH, TRANSPORT, and RETURN, at shelf levels 1 to 4. Each robot is a worker agent that makes decisions only at exception points (for example, blocked for 2.5 seconds, a lift queue, or a person in the aisle) by choosing among discrete actions such as `move_to`, `pick`, `place`, `wait_at_holding_point`, `reroute`, `swap_task`, and `go_charge`. Every worker reads a shared "brain" before acting. The brain is a versioned hierarchical knowledge graph (site, zone, task) holding rules, guardrails, context policies, and tool grants.

A supervisor agent, which is the harness, improves the robots through three levers, and all three are judged by one gate on locked held-out simulation seeds:
1. **Review loop.** Every task carries pass-or-fail checks (its definition of done). Failed checks become failures, and the supervisor diagnoses which brain rule caused each one. It compares the failure against ground truth (an oracle planner inside the simulator, human warehouse video, and cited published practice), then proposes a typed change to the brain.
2. **Adversary.** An adversarial agent creates realistic hard situations inside the simulator, such as a blocked aisle, a person crossing at a blind corner, a heavy box on the top shelf, or a lift outage. It hunts for the cases where the current brain fails and adds them to the training cases, never to the held-out set.
3. **Post-training.** Verified decisions are multiplied by a task-scaling formula into a dataset. The dataset is pushed to the Hugging Face Hub in LeRobot format and uploaded to Crusoe in chat format, and then a LoRA fine-tuning job runs on Nemotron 3.5 Lightning. The fine-tuned model is compared with the base model on the same locked seeds.

A change to a locked setting, such as a speed cap or a minimum distance to people, needs a human Robotics Lead's approval. The supervisor explains the failures to the human in a conversation, ideally by voice, and OpenShell enforces the approval at the environment level.

The current role-to-tool mapping, which this research must verify or improve, is:

| Role in the pipeline | Current candidate | What must be confirmed |
|---|---|---|
| Worker decisions at exception points | Nemotron 3.5 Lightning on Crusoe | Tool calling, latency, rate limits, `max_tokens` with reasoning on and off |
| Supervisor (diagnosis, proposals) | Nemotron 3 Super, or Nemotron 3 Ultra if available on Crusoe | Ultra's availability and exact model ID on Crusoe |
| Independent gate judge | A different model family on Crusoe, such as DeepSeek V4 Pro | Which non-Nemotron models are live, and their tool-calling quality |
| Reading human video clips | Nemotron 3 Nano Omni on Crusoe, or Nemotron 3.5 Super VL | Video input format, maximum length, frames versus file, which endpoint |
| Robot camera frames as evidence | A vision-language model on Crusoe | Image input format and cost per image |
| Voice conversation with the human | Nemotron 3 VoiceChat, or Nemotron ASR plus Magpie TTS | Where each is hosted, its API, streaming support, latency, and access for a hackathon team |
| Locking held-out seeds away from the improver | OpenShell filesystem policy (Landlock) | Whether Landlock enforcement works inside Docker Desktop on macOS |
| Human approval of locked changes | OpenShell network policy plus the Policy Advisor (`http://policy.local`) | The exact approval flow, the UI or CLI the human uses, and whether one approval can be scoped to one request |
| Tracing and comparing brain versions | NVIDIA NeMo Agent Toolkit (`nvidia-nat`) profiler and `nat eval` | Integration with a custom Python agent and an OpenAI-compatible base URL |
| Model routing between cheap and expensive models | NVIDIA NeMo Switchyard | Whether it works with Crusoe endpoints, and its install and config |
| Shared-brain cost evidence | Crusoe `cached_tokens` and PromQL prefix cache hit rate | Exact field names, metric names, and how to query them from a script |
| Post-training | Crusoe Serverless Fine-Tuning plus Self-Serve Deployments | Job duration, deployment time, whether adapters can be served serverless, and API calls end to end |
| Dataset publishing | Hugging Face Hub, LeRobotDataset v3.0 | Minimum fields, how to store discrete actions, and the upload API |
| Published practice with citations | You.com Research API | `research_effort` levels, latency per level, and the response format with citations |
| Safety or topic guardrails | Nemotron 3.5 Content Safety, Llama Nemotron Topic Control, Nemotron Jailbreak Detection, NeMo Guardrails | Whether any is hosted on Crusoe or build.nvidia.com, and whether it fits as a verifier |
| Simulator rendering | Three.js plus `@mujoco/mujoco` WASM or `urdf-loaders`, with MuJoCo Menagerie's `pal_tiago` | Loading the Menagerie TIAGo MJCF in the browser, setting joint positions, and attaching a camera |
| Ground-truth data | NVIDIA PhysicalAI-SmartSpaces and SDG-Warehouse on Hugging Face | Download size per shard, the label format, and how to select one scenario |

## What the hackathon's info session showed

The team photographed four slides during the info session. They are transcribed here because the agent cannot see them, and each item on them must be researched.

**Slide 1, NVIDIA: "Nemotron Models Span Across Five Essential AI Capabilities."**
- Reasoning: Nemotron 3.5 Super VL, Nemotron 3.5 Lightning, Nemotron 3 Super, Nemotron 3 Ultra.
- Vision: Nemotron 3 Nano Omni, Nemotron Parse 1.1.
- Retrieval: Nemotron 3 Embed, Llama Nemotron Rerank, Nemotron Page Elements, Nemotron Table Structure.
- Speech: Nemotron ASR, Magpie TTS Multilingual, Nemotron 3 VoiceChat.
- Safety: Nemotron 3.5 Content Safety, Llama Nemotron Topic Control, Nemotron Jailbreak Detection.

**Slide 2, Crusoe: "Crusoe Cloud Platform."**
- Crusoe AI Cloud Platform (infrastructure as a service), reached through the CLI, the Terraform Provider, the Crusoe Cloud Console, and an MCP Server.
- Crusoe Command Center, described as a "unified operations platform that automates orchestration, observability, and support."
- AI Compute (NVIDIA GPUs, AMD GPUs); High-Performance Storage (Block Storage, File Storage, Object Storage); Accelerated Networking (VPC, NVIDIA InfiniBand / RoCE, Load Balancers); Crusoe Managed Kubernetes and Crusoe Managed Slurm, with AutoClusters and Container Registry.
- Crusoe Managed AI Services, under the name Intelligence Foundry: Managed Inference (Tailored, Self Serve, Serverless) and Managed Fine-Tuning (Fine-tuning Platform, Curated Model Tuning Recipes, Serverless), all on a "Proprietary Inference Engine powered by MemoryAlloy."
- A Security and Compliance and Billing layer underneath.

**Slide 3, NVIDIA: "Making of Nemotron (3.5 Lightning)."** The subtitle reads "30B-A3B MoE; Distillation from Nemotron 3 Super/Ultra + MTP co-training; Multi-domain RLVR." The stages are:
1. Pre-training on 1T tokens of high-quality text in 19 categories, with Nemotron 3 Super 120B as the teacher (teacher target plus log prob) and a Nemotron 3 Nano 30B student checkpoint, trained in Megatron-LM, with distillation training plus MTP co-training initialized from pruned Ultra MTP weights.
2. Long-context continued pre-training to a 1M-context base on 20B tokens using the "Ultra LC Recipe."
3. Supervised fine-tuning on an "Agentic SFT Blend," distilled from teacher models (Nemotron 3 Ultra, GPT-OSS, DeepSeek, Qwen) plus synthetic data generation, with SFT and reasoning control in Megatron-LM.
4. Reinforcement learning with multi-domain RLVR: reward profiling with a Gaussian curriculum, Nemotron 3 Ultra as a generative reward model (GenRM), unified RLVR environments in NeMo Gym (terminal, SWE, search, tool use, math, code), and NeMo RL running "Unified Async GRPO."
5. MTP boosting with head-only KL distillation, then selective post-training quantization with ModelOpt and Megatron-LM, producing the final 30B-A3B checkpoint.

**Slide 4, NVIDIA: "Get Started"**, with QR codes for four destinations: **Blueprints**, **Nemotron**, **NemoClaw**, and **Switchyard**. The agent should find the landing page each QR code most likely points to and summarize what a builder gets from each.

## What to research, tool by tool

For every tool below, the agent should produce a **tool card** using the template in the "What to return" section. The groups are ordered by importance to the build.

### Group 1: Crusoe

1. **Crusoe Managed Inference, serverless.** Cover the full live model catalog with exact API model IDs (case-sensitive, as returned by `GET /v1/models`), context length, prices for input, output and cached input, modalities, tool-calling support, and reasoning controls (`chat_template_kwargs` such as `enable_thinking`). Also cover the rate limits with and without a payment method, the response headers for remaining requests and tokens, error codes (400, 401, 403, 429, 503) and their causes, deprecated models and hostnames, and the free-credit process for hackathon attendees. Confirm whether each model on Slide 1 is served on Crusoe, especially Nemotron 3 Ultra, Nemotron 3.5 Super VL, Nemotron 3 VoiceChat, Nemotron ASR, Magpie TTS, the safety models, and the embed and rerank models.
2. **MemoryAlloy and prompt caching.** Cover how prefix caching works, the `usage.prompt_tokens_details.cached_tokens` field, what breaks the cache (whitespace, tool order, JSON key order, edited history), and any published benchmark numbers.
3. **Metrics and observability.** Cover the Foundry metrics page, the PromQL metric names (request rate, status codes, token rates, prefix cache hit rate, time to first token, latency percentiles), how to create a monitoring token with the CLI, and an example query from Python or curl.
4. **Self-Serve Deployments and Tailored Deployments.** Cover supported models, GPU types, hourly prices, provisioning time, autoscaling, LoRA adapter serving, and the API for creating a deployment.
5. **Managed Fine-Tuning.** Cover all three items on Slide 2 (Fine-tuning Platform, Curated Model Tuning Recipes, Serverless). The agent should find the dataset format (JSONL or Parquet, the chat "messages" schema, and size limits), supported base models (confirming Nemotron 3.5 Lightning), hyperparameters, early stopping, typical job duration for small datasets, checkpoint and `.safetensors` output, the path from a finished job to a callable model, the LLM-as-judge evaluation preview, and prices.
6. **Crusoe MCP Server, CLI, Terraform Provider, Console, and Command Center.** For each, the agent should say what it does and whether it has any use inside an agent project rather than only for infrastructure operations.
7. **Object Storage, Block and File Storage, Container Registry, Managed Kubernetes, Managed Slurm, and AutoClusters.** For each, the agent should cover access requirements (for example, whether account-team enablement is needed or access is limited to Crusoe VMs), so the team can rule items in or out quickly.
8. **Crusoe's open-source work and developer hub.** Cover `crusoecloud/crusoe-developer-hub` (especially the hackathon folder and its skill file), the integrations in that repository (LangChain, LiteLLM, MLflow, Google ADK, Hugging Face Spaces, and others), `fastokens`, and any agent examples.

### Group 2: NVIDIA

1. **Every Nemotron model on Slide 1.** For each model, cover what it is, its size, its license, its Hugging Face model ID, whether it is hosted on Crusoe, on build.nvidia.com (NVIDIA's hosted API catalog), or only as a downloadable NIM container, its input and output modalities, its API request format, and its free-tier limits. The speech models need special depth: whether Nemotron ASR supports streaming, whether Magpie TTS has a streaming or WebSocket API, what voices and languages exist, measured or published latency, and whether Nemotron 3 VoiceChat is full-duplex speech-to-speech and how to call it.
2. **Nemotron 3.5 Lightning in depth.** Cover the launch blog, the technical report, the model card, PinchBench results, the three speculative decoding methods (MTP, DFlash, DSpark), recommended sampling and reasoning settings for agent harnesses, and the training pipeline on Slide 3, explained plainly.
3. **OpenShell.** Cover install on macOS with Apple Silicon (Docker Desktop, Podman, or host virtualization), sandbox creation, the full policy YAML schema (filesystem, network, process, and inference sections), Landlock compatibility modes including `hard_requirement`, network rules scoped by HTTP method and path, live policy updates, providers and credential placeholders, the audit log format and where it lives, `openshell term`, the policy prover, and the Policy Advisor flow through `http://policy.local`. The agent should state exactly how a human approves or denies a pending request, and whether an approval can be limited to one request rather than adding a standing rule.
4. **NemoClaw.** Cover `nemoclaw onboard`, supported harnesses (OpenClaw, Hermes, LangChain Deep Agents Code), how to route inference to a custom OpenAI-compatible endpoint such as Crusoe, the known limitations of that route, the Telegram bridge, the blueprint and default policies, and the difference between the NemoClaw path and the plain OpenShell path.
5. **NeMo Agent Toolkit.** Cover install (`pip install nvidia-nat`), supported Python versions and platforms, the workflow YAML format, how to wrap a plain Python agent, the `openai` LLM type with a custom `base_url`, the profiler output, observability exporters, `nat eval` with custom evaluators and datasets, the optimizer (Optuna and genetic prompt optimization), and the fine-tuning harness.
6. **NeMo Switchyard.** Cover install, router types (LLM classifier, stage router, escalation router, tunable prefill routers), configuration for OpenAI-compatible endpoints, and a minimal example that routes between a cheap and an expensive model.
7. **NeMo Gym and NeMo RL.** Cover how Gym defines an environment (task dataset, agent harness, verifier, state), how to write a custom environment, whether it runs on a Mac without a GPU for evaluation only, how NeMo RL's GRPO consumes Gym environments, and the RLVR environments Slide 3 says Lightning was trained on.
8. **NVIDIA AI Blueprints.** Cover the catalog behind the "Blueprints" QR code. The agent should give special depth to the **Video Search and Summarization (VSS)** blueprint (for reading warehouse video), the **Data Flywheel** blueprint (for turning traces into a fine-tuned smaller model), and any blueprint involving agents, safety, robotics, or warehouses. For each one, cover hardware requirements and whether a hosted version exists.
9. **NeMo Data Designer and NeMo Curator.** Cover synthetic data generation for the task-scaling formula, and whether either runs without a local GPU.
10. **NeMo Guardrails and garak.** Cover how each could serve as a verifier or a safety layer, and how each connects to Crusoe-hosted models.
11. **Model Optimizer (ModelOpt) and Megatron-LM.** Cover these briefly, only to explain Slide 3, since the team will not self-host.
12. **NVIDIA Brev and build.nvidia.com.** Cover what Brev credits buy, Launchables, and the free API credits and rate limits on build.nvidia.com.
13. **Robotics and data.** Cover Isaac GR00T N1.7, its integration into Hugging Face LeRobot (announced July 6, 2026), the GR00T tutorial that converts simulation recordings to LeRobot format, Isaac Sim's hardware requirements, and NVIDIA's open warehouse datasets: `nvidia/PhysicalAI-SmartSpaces`, `nvidia/PhysicalAI-WorldModel-Synthetic-Warehouse-Operations-Scenes`, and `nvidia/PhysicalAI-SimReady-Warehouse-01`.
14. **The NVIDIA acquisition of Hugging Face**, announced September 3, 2026. Cover its terms, its status, and anything announced since about LeRobot, datasets, or Nemotron hosting.

### Group 3: You.com

Cover all five APIs (Web Search, Contents, Answer, Research, Finance Research) with exact endpoints and hosts (`ydc-index.io` versus `api.you.com`), the authentication header, request and response schemas, the citation format, the `research_effort` levels with prices and typical latency, rate limits, free credits, the MCP server and its tools and free profile, the `youdotcom-oss/agent-skills` repository and how to install it in each harness, the evaluation repositories, and the `awesome-you` list of past hackathon winners.

### Group 4: Agent harnesses

Cover OpenClaw, Hermes Agent, LangChain Deep Agents, OpenCode, and Pi. For each, cover how to point it at Crusoe, how it manages memory and skills (because the original-work rule means the team must separate the harness's built-in learning from its own), whether it runs inside OpenShell or NemoClaw, and whether it fits a custom multi-agent loop better than plain Python with the OpenAI SDK.

### Group 5: Open-source simulator and data dependencies

1. **MuJoCo Menagerie `pal_tiago`** (Apache 2.0, a flat MJCF with STL meshes, a `torso_lift_joint`, seven arm joints, two finger joints, and a `head_camera`). Cover how to load it in a browser with the official `@mujoco/mujoco` WebAssembly bindings, how to set joint positions and run forward kinematics without simulating physics, how to read body poses into Three.js, and how many TIAGo instances one page can render at interactive frame rates.
2. **`zalo/mujoco_wasm`**, the demo suite on top of the official bindings, including how its examples load Menagerie folders.
3. **`gkjohnson/urdf-loaders`**, as the alternative route. Cover its xacro support and what PAL's own `tiago_description` needs (it pulls `pmb2_description`, `pal_gripper_description` and `pal_urdf_utils`).
4. **Three.js** techniques for several robot cameras: render targets, multiple viewports, scissor rendering, and the performance cost of four to eight camera tiles.
5. **Kenney Factory Kit and City Kit Industrial** (CC0 assets) in glTF form, plus any CC0 warehouse shelving and pallet assets.
6. **LeRobotDataset v3.0.** Cover the required features, how to store discrete named actions and camera frames, the Python API to create a dataset and push it to the Hub, and file size considerations.
7. **The Hugging Face Hub API** for creating a public dataset repository and uploading files from a script.

## Questions that must get a direct answer

These questions decide the architecture. Each answer must cite its source, or say "unconfirmed" with the best available evidence.

1. Is Nemotron 3 Ultra callable on Crusoe serverless today, and what is its exact model ID?
2. Which speech option gives a natural voice conversation with the lowest setup: Nemotron 3 VoiceChat (on Crusoe or elsewhere), Nemotron ASR plus Magpie TTS on build.nvidia.com, or another NVIDIA option such as Riva? The answer should include latency, whether streaming works from a browser, and the authentication steps.
3. Can a video clip of up to about two minutes be sent to Nemotron 3 Nano Omni on Crusoe, and in what format (URL, base64, or frames)? How does Nemotron 3.5 Super VL compare, and where is it hosted?
4. Does OpenShell's Landlock filesystem policy actually enforce inside Docker Desktop on Apple Silicon, and what does `hard_requirement` do when it cannot?
5. Exactly how does a human approve one blocked request through the OpenShell Policy Advisor, and can that approval be scoped to a single request?
6. How long does a small Crusoe Serverless Fine-Tuning job (around 1,000 to 10,000 chat examples) take, and how long until the result is callable? Can a LoRA adapter be served without a dedicated Self-Serve Deployment?
7. Can NeMo Agent Toolkit profile and evaluate a plain Python agent that calls Crusoe through the OpenAI SDK, without rewriting the agent in a supported framework?
8. Does NeMo Switchyard work with Crusoe as the provider, and is it worth adding for a cheap-worker and expensive-supervisor split?
9. Is any Nemotron safety model (Content Safety, Topic Control, Jailbreak Detection) callable from a hosted API, and could one act as an independent verifier?
10. Can the VSS blueprint, or any hosted NVIDIA service, summarize warehouse video without a local NVIDIA GPU?
11. What is the smallest valid LeRobotDataset v3.0 for discrete actions, and does the Hub accept it without errors?
12. Can the Menagerie TIAGo MJCF be loaded and posed in a browser with `@mujoco/mujoco`, and is there a working example online?

## Starting links

All of the links below were checked and reachable on October 17, 2026. The agent must still verify their contents and should follow every useful link it finds from them.

**Event and Crusoe**
- Event page: https://cerebralvalley.ai/e/crusoe-recursive-agents-hackathon
- Crusoe hackathon guide and skill file: https://github.com/crusoecloud/crusoe-developer-hub/tree/main/examples/hackathons/crusoe-cv-recursive-agents-hackathon (files `README.md` and `crusoe-cv-recursive-agents-hackathon-skill.md`)
- Crusoe developer hub: https://github.com/crusoecloud/crusoe-developer-hub
- Crusoe docs: https://docs.crusoecloud.com/
- Crusoe console metrics: https://console.crusoecloud.com/foundry/metrics
- Managed Inference launch: https://www.crusoe.ai/resources/newsroom/crusoe-launches-managed-inference-delivering-breakthrough-speed-for-production-ai
- MemoryAlloy engineering blog: https://www.crusoe.ai/resources/blog/crusoe-memoryalloy-reinventing-kv-caching-for-cluster-scale-inference
- Serverless Fine-Tuning and Self-Serve Deployments launch: https://www.crusoe.ai/resources/newsroom/crusoe-launches-serverless-fine-tuning-and-self-serve-inference-deployments
- Crusoe Series F: https://www.crusoe.ai/resources/newsroom/crusoe-announces-series-f-funding
- fastokens: https://github.com/crusoecloud/fastokens

**NVIDIA**
- Hosted model catalog: https://build.nvidia.com/ and API docs: https://docs.api.nvidia.com/
- NVIDIA on Hugging Face: https://huggingface.co/nvidia
- NemoClaw announcement: https://nvidianews.nvidia.com/news/nvidia-announces-nemoclaw
- NemoClaw docs: https://docs.nvidia.com/nemoclaw/ and repo: https://github.com/NVIDIA/NemoClaw
- OpenShell docs: https://docs.nvidia.com/openshell/ and repo: https://github.com/NVIDIA/OpenShell
- OpenShell blog: https://developer.nvidia.com/blog/run-autonomous-self-evolving-agents-more-safely-with-nvidia-openshell/
- Nemotron 3.5 Lightning blog: https://developer.nvidia.com/blog/nvidia-nemotron-3-5-lightning-delivers-fast-accurate-specialized-task-execution-for-long-running-agents/
- Nemotron 3 Ultra: https://research.nvidia.com/labs/nemotron/Nemotron-3-Ultra/
- Nemotron Coalition: https://nvidianews.nvidia.com/news/nvidia-launches-nemotron-coalition-of-leading-global-ai-labs-to-advance-open-frontier-models
- NeMo Agent Toolkit docs: https://docs.nvidia.com/nemo/agent-toolkit/latest/ and repo: https://github.com/NVIDIA/NeMo-Agent-Toolkit
- NeMo Switchyard blog: https://developer.nvidia.com/blog/route-ai-agent-workloads-across-models-with-nvidia-nemo-switchyard/ and repo: https://github.com/NVIDIA-NeMo/Switchyard
- NeMo Gym: https://github.com/NVIDIA-NeMo/Gym
- NeMo RL: https://github.com/NVIDIA-NeMo/RL
- NeMo Skills: https://github.com/NVIDIA-NeMo/Skills
- NeMo Data Designer: https://github.com/NVIDIA-NeMo/DataDesigner
- NeMo Curator: https://github.com/NVIDIA-NeMo/Curator
- NeMo Guardrails: https://github.com/NVIDIA-NeMo/Guardrails
- garak: https://github.com/NVIDIA/garak
- Model Optimizer: https://github.com/NVIDIA/Model-Optimizer
- Megatron-LM: https://github.com/NVIDIA/Megatron-LM
- VSS blueprint: https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization
- Data Flywheel blueprint: https://github.com/NVIDIA-AI-Blueprints/data-flywheel
- All blueprints: https://github.com/NVIDIA-AI-Blueprints and https://build.nvidia.com/blueprints
- Isaac GR00T: https://github.com/NVIDIA/Isaac-GR00T
- Brev: https://developer.nvidia.com/brev
- Hugging Face acquisition: https://blogs.nvidia.com/blog/nvidia-to-acquire-hugging-face/

**You.com**
- Docs: https://you.com/docs and quickstart: https://you.com/docs/quickstart.md
- Agent skills: https://github.com/youdotcom-oss/agent-skills
- Past hackathon winners: https://github.com/youdotcom-oss/awesome-you
- MCP server: https://api.you.com/mcp (free profile: https://api.you.com/mcp?profile=free)

**Harnesses**
- OpenClaw: https://github.com/openclaw/openclaw
- Hermes Agent: https://github.com/NousResearch/hermes-agent
- LangChain Deep Agents: https://github.com/langchain-ai/deepagents

**Simulator and data**
- MuJoCo: https://github.com/google-deepmind/mujoco
- MuJoCo Menagerie TIAGo: https://github.com/google-deepmind/mujoco_menagerie/tree/main/pal_tiago
- mujoco_wasm: https://github.com/zalo/mujoco_wasm (live demo: https://zalo.github.io/mujoco_wasm/)
- urdf-loaders: https://github.com/gkjohnson/urdf-loaders
- PAL TIAGo description: https://github.com/pal-robotics/tiago_robot
- Kenney Factory Kit: https://kenney.nl/assets/factory-kit and City Kit Industrial: https://kenney.nl/assets/city-kit-industrial
- LeRobot: https://github.com/huggingface/lerobot and docs: https://huggingface.co/docs/lerobot
- NVIDIA warehouse datasets: https://huggingface.co/datasets/nvidia/PhysicalAI-SmartSpaces, https://huggingface.co/datasets/nvidia/PhysicalAI-WorldModel-Synthetic-Warehouse-Operations-Scenes, https://huggingface.co/datasets/nvidia/PhysicalAI-SimReady-Warehouse-01

## What to return

The agent should return six sections.

**Section 1: a role-to-tool matrix.** One row per role from the table above, giving the recommended tool, the runner-up, the reason in one sentence, the main risk, and links to the exact documentation pages that support the choice.

**Section 2: tool cards.** Each tool card should be one block with these fields:
- **What it is**, in two or three plain sentences, with the official name and version.
- **Access**, meaning sign-up, keys, credits, approval waits, and whether a hackathon team can use it today.
- **How to call it**, meaning the endpoint, install command, authentication header, and a minimal working request in Python or curl copied or adapted from official docs.
- **Limits and prices**, meaning rate limits, context sizes, file sizes, and costs.
- **Compatibility**, meaning macOS on Apple Silicon, the OpenAI SDK, Crusoe as a provider, and browser use where relevant.
- **Known gotchas**, from docs, GitHub issues, changelogs, and forum posts, each with a link.
- **Fit for this project**, meaning which role it could fill and a verdict of use, maybe, or skip.
- **Links**, meaning every relevant documentation page, repository, blog post, model card, and example, as many as are genuinely useful.

**Section 3: direct answers** to the twelve questions above, each with sources or marked "unconfirmed."

**Section 4: discoveries.** This section covers sponsor tools, models, or blueprints not named in this brief that fit a role, each with a short case and links.

**Section 5: a master link index**, grouped by sponsor, listing every URL used in the research with a one-line description and the date checked.

**Section 6: a pre-build checklist** of account setup steps, keys, installs, and smoke tests the team should complete in the first 30 minutes, in order.

## Rules for the research

- Every factual claim must come from a primary source checked during this research, such as official documentation, the repository itself, a model card, or an official blog, and it must carry a link. Secondary sources are acceptable only when labeled as such.
- When a fact cannot be confirmed, the result should say "unconfirmed" and give the best available evidence, rather than guess.
- Model IDs, endpoints, prices, and limits change often, so the agent should record the date it read each one and prefer the newest source when two disagree, noting the disagreement.
- The agent should include as many relevant links as possible, because the team will use them as the reference during the build. Breadth of links is welcome, but every link must be relevant and working.
- The agent should prefer depth on the tools that fill a role over shallow coverage of every product, while still giving at least a short card for every item on the four slides.
- Code examples must come from, or be closely adapted from, official documentation, and the source page must be linked.
