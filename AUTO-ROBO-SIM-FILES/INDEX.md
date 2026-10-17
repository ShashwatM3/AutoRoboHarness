# AUTO-ROBO-SIM-FILES: Index

Context and planning documents for the Recursive Agents Hackathon build (Crusoe x Cerebral Valley, October 17, 2026). Start with the first two.

## Start here

| File | What it is |
|---|---|
| [SEQUENCE.md](SEQUENCE.md) | The build order: per version, one numbered list per person, with every cross-person dependency marked "Waits for" |
| [DECISIONS.md](DECISIONS.md) | Every locked decision: workspace, tasks, robot, ground truth, simulator, brain storage, seeds, and the exact Crusoe model IDs |
| [BUILD-PLAN.md](BUILD-PLAN.md) | The feature sequence for each version, with Person A and Person B owners and time slots |
| [CRUSOE-MCP-SETUP.md](CRUSOE-MCP-SETUP.md) | Simple local Cloud MCP authentication and Codex connection steps |
| [verification/version-1-gate.json](verification/version-1-gate.json) | Verified 20-run Lightning gate, both scores, verdict, and graph diff |

## Per-version, per-person build plans

| Version | Overview | Person A | Person B |
|---|---|---|---|
| 1, The Closed Loop | [README](versions/version-1/README.md) | [plan](versions/version-1/person-A/BUILD-PLAN.md) | [plan](versions/version-1/person-B/BUILD-PLAN.md) |
| 2, Grounded, Verified, Governed | [README](versions/version-2/README.md) | [plan](versions/version-2/person-A/BUILD-PLAN.md) | [plan](versions/version-2/person-B/BUILD-PLAN.md) |
| 3, The Full Harness | [README](versions/version-3/README.md) | [plan](versions/version-3/person-A/BUILD-PLAN.md) | [plan](versions/version-3/person-B/BUILD-PLAN.md) |

## Design

| File | What it is |
|---|---|
| [design/iteration-03-workflow-end-to-end.md](design/iteration-03-workflow-end-to-end.md) | The five-stage workflow fleshed out: entities, inputs and outputs, and sponsor tools per stage |
| [design/version-1-the-closed-loop.md](design/version-1-the-closed-loop.md) | Version 1: robots fail, the supervisor learns, the brain changes, a re-run on unseen seeds scores higher |
| [design/version-2-grounded-verified-governed.md](design/version-2-grounded-verified-governed.md) | Version 2: full store, camera views, richer brain, judge model, cited practice, OpenShell |
| [design/version-3-the-full-harness.md](design/version-3-the-full-harness.md) | Version 3: post-training pipeline, adversary, improvement history |

## The event

| File | What it is |
|---|---|
| [event/hackathon_deep_dive.md](event/hackathon_deep_dive.md) | The event, the three problem statements, judging criteria, every sponsor's tools, and past winners judged by Crusoe and NVIDIA |

## Research

| File | What it is |
|---|---|
| [research/simulation_stuff.md](research/simulation_stuff.md) | Survey of open-source simulators and the browser build kit |
| [research/free_public_video_humans.md](research/free_public_video_humans.md) | Survey of free human-footage datasets; RetailAction ranks first |
| [research/prompts/deep-research-prompt-simulation.md](research/prompts/deep-research-prompt-simulation.md) | The brief that produced the simulator survey |
| [research/prompts/deep-research-prompt-ground-truth.md](research/prompts/deep-research-prompt-ground-truth.md) | The brief that produced the footage survey |
| [research/prompts/deep-research-prompt-sponsor-tools.md](research/prompts/deep-research-prompt-sponsor-tools.md) | The brief for the sponsor-tool reference |
