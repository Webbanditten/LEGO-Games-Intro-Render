// The whole intro as pure, deterministic math (no three.js, no DOM), so the
// browser and the node analysis tools evaluate exactly the same motion.
//
// The swarm is a *reversed explosion*: every brick of the 60x60 logo leaves its
// slot from rest in "forward" (explosion) time s = A_i - t, accelerating along
//
//   pos(s) = slot + z*H*hover(s) + B*F(k1, s) + L*F(k2, s) + GY*Gs(s) + SC*scatter(s) + jitter
//   F(k, s) = (e^(ks) - 1 - ks) / (e^(10k) - 1 - 10k)        (F(k,10) = 1)
//   Gs(s)   = smoothstep((s - 1.6) / 2.4)                     (1 for s >= 4, 0 for s <= 1.6)
//
// Played backwards (video time t), the bricks rain down from above / come in from
// the sides, decelerate and settle into the mosaic, which is exactly what the
// original LEGO Media intro shows. B and L are solved per brick from screen-space
// waypoints (where/when/how big a brick enters the frame), which lets the timing
// of the original (counts, sizes, directions) be matched directly. Bricks of the swarm
// fall *past* their slot (they rain through the frame and out at the bottom, as in the
// original); GY takes them back to their slot (mostly up; a few letters and early bottom-field
// bricks overshoot less than their slot and come down), but only while the camera pulls back (s = 4 .. 1.6,
// i.e. 7.0-9.4 s), where it reads as part of the convergence instead of as bricks hanging mid-frame.
//
// On top of the mosaic bricks there are a few dozen near-camera "fly-by" bricks.
// They follow scripted screen-space tracks transcribed from the original (time,
// place, size, speed) and leave the frame for good, so they are extra bricks that
// park out of sight afterwards. The bricks of the late bursts that land (in the letters or
// the red fields) are mosaic bricks gliding into their slots.

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

// Camera: at half distance until 6 s, then dollies straight back (eased in from rest, see
// fromRest; the measured keys hold from 7.0 s), easing to rest at 11 s.
const dollyKeys = makeCurve([
  [6.5, 0.5], [7.27, 0.565], [7.93, 0.625], [8.6, 0.72], [9.27, 0.815],
  [9.93, 0.895], [10.6, 0.97], [11.0, 1.0], [11.35, 1.0],   // last key: zero slope at 11.0
]);
// Roll: the forming logo starts tilted counter-clockwise and levels out.
const rollKeys = makeCurve([
  [4.6, 14], [6.6, 10], [7.9, 6], [8.3, 4.5], [8.6, 3.0], [9.27, 1.7],
  [9.93, 0.9], [10.2, 0.35], [10.5, 0],
]);
// The first keys start with a non-zero slope (the whole swarm would jump from still to
// full convergence speed in one frame), so both curves start from rest instead.
const dolly = fromRest(dollyKeys, 6.0, 7.0);
const roll = fromRest(rollKeys, 4.2, 5.0);

// Before t1, replace `curve` by a cubic that leaves its hold value at t0 with zero slope and
// meets the curve's value and slope at t1 (unchanged from t1 on).
function fromRest(curve, t0, t1) {
  const y0 = curve(t0), y1 = curve(t1), h = t1 - t0;
  const m1 = (curve(t1 + 1e-4) - curve(t1 - 1e-4)) / 2e-4;
  return (t) => {
    if (t >= t1) return curve(t);
    if (t <= t0) return y0;
    const x = (t - t0) / h;
    return y0 + (y1 - y0) * x * x * (3 - 2 * x) + m1 * h * x * x * (x - 1);
  };
}

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
// The late tilt follows scatter(s) for s <= 2 and saturates for s > 2 (earlier in the video),
// so the bricks square up to the camera from ~6.6 s; C1 at s = 2 (no common kink at t = 9.0).
// It drifts only very slowly before that: orientations are nearly still from the end of the
// tumble until ~8 s, while the positions keep moving.
const SCATTER_2 = scatter(2), SCATTER_D2 = (scatter(2 + 1e-4) - scatter(2 - 1e-4)) / 2e-4, TILT_W = 0.7;
const tiltHold = (s) => SCATTER_2 + SCATTER_D2 * TILT_W * (1 - Math.exp(-(s - 2) / TILT_W));
// Residual misalignment. The original drops it in a single 15 fps frame at 11.0 s; at
// 60 fps that reads as a jolt, so the bricks ease into place over the final 0.4 s.
const SETTLE = 0.4;
const jitterAmp = (s) => (0.6 + 0.4 * Math.min(1, s / 2)) * smoothstep(s / SETTLE);
// deterministic per-brick hash, for choices that must not disturb the main random stream
const hash01 = (k) => (Math.imul(k + 1, 2654435761) >>> 0) / 4294967296;

// Number of mosaic bricks that have entered the frame by time t (fitted to brick counts in the video).
// Swarm bricks that rain out at the bottom are not replaced, so the visible count runs up to ~8%
// under the original's at 4.6-4.9 s.
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
// distance at entry (brick widths), options. The distances were measured from bounding boxes,
// which are ~1.45x the brick width for a tumbling brick, hence DIST_K. An OFF entry has no
// counterpart in the original; it keeps its place so the seeded
// random stream of all the other bricks stays the same, but it never enters. Rows keep
// their places for the same reason (the late block is not strictly in time order), and a
// landing row also keeps its colour and x: they pick its slot.
// Options: face 'top' / 'side' / 'hollow' (studs / a side / the hollow side toward the
// camera, tilted up toward the key light, turning slowly: the original shows the embossed
// stud of some), ease k (1/s: the screen speed decays like e^-kt, as a brick receding along
// a straight line converges on its vanishing point), shrink (per 15 fps frame), from / to
// [u, v] (entry point, e.g. on a side edge or above a corner; exit point), T (crossing time, s;
// derived from the size otherwise). Landing rows (land):
// ease (power of the screen ease-out), hold (power of the recession: > 1 keeps the brick
// near the camera longer), dur (glide length, s), side v (enters through the side edge at
// height v), face (unwinds as the brick lands).
const OFF = true, land = true;
const HEROES = [
  // (1.2-1.6 s: the left third holds only the dim black brick; the white one has no counterpart)
  [1.16, 'R', 0.56, 4.3], [1.20, 'K', -0.72, 4.3], [1.22, 'W', -0.95, 8, OFF],
  [1.68, 'R', 0.40, 8], [1.80, 'R', 0.15, 7], [1.84, 'R', 0.45, 9], [1.88, 'R', 0.30, 6],
  [1.95, 'Y', -0.40, 7.6], [2.10, 'R', 0.55, 7], [2.15, 'Y', -0.30, 6.9], [2.30, 'R', 0.25, 6],
  [2.60, 'R', -1.0, 6], [2.67, 'Y', 1.08, 7], [3.00, 'R', -0.85, 3.15], [3.30, 'R', 0.35, 4.5],
  [3.55, 'R', -0.55, 3.3], [3.65, 'R', -0.35, 2.4], [3.80, 'R', 0.62, 3.3],
  // 3.9-4.1: two giant reds sweep down to the lower left
  [3.90, 'R', 0.0, 2.0, { to: [-0.75, -1.9], T: 0.25 }], [3.92, 'R', -0.45, 2.1, { to: [-1.15, -1.9], T: 0.25 }], [4.25, 'R', 0.75, 3.5],
  [4.47, 'K', -0.70, 2.4], [4.60, 'R', -0.80, 4.0], [4.62, 'R', 0.85, 3.2],
  [4.66, 'R', 0.45, 2.2], [4.75, 'R', 0.20, 3.0], [4.84, 'R', 0.85, 1.7, { to: [0.95, -1.7], T: 0.3 }],
  [5.04, 'R', 0.40, 1.9], [5.20, 'R', 0.37, 7.5], [5.40, 'R', -0.70, 3.3],
  [5.65, 'R', 0.10, 3.0], [5.83, 'K', 0.35, 3.6, { to: [0.15, -1.5], shrink: 0.1, T: 0.39 }], [5.97, 'R', -0.2, 3.5],
  // 6.2-6.4: two reds come down the right of centre and show the LEGO stud
  [6.15, 'R', 0.55, 2.7, { face: 'top' }], [6.16, 'R', 0.62, 2.7, { face: 'top' }], [6.53, 'R', 0.15, 3.5],
  [6.80, 'R', -0.60, 8.3], [7.07, 'R', 0.30, 1.8], [7.40, 'R', 0.70, 3.0, OFF],
  // 7.73-8.0: a giant red brick, LEGO stud to the camera, whips down the centre and slows
  // toward the bottom edge (~285 -> 60 px wide at 640x480 over 4 frames); grey bricks converge on the centre
  [7.73, 'R', -0.05, 1.4, { face: 'top', ease: 12, shrink: 0.31, to: [-0.135, -1.18], T: 0.3 }],
  [7.68, 'W', -0.33, 3.6, { land, ease: 5, hold: 1.3, dur: 1.1 }],
  [7.69, 'W', -0.10, 2.9, { land, ease: 5, hold: 1.3, dur: 1.1, face: 'hollow' }],   // the hollow one above the red brick
  [7.78, 'W', 0.05, 3.4, { land, ease: 5, hold: 1.3, dur: 1.1, face: 'side' }],
  [7.84, 'K', -0.20, 4.0, { land, ease: 5, hold: 1.3, dur: 1.1 }],
  [7.97, 'K', 0.85, 1.6, { from: [1.0, 1.4], to: [1.6, -0.2], shrink: 0.15, T: 0.3 }],     // black giant at the top right
  [7.91, 'K', -0.97, 1.4, { from: [-1.42, 0.35], to: [-0.9, -2.0], shrink: 0.3, T: 0.25 }],  // black giant down the left edge
  [8.00, 'W', -0.95, 1.4, { from: [-1.3, 0.05], to: [-0.28, -1.07], ease: 6, shrink: 0.28, T: 0.45, face: 'side' }],   // grey slab: left edge -> bottom
  [8.867, 'W', -0.95, 2.9, { from: [-1.4, 0.13], to: [1.8, -2.27], T: 0.2 }],   // white slab across the bottom left
  [8.05, 'K', -0.08, 4.5, { land, ease: 4, dur: 1.2 }],
  [8.30, 'R', 0.60, 7, { land, face: 'top' }], [8.33, 'R', 0.82, 7, { land, face: 'top' }],
  [7.86, 'R', -0.75, 4.5, { land, face: 'top', ease: 3 }],                // sinks into the top red field
  [8.85, 'W', -0.44, 2.5, OFF], [8.86, 'W', 0.46, 2.4, OFF],
  [8.84, 'W', 0.0, 2.4, { land, ease: 4, face: 'side' }],
  [8.78, 'K', -0.76, 3.0, { land, ease: 3, side: -0.3, face: 'top' }],   // black, stud to the camera, from the left edge
  [8.96, 'K', -0.95, 1.3, { from: [-1.2, -0.45], to: [0.3, -2.2], T: 0.14 }],   // black giant, lower left
  [9.0, 'W', -0.95, 1.25, { from: [-1.66, 1.1], to: [1.94, -2.2], T: 0.15 }],    // white giant whips across the centre left
  [9.12, 'W', 0.35, 3.8, { land }],
];
const DIST_K = 1.45;
// Delayed return GY of the swarm bricks' overshoot: none before s = 4 (t = 7.0), complete at s = 1.6 (t = 9.4).
const Gs = (s) => smoothstep((s - 1.6) / (4 - 1.6));
// Time window [a, b] with linear 0.4 s ramps outside it (piecewise linear).
const win = (t, a, b, ramp = 0.4) => clamp((t - a) / ramp + 1) * clamp((b - t) / ramp + 1);
// Bursts from 7.7 s on: big ones fly past, the others (land) glide into their slots.
const LANDS = (row) => row[4]?.land === true;

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
// Brick B (0.80 s) falls through the whole frame: 1.1 H/s at entry, ~0.6 H/s a second later.
const EARLY = [
  [0.33, 'W', -0.68, 44], [0.67, 'W', -0.86, 36], [0.80, 'W', -0.06, 23, -6, 0.2], [1.13, 'W', 0.64, 30],
];

// Bursts of the original that land in the logo, on top of the landing rows of HEROES: time
// (glide start, about a frame before the brick straddles the edge), colour, entry x, distance
// at entry (brick widths), slot rows, slot x (-1..1, matched against 0.8 of the mosaic
// half-width), glide length (s), options as for the landing rows. Their bricks are taken from
// the mosaic after its paths are made, so the random stream and every other brick stay as they
// were (the few taken bricks that were due to enter earlier simply skip that entry).
const BURSTS = [
  // 7.75-8.0: more of the grey cluster that converges on the lower letters
  [7.74, 'W', -0.70, 3.6, [32, 40], -0.45, 1.1, { ease: 5, hold: 1.3 }],
  [7.80, 'W', 0.45, 3.4, [32, 40], 0.25, 1.1, { ease: 5, hold: 1.3, face: 'side' }],
  [7.84, 'W', -0.50, 3.6, [32, 40], -0.2, 1.1, { ease: 5, hold: 1.3, face: 'hollow' }],
  [7.90, 'W', 0.25, 4.0, [32, 40], 0.1, 1.1, { ease: 5, hold: 1.3 }],
  // 8.0: a red brick, LEGO stud to the camera, sinks slowly to the top of the letters
  [7.84, 'R', -0.03, 2.3, [14, 16], -0.05, 1.1, { face: 'top', ease: 3, hold: 1.5 }],
  // 8.3-8.5: about ten mid-size red bricks, LEGO stud to the camera, come in through the right
  // and left edges (and the top right) and settle into the red field just below the letters
  [8.20, 'R', 0.9, 2.5, [42, 46], 0.75, 1.0, { side: 0.6, face: 'top', ease: 3 }],
  [8.24, 'R', 0.28, 4.8, [42, 46], 0.15, 1.0, { face: 'top', ease: 3 }],
  [8.25, 'R', 0.85, 6, [42, 46], 0.6, 1.0, { face: 'top' }],
  [8.25, 'R', 0.9, 4.0, [42, 46], 0.55, 1.0, { side: 0.05, face: 'top', ease: 3 }],
  [8.25, 'R', -0.9, 4.0, [42, 46], -0.85, 1.0, { side: 0.15, face: 'top', ease: 3 }],
  [8.30, 'R', 0.9, 5.0, [42, 46], 0.9, 1.0, { side: 0.1, face: 'top', ease: 3 }],
  [8.34, 'R', 0.9, 5.0, [42, 46], 0.4, 1.0, { side: -0.15, face: 'top', ease: 3 }],
  [8.36, 'R', -0.9, 5.5, [42, 46], -0.45, 1.0, { side: -0.05, face: 'top', ease: 3 }],
  // 8.8: two white slabs come in at the top, converge on the centre and land in the letters
  [8.73, 'W', -0.75, 2.1, [30, 40], -0.25, 0.75, { ease: 4, hold: 1.2, face: 'side' }],
  [8.73, 'W', 0.85, 2.1, [30, 40], 0.2, 0.75, { ease: 4, hold: 1.2, face: 'side' }],
];

// brick modes
const M_STD = 0, M_FLY = 1, M_LAND = 2, M_TRACK = 3;
const FW = 10, LW = 9;              // floats per brick in FLY / LAND
const FACE = { top: 1, side: 2, hollow: 3 };

export function buildChoreography(grid) {
  const rand = rng(0x1e60);
  const flyList = HEROES.filter((h) => !LANDS(h));
  const landList = HEROES.filter(LANDS);
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
  const GY = new Float32Array(n * 2);    // delayed (camera-)vertical return, world x/y (per unit of Gs(s))
  const TL = new Float32Array(n * 3);    // late tilt: horizontal axis (2), amplitude
  const MODE = new Uint8Array(n);
  const FLY = new Float32Array(n * FW);  // fly-by: tIn, Tc, u0, v0, u1, v1, d0, rho, ease k, face
  const LAND = new Float32Array(n * LW); // landing glide: tIn, tLand, entry u, v, ln(distance), spin, ease power, hold power, face
  const color = new Array(n);
  const tIn = new Float32Array(n).fill(-1);
  const hero = new Uint8Array(n);
  const tracks = new Map();
  const CH = { n, nMosaic, P, B, L, H, GY, K1, K2, A, ROT, RS, J, SC, TL, MODE, FLY, LAND, tracks, color, tIn, hero };

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
  flyList.forEach(([t, c, u, dT, o], k) => {
    const id = nMosaic + k;
    const d = Math.max(2.0, dT * DIST_K);
    const size = 1.5 / (2 * TAN_V * d);                 // bounding box, in H
    // screen speed grows with size: 2.3 H/s for the 0.28 H brick at 1.2 s, ~5 H/s for giants
    const speed = clamp(2.3 * Math.pow(size / 0.28, 0.7), 1.6, 7) * (0.85 + 0.3 * rand());
    let shrink = t < 3 ? 0.12 * rand() : 0.08 + 0.22 * rand();   // per 15 fps frame
    // the late giants whip past, shrinking by 0.35-0.46 per 15 fps frame
    if (t >= 6.9 && t < 7.7 && size > 0.3) shrink = 0.35 + 0.5 * (shrink - 0.08);
    if (o?.shrink) shrink = o.shrink;
    const rho = -Math.log(1 - shrink) * 15;
    // the transcribed time is when the brick straddles the top edge (half of it in view)
    // mid-swarm fly-bys (3.5-7.6 s) sweep toward the bottom centre / bottom left (15-35 deg
    // from vertical in the original); the others cross nearly straight down
    const ru = rand(), gu1 = gaussian(rand);
    let u0 = u, v0 = 1, u1 = t >= 3.5 && t < 7.6 ? clamp(0.3 * u - 0.1 - 0.2 * ru + 0.1 * gu1, -1.3, 1.3)
      : clamp(u * (0.75 + 0.25 * ru) + 0.15 * gu1, -1.3, 1.3);
    let v1 = -1 - size * 1.25 * Math.exp(-rho * 0.25);
    if (o?.from) [u0, v0] = o.from;
    if (o?.to) [u1, v1] = o.to;
    const Tc = o?.T ?? (v0 - v1) / 2 / speed;
    FLY.set([o === OFF ? Infinity : t, Tc, u0, v0, u1, v1, d, rho, o?.ease ?? 0, FACE[o?.face] ?? 0], id * FW);
    MODE[id] = M_FLY; color[id] = c; hero[id] = o === OFF ? 0 : 1; tIn[id] = o === OFF ? -1 : t;
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
  // a landing glide starts fully outside the frame: above the top edge at x u, or beyond the
  // side edge at height o.side. A face option turns the tumble into a tilt about a horizontal
  // axis (that face toward the camera at entry) that unwinds as the brick lands.
  const setLand = (id, t, tLand, u, d, spin, o) => {
    const size = 1.5 / (2 * TAN_V * d), side = o?.side !== undefined;
    const face = FACE[o?.face];
    if (face) {
      const [ax, ay, a0] = faceTilt(id, face);
      ROT[id * 8] = ax; ROT[id * 8 + 1] = ay; ROT[id * 8 + 2] = 0; ROT[id * 8 + 7] = 0;
      spin = (2 * a0) / (tLand - t);
    }
    // (a brick seen face-on is ~1.2 widths across, not 1.5: it can start closer to the edge)
    const m = (face ? 1.2 / 1.5 : 1) * 1.25;
    LAND.set([t, tLand, side ? Math.sign(u) * (1 + 0.75 * size * m) : u, side ? o.side : 1 + size * m,
      Math.log(d), spin, o?.ease ?? 2, o?.hold ?? 1, face ?? 0], id * LW);
    MODE[id] = M_LAND; hero[id] = 1; tIn[id] = t;
  };
  for (const [t, c, u, dT, o] of landList) {
    const id = pickNear(c, u, c === 'R' ? [3, 15] : [18, 40]);
    const d = dT * DIST_K, r = rand(), tLand = t + (o.dur ?? 0.8 + 0.4 * r);
    setLand(id, t, tLand, u, d, 2 + 2 * rand(), o);
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
    // tumble ~1.6x faster than the base spin while in flight, and stop ~1.5 s earlier
    // (the original's core faces the camera from ~6.6 s, with a 15-30 deg residual)
    RS[id * 2] = (c === 'R' ? 2.4 : 1.8) + 1.2 * rand() + 1.5;
    RS[id * 2 + 1] = 1.5 + rand();
    ROT[id * 8 + 3] *= 1.6; ROT[id * 8 + 7] *= 1.6;

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
    // useG: the brick falls past its slot (toward vBase) and the vertical part of the
    // way back is the delayed return GY (see Gs), so it never hangs mid-frame
    let u1, v1 = 1.06, d1, beta, vBase, base = null, useG = true, uTop, vTop;
    if (a.early) {
      // (the isolated opening bricks rain out too, and come back with the delayed return)
      u1 = a.u; d1 = a.d; beta = 0.9; useG = true;
      vBase = a.vB ?? -2.0 - 1.5 * r2;
      K2[id] = a.k2 ?? 0.3 + 0.2 * r1;
    } else {
      // red bricks fly close to the camera once the swarm thickens (mid-size reds fill the
      // frame from ~3.5 s); the others shrink to mid-field size as the swarm thickens
      const nearR = tIn0 < 3.1 ? 1.8 : tIn0 < 3.4 ? lerp(1.8, 0.85, (tIn0 - 3.1) / (3.4 - 3.1)) : 0.85 + 0.55 * clamp((tIn0 - 4.8) / 1.5);
      const kk = c === 'R' ? 0 : clamp((tIn0 - 4.6) / 0.8);
      const near = c === 'R' ? nearR : { W: 1.12, K: 1.15, Y: 1.15 }[c];
      // the swarm (2-6.5 s) flies nearer the camera, so it recedes and converges visibly;
      // the white opening bricks are smaller (farther)
      const dk = lerp(1, c === 'R' ? 0.85 : 0.62, win(tIn0, 2.0, 6.5)) * (c !== 'R' ? lerp(1.4, 1, clamp((tIn0 - 2.0) / 0.6)) : 1);
      d1 = clamp((19 + 7 * kk) * near * Math.exp((0.45 - 0.15 * kk) * gd) * (1 + 0.08 * (tIn0 - 1)) * dk, 6 + 5 * kk, cam1.z * 0.97);
      // from ~2 s the bricks enter wider than their slot (seen from the logo centre) and fall
      // toward the bottom centre (see solve), so the swarm funnels inward. The spread is
      // squeezed softly into the top edge: clamped, the wide ones would pile up on the sides.
      const sp = lerp(1.15, 2.0, clamp((tIn0 - 2.0) / 1.0));
      const uRaw = slot[0] * 1.15 + (sp - 1.15) * (slot[0] - SHIFT_U) + 0.45 * gu;
      u1 = lerp(clamp(uRaw, -1.15, 1.15), 0.98 * Math.tanh(uRaw / 0.98), clamp((tIn0 - 2.0) / 0.5));
      // fall past the slot toward vBase: far below the frame for the swarm of ~2.5 s (it
      // rains through the whole frame), less and less for later entries; a gentle ease-out
      // (screen speed halves in ~0.7-1 s) and a slow blast component
      const wk = win(tIn0, 1.2, 6.5), late = clamp((tIn0 - 2.5) / 3.0);
      beta = 0.5 + 0.4 * r1;
      vBase = -1.0 - 2.0 * r2 + lerp(-2.9, 1.05, late) * wk;
      K2[id] *= lerp(1, lerp(0.43, 1.2, late), wk);
      K1[id] *= lerp(1, 0.2, wk);
      useG = tIn0 <= 6.5 && row >= 16 && !(row > 41 && tIn0 > 4.1);
      // bricks of the bottom field that enter late land quickly at the bottom of the frame
      if (row > 41 && tIn0 > 4.1) K2[id] *= 2.1;
      if (row >= 16 && row <= 41) vBase += 0.8 * wk;   // letters overshoot less than the red fields
      if (useG) beta = 0.68 + 0.15 * r1;
      // bottom-field bricks entering after 7 s come in from the lower sides (not through the centre)
      const fromSide = row > 41 && tIn0 > 7.0;
      if (fromSide) {
        const sg = Math.abs(slot[0] - SHIFT_U) > 0.05 ? Math.sign(slot[0] - SHIFT_U) : (hash01(id * 5 + 1) < 0.5 ? -1 : 1);
        u1 = sg * 1.08; v1 = lerp(-0.7, 0.3, hash01(id * 11 + 2)); vBase = v1 - 0.3; K2[id] *= 1.05; useG = false;
      }
      // from ~4.4 s bricks also come in from the sides and from below, beyond their slot
      // as seen from the logo centre (the reversed explosion converges from all around)
      uTop = u1; vTop = v1;   // top-entry waypoint, the guard's fallback
      if (!fromSide && hash01(id * 7 + 3) < clamp((tIn0 - 4.4) / 0.8)) {
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
        // top entry: baseline (blast) + positive lift that holds the brick up until it enters.
        // The lift points from the fall target to the entry point: along the camera's vertical
        // at entry (screen-vertical fall, also while the camera is rolled), straight up for the
        // hand-placed opening bricks; the swarm (useG) falls toward the bottom centre. The fall
        // target stays below the entry point, so the lift never points down.
        const uB = useG && !a.early ? SHIFT_U + 0.4 * (u1 - SHIFT_U) : u1;
        const Wb = screenToWorld(uB, Math.min(vBase, v1 - 0.3), d1, tIn0, w2);
        let lift = Math.max(0.5, W1[1] - Wb[1]), ex = 0, ey = 1;
        if (!a.early) { const ll = Math.hypot(W1[0] - Wb[0], W1[1] - Wb[1]) || 1; ex = (W1[0] - Wb[0]) / ll; ey = (W1[1] - Wb[1]) / ll; lift = Math.max(0.5, ll); }
        const lx = lift * (ex + drift * ey), ly = lift * (ey - drift * ex);
        L[id * 3] = lx / f2;
        L[id * 3 + 1] = ly / f2;
        const rx = W1[0] - lx - ox, ry = W1[1] - ly - oy;   // fall target (base) - slot
        if (useG) {
          // the part along the camera's vertical comes back late (during the pull-back), the rest with the blast
          const cr = Math.cos(-cam1.roll), sr = Math.sin(-cam1.roll), vx = -sr, vy = cr;   // camera up in world
          const along = rx * vx + ry * vy;   // (Gs(s1) = 1: every useG brick enters before s = 4)
          GY[id * 2] = along * vx; GY[id * 2 + 1] = along * vy;
          B[id * 3] = (rx - along * vx) / f1; B[id * 3 + 1] = (ry - along * vy) / f1;
        } else {
          B[id * 3] = rx / f1; B[id * 3 + 1] = ry / f1; GY[id * 2] = GY[id * 2 + 1] = 0;
        }
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
      if (base) { base = null; u1 = uTop; v1 = vTop; solve(); }
      for (let k = 0; k < 3 && visibleEarly(); k++) { d1 = Math.min(d1 * 1.5, cam1.z * 0.97); solve(); }
    }
  }

  // ---- the landing bursts: mosaic bricks taken over after all paths are made
  for (const [t, c, u, dT, rows, col, dur, o] of BURSTS) {
    const id = pickNear(c, col, rows);
    setLand(id, t, t + dur, u, Math.max(2, dT * DIST_K), 2 + 2 * hash01(id * 37 + 3), o);
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
  let g = 0, tk = 1;   // tumble amount, share of the late tilt / jitter rotation
  if (mode === M_STD) {
    const f1 = F(ch.K1[id], s), f2 = F(ch.K2[id], s);
    const gs = Gs(s);
    x += ch.B[i3] * f1 + ch.L[i3] * f2 + ch.GY[id * 2] * gs;
    y += ch.B[i3 + 1] * f1 + ch.L[i3 + 1] * f2 + ch.GY[id * 2 + 1] * gs;
    z += ch.H[id] * hover(s) + ch.B[i3 + 2] * f1 + ch.L[i3 + 2] * f2;
    g = ramp(s, ch.RS[id * 2], ch.RS[id * 2 + 1]);
  } else if (mode === M_LAND) {
    // glide in from outside the frame onto the settling slot: screen position eases out
    // (power kE, C1 at both ends), the log-distance follows p^kD (kD > 1 keeps the brick near
    // the camera longer), like the original's last bricks
    const l = id * LW, t0 = ch.LAND[l], t1 = ch.LAND[l + 1], kE = ch.LAND[l + 6], kD = ch.LAND[l + 7];
    const p = (t - t0) / (t1 - t0);
    if (p < -0.4) { parkAt(pos, quat, pi, qi); return s; }
    if (p < 1) {
      const sl = worldToScreen(x, y, z, t, _s);
      const e = p < 0 ? kE * p : 1 - Math.pow(1 - p, kE);
      // before entry the distance is held (a soft C1 clamp for kD = 1): coming any closer, a
      // brick that starts just outside the frame would grow into it and pop in early
      const pd = p < 0 ? (kD === 1 ? -0.05 * (1 - Math.exp(p / 0.05)) : 0) : kD === 1 ? p : Math.pow(p, kD);
      const q = screenToWorld(lerp(ch.LAND[l + 2], sl[0], e), lerp(ch.LAND[l + 3], sl[1], e),
        Math.exp(lerp(ch.LAND[l + 4], Math.log(sl[2]), pd)), t, _w);
      x = q[0]; y = q[1]; z = q[2];
      // the tumble unwinds like (1-p)^2 (= 1-e for the default ease), so a fast screen
      // ease does not square the brick up to the camera early
      const wT = p < 0 ? 1 - 2 * p : (1 - p) * (1 - p);
      g = (ch.LAND[l + 5] * wT * (t1 - t0) * 0.5) / ch.ROT[id * 8 + 3];
      // a brick that shows a chosen face takes on its late tilt / jitter only as it lands
      if (ch.LAND[l + 8]) tk = clamp(1 - wT);
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
  // (for s > 2, i.e. before t = A - 2, the late tilt saturates, see tiltHold: the bricks square
  // up to the camera from ~6.6 s while their positions are still loose, as in the original)
  q = qmul(q, axisAngle(ch.TL[i3], ch.TL[i3 + 1], 0, (tk * ch.TL[i3 + 2] * (s > 2 ? tiltHold(s) : sc)) / 2.1));
  q = qmul(q, axisAngle(ch.J[j7 + 3], ch.J[j7 + 4], ch.J[j7 + 5], tk * aj));
  quat[qi] = q[0]; quat[qi + 1] = q[1]; quat[qi + 2] = q[2]; quat[qi + 3] = q[3];
  return s;
}

// Fly-by: straight screen-space crossing from the top (or a side) edge out of the frame,
// receding (shrinking) at a constant rate, tumbling; parked out of sight otherwise.
function evalFlyBy(ch, id, t, pos, quat, pi, qi) {
  const f = id * FW, t0 = ch.FLY[f], Tc = ch.FLY[f + 1], k = ch.FLY[f + 8];
  const x = t - t0, p = x / Tc;
  if (p < -0.8 || p > 1.8) { parkAt(pos, quat, pi, qi); return 1; }
  // with an ease the screen speed decays like e^-kx and the exit is still reached at Tc;
  // before entry the brick keeps its entry speed (C1) instead of an ever faster extrapolation
  const P = k > 0 ? (x >= 0 ? 1 - Math.exp(-k * x) : k * x) / (1 - Math.exp(-k * Tc)) : p;
  const u = lerp(ch.FLY[f + 2], ch.FLY[f + 4], P), v = lerp(ch.FLY[f + 3], ch.FLY[f + 5], P);
  // recede from the moment of entry; before it, a soft (C1) clamp keeps the size steady
  const dt = x >= 0 ? x : -0.05 * (1 - Math.exp(x / 0.05));
  const d = ch.FLY[f + 6] * Math.exp(ch.FLY[f + 7] * dt);
  const w = screenToWorld(u, v, d, t, _w);
  pos[pi] = w[0]; pos[pi + 1] = w[1]; pos[pi + 2] = w[2];
  const r8 = id * 8, face = ch.FLY[f + 9];
  let q;
  if (face) {
    // the chosen face toward the camera, turned slowly about a near-horizontal axis
    const [ax, ay, a0] = faceTilt(id, face), w1 = (hash01(id * 37 + 4) - 0.5) * 2.4;
    q = axisAngle(ax, ay, 0, a0 + w1 * x);
    q = qmul(q, axisAngle(0, 0, 1, (hash01(id * 37 + 3) - 0.5) * 0.8));
  } else {
    const a = ch.ROT[r8 + 3] * x + 7 * ch.ROT[r8 + 7];
    q = axisAngle(ch.ROT[r8], ch.ROT[r8 + 1], ch.ROT[r8 + 2], a);
    q = qmul(q, axisAngle(ch.ROT[r8 + 4], ch.ROT[r8 + 5], ch.ROT[r8 + 6], 0.4 * a));
  }
  quat[qi] = q[0]; quat[qi + 1] = q[1]; quat[qi + 2] = q[2]; quat[qi + 3] = q[3];
  return 1;
}

// Rotation that turns a face of the brick toward the camera: about an axis near -x, so the
// face tilts up 17-35 deg toward the key light above (the original's near bricks show a lit
// face, here the light is above the camera). face 1 studs, 2 a side, 3 the hollow side.
function faceTilt(id, face) {
  const a = Math.PI + (hash01(id * 37 + 1) - 0.5) * 0.9;
  return [Math.cos(a), Math.sin(a), (face - 1) * Math.PI / 2 + 0.3 + 0.3 * hash01(id * 37 + 2)];
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
