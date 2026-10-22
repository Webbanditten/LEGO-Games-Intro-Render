// The whole intro as pure, deterministic math (no three.js, no DOM), so the
// browser and the node analysis tools evaluate exactly the same motion.
//
// The swarm is a *reversed explosion*: every brick is one of the 60x60 logo
// bricks. In "forward" (explosion) time s = A_i - t the bricks leave the logo
// from rest, accelerating along
//
//   pos(s) = slot + z*H*hover(s) + B*F(k1, s) + L*F(k2, s) + jitter
//   F(k, s) = (e^(ks) - 1 - ks) / (e^(10k) - 1 - 10k)        (F(k,10) = 1)
//
// Played backwards (video time t), the bricks rain down from above / from
// behind the camera, decelerate and settle into the mosaic, which is exactly
// what the original LEGO Media intro shows. B and L are solved per brick from
// screen-space waypoints (where/when/how big a brick enters the frame), which
// lets the timing of the original (counts, sizes, fly-bys) be matched directly.

import { makeCurve, clamp, rng, gaussian, smoothstep } from './curves.js';

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
  snap: 11.0,        // last jitter vanishes, mosaic complete
  xfadeStart: 11.2,  // stud mosaic -> flat logo dissolve (smoothstep)
  xfadeDur: 0.9,
  moveStart: 13.03,  // flat logo shrinks/moves left (linear)
  moveDur: 0.44,
  mediaStart: 13.56, // "LEGO Media" mark zooms in about the frame centre
};

// Camera: static at half distance, then dollies straight back and stops dead at 11 s.
const dolly = makeCurve([
  [6.5, 0.5], [7.27, 0.565], [7.93, 0.625], [8.6, 0.7], [9.27, 0.79],
  [9.93, 0.875], [10.6, 0.96], [11.0, 1.0], [11.35, 1.0],   // last key: ease to rest at 11.0
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

const F = (k, s) => (Math.exp(k * s) - 1 - k * s) / (Math.exp(10 * k) - 1 - 10 * k);
const hover = (s) => 1 - Math.exp(-(s / 1.5) * (s / 1.5));
const SETTLE = 0.4;
// Late scatter: the cloud is still loose 1-2 s before the snap (outer bricks pushed out,
// toward the camera and tilted). Grows like s^1.8 near the end, bounded early on.
const scatter = (s) => Math.pow(s, 1.8) / (1 + Math.pow(s / 2.5, 1.8));

// Number of bricks that have entered the frame by time t (fitted to brick counts in the video).
const entered = makeCurve([
  [0.30, 0], [0.33, 1], [0.70, 2], [0.85, 3], [1.15, 4], [1.22, 9], [1.6, 18], [2.0, 34],
  [2.6, 64], [3.0, 92], [3.4, 132], [3.8, 205], [4.2, 310], [4.6, 400], [4.9, 490],
  [5.5, 820], [6.0, 1250], [6.5, 1900], [7.0, 2550], [7.5, 3050], [8.0, 3350], [8.6, 3500],
]);

// Near-camera "hero" bricks, transcribed from the original (time, colour, screen x,
// distance at entry in brick widths). Size on screen ~ 1.2/d of the frame height.
const HEROES = [
  [1.20, 'R', 0.56, 4.3], [1.20, 'K', -0.72, 4.3], [1.22, 'W', -0.95, 8],
  [1.68, 'R', 0.40, 8], [1.80, 'R', 0.15, 7], [1.84, 'R', 0.45, 9], [1.88, 'R', 0.30, 6],
  [1.95, 'Y', -0.40, 6.3], [2.10, 'R', 0.55, 7], [2.15, 'Y', -0.30, 5.5], [2.30, 'R', 0.25, 6],
  [2.60, 'R', -1.0, 6], [2.67, 'Y', 1.08, 7], [3.00, 'R', -0.85, 2.1], [3.30, 'R', 0.35, 4.5],
  [3.55, 'R', -0.55, 2.2], [3.65, 'R', -0.35, 1.6], [3.80, 'R', 0.62, 3.3],
  [3.93, 'R', 0.10, 2.0], [3.95, 'R', -0.25, 2.1], [4.25, 'R', 0.75, 3.5],
  [4.47, 'K', -0.70, 2.4], [4.60, 'R', -0.80, 4.0], [4.62, 'R', 0.85, 3.2],
  [4.73, 'R', 0.45, 2.2], [4.75, 'R', 0.20, 3.0], [4.95, 'R', 0.85, 1.7],
  [5.07, 'R', 0.40, 1.9], [5.20, 'R', 0.37, 7.5], [5.40, 'R', -0.70, 2.2],
  [5.65, 'R', 0.10, 3.0], [5.80, 'K', 0.45, 3.6], [6.00, 'R', -0.45, 2.6],
  [6.20, 'R', 0.55, 2.7], [6.21, 'R', 0.62, 2.7], [6.53, 'R', 0.15, 3.5],
  [6.80, 'R', -0.60, 2.8], [7.07, 'R', 0.30, 1.8], [7.40, 'R', 0.70, 3.0],
  [7.73, 'R', 0.0, 1.0], [7.75, 'W', -0.33, 4.0], [7.80, 'W', -0.10, 9], [7.82, 'W', 0.05, 11],
  [7.85, 'K', -0.20, 10], [7.87, 'R', -0.07, 2.8], [8.00, 'K', -0.85, 1.4],
  [8.05, 'W', -0.90, 1.3], [8.05, 'K', 0.70, 3.5], [8.20, 'K', -0.08, 12],
  [8.45, 'R', 0.60, 7], [8.55, 'R', 0.82, 7], [8.65, 'R', -0.75, 8],
  [8.85, 'W', -0.44, 2.5], [8.86, 'W', 0.46, 2.4], [8.95, 'W', 0.0, 4.8],
  [8.97, 'K', -0.76, 6], [9.05, 'K', -0.40, 1.5], [9.10, 'W', -0.05, 1.9],
  [9.12, 'W', 0.35, 3.8], [9.18, 'W', 0.50, 2.7], [9.25, 'W', 0.02, 5.5], [9.27, 'W', 0.65, 4.5],
];

// Early, isolated far bricks of the opening (t, colour, screen x, distance).
const EARLY = [
  [0.33, 'W', -0.68, 26], [0.67, 'W', -0.86, 24], [0.80, 'W', -0.06, 15], [1.13, 'W', 0.64, 22],
];

export function buildChoreography(grid) {
  const rand = rng(0x1e60);
  const n = N * N;
  const P = new Float32Array(n * 3);
  const B = new Float32Array(n * 3);
  const L = new Float32Array(n * 3);
  const H = new Float32Array(n);
  const K1 = new Float32Array(n), K2 = new Float32Array(n), A = new Float32Array(n);
  const ROT = new Float32Array(n * 8);   // axis1(3), w1, axis2(3), w2
  const RS = new Float32Array(n * 2);    // rotation ramp start s0, ramp length b
  const J = new Float32Array(n * 7);     // jitter offset(3), jitter axis(3), angle
  const SC = new Float32Array(n * 3);    // late scatter offset (per unit of scatter(s))
  const TL = new Float32Array(n * 3);    // late tilt: horizontal axis (2), amplitude
  const color = new Array(n);
  const tIn = new Float32Array(n).fill(-1);
  const hero = new Uint8Array(n);

  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const id = j * N + i;
    P[id * 3] = i - (N - 1) / 2;
    P[id * 3 + 1] = (N - 1) / 2 - j;
    color[id] = grid[j][i];
  }

  // ---- arrival: everything snaps at 11.0 s except a few bricks at the blast centre
  const EPI = [31, 27];
  for (let id = 0; id < n; id++) {
    const i = id % N, j = (id / N) | 0;
    const r = Math.hypot(i - EPI[0], j - EPI[1]);
    A[id] = T.snap + (r < 3.2 && rand() < 0.45 ? 0.27 * (1 - r / 3.2) * (0.5 + 0.5 * rand()) : 0);
  }

  // ---- pick hero bricks (near-camera fly-bys) from the right colours/regions
  const used = new Set();
  const pick = (c, pref) => {
    let best = -1, bestScore = -1;
    for (let tries = 0; tries < 400; tries++) {
      const id = (rand() * n) | 0;
      if (used.has(id) || color[id] !== c) continue;
      const score = pref(id) + rand() * 0.5;
      if (score > bestScore) { best = id; bestScore = score; }
    }
    used.add(best);
    return best;
  };
  const rowOf = (id) => (id / N) | 0;
  const assignments = [];
  for (const [t, c, u, d] of HEROES) {
    // red heroes come from the lower red field, white/black from the letters
    const id = pick(c, (q) => (c === 'R' ? rowOf(q) / N : 1 - Math.abs(rowOf(q) - 29) / 30));
    assignments.push({ id, t, u, d, hero: true });
  }
  for (const [t, c, u, d] of EARLY) assignments.push({ id: pick(c, () => 1), t, u, d, hero: false, early: true });
  for (const a of assignments) used.add(a.id);

  // ---- entry order for everybody else: weighted random order, letters first
  const weight = { W: 6, K: 2.6, Y: 1.8, R: 1.6 };
  const rest = [];
  for (let id = 0; id < n; id++) if (!used.has(id)) {
    const row = rowOf(id);
    const band = row >= 16 && row <= 42 ? 1.6 : 1;   // the letter band arrives first
    rest.push({ id, key: Math.pow(rand(), 1 / (weight[color[id]] * band)) });
  }
  rest.sort((a, b) => b.key - a.key);
  const invEntered = (k) => { // invert the monotone `entered` curve by bisection
    let lo = 0.3, hi = 8.6;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (entered(m) < k) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const offset = EARLY.length; // heroes are extra, on top of the entry curve
  rest.forEach((r, k) => assignments.push({ id: r.id, t: invEntered(offset + k + 1), hero: false }));

  // ---- per-brick dynamics
  const w1 = [0, 0, 0], w2 = [0, 0, 0];
  for (const a of assignments) {
    const id = a.id;
    const px = P[id * 3], py = P[id * 3 + 1];
    const row = rowOf(id);
    hero[id] = a.hero ? 1 : 0;

    K1[id] = a.hero ? 0.12 + 0.12 * rand() : 0.12 + 0.2 * rand();
    K2[id] = a.hero ? 0.75 + 0.35 * rand() : 0.35 + 0.35 * rand();

    // bricks below the letters hover in front of the plane and settle last
    H[id] = row > 41 && !a.hero ? (8 + 22 * rand()) * clamp(1.4 - (row - 42) / 30) : 2 * rand();
    // late scatter: radial (stronger toward the top/bottom red fields), toward the camera, noise
    const r = Math.hypot(px, py) + 1e-6, rn = r / 42;
    const radial = r * (0.02 + 0.085 * rand()) * (0.4 + 0.6 * rn) * (0.7 + 0.6 * Math.abs(py) / 30);
    SC[id * 3] = (px / r) * radial + 0.35 * gaussian(rand);
    SC[id * 3 + 1] = (py / r) * radial + 0.35 * gaussian(rand);
    SC[id * 3 + 2] = rand() * (0.4 + 2.2 * rn);
    const ta = 2 * Math.PI * rand();
    TL.set([Math.cos(ta), Math.sin(ta), 0.08 + 0.25 * rand()], id * 3);

    // When is this brick's own slot inside the frame (camera pulls back)?
    let tIn0 = a.t;
    const slotVisible = (t) => {
      const sc = worldToScreen(px, py, 0, t);
      return Math.abs(sc[0]) < 1 && Math.abs(sc[1]) < 1;
    };
    let mode = 'fall';
    if (!a.hero && !a.early && !slotVisible(tIn0) && py > 0) {
      // top-of-logo bricks: they come into view as the camera dollies back
      let t = tIn0;
      while (t < T.snap && !slotVisible(t)) t += 0.05;
      tIn0 = Math.max(tIn0, t - 0.6 - 0.6 * rand());
      mode = 'drop';
    }
    tIn[id] = tIn0;
    const s1 = A[id] - tIn0;

    // Entry waypoint: screen x u1, just above the top edge, at distance d1 from the
    // camera. beta = share of the depth carried by the slow (blast) component: high
    // beta = the brick keeps its size for a while (opening), low = recedes at once.
    // vBase = where the brick would be on screen without the lift; the lift decays
    // after entry, so the brick falls toward vBase (heroes: far below the frame).
    let u1, d1, beta, vBase, drift;
    const cam1 = cameraAt(tIn0);
    if (a.hero) {
      u1 = a.u; d1 = a.d;
      beta = 0.15 + 0.25 * rand();
      vBase = -(3 + 5 * rand()) * (1 + 1.5 / d1);
      drift = 0.25 * gaussian(rand);
    } else if (a.early) {
      u1 = a.u; d1 = a.d;
      beta = 0.9;
      vBase = -1.2 - 1.5 * rand();
      drift = 0.08 * gaussian(rand);
      K2[id] = 0.3 + 0.2 * rand();
    } else {
      const slot = worldToScreen(px, py, 0, tIn0);
      if (mode === 'drop') {
        d1 = cam1.z * (0.8 + 0.15 * rand());
        u1 = clamp(slot[0] + 0.08 * gaussian(rand), -1, 1);
        beta = 0.85;
        vBase = 0.2 + 0.5 * rand();
        drift = 0.05 * gaussian(rand);
      } else {
        // typical depth at entry ~17-25 brick widths (0.05-0.07 H), log-normal spread
        // red bricks fly closer to the camera (they dominate the frame by area)
        // (early on only: later the white letter core must stay visible behind them)
        const near = color[id] === 'R' ? 0.72 + 0.35 * clamp((tIn0 - 4) / 2.5) : { W: 1.12, K: 1.0, Y: 0.95 }[color[id]];
        d1 = clamp(19 * near * Math.exp(0.45 * gaussian(rand)) * (1 + 0.08 * (tIn0 - 1)), 6, cam1.z * 0.97);
        u1 = clamp(slot[0] * 1.15 + 0.45 * gaussian(rand), -1.15, 1.15);
        beta = 0.5 + 0.4 * rand();
        vBase = -1.0 - 2.0 * rand();
        drift = 0.12 * gaussian(rand);
      }
    }
    if (mode === 'drop') {
      // Top-of-logo bricks are out of frame until the camera pulls back: they simply
      // fall in from above onto their slot (lift only, small sideways/depth offset).
      const s4 = Math.max(0.5, Math.min(4, s1)), f1 = F(K1[id], s4), f2 = F(K2[id], s4);
      const lift = 5 + 8 * rand();
      L.set([(drift * lift) / f2, lift / f2, (0.15 * lift) / f2], id * 3);
      B.set([(1.5 * gaussian(rand)) / f1, (1.5 * gaussian(rand)) / f1, (1 + 3 * rand()) / f1], id * 3);
    } else {
    const v1 = 1.0 + (a.hero ? 0.6 / d1 : 0.06);   // just above the top edge
    const W1 = screenToWorld(u1, v1, d1, tIn0, w1);
    const Wb = screenToWorld(u1, vBase, d1, tIn0, w2);
    const f1 = F(K1[id], s1), f2 = F(K2[id], s1), sc1 = scatter(s1);
    // depth: both components >= 0, so no brick ever ends up behind the logo plane
    const hv = hover(s1);
    if (H[id] * hv + SC[id * 3 + 2] * sc1 > W1[2] * 0.8) {
      const k = (W1[2] * 0.8) / (H[id] * hv + SC[id * 3 + 2] * sc1);
      H[id] *= k; SC[id * 3 + 2] *= k;
    }
    const rz = W1[2] - H[id] * hv - SC[id * 3 + 2] * sc1;
    B[id * 3 + 2] = (beta * rz) / f1;
    L[id * 3 + 2] = ((1 - beta) * rz) / f2;
    // height: baseline (blast) + positive lift that holds the brick up until it enters
    const lift = Math.max(0.5, W1[1] - Wb[1]);
    L[id * 3 + 1] = lift / f2;
    B[id * 3 + 1] = (W1[1] - lift - py - SC[id * 3 + 1] * sc1) / f1;
    // sideways: mostly blast, the lift drifts a little
    L[id * 3] = (drift * lift) / f2;
    B[id * 3] = (W1[0] - drift * lift - px - SC[id * 3] * sc1) / f1;
    }

    // tumbling: random axes, aligned (studs to camera) before arriving
    const ax = randomAxis(rand), bx = randomAxis(rand);
    const spin = a.hero ? 2.5 + 2.5 * rand() : 1.3 + 1.7 * rand();
    ROT.set([...ax, spin, ...bx, spin * (0.25 + 0.4 * rand())], id * 8);
    RS[id * 2] = a.hero ? 0.4 + 0.6 * rand() : (color[id] === 'R' ? 2.4 : 1.8) + 1.2 * rand();
    RS[id * 2 + 1] = 1.5 + rand();

    // small last-moment misalignment that snaps away at the end
    const ja = randomAxis(rand);
    J.set([0.2 * gaussian(rand), 0.2 * gaussian(rand), 0.6 * rand(), ...ja, 0.25 * gaussian(rand)], id * 7);
  }

  return { n, P, B, L, H, K1, K2, A, ROT, RS, J, SC, TL, color, tIn, hero };
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

// Evaluate brick `id` at video time t. Writes position (3) and quaternion (4, xyzw).
export function evalBrick(ch, id, t, pos, quat, pi = 0, qi = 0) {
  const s = Math.max(0, ch.A[id] - t);
  const i3 = id * 3;
  if (s === 0) {
    pos[pi] = ch.P[i3]; pos[pi + 1] = ch.P[i3 + 1]; pos[pi + 2] = 0;
    quat[qi] = 0; quat[qi + 1] = 0; quat[qi + 2] = 0; quat[qi + 3] = 1;
    return 0;
  }
  const f1 = F(ch.K1[id], s), f2 = F(ch.K2[id], s), h = ch.H[id] * hover(s), sc = scatter(s);
  // The original drops the last misalignment in a single 15 fps frame; at 60 fps that
  // reads as a jolt, so the bricks ease into place over the final SETTLE seconds.
  const jamp = (0.6 + 0.4 * Math.min(1, s / 2)) * smoothstep(s / SETTLE);
  const j7 = id * 7;
  pos[pi] = ch.P[i3] + ch.B[i3] * f1 + ch.L[i3] * f2 + ch.SC[i3] * sc + ch.J[j7] * jamp;
  pos[pi + 1] = ch.P[i3 + 1] + ch.B[i3 + 1] * f1 + ch.L[i3 + 1] * f2 + ch.SC[i3 + 1] * sc + ch.J[j7 + 1] * jamp;
  pos[pi + 2] = h + ch.B[i3 + 2] * f1 + ch.L[i3 + 2] * f2 + ch.SC[i3 + 2] * sc + ch.J[j7 + 2] * jamp;

  const r8 = id * 8, rs = ch.RS[id * 2], rb = ch.RS[id * 2 + 1];
  const g = ramp(s, rs, rb);
  const a1 = ch.ROT[r8 + 3] * g, a2 = ch.ROT[r8 + 7] * g, aj = ch.J[j7 + 6] * jamp;
  // q = tumble1 * tumble2 * late tilt * jitter
  let q = axisAngle(ch.ROT[r8], ch.ROT[r8 + 1], ch.ROT[r8 + 2], a1);
  q = qmul(q, axisAngle(ch.ROT[r8 + 4], ch.ROT[r8 + 5], ch.ROT[r8 + 6], a2));
  q = qmul(q, axisAngle(ch.TL[i3], ch.TL[i3 + 1], 0, (ch.TL[i3 + 2] * sc) / 2.1));
  q = qmul(q, axisAngle(ch.J[j7 + 3], ch.J[j7 + 4], ch.J[j7 + 5], aj));
  quat[qi] = q[0]; quat[qi + 1] = q[1]; quat[qi + 2] = q[2]; quat[qi + 3] = q[3];
  return s;
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
