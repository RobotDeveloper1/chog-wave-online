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
const HEAD_PART = /head|mane|hair|tuft|ear|horn|hat|face|eye|nose|mouth|blush|glint|form/i;

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
  // Measure GEOMETRY centroids, never object origins. An assembled Chog's face parts are either
  // skinned (base eyes, whose object transform never leaves the bind pose) or attach()ed under
  // the Head bone (trait parts, whose origins all collapse onto the bone) — averaging origins
  // yields the bone's own position, which sits within pose-jitter of the bbox centre, and the
  // yaw came out a coin flip: some dialogue portraits faced backwards on every load.
  let fx = 0;
  let fz = 0;
  let n = 0;
  const c = new THREE.Vector3();
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !FACE_PART.test(o.name)) return;
    const g = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!g || !g.boundingBox) {
      try { g?.computeBoundingBox?.(); } catch { return; }
    }
    const bb = g?.boundingBox;
    if (!bb) return;
    bb.getCenter(c).applyMatrix4(o.matrixWorld);
    fx += c.x; fz += c.z; n++;
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
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 24) on++;
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
  // trusted as "the face". The head parts can — except the hat, which framing must ignore: a
  // Silver Thorn spans twice the head, and framing it put the thorns in the portrait instead of
  // the face. Caps crop at the top edge, which is what a face close-up is for.
  // NOTE: no bare "head" here — it used to lead this list and excluded the skull itself,
  // so the frame was measured off the mouth and the lens sat on the lips. Headband stays:
  // it is the only head-worn trait whose name does not contain "hat".
  const HAT_PART = /hat|cap|helmet|hood|crown|beanie|wig|thorn|headband|horn|hair|tuft|mane|skull/i;
  const head = new THREE.Box3();
  clone.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && HEAD_PART.test(o.name) && !HAT_PART.test(o.name)) head.expandByObject(o);
  });
  if (head.isEmpty()) {
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && HEAD_PART.test(o.name)) head.expandByObject(o);
    });
  }
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
  // The dialogue box shows this PNG cover-fit in a SQUARE card, so the head must sit
  // small in the frame with shoulders and air around it - a head filling the PNG reads
  // as a nose pressed to the glass. ~30% of the frame height is a bust, not a mugshot.
  const spanY = Math.max(headSize.y * 2.4, height * 0.62);
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

/**
 * Render `root` as a full-body still in three-quarter view. Same off-screen
 * renderer as `faceUrl`, so shelf snapshots cost no extra WebGL context: the
 * picker mounts each detected Chog once, shoots it, and shows the PNG.
 */
export function bodyUrl(root: THREE.Group): string | null {
  let r: THREE.WebGLRenderer;
  try {
    r = ensure();
  } catch {
    return null;
  }
  r0 = r;
  const clone = cloneSkinned(root);
  clone.rotation.set(0, 0, 0);
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!(size.y > 0)) {
    scene.remove(clone);
    return null;
  }
  const centre = box.getCenter(new THREE.Vector3());
  const facing = faceDirection(clone, centre);
  const pivot = new THREE.Group();
  pivot.add(clone);
  clone.position.sub(centre);
  // Face the camera, then turn: a 3/4 view reads as a model, not a mugshot.
  pivot.rotation.y = (facing ? -Math.atan2(facing.x, facing.z) : 0) + 0.55;
  scene.add(pivot);
  const span = Math.max(size.y * 1.35, (size.x * 1.6) / cam.aspect);
  const dist = Math.max(1.4, span / (2 * Math.tan((cam.fov * Math.PI) / 180 / 2)));
  cam.position.set(0, 0, dist);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  scene.remove(pivot);
  pivot.remove(clone);
  return url;
}
