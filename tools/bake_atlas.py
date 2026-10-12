"""
Pack the baked animation frames into one atlas per Chog.

The bake writes 23 separate PNGs per token — 45,000 files for the full
collection, which no browser should be asked to open one at a time. Each token
collapses to a single 6x4 sheet instead, so the server can hand a player their
own Chog in one request and a judge's token works the same as any other.

Slot order is fixed and mirrored by client/src/chogSprites.ts:
  0..5   idle      6..13  walk      14..18 attack    19..22 hit

    python tools/bake_atlas.py [--src blender/out/_bake/anim] [--dst .data/sprites]
"""

import argparse
import json
import os
from concurrent.futures import ProcessPoolExecutor

from PIL import Image

CELL = 128
COLS = 6
ROWS = 4

# Frame counts per action, in atlas slot order. Must match ACTIONS in chog.py.
ACTIONS = (("idle", 6), ("walk", 8), ("attack", 5), ("hit", 4))


def pack_one(args):
    src, dst, token = args
    sheet = Image.new("RGBA", (CELL * COLS, CELL * ROWS), (0, 0, 0, 0))
    slot = 0
    found = 0
    for action, count in ACTIONS:
        for i in range(count):
            path = os.path.join(src, f"{action}_{i:02d}.png")
            if os.path.exists(path):
                im = Image.open(path).convert("RGBA")
                if im.size != (CELL, CELL):
                    im = im.resize((CELL, CELL), Image.LANCZOS)
                sheet.paste(im, ((slot % COLS) * CELL, (slot // COLS) * CELL))
                found += 1
            slot += 1
    if not found:
        return None
    sheet.save(os.path.join(dst, f"{token}.png"), optimize=True)
    return token, found


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(root, "blender", "out", "_bake", "anim"))
    ap.add_argument("--dst", default=os.path.join(root, ".data", "sprites"))
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    os.makedirs(a.dst, exist_ok=True)
    # The bake tags each directory with the camera yaw it was shot at.
    dirs = sorted(
        (d for d in os.listdir(a.src) if os.path.isdir(os.path.join(a.src, d))),
        key=lambda d: int(d.split("_")[0]),
    )
    jobs = []
    for d in dirs:
        token = d.split("_")[0]
        if not a.force and os.path.exists(os.path.join(a.dst, f"{token}.png")):
            continue
        jobs.append((os.path.join(a.src, d), a.dst, token))

    print(f"packing {len(jobs)} of {len(dirs)} tokens -> {a.dst}")
    done = []
    with ProcessPoolExecutor(max_workers=a.jobs) as pool:
        for i, r in enumerate(pool.map(pack_one, jobs, chunksize=16)):
            if r:
                done.append(r)
            if (i + 1) % 250 == 0:
                print(f"  {i + 1}/{len(jobs)}")

    index = {
        "cell": CELL,
        "cols": COLS,
        "rows": ROWS,
        "actions": {name: {"first": start, "count": n} for (name, n), start in zip(
            ACTIONS, [0, 6, 14, 19])},
        "tokens": sorted(int(t) for t, _ in done) + sorted(
            int(f[:-4]) for f in os.listdir(a.dst)
            if f.endswith(".png") and f[:-4].isdigit()
            and f[:-4] not in {t for t, _ in done}
        ),
    }
    index["tokens"] = sorted(set(index["tokens"]))
    with open(os.path.join(a.dst, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh)
    print(f"packed {len(done)} new, {len(index['tokens'])} total atlases")


if __name__ == "__main__":
    main()
