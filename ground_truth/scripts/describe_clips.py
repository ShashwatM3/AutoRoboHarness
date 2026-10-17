"""Describe each selected clip's contact sheet with Nemotron 3.5 Super VL on Crusoe, then write library.json.

Usage:
    python3 -I ground_truth/scripts/describe_clips.py

Reads ground_truth/selection.json (from build_clips.py). CRUSOE_API_KEY is read from the hackathon .env
(never printed). Requests run sequentially with exponential backoff on 429/503; raw responses are cached in
ground_truth/.cache/<sha>.json so reruns do not re-call the API.
"""
import base64
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

GT = Path(__file__).resolve().parent.parent
REPO = GT.parent
ENV = REPO.parent / ".env"
URL = "https://api.inference.crusoecloud.com/v1/chat/completions"
MODEL = "nvidia/NVIDIA-Nemotron-3.5-Super-VL"
CACHE = GT / ".cache"

PROMPT = """This image is a 2x2 contact sheet of 4 frames from one real convenience-store video clip, in time order: top-left, top-right, bottom-left, bottom-right. The camera is ceiling-mounted looking down; faces are blurred. A red square marks the annotated point where the shopper's hand contacts a product. The annotated action is "{action}" ({verb}).

Describe what the shopper's hands and body do, in a way that would help a robot imitate it: grasp type (one hand or two, pinch/wrap), reach height relative to the body (above shoulder, waist, below knee / crouching), posture (leaning, bending, standing upright, arm extended), and whether they looked at or touched the item or shelf before taking/handling it.

Return ONLY a JSON object, no markdown, with exactly these keys:
{{"description": "<1-2 sentences about hands, grasp, reach height and posture>",
 "hands": "one" | "two" | "unclear",
 "shelf_height": "top" | "middle" | "bottom" | "unclear",
 "looked_or_touched_first": true | false | "unclear",
 "item_size": "small" | "medium" | "large" | "unclear"}}
Use "unclear" whenever the frames do not show it clearly; do not guess."""

VERBS = {"take": "the shopper takes an item from the shelf/fridge",
         "put": "the shopper puts an item back onto the shelf/fridge",
         "touch": "the shopper touches an item without taking it"}

ENUMS = {"hands": {"one", "two", "unclear"},
         "shelf_height": {"top", "middle", "bottom", "unclear"},
         "item_size": {"small", "medium", "large", "unclear"}}


def api_key():
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line.startswith("CRUSOE_API_KEY") and "=" in line:
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    k = os.environ.get("CRUSOE_API_KEY")
    if not k:
        raise SystemExit("CRUSOE_API_KEY not found")
    return k


def call(body, key, max_tries=8):
    delay = 5.0
    for attempt in range(max_tries):
        req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST",
                                     headers={"Authorization": f"Bearer {key}",
                                              "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode(errors="replace")
            if e.code in (429, 500, 502, 503, 504):
                print(f"  HTTP {e.code} (attempt {attempt + 1}), backing off {delay:.0f}s: {msg[:120]}")
                time.sleep(delay)
                delay = min(delay * 2, 90)
                continue
            raise RuntimeError(f"HTTP {e.code}: {msg}")
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  network error {e} (attempt {attempt + 1}), backing off {delay:.0f}s")
            time.sleep(delay)
            delay = min(delay * 2, 90)
    raise RuntimeError("gave up after retries")


def parse(text):
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"no JSON in response: {text[:200]}")
    d = json.loads(m.group(0))
    out = {"description": str(d.get("description", "")).strip()}
    for k, allowed in ENUMS.items():
        v = str(d.get(k, "unclear")).lower().strip()
        out[k] = v if v in allowed else "unclear"
    v = d.get("looked_or_touched_first", "unclear")
    if isinstance(v, str):
        v = {"true": True, "false": False}.get(v.lower().strip(), "unclear")
    out["looked_or_touched_first"] = v if isinstance(v, bool) else "unclear"
    return out


def main():
    sel = json.load(open(GT / "selection.json"))
    key = None
    CACHE.mkdir(exist_ok=True)
    clips, dropped = [], []
    for c in sel:
        img = (REPO / c["sheet"]).read_bytes()
        prompt = PROMPT.format(action=c["action"], verb=VERBS[c["action"]])
        h = hashlib.sha256(MODEL.encode() + prompt.encode() + img).hexdigest()[:24]
        cpath = CACHE / f"{c['clip_id']}_{h}.json"
        if cpath.exists():
            resp = json.loads(cpath.read_text())
            src = "cache"
        else:
            key = key or api_key()
            body = {
                "model": MODEL,
                "messages": [{"role": "user", "content": [
                    {"type": "image_url",
                     "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(img).decode()}},
                    {"type": "text", "text": prompt}]}],
                "max_tokens": 600,
                "temperature": 0.2,
                "chat_template_kwargs": {"enable_thinking": False},
            }
            resp = call(body, key)
            cpath.write_text(json.dumps(resp, indent=1))
            src = "api"
            time.sleep(3.5)  # stay under ~15-20 req/min
        text = resp["choices"][0]["message"]["content"]
        try:
            d = parse(text)
        except Exception as e:  # keep going; record failure rather than inventing data
            print(f"{c['clip_id']}: PARSE FAILED ({e})")
            continue
        if c.get("screen_two_hand") and d["hands"] != "two":
            print(f"{c['clip_id']} [{src}] screened out (hands={d['hands']})")
            dropped.append(c)
            continue
        print(f"{c['clip_id']} [{src}] {c['action']}: hands={d['hands']} shelf={d['shelf_height']} "
              f"first={d['looked_or_touched_first']} size={d['item_size']} | {d['description'][:110]}")
        clips.append({
            "clip_id": c["clip_id"],
            "action": c["action"],
            "frames": c["frames"],
            "sheet": c["sheet"],
            "clip": c["clip"],
            "frame_range": c["frame_range"],
            **d,
            "source": {**c["source"], "frame_indices_1based": c["frame_indices"],
                       "described_by": MODEL + " (Crusoe), from sheet.jpg"},
        })
    lib = {
        "dataset": "RetailAction (Standard AI) via Voxel51/RetailAction",
        "dataset_url": "https://huggingface.co/datasets/Voxel51/RetailAction",
        "license": "Standard.AI Dataset License (see ground_truth/LICENSE-RetailAction.txt, ground_truth/NOTICE.md)",
        "notes": "frame_range is the annotated action's 1-based inclusive frame span within the clip "
                 "(clips are 600x600, <=32 frames, 6 fps). frames are 4 evenly spaced frames inside that span, "
                 "downscaled to 480 px; sheet is their 2x2 tile with a red box at the annotated hand-contact point. "
                 "description/hands/shelf_height/looked_or_touched_first/item_size come from "
                 + MODEL + " looking at the sheet; overhead views make shelf height and look-first judgments noisy.",
        "clips": clips,
    }
    so = GT / "screened_out.json"
    if so.exists():
        n = len(json.loads(so.read_text()))
        lib["notes"] += (f" Coverage gap: none of these clips shows a two-handed grasp. An extra {n} random single-take "
                         "clips were screened for hands=two with the same prompt; none qualified (ids in "
                         "ground_truth/screened_out.json, files deleted).")
    if dropped:  # clips screened for two-handed grasps that did not qualify (their files can be deleted)
        (GT / "screened_out.json").write_text(json.dumps([c["clip_id"] for c in dropped], indent=1))
    (GT / "library.json").write_text(json.dumps(lib, indent=1, ensure_ascii=False))
    print(f"wrote library.json with {len(clips)}/{len(sel)} clips")


if __name__ == "__main__":
    main()
