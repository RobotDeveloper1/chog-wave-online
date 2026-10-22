"""Trailer cards: banner open/end + one Impact slug per shot, off the key art."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

HERE = Path(__file__).parent
BRAND = HERE / '../../client/public/brand'
CARDS = HERE / 'cards'
CARDS.mkdir(exist_ok=True)

W, H = 1920, 1080
IMPACT = 'C:/Windows/Fonts/impact.ttf'


def cover(img: Image.Image) -> Image.Image:
    scale = max(W / img.width, H / img.height)
    img = img.resize((int(img.width * scale + 0.5), int(img.height * scale + 0.5)), Image.LANCZOS)
    x = (img.width - W) // 2
    y = (img.height - H) // 2
    return img.crop((x, y, x + W, y + H))


def slug(text: str, sub: str = '') -> Image.Image:
    base = ImageEnhance.Brightness(cover(Image.open(BRAND / 'chog-waves-keyart.jpg').convert('RGB'))).enhance(0.42)
    d = ImageDraw.Draw(base)
    font = ImageFont.truetype(IMPACT, 150)
    subfont = ImageFont.truetype(IMPACT, 54)
    tw = d.textlength(text, font=font)
    ty = H // 2 - 110 if sub else H // 2 - 80
    d.text(((W - tw) / 2, ty), text, font=font, fill=(255, 255, 255), stroke_width=3, stroke_fill=(5, 3, 12))
    if sub:
        sw = d.textlength(sub, font=subfont)
        d.text(((W - sw) / 2, ty + 170), sub, font=subfont, fill=(67, 226, 168), stroke_width=2, stroke_fill=(5, 3, 12))
    return base


def main() -> None:
    banner = cover(Image.open(BRAND / 'chog-waves-banner.jpg').convert('RGB'))
    banner.save(CARDS / 'open.png')
    end = banner.copy()
    d = ImageDraw.Draw(end)
    strip = Image.new('RGBA', (W, 130), (5, 3, 12, 220))
    end.paste(strip, (0, H - 130), strip)
    font = ImageFont.truetype(IMPACT, 64)
    txt = 'CHOGATHON DEMO \u00b7 MONAD TESTNET'
    tw = d.textlength(txt, font=font)
    d.text(((W - tw) / 2, H - 112), txt, font=font, fill=(245, 195, 67))
    end.save(CARDS / 'end.png')
    sections = [
        ('01', 'THE GATE', 'connect + privy'),
        ('02', 'PICK YOUR FIGHTER', 'the nft is the controller'),
        ('03', 'THE STREET', 'a city that never idles'),
        ('04', 'THE LINE', 'six regions of road'),
        ('05', 'PACKS OF THREE', 'mites near, monsters far'),
        ('06', 'AMBUSH', 'walk in and it starts'),
        ('07', 'DUEL', 'programs, previews, pain'),
        ('08', 'DROPS', 'the purse on the ground'),
        ('09', 'LOOT', 'new cards hit the deck'),
        ('10', 'THE SHEET', 'your traits are your stats'),
        ('11', 'THE DECK', 'build the program'),
        ('12', 'THE MARKET', 'cards have prices'),
        ('13', 'ANOMALY', 'spawned by real collection volume'),
        ('14', 'DUNGEON', 'down the hatch'),
        ('15', 'PARTY UP', 'never duel alone'),
        ('16', 'RANKS', 'someone is better than you'),
        ('17', 'CALLOUT', 'put chog where your mouth is'),
        ('18', 'BOUT', 'two chogs enter, one gets paid'),
    ]
    for num, title, sub in sections:
        slug(title, sub).save(CARDS / f's{num}.png')
    print(f'cards in {CARDS}')


if __name__ == '__main__':
    main()
