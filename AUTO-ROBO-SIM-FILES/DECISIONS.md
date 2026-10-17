# Decisions (locked at 1:00 PM, October 17)

## Product

A self-improving harness for a fleet of store robots. Robots work a shift in a simulated convenience store while reading a shared brain (a knowledge graph). A supervisor agent reviews their trajectories, finds failures, compares them with real human footage and with its own successful runs, and proposes brain updates. The update is kept only if a re-run on unseen seeds scores higher. Track: **Version N+1**, with Shared Brain as the supporting claim.

## Workspace, tasks, robot, ground truth

| Item | Decision |
|---|---|
| Workspace | one wing of a convenience store: a backroom and two aisles, four shelf levels each |
| Tasks | PICK (take an item for an order into a tote) and RESTOCK (bring an item from the backroom to its slot) |
| Robot | TIAGo-style mobile manipulator built from simple Three.js shapes: wheeled base, torso that slides up and down, one arm, a gripper. The real TIAGo model (MuJoCo Menagerie `pal_tiago`) is an upgrade only if time remains |
| Ground truth | RetailAction (Standard AI), real ceiling-camera footage of shoppers in US convenience stores labelled take, put, touch; plus contrast between our own successful and failed runs |

## Simulator

- One TypeScript **store engine** with no graphics: store layout, slots, items with weights, robots, held items, and the robot actions as functions. It refuses physically impossible actions (for example, reaching level 4 with the torso lowered returns "out of reach") and records facts; it has no scripted failure modes.
- The engine runs inside the Node server, so worker agents call it directly and the gate can re-run shifts without graphics.
- The web page is a **Three.js view** that receives the engine's events and animates them, built from Kenney's CC0 Mini Market and Food Kit packs.

## Failures

The harness finds failures by reading trajectories. Every trajectory step records the action and arguments, the result and its reason, the robot's position and held item, the item's final location against its target, and the time.

## The brain

- A knowledge graph stored as one JSON file per version in the repo: `brain/v1.json`, `brain/v2.json`, and so on, never edited in place.
- Loaded into memory with the `graphology` library by the Node server.
- Node types: Scope, Procedure, Step, Rule, Guardrail, Protocol, Evidence. Edge types: APPLIES_TO, STEP_OF, NEXT, SUPPORTED_BY, REPLACES.
- Day-one brain: about 40 nodes, deliberately missing a grasp-by-weight rule, a torso-height-by-shelf rule, and a check-the-slot step.

## Seeds

A seed generates one scenario: which items are in which slots, their weights, and any misplaced items. Seeds 1 to 20 are training seeds; seeds 101 to 110 are held out and used only by the before-and-after re-run.

## Models on Crusoe (exact IDs confirmed with GET /v1/models at 1:00 PM)

| Role | Model ID |
|---|---|
| Worker agents | `nvidia/Nemotron-3.5-Lightning-30B-A3B` (262k context on our project) |
| Supervisor | `nvidia/NVIDIA-Nemotron-3.5-Super-VL` (reasons and sees images, with tool calling) |
| Fallback supervisor | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` |
| Footage reader, if needed separately | `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B` |
| Judge (Version 2) | `deepseek-ai/DeepSeek-V4-Pro` |

Nemotron 3 Ultra is not available on our project. Endpoint: `https://api.inference.crusoecloud.com/v1`. Keys live only in the git-ignored `.env`.
