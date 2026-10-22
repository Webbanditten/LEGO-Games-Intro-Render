// Offline frame-accurate renderer: drives the intro in headless Chrome and
// writes PNG frames + an mp4 (optionally side-by-side with the original).
//
//   node tools/render.mjs [--fps 15] [--from 0] [--to 15.8] [--width 640] [--height 480]
//                         [--out renders/run] [--compare] [--frames 0,30,120]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def;
};

const fps = Number(arg('fps', 15));
const from = Number(arg('from', 0));
const to = Number(arg('to', 15.8));
const width = Number(arg('width', 640));
const height = Number(arg('height', 480));
const out = path.resolve(root, arg('out', 'renders/run'));
const compare = Boolean(arg('compare', false));
const only = arg('frames', null);
const query = arg('query', '');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith('.png')) fs.unlinkSync(path.join(out, f));

const server = createServer();
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.log(`[page ${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[page error]', e.message));
await page.setViewport({ width, height, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${port}/?capture=1${query ? '&' + query : ''}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 60000 });

const frames = only
  ? String(only).split(',').map(Number)
  : Array.from({ length: Math.floor((to - from) * fps + 1e-6) + 1 }, (_, i) => Math.round(from * fps) + i);

const t0 = performance.now();
for (const n of frames) {
  const t = n / fps;
  await page.evaluate((tt) => window.__renderAt(tt), t);
  await page.screenshot({ path: path.join(out, `f_${String(n + 1).padStart(3, '0')}.png`) });
}
console.log(`rendered ${frames.length} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s → ${out}`);
await browser.close();
server.close();

if (!only) {
  const first = Math.round(from * fps) + 1;
  // the soundtrack of the original, trimmed to the rendered range (--audio none to skip)
  const soundtrack = path.join(root, 'intro.mp4');
  const audio = arg('audio', 'original') !== 'none' && fs.existsSync(soundtrack)
    ? ['-ss', String(from), '-i', soundtrack, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-shortest']
    : [];
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-start_number', String(first),
    '-i', path.join(out, 'f_%03d.png'), ...audio,
    '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, 'render.mp4')]);
  if (compare) {
    execFileSync('ffmpeg', ['-v', 'error', '-y',
      '-i', path.join(root, 'intro.mp4'), '-i', path.join(out, 'render.mp4'),
      '-filter_complex', `[0:v]trim=start=${from}:end=${to + 0.01},setpts=PTS-STARTPTS,scale=${width}:${height}[a];[1:v]scale=${width}:${height}[b];[a][b]hstack`,
      '-pix_fmt', 'yuv420p', path.join(out, 'compare.mp4')]);
    console.log(`compare → ${path.join(out, 'compare.mp4')}`);
  }
}
