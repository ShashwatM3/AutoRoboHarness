# Deep Research Brief: Open-Source Workspace Simulations With Robots Doing Real Tasks

## Who this is for and why

This brief is for a deep research agent. The result will decide the simulator for a hackathon project being built in one day (6 hours and 15 minutes of build time). The rules allow open-source third-party code as a declared dependency, but they do not allow the team's own code written before the event. The team therefore needs an existing open-source simulator, or a set of open-source building blocks, that it can use as a clearly labelled dependency.

The project is a self-improving "brain" for a fleet of robots being onboarded into a new workspace, such as a warehouse, a factory floor, or a retail store. Robots receive tasks, perform them in a simulated workspace, and fail in measurable ways. A supervisor agent then diagnoses the failures, compares them with videos of humans doing the same work, and updates a shared knowledge graph that all robots read before acting. An adversarial agent also generates hard new situations inside the simulation, such as a blocked aisle or a person crossing, to find where the brain fails.

The simulator is the visual centre of a three-minute live demo, so it has to look like a real workspace with a real robot doing recognizable work, from both an overhead 3D view and each robot's own on-board camera.

## What the ideal result looks like

The ideal simulator meets as many of these requirements as possible. The first four matter most.

1. **Runs in a web browser with almost no setup.** The strongest preference is a JavaScript or TypeScript project built on React, Next.js, Three.js, React Three Fiber, or Babylon.js that starts with `npm install` and `npm run dev`. A Python simulator is acceptable if it installs with `pip` on an Apple Silicon Mac in under 30 minutes and has a browser or desktop viewer. Anything that requires an NVIDIA GPU on Linux, such as Isaac Sim, should be listed separately as not usable.
2. **Looks realistic.** Real-looking shelving, boxes, floors, lighting, and a recognizable robot model. Gridworlds and colored-square environments are acceptable only as a fallback category and should be marked as such.
3. **Has a robot that does recognizable physical tasks.** The best robot forms are mobile manipulators: a wheeled base with a vertical torso or mast lift and an arm, such as Hello Robot Stretch, Fetch, or TIAGo. Quadrupeds with an arm and simple wheeled warehouse robots (AMRs) are acceptable alternatives. Walking humanoids are only useful if the walking already works out of the box.
4. **Has tasks already programmed, or makes them easy to script.** The tasks the project needs are picking an item from a shelf at a given height, placing or restocking an item on a shelf, transporting a load between two points, and returning items. Task scripting at the level of discrete actions (move to, pick, place, wait, reroute, charge) is preferred over continuous joint control.
5. **Supports multiple robots at once**, ideally four to twelve in the same scene.
6. **Provides a camera view from each robot** that can be shown in a grid of tiles in a web page.
7. **Can run deterministically and headless.** The same random seed should produce the same run, and the simulation should be able to run faster than real time without rendering, so that many test runs can be scored quickly.
8. **Exposes events and metrics**, such as task completed, task late, collision or near miss, item dropped, and robot blocked, or makes them easy to add.
9. **Has a permissive open-source license**, such as MIT, Apache 2.0, or BSD. Licenses that forbid commercial use or require registration should be flagged.
10. **Is recently maintained**, with commits in 2025 or 2026.

## Where to search

The agent should search broadly and should not stop at the first plausible result. These categories are all worth covering.

- Browser-based warehouse, factory, or retail digital twins on GitHub, including React Three Fiber and Three.js demos, logistics visualizers, and "digital twin" templates.
- Browser robotics viewers and simulators, including projects that load robot description files (URDF or MJCF) into Three.js, MuJoCo compiled to WebAssembly, and browser physics engines such as Rapier and cannon-es with robot demos.
- Embodied-AI and household-robot simulators with realistic scenes and task suites, such as AI2-THOR, ProcTHOR, Habitat, ManiSkill, BEHAVIOR, RoboCasa, and Genesis, with a clear note on whether each runs on a Mac and whether it has a browser viewer.
- Multi-robot warehouse environments used in multi-agent research, such as robotic warehouse gym environments, even if they are visually simple, as the fallback category.
- General robot simulators with web front ends, such as Webots and Gazebo web clients.
- Open robot models with published description files and meshes that would let the team build its own scene, especially Hello Robot Stretch, Fetch, TIAGo, Unitree quadrupeds with arms, and common warehouse AMRs.
- NVIDIA's `PhysicalAI-SimReady-Warehouse-01` on Hugging Face, a CC BY 4.0 set of 753 OpenUSD warehouse assets including graspable objects, built for Isaac Sim. The agent should find out whether these assets can be converted to glTF or another browser format, with which tool, and how long that takes for a small subset.
- Free asset packs for warehouse scenes, such as shelving, pallets, boxes, and carts, under CC0 or similarly permissive licenses, for example from Poly Haven, Kenney, or Sketchfab's CC0 collection.

## What to return

The agent should return four sections.

**Section 1: a ranked table of candidates.** Each row should contain the repository URL, the GitHub star count, the date of the last commit, the license, the technology stack, the setup method and an honest estimate of setup time on an Apple Silicon Mac, what the scene looks like, which robot models are included, which tasks are already programmed, whether multiple robots are supported, whether per-robot cameras exist, whether it can run deterministically and headless, a link to a screenshot or demo video, and a fit score from 1 to 10 against the requirements above with a one-sentence reason.

**Section 2: the top three recommendations**, each with a paragraph explaining what the team would still need to build on top of it in one day, and the single biggest risk.

**Section 3: a "build our own" kit.** If no single project fits, the agent should list the smallest set of open-source pieces that together would produce a realistic browser scene in a few hours: a robot model with its description file and a working browser loader, a physics or kinematics library if needed, an asset pack for the workspace, and any example code for animating a mobile manipulator's lift and arm in Three.js or React Three Fiber.

**Section 4: anything that rules a candidate out.** This covers GPU or operating-system requirements, broken or abandoned repositories, licenses that forbid this use, and projects whose demos look good but cannot be scripted.

## Rules for the research

Every claim about a repository should come from the repository itself or its documentation, checked during this research rather than recalled. When a fact such as determinism or Mac support cannot be confirmed, the result should say "unconfirmed" rather than guess. Star counts and last-commit dates should be read from GitHub on the day of the research. The agent should prefer depth on ten strong candidates over shallow coverage of fifty weak ones.
