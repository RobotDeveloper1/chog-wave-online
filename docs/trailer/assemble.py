"""Assemble the demo trailer: cards + feature shots -> chog-wave-demo.mp4.

Reads docs/trailer/shots/NN-*.mp4 (see SHOTS.md). A missing shot is filled
with a stand-in slice from the old trailer, so this always renders a preview.
Narration clips in docs/trailer/voice/ (see VOICEOVER.md) are mixed over the
game audio with automatic ducking; without them the output is unchanged.
"""
import re
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
HERE = Path(__file__).parent
SHOTS = HERE / 'shots'
CARDS = HERE / 'cards'
VOICE = HERE / 'voice'
OLD = HERE / 'chog-waves-trailer.mp4'
OUT = HERE / 'chog-wave-demo.mp4'
TMP = HERE / '.asm'

NAMES = ['01-login', '02-pick', '03-street', '04-line', '05-pack', '06-ambush', '07-duel', '08-drops', '09-reward',
         '10-sheet', '11-deck', '12-trade', '13-anomaly', '14-dungeon', '15-party', '16-ranks', '17-callout', '18-bout']
MAX_SHOT = 25  # seconds; the assembly caps runaway recordings
# Per-take trims (start, dur). Empty: takes play through, capped at MAX_SHOT.
# Front-load the action — only the first 25s of each take makes the cut.
TRIMS = {}
STANDIN = 4  # seconds per stand-in slice

VF = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30'


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', *cmd], capture_output=True, text=True)


def has_audio(path: Path) -> bool:
    p = subprocess.run([FFMPEG, '-hide_banner', '-i', str(path)], capture_output=True, text=True)
    return 'Audio:' in (p.stderr or '')


def probe_dur(path: Path) -> float:
    p = subprocess.run([FFMPEG, '-hide_banner', '-i', str(path)], capture_output=True, text=True)
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', p.stderr or '')
    if not m:
        return 0.0
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def voice_clip(key: str) -> Path | None:
    if not VOICE.is_dir():
        return None
    found = sorted(VOICE.glob(f'{key}.mp3')) + sorted(VOICE.glob(f'{key}.wav'))
    return found[0] if found else None


def mix_voice(video: Path, clips: list[tuple[Path, float]], total: float, out: Path) -> None:
    """Lay narration over the cut: each clip delayed to its scene, the game
    ducked underneath while a line is speaking. Video passes through."""
    cmd = ['-i', str(video)]
    for path, _ in clips:
        cmd += ['-i', str(path)]
    parts = []
    for i, (_, off) in enumerate(clips):
        ms = int(off * 1000)
        parts.append(f'[{i + 1}:a]adelay={ms}|{ms},aformat=sample_rates=44100:channel_layouts=stereo[v{i}]')
    if len(clips) == 1:
        parts.append('[v0]anull[voice]')
    else:
        inner = ''.join(f'[v{i}]' for i in range(len(clips)))
        parts.append(f'{inner}amix=inputs={len(clips)}:duration=longest:dropout_transition=0[voice]')
    # Pad the voice bed to the full cut: sidechaincompress ends with its
    # shortest input, and an unpadded bed would truncate the whole trailer
    # to the last line.
    parts.append(f'[voice]apad=whole_dur={total:.2f}[voicep]')
    parts.append('[0:a][voicep]sidechaincompress=threshold=0.03:ratio=6:attack=150:release=600[ducked]')
    parts.append('[ducked][voicep]amix=inputs=2:duration=first:dropout_transition=0[aout]')
    r = run([*cmd, '-filter_complex', ';'.join(parts), '-map', '0:v', '-map', '[aout]',
             '-c:v', 'copy', '-c:a', 'aac', '-shortest', str(out)])
    if r.returncode:
        raise SystemExit(f'voice mix failed: {r.stderr[-400:]}')


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
    durs: list[float] = []
    shot_at: dict[str, float] = {}
    cursor = 0.0

    def push(seg: Path, dur: float) -> None:
        nonlocal cursor
        segs.append(seg)
        durs.append(dur)
        cursor += dur

    open_seg = TMP / 'open.ts'
    card_seg(CARDS / 'open.png', 2.0, open_seg)
    push(open_seg, 2.0)
    standins = 0
    for i, name in enumerate(NAMES):
        num = name[:2]
        found = sorted(SHOTS.glob(f'{num}-*.mp4'))
        card = TMP / f'card{num}.ts'
        card_seg(CARDS / f's{num}.png', 0.8, card)
        push(card, 0.8)
        clip = TMP / f'shot{num}.ts'
        shot_at[num] = cursor
        if found:
            print(f'{name}: {found[0].name}')
            t0, td = TRIMS.get(num, (0, MAX_SHOT))
            clip_seg(found[0], t0, td, clip)
            push(clip, max(0.1, min(probe_dur(found[0]) - t0, td)) or td)
        else:
            print(f'{name}: STAND-IN')
            clip_seg(OLD, 5 + (i % 9) * 10, STANDIN, clip)
            push(clip, STANDIN)
            standins += 1
    end_seg = TMP / 'end.ts'
    card_seg(CARDS / 'end.png', 2.5, end_seg)
    end_at = cursor
    push(end_seg, 2.5)
    lst = TMP / 'list.txt'
    lst.write_text(''.join(f"file '{s.as_posix()}'\n" for s in segs))
    clips: list[tuple[Path, float]] = []
    for key, at in [('open', 0.4), ('end', end_at + 0.5)]:
        hit = voice_clip(key)
        if hit:
            clips.append((hit, at))
    for num, at in sorted(shot_at.items()):
        hit = voice_clip(num)
        if hit:
            clips.append((hit, at + 0.4))
    if not clips:
        target = OUT
    else:
        target = TMP / 'novoice.mp4'
        print(f'voice: {", ".join(f"{p.stem}@{off:.1f}s" for p, off in clips)}')
    r = run(['-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', str(target)])
    if r.returncode:
        raise SystemExit(f'concat failed: {r.stderr[-400:]}')
    if clips:
        mix_voice(target, clips, cursor, OUT)
    print(f'wrote {OUT} ({standins} stand-ins, {len(clips)} voice clips)')


if __name__ == '__main__':
    main()
