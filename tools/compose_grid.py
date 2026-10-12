"""
Compose individual Chog renders into a labelled grid.

  python tools/compose_grid.py blender/out/grid --range 1-100 --cols 10 --out blender/out/grid_1_100.png
"""
import argparse
import os
import re
from PIL import Image, ImageDraw, ImageFont


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("indir")
    ap.add_argument("--range", default="1-100")
    ap.add_argument("--cols", type=int, default=10)
    ap.add_argument("--tile", type=int, default=256)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    lo, hi = (int(x) for x in args.range.split("-"))
    tile = args.tile
    cols = args.cols
    tokens = list(range(lo, hi + 1))
    rows = (len(tokens) + cols - 1) // cols
    label_h = 28
    cell = tile + label_h
    sheet = Image.new("RGB", (cols * cell + 12, rows * cell + 12), (22, 22, 28))
    d = ImageDraw.Draw(sheet)

    try:
        font = ImageFont.truetype("arial.ttf", 16)
    except Exception:
        font = ImageFont.load_default()

    found = 0
    for i, tok in enumerate(tokens):
        path = os.path.join(args.indir, "chog_%d.png" % tok)
        cx = 6 + (i % cols) * cell
        cy = 6 + (i // cols) * cell
        if os.path.exists(path):
            im = Image.open(path).convert("RGBA")
            im.thumbnail((tile - 4, tile - 4), Image.LANCZOS)
            bg = Image.new("RGBA", (tile, tile), (40, 40, 48, 255))
            off = ((tile - im.width) // 2, (tile - im.height) // 2)
            bg.alpha_composite(im, off)
            sheet.paste(bg.convert("RGB"), (cx, cy))
            d.rectangle([cx, cy, cx + tile - 1, cy + tile - 1], outline=(70, 70, 80))
            found += 1
        else:
            d.rectangle([cx, cy, cx + tile - 1, cy + tile - 1],
                        outline=(50, 30, 30), fill=(35, 25, 28))
        d.text((cx + 4, cy + tile + 4), "#%d" % tok, fill=(250, 250, 250), font=font)

    out = args.out or os.path.join(args.indir, "grid_%d_%d.png" % (lo, hi))
    sheet.save(out, quality=90)
    print("GRID %s (%d/%d tokens)" % (out, found, len(tokens)))


if __name__ == "__main__":
    main()
