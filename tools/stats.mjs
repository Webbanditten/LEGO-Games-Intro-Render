// Numerical check of the choreography against measurements of intro.mp4:
// visible brick counts, apparent sizes, colour mix, entry edges, pop-ins.
//   node tools/stats.mjs [--tracks]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChoreography, evalBrick, worldToScreen, N } from '../src/choreography.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const grid = fs.readFileSync(path.join(root, 'assets/mosaic-60.txt'), 'utf8').trim().split('\n');
const ch = buildChoreography(grid);
const pos = new Float32Array(3), quat = new Float32Array(4), sc = [0, 0, 0];

// measured targets from the original (visible bricks, median size in H). They count lit blobs in its frames, so they miss
// bricks hidden behind others; vis counts every brick in view, so from ~2.5 s it is expected to read well above them.
const TARGET = { 0.33: 1, 0.8: 3, 1.2: 8, 1.6: 17, 2.0: 30, 2.6: 55, 3.0: 78, 3.4: 110, 3.8: 170, 4.2: 260, 4.6: 330, 4.9: 400 };

const firstSeen = new Float32Array(ch.n).fill(-1);
const firstPos = new Float32Array(ch.n * 2);
const rows = [];
let nanCount = 0;
for (let f = 0; f <= 11 * 15; f++) {
  const t = f / 15;
  let vis = 0, cov = 0;
  const sizes = [];
  const cols = { R: 0, W: 0, Y: 0, K: 0 };
  for (let id = 0; id < ch.n; id++) {
    evalBrick(ch, id, t, pos, quat);
    if (!Number.isFinite(pos[0] + pos[1] + pos[2])) { nanCount++; continue; }
    worldToScreen(pos[0], pos[1], pos[2], t, sc);
    const d = sc[2];
    if (d < 0.6) continue;
    const size = 1.207 / d;                      // apparent size in frame heights
    const hu = size * 0.75, hv = size;           // half extents in -1..1 units (x is 4:3)
    if (sc[0] + hu < -1 || sc[0] - hu > 1 || sc[1] + hv < -1 || sc[1] - hv > 1) continue;
    vis++;
    sizes.push(size);
    if (size <= 0.094) cols[ch.color[id]]++;   // the original's colour counts used bricks <= 45 px
    cov += Math.min(1, size * size * 0.75 / 4 * 4);
    if (firstSeen[id] < 0) { firstSeen[id] = t; firstPos[id * 2] = sc[0]; firstPos[id * 2 + 1] = sc[1]; }
  }
  sizes.sort((a, b) => a - b);
  const med = sizes.length ? sizes[sizes.length >> 1] : 0;
  const key = Object.keys(TARGET).find((k) => Math.abs(Number(k) - t) < 1 / 30);
  if (f % 3 === 0 || key)
    rows.push(`${t.toFixed(2).padStart(5)}  vis ${String(vis).padStart(4)}${key ? ` (orig ~${TARGET[key]})` : ''}`.padEnd(30)
      + ` med ${med.toFixed(3)} max ${(sizes.at(-1) || 0).toFixed(2)}  `
      + ['R', 'W', 'K', 'Y'].map((c) => c + (cols[c] / Math.max(1, cols.R + cols.W + cols.K + cols.Y) * 100).toFixed(0)).join(' ')
      + `  cov~${Math.min(100, cov * 100).toFixed(0)}%`);
}
console.log(rows.join('\n'));
if (nanCount) console.log(`!! ${nanCount} NaN evaluations`);

// where do bricks first appear? (top edge / sides / bottom / pop-in)
const edges = { top: 0, left: 0, right: 0, bottom: 0, interior: 0 };
const pops = [];
for (let id = 0; id < ch.n; id++) {
  if (firstSeen[id] <= 0) continue;
  const u = firstPos[id * 2], v = firstPos[id * 2 + 1];
  if (v > 0.85) edges.top++;
  else if (u < -0.85) edges.left++;
  else if (u > 0.85) edges.right++;
  else if (v < -0.85) edges.bottom++;
  else { edges.interior++; pops.push([id, firstSeen[id].toFixed(2), u.toFixed(2), v.toFixed(2), ch.color[id], ch.hero[id]]); }
}
console.log('first appearance:', edges);
if (pops.length) console.log('pop-ins (id, t, u, v, colour, hero):', pops.slice(0, 15).map((p) => p.join(' ')).join(' | '));

if (process.argv.includes('--tracks')) {
  for (let id = 0; id < ch.n; id++) {
    if (!ch.hero[id]) continue;
    const t0 = ch.tIn[id];
    const pts = [];
    for (let k = -1; k <= 8; k++) {
      const t = t0 + k / 15;
      evalBrick(ch, id, t, pos, quat);
      worldToScreen(pos[0], pos[1], pos[2], t, sc);
      pts.push(`(${sc[0].toFixed(2)},${sc[1].toFixed(2)},${(1.207 / sc[2]).toFixed(2)}H)`);
    }
    console.log(`hero ${ch.color[id]} t=${t0.toFixed(2)}: ${pts.join(' ')}`);
  }
}

// Regression guard: no brick may pass through the camera inside the view (that shows
// as a full-frame flash of one colour), sampled at 120 Hz over the whole intro.
{
  const { cameraAt, TAN_H, TAN_V } = await import('../src/choreography.js');
  const flagged = new Map();
  for (let k = 0; k <= 11 * 120; k++) {
    const t = k / 120, cam = cameraAt(t), c = Math.cos(cam.roll), s = Math.sin(cam.roll);
    for (let id = 0; id < ch.n; id++) {
      evalBrick(ch, id, t, pos, quat);
      const d = cam.z - pos[2];
      if (d <= -0.8 || d >= 0.9) continue;
      const x = pos[0] * c - pos[1] * s, y = pos[0] * s + pos[1] * c, dd = Math.max(d, 0.1);
      if (Math.abs(x) < TAN_H * dd + 0.8 && Math.abs(y) < TAN_V * dd + 0.8 && !flagged.has(id)) flagged.set(id, t.toFixed(3));
    }
  }
  console.log(flagged.size ? `!! bricks crossing the camera in view: ${[...flagged].map(([id, t]) => `${id}@${t}s`).join(', ')}` : 'near-plane guard: ok');
}
