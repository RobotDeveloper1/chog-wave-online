"""Contact sheet of the six fold arenas: python tools/arena-sheet.py

Reads outputs/arena-d-*.png (written by tools/shoot-dungeon-arenas.mjs) and lays them out
3x2 with a labelled header per cell, in the fold's own element colour.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = 'C:/Users/Kauker/Desktop/chog/outputs'
CELL_W, CELL_H = 760, 524
COLS, ROWS = 3, 2
PAD, HEAD = 18, 46

FOLDS = [
    ('d-ember', 'EMBER FOUNDRY', 'BURN', (255, 122, 69), 'black iron over a red-hot horizon'),
    ('d-frost', 'FROST ARCHIVE', 'FROST', (127, 216, 255), 'cold glass and ice-blue light'),
    ('d-volt', 'RELAY SPIRE', 'VOLT', (255, 224, 102), 'indigo night and yellow lightning'),
    ('d-wave', 'SUNKEN RESERVOIR', 'WAVE', (67, 226, 168), 'deep water, aqua light'),
    ('d-prism', 'PRISM VAULT', 'PRISM', (203, 178, 242), 'violet glass, every reflection too bright'),
    ('d-void', 'THE STORM CORE', 'VOID', (168, 116, 255), 'nearly black, one hot magenta seam'),
]

W = COLS * CELL_W + (COLS + 1) * PAD
H = ROWS * (CELL_H + HEAD) + (ROWS + 1) * PAD + 56
sheet = Image.new('RGB', (W, H), (11, 8, 18))
d = ImageDraw.Draw(sheet)

def font(size, bold=False):
    for name in (('seguisb.ttf' if bold else 'segoeui.ttf'), 'arialbd.ttf' if bold else 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()

f_title = font(22, True)
f_name = font(19, True)
f_meta = font(12)
f_tag = font(13)

d.text((PAD, 18), 'THE SIX FOLDS — how they look inside', font=f_title, fill=(246, 242, 255))
d.text((PAD, 44), 'client/duel-debug.html, one duel per fold · the board is lit by what the fold is made of, not by the district it starts in',
       font=f_meta, fill=(141, 134, 168))

for i, (fid, name, el, col, tagline) in enumerate(FOLDS):
    r, c = divmod(i, COLS)
    x = PAD + c * (CELL_W + PAD)
    y = 56 + PAD + r * (CELL_H + HEAD + PAD)
    d.text((x, y), name, font=f_name, fill=col)
    d.text((x + d.textlength(name, font=f_name) + 12, y + 5), el, font=f_meta, fill=(141, 134, 168))
    d.text((x, y + 24), tagline, font=f_tag, fill=(169, 162, 196))
    src = os.path.join(OUT, f'arena-{fid}.png')
    img = Image.open(src).convert('RGB').resize((CELL_W, CELL_H), Image.LANCZOS)
    sheet.paste(img, (x, y + HEAD))
    d.rectangle([x - 1, y + HEAD - 1, x + CELL_W, y + HEAD + CELL_H], outline=col, width=1)

dest = os.path.join(OUT, 'dungeon-arenas.png')
sheet.save(dest)
print('saved', dest, sheet.size)
