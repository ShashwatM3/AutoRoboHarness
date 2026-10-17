# Version 2, Person B

Work top to bottom and stop when time runs out.

## B5. The judge

- After the supervisor finishes, send its failures and insights, with the steps and evidence they cite, to `deepseek-ai/DeepSeek-V4-Pro` on Crusoe.
- The judge confirms each failure points to a real step and each insight to real evidence, and drops what it cannot confirm.
- Add `judge: { kept, dropped }` to `GET /review/:shiftId`, and show the counts on the review screen.

## B6. The cache number

- Every Crusoe response includes `usage.prompt_tokens_details.cached_tokens`; sum it against `prompt_tokens` across all worker calls in a shift.
- Expose it as `cache_share` on the shift, and show "brain tokens served from Crusoe's cache: N%" on the live view. This only works if the brain text sits at the very start of every worker prompt, byte for byte the same.

## B7. You.com citations

- Add a supervisor tool `research(question)` that calls `POST https://api.you.com/v1/research` with the header `X-API-Key: YDC_API_KEY` and `research_effort: "lite"`.
- Show each citation's title and link next to the insight it supports.

## B8. Brain history

- `GET /brain/history` returns each version number with its held-out score, for Person A's chart.

## B9. OpenShell (only if someone is idle)

- Run the supervisor inside an OpenShell sandbox (`curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh`, then `openshell sandbox create`), with a filesystem policy that lists the brain and trajectory folders but not the held-out seeds folder, and `landlock.compatibility: hard_requirement`.
- It needs Docker Desktop on the Mac; if it fails within 15 minutes, drop it.
