import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('.data/_tmp');
fs.mkdirSync(OUT, { recursive: true });

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('sink'); return; }
    const name = decodeURIComponent((req.url || 'shot').replace(/^\//, '').replace(/[^a-z0-9._-]/gi, '')) || 'shot';
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const comma = body.indexOf(',');
      const raw = comma >= 0 ? body.slice(comma + 1) : body;
      const file = path.join(OUT, name.includes('.') ? name : `${name}.jpg`);
      fs.writeFileSync(file, Buffer.from(raw, 'base64'));
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`${path.basename(file)} ${fs.statSync(file).size}`);
    });
  })
  .listen(8799, '127.0.0.1', () => console.log('sink on 8799 ->', OUT));
