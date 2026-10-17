"""Select ~20 RetailAction samples, download their clips, extract frames + 2x2 contact sheets.

Usage (from anywhere):
    python3 -I ground_truth/scripts/build_clips.py /path/to/samples.json

samples.json is the FiftyOne export from https://huggingface.co/datasets/Voxel51/RetailAction
(42 MB; kept outside ground_truth/). Each sample's `filepath` (e.g. data/data_3/rank1_video-1234.mp4)
is a path inside that HF dataset repo, resolved as
    https://huggingface.co/datasets/Voxel51/RetailAction/resolve/main/<filepath>
`actions.detections[i].support` is a 1-based inclusive [first_frame, last_frame] over the clip's
(<=32) frames. Writes ground_truth/selection.json for describe_clips.py.
Downloaded files are treated as data only (decoded by ffmpeg, never executed).
"""
import json
import random
import subprocess
import sys
import urllib.request
from pathlib import Path

GT = Path(__file__).resolve().parent.parent
REPO = GT.parent
BASE = "https://huggingface.co/datasets/Voxel51/RetailAction/resolve/main/"
QUOTA = {"take": 14, "put": 4, "touch": 3}
SEED = 7


def clip_id_for(fp: str) -> str:
    # data/data_3/rank1_video-1234.mp4 -> d3_rank1_1234
    parts = fp.split("/")
    d = parts[1].replace("data_", "d")
    stem = parts[2].rsplit(".", 1)[0]
    rank, _, num = stem.partition("_video")
    num = num.lstrip("-") or "0"
    return f"{d}_{rank}_{num}"


def select(samples):
    rng = random.Random(SEED)
    single = [s for s in samples if len(s["actions"]["detections"]) == 1]
    chosen = []
    for label, n in QUOTA.items():
        pool = [s for s in single if s["actions"]["detections"][0]["label"] == label]
        pool = [s for s in pool if 5 <= (lambda sp: sp[1] - sp[0] + 1)(s["actions"]["detections"][0]["support"]) <= 16]
        rng.shuffle(pool)
        # variety: spread interaction_y (vertical position of hand contact in image) across bins,
        # distinct data_N directories and distinct sample groups
        bins = {}
        for s in pool:
            y = s["interaction_points"]["detections"][0]["interaction_y"]
            bins.setdefault(min(int(y * 4), 3), []).append(s)
        used_dirs, used_groups = {c["filepath"].split("/")[1] for c in chosen}, set()
        picks = []
        order = sorted(bins)
        i = 0
        while len(picks) < n and any(bins.values()):
            b = order[i % len(order)]
            i += 1
            while bins[b]:
                s = bins[b].pop()
                dname = s["filepath"].split("/")[1]
                gid = s["group"]["_id"]["$oid"]
                if gid in used_groups or (dname in used_dirs and len(used_dirs) < 40):
                    continue
                picks.append(s)
                used_dirs.add(dname)
                used_groups.add(gid)
                break
        chosen.extend(picks)
    return chosen


def frame_indices(start, end, k=4):
    # evenly spaced, inside [start, end], 1-based
    if end - start + 1 <= k:
        return list(range(start, end + 1))
    step = (end - start) / (k - 1)
    idx = sorted({round(start + j * step) for j in range(k)})
    return idx


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def main():
    samples = json.load(open(sys.argv[1]))["samples"]
    chosen = select(samples)
    screen_ids = set()
    if len(sys.argv) > 2:
        # Optional screening pool: N extra single-`take` clips (distinct sample groups). describe_clips.py keeps
        # them in library.json only if the model reports a two-handed grasp; build_clips.py --prune deletes the rest.
        n_extra = int(sys.argv[2])
        used = {s["group"]["_id"]["$oid"] for s in chosen}
        rng = random.Random(SEED + 1)
        pool = [s for s in samples if len(s["actions"]["detections"]) == 1
                and s["actions"]["detections"][0]["label"] == "take"
                and 5 <= s["actions"]["detections"][0]["support"][1] - s["actions"]["detections"][0]["support"][0] + 1 <= 16
                and s["group"]["_id"]["$oid"] not in used]
        rng.shuffle(pool)
        for s in pool:
            if len(screen_ids) >= n_extra:
                break
            if s["group"]["_id"]["$oid"] in used:
                continue
            used.add(s["group"]["_id"]["$oid"])
            screen_ids.add(s["filepath"])
            chosen.append(s)
    out = []
    for s in chosen:
        fp = s["filepath"]
        det = s["actions"]["detections"][0]
        ip = s["interaction_points"]["detections"][0]
        cid = clip_id_for(fp)
        clip_path = GT / "clips" / f"{cid}.mp4"
        if not clip_path.exists():
            urllib.request.urlretrieve(BASE + fp, clip_path)
        fdir = GT / "frames" / cid
        fdir.mkdir(parents=True, exist_ok=True)
        start, end = det["support"]
        idxs = frame_indices(start, end)
        frames = []
        for j, f in enumerate(idxs, 1):
            outp = fdir / f"f{j}.jpg"
            if not outp.exists():
                run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(clip_path),
                     "-vf", f"select=eq(n\\,{f - 1}),scale=480:-2", "-frames:v", "1",
                     "-q:v", "4", str(outp)])
            frames.append(str(outp.relative_to(REPO)))
        sheet = fdir / "sheet.jpg"
        if not sheet.exists():
            # red square (44 px on the 480 px frame) centred on the annotated interaction point, so the
            # describing model knows which shopper/shelf spot to look at (overhead views have several people)
            bx = max(0, int(ip["interaction_x"] * 480) - 22)
            by = max(0, int(ip["interaction_y"] * 480) - 22)
            run(["ffmpeg", "-y", "-loglevel", "error", "-start_number", "1", "-i", str(fdir / "f%d.jpg"),
                 "-vf", f"drawbox=x={bx}:y={by}:w=44:h=44:color=red:t=3,tile=2x2:padding=4:color=white",
                 "-frames:v", "1", "-q:v", "4", str(sheet)])
        out.append({
            "clip_id": cid,
            "action": det["label"],
            "frames": frames,
            "frame_indices": idxs,
            "sheet": str(sheet.relative_to(REPO)),
            "clip": str(clip_path.relative_to(REPO)),
            "frame_range": [start, end],
            "screen_two_hand": fp in screen_ids,
            "source": {
                "filepath": fp,
                "hf_url": BASE + fp,
                "store_or_camera": f"camera view {s['group']['name']} (sample_id {s['sample_id']}); store not given",
                "sample_id": s["sample_id"],
                "split": s["split"],
                "segment_duration_s": s["segment_duration"],
                "interaction_point_xy": [round(ip["interaction_x"], 4), round(ip["interaction_y"], 4)],
            },
        })
        print(cid, det["label"], det["support"], idxs)
    json.dump(out, open(GT / "selection.json", "w"), indent=1)
    print(len(out), "clips")


if __name__ == "__main__":
    main()
