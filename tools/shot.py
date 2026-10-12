#!/usr/bin/env python
"""
Decode a `__shot` capture written by the browser MCP into a real JPEG.

The in-app browser has no visible surface, so the only way to see the game is to
render and read the canvas back inside one script task, ship the base64 out to a
file, and open that. This just removes the copy/paste from that loop.

  python tools/shot.py .data/_tmp/ash3.b64 .data/_tmp/ash3.jpg
"""
import base64
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    raw = src.read_text(encoding='utf-8').strip()
    data = json.loads(raw) if raw.startswith('"') else raw
    if not data.startswith('data:image/'):
        print(f'unexpected payload: {data[:60]!r}')
        return 1
    dst.write_bytes(base64.b64decode(data.split(',', 1)[1]))
    print(f'{dst}  {dst.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
