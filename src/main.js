import * as THREE from 'three';
import { buildChoreography, cameraAt, FOV, ASPECT, SHIFT_U, SHIFT_V, T } from './choreography.js';
import { loadLogo } from './logo.js';
import { proceduralBrick, stlBrick, createBricks } from './bricks.js';
import { createOverlay } from './overlay.js';
import { createLighting } from './lighting.js';
import { Soundtrack } from './audio.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
const DEBUG = params.has('debug');

if (CAPTURE) for (const id of ['play', 'ui', 'status']) document.getElementById(id).hidden = true;

const canvas = document.getElementById('c');
let renderer;   // created in init(), so a browser without WebGL gets a readable error

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, ASPECT, 0.1, 4000);

// Brick shading (pillow normals, stud dome, stud-text relief), calibrated against the
// original's settled mosaic; overridable from the URL for tools/calibrate.mjs.
const LOOK = { pillow: 0.3, dome: 0.275, nmap: 3 };
for (const k of Object.keys(LOOK)) if (params.has(k)) LOOK[k] = Number(params.get(k));
const lighting = createLighting(scene, params);

let bricks, overlay;

function createRenderer() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
  } catch (e) {
    throw new Error('WebGL is not available in this browser (enable hardware acceleration)', { cause: e });
  }
  renderer.setClearColor(0x000000, 1);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

function resize() {
  const w = Math.min(innerWidth, (innerHeight * 4) / 3);
  const h = (w * 3) / 4;
  renderer.setPixelRatio(CAPTURE ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(Math.round(w), Math.round(h));
  // lens shift: the logo centre sits at (0.4875, 0.495) of the frame, like the original
  camera.setViewOffset(w, h, (-SHIFT_U / 2) * w, (SHIFT_V / 2) * h, w, h);
  camera.updateProjectionMatrix();
}

function renderAt(t) {
  t = Math.min(Math.max(t, 0), T.end);
  const cover = overlay.update(t);
  renderer.clear();
  if (cover < 1) {
    const cam = cameraAt(t);
    camera.position.set(0, 0, cam.z);
    camera.rotation.set(0, 0, -cam.roll);
    bricks.update(t);
    lighting.update(t, [bricks.materials.body, bricks.materials.cap]);
    renderer.render(scene, camera);
  }
  renderer.clearDepth();
  renderer.render(overlay.scene, overlay.camera);
}

async function init() {
  createRenderer();
  const logo = await loadLogo('./LEGO_logo.svg');
  const choreo = buildChoreography(logo.grid);
  const shading = { pillow: LOOK.pillow, dome: LOOK.dome };
  const geometry = params.get('brick') === 'stl' ? await stlBrick(undefined, shading) : proceduralBrick({ seg: 32, ...shading });
  bricks = createBricks(choreo, geometry, logo.studNormal, { nmap: LOOK.nmap });
  scene.add(bricks.mesh);
  overlay = await createOverlay(logo.flatTexture);
  resize();
  addEventListener('resize', resize);
  // compile the shaders and upload the overlay textures up front so the first frames
  // don't hitch: 13.7 s draws the flat logo and the media mark, 10 s the bricks
  renderAt(13.7);
  renderAt(10);
  window.__grid = logo.grid;
  window.__renderAt = renderAt;
  window.__ready = true;
  if (!CAPTURE) setupPlayer();
}

// ---------------------------------------------------------------- playback / UI
function setupPlayer() {
  const ui = document.getElementById('ui');
  const play = document.getElementById('play');
  const status = document.getElementById('status');
  const soundBtn = document.getElementById('sound');
  const scrub = document.getElementById('scrub');
  const audio = new Soundtrack();
  const labels = { original: 'Sound: original', synth: 'Sound: synthesised', off: 'Sound: off' };
  let mode = params.get('audio');
  if (!Object.hasOwn(labels, mode)) mode = 'original';
  const tParam = Number(params.get('t'));
  let playing = false, clockStart = 0, useAudioClock = false;
  let pausedAt = Number.isFinite(tParam) ? Math.min(Math.max(tParam, 0), T.end) : 0;
  let gen = 0, loading = false;       // start() generation (a newer start/cancel drops an older load) and load in flight
  let rawLast = -1, rawLastMs = 0;    // audio clock watchdog
  let lastT = NaN, dirty = true;      // the loop redraws only when the time changed or `dirty` is set
  if (mode === 'original') audio.prefetch();
  if (DEBUG) scrub.hidden = false;

  soundBtn.textContent = labels[mode];
  play.textContent = '▶ Play';
  play.disabled = false;
  ui.hidden = false;

  const now = () => (useAudioClock ? audio.time : (performance.now() - clockStart) / 1000);

  // The picture holds at `from` while the soundtrack loads (no rewind on a Sound switch);
  // Space / R / Replay / Sound during the load supersede it, so only the newest one plays.
  async function start(from = 0) {
    const my = ++gen;
    play.hidden = true;
    play.textContent = '▶ Play';
    ui.classList.add('playing');
    status.textContent = '';
    audio.stop();
    playing = false; pausedAt = from; useAudioClock = false;
    loading = false;   // a superseded load (e.g. Sound switched to off mid-load) must not stay pending
    if (mode !== 'off') {
      const m = mode;
      loading = true;
      try {
        await audio.ensureContext();
        if (my !== gen) return;
        status.textContent = m === 'original' ? 'loading soundtrack…' : 'synthesising soundtrack…';
        const buf = await audio.load(m);
        if (my !== gen) return;   // superseded during the load: drop this buffer
        audio.play(buf, from);
        useAudioClock = true;
        rawLast = audio.rawTime; rawLastMs = performance.now();
      } catch (e) {
        if (my !== gen) return;
        console.warn('audio unavailable, playing silently', e);
        if (m === 'original') { mode = 'synth'; soundBtn.textContent = labels.synth; return start(from); }
      } finally {
        if (my === gen) loading = false;
      }
      status.textContent = '';
    }
    clockStart = performance.now() - from * 1000;
    playing = true;
  }

  function cancelStart() {
    gen++;
    loading = false;
    status.textContent = '';
    dirty = true;   // with ?debug, put the time readout back even though the time is unchanged
    ui.classList.remove('playing');
    play.hidden = false;
  }

  function stop() {
    pausedAt = Math.max(0, now());
    playing = false;
    audio.stop();
    ui.classList.remove('playing');
    play.hidden = false;
  }

  const toggle = () => {
    if (playing) stop();
    else if (loading) cancelStart();
    else start(pausedAt >= T.end ? 0 : pausedAt);
  };

  play.addEventListener('click', toggle);
  document.getElementById('stage').addEventListener('click', toggle);
  document.getElementById('replay').addEventListener('click', () => start(0));
  soundBtn.addEventListener('click', () => {
    mode = { original: 'synth', synth: 'off', off: 'original' }[mode];
    soundBtn.textContent = labels[mode];
    if (playing || loading) start(playing ? Math.max(0, now()) : pausedAt);
  });
  scrub.addEventListener('input', () => {
    if (playing) stop();
    else if (loading) cancelStart();
    pausedAt = Number(scrub.value);
    play.hidden = false;
  });
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') e.preventDefault();   // also on repeats: never activate a focused button
    if (e.repeat) return;
    if (e.code === 'Space') toggle();
    if (e.code === 'KeyR') start(0);
    if (e.code === 'KeyM') soundBtn.click();
  });

  // Redraw only when the time changed, or when a resize / restored context cleared the canvas.
  addEventListener('resize', () => { dirty = true; });
  canvas.addEventListener('webglcontextrestored', () => { dirty = true; });

  const loop = () => {
    requestAnimationFrame(loop);
    if (playing && useAudioClock) {
      // watchdog: when the audio clock stalls (device lost, output hung), carry on
      // silently on the performance clock from the current frame
      const raw = audio.rawTime, ms = performance.now();
      if (raw !== rawLast) { rawLast = raw; rawLastMs = ms; }
      else if (ms - rawLastMs > 300) {
        const tf = Math.max(0, audio.time);
        audio.stop();   // otherwise the sound would resume later, out of sync
        useAudioClock = false;
        clockStart = ms - tf * 1000;
        status.textContent = 'audio unavailable – playing silently';
      }
    }
    let t = playing ? now() : pausedAt;
    if (playing && t >= T.end) { t = T.end; playing = false; pausedAt = T.end; ui.classList.remove('playing'); }
    if (!dirty && t === lastT) return;
    lastT = t; dirty = false;
    if (DEBUG && !loading) {
      const td = Math.max(0, t);
      scrub.value = td;
      status.textContent = `${td.toFixed(2)} s · frame ${Math.floor(td * 15) + 1}`;
    }
    renderAt(t);
  };
  loop();
}

init().catch((e) => {
  console.error(e);
  const msg = String(e?.message ?? e).replace(/\.$/, '');
  const hint = e instanceof TypeError && /fetch/i.test(msg) ? ' Check your connection and reload (running locally? use npm start).' : '';
  window.__fail(`Failed to start: ${msg}.${hint}`);
});
