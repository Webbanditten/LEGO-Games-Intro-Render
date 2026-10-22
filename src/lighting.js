// Lighting of the original: one strong key from above / in front, a weak fill from
// the camera, low ambient and Phong plastic. The swarm is lit for contrast (faces go
// dark as bricks tumble away from the key, broad specular washes); the settled mosaic
// was calibrated separately (tools/calibrate.mjs) against the original's frame 167.
// The rig blends from one to the other while the bricks converge (9.0-10.9 s).
import * as THREE from 'three';
import { D_FINAL } from './choreography.js';
import { smoothstep } from './curves.js';

// key position is in units of the final camera distance; spec/shin are the Phong material
export const SWARM = { amb: 0.25, key: 3.9, kx: 0.09, ky: 0.5, kz: 0.688, fill: 0.15, spec: 0.25, shin: 24 };
export const MOSAIC = { amb: 1.125, key: 1.15, kx: -0.12, ky: 0.25, kz: 0.6, fill: 0.899, spec: 0.08, shin: 126 };
const BLEND = [9.0, 1.9];

export function createLighting(scene, params) {
  // any value can be overridden from the URL as swarm.<k> / mosaic.<k> (calibration tools)
  const swarm = { ...SWARM }, mosaic = { ...MOSAIC };
  for (const [prefix, set] of [['swarm.', swarm], ['mosaic.', mosaic]])
    for (const k of Object.keys(set)) if (params.has(prefix + k)) set[k] = Number(params.get(prefix + k));

  const ambient = new THREE.AmbientLight(0xffffff, 0);
  const key = new THREE.PointLight(0xffffff, 0, 0, 0);
  const fill = new THREE.DirectionalLight(0xffffff, 0);
  fill.position.set(0.1, -0.05, 1);
  scene.add(ambient, key, fill);

  const cur = {};
  const update = (t, materials) => {
    const w = smoothstep((t - BLEND[0]) / BLEND[1]);
    for (const k of Object.keys(swarm)) cur[k] = swarm[k] + (mosaic[k] - swarm[k]) * w;
    ambient.intensity = cur.amb;
    fill.intensity = cur.fill;
    key.intensity = cur.key;
    key.position.set(cur.kx * D_FINAL, cur.ky * D_FINAL, cur.kz * D_FINAL);
    for (const m of materials) { m.specular.setScalar(cur.spec); m.shininess = cur.shin; }
  };
  return { update };
}
