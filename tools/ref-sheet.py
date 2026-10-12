"""
Contact sheets of the real NFT art, cropped to the region a trait occupies.

  python tools/ref-sheet.py Head        # -> .data/sheets/Head_00.png ...

Reading 204 trait values one image at a time is hopeless; reading 9 per sheet
is not. The crop is per category because a hat lives at the top of the frame
and a jersey at the bottom, and the art is a tight portrait.
"""
import json
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, ".data", "art")
OUT = os.path.join(ROOT, ".data", "sheets")

# (left, upper, right, lower) on the 1000px source
CROPS = {
    "Head": (0, 0, 1000, 640),
    "Eyes": (150, 330, 850, 620),
    "Mouth": (230, 470, 770, 760),
    "Body": (110, 660, 900, 1000),
    "Accessory": (60, 600, 940, 1000),
    "Aura": (0, 0, 1000, 1000),
    "Skin": (0, 0, 1000, 1000),
    "Base": (0, 0, 1000, 1000),
    "Form": (0, 0, 1000, 1000),
}
TILE = 340
COLS = 3
ROWS = 3
PAD = 26


def main(category):
    refs = json.load(open(os.path.join(ROOT, ".data", "trait-refs.json")))
    entries = [e for sheet in refs["sheets"] for e in sheet
               if e["category"] == category]
    os.makedirs(OUT, exist_ok=True)
    made = []
    for start in range(0, len(entries), COLS * ROWS):
        group = entries[start:start + COLS * ROWS]
        w = COLS * TILE
        h = ROWS * (TILE + PAD)
        sheet = Image.new("RGB", (w, h), (24, 24, 30))
        draw = ImageDraw.Draw(sheet)
        crop = CROPS.get(category, (0, 0, 1000, 1000))
        for i, e in enumerate(group):
            src = os.path.join(ART, "%d.png" % e["id"])
            if not os.path.exists(src):
                continue
            im = Image.open(src).convert("RGB").crop(crop)
            im.thumbnail((TILE, TILE), Image.LANCZOS)
            cx = (i % COLS) * TILE + (TILE - im.width) // 2
            cy = (i // COLS) * (TILE + PAD) + (TILE - im.height) // 2
            sheet.paste(im, (cx, cy))
            draw.text((cx, cy + im.height + 6),
                      "#%d %s" % (e["id"], e["value"]), fill=(250, 250, 250))
        path = os.path.join(OUT, "%s_%02d.png" % (category, start // 9))
        sheet.save(path)
        made.append(path)
    print("\n".join(made))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "Head")
