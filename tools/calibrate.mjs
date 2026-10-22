// Fits the lighting/material parameters so the assembled mosaic (frame 167,
// t = 11.0 s) matches the original's per-colour cell statistics.
//   node tools/calibrate.mjs [--iters 3]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIG = process.env.ORIG_FRAME || '/private/tmp/claude-501/-Users-patrick-Documents-github-lego-logo-intro-recreated/5df32f2b-b614-415f-8cda-32385247ade0/scratchpad/frames/f_167.png';
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
  return e;
}

let p = { amb: 0.275, key: 3.95, kx: 0.015, ky: 0.7, kz: 1.188, fill: 0, spec: 0.16, shin: 36, pillow: 0.35, dome: 0.6, nmap: 0.5 };
const steps = { amb: 0.1, key: 0.5, kx: 0.15, ky: 0.2, kz: 0.25, fill: 0.15, spec: 0.08, shin: 15, pillow: 0.15, dome: 0.25, nmap: 0.25 };
const lo = { amb: 0, key: 0.5, kx: -1.5, ky: -0.5, kz: 0.2, fill: 0, spec: 0, shin: 2, pillow: 0, dome: 0, nmap: 0 };
let best = loss(await measure(p));
console.log('start loss', best.toFixed(4));
for (let it = 0; it < iters; it++) {
  for (const k of Object.keys(p)) {
    for (const dir of [1, -1]) {
      let improved = true;
      while (improved) {
        const q = { ...p, [k]: Math.max(lo[k], +(p[k] + dir * steps[k]).toFixed(3)) };
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
console.log('top', hex(fin.top), '/', hex(target.top), ' bottom', hex(fin.bottom), '/', hex(target.bottom));
console.log('best', JSON.stringify(p), 'loss', best.toFixed(4));
await browser.close();
server.close();
