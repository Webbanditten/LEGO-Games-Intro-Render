// Everything derived from LEGO_logo.svg: the 60x60 brick mosaic, the flat logo
// texture shown after the mosaic dissolves, and the "LEGO" relief on every stud.
import * as THREE from 'three';
import { N } from './choreography.js';

const VB = 180;                              // the SVG's viewBox is 0 0 180 180
const PALETTE = { W: [255, 255, 255], Y: [255, 237, 0], R: [227, 0, 11], K: [0, 0, 0] };
const R_MARK = [171.924, 54.301, 4.45];      // the (R) is not part of the brick mosaic
const GRID_DY = 0.3;                         // sampling shift that best matches the video

// The flat logo in the video is a deeper crimson / golden yellow than the SVG.
const FLAT_RED = '#D70129';
const FLAT_YELLOW = '#FBC832';

export async function loadLogo(url = './LEGO_logo.svg') {
  const svg = await (await fetch(url)).text();
  const [mosaicImg, flatImg] = await Promise.all([
    svgImage(svg, 1800),
    svgImage(svg.replace(/#E3000B/gi, FLAT_RED).replace(/#FFED00/gi, FLAT_YELLOW), 2048),
  ]);
  const { grid, letterMask } = sampleMosaic(mosaicImg, 1800);
  return { svg, grid, flatTexture: canvasTexture(flatImg, 2048), studNormal: studNormalMap(letterMask) };
}

export function svgImage(svgText, width, height = width) {
  const sized = svgText.replace('<svg ', `<svg width="${width}" height="${height}" `);
  const img = new Image();
  img.decoding = 'sync';
  const done = new Promise((res, rej) => { img.onload = () => res(img); img.onerror = rej; });
  img.src = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  return done;
}

function canvasTexture(img, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(img, 0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// Majority colour per cell (same method that reproduces the video's mosaic 97.7 %).
function sampleMosaic(img, px) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.drawImage(img, 0, 0, px, px);
  const data = ctx.getImageData(0, 0, px, px).data;
  const keys = Object.keys(PALETTE);
  const pal = keys.map((k) => PALETTE[k]);
  const s = px / VB;
  const cls = new Uint8Array(px * px);
  const letterMask = new Uint8Array(px * px);
  for (let p = 0, q = 0; p < cls.length; p++, q += 4) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < 4; k++) {
      const dr = data[q] - pal[k][0], dg = data[q + 1] - pal[k][1], db = data[q + 2] - pal[k][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = k; }
    }
    cls[p] = best;
    letterMask[p] = keys[best] === 'W' ? 255 : 0;
  }
  // paint the (R) red: the brick mosaic in the video has none
  const [rx, ry, rr] = R_MARK;
  for (let y = Math.floor((ry - rr) * s); y <= Math.ceil((ry + rr) * s); y++)
    for (let x = Math.floor((rx - rr) * s); x <= Math.ceil((rx + rr) * s); x++) {
      const u = (x + 0.5) / s - rx, v = (y + 0.5) / s - ry;
      if (u * u + v * v <= rr * rr && x >= 0 && y >= 0 && x < px && y < px) cls[y * px + x] = keys.indexOf('R');
    }
  // integral image per class -> majority vote per cell
  const W = px + 1;
  const I = Array.from({ length: 4 }, () => new Int32Array(W * W));
  for (let k = 0; k < 4; k++) {
    const Ik = I[k];
    for (let y = 0; y < px; y++) {
      let row = 0;
      for (let x = 0; x < px; x++) {
        row += cls[y * px + x] === k ? 1 : 0;
        Ik[(y + 1) * W + x + 1] = Ik[y * W + x + 1] + row;
      }
    }
  }
  const edge = (e, d) => Math.min(px, Math.max(0, Math.round((e + d) * s)));
  const grid = [];
  for (let j = 0; j < N; j++) {
    let line = '';
    const y0 = edge((j * VB) / N, GRID_DY), y1 = edge(((j + 1) * VB) / N, GRID_DY);
    for (let i = 0; i < N; i++) {
      const x0 = edge((i * VB) / N, 0), x1 = edge(((i + 1) * VB) / N, 0);
      let best = 0, bc = -1;
      for (let k = 0; k < 4; k++) {
        const Ik = I[k];
        const cnt = Ik[y1 * W + x1] - Ik[y0 * W + x1] - Ik[y1 * W + x0] + Ik[y0 * W + x0];
        if (cnt > bc) { bc = cnt; best = k; }
      }
      line += keys[best];
    }
    grid.push(line);
  }
  return { grid, letterMask: { data: letterMask, size: px } };
}

// The slanted "LEGO" letters of the logo, embossed on each stud as a normal map.
function studNormalMap(mask, size = 256) {
  // bounding box of the white letters in the SVG
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const m = mask.size;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++)
    if (mask.data[y * m + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const src = document.createElement('canvas');
  src.width = x1 - x0 + 1; src.height = y1 - y0 + 1;
  const sctx = src.getContext('2d');
  const id = sctx.createImageData(src.width, src.height);
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const v = mask.data[(y + y0) * m + x + x0], o = (y * src.width + x) * 4;
    id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
  }
  sctx.putImageData(id, 0, 0);

  // height map: letters span ~76 % of the stud diameter, centred
  const h = document.createElement('canvas');
  h.width = h.height = size;
  const hctx = h.getContext('2d', { willReadFrequently: true });
  hctx.fillStyle = '#000';
  hctx.fillRect(0, 0, size, size);
  const w = size * 0.76, hh = (w * src.height) / src.width;
  hctx.filter = 'blur(1.2px)';
  hctx.drawImage(src, (size - w) / 2, (size - hh) / 2, w, hh);
  const hd = hctx.getImageData(0, 0, size, size).data;

  // Sobel -> tangent-space normals (+Y up, three.js / OpenGL convention)
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const octx = out.getContext('2d');
  const nd = octx.createImageData(size, size);
  const H = (x, y) => hd[((Math.min(size - 1, Math.max(0, y)) * size) + Math.min(size - 1, Math.max(0, x))) * 4] / 255;
  const strength = 3.0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const o = (y * size + x) * 4;
    nd.data[o] = ((nx / l) * 0.5 + 0.5) * 255;
    nd.data[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    nd.data[o + 2] = ((nz / l) * 0.5 + 0.5) * 255;
    nd.data[o + 3] = 255;
  }
  octx.putImageData(nd, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}
