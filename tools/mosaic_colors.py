#!/usr/bin/env python3
"""Per-colour statistics of the assembled brick mosaic in a 640x480 frame.

   python3 -I tools/mosaic_colors.py <frame.png> [<frame2.png> ...]

Cell centres follow the original's measured lattice (x = 152.3 + 5.402 i,
y = 78.6 + 5.390 j). For every brick colour it prints the median cell mean,
the median stud highlight (brightest 3x3 in the cell), the median seam colour
(cell corners), and the top-rows vs. bottom-rows red brightness.
"""
import sys, os
import numpy as np
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
grid = open(os.path.join(here, '..', 'assets', 'mosaic-60.txt')).read().split()
X0, Y0, P = 152.3, 78.6, 5.4


def hexc(c):
    return '#%02X%02X%02X' % tuple(int(round(v)) for v in c)


def stats(path):
    img = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    out = {}
    for key in 'RWYK':
        means, highs, seams = [], [], []
        for j in range(1, 59):
            for i in range(1, 59):
                if grid[j][i] != key:
                    continue
                # only cells whose 4 neighbours share the colour (avoid colour bleed)
                if not all(grid[j + dj][i + di] == key for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    continue
                cx, cy = X0 + P * i, Y0 + 5.39 * j
                x0, y0 = int(round(cx - 2.7)), int(round(cy - 2.7))
                cell = img[y0:y0 + 5, x0:x0 + 5]
                lum = cell @ [0.299, 0.587, 0.114]
                means.append(cell.reshape(-1, 3).mean(0))
                k = np.unravel_index(np.argmax(lum), lum.shape)
                highs.append(cell[k])
                seams.append(img[int(round(cy - 2.7)), int(round(cx - 2.7))])
        if means:
            out[key] = (np.median(means, 0), np.median(highs, 0), np.median(seams, 0), len(means))
    red_top = np.median([img[int(Y0 + 5.39 * j), int(X0 + P * i)] for j in range(1, 8) for i in range(5, 55)], 0)
    red_bot = np.median([img[int(Y0 + 5.39 * j), int(X0 + P * i)] for j in range(50, 58) for i in range(5, 55)], 0)
    return out, red_top, red_bot


for path in sys.argv[1:]:
    out, top, bot = stats(path)
    print(path)
    for k, (m, h, s, n) in out.items():
        print(f'  {k}: mean {hexc(m)}  stud {hexc(h)}  seam {hexc(s)}  (n={n})')
    lt, lb = top @ [0.299, 0.587, 0.114], bot @ [0.299, 0.587, 0.114]
    print(f'  red rows top {hexc(top)} (luma {lt:.0f})  bottom {hexc(bot)} (luma {lb:.0f})  ratio {lb / lt:.2f}')
