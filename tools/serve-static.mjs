/**
 * A static server for a built client, so a play session cannot be interrupted by a file save.
 *
 * Why this exists: the dev server watches the source tree, and this project is worked on by more
 * than one session at a time. A save in `picker.ts` reloads every open page -- including the one
 * someone is playing in. A built bundle has no watcher, so it holds still.
 *
 * It only serves files. The client is built with `VITE_SERVER`/`VITE_WS` pointing straight at the
 * game server, which sends `access-control-allow-origin: *`, so there is nothing to proxy here.
 *
 * node tools/serve-static.mjs [dir] [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? 'client/dist-play');
const PORT = Number(process.argv[3] ?? 5176);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.map': 'application/json; charset=utf-8',
};

http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  // Containment: a request for `../../etc/passwd` must not escape the build directory.
  if (!file.startsWith(ROOT)) return res.writeHead(403).end('forbidden');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    // The client routes by query string, so an unknown path is the app itself, not a 404 page.
    const index = path.join(ROOT, 'index.html');
    if (!fs.existsSync(index)) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    return res.end(fs.readFileSync(index));
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(fs.readFileSync(file));
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}/`));
