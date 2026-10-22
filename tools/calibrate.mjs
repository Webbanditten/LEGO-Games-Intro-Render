// Fits the lighting/material parameters so the assembled mosaic (frame 167,
// t = 11.0 s) matches the original's per-colour cell statistics.
//   node tools/calibrate.mjs [--iters 3]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the original's assembled mosaic (tools/extract-original.sh)
const ORIG = process.env.ORIG_FRAME || path.join(root, 'renders/original/f_167.png');
const iters = Number(process.argv[process.argv.indexOf('--iters') + 1]) || 3;
const grid = fs.readFileSync(path.join(root, 'assets/mosaic-60.txt'), 'utf8').trim().split('\n');

const server = createServer();
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 480, deviceScaleFactor: 1 });

// Same measurement as tools/mosaic_colors.py, in linear light.
const measureSrc = `(data, grid) => {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const px = (x, y) => { const o = (y * 640 + x) * 4; return [lin(data[o]), lin(data[o + 1]), lin(data[o + 2])]; };
  const med = (arr) => [0, 1, 2].map((c) => { const v = arr.map((a) => a[c]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const out = {};
  for (const key of 'RWYK') {
    const means = [], highs = [], seams = [];
    for (let j = 1; j < 59; j++) for (let i = 1; i < 59; i++) {
      if (grid[j][i] !== key || grid[j][i + 1] !== key || grid[j][i - 1] !== key || grid[j + 1][i] !== key || grid[j - 1][i] !== key) continue;
      const cx = 152.3 + 5.4 * i, cy = 78.6 + 5.39 * j, x0 = Math.round(cx - 2.7), y0 = Math.round(cy - 2.7);
      let m = [0, 0, 0], best = null, bl = -1;
      for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 5; x++) {
        const p = px(x, y); m = m.map((v, c) => v + p[c] / 25);
        const l = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; if (l > bl) { bl = l; best = p; }
      }
      means.push(m); highs.push(best); seams.push(px(Math.round(cx - 2.7), Math.round(cy - 2.7)));
    }
    if (means.length) out[key] = { mean: med(means), stud: med(highs), seam: med(seams) };
  }
  const rows = (j0, j1) => { const a = []; for (let j = j0; j < j1; j++) for (let i = 5; i < 55; i++) a.push(px(Math.round(152.3 + 5.4 * i), Math.round(78.6 + 5.39 * j))); return med(a); };
  out.top = rows(1, 8); out.bottom = rows(50, 58);
  // stripe orientation in the top red field: horizontal vs vertical luminance change
  // (the original's stud highlights line up in horizontal rows: V/H ~ 0.5)
  let gx = 0, gy = 0, field = [0, 0, 0], nf = 0;
  const L = (x, y) => { const p = px(x, y); return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; };
  for (let y = 89; y < 154; y++) for (let x = 179; x < 449; x++) {
    gx += Math.abs(L(x + 1, y) - L(x, y)); gy += Math.abs(L(x, y + 1) - L(x, y));
    const p = px(x, y); field = field.map((v, c) => v + p[c]); nf++;
  }
  out.vh = gx / gy;
  out.field = field.map((v) => v / nf);   // whole-area average: seams included
  return out;
}`;

async function measureOriginal() {
  await page.goto(`http://localhost:${port}/?capture=1`);
  await page.waitForFunction('window.__ready === true');
  const b64 = fs.readFileSync(ORIG).toString('base64');
  return page.evaluate(async (b64, grid, src) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    return eval(src)(ctx.getImageData(0, 0, 640, 480).data, grid);
  }, b64, grid, measureSrc);
}

async function measure(p) {
  const q = Object.entries(p).map(([k, v]) => `${k}=${v}`).join('&');
  await page.goto(`http://localhost:${port}/?capture=1&${q}`);
  await page.waitForFunction('window.__ready === true');
  return page.evaluate((grid, src) => {
    window.__renderAt(11.0);
    const gl = document.getElementById('c');
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const ctx = c.getContext('2d'); ctx.drawImage(gl, 0, 0);
    return eval(src)(ctx.getImageData(0, 0, 640, 480).data, grid);
  }, grid, measureSrc);
}

const target = await measureOriginal();
const W = { R: 3, W: 1, Y: 0.5, K: 2 };
function loss(m) {
  let e = 0;
  const d = (a, b, w) => { for (let c = 0; c < 3; c++) e += w * (Math.sqrt(a[c]) - Math.sqrt(b[c])) ** 2; };
  for (const k of 'RWYK') if (m[k] && target[k]) { d(m[k].mean, target[k].mean, W[k] * 2); d(m[k].stud, target[k].stud, W[k]); d(m[k].seam, target[k].seam, W[k]); }
  d(m.top, target.top, 2); d(m.bottom, target.bottom, 2);
  e += 0.6 * Math.log(m.vh / target.vh) ** 2;
  d(m.field, target.field, 8);
  return e;
}

// lighting values are the settled-mosaic end of the rig in src/lighting.js (URL: mosaic.<k>);
// pillow / dome / nmap are the brick shading in src/main.js (LOOK)
let p = { 'mosaic.amb': 0.8, 'mosaic.key': 2.15, 'mosaic.kx': -0.1, 'mosaic.ky': 0.1, 'mosaic.kz': 0.9, 'mosaic.fill': 0.524,
  'mosaic.spec': 0.08, 'mosaic.shin': 96, pillow: 0.2, dome: 0.225, nmap: 3.5 };
const steps = { 'mosaic.amb': 0.1, 'mosaic.key': 0.4, 'mosaic.kx': 0.05, 'mosaic.ky': 0.15, 'mosaic.kz': 0.2, 'mosaic.fill': 0.15,
  'mosaic.spec': 0.04, 'mosaic.shin': 15, pillow: 0.1, dome: 0.1, nmap: 0.5 };
const lo = { 'mosaic.amb': 0, 'mosaic.key': 0.5, 'mosaic.kx': -0.12, 'mosaic.ky': 0, 'mosaic.kz': 0.6, 'mosaic.fill': 0,
  'mosaic.spec': 0, 'mosaic.shin': 8, pillow: 0, dome: 0, nmap: 0 };
const hi = { 'mosaic.kx': 0.12, 'mosaic.ky': 0.35, nmap: 3.5 };
let best = loss(await measure(p));
console.log('start loss', best.toFixed(4));
for (let it = 0; it < iters; it++) {
  for (const k of Object.keys(p)) {
    for (const dir of [1, -1]) {
      let improved = true;
      while (improved) {
        const q = { ...p, [k]: Math.min(hi[k] ?? Infinity, Math.max(lo[k], +(p[k] + dir * steps[k]).toFixed(3))) };
        const l = loss(await measure(q));
        improved = l < best - 1e-5;
        if (improved) { best = l; p = q; console.log(`  ${k}=${p[k]}  loss ${best.toFixed(4)}`); }
      }
    }
  }
  for (const k of Object.keys(steps)) steps[k] /= 2;
}
const fin = await measure(p);
const hex = (c) => '#' + c.map((v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055))).map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
for (const k of 'RWYK') console.log(k, 'mean', hex(fin[k].mean), '/', hex(target[k].mean), ' stud', hex(fin[k].stud), '/', hex(target[k].stud), ' seam', hex(fin[k].seam), '/', hex(target[k].seam));
console.log('top', hex(fin.top), '/', hex(target.top), ' bottom', hex(fin.bottom), '/', hex(target.bottom), ' V/H', fin.vh.toFixed(2), '/', target.vh.toFixed(2), ' field', hex(fin.field), '/', hex(target.field));
console.log('best', JSON.stringify(p), 'loss', best.toFixed(4));
await browser.close();
server.close();
