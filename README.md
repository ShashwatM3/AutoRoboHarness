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

The browser app runs at http://127.0.0.1:5173. Its launch screen selects one or two robots, a PICK or RESTOCK task per robot, and a training seed. Launch starts Person B's real Crusoe workers. The view animates the engine's event stream, shows each robot's task and action results, and pulses the brain nodes recorded in each step. Both the web app and the server must be running for live shifts.

The Motion Preview button opens a separate local preview of PICK and RESTOCK using actual engine results. It makes no model calls and does not claim to be an agent-driven shift or a measured brain improvement.

After a finished shift, Review Shift opens the supervisor's failures, insights and proposed graph edits. A failure replays its recorded step in the 3D store; insights show real RetailAction frames or the two referenced trajectories. Update Brain remains unavailable until the held-out gate is connected.

The brain server has its own setup in [server/README.md](server/README.md). The web dev server forwards `/api` requests to port 8787. Credentials remain on the server and are never bundled into the web app.

## Built during the event

The store engine, seeded scenario generator, action checks, trajectories, task scoring, browser scene assembly, robot model and action animations are project code built during the event. React, Vite, TypeScript, Three.js and Lucide are declared dependencies. Store furnishings and food meshes come from Kenney's CC0 Mini Market and Food Kit packs, with their licenses in [web/public/assets](web/public/assets/NOTICE.md). RetailAction attribution and license are in [ground_truth/NOTICE.md](ground_truth/NOTICE.md).
