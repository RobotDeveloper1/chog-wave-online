"""Assemble the demo trailer: cards + feature shots -> chog-waves-demo.mp4.

Reads docs/trailer/shots/NN-*.mp4 (see SHOTS.md). A missing shot is filled
with a stand-in slice from the old trailer, so this always renders a preview.
"""
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
HERE = Path(__file__).parent
SHOTS = HERE / 'shots'
CARDS = HERE / 'cards'
OLD = HERE / 'chog-waves-trailer.mp4'
OUT = HERE / 'chog-wave-demo.mp4'
TMP = HERE / '.asm'

NAMES = ['01-login', '02-pick', '03-street', '04-line', '05-pack', '06-ambush', '07-duel', '08-drops', '09-reward']
MAX_SHOT = 25  # seconds; the assembly caps runaway recordings
STANDIN = 4  # seconds per stand-in slice

VF = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30'


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', *cmd], capture_output=True, text=True)


def has_audio(path: Path) -> bool:
    p = subprocess.run([FFMPEG, '-hide_banner', '-i', str(path)], capture_output=True, text=True)
    return 'Audio:' in (p.stderr or '')


def card_seg(png: Path, dur: float, out: Path) -> None:
    r = run(['-loop', '1', '-t', str(dur), '-i', str(png),
             '-f', 'lavfi', '-t', str(dur), '-i', 'anullsrc=r=44100:cl=stereo',
             '-vf', VF, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
             '-c:a', 'aac', '-shortest', str(out)])
    if r.returncode:
        raise SystemExit(f'card failed {png.name}: {r.stderr[-400:]}')


def clip_seg(src: Path, start: float, dur: float, out: Path) -> None:
    cmd = ['-ss', str(start), '-t', str(dur), '-i', str(src)]
    if not has_audio(src):
        cmd += ['-f', 'lavfi', '-t', str(dur), '-i', 'anullsrc=r=44100:cl=stereo']
        amap = ['-map', '0:v', '-map', '1:a']
    else:
        amap = []
    r = run([*cmd, *amap, '-vf', VF, '-af', 'aformat=sample_rates=44100:channel_layouts=stereo',
             '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', str(out)])
    if r.returncode:
        raise SystemExit(f'clip failed {src.name}: {r.stderr[-400:]}')


def main() -> None:
    sys.path.insert(0, str(HERE))
    import cards as cardgen
    cardgen.main()
    TMP.mkdir(exist_ok=True)
    SHOTS.mkdir(exist_ok=True)
    segs: list[Path] = []
    open_seg = TMP / 'open.ts'
    card_seg(CARDS / 'open.png', 3.0, open_seg)
    segs.append(open_seg)
    standins = 0
    for i, name in enumerate(NAMES):
        num = name[:2]
        found = sorted(SHOTS.glob(f'{num}-*.mp4'))
        card = TMP / f'card{num}.ts'
        card_seg(CARDS / f's{num}.png', 1.5, card)
        segs.append(card)
        clip = TMP / f'shot{num}.ts'
        if found:
            print(f'{name}: {found[0].name}')
            clip_seg(found[0], 0, MAX_SHOT, clip)
        else:
            print(f'{name}: STAND-IN')
            clip_seg(OLD, 5 + i * 10, STANDIN, clip)
            standins += 1
        segs.append(clip)
    end_seg = TMP / 'end.ts'
    card_seg(CARDS / 'end.png', 4.0, end_seg)
    segs.append(end_seg)
    lst = TMP / 'list.txt'
    lst.write_text(''.join(f"file '{s.as_posix()}'\n" for s in segs))
    r = run(['-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', str(OUT)])
    if r.returncode:
        raise SystemExit(f'concat failed: {r.stderr[-400:]}')
    print(f'wrote {OUT} ({standins} stand-ins)')


if __name__ == '__main__':
    main()
