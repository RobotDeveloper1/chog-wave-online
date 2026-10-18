import { cityOf } from '@chog/shared';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { DISTRICTS } from './app/art.ts';
import { buildCity } from './app/city/build.ts';
import { buildRoom, type RoomKind } from './app/interiors.ts';

// Bake tool: builds Genesis with the game's own city builder (the real
// buildings, textures, signs and props) plus every shop/room interior, and
// POSTs each as a GLB to a local receiver, so the Babylon project loads the
// game as it actually looks instead of re-drawing it from plan data.
const log = (m: string) => { document.getElementById('log')!.textContent = m; console.log(m); };

async function post(name: string, group: unknown): Promise<void> {
  const exporter = new GLTFExporter();
  const glb = (await exporter.parseAsync(group as never, { binary: true })) as ArrayBuffer;
  const res = await fetch('http://localhost:8799/' + name, { method: 'POST', body: glb });
  log(`${name}: ${(glb.byteLength / 1e6).toFixed(2)} MB -> ${res.status}`);
}

async function main(): Promise<void> {
  const city = buildCity(cityOf('ashflat'), DISTRICTS.ashflat);
  log(`city built: ${city.triangles} triangles`);
  await post('city.glb', city.group);
  const rooms: [RoomKind, string][] = [
    ['shop', 'CHIP SHOP'], ['heal', 'CLINIC'], ['station', 'WAVE STATION'],
    ['brother', 'TRIBE HALL'], ['telemetry', 'TERMINAL'], ['dungeon', 'FOLD GATE'],
  ];
  for (const [kind, label] of rooms) {
    const room = buildRoom(kind, DISTRICTS.ashflat, label);
    await post(`room-${kind}.glb`, room.group);
  }
  log('all baked');
  (window as unknown as { __bakeDone?: boolean }).__bakeDone = true;
}
main().catch((e) => log('BAKE FAILED: ' + ((e as Error)?.stack ?? e)));
