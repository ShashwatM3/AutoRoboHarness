# AutoRoboHarness

A self-improving harness for a fleet of store robots, built at the Recursive Agents Hackathon (Crusoe x Cerebral Valley, October 17, 2026).

Start with [AUTO-ROBO-SIM-FILES/INDEX.md](AUTO-ROBO-SIM-FILES/INDEX.md): [DECISIONS.md](AUTO-ROBO-SIM-FILES/DECISIONS.md) holds the locked choices, and [SEQUENCE.md](AUTO-ROBO-SIM-FILES/SEQUENCE.md) is the current build order and progress tracker.

## Setup

Copy `.env.example` to `.env` and fill in the keys. `.env` is git-ignored and must never be committed.

Node.js 22.12 or newer is required. Each package has its own lockfile.

```sh
cd engine
npm ci
npm test
npm run typecheck
npm run demo
```

The demo prints a real PICK trajectory as JSON lines. The server integration contract is documented in [engine/README.md](engine/README.md).

```sh
cd web
npm ci
npm run dev
```

The browser app runs at http://127.0.0.1:5173. Its launch screen selects one to four robots, a PICK or RESTOCK task per robot, and a training seed. Launch starts Person B's real Crusoe workers. The view animates the engine's event stream, shows each robot's task and action results, and pulses the brain nodes recorded in each step. Switch to Worker Views for a head camera and scrolling action log per robot. Seeded Kenney shoppers walk through the aisles; every action records their positions and the nearest shopper distance. Both the web app and the server must be running for live shifts.

The Motion Preview button opens a separate local preview of PICK and RESTOCK using actual engine results. It makes no model calls and does not claim to be an agent-driven shift or a measured brain improvement.

After a finished shift, Review Shift opens the supervisor's failures, insights and proposed graph edits. A failure replays its recorded step in the 3D store; insights show real RetailAction frames or the two referenced trajectories. DeepSeek independently checks the findings, and the review shows kept and dropped claims, You.com source links with unsupported citations marked separately, and brain-version score history. Update Brain applies the selected valid, judge-supported edits to a candidate and requests the same Lightning workers on ten held-out seeds. The screen shows the gate's progress, both scores, and the graph before and after. The server keeps the candidate only if the score improves. A guardrail change requires explicit approval in the review UI.

Crusoe cache usage is shown only when the provider reports it. Lightning currently omits this field, so worker shifts show “Cache not reported”; review prompt cache usage comes from Super VL's actual token counts. Local response replays do not count as provider cache hits.

The brain server has its own setup in [server/README.md](server/README.md). The web dev server forwards `/api` requests to port 8787. Credentials remain on the server and are never bundled into the web app.

## Verified Version 2 result

The [full Lightning check](AUTO-ROBO-SIM-FILES/verification/version-2-gate.json) evaluated ten held-out seeds with both brains: **60% → 90% completion**, 150 real model responses, zero local replays. v5 was promoted. [The verification packet](AUTO-ROBO-SIM-FILES/verification/version-2-verification.json) and [production UI export](AUTO-ROBO-SIM-FILES/verification/version-2-ui.pdf) record the review, independent judge, citations, cache usage, graph changes and history. Person B independently checked the result and both machines serve the verified v5 state. The optional OpenShell supervisor integration was dropped under its time box.

## Built during the event

The store engine, seeded scenario generator, action checks, trajectories, task scoring, browser scene assembly, robot model and action animations are project code built during the event. React, Vite, TypeScript, Three.js and Lucide are declared dependencies. Store furnishings and food meshes come from Kenney's CC0 Mini Market, Food Kit and Mini Characters packs, with their licenses in [web/public/assets](web/public/assets/NOTICE.md). RetailAction attribution and license are in [ground_truth/NOTICE.md](ground_truth/NOTICE.md).
