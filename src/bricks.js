// The 3600 1x1 bricks: geometry, materials and the per-frame instance update.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { evalBrick } from './choreography.js';

// Brick colours (sRGB). Tuned so the lit bricks match the original's rendered colours.
export const BRICK_COLORS = { R: '#C9101B', W: '#ECECEC', Y: '#E8DD20', K: '#1F1D1C' };

// Real 1x1 brick proportions in units of the 8 mm pitch (body 7.8 x 7.8 x 9.6 mm,
// stud Ø4.8 x 1.7 mm, 1.2 mm walls, 1.0 mm top), origin at the body centre, studs +Z.
const W = 0.975, HW = W / 2, BH = 0.6, WALL = 0.15, TOP = 0.125, STUD_R = 0.3, STUD_H = 0.2125;

// Shading in the style of the original (a late-90s smooth-shaded render): the outer
// faces get "pillow" normals that tilt outward toward their edges (sharp silhouette,
// soft gradient: each mosaic cell reads bright in the middle with dark seams) and the
// stud cap is domed (it catches a highlight). The tilt field is affine, so two
// triangles per face reproduce it exactly.
export function proceduralBrick({ seg = 32, pillow = 0.35, dome = 0.6 } = {}) {
  const groups = [[], [], []]; // 0 body+stud side, 1 stud cap (normal-mapped text), 2 cavity
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const push = (g, p, n, uv = [0, 0]) => groups[g].push(p.x, p.y, p.z, n.x, n.y, n.z, uv[0], uv[1]);
  // quad a-b-c-d with face normal n; t1/t2 span the face (corner signs -,-  +,-  +,+  -,+)
  const quad = (g, a, b, c, d, n, t1, t2, k = 0) => {
    const ns = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s1, s2]) =>
      n.clone().addScaledVector(t1, k * s1).addScaledVector(t2, k * s2).normalize());
    let idx = [0, 1, 2, 0, 2, 3];
    const cr = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (cr.dot(n) < 0) idx = [0, 2, 1, 0, 3, 2];
    const ps = [a, b, c, d];
    for (const i of idx) push(g, ps[i], ns[i]);
  };
  const IH = HW - WALL, CZ = BH - TOP, Z = v3(0, 0, 1);
  // top face and four outer sides (pillow-shaded)
  quad(0, v3(-HW, -HW, BH), v3(HW, -HW, BH), v3(HW, HW, BH), v3(-HW, HW, BH), Z, v3(1, 0, 0), v3(0, 1, 0), pillow);
  for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = v3(nx, ny, 0), t = v3(-ny, nx, 0);
    const o = n.clone().multiplyScalar(HW), e = t.clone().multiplyScalar(HW);
    quad(0, o.clone().sub(e).setZ(-BH), o.clone().add(e).setZ(-BH), o.clone().add(e).setZ(BH), o.clone().sub(e).setZ(BH), n, t, Z, pillow);
    // bottom rim (ring between outer and inner square)
    const oi = n.clone().multiplyScalar(IH), ei = t.clone().multiplyScalar(IH);
    quad(0, o.clone().sub(e).setZ(-BH), o.clone().add(e).setZ(-BH), oi.clone().add(ei).setZ(-BH), oi.clone().sub(ei).setZ(-BH), Z.clone().negate(), t, n);
    // cavity wall, facing inwards
    quad(2, oi.clone().sub(ei).setZ(-BH), oi.clone().add(ei).setZ(-BH), oi.clone().add(ei).setZ(CZ), oi.clone().sub(ei).setZ(CZ), n.clone().negate(), t, Z);
  }
  quad(2, v3(-IH, -IH, CZ), v3(IH, -IH, CZ), v3(IH, IH, CZ), v3(-IH, IH, CZ), Z.clone().negate(), v3(1, 0, 0), v3(0, 1, 0));
  // stud: smooth cylinder wall rounding into a domed cap with UVs for the "LEGO" relief
  const z0 = BH, z1 = BH + STUD_H;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const P = (c, s, z) => v3(STUD_R * c, STUD_R * s, z);
    const wallN = (c, s, z) => v3(c, s, z === z1 ? dome * 0.8 : 0).normalize();
    for (const [c, s, z] of [[c0, s0, z0], [c1, s1, z0], [c1, s1, z1], [c0, s0, z0], [c1, s1, z1], [c0, s0, z1]])
      push(0, P(c, s, z), wallN(c, s, z));
    for (const [c, s] of [[0, 0], [c0, s0], [c1, s1]])
      push(1, P(c, s, z1), v3(c * dome, s * dome, 1).normalize(), [c * 0.5 + 0.5, s * 0.5 + 0.5]);
  }
  const all = groups.flat();
  const count = all.length / 8;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    pos.set(all.slice(i * 8, i * 8 + 3), i * 3);
    nor.set(all.slice(i * 8 + 3, i * 8 + 6), i * 3);
    uv.set(all.slice(i * 8 + 6, i * 8 + 8), i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  let start = 0;
  groups.forEach((gr, i) => { g.addGroup(start, gr.length / 8, i); start += gr.length / 8; });
  g.computeBoundingSphere();
  return g;
}

// The supplied model ("LEGO 1X1 BRICK (correct dimentions).stl", Tinkercad, mm, Z up).
export async function stlBrick(url = './LEGO%201X1%20BRICK%20(correct%20dimentions).stl') {
  const g = await new STLLoader().loadAsync(url);
  g.translate(-4, 33, -5.9);              // body centre (4, -33, 5.9) -> origin
  g.scale(W / 8, W / 8, 1 / 8);           // 8 mm pitch -> 1 unit, with real-LEGO play between bricks
  g.clearGroups();
  g.addGroup(0, g.attributes.position.count, 0);
  g.computeBoundingSphere();
  return g;
}

export function createBricks(choreo, geometry, studNormal, { spec = 0.16, shin = 36, nmap = 0.5 } = {}) {
  const common = { specular: new THREE.Color(spec, spec, spec), shininess: shin };
  const body = new THREE.MeshPhongMaterial({ ...common });
  const cap = new THREE.MeshPhongMaterial({ ...common, normalMap: studNormal, normalScale: new THREE.Vector2(nmap, nmap) });
  const cavity = new THREE.MeshPhongMaterial({ color: new THREE.Color(0.18, 0.18, 0.18), specular: 0x000000, shininess: 4 });
  const mesh = new THREE.InstancedMesh(geometry, [body, cap, cavity], choreo.n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const col = new THREE.Color();
  const palette = Object.fromEntries(Object.entries(BRICK_COLORS).map(([k, v]) => [k, new THREE.Color(v)]));
  for (let i = 0; i < choreo.n; i++) mesh.setColorAt(i, col.copy(palette[choreo.color[i]]));
  mesh.instanceColor.needsUpdate = true;

  const pos = new Float32Array(3), quat = new Float32Array(4);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const update = (t) => {
    const arr = mesh.instanceMatrix.array;
    for (let i = 0; i < choreo.n; i++) {
      evalBrick(choreo, i, t, pos, quat);
      p.set(pos[0], pos[1], pos[2]);
      q.set(quat[0], quat[1], quat[2], quat[3]);
      m.compose(p, q, one);
      m.toArray(arr, i * 16);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  return { mesh, update, materials: { body, cap, cavity } };
}
