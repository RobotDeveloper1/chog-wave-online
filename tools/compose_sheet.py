"""
Composite a trait review sheet: NFT artwork on the left, our render on the right.

  python tools/compose_sheet.py blender/out/traits/Head_00_manifest.json

Split from the Blender step because Blender ships its own python without PIL.
"""
import json
import os
import sys
from PIL import Image, ImageDraw


def compose(manifest_path):
    mf = json.load(open(manifest_path, encoding="utf-8"))
    pairs, cols, tile = mf["pairs"], mf["cols"], mf["tile"]
    # A strip has no art column, so cells are one image wide, not two.
    span = tile + 12 if all(not p["art"] for p in pairs) else 2 * tile + 12
    rows = (len(pairs) + cols - 1) // cols
    cell_w, cell_h = span, tile + 34
    sheet = Image.new("RGB", (cols * cell_w + 12, rows * cell_h + 12), (22, 22, 28))
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(pairs):
        cx = 6 + (i % cols) * cell_w
        cy = 6 + (i // cols) * cell_h
        slot = 0
        for src in (p["art"], p["render"]):
            if not (src and os.path.exists(src)):
                continue
            im = Image.open(src).convert("RGBA")
            im.thumbnail((tile - 6, tile - 6), Image.LANCZOS)
            bg = Image.new("RGBA", (tile, tile), (40, 40, 48, 255))
            off = ((tile - im.width) // 2, (tile - im.height) // 2)
            bg.alpha_composite(im, off)
            sheet.paste(bg.convert("RGB"), (cx + slot * (tile + 12), cy))
            d.rectangle([cx + slot * (tile + 12), cy,
                         cx + slot * (tile + 12) + tile - 1, cy + tile - 1],
                        outline=(70, 70, 80))
            slot += 1
        d.text((cx + 4, cy + tile + 4), p["label"], fill=(250, 250, 250))
    out = mf["out"]
    sheet.save(out)
    print("SHEET", out)


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        compose(arg)
