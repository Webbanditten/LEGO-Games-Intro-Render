// The whole intro as pure, deterministic math (no three.js, no DOM), so the
// browser and the node analysis tools evaluate exactly the same motion.
//
// The swarm is a *reversed explosion*: every brick of the 60x60 logo leaves its
// slot from rest in "forward" (explosion) time s = A_i - t, accelerating along
//
//   pos(s) = slot + z*H*hover(s) + B*F(k1, s) + L*F(k2, s) + SC*scatter(s) + jitter
//   F(k, s) = (e^(ks) - 1 - ks) / (e^(10k) - 1 - 10k)        (F(k,10) = 1)
//
// Played backwards (video time t), the bricks rain down from above / come in from
// the sides, decelerate and settle into the mosaic, which is exactly what the
// original LEGO Media intro shows. B and L are solved per brick from screen-space
// waypoints (where/when/how big a brick enters the frame), which lets the timing
// of the original (counts, sizes, directions) be matched directly.
//
// On top of the mosaic bricks there are a few dozen near-camera "fly-by" bricks.
// They follow scripted screen-space tracks transcribed from the original (time,
// place, size, speed) and leave the frame for good, so they are extra bricks that
// park out of sight afterwards. Fly-bys of the late bursts that land in the
// letters are mosaic bricks gliding into their slots.

import { makeCurve, clamp, lerp, rng, gaussian, smoothstep } from './curves.js';

export const N = 60;                      // mosaic is N x N 1x1 bricks
export const FOV = 45;                    // vertical field of view (deg)
export const ASPECT = 4 / 3;              // the original is 640x480
export const TAN_V = Math.tan((FOV * Math.PI) / 360);
export const TAN_H = TAN_V * ASPECT;
// The assembled mosaic spans 0.675 of the frame height (measured: 324 px of 480).
export const D_FINAL = N / 0.675 / (2 * TAN_V);
// The logo centre sits slightly left of the frame centre (0.4875, 0.495).
export const SHIFT_U = 2 * (0.4875 - 0.5);   // in NDC-like units (-1..1)
export const SHIFT_V = -2 * (0.495 - 0.5);

// Key times (seconds), all measured from intro.mp4.
export const T = {
  end: 15.8,
  snap: 11.0,        // mosaic complete
  xfadeStart: 11.2,  // stud mosaic -> flat logo dissolve (smoothstep)
  xfadeDur: 0.9,
  moveStart: 13.03,  // flat logo shrinks/moves left (linear)
  moveDur: 0.44,
  mediaStart: 13.56, // "LEGO Media" mark zooms in about the frame centre
};

// Camera: static at half distance, then dollies straight back, easing to rest at 11 s.
const dolly = makeCurve([
  [6.5, 0.5], [7.27, 0.565], [7.93, 0.625], [8.6, 0.72], [9.27, 0.815],
  [9.93, 0.895], [10.6, 0.97], [11.0, 1.0], [11.35, 1.0],   // last key: zero slope at 11.0
]);
// Roll: the forming logo starts tilted counter-clockwise and levels out.
const roll = makeCurve([
  [4.6, 14], [6.6, 10], [7.9, 6], [8.3, 4.5], [8.6, 3.0], [9.27, 1.7],
  [9.93, 0.9], [10.2, 0.35], [10.5, 0],
]);

export function cameraAt(t) {
  return { z: D_FINAL * dolly(t), roll: (roll(t) * Math.PI) / 180 };
}

// Screen (u,v in -1..1 of the 4:3 frame, v up) at distance d from the camera -> world.
export function screenToWorld(u, v, d, t, out = [0, 0, 0]) {
  const cam = cameraAt(t);
  const xc = (u - SHIFT_U) * TAN_H * d;
  const yc = (v - SHIFT_V) * TAN_V * d;
  // camera.rotation.z = -roll  =>  camera-space (xc, yc) rotated by -roll in world
  const c = Math.cos(-cam.roll), s = Math.sin(-cam.roll);
  out[0] = xc * c - yc * s;
  out[1] = xc * s + yc * c;
  out[2] = cam.z - d;
  return out;
}

export function worldToScreen(x, y, z, t, out = [0, 0, 0]) {
  const cam = cameraAt(t);
  const d = cam.z - z;
  const c = Math.cos(cam.roll), s = Math.sin(cam.roll);
  const xc = x * c - y * s;
  const yc = x * s + y * c;
  out[0] = xc / (TAN_H * d) + SHIFT_U;
  out[1] = yc / (TAN_V * d) + SHIFT_V;
  out[2] = d;
  return out;
}

// Is a brick at camera distance d, screen (u, v) inside the frame? (bounding box of a
// tumbling 1x1 brick ~1.5x its width; width = 1/(TAN_V d) in v units)
function onScreen(u, v, d) {
  if (d < 0.6) return false;
  const h = 1.5 / (2 * TAN_V * d);
  return Math.abs(u) - h * 0.75 < 1 && Math.abs(v) - h < 1;
}

const F = (k, s) => (Math.exp(k * s) - 1 - k * s) / (Math.exp(10 * k) - 1 - 10 * k);
const hover = (s) => 1 - Math.exp(-(s / 1.5) * (s / 1.5));
// Late scatter: the cloud is still loose 1-2 s before the snap (outer bricks pushed out,
// toward the camera and tilted). Grows like s^1.8 near the end, bounded early on.
const scatter = (s) => Math.pow(s, 1.8) / (1 + Math.pow(s / 2.5, 1.8));
// Residual misalignment. The original drops it in a single 15 fps frame at 11.0 s; at
// 60 fps that reads as a jolt, so the bricks ease into place over the final 0.4 s.
const SETTLE = 0.4;
const jitterAmp = (s) => (0.6 + 0.4 * Math.min(1, s / 2)) * smoothstep(s / SETTLE);
// deterministic per-brick hash, for choices that must not disturb the main random stream
const hash01 = (k) => (Math.imul(k + 1, 2654435761) >>> 0) / 4294967296;

// Number of mosaic bricks that have entered the frame by time t (fitted to brick counts in the video).
const entered = makeCurve([
  [0.30, 0], [0.33, 1], [0.70, 2], [0.85, 3], [1.15, 4], [1.22, 9], [1.6, 18], [2.0, 34],
  [2.6, 64], [3.0, 92], [3.4, 132], [3.8, 205], [4.2, 310], [4.6, 400], [4.9, 490],
  [5.5, 820], [6.0, 1250], [6.5, 1900], [7.0, 2550], [7.5, 3050], [8.0, 3350], [8.6, 3500],
]);
// Colour share of the entering bricks during the opening (by count, from the video).
const OPENING_SHARE = {
  R: makeCurve([[0, 0.03], [1.9, 0.05], [2.4, 0.15], [3.0, 0.22], [3.6, 0.27], [4.0, 0.28]]),
  Y: makeCurve([[1.85, 0], [2.0, 0.02], [3.0, 0.035], [4.0, 0.045]]),
  K: () => 0.18,
};

// Near-camera bricks transcribed from the original: time, colour, screen x, camera
// distance at entry (brick widths). The distances were measured from bounding boxes,
// which are ~1.45x the brick width for a tumbling brick, hence DIST_K.
const HEROES = [
  [1.20, 'R', 0.56, 4.3], [1.20, 'K', -0.72, 4.3], [1.22, 'W', -0.95, 8],
  [1.68, 'R', 0.40, 8], [1.80, 'R', 0.15, 7], [1.84, 'R', 0.45, 9], [1.88, 'R', 0.30, 6],
  [1.95, 'Y', -0.40, 7.6], [2.10, 'R', 0.55, 7], [2.15, 'Y', -0.30, 6.9], [2.30, 'R', 0.25, 6],
  [2.60, 'R', -1.0, 6], [2.67, 'Y', 1.08, 7], [3.00, 'R', -0.85, 2.1], [3.30, 'R', 0.35, 4.5],
  [3.55, 'R', -0.55, 2.2], [3.65, 'R', -0.35, 1.6], [3.80, 'R', 0.62, 3.3],
  [3.93, 'R', 0.10, 2.0], [3.95, 'R', -0.25, 2.1], [4.25, 'R', 0.75, 3.5],
  [4.47, 'K', -0.70, 2.4], [4.60, 'R', -0.80, 4.0], [4.62, 'R', 0.85, 3.2],
  [4.73, 'R', 0.45, 2.2], [4.75, 'R', 0.20, 3.0], [4.95, 'R', 0.85, 1.7],
  [5.07, 'R', 0.40, 1.9], [5.20, 'R', 0.37, 7.5], [5.40, 'R', -0.70, 2.2],
  [5.65, 'R', 0.10, 3.0], [5.80, 'K', 0.45, 3.6], [6.00, 'R', -0.45, 2.6],
  [6.20, 'R', 0.55, 2.7], [6.21, 'R', 0.62, 2.7], [6.53, 'R', 0.15, 3.5],
  [6.80, 'R', -0.60, 2.8], [7.07, 'R', 0.30, 1.8], [7.40, 'R', 0.70, 3.0],
  [7.73, 'R', 0.0, 1.5], [7.75, 'W', -0.33, 4.0], [7.80, 'W', -0.10, 9], [7.82, 'W', 0.05, 11],
  [7.85, 'K', -0.20, 10], [7.87, 'R', -0.07, 2.8], [8.00, 'K', -0.85, 1.4],
  [8.05, 'W', -0.90, 1.3], [8.05, 'K', 0.70, 3.5], [8.20, 'K', -0.08, 12],
  [8.45, 'R', 0.60, 7], [8.55, 'R', 0.82, 7], [8.65, 'R', -0.75, 8],
  [8.85, 'W', -0.44, 2.5], [8.86, 'W', 0.46, 2.4], [8.95, 'W', 0.0, 4.8],
  [8.97, 'K', -0.76, 6], [9.05, 'K', -0.40, 1.5], [9.10, 'W', -0.05, 1.9], [9.12, 'W', 0.35, 3.8],
];
const DIST_K = 1.45;
// Bursts from 7.7 s on: big ones fly past, smaller ones tumble into the letter band.
const LANDS = (t, d) => t >= 7.7 && d * DIST_K >= 5.5;

// The last three white bricks of the original glide in from the top/top-right and land
// in the upper letter area (measured tracks: time, x, y in 0..1 of the frame with y
// down, bounding-box size in H), then blend into their slots by 10.3 s.
const LATE_TRACKS = [
  { slot: [22, 31], keys: [[8.80, .45, -.22, .28], [9.20, .46, .06, .22], [9.33, .475, .16, .16], [9.47, .48, .25, .10], [9.60, .49, .315, .065], [9.73, .49, .35, .043], [9.87, .495, .375, .033], [10.07, .50, .40, .021], [10.2, .501, .402, .016]] },
  { slot: [21, 37], keys: [[8.70, .86, -.30, .35], [9.20, .81, .06, .30], [9.33, .785, .09, .22], [9.40, .75, .11, .16], [9.47, .73, .14, .11], [9.60, .67, .24, .07], [9.73, .635, .30, .05], [9.80, .625, .32, .044], [9.93, .60, .35, .033], [10.07, .57, .38, .025], [10.2, .557, .387, .018]] },
  { slot: [20, 38], keys: [[9.15, .76, -.25, .12], [9.40, .74, 0, .10], [9.47, .74, .05, .08], [9.53, .72, .11, .07], [9.60, .69, .16, .06], [9.73, .65, .23, .05], [9.80, .63, .27, .044], [9.93, .60, .30, .033], [10.07, .585, .34, .025], [10.2, .567, .374, .018]] },
];
const TRACK_BLEND = [10.0, 10.3];
const bboxK = (t) => 1.5 - 0.3 * clamp((t - 9.6) / 0.47);   // tumbling 1.5, squared to camera 1.2

// Early, isolated far bricks of the opening: t, colour, screen x, distance, [vBase, k2].
const EARLY = [
  [0.33, 'W', -0.68, 44], [0.67, 'W', -0.86, 36], [0.80, 'W', -0.06, 23, -12, 0.45], [1.13, 'W', 0.64, 30],
];

// brick modes
const M_STD = 0, M_FLY = 1, M_LAND = 2, M_TRACK = 3;

export function buildChoreography(grid) {
  const rand = rng(0x1e60);
  const flyList = HEROES.filter(([t, , , d]) => !LANDS(t, d));
  const landList = HEROES.filter(([t, , , d]) => LANDS(t, d));
  const nMosaic = N * N, n = nMosaic + flyList.length;
  const P = new Float32Array(n * 3);
  const B = new Float32Array(n * 3);
  const L = new Float32Array(n * 3);
  const H = new Float32Array(n);
  const K1 = new Float32Array(n), K2 = new Float32Array(n), A = new Float32Array(n).fill(T.snap);
  const ROT = new Float32Array(n * 8);   // axis1(3), w1, axis2(3), w2
  const RS = new Float32Array(n * 2);    // rotation ramp start s0, ramp length b
  const J = new Float32Array(n * 7);     // jitter offset(3), jitter axis(3), angle
  const SC = new Float32Array(n * 3);    // late scatter offset (per unit of scatter(s))
  const TL = new Float32Array(n * 3);    // late tilt: horizontal axis (2), amplitude
  const MODE = new Uint8Array(n);
  const FLY = new Float32Array(n * 8);   // fly-by: tIn, Tc, u0, v0, u1, v1, d0, rho
  const LAND = new Float32Array(n * 6);  // landing glide: tIn, tLand, entry u, v, ln(distance), spin
  const color = new Array(n);
  const tIn = new Float32Array(n).fill(-1);
  const hero = new Uint8Array(n);
  const tracks = new Map();
  const CH = { n, nMosaic, P, B, L, H, K1, K2, A, ROT, RS, J, SC, TL, MODE, FLY, LAND, tracks, color, tIn, hero };

  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const id = j * N + i;
    P[id * 3] = i - (N - 1) / 2;
    P[id * 3 + 1] = (N - 1) / 2 - j;
    color[id] = grid[j][i];
  }
  const rowOf = (id) => (id / N) | 0;

  // ---- arrival: everything settles at 11.0 s except a few bricks at the blast centre
  const EPI = [31, 27];
  for (let id = 0; id < nMosaic; id++) {
    const i = id % N, j = rowOf(id);
    const r = Math.hypot(i - EPI[0], j - EPI[1]);
    A[id] = T.snap + (r < 3.2 && rand() < 0.45 ? 0.27 * (1 - r / 3.2) * (0.5 + 0.5 * rand()) : 0);
  }

  // ---- per-brick tumbling / jitter / scatter (independent of how the brick arrives)
  for (let id = 0; id < n; id++) {
    const ax = randomAxis(rand), bx = randomAxis(rand);
    const spin = 1.3 + 1.7 * rand();
    ROT.set([...ax, spin, ...bx, spin * (0.25 + 0.4 * rand())], id * 8);
    // the jitter only tilts (horizontal axis): the bricks stay square to the grid
    const ja = randomAxis(rand), jl = Math.hypot(ja[0], ja[1]) || 1;
    J.set([0.28 * gaussian(rand), 0.28 * gaussian(rand), 0.6 * rand(), ja[0] / jl, ja[1] / jl, 0, 0.3 * gaussian(rand)], id * 7);
    if (id >= nMosaic) continue;
    const px = P[id * 3], py = P[id * 3 + 1], row = rowOf(id);
    const letter = (color[id] === 'W' || color[id] === 'K') && row >= 16 && row <= 42;
    // late scatter: radial (stronger toward the top/bottom red fields), toward the camera, noise
    const r = Math.hypot(px, py) + 1e-6, rn = r / 42, rr = rand();
    // (a few outer bricks form a loose fringe around the square until the last second)
    const fringe = rn > 0.6 && hash01(id * 13 + 5) < 0.12 ? 3 : 1;
    const radial = r * (letter ? 0.012 + 0.01 * rr : 0.007 + 0.03 * rr) * fringe * (0.4 + 0.6 * rn) * (0.7 + 0.6 * Math.abs(py) / 30);
    const nz = letter ? 0.6 : 0.7;
    SC[id * 3] = (px / r) * radial + nz * gaussian(rand);
    SC[id * 3 + 1] = (py / r) * radial + nz * gaussian(rand);
    SC[id * 3 + 2] = rand() * (0.4 + 2.2 * rn);
    const ta = 2 * Math.PI * rand();
    TL.set([Math.cos(ta), Math.sin(ta), 0.12 + 0.38 * rand()], id * 3);
  }

  // ---- fly-bys: extra bricks on scripted screen tracks
  flyList.forEach(([t, c, u, dT], k) => {
    const id = nMosaic + k;
    const d = Math.max(2.0, dT * DIST_K);
    const size = 1.5 / (2 * TAN_V * d);                 // bounding box, in H
    // screen speed grows with size: 2.3 H/s for the 0.28 H brick at 1.2 s, ~5 H/s for giants
    const speed = clamp(2.3 * Math.pow(size / 0.28, 0.7), 1.6, 7) * (0.85 + 0.3 * rand());
    const shrink = t < 3 ? 0.12 * rand() : 0.08 + 0.22 * rand();   // per 15 fps frame
    const rho = -Math.log(1 - shrink) * 15;
    // the transcribed time is when the brick straddles the top edge (half of it in view)
    const v0 = 1, u1 = clamp(u * (0.75 + 0.25 * rand()) + 0.15 * gaussian(rand), -1.3, 1.3);
    const v1 = -1 - size * 1.25 * Math.exp(-rho * 0.25);
    const Tc = (v0 - v1) / 2 / speed;
    FLY.set([t, Tc, u, v0, u1, v1, d, rho], id * 8);
    MODE[id] = M_FLY; color[id] = c; hero[id] = 1; tIn[id] = t;
    ROT[id * 8 + 3] = 2.5 + 2.5 * rand();   // tumble faster near the camera
  });

  // ---- choose the mosaic bricks for the burst bricks that land, and the tracked ones
  const used = new Set();
  const pickNear = (c, u, rows) => {
    let best = -1, bs = -Infinity;
    for (let id = 0; id < nMosaic; id++) {
      const row = rowOf(id);
      if (used.has(id) || color[id] !== c || row < rows[0] || row > rows[1] || A[id] !== T.snap) continue;
      const score = -Math.abs(P[id * 3] / 30 - u * 0.8) + 0.3 * hash01(id * 31 + 7);
      if (score > bs) { bs = score; best = id; }
    }
    if (best < 0) throw new Error(`no free ${c} brick for a landing burst brick`);
    used.add(best);
    return best;
  };
  for (const tr of LATE_TRACKS) {
    const id = tr.slot[0] * N + tr.slot[1];
    if (color[id] !== 'W' || used.has(id)) throw new Error(`late track slot ${tr.slot} is not a free white brick`);
    used.add(id);
    MODE[id] = M_TRACK; hero[id] = 1; tIn[id] = tr.keys[0][0];
    tracks.set(id, {
      u: makeCurve(tr.keys.map((k) => [k[0], 2 * k[1] - 1])),
      v: makeCurve(tr.keys.map((k) => [k[0], 1 - 2 * k[2]])),
      ld: makeCurve(tr.keys.map((k) => [k[0], Math.log((1.207 * bboxK(k[0])) / k[3])])),
    });
  }
  for (const [t, c, u, dT] of landList) {
    const id = pickNear(c, u, c === 'R' ? [3, 15] : [18, 40]);
    const d = dT * DIST_K, tLand = t + 0.8 + 0.4 * rand();
    LAND.set([t, tLand, u, 1 + (1.5 / (2 * TAN_V * d)) * 1.25, Math.log(d), 2 + 2 * rand()], id * 6);
    MODE[id] = M_LAND; hero[id] = 1; tIn[id] = t;
  }

  // ---- entry order for the other mosaic bricks
  const assignments = [];
  for (const [t, c, u, d, vB, k2] of EARLY) {
    let id = -1;
    for (let tries = 0; tries < 400 && id < 0; tries++) {
      const q = (rand() * nMosaic) | 0;
      if (!used.has(q) && color[q] === c && A[q] === T.snap) id = q;
    }
    used.add(id);
    assignments.push({ id, t, u, d, vB, k2, early: true });
  }
  // weighted random order: letters first, bottom red field early (it lands under the
  // letters before they form), top red field late (its paths never cross the letters),
  // and a slice of white kept for a late white stream
  const weight = { W: 3.5, K: 2.6, Y: 1.8, R: 1.6 };
  const rest = [];
  for (let id = 0; id < nMosaic; id++) if (!used.has(id)) {
    const row = rowOf(id), c = color[id];
    const band = row >= 16 && row <= 42 ? 1.6 : 1;
    const field = c === 'R' ? (row > 41 ? 2.2 : row < 16 ? 0.6 : 1) : 1;
    const w = c === 'W' && hash01(id * 23 + 11) < 0.3 ? 0.6 : weight[c];
    rest.push({ id, key: Math.pow(rand(), 1 / (w * band * field)) });
  }
  rest.sort((a, b) => b.key - a.key);
  const invEntered = (k) => { // invert the monotone `entered` curve by bisection
    let lo = 0.3, hi = 8.6;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (entered(m) < k) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  { // re-order the opening (up to 4.0 s) to the colour shares measured in the original
    const pools = { R: [], Y: [], K: [], W: [] }, got = { R: 0, Y: 0, K: 0, W: 0 }, idx = { R: 0, Y: 0, K: 0, W: 0 };
    for (const r of rest) pools[color[r.id]].push(r);
    const merged = [], kEnd = Math.round(entered(4.0)) - EARLY.length;
    for (let k = 0; k < kEnd; k++) {
      const t = invEntered(EARLY.length + k + 1);
      const tgt = { R: OPENING_SHARE.R(t), Y: OPENING_SHARE.Y(t), K: OPENING_SHARE.K(t) };
      tgt.W = Math.max(0, 1 - tgt.R - tgt.Y - tgt.K);
      let best = null, bd = -Infinity;
      for (const c of ['W', 'K', 'R', 'Y']) {
        if (idx[c] >= pools[c].length) continue;
        const d = tgt[c] * (k + 1) - got[c];
        if (d > bd) { bd = d; best = c; }
      }
      merged.push(pools[best][idx[best]++]); got[best]++;
    }
    const taken = new Set(merged.map((r) => r.id));
    for (const r of rest) if (!taken.has(r.id)) merged.push(r);
    rest.length = 0; rest.push(...merged);
  }
  rest.forEach((r, k) => assignments.push({ id: r.id, t: invEntered(EARLY.length + k + 1) }));

  // ---- per-brick reversed-explosion paths for the mosaic bricks
  const w1 = [0, 0, 0], w2 = [0, 0, 0], pos = new Float32Array(3), qt = new Float32Array(4);
  for (const a of assignments) {
    const id = a.id, c = color[id];
    const px = P[id * 3], py = P[id * 3 + 1];
    const row = rowOf(id);
    const letter = (c === 'W' || c === 'K') && row >= 16 && row <= 42;

    K1[id] = 0.12 + 0.2 * rand() + (letter ? 0.07 : 0);
    K2[id] = 0.35 + 0.35 * rand() + (letter ? 0.12 : 0);
    // bricks below the letters hover in front of the plane and settle last
    H[id] = row > 41 ? (8 + 22 * rand()) * clamp(1.4 - (row - 42) / 30) : 2 * rand();
    RS[id * 2] = (c === 'R' ? 2.4 : 1.8) + 1.2 * rand();
    RS[id * 2 + 1] = 1.5 + rand();

    // When is this brick's own slot inside the frame (camera pulls back)?
    let tIn0 = a.t;
    const slotVisible = (t) => {
      const s = worldToScreen(px, py, 0, t);
      return Math.abs(s[0]) < 1 && Math.abs(s[1]) < 1;
    };
    let mode = 'fall';
    if (!a.early && !slotVisible(tIn0) && py > 0) {
      // top-of-logo bricks: they come into view as the camera dollies back
      let t = tIn0;
      while (t < T.snap && !slotVisible(t)) t += 0.05;
      tIn0 = Math.max(tIn0, t - 0.6 - 0.6 * rand());
      mode = 'drop';
    }
    tIn[id] = tIn0;
    const s1 = A[id] - tIn0;
    const drift = 0.12 * gaussian(rand);

    if (mode === 'drop') {
      // fall in from above onto the slot (lift only, small sideways/depth offset)
      const s4 = Math.max(0.5, Math.min(4, s1)), f1 = F(K1[id], s4), f2 = F(K2[id], s4);
      const lift = 5 + 8 * rand();
      L.set([(drift * lift) / f2, lift / f2, (0.15 * lift) / f2], id * 3);
      B.set([(1.5 * gaussian(rand)) / f1, (1.5 * gaussian(rand)) / f1, (1 + 3 * rand()) / f1], id * 3);
      continue;
    }

    // Entry waypoint: screen (u1, v1) on the frame edge at distance d1 from the camera.
    // beta = share of the depth carried by the slow (blast) component: high beta = the
    // brick keeps its size for a while (opening), low = recedes at once. A brick entering
    // at the top edge is held up by a positive lift that decays after entry, so it falls
    // toward vBase; a brick entering at a side/bottom edge sweeps in toward `base`.
    const cam1 = cameraAt(tIn0);
    const slot = worldToScreen(px, py, 0, tIn0);
    const r1 = rand(), r2 = rand(), gd = gaussian(rand), gu = gaussian(rand);
    let u1, v1 = 1.06, d1, beta, vBase, base = null;
    if (a.early) {
      u1 = a.u; d1 = a.d; beta = 0.9;
      vBase = a.vB ?? -1.2 - 1.5 * r2;
      K2[id] = a.k2 ?? 0.3 + 0.2 * r1;
    } else {
      // red bricks fly close to the camera only once the swarm is dense (they dominate it
      // by area from ~4.5 s); the others shrink to mid-field size as the swarm thickens
      const nearR = tIn0 < 4 ? 1.8 : tIn0 < 4.8 ? lerp(1.8, 0.85, (tIn0 - 4) / 0.8) : 0.85 + 0.55 * clamp((tIn0 - 4.8) / 1.5);
      const kk = c === 'R' ? 0 : clamp((tIn0 - 4.6) / 0.8);
      const near = c === 'R' ? nearR : { W: 1.12, K: 1.15, Y: 1.15 }[c];
      d1 = clamp((19 + 7 * kk) * near * Math.exp((0.45 - 0.15 * kk) * gd) * (1 + 0.08 * (tIn0 - 1)), 6 + 5 * kk, cam1.z * 0.97);
      u1 = clamp(slot[0] * 1.15 + 0.45 * gu, -1.15, 1.15);
      // the opening falls fast (0.6-0.9 H/s), the swarm later drifts in more slowly
      const w = tIn0 < 2.3 ? 0 : clamp((4.8 - tIn0) / 1.3);
      beta = lerp(0.5 + 0.4 * r1, 0.2 + 0.3 * r1, w);
      vBase = lerp(-1.0 - 2.0 * r2, -2.0 - 1.5 * r2, w);
      K2[id] = lerp(K2[id], 0.6 + 0.5 * (K2[id] - 0.35) / 0.35, w);
      // from ~4.4 s bricks also come in from the sides and from below, beyond their slot
      // as seen from the logo centre (the reversed explosion converges from all around)
      if (hash01(id * 7 + 3) < clamp((tIn0 - 4.4) / 0.8)) {
        const du = slot[0] - SHIFT_U, dv = slot[1] - SHIFT_V;
        const uE = SHIFT_U + 3 * du + 0.3 * gaussian(rand), vE = SHIFT_V + 3 * dv + 0.4 + 0.6 * rand();
        const m = Math.max(Math.abs(uE) / 1.08, Math.abs(vE) / 1.06);
        if (vE / m < 1.05) {
          u1 = uE / m; v1 = vE / m;
          let bu = slot[0] + 0.08 * gaussian(rand);
          let bv = slot[1] - 0.2 - 0.6 * rand() * clamp((8 - tIn0) / 2.5);
          if (v1 <= -1.05) bv = Math.max(bv, -0.6);       // keep the fast vector pointing out through the edge
          if (Math.abs(u1) >= 1.07) bu = Math.sign(u1) * Math.min(Math.abs(bu), 0.62);
          base = [bu, bv];
        }
      }
    }

    const solve = () => {
      const W1 = screenToWorld(u1, v1, d1, tIn0, w1);
      const f1 = F(K1[id], s1), f2 = F(K2[id], s1), sc1 = scatter(s1), hv = hover(s1);
      // the jitter is part of the position: take it out of the blast component so the
      // brick passes exactly through its waypoint
      const ja = jitterAmp(s1), jx = J[id * 7] * ja, jy = J[id * 7 + 1] * ja, jz = J[id * 7 + 2] * ja;
      // depth: both components >= 0, so no brick ever ends up behind the logo plane
      let extra = H[id] * hv + SC[id * 3 + 2] * sc1 + jz;
      if (extra > W1[2] * 0.8) {
        const k = (W1[2] * 0.8) / (H[id] * hv + SC[id * 3 + 2] * sc1);
        H[id] *= k; SC[id * 3 + 2] *= k; extra = H[id] * hv + SC[id * 3 + 2] * sc1 + jz;
      }
      const rz = W1[2] - extra;
      B[id * 3 + 2] = (beta * rz) / f1;
      L[id * 3 + 2] = ((1 - beta) * rz) / f2;
      const ox = px + SC[id * 3] * sc1 + jx, oy = py + SC[id * 3 + 1] * sc1 + jy;
      if (base) {
        // side/bottom entry: the fast component sweeps in from the edge toward `base`
        const Wr = screenToWorld(base[0], base[1], d1, tIn0, w2);
        L[id * 3] = (W1[0] - Wr[0]) / f2; B[id * 3] = (Wr[0] - ox) / f1;
        L[id * 3 + 1] = (W1[1] - Wr[1]) / f2; B[id * 3 + 1] = (Wr[1] - oy) / f1;
      } else {
        // top entry: baseline (blast) + positive lift that holds the brick up until it enters
        const Wb = screenToWorld(u1, vBase, d1, tIn0, w2);
        const lift = Math.max(0.5, W1[1] - Wb[1]);
        L[id * 3 + 1] = lift / f2;
        B[id * 3 + 1] = (W1[1] - lift - oy) / f1;
        L[id * 3] = (drift * lift) / f2;
        B[id * 3] = (W1[0] - drift * lift - ox) / f1;
      }
    };
    // Guard: before its entry time the brick must not already be on screen
    const visibleEarly = () => {
      for (let ss = s1 + 0.07; ss <= s1 + 2.5; ss += 0.07) {
        evalBrick(CH, id, A[id] - ss, pos, qt);
        const sc = worldToScreen(pos[0], pos[1], pos[2], A[id] - ss);
        if (onScreen(sc[0], sc[1], sc[2])) return true;
      }
      return false;
    };
    solve();
    if (!a.early && visibleEarly()) {
      if (base) { base = null; v1 = 1.06; u1 = clamp(slot[0] * 1.15 + 0.45 * gu, -1.15, 1.15); solve(); }
      for (let k = 0; k < 3 && visibleEarly(); k++) { d1 = Math.min(d1 * 1.5, cam1.z * 0.97); solve(); }
    }
  }

  return CH;
}

function randomAxis(rand) {
  const z = 2 * rand() - 1, a = 2 * Math.PI * rand(), r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
}

// Smooth ramp: 0 until s0, quadratic ease over b, then linear (C1 continuous).
function ramp(s, s0, b) {
  const x = s - s0;
  if (x <= 0) return 0;
  return x < b ? (x * x) / (2 * b) : x - b / 2;
}

const PARKED_Z = 1e4;   // far behind the camera: invisible
const _w = [0, 0, 0], _s = [0, 0, 0];

// Evaluate brick `id` at video time t. Writes position (3) and quaternion (4, xyzw).
export function evalBrick(ch, id, t, pos, quat, pi = 0, qi = 0) {
  const mode = ch.MODE[id];
  if (mode === M_FLY) return evalFlyBy(ch, id, t, pos, quat, pi, qi);

  const s = Math.max(0, ch.A[id] - t);
  const i3 = id * 3, j7 = id * 7;
  const ja = jitterAmp(s), sc = scatter(s);
  // the settled part: slot + late scatter + jitter
  let x = ch.P[i3] + ch.SC[i3] * sc + ch.J[j7] * ja;
  let y = ch.P[i3 + 1] + ch.SC[i3 + 1] * sc + ch.J[j7 + 1] * ja;
  let z = ch.SC[i3 + 2] * sc + ch.J[j7 + 2] * ja;
  let g = 0;   // tumble amount
  if (mode === M_STD) {
    const f1 = F(ch.K1[id], s), f2 = F(ch.K2[id], s);
    x += ch.B[i3] * f1 + ch.L[i3] * f2;
    y += ch.B[i3 + 1] * f1 + ch.L[i3 + 1] * f2;
    z += ch.H[id] * hover(s) + ch.B[i3 + 2] * f1 + ch.L[i3 + 2] * f2;
    g = ramp(s, ch.RS[id * 2], ch.RS[id * 2 + 1]);
  } else if (mode === M_LAND) {
    // glide in from above the frame onto the settling slot: screen position eases out,
    // the distance grows steadily (log-linear), like the original's last bricks
    const l6 = id * 6, t0 = ch.LAND[l6], t1 = ch.LAND[l6 + 1];
    const p = (t - t0) / (t1 - t0);
    if (p < -0.4) { parkAt(pos, quat, pi, qi); return s; }
    if (p < 1) {
      const sl = worldToScreen(x, y, z, t, _s);
      const e = p < 0 ? 2 * p : 1 - (1 - p) * (1 - p);
      const q = screenToWorld(lerp(ch.LAND[l6 + 2], sl[0], e), lerp(ch.LAND[l6 + 3], sl[1], e),
        Math.exp(lerp(ch.LAND[l6 + 4], Math.log(sl[2]), p)), t, _w);
      x = q[0]; y = q[1]; z = q[2];
      g = (ch.LAND[l6 + 5] * (1 - e) * (t1 - t0) * 0.5) / ch.ROT[id * 8 + 3];
    }
  } else if (mode === M_TRACK && t < TRACK_BLEND[1]) {
    // measured screen track, blended into the slot path at the end
    const tr = ch.tracks.get(id);
    const q = screenToWorld(tr.u(t), tr.v(t), Math.exp(tr.ld(t)), t, _w);
    const w = smoothstep((t - TRACK_BLEND[0]) / (TRACK_BLEND[1] - TRACK_BLEND[0]));
    x = q[0] + (x - q[0]) * w; y = q[1] + (y - q[1]) * w; z = q[2] + (z - q[2]) * w;
    g = (1 - w) * Math.max(0, TRACK_BLEND[1] - t) * 1.5;
  }
  pos[pi] = x; pos[pi + 1] = y; pos[pi + 2] = z;

  const r8 = id * 8;
  const a1 = ch.ROT[r8 + 3] * g, a2 = ch.ROT[r8 + 7] * g, aj = ch.J[j7 + 6] * ja;
  // q = tumble1 * tumble2 * late tilt * jitter
  let q = axisAngle(ch.ROT[r8], ch.ROT[r8 + 1], ch.ROT[r8 + 2], a1);
  q = qmul(q, axisAngle(ch.ROT[r8 + 4], ch.ROT[r8 + 5], ch.ROT[r8 + 6], a2));
  q = qmul(q, axisAngle(ch.TL[i3], ch.TL[i3 + 1], 0, (ch.TL[i3 + 2] * sc) / 2.1));
  q = qmul(q, axisAngle(ch.J[j7 + 3], ch.J[j7 + 4], ch.J[j7 + 5], aj));
  quat[qi] = q[0]; quat[qi + 1] = q[1]; quat[qi + 2] = q[2]; quat[qi + 3] = q[3];
  return s;
}

// Fly-by: straight screen-space crossing from the top edge to the bottom edge,
// receding (shrinking) at a constant rate, tumbling; parked out of sight otherwise.
function evalFlyBy(ch, id, t, pos, quat, pi, qi) {
  const f8 = id * 8, t0 = ch.FLY[f8], Tc = ch.FLY[f8 + 1];
  const p = (t - t0) / Tc;
  if (p < -0.8 || p > 1.8) { parkAt(pos, quat, pi, qi); return 1; }
  const u = lerp(ch.FLY[f8 + 2], ch.FLY[f8 + 4], p), v = lerp(ch.FLY[f8 + 3], ch.FLY[f8 + 5], p);
  // recede from the moment of entry; before it, a soft (C1) clamp keeps the size steady
  const x = t - t0, dt = x >= 0 ? x : -0.05 * (1 - Math.exp(x / 0.05));
  const d = ch.FLY[f8 + 6] * Math.exp(ch.FLY[f8 + 7] * dt);
  const w = screenToWorld(u, v, d, t, _w);
  pos[pi] = w[0]; pos[pi + 1] = w[1]; pos[pi + 2] = w[2];
  const r8 = id * 8, a = ch.ROT[r8 + 3] * (t - t0) + 7 * ch.ROT[r8 + 7];
  let q = axisAngle(ch.ROT[r8], ch.ROT[r8 + 1], ch.ROT[r8 + 2], a);
  q = qmul(q, axisAngle(ch.ROT[r8 + 4], ch.ROT[r8 + 5], ch.ROT[r8 + 6], 0.4 * a));
  quat[qi] = q[0]; quat[qi + 1] = q[1]; quat[qi + 2] = q[2]; quat[qi + 3] = q[3];
  return 1;
}

function parkAt(pos, quat, pi, qi) {
  pos[pi] = 0; pos[pi + 1] = 0; pos[pi + 2] = PARKED_Z;
  quat[qi] = 0; quat[qi + 1] = 0; quat[qi + 2] = 0; quat[qi + 3] = 1;
}

function axisAngle(x, y, z, a) {
  const s = Math.sin(a / 2);
  return [x * s, y * s, z * s, Math.cos(a / 2)];
}

function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
