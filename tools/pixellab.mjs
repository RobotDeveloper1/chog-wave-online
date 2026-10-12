#!/usr/bin/env node
// Minimal MCP-over-streamable-HTTP client for PixelLab, so asset generation is not
// blocked on the host session reloading its MCP servers.
//   node tools/pixellab.mjs tools
//   node tools/pixellab.mjs schema <tool>
//   node tools/pixellab.mjs call <tool> '<json>' [outDir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const settings = JSON.parse(
  readFileSync(join(process.env.USERPROFILE, '.qoder', 'settings.json'), 'utf8'),
);
const cfg = settings.mcpServers?.pixellab;
if (!cfg?.url) throw new Error('mcpServers.pixellab not found in user settings');

let sessionId = null;
let nextId = 1;

async function rpc(method, params, isNotification = false) {
  const body = isNotification
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: nextId++, method, params };
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...cfg.headers,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${method}: ${text.slice(0, 400)}`);
  if (isNotification) return null;
  // Streamable HTTP answers either as bare JSON or as an SSE stream of `data:` frames.
  const frames = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => JSON.parse(l.slice(5).trim()));
  const msgs = frames.length ? frames : [JSON.parse(text)];
  const mine = msgs.find((m) => m.id != null) ?? msgs[0];
  if (mine?.error) throw new Error(`${method}: ${JSON.stringify(mine.error)}`);
  return mine?.result;
}

async function connect() {
  const info = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'chog-build', version: '0.1' },
  });
  await rpc('notifications/initialized', {}, true);
  return info;
}

function collectImages(content) {
  const out = [];
  for (const block of content ?? []) {
    if (block.type === 'image' && block.data) out.push({ ext: 'png', b64: block.data });
    else if (block.type === 'resource' && block.resource?.blob)
      out.push({ ext: 'png', b64: block.resource.blob });
  }
  return out;
}

function describe(result) {
  const text = (result?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const images = collectImages(result?.content);
  return { text, images, structured: result?.structuredContent };
}

// In a JSON args string, "@<path>" as a value is replaced by that file's base64,
// so large PNGs never travel through the command line.
function expandRefs(json) {
  return json.replace(/"@([^"\s]+\.[a-zA-Z0-9]{2,4})"/g, (_m, p) =>
    JSON.stringify(readFileSync(p).toString('base64')),
  );
}

const [cmd, ...rest] = process.argv.slice(2);
const server = await connect();

if (cmd === 'tools') {
  const { tools } = await rpc('tools/list', {});
  console.log(`server: ${server.serverInfo.name} ${server.serverInfo.version} — ${tools.length} tools\n`);
  for (const t of tools) console.log(`### ${t.name}\n${(t.description ?? '').replace(/\s+/g, ' ').slice(0, 300)}\n`);
} else if (cmd === 'schema') {
  const { tools } = await rpc('tools/list', {});
  const t = tools.find((x) => x.name === rest[0]);
  if (!t) throw new Error(`no tool ${rest[0]}`);
  console.log(JSON.stringify({ name: t.name, description: t.description, schema: t.inputSchema }, null, 2));
} else if (cmd === 'call') {
  const [name, jsonArgs = '{}', outDir = '.data/pixellab'] = rest;
  const result = await rpc('tools/call', { name, arguments: JSON.parse(expandRefs(jsonArgs)) });
  const { text, images, structured } = describe(result);
  if (structured) console.log('structured:', JSON.stringify(structured).slice(0, 1500));
  if (text) console.log(text.slice(0, 2000));
  mkdirSync(outDir, { recursive: true });
  images.forEach((img, i) => {
    const file = join(outDir, `${name}-${Date.now()}-${i}.${img.ext}`);
    writeFileSync(file, Buffer.from(img.b64, 'base64'));
    console.log(`wrote ${file} (${Math.round(img.b64.length * 0.75 / 1024)} KB)`);
  });
  if (!images.length) console.log('(no image blocks in result)');
} else {
  console.log('usage: pixellab.mjs <tools|schema|call> ...');
}
