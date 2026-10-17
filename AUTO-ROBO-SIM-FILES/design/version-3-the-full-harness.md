# Version 3: The Full Harness

**Target:** whatever fits between Version 2 and the 5:00 PM submission, with the post-training button first
**Builds on:** Version 2, which stays intact underneath
**What it adds:** the second and third ways the harness improves the robots (the adversary and post-training), plus the history of improvement across rounds
**This is:** your complete workflow, with all three buttons on the review screen working

---

## What changes from Version 2, in one paragraph

Versions 1 and 2 improve the robots through one lever: the supervisor learns from failures and rewrites the brain. The harness has three levers, and Version 3 adds the other two. The adversary improves the brain from failures it provokes on purpose, so the system keeps learning after the obvious failures are fixed. Post-training improves the model's weights directly, by turning the robots' verified good decisions into a fine-tuning dataset for Nemotron 3.5 Lightning. All three levers share one simulator, one set of checks, one trajectory log, and one gate on the same held-out seeds, so Version 3 adds two branches to the same tree rather than a second tree.

---

## The foundation in Version 3

The workspace, robot, tasks, simulator, and ground truth are unchanged from Version 2. Two pieces are new, and both live inside the store engine.

**The task scaler** takes one task and produces three or four variants of it by changing one factor at a time: the shelf level, the item's weight band, the number of shoppers nearby, or the robot's starting position. Each variant is a new seed with a recorded parent, so the system always knows which variants came from which original task.

**The scenario catalog** is the finite set of realistic disturbances the adversary is allowed to create, each with physical limits:

| Disturbance | Limits |
|---|---|
| a pallet blocking one aisle segment | only in segments that have another route around them |
| a shopper stepping out at an aisle end | walking speed within normal human range |
| a heavy item moved to a top shelf | weight within the store's real product range |
| an item left in the wrong slot | only items that exist in the store |
| an expired item placed behind fresh stock | expiry within the last week |
| a robot starting with a low battery | above the level that forces an immediate stop |

The limits are what stop the adversary from inventing impossible situations, which is a condition of the design.

---

## The workflow in Version 3

### Stages 1 to 4

Unchanged from Version 2, except that Stage 4's review now covers shifts that the adversary created as well as shifts the user launched, and each failure is labelled with where it came from.

### Stage 5: the review screen, with all three buttons

The review screen keeps everything from Version 2 and adds a **history panel**: a chart of the score on the held-out seeds for every brain version so far, from version 1 to the current one. This chart is the direct answer to the Version N+1 problem statement's opening line, that "most agent teams are exactly as good on run 100 as on run 1."

**Button 1: Update Brain.** Unchanged from Version 2: the operations apply to a candidate version, the graph shows before and after, guardrail changes wait for approval through OpenShell, and the gate on held-out seeds decides whether the candidate becomes the live brain.

**Button 2: Run post-training.** This button runs the chain we agreed on, step by step, with each step shown as it completes:

| Step | What happens | Tool |
|---|---|---|
| 1. Collect | gather every step from tasks that passed all their checks | our trajectory log |
| 2. Multiply | run the task scaler on each successful task, play the variants with the current brain, and keep only the variants that pass all their checks | the store engine, with Nemotron 3.5 Lightning workers on Crusoe |
| 3. Format for Crusoe | turn each kept step into one chat example: the brain scope as the system message, the observation as the user message, and the chosen action as the assistant message | our exporter |
| 4. Format for Hugging Face | write a LeRobot-style copy with the robot's camera frame, its state, and the named action at each step | our exporter |
| 5. Publish | push the LeRobot-style copy to a public dataset repository on the Hugging Face Hub | Hugging Face Hub |
| 6. Upload | upload the chat-format file to Crusoe's Files API with the purpose "fine-tune" | Crusoe Serverless Fine-Tuning |
| 7. Create the job | create a supervised LoRA fine-tuning job on Nemotron 3.5 Lightning, and show its status, live loss curve, ETA, and checkpoints | Crusoe Serverless Fine-Tuning |

Three facts shape how much of this to show. Each example is a single turn, which matches Crusoe's documented support, since multi-turn reasoning examples are not yet supported. Training costs $0.40 per million tokens for Lightning, so a real job on a small dataset costs cents, and Crusoe has a cancel endpoint, but no documented way to create a job without starting it, so "show the job" means a real, small, running job. Serving the result needs a Self-Serve Deployment, which can take up to 40 minutes to provision, so comparing the fine-tuned model with the base model on the held-out seeds is a stretch goal that only happens if the job starts early.

The honest framing on stage is the one you suggested: the pipeline produces post-training-ready data, in Crusoe's training format and in a LeRobot-style format on the Hub, and starts the Lightning job. The LeRobot-style copy holds named actions rather than joint motions, which is why it is described as LeRobot-style rather than as training data for NVIDIA's GR00T robot models.

**Button 3: Adversarial attack.** You asked to design this button after the rest is wired, so this is a proposal for that discussion. The red button starts an adversary agent on a model from a third family on Crusoe, such as GLM-5.3, so that it does not share the supervisor's or the judge's habits. The adversary reads the current brain and proposes disturbances from the scenario catalog that it expects the brain to handle badly, the store engine plays each one headless with the current brain, and the adversary keeps only the ones that produce a failed check. Those situations join the pool of training seeds, never the held-out seeds, and their shifts flow into Stage 4 like any other, so the supervisor reviews them and proposes brain updates through the same review screen. The screen reports how many disturbances the adversary tried and how many broke the current brain, so the user can watch that number fall as the brain improves.

### The human conversation, as an option

Your workflow places the human at the review screen, and that is enough to satisfy every problem statement, since the guardrail approval is already the rare, necessary human moment. If time remains, a "talk to the supervisor" panel can let the user ask why a change was proposed. A voice version depends on whether Crusoe gives hackathon teams access to Nemotron 3 VoiceChat, whose price is listed as "contact sales" and whose request format is undocumented, so the safe version is a text conversation.

---

## Sponsors in Version 3

Everything from Version 2, plus:

| Where | Sponsor tool | Exact feature and role |
|---|---|---|
| Button 2 | Crusoe Managed Inference | Lightning workers play the scaled variants that become training data |
| Button 2 | Crusoe Serverless Fine-Tuning | Files API upload and a LoRA job on Nemotron 3.5 Lightning, with live loss and checkpoints |
| Button 2 | Hugging Face Hub | the public LeRobot-style dataset, which ties into NVIDIA's robotics ecosystem now that NVIDIA has agreed to acquire Hugging Face |
| Button 3 | Crusoe Managed Inference | the adversary on a third model family |

Nemotron now fills five roles: worker, supervisor, clip reader, the model being fine-tuned, and the workers that generate its data.

---

## How Version 3 scores, honestly

| Criterion | What Version 3 adds |
|---|---|
| **Technicality (40%)** | three levers on one gate, an adversary constrained by physical limits, a task scaler with rejection sampling, and an end-to-end fine-tuning pipeline on the sponsor's platform |
| **Live Demo (20%)** | three working buttons, a history chart, and a red button that visibly breaks the current brain and then gets fixed |
| **Creativity (25%)** | a harness that improves both what robots know and how the model thinks, from human footage, its own history, and its own attacks |
| **Future Potential (15%)** | a path from a self-improving brain to a self-improving model, with every step measured on unseen tasks |

**Track fit.** Version 3 answers **Version N+1** in full, including its call to rewrite "prompts, playbooks, tools, or team structure," because the brain covers playbooks and post-training goes further into the model itself. It keeps the **Shared Brain** and **Done Means Done** coverage from Version 2.

---

## The three-minute demo at full scope

1. **0:00 to 0:20.** The problem, as in Version 1.
2. **0:20 to 0:55.** Launch four robots; worker views; failures happen; the graph lights up.
3. **0:55 to 1:35.** The review screen: grounded failures and insights, the judge's count, and the brain updates.
4. **1:35 to 2:10.** Update Brain: approval through OpenShell, the graph before and after, the gate, and the history chart moving up.
5. **2:10 to 2:35.** The red button: the adversary finds two new ways to break the improved brain.
6. **2:35 to 2:55.** Run post-training: the dataset on the Hugging Face Hub and the Lightning job running on Crusoe.
7. **2:55 to 3:00.** One line on the sponsor stack, then questions.

At full scope, three minutes is tight, so the team should decide in rehearsal which one of steps 5 and 6 is shown live and which is shown as a recorded clip.
