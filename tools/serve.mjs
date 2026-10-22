// Tiny zero-dependency static file server for the page and the tools (with HTTP Range
// support, so media files can be streamed and seeked). Listens on the loopback addresses
// (127.0.0.1 and ::1) by default; HOST=0.0.0.0 npm start makes it reachable from the LAN.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  '.stl': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end('bad request'); return; }
  let file = path.join(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }

  const size = fs.statSync(file).size;
  const headers = {
    'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  // single byte ranges: "a-b", "a-" and the suffix form "-n"; anything else gets the whole file
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start, end = size - 1;
    if (m[1] === '') { const n = Number(m[2]); start = n === 0 ? size : Math.max(0, size - n); }
    else { start = Number(m[1]); if (m[2] !== '') end = Math.min(Number(m[2]), size - 1); }
    if (start >= size || start > end) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    send(fs.createReadStream(file, { start, end }), res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    send(fs.createReadStream(file), res);
  }
}

// pipeline() closes the file when the client goes away mid-download (and drops the
// connection on a read error); errors are expected there and need no handling.
const send = (src, res) => pipeline(src, res, () => {});

export function createServer() {
  return http.createServer((req, res) => {
    // no request may throw out of the listener: that would take the whole server down
    try { handle(req, res); } catch {
      if (!res.headersSent) res.writeHead(400).end('bad request');
      else res.destroy();
    }
  });
}

const listen = (server, opts) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(opts, () => { server.off('error', reject); resolve(server); });
});
const NO_IPV6 = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);

// Without HOST it listens on both loopback addresses, so http://localhost/ reaches it
// whichever one `localhost` resolves to. macOS lets a specific address share a port that
// another program holds on the wildcard address (Docker on *:8080, say), which would hand
// localhost to that program, so the wildcards are tried first: a port in use fails loudly.
async function serve() {
  if (host) return [await listen(createServer(), { port, host })];
  for (const probe of [{ host: '0.0.0.0' }, { host: '::', ipv6Only: true }]) {
    try {
      const s = await listen(net.createServer((c) => c.destroy()), { port, ...probe });
      await new Promise((r) => s.close(r));
    } catch (e) {
      if (!(probe.host === '::' && NO_IPV6.has(e.code))) throw e;
    }
  }
  const servers = [await listen(createServer(), { port, host: '127.0.0.1' })];
  try { servers.push(await listen(createServer(), { port, host: '::1' })); } catch (e) {
    if (!NO_IPV6.has(e.code)) { servers[0].close(); throw e; }   // no IPv6 here: 127.0.0.1 alone is localhost
  }
  return servers;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const shown = !host || host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  serve().then((servers) => {
    for (const s of servers) s.on('error', (e) => console.error(`serve: ${e.message}`));
    console.log(`LEGO intro → http://${shown}:${port}/`);
  }, (e) => {
    const why = {
      EADDRINUSE: `port ${port} is already in use by another program. Pick another one: PORT=${port + 1} npm start`,
      EACCES: `no permission to listen on port ${port}. Pick one above 1023: PORT=8080 npm start`,
      EADDRNOTAVAIL: host && `HOST=${host} is not an address of this machine`,
      ENOTFOUND: host && `HOST=${host} is an unknown host name`,
    }[e.code] || e.message;
    console.error(`serve: cannot start: ${why}`);
    process.exit(1);
  });
}
