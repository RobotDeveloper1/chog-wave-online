import * as THREE from 'three';

/**
 * Stand-in figures for crowds and townsfolk.
 *
 * The real Chog models are still being made, so anything that is not the player
 * avatar is built from primitives here instead of loading an unfinished GLB five
 * times over. That also fixes a problem the clones created: a crowd of the same
 * token 1 model reads as a bug, whereas a deliberately simple figure reads as
 * "those are background people".
 *
 * Swap `makeStandin` for the real loader when the models land — the call sites
 * only ever ask for something with `root` and `update(dt)`.
 */

export interface Actor {
  root: THREE.Group;
  update(dt: number): void;
  setSpeed(v: number): void;
  height: number;
}

const SKINS = ['#f0eddb', '#e8b4c8', '#c9a22e', '#8fb37a', '#9fb6d4', '#d49a7a'];
const CLOTHES = ['#4a2f86', '#8c2f4f', '#2f6f5a', '#6b4a2f', '#3b4a8c', '#7a5c2f'];

export function makeStandin(seed = Math.floor(Math.random() * 9999)): Actor {
  const rand = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const skin = new THREE.MeshToonMaterial({ color: new THREE.Color(SKINS[Math.floor(rand(1) * SKINS.length)]!) });
  const cloth = new THREE.MeshToonMaterial({ color: new THREE.Color(CLOTHES[Math.floor(rand(2) * CLOTHES.length)]!) });
  const hair = new THREE.MeshToonMaterial({ color: new THREE.Color().setHSL(rand(3), 0.55, 0.45) });

  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 4, 10), cloth);
  body.position.y = 0.72;
  const head = new THREE.Group();
  head.position.y = 1.32;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 10), skin);
  const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 6), hair);
  tuft.position.set(0, 0.28, 0.05);
  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 5), hair);
  earL.position.set(-0.2, 0.26, 0);
  const earR = earL.clone();
  earR.position.x = 0.2;
  head.add(skull, tuft, earL, earR);
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.34, 3, 6), cloth);
  armL.position.set(-0.42, 0.82, 0);
  const armR = armL.clone();
  armR.position.x = 0.42;
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.3, 3, 6), skin);
  legL.position.set(-0.16, 0.22, 0);
  const legR = legL.clone();
  legR.position.x = 0.16;
  root.add(body, head, armL, armR, legL, legR);

  let clock = rand(4) * 20;
  let speed = 0;

  return {
    root,
    height: 1.65,
    setSpeed(v: number) {
      speed = Math.max(0, Math.min(1, v));
    },
    update(dt: number) {
      clock += dt;
      // Same trick as the rigged characters: opposite limbs and a hip bob are
      // enough to read as walking, and nothing here needs a skeleton.
      const phase = clock * (speed > 0.05 ? 8.5 : 1.5);
      const amp = speed > 0.05 ? 0.55 : 0.03;
      legL.rotation.x = Math.sin(phase) * amp;
      legR.rotation.x = -Math.sin(phase) * amp;
      armL.rotation.x = -Math.sin(phase) * amp * 0.8;
      armR.rotation.x = Math.sin(phase) * amp * 0.8;
      body.position.y = 0.72 + Math.abs(Math.sin(phase)) * (speed > 0.05 ? 0.05 : 0.012);
      head.rotation.y = speed > 0.05 ? Math.sin(phase) * 0.06 : Math.sin(clock * 0.4) * 0.3;
      tuft.rotation.z = Math.sin(clock * 4.2) * 0.09 * (0.3 + speed);
    },
  };
}
