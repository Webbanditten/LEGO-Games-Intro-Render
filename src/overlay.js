// 2D layer drawn on top of the bricks, in the original's 640x480 pixel space:
// the flat logo that the mosaic dissolves into, its move to the left, and the
// "LEGO Media" mark that zooms in about the frame centre.
import * as THREE from 'three';
import { T } from './choreography.js';
import { clamp, lerp, smoothstep, makeCurve } from './curves.js';
import { svgImage } from './logo.js';

const FRAME_W = 640, FRAME_H = 480;
// Flat logo (whole SVG incl. its thin black frame): centre and size in px, measured.
const LOGO_HOLD = { x: 312.4, y: 237.2, size: 330.4 };
const LOGO_END = { x: 159.8, y: 176.5, size: 330.4 * (184.4 / 321.5) };
// "LEGO Media" group scale, measured frame by frame (linear grow, 1.8 % overshoot).
const mediaScale = makeCurve([[T.mediaStart, 0], [13.80, 0.92], [13.845, 1.018], [13.92, 1.0]]);
const SHUTTER = 0.02;   // ~half a 25 fps source frame of motion blur, as in the original
const SUBFRAMES = 8;

export async function createOverlay(flatTexture, mediaUrl = './assets/media-mark.svg') {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-FRAME_W / 2, FRAME_W / 2, FRAME_H / 2, -FRAME_H / 2, -10, 10);

  const mediaSvg = await (await fetch(mediaUrl)).text();
  const SCALE = 6;   // 3840x2880: stays crisp up to a 2160p canvas
  const img = await svgImage(mediaSvg.replace(/ width="640" height="480"/, ''), FRAME_W * SCALE, FRAME_H * SCALE);
  const c = document.createElement('canvas');
  c.width = FRAME_W * SCALE; c.height = FRAME_H * SCALE;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const mediaTexture = new THREE.CanvasTexture(c);
  mediaTexture.colorSpace = THREE.SRGBColorSpace;
  mediaTexture.minFilter = THREE.LinearMipmapLinearFilter;
  mediaTexture.anisotropy = 4;

  const plane = new THREE.PlaneGeometry(1, 1);
  const logoMat = new THREE.MeshBasicMaterial({ map: flatTexture, transparent: true, depthTest: false, depthWrite: false });
  const mediaMat = new THREE.MeshBasicMaterial({ map: mediaTexture, transparent: true, depthTest: false, depthWrite: false });
  const logos = [], medias = [];
  for (let i = 0; i < SUBFRAMES; i++) {
    const l = new THREE.Mesh(plane, logoMat.clone());
    const m = new THREE.Mesh(plane, mediaMat.clone());
    scene.add(l, m);
    logos.push(l); medias.push(m);
  }

  const place = (mesh, x, y, w, h) => {
    mesh.position.set(x - FRAME_W / 2, FRAME_H / 2 - y, 0);
    mesh.scale.set(w, h, 1);
  };
  const logoAt = (t) => {
    const p = clamp((t - T.moveStart) / T.moveDur);
    return { x: lerp(LOGO_HOLD.x, LOGO_END.x, p), y: lerp(LOGO_HOLD.y, LOGO_END.y, p), size: lerp(LOGO_HOLD.size, LOGO_END.size, p) };
  };

  // Draws `k` sub-frame copies spread over the shutter, additively (= averaged).
  const setLayer = (meshes, opacity, moving, fn) => {
    const k = moving ? SUBFRAMES : 1;
    meshes.forEach((mesh, i) => {
      mesh.visible = i < k && opacity > 0;
      if (!mesh.visible) return;
      mesh.material.blending = k > 1 ? THREE.AdditiveBlending : THREE.NormalBlending;
      mesh.material.opacity = opacity / k;
      fn(mesh, k > 1 ? (i + 0.5) / k - 0.5 : 0);
    });
  };

  // Returns how much of the frame the flat logo covers (1 = bricks can be skipped).
  const update = (t) => {
    const fade = smoothstep((t - T.xfadeStart) / T.xfadeDur);
    const moving = t > T.moveStart - SHUTTER && t < T.moveStart + T.moveDur + SHUTTER;
    setLayer(logos, fade, moving, (mesh, o) => {
      const L = logoAt(t + o * SHUTTER);
      place(mesh, L.x, L.y, L.size, L.size);
    });
    const s = mediaScale(t);
    const growing = t > T.mediaStart && t < 13.93;
    setLayer(medias, s > 0.002 ? 1 : 0, growing, (mesh, o) => {
      const si = Math.max(0, mediaScale(t + o * SHUTTER));
      place(mesh, FRAME_W / 2, FRAME_H / 2, FRAME_W * si, FRAME_H * si);
    });
    return fade;
  };

  return { scene, camera, update };
}
