#!/usr/bin/env python3
"""Colour area fractions and blob sizes per frame, original vs. a render directory.

   python3 -I tools/area_stats.py <render-dir> <orig-dir> <frame> [frame...]

Pixels are classed as red / white / yellow / grey / dark by simple HSV rules (the
same rules for both videos), so the numbers are comparable even if not absolute.
"""
import sys
import numpy as np
from PIL import Image


def classes(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
    mx, mn = a.max(2), a.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    dark = mx < 0.16
    red = (~dark) & (sat > 0.45) & (r >= g) & (r >= b) & (g < 0.6 * r)
    yellow = (~dark) & (sat > 0.45) & (r > 0.5) & (g > 0.6 * r) & (b < 0.5 * g)
    white = (~dark) & (sat < 0.25) & (mx > 0.7)
    grey = (~dark) & (sat < 0.25) & (mx <= 0.7)
    return {k: float(v.mean()) for k, v in dict(red=red, white=white, yellow=yellow, grey=grey, dark=dark).items()}


rd, od = sys.argv[1], sys.argv[2]
print('frame   t    | orig  red white yel  grey dark | ours  red white yel  grey dark')
for f in sys.argv[3:]:
    n = int(f)
    o = classes(f'{od}/f_{n:03d}.png')
    u = classes(f'{rd}/f_{n:03d}.png')
    fmt = lambda c: ' '.join(f'{c[k]:4.2f}' for k in ('red', 'white', 'yellow', 'grey', 'dark'))
    print(f'{n:4d} {(n - 1) / 15:5.2f}  |      {fmt(o)} |      {fmt(u)}')
