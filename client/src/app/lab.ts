import * as THREE from 'three';
import { cityOf, type SectorId } from '@chog/shared';
import { DISTRICTS } from './art.ts';
import { buildCity, type CityScene } from './city/build.ts';
import { Stage } from './stage.ts';

/**
 * The city lab: the new renderer, the new camera and one district, with a marker to walk.
 * It exists so the look can be judged without a server, a wallet or a HUD in the way, and
 * it stays because it is also the fastest way to see a plan change.
 */

export function bootLab(): void {
  const q = new URLSearchParams(location.search);
  let sector = (q.get('z') as SectorId) || 'ashflat';
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const stage = new Stage(canvas);

  let city: CityScene | null = null;
  const marker = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.1, 4, 10), new THREE.MeshLambertMaterial({ color: 0xffb0d0 }));
  body.position.y = 1.0;
  body.castShadow = true;
  marker.add(body);
  stage.scene.add(marker);

  const pos = new THREE.Vector3();
  let facing = Math.PI;
  const keys = new Set<string>();
  addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());
    if (e.key.toLowerCase() === 'q') stage.director.rotate(-1);
    if (e.key.toLowerCase() === 'e') stage.director.rotate(1);
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('wheel', (e) => stage.setZoom(stage.zoom * Math.exp(e.deltaY * 0.0012)), { passive: true });

  const resize = (): void => {
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    stage.resizeTo(canvas);
  };
  addEventListener('resize', resize);

  const load = (s: SectorId): void => {
    sector = s;
    if (city) {
      stage.scene.remove(city.group);
      city.dispose();
    }
    const layout = cityOf(s);
    const art = DISTRICTS[s];
    city = buildCity(layout, art);
    stage.scene.add(city.group);
    stage.setDistrict(art, s);
    const b = layout.bounds;
    stage.setBounds({ minX: b.x0, maxX: b.x1, minZ: b.z0, maxZ: b.z1 });
    const sp = layout.anchors.find((a) => a.kind === 'spawn')!;
    const tx = Number(q.get('x'));
    const tz = Number(q.get('y'));
    pos.set(q.has('x') && Number.isFinite(tx) ? tx : sp.x, 0, q.has('y') && Number.isFinite(tz) ? tz : sp.z);
    stage.snap();
    // Screenshot survey: ?span= widens the frame, ?yaw=/?pitch= turn it. Degrees.
    const span = Number(q.get('span'));
    if (q.has('span') && Number.isFinite(span)) stage.tuneCamera({ span });
    const pitch = Number(q.get('pitch'));
    if (q.has('pitch') && Number.isFinite(pitch)) stage.tuneCamera({ pitch });
    const yawDeg = Number(q.get('yaw'));
    if (q.has('yaw') && Number.isFinite(yawDeg)) stage.director.setYaw((yawDeg * Math.PI) / 180, true);
    resize();
  };

  const collide = (): void => {
    if (!city) return;
    const { bounds, solids } = city.layout;
    pos.x = Math.max(bounds.x0, Math.min(bounds.x1, pos.x));
    pos.z = Math.max(bounds.z0, Math.min(bounds.z1, pos.z));
    for (const s of solids) {
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      const ox = s.halfW + 0.55 - Math.abs(dx);
      const oz = s.halfD + 0.55 - Math.abs(dz);
      if (ox <= 0 || oz <= 0) continue;
      if (ox < oz) pos.x += Math.sign(dx || 1) * ox;
      else pos.z += Math.sign(dz || 1) * oz;
    }
  };

  load(sector);
  let last = performance.now();
  let t = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const yaw = stage.director.yaw;
    const ix = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const iz = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    // Screen-relative: W is "up the screen", which at this yaw is a diagonal of the map.
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const dx = rx * ix + fx * -iz;
    const dz = rz * ix + fz * -iz;
    const moving = ix !== 0 || iz !== 0;
    if (moving) {
      const len = Math.hypot(dx, dz) || 1;
      const sp = keys.has('shift') ? 16 : 8;
      pos.x += (dx / len) * sp * dt;
      pos.z += (dz / len) * sp * dt;
      facing = Math.atan2(dx, dz);
      collide();
    }
    const y = city ? city.groundY(pos.x, pos.z) : 0;
    marker.position.set(pos.x, y, pos.z);
    marker.rotation.y = facing;
    stage.follow(pos.x, pos.z, facing, moving, dt);
    city?.update(t, dt, stage.director.focusPoint(), { wave: Number(q.get('wave') ?? 40), tier: (q.get('tier') as 'normal') || 'normal' });
    stage.render(dt);
    const info = stage.debug();
    hud.textContent = `${sector.toUpperCase()}  ·  ${city ? `${(city.triangles / 1000).toFixed(0)}k tris built in ${city.buildMs.toFixed(0)}ms` : ''}\ndraw calls ${info.calls} · ${(info.triangles / 1000).toFixed(0)}k drawn\n${JSON.stringify(stage.director.describe())}\nWASD move · Q/E rotate · wheel zoom`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  (window as unknown as { __lab: unknown }).__lab = {
    stage,
    get city() {
      return city;
    },
    load,
    tp(x: number, z: number) {
      pos.set(x, 0, z);
      stage.snap();
    },
    cam: (p?: Parameters<Stage['tuneCamera']>[0]) => {
      if (p) stage.tuneCamera(p);
      return stage.director.describe();
    },
    yaw: (deg: number) => stage.director.setYaw((deg * Math.PI) / 180, true),
  };
}
