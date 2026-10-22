import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { createServer } from './serve.mjs';
const server = createServer(); await new Promise((r) => server.listen(0, r));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.goto(`http://localhost:${server.address().port}/?capture=1`);
await page.waitForFunction('window.__ready === true');
const g = await page.evaluate(() => window.__grid);
const ref = fs.readFileSync(new URL('../assets/mosaic-60.txt', import.meta.url), 'utf8').trim().split('\n');
let diff = 0; const rows = [];
for (let j = 0; j < 60; j++) { let r = ''; for (let i = 0; i < 60; i++) { if (g[j][i] !== ref[j][i]) { diff++; r += g[j][i].toLowerCase(); } else r += '.'; } rows.push(r); }
console.log('cells differing:', diff);
console.log(g.slice(16, 44).join('\n'));
await browser.close(); server.close();
