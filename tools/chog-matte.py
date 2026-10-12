#!/usr/bin/env python
"""Key the Chog out of its baked gradient background so PixelLab gets a clean
south-facing reference sprite. The NFT art is flat vector on a smooth per-row
gradient, so a row-median background estimate plus largest-blob cleanup mattes it
without touching the interior.

  python tools/chog-matte.py .data/art/1.png out.png [max_px]
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def bg_surface(rgb: np.ndarray) -> np.ndarray:
    """Fit a quadratic per channel to the border pixels: the NFT backgrounds are
    smooth diagonal gradients, so a per-row median leaves most of them unkeyed."""
    h, w = rgb.shape[:2]
    band = 14
    ys, xs = np.mgrid[0:h, 0:w]
    border = (
        (xs < band) | (xs >= w - band) | (ys < band) | (ys >= h - band)
    ).ravel()
    bx = (xs.ravel()[border] / w) - 0.5
    by = (ys.ravel()[border] / h) - 0.5
    samples = rgb.reshape(-1, 3)[border].astype(np.float64)
    nx, ny = xs.ravel() / w - 0.5, ys.ravel() / h - 0.5
    design = lambda a, b: np.stack(
        [np.ones_like(a), a, b, a * a, b * b, a * b], axis=1
    )
    fit = np.linalg.lstsq(design(bx, by), samples, rcond=None)[0]
    pred = design(nx, ny) @ fit
    return pred.reshape(h, w, 3)


def matte(rgb: np.ndarray, tol: int = 40) -> np.ndarray:
    h, w = rgb.shape[:2]
    bg = bg_surface(rgb)
    fg = np.abs(rgb.astype(np.float32) - bg).max(axis=2) > tol

    # Keep the largest blob, then re-fill holes so eyes and lettering survive.
    labels, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, labels, range(1, n + 1))
        fg = labels == (int(np.argmax(sizes)) + 1)
    fg = ndimage.binary_fill_holes(ndimage.binary_closing(fg, np.ones((3, 3))))
    fg = ndimage.binary_opening(fg, np.ones((2, 2)))
    return fg


def main(src: str, dst: str, max_px: int = 88) -> None:
    im = Image.open(src).convert("RGBA")
    rgb = np.asarray(im)[:, :, :3]
    fg = matte(rgb)
    if not fg.any():
        raise SystemExit(f"nothing left after keying {src}")

    ys, xs = np.nonzero(fg)
    crop = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    alpha = np.dstack([rgb, (fg * 255).astype(np.uint8)])
    out = Image.fromarray(alpha, "RGBA").crop(crop)

    # Square canvas with margin, nearest-safe power-of-two-ish sizing.
    side = max(out.size) + 8
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(out, ((side - out.width) // 2, (side - out.height) // 2), out)
    scale = max_px / side
    canvas = canvas.resize(
        (max(1, int(side * scale)), max(1, int(side * scale))), Image.LANCZOS
    )
    canvas.save(dst)
    print(f"{src} -> {dst} {canvas.size} fill={round(fg.mean(), 3)}")


if __name__ == "__main__":
    main(*sys.argv[1:3], *(int(x) for x in sys.argv[3:]))
