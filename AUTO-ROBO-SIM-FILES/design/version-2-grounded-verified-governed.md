# Version 2: Grounded, Verified, and Governed

**Target:** working end to end by about 3:30 PM on build day
**Builds on:** Version 1, the closed loop, which stays intact underneath
**What it adds:** a full store with shoppers, robot camera views, a richer brain, an independent judge, cited store practice, and OpenShell governing what the supervisor may see and change
**What comes next:** Version 3 adds post-training, the adversary, and the improvement history across rounds

---

## What changes from Version 1, in one paragraph

Version 1 proves that the loop works. Version 2 answers the questions a sharp judge asks after seeing Version 1: how do you know the supervisor's insights are true, what stops it from changing safety rules on its own, how do you know it never peeked at the test seeds, and does this look like a real workplace? Every addition answers one of those questions, and none of them changes the loop's shape, so the Version 1 code keeps working while each piece is added.

---

## The foundation, grown

### The workspace and the tasks

The store grows from one wing to the whole shop floor: a backroom, four aisles with four shelf levels each, a checkout area, and an entrance. Shoppers now walk through the aisles on seeded paths, which matters for two reasons: they create the most realistic failures a store robot can have, and RetailAction's footage is footage of shoppers, so the robots now share a space with the kind of people the ground truth shows.

Two task types join the catalog, and both are chosen because they need judgment rather than just more movement:

| Task | What the robot does | The decisions that need intelligence |
|---|---|---|
| **PICK** | as in Version 1 | as in Version 1, plus when to enter an aisle that has a shopper in it |
| **RESTOCK** | as in Version 1, now with older stock already in the slot | whether to move older stock to the front before placing new stock behind it, which is the store practice called FIFO (first in, first out) |
| **RETURN** | finds an item a shopper left in the wrong place and puts it back in its own slot | where the item belongs, and how to route there without blocking anyone |
| **CHECK** | inspects a slot for expired or misplaced items | whether an item should be removed, moved, or reported |

### The failure model, grown

Three new failures join the three from Version 1, and each one is again produced deterministically by the engine and fixable by a change to the brain:

| Failure | When the engine produces it | What a better brain would do |
|---|---|---|
| **SHOPPER_CONFLICT** | the robot enters or blocks an aisle segment while a shopper is in it, or passes closer than the minimum distance | wait at the aisle end until the segment is clear, and give shoppers right of way |
| **STOCK_NOT_ROTATED** | new stock is placed in front of older stock | move older stock forward before placing new stock behind it |
| **AISLE_CONTENTION** | two robots work the same aisle segment and one waits, so the task runs late | allow one robot per aisle segment at a time |

### The simulator, grown

The engine gains three things: shoppers on seeded walking paths using Kenney's CC0 Mini Characters, an aisle-reservation service that enforces protocols such as one robot per segment, and item ages so stock rotation has meaning. The 3D view gains the **worker views**, a grid of four tiles, one per robot, each rendered from TIAGo's own `head_camera` with the robot's current task and a scrolling list of its recent steps underneath. Four tiles is the right number, because each tile is a full extra render of the scene, and four stays smooth and readable on stage.

### The brain, grown into a real workplace knowledge graph

A brain that is only a tree of places looks simple, and Version 2 fixes that by giving each kind of store knowledge its own node type and by drawing the relationships between them. The scope tree is the skeleton, and four kinds of knowledge hang off it, each with evidence attached:

| Node type | What it holds | Example |
|---|---|---|
| **Scope** | a place: store, zone, aisle, bay, shelf level, slot | Aisle 3, bay 2, level 4 |
| **Procedure** | the ordered steps of a task, each step its own node | RESTOCK: check slot, move older stock forward, place new stock behind, face labels outward |
| **Rule** | conditional guidance the worker should follow | items over 2 kg use a two-hand grasp |
| **Guardrail** | a hard limit the engine enforces; changing one needs human approval | 0.3 m/s when a shopper is within 1 m |
| **Protocol** | how agents coordinate with each other and with people | one robot per aisle segment; shoppers have right of way |
| **Evidence** | why a node exists | a RetailAction clip and frames, two contrasting runs, or a citation |

| Relationship | Meaning |
|---|---|
| `APPLIES_TO` | a piece of knowledge applies at a scope and everything below it |
| `STEP_OF`, `NEXT` | a step belongs to a procedure, in order |
| `OVERRIDES` | a deeper scope's node wins over a shallower one |
| `CONFLICTS_WITH` | two nodes disagree, which the supervisor must resolve |
| `SUPPORTED_BY` | a node links to its evidence |
| `REPLACES` | a node in version N+1 replaces one in version N |

The graph is drawn with the scopes as a radial tree, knowledge nodes colored by type, and evidence nodes as small satellites, so a judge can see at a glance that the rule "two-hand grasp above 2 kg" exists because of a specific clip. The `CONFLICTS_WITH` relationship is what makes the brain "conflict-free" in the Shared Brain sense: the supervisor is required to resolve every conflict it creates before an update can apply.

### The ground truth, grown

RetailAction and the contrast between runs stay as in Version 1. Version 2 adds a third source, published store practice from the **You.com Research API**, which returns a cited answer to a question such as "what is the standard procedure for rotating stock when restocking a shelf." FIFO rotation and planogram compliance are standard store procedures documented in retail operations guides, so the STOCK_NOT_ROTATED failure can be grounded in a citation rather than in footage, which fits, because RetailAction's labels are 97.2% "take," and putting stock away is rare in it.

---

## The workflow in Version 2

### Stage 1: the user launches the robots

The launch screen now offers one to four robots, all four task types, and a choice of training seed, plus a small preview of the store map showing where each task is.

### Stage 2: the user watches the robots work

The live view now has the switch you described between the **3D view** and the **worker views**. The 3D view shows the whole store with robots and shoppers, and the worker views show the four camera tiles, each with its task and a scrolling step list. The brain panel now shows the full graph, and when a worker reads it, the nodes on its scope path light up with a short pulse along the edges, so the audience can see which rule a robot is following at that moment.

Behind the scenes, the brain is sent to every worker as an identical block at the start of each prompt. **Crusoe's MemoryAlloy cache** recognizes that repeated block across all four robots, so most of the brain's tokens are served from cache, and every response reports this in its `cached_tokens` field. A small number on the live view shows the share of brain tokens served from cache, which turns the Shared Brain claim, that new agents should not pay again for the same context, into a number from Crusoe's own infrastructure.

### Stage 3: the shift becomes trajectories

Unchanged from Version 1, except that each step now also records a camera frame identifier and any protocol the step was subject to, such as an aisle reservation.

### Stage 4: the supervisor reviews, and a judge checks it

The supervisor's loop is the same as Version 1 with one more tool, `research(question)`, which calls You.com and returns a cited answer. The supervisor now runs inside an **NVIDIA OpenShell sandbox**, which is a container whose permissions are set by a policy file and enforced by the operating system rather than by the agent. Its policy lets it read the trajectory log and the brain, write candidate brain versions, and reach only Crusoe and You.com on the network. The folder that holds the held-out seeds is simply not listed in its policy, so the operating system refuses any attempt to read it, which is enforced by a Linux security feature called Landlock.

When the supervisor finishes, a **judge** checks its work before anything reaches the user. The judge is **DeepSeek V4 Pro on Crusoe**, a different model family from the supervisor, so its mistakes are unlikely to match the supervisor's. It confirms that every failure points to a real step in the log and every insight to evidence that exists, such as a real clip, two real runs, or a real citation, and it drops anything it cannot confirm. The review screen shows how many claims the judge kept and dropped, which is a visible answer to "how do you know the insights are true?"

### Stage 5: the user reviews, approves, and updates the brain

The review screen now shows each insight's grounding in full: the clip frames, the two contrasting runs side by side in camera tiles, or the citation with its link.

The **Update Brain** button works as in Version 1, with one new rule. Brain updates that change a **guardrail**, such as a speed limit near shoppers, need the human's approval, and **OpenShell** enforces that requirement: the endpoint that applies guardrail changes is blocked by the supervisor sandbox's network policy, so the attempt becomes a pending request in OpenShell's **Policy Advisor**, and it only goes through when the user approves it. Each guardrail change gets its own endpoint path, because an OpenShell approval adds a standing permission, and a separate path keeps one approval tied to one change. Rules, procedures, and protocols apply without approval, and every update still has to pass the gate on held-out seeds 101 to 110 before it becomes the live brain.

---

## Sponsors in Version 2

| Where | Sponsor tool | Exact feature and role |
|---|---|---|
| Stage 2 | Crusoe Managed Inference | Nemotron 3.5 Lightning runs every worker decision |
| Stage 2 | Crusoe MemoryAlloy | the shared brain served from cache, shown through `cached_tokens` |
| Stage 4 | Crusoe Managed Inference | Nemotron 3 Super supervisor, Nemotron 3 Nano Omni clip reader, DeepSeek V4 Pro judge |
| Stage 4 | NVIDIA OpenShell | the supervisor's sandbox; the held-out seeds are unreadable to it |
| Stage 4 | You.com Research API | cited store practice as grounding |
| Stage 5 | NVIDIA OpenShell | the Policy Advisor holds guardrail changes for the human's approval |

---

## How Version 2 scores, honestly

| Criterion | What Version 2 adds |
|---|---|
| **Technicality (40%)** | an independent judge on a different model family, kernel-enforced isolation of the test seeds, environment-enforced approval of safety changes, a typed knowledge graph with override and conflict resolution, and cache-aware prompting across a fleet |
| **Live Demo (20%)** | a full store with shoppers, four robot camera views, a graph that lights up as robots read it, and a real approval moment |
| **Creativity (25%)** | the brain now reads like a real store's operating manual, and every node shows its evidence |
| **Future Potential (15%)** | self-improving robots that cannot change their own safety limits without a person, and cannot cheat their own tests |

**Track fit.** Version 2 still leads with **Version N+1**, and it now makes the **Shared Brain** claim measurable through the cache number and the conflict rule. It also covers the core of **Done Means Done**: every task has its own definition of done, an independent verifier checks the supervisor's work, and the human is involved rarely, only for guardrail changes.

---

## If we had to stop at Version 2: the three-minute demo

1. **0:00 to 0:20.** The problem, as in Version 1.
2. **0:20 to 1:00.** Launch four robots into the store; switch to the worker views; a robot passes too close to a shopper and another drops a heavy box; the graph lights up as they read.
3. **1:00 to 1:50.** The review screen: failures with step numbers, insights grounded in a shopper's two-handed lift and in a cited FIFO procedure, and the judge's count of kept and dropped claims.
4. **1:50 to 2:40.** Update Brain: the speed guardrail change is held by OpenShell until the user approves it; the graph before and after; the gate on unseen seeds, with the score rising.
5. **2:40 to 3:00.** Crusoe for every model call and the shared brain cache, Nemotron in four roles, OpenShell as the boundary.

---

## What Version 2 leaves for Version 3

Version 2 improves the brain but never the model itself, it has no adversary to create new failures once the obvious ones are fixed, and it shows a single round of improvement rather than a history. Version 3 adds exactly those three things.
