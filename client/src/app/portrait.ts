import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * A Chog face, off-screen.
 *
 * The dialogue box wants the *model's* face — the same 3D Chog walking the street —
 * not a flat sprite. So we clone whatever model is standing in front of you, frame a
 * close-up of its head, render it once into a tiny off-screen canvas, and hand back a
 * data URL. One small WebGL context is created lazily and reused for every face.
 *
 * Facing is found from the model's own facial parts (eyes / nose / mouth), so a Chog
 * whose pivot points the "wrong" way still turns to the camera instead of showing its
 * back. Framing is derived from the model's real height, so a big golem and a small
 * spark frame the same.
 */

const W = 256;
const H = 320;

let renderer: THREE.WebGLRenderer | null = null;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(38, W / H, 0.05, 60);

const FACE_PART = /eye|nose|mouth|blush|glint/i;
/** The live renderer, for the coverage probe. Set by `ensure()`; only read after it has run. */
let r0: THREE.WebGLRenderer | null = null;
/**
 * Everything that belongs to the head. Used to frame the portrait: a Chog is chibi, so half its
 * bounding box is legs — any framing derived from the body's height lands on the chest or worse.
 */
const HEAD_PART = /head|mane|hair|tuft|ear|horn|hat|face|eye|nose|mouth|blush|glint/i;

function ensure(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r0 = renderer;
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  cam.aspect = W / H;
  cam.updateProjectionMatrix();
  scene.add(new THREE.AmbientLight(0xffffff, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(1.4, 1.8, 2.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb0ff, 0.6);
  rim.position.set(-1.6, 0.6, -1.2);
  scene.add(rim);
  return renderer;
}

/**
 * Which way the face looks, averaged over the facial parts.
 *
 * Returns null when the rig exposes no named face parts — the caller then has to decide without
 * evidence, and the honest answer there is "measure it" rather than "assume a convention".
 */
function faceDirection(clone: THREE.Object3D, centre: THREE.Vector3): { x: number; z: number } | null {
  // Sum from ZERO, not from the centre. Starting from the centre and dividing by n afterwards
  // yields `(centre + Σp)/n - centre`, which is the true offset only when the model happens to be
  // centred on the origin — and for a single eye it is off by the whole centre.
  let fx = 0;
  let fz = 0;
  let n = 0;
  clone.traverse((o) => {
    if (!FACE_PART.test(o.name)) return;
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    fx += p.x; fz += p.z; n++;
  });
  if (!n) return null;
  return { x: fx / n - centre.x, z: fz / n - centre.z };
}

/** How much of the frame is filled, 0..1. The face side of a head is the fuller side. */
function coverage(): number {
  const g = r0!.domElement.getContext('2d');
  if (!g) return 0;
  const { data } = g.getImageData(0, 0, W, H);
  let on = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 24) on++;
  return on / (W * H);
}

/**
 * Render `root` (a Chog `THREE.Group`) as a head close-up. Returns a PNG data URL,
 * or null if the model can't be framed. Never disposes shared geometry/materials —
 * a clone shares them with the live avatar, so we only detach the clone.
 */
export function faceUrl(root: THREE.Group): string | null {
  let r: THREE.WebGLRenderer;
  try {
    r = ensure();
  } catch {
    return null; // no WebGL context available (headless, out of memory): caller falls back
  }
  r0 = r;
  const clone = cloneSkinned(root);
  // The live avatar carries the yaw it happens to be standing at on the street. Measure the face
  // in the model's OWN space instead, so the portrait does not depend on which way its owner was
  // turned when you walked up — otherwise an NPC mid-turn comes out in profile.
  clone.rotation.set(0, 0, 0);
  clone.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  box.getSize(size);
  const height = size.y;
  if (!(height > 0)) {
    scene.remove(clone);
    return null;
  }
  const centre = box.getCenter(new THREE.Vector3());
  const facing = faceDirection(clone, centre);

  const pivot = new THREE.Group();
  pivot.add(clone);
  // Centre the model on the pivot so the turn spins it in place.
  clone.position.sub(centre);

  /*
   * Which way to turn.
   *
   * With named face parts the answer is measured: rotate so the averaged face points at +Z, where
   * the camera is. Without them the old code applied a flat `Math.PI` on the theory that "the rigs
   * all face -Z in their own space" — and that theory is the bug. A rig facing +Z got turned to -Z,
   * which put the back of the head in the frame, and because most of the cast had no face parts
   * named, most of the cast came out backwards.
   *
   * So instead of assuming, measure: render both orientations and keep whichever fills more of the
   * frame. The face side of a head is the fuller side — a nose, a brow, a snout — while the back is
   * a near-smooth dome. Two extra renders of a 256×320 off-screen canvas is nothing, and it is
   * correct for every rig convention without knowing any of them.
   */
  const measured = facing ? -Math.atan2(facing.x, facing.z) : null;
  let bestYaw = measured ?? 0;
  if (measured === null) {
    let best = -1;
    for (const yaw of [0, Math.PI]) {
      pivot.rotation.y = yaw;
      pivot.updateMatrixWorld(true);
      r.render(scene, cam);
      const c = coverage();
      if (c > best) { best = c; bestYaw = yaw; }
    }
  }
  pivot.rotation.y = bestYaw;
  scene.add(pivot);

  // Frame the HEAD box, in the pivot's (centred) space. The model's own origin is wherever Blender
  // left it — on the Chog rigs it is the feet — so neither the pivot nor the body's midpoint can be
  // trusted as "the face". The head parts can.
  const head = new THREE.Box3();
  clone.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && HEAD_PART.test(o.name)) head.expandByObject(o);
  });
  const headSize = new THREE.Vector3();
  const headCentre = new THREE.Vector3();
  if (!head.isEmpty()) {
    head.getSize(headSize);
    head.getCenter(headCentre);
  } else {
    // No named head parts: the crown of the bounding box is still the head, so take the top third.
    headSize.set(size.x, height * 0.3, size.z);
    headCentre.set(centre.x, box.max.y - height * 0.15, centre.z);
  }
  const aimY = headCentre.y - centre.y;
  const spanY = Math.max(headSize.y * 1.45, height * 0.35);
  const dist = Math.max(1.4, spanY / (2 * Math.tan((cam.fov * Math.PI) / 180 / 2)));
  cam.position.set(0, aimY, dist);
  cam.lookAt(0, aimY, 0);
  cam.updateProjectionMatrix();

  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  scene.remove(pivot);
  pivot.remove(clone);
  return url;
}
