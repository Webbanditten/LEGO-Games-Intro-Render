// LEGO Media intro soundtrack: WebAudio re-synthesis calibrated band-by-band against intro.mp4
// (an F1 sawtooth drone, glassy 'brick' pings, two rising chirp sweeps, the 13.78 s impact).
// Rendered offline once into an AudioBuffer, then played in sync with the animation clock.
import { rng } from './curves.js';

const PINGS_A = [
  [0.585, 'A7', 1.40],
  [0.877, 'G7', 1.24],
  [1.085, 'F7', 1.88],
  [1.258, 'D7', 1.02],
  [1.659, 'E7', 0.76],
  [1.845, 'F#7', 0.59],
  [1.985, 'G#7', 0.88],
  [2.141, 'G7', 0.44],
  [2.291, 'A7', 0.70],
  [2.978, 'G7', 0.45],
  [3.129, 'A7', 0.55],
  [3.152, 'F7', 0.46],
  [3.459, 'F7', 1.17],
  [3.471, 'D7', 0.72],
  [3.882, 'E7', 0.55],
  [4.121, 'F#7', 0.54],
  [4.144, 'G7', 1.10],
  [4.320, 'A7', 0.66],
  [4.370, 'G#7', 0.72],
  [4.417, 'F7', 0.92],
  [4.817, 'F#7', 0.77],
  [4.974, 'D7', 0.70],
  [5.120, 'F7', 0.74],
  [5.184, 'E7', 0.79],
  [5.223, 'C#7', 0.58],
  [5.427, 'F#7', 0.67],
  [5.579, 'G7', 0.68],
  [5.693, 'A7', 0.41],
  [5.712, 'F7', 0.55],
  [5.833, 'G#7', 0.30],
  [5.857, 'E7', 0.72],
  [6.043, 'F7', 0.72],
  [6.083, 'C#7', 0.31],
  [6.111, 'D7', 0.48],
  [6.165, 'G7', 0.99],
  [6.298, 'F#7', 0.92],
  [6.523, 'A7', 0.50],
  [6.565, 'F7', 1.08],
  [6.582, 'G#7', 0.20],
  [6.942, 'E7', 0.45],
  [7.028, 'D7', 0.46],
  [7.078, 'C#7', 0.68],
  [7.450, 'F#7', 0.67],
  [7.493, 'G7', 0.37],
  [7.517, 'F7', 0.80],
  [7.581, 'A7', 0.37],
  [7.651, 'G7', 0.55],
  [7.703, 'C#7', 0.77],
  [7.750, 'E7', 0.97],
  [8.032, 'D7', 0.48],
  [8.121, 'F7', 0.55],
  [8.397, 'G#7', 0.51],
  [8.405, 'G7', 0.50],
  [8.406, 'A7', 0.72],
  [8.504, 'F7', 0.49],
  [8.701, 'G7', 0.47],
  [8.736, 'G#7', 0.47],
  [8.957, 'A7', 0.49],
  [9.003, 'G7', 0.49],
  [9.404, 'A7', 0.49],
  [9.777, 'E7', 0.47],
  [9.862, 'F7', 0.72],
  [10.025, 'G7', 0.43],
  [10.205, 'E7', 0.47],
  [10.254, 'G7', 0.40],
  [10.350, 'G#7', 0.49],
  [10.369, 'A7', 0.49],
  [10.443, 'F7', 1.00],
  [10.477, 'G7', 0.55],
  [10.877, 'C#7', 0.40],
  [10.925, 'D7', 0.26],
  [11.203, 'E7', 0.37],
  [11.287, 'G7', 0.65],
  [11.407, 'A7', 0.38],
  [11.471, 'G#7', 0.41],
  [11.727, 'F7', 0.38],
  [11.877, 'F7', 0.55],
  [11.907, 'D7', 0.30],
  [11.911, 'C#7', 0.30],
  [12.213, 'E7', 0.36],
  [12.278, 'G7', 0.73],
  [12.491, 'G#7', 0.42],
  [12.734, 'F7', 0.40],
  [12.992, 'D7', 0.23],
  [13.225, 'F7', 0.53],
  [13.236, 'C#7', 0.36],
  [13.497, 'E7', 0.26],
  [14.214, 'F#7', 0.56],
  [14.220, 'F7', 0.57],
  [14.374, 'G7', 0.44],
  [14.413, 'G#7', 0.42],
  [14.588, 'F#7', 0.43],
  [14.593, 'G7', 0.53],
  [14.634, 'G#7', 0.55],
];
const PINGS_B = [
  [1.826, 'A8', 0.70],
  [2.162, 'G8', 0.74],
  [2.501, 'F8', 0.69],
  [2.785, 'E8', 0.66],
  [2.794, 'D8', 0.68],
  [2.933, 'C#8', 0.78],
  [3.114, 'D#8', 0.61],
  [3.462, 'F#8', 0.65],
  [3.725, 'E8', 0.63],
  [3.841, 'F8', 0.60],
  [4.037, 'G8', 0.45],
  [4.122, 'D#8', 0.64],
  [4.272, 'G8', 0.81],
  [4.319, 'A8', 0.58],
  [4.469, 'C#8', 0.27],
  [4.630, 'F8', 0.32],
  [4.725, 'F8', 0.59],
  [4.767, 'E8', 0.56],
  [4.886, 'D#8', 0.75],
  [5.078, 'F#8', 0.34],
  [5.090, 'E8', 0.54],
  [5.172, 'F#8', 0.50],
  [5.427, 'F8', 0.47],
  [5.555, 'E8', 0.47],
  [5.661, 'G8', 0.38],
  [5.775, 'C8', 0.30],
  [5.857, 'G8', 0.63],
  [5.928, 'C#8', 0.32],
  [5.961, 'E8', 0.47],
  [6.008, 'A8', 0.38],
  [6.010, 'D#8', 0.28],
  [6.131, 'F8', 0.39],
  [6.258, 'C8', 0.46],
  [6.298, 'F#8', 0.30],
  [6.391, 'F8', 0.65],
  [6.420, 'E8', 0.51],
  [6.437, 'G8', 0.52],
  [6.767, 'A8', 0.45],
  [6.854, 'D#8', 0.33],
  [6.925, 'F8', 0.52],
  [6.948, 'D#8', 0.54],
  [6.980, 'C#8', 0.39],
  [7.093, 'A8', 0.54],
  [7.111, 'G8', 0.48],
  [7.142, 'E8', 0.39],
  [7.175, 'C#8', 0.56],
  [7.225, 'F#8', 0.35],
  [7.238, 'F8', 0.46],
  [7.279, 'D#8', 0.57],
  [7.293, 'C8', 0.33],
  [7.296, 'E8', 1.21],
  [7.401, 'F#8', 0.52],
  [7.424, 'A8', 0.59],
  [7.447, 'G8', 0.70],
  [7.552, 'F8', 0.62],
  [7.581, 'C#8', 0.69],
  [7.651, 'D#8', 1.10],
  [7.767, 'F#8', 0.62],
  [8.028, 'G8', 0.68],
  [8.125, 'C8', 0.31],
  [8.132, 'C#8', 0.51],
  [8.184, 'A8', 0.40],
  [8.260, 'F#8', 0.58],
  [8.295, 'E8', 0.45],
  [8.487, 'C#8', 0.48],
  [8.545, 'A8', 0.45],
  [8.691, 'C8', 0.24],
  [8.742, 'E8', 0.46],
  [8.771, 'C#8', 0.43],
  [8.829, 'D#8', 0.53],
  [8.864, 'A8', 0.48],
  [8.889, 'F8', 0.25],
  [9.021, 'C#8', 0.44],
  [9.125, 'D#8', 0.85],
  [9.137, 'A8', 0.60],
  [9.183, 'F#8', 0.66],
  [9.201, 'G8', 0.45],
  [9.241, 'F8', 0.59],
  [9.282, 'C#8', 0.60],
  [9.355, 'C8', 0.55],
  [9.601, 'F#8', 0.49],
  [9.601, 'A8', 0.45],
  [9.645, 'E8', 0.55],
  [9.682, 'C#8', 0.55],
  [9.810, 'D#8', 0.57],
  [9.949, 'E8', 0.71],
  [10.039, 'G8', 0.43],
  [10.048, 'C#8', 0.53],
  [10.111, 'F8', 0.45],
  [10.219, 'F#8', 0.93],
  [10.309, 'C8', 0.36],
  [10.338, 'C#8', 0.56],
  [10.420, 'E8', 0.46],
  [10.431, 'F8', 0.43],
  [10.661, 'F8', 0.39],
  [10.663, 'E8', 0.59],
  [10.671, 'D#8', 0.31],
  [10.710, 'C#8', 0.58],
  [10.756, 'G8', 0.41],
  [10.814, 'D#8', 0.51],
  [10.878, 'A8', 0.23],
  [10.919, 'F8', 0.49],
  [10.925, 'G8', 0.67],
  [10.930, 'F#8', 0.58],
  [11.006, 'E8', 0.46],
  [11.105, 'C#8', 0.50],
  [11.157, 'D#8', 0.49],
  [11.238, 'F8', 0.42],
  [11.267, 'E8', 0.53],
  [11.303, 'C8', 0.40],
  [11.464, 'C#8', 0.58],
  [11.621, 'D#8', 0.55],
  [11.819, 'C#8', 0.47],
  [11.824, 'F8', 0.36],
  [11.923, 'D#8', 0.47],
  [12.004, 'G8', 0.62],
  [12.016, 'F8', 0.45],
  [12.074, 'C#8', 0.60],
  [12.181, 'A8', 0.46],
  [12.184, 'D#8', 0.52],
  [12.260, 'F8', 0.45],
  [12.393, 'A8', 0.45],
  [12.451, 'C#8', 0.45],
  [12.457, 'F8', 0.42],
  [12.544, 'D#8', 0.63],
  [12.604, 'E8', 0.39],
  [12.689, 'F8', 0.51],
  [12.742, 'C#8', 0.50],
  [12.813, 'F#8', 0.41],
  [13.227, 'D8', 0.39],
  [13.228, 'E8', 0.37],
  [13.276, 'C8', 0.45],
  [13.281, 'C#8', 0.45],
  [13.977, 'C8', 0.63],
  [13.995, 'E8', 0.59],
  [14.013, 'F#8', 0.56],
  [14.013, 'D#8', 0.52],
  [14.187, 'F8', 0.69],
  [14.291, 'G8', 0.89],
  [14.367, 'E8', 1.37],
  [14.483, 'A8', 0.71],
  [14.566, 'C#8', 0.28],
  [14.646, 'C#8', 0.54],
  [14.988, 'A8', 0.70],
  [15.006, 'G8', 0.45],
  [15.226, 'G8', 0.42],
];

// Pitch pools. Pool A is tuned +32 cents sharp of A440. Pool B is at +1 cent, with a -16 cent chorus partner.
const FREQ_A = {'C#7':2258.2,'D7':2392.5,'E7':2685.8,'F7':2845.6,'F#7':3014.8,'G7':3194.5,'G#7':3384.4,'A7':3585.4};
const FREQ_B = {'C8':4187.2,'C#8':4436.7,'D8':4700.3,'D#8':4979.5,'E8':5275.9,'F8':5589.8,'F#8':5921.9,'G8':6274.0,'A8':7041.8,'B8':7905.0};

// WebAudio lowpass/highpass Q is a resonance in dB, not the linear RBJ Q, so convert.
const qdb = q => 20 * Math.log10(q);

export async function renderLegoIntroAudio(sampleRate = 44100) {
  const DUR = 15.84, SQ2 = Math.SQRT2;
  const ctx = new OfflineAudioContext(2, Math.ceil(DUR * sampleRate), sampleRate);
  const rnd = rng(20240607);

  // ---------- helpers
  const lp = (f, q = 0.7071) => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = qdb(q); return b; };
  const hp = (f, q = 0.7071) => { const b = ctx.createBiquadFilter(); b.type = 'highpass'; b.frequency.value = f; b.Q.value = qdb(q); return b; };
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  // StereoPanner sends a mono source at pan 0 at -3 dB per side. The calibration assumes 0 dB at center, so add sqrt2.
  const panTo = (pan, dest) => { const g = gain(SQ2), p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(dest); return { input: g, pan: p.pan }; };
  const ramps = (param, pts, kind = 'lin') => { // pts: [[t,v],...]; kind 'lin' | 'exp'
    param.setValueAtTime(pts[0][1], pts[0][0]);
    for (let i = 1; i < pts.length; i++) kind === 'exp' ? param.exponentialRampToValueAtTime(Math.max(pts[i][1], 1e-5), pts[i][0])
                                                        : param.linearRampToValueAtTime(pts[i][1], pts[i][0]);
  };
  const noiseBuf = (sec, pink = false) => {
    const n = Math.ceil(sec * sampleRate), b = ctx.createBuffer(1, n, sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      if (!pink) { d[i] = w; continue; }
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;           // Kellet pink, scaled x0.2 (calibrated)
    }
    return b;
  };
  const noiseSrc = (sec, t, pink = false) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf(sec, pink); s.start(t); return s; };
  // Stereo-decorrelated noise: an independent source per channel, each through its own chain from makeChain().
  const stereoNoise = (sec, t, makeChain, dest, pink = false) => {
    const m = ctx.createChannelMerger(2);
    for (let ch = 0; ch < 2; ch++) { const [first, last] = makeChain(); noiseSrc(sec, t, pink).connect(first); last.connect(m, 0, ch); }
    m.connect(dest);
  };

  // ---------- master: sum -> tanh soft clip (input range +-2) -> 10.5 kHz band-limit (the source is 22.05 kHz) -> hard end cut
  const sum = gain(1), pre = gain(0.5), shaper = ctx.createWaveShaper(), bandlimit = lp(10500), endCut = gain(1);
  const N = 2048, curve = new Float32Array(N);
  for (let i = 0; i < N; i++) curve[i] = Math.tanh(2 * ((i / (N - 1)) * 2 - 1));
  shaper.curve = curve; shaper.oversample = '2x';
  sum.connect(pre).connect(shaper).connect(bandlimit).connect(endCut).connect(ctx.destination);
  endCut.gain.setValueAtTime(1, 15.755); endCut.gain.linearRampToValueAtTime(0, 15.762);      // the original cuts hard at 15.76 s

  // ---------- 1. DRONE: three detuned saws on F1, lowpassed; stereo until the 13.22 s splice, then mono
  const droneGain = gain(0); droneGain.connect(sum);
  ramps(droneGain.gain, [[0.40,0],[0.55,0.08],[1.10,0.30],[6.9,0.30],[7.8,0.62],[11.3,0.62],[13.15,0.23],[13.21,0.23],
                         [13.23,0.60],[13.70,0.65],[13.78,0.65],[14.05,0.40],[14.3,0.14],[14.6,0.05],[15.0,0]]);
  [[43.10,-0.3],[43.55,0],[44.20,0.3]].forEach(([f, pan]) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const v = gain(1/3), main = lp(230, 0.8), bright = lp(900, 0.5), bg = gain(0.10);
    ramps(main.frequency, [[0,230],[6.6,230],[8.0,320],[13.1,320],[13.22,300]]);   // filter opens during the 7-8 s crescendo
    const out = panTo(pan, droneGain);
    o.connect(v); v.connect(main).connect(out.input); v.connect(bright).connect(bg).connect(out.input);
    out.pan.setValueAtTime(pan, 0); out.pan.setValueAtTime(0, 13.22);
    o.start(0.35); o.stop(15.1);
  });

  // ---------- 2. SUB: F0 (21.83 Hz) and its 3rd harmonic (65.5 Hz) enter at 6.6-7.3 s
  const subGain = gain(0); subGain.connect(sum);
  ramps(subGain.gain, [[0,0],[6.6,0],[7.3,1],[9.8,1],[10.5,0.6],[11.5,0.45],[12.5,0.2],[13.2,0.1],[13.22,0]]);
  [[21.83,0.035],[65.5,0.028]].forEach(([f,a]) => { const o = ctx.createOscillator(); o.frequency.value = f; const g = gain(a); o.connect(g).connect(subGain); o.start(6.5); o.stop(13.3); });

  // ---------- 3. PINGS ("crystal twinkles")
  const pingBus = gain(1); pingBus.connect(sum);
  ramps(pingBus.gain, [[0,1],[11.3,1],[13.15,0.6],[13.21,0.6],[13.23,1],[13.9,1],[14.5,0.4],[15.0,0.04],[15.3,0.02],[15.8,0.01]], 'exp');
  const pingB = panTo(-0.35, pingBus);                      // family B sits about 5.5 dB left
  const TAU = 0.72;                                          // decay of about -12 dB/s
  const env = (g, t, dur, peak, t0 = t) => {                 // 10 ms attack, exp decay, 8 ms hard cut at the end
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.01);
    g.gain.setTargetAtTime(0, t0 + 0.01, TAU);
    const tEnd = t + dur, vEnd = peak * Math.exp(-Math.max(0, tEnd - 0.008 - (t0 + 0.01)) / TAU);
    g.gain.setValueAtTime(vEnd, tEnd - 0.008); g.gain.linearRampToValueAtTime(0, tEnd);
  };
  for (const [t, note, dur] of PINGS_A) {                    // family A: pure sine plus a fast-dying octave, centered
    const f = FREQ_A[note];
    const o = ctx.createOscillator(); o.frequency.value = f; const g = gain(0); env(g, t, dur, 0.009); o.connect(g).connect(pingBus);
    const o2 = ctx.createOscillator(); o2.frequency.value = 2 * f; const g2 = gain(0);
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.003, t + 0.01); g2.gain.setTargetAtTime(0, t + 0.01, 0.088);
    g2.gain.setValueAtTime(0, t + dur);
    o2.connect(g2).connect(pingBus);
    o.start(t); o.stop(t + dur + 0.01); o2.start(t); o2.stop(t + dur + 0.01);
  }
  for (const [t, note, dur] of PINGS_B) {                    // family B: chorused pair (+0 / -16 c) with a +4 % pitch drop-in
    const f = FREQ_B[note];
    [[1.0, 0], [0.99075, 0.02]].forEach(([ratio, delay]) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * ratio * 1.04, t); o.frequency.setTargetAtTime(f * ratio, t, 0.012);
      const g = gain(0); env(g, t, dur, 0.0063, t + delay);
      o.connect(g).connect(pingB.input); o.start(t); o.stop(t + dur + 0.01);
    });
  }

  // ---------- 4. SWEEPS: a cloud of rising sine chirps (+1300 Hz/s) panned right to left. One sample, played twice 6.39 s apart.
  const hann = new Float32Array(64).map((_, i) => 0.02 * Math.sin(Math.PI * i / 63) ** 2);
  for (const T0 of [2.20, 8.59]) {
    const bus = gain(0), out = panTo(0.55, sum); bus.connect(out.input);
    ramps(bus.gain, [[T0,0.014],[T0+0.45,0.14],[T0+0.80,1],[T0+1.10,1],[T0+2.2,0.16],[T0+2.5,0.001]], 'exp');
    bus.gain.setValueAtTime(0, T0 + 2.5);
    out.pan.setValueAtTime(0.55, T0 + 0.2); out.pan.linearRampToValueAtTime(0, T0 + 0.9); out.pan.linearRampToValueAtTime(-0.85, T0 + 2.0);
    for (let s = 0; s < 2.5; s += 0.09 + (rnd() * 0.06 - 0.03)) {
      const ts = T0 + s, f0 = 1150 + 900 * rnd(), d = 0.45;
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(f0, ts); o.frequency.linearRampToValueAtTime(f0 + 1300 * d, ts + d);
      const g = gain(0); g.gain.setValueCurveAtTime(hann, ts, d);
      o.connect(g).connect(bus); o.start(ts); o.stop(ts + d + 0.01);
    }
  }

  // ---------- 5. HISS / AIR BED: decorrelated white noise, 700 Hz to 8.5 kHz, rising with swarm density
  const hissGain = gain(0);  hissGain.connect(sum);
  ramps(hissGain.gain, [[0.9,0.0001],[1.0,0.00032],[1.5,0.00058],[2.0,0.0023],[2.5,0.0046],[3.0,0.0058],[5.0,0.0081],[6.5,0.0073],
    [7.0,0.0115],[8.5,0.0129],[9.0,0.0153],[10.0,0.0162],[10.5,0.0102],[11.5,0.0229],[12.0,0.0172],[12.5,0.0091],[13.1,0.0162],
    [13.22,0.0324],[13.8,0.0324],[14.0,0.0182],[14.5,0.0046],[15.0,0.00072],[15.8,0.0001]], 'exp');
  stereoNoise(15.0, 0.85, () => { const a = hp(700), b = lp(8500); a.connect(b); return [a, b]; }, hissGain);

  // ---------- 6. IMPACT at TI = 13.778 s ("LEGO Media" mark lands, frames 207-209)
  const TI = 13.778;
  const rumble = gain(0); rumble.connect(sum);              // a. decorrelated low rumble, flat 20-180 Hz
  rumble.gain.setValueAtTime(0, TI); rumble.gain.linearRampToValueAtTime(5.0, TI + 0.14);
  rumble.gain.setValueAtTime(5.0, 14.35); rumble.gain.setTargetAtTime(0, 14.35, 0.5);
  stereoNoise(2.1, TI - 0.01, () => { const a = lp(180, 0.7), b = lp(180, 0.7); a.connect(b); return [a, b]; }, rumble);

  const air = gain(0); air.connect(sum);                    // b. pink-noise body whose cutoff falls
  ramps(air.gain, [[TI,0.001],[TI+0.004,1.0],[13.90,0.6],[14.05,0.6],[14.20,0.35],[14.5,0.25],[15.0,0.12],[15.5,0.05],[15.8,0.03]], 'exp');
  stereoNoise(2.1, TI - 0.01, () => { const a = lp(6000, 0.5);
    ramps(a.frequency, [[TI,6000],[14.1,3000],[14.5,1200],[15.0,700],[15.5,500]], 'exp'); return [a, a]; }, air, true);

  const th = ctx.createOscillator(), thg = gain(0);          // c. sub thump, 58 Hz falling to 38 Hz
  th.frequency.setValueAtTime(58, TI); th.frequency.setTargetAtTime(38, TI, 0.25);
  thg.gain.setValueAtTime(0, TI); thg.gain.linearRampToValueAtTime(0.3, TI + 0.02); thg.gain.setTargetAtTime(0, TI + 0.02, 0.9);
  th.connect(thg).connect(sum); th.start(TI); th.stop(15.8);

  for (const [tc, pan, a] of [[13.778,-0.9,0.6],[13.798,0.9,0.65],[13.880,-0.9,0.35],[13.905,0,0.2],   // d. crackle transients
                              [14.000,-0.9,0.38],[14.018,0.9,0.4],[14.200,-0.9,0.2]]) {
    const src = noiseSrc(0.03, tc), h = hp(1500), g = gain(0), out = panTo(pan, sum);
    g.gain.setValueAtTime(0, tc); g.gain.linearRampToValueAtTime(a, tc + 0.001); g.gain.setTargetAtTime(0, tc + 0.001, 0.008);
    src.connect(h).connect(g).connect(out.input);
  }

  return await ctx.startRendering();
}
