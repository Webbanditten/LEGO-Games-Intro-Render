#!/usr/bin/env python3
"""How "settled" the assembling mosaic looks: for each frame, the share of pixels
inside the final logo square whose colour is already within a tolerance of the
completed mosaic (frame 167), for the original and a render directory.

   python3 -I tools/settle_curve.py <render-dir> <orig-dir> [first last]

The frames are scale-compensated for the camera pull-back by comparing against
the final mosaic resampled to each frame's measured logo extent.
"""
import sys
import numpy as np
from PIL import Image

rd, od = sys.argv[1], sys.argv[2]
first, last = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (140, 167)
BOX = (152, 76, 472, 396)   # final logo square (x0, y0, x1, y1)


def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.float32)


def settled(frame, final, tol=60):
    x0, y0, x1, y1 = BOX
    a, b = frame[y0:y1, x0:x1], final[y0:y1, x0:x1]
    return float((np.abs(a - b).max(2) < tol).mean())


ofin, ufin = load(f'{od}/f_167.png'), load(f'{rd}/f_167.png')
print('frame    t    orig  ours')
for n in range(first, last + 1):
    try:
        o, u = load(f'{od}/f_{n:03d}.png'), load(f'{rd}/f_{n:03d}.png')
    except FileNotFoundError:
        continue
    print(f'{n:4d} {(n - 1) / 15:6.2f}  {settled(o, ofin):.2f}  {settled(u, ufin):.2f}')
