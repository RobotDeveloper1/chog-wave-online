import * as THREE from 'three';
import { DISTRICTS } from './art.ts';
import { Explorer } from './explorer.ts';
import type { PartsModel } from './chogLoader.ts';
import { Stage } from './stage.ts';

/**
 * The gate's backdrop: the real city, in the real engine, behind the login panel.
 *
 * The front door used to paint its own 2D street on a canvas -- a nice illustration of a game
 * that was standing right there, unrendered, behind it. The map *is* the game, so the gate shows
 * it: the same district the shell will hand you, built by the same `Explorer`, drifting under a
 * slow cinematic orbit while you pick a Chog. The panel floats over it as glass.
 *
 * It is a stage of its own, because the shell's does not exist yet, and it is thrown away the
 * moment the gate closes -- hence `Stage.dispose`.
 */

/** The same six URLs the shell loads its Chogs from. Kept here so the gate does not need the shell. */
const MODEL: PartsModel = {
  baseUrl: '/models/chog-base.glb',
  partsUrl: '/models/trait-parts.json',
  colorsUrl: '/models/trait-colors.json',
  skinsUrl: '/models/skins.json',
  skullBaseUrl: '/models/chog-skull.glb',
  skullSkinsUrl: '/models/skull-skins.json',
};

export function cityBackdrop(canvas: HTMLCanvasElement): { stop(): void } {
  let stage: Stage;
  try {
    stage = new Stage(canvas);
  } catch {
    // No WebGL: the gate still works, it is just a dark screen. Never block the door on the decor.
    return { stop() {} };
  }

  const explorer = new Explorer(stage, MODEL, () => ({ wave: 0, tier: 'normal' }));
  const host = canvas.parentElement ?? canvas;
  const spawn = explorer.enter('ashflat', null);
  stage.resizeTo(host);
  stage.setDistrict(DISTRICTS.ashflat, 'ashflat');

  // The shot: a slow orbit around the spawn, high enough to read the plan, low enough that the
  // roofs have depth, with a long breath in the height so it is never quite still.
  let t = 0;
  stage.setCameraControl((cam, dt) => {
    t += dt;
    const a = t * 0.045;
    const r = 96;
    cam.position.set(
      spawn.x + Math.cos(a) * r,
      54 + Math.sin(t * 0.11) * 7,
      spawn.z + Math.sin(a) * r,
    );
    cam.lookAt(spawn.x, 7, spawn.z);
    cam.fov = 32;
    cam.near = 1;
    cam.far = 900;
    cam.updateProjectionMatrix();
  });
  stage.snap();

  const onResize = (): void => stage.resizeTo(host);
  addEventListener('resize', onResize);

  let raf = 0;
  let last = performance.now();
  const focus = new THREE.Vector3(spawn.x, 4, spawn.z);
  const loop = (): void => {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // The city's own life -- traffic, lamps, the crowd -- keeps running behind the gate, so the
    // place you are looking at is the place you are about to walk into.
    explorer.update(dt, spawn.x, spawn.z, focus);
    stage.render(dt);
  };
  loop();

  return {
    stop() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
      explorer.dispose();
      stage.dispose();
    },
  };
}
