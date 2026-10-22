import * as THREE from 'three';
import { buildChoreography, cameraAt, D_FINAL, FOV, ASPECT, SHIFT_U, SHIFT_V, T } from './choreography.js';
import { loadLogo } from './logo.js';
import { proceduralBrick, stlBrick, createBricks } from './bricks.js';
import { createOverlay } from './overlay.js';
import { Soundtrack } from './audio.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
const DEBUG = params.has('debug');

if (CAPTURE) for (const id of ['play', 'ui', 'status']) document.getElementById(id).hidden = true;

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 1);
renderer.autoClear = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, ASPECT, 0.1, 4000);

// Lighting of the original: one strong key from above / slightly left / in front,
// a weak fill from the camera and low ambient; Phong plastic with a tight specular.
// (Calibrated against the assembled mosaic; every value can be overridden from the URL.)
export const LIGHT = { amb: 0.8, key: 2.45, kx: 0.09, ky: 0.5, kz: 0.688, fill: 0.524, spec: 0.08, shin: 96, pillow: 0.2, dome: 0.225, nmap: 3.5 };
for (const k of Object.keys(LIGHT)) if (params.has(k)) LIGHT[k] = Number(params.get(k));
scene.add(new THREE.AmbientLight(0xffffff, LIGHT.amb));
const key = new THREE.PointLight(0xffffff, LIGHT.key, 0, 0);
key.position.set(LIGHT.kx * D_FINAL, LIGHT.ky * D_FINAL, LIGHT.kz * D_FINAL);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, LIGHT.fill);
fill.position.set(0.1, -0.05, 1);
scene.add(fill);

let bricks, overlay;

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
    renderer.render(scene, camera);
  }
  renderer.clearDepth();
  renderer.render(overlay.scene, overlay.camera);
}

async function init() {
  const logo = await loadLogo('./LEGO_logo.svg');
  const choreo = buildChoreography(logo.grid);
  const geometry = params.get('brick') === 'stl' ? await stlBrick() : proceduralBrick({ seg: 32, pillow: LIGHT.pillow, dome: LIGHT.dome });
  bricks = createBricks(choreo, geometry, logo.studNormal, LIGHT);
  scene.add(bricks.mesh);
  overlay = await createOverlay(logo.flatTexture);
  resize();
  addEventListener('resize', resize);
  // compile shaders up front so the first frames don't hitch
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
  let mode = params.get('audio') || 'original';   // original | synth | off
  let playing = false, clockStart = 0, pausedAt = Number(params.get('t')) || 0, useAudioClock = false;
  if (DEBUG) scrub.hidden = false;

  const labels = { original: 'Sound: original', synth: 'Sound: synthesised', off: 'Sound: off' };
  soundBtn.textContent = labels[mode];

  const now = () => (useAudioClock ? audio.time : (performance.now() - clockStart) / 1000);

  async function start(from = 0) {
    play.hidden = true;
    ui.classList.add('playing');
    useAudioClock = false;
    if (mode !== 'off') {
      try {
        await audio.ensureContext();
        status.textContent = mode === 'original' ? 'loading soundtrack…' : 'synthesising soundtrack…';
        const buf = await audio.load(mode);
        audio.play(buf, from);
        useAudioClock = true;
      } catch (e) {
        console.warn('audio unavailable, playing silently', e);
        if (mode === 'original') { mode = 'synth'; soundBtn.textContent = labels[mode]; return start(from); }
      }
      status.textContent = '';
    }
    clockStart = performance.now() - from * 1000;
    playing = true;
  }

  function stop() {
    pausedAt = now();
    playing = false;
    audio.stop();
  }

  play.addEventListener('click', () => start(pausedAt >= T.end ? 0 : pausedAt));
  document.getElementById('replay').addEventListener('click', () => { audio.stop(); start(0); });
  soundBtn.addEventListener('click', () => {
    mode = { original: 'synth', synth: 'off', off: 'original' }[mode];
    soundBtn.textContent = labels[mode];
    if (playing) { const t = now(); audio.stop(); start(t); }
  });
  scrub.addEventListener('input', () => { if (playing) stop(); pausedAt = Number(scrub.value); play.hidden = false; });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); playing ? (stop(), play.hidden = false) : start(pausedAt >= T.end ? 0 : pausedAt); }
    if (e.code === 'KeyR') { audio.stop(); start(0); }
    if (e.code === 'KeyM') soundBtn.click();
  });

  const loop = () => {
    requestAnimationFrame(loop);
    let t = playing ? now() : pausedAt;
    if (playing && t >= T.end) { t = T.end; playing = false; pausedAt = T.end; ui.classList.remove('playing'); play.hidden = false; play.textContent = '↻ Play again'; }
    if (DEBUG) { scrub.value = t; status.textContent = `${t.toFixed(2)} s · frame ${Math.floor(t * 15) + 1}`; }
    renderAt(t);
  };
  loop();
}

init().catch((e) => {
  console.error(e);
  document.getElementById('status').textContent = `Failed to start: ${e.message}. Serve this folder over http (npm start).`;
});
