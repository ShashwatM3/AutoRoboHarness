# Version 3, Person B: The Post-Training Pipeline

The **Run post-training** button calls `POST /post-training`, which runs these steps and streams progress to the review screen.

1. **Collect:** every step from tasks whose item ended at its target with no refused actions.
2. **Multiply (task scaler):** for each successful task, create 3 variants (another shelf level, another weight, another start position), play them with the current brain, and keep the ones that succeed.
3. **Format for Crusoe:** one JSON line per kept step: `{"messages": [system: brain scope, user: observation, assistant: the chosen action]}`. Single-turn examples only, which Crusoe supports.
4. **Upload:** `client.files.create(file=open("train.jsonl","rb"), purpose="fine-tune")` against `https://api.intelligence.crusoecloud.com/v1` (the control-plane URL, different from inference).
5. **Create the job:** `client.fine_tuning.jobs.create(model=<Lightning fine-tuning ID from client.models.list()>, training_file=<file id>, method={"type": "supervised", "supervised": {"hyperparameters": {"n_epochs": 1, "lora_rank": 16, "lora_alpha": 32}}})`. It starts at once; a small dataset costs cents at $0.40 per million tokens. Show the job ID, status, and a link to its console page with the live loss curve.
6. **Hugging Face (if time):** push a LeRobot-style copy (camera frame, robot state, named action per step) to a public dataset repository with `huggingface_hub`.

Do not create a Self-Serve Deployment; it can take up to 40 minutes to provision.
