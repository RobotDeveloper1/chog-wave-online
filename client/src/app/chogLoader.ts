import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { applyMotion, rigOf, type MotionKind } from './motion.ts';

/**
 * Loads a Chog GLB and makes it look like the Blender original.
 *
 * Two export quirks drive everything here. glTF only carries base colour from a
 * Principled setup, and the Blender toon shader is a hand node tree, so all 13
 * materials arrive as pure black — names survive, so colour comes from the
 * per-token manifest instead. And `skins` is empty: animation is rigid per-node
 * transforms, so parts never deform, they only swing.
 */

export type ChogClip = 'idle' | 'walk' | 'attack' | 'hit';

export interface Chog {
  root: THREE.Group;
  clips: ChogClip[];
  play(name: ChogClip): void;
  update(dt: number): void;
  /** Height in world units, so callers can ground the model without guessing. */
  height: number;
  /** Drives the one-shot attack/hit poses; 0 restarts them. */
  impulse(seconds?: number): number;
  /** Locomotion fraction 0..1, fed from the avatar's real speed. */
  setSpeed(v: number): void;
}

// Three-tone ramp keeps the banded cel look; the default is a soft gradient.
const ramp = (() => {
  const t = new THREE.DataTexture(
    new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]),
    3,
    1,
    THREE.RGBAFormat,
  );
  t.needsUpdate = true;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
})();

// Outline thickness is absolute world distance along the normal. Scaling the hull
// by a percentage looked right on the head and swallowed the eyes, which sit
// proud of it. 0.022 was nearly double the Blender hull (0.012-0.015) and showed
// as a black bar across the face in the close-up duel/street cameras.
//
// Exported because it is shared by every Chog on screen: a caller that despawns one Chog must
// not dispose it, or it tears the program out from under all the others.
export const hullMaterial = new THREE.ShaderMaterial({
  vertexShader: `
    uniform float kThickness;
    void main() {
      vec3 pos = position + normal * kThickness;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 kColor;
    void main() { gl_FragColor = vec4(kColor, 1.0); }`,
  uniforms: {
    kThickness: { value: 0.012 },
    kColor: { value: new THREE.Color(0x120a1c) },
  },
  side: THREE.BackSide,
});

// The Blender pipeline keeps its own NO_INK list: eyes, highlights, blush, nose
// and mouth are flat facial details with NO hull there -- hulling them in the
// client drew a dark shell over the face, which is the "black face on breathe"
// the rig showed. Same names here so the two stay one decision.
const NO_HULL = ['chog_eye_', 'chog_glint_', 'chog_blush_', 'chog_nose', 'chog_mouth', 'trait_eye_', 'trait_mouth_'];

const gltfLoader = new GLTFLoader();
const geometryCache = new Map<string, Promise<GLTF>>();
// tokenId -> material name -> hex, so the manifest is indexed twice.
const manifestCache = new Map<string, Promise<Record<string, Record<string, string>>>>();

function parseGlb(url: string): Promise<GLTF> {
  let pending = geometryCache.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) =>
      gltfLoader.load(url, resolve, undefined, reject),
    );
    geometryCache.set(url, pending);
  }
  return pending;
}async function paletteFor(
  manifestUrl: string,
  tokenId: string | number,
): Promise<Record<string, string>> {
  let pending = manifestCache.get(manifestUrl);
  if (!pending) {
    pending = fetch(manifestUrl).then((r) => r.json());
    manifestCache.set(manifestUrl, pending);
  }
  return (await pending)[String(tokenId)] ?? {};
}

export async function loadChog(opts: {
  glbUrl: string;
  manifestUrl: string;
  tokenId: string | number;
  /**
   * Exact material name -> hex. The live model's materials are Blender names
   * (`M_Pink.001`, `M_Jersey_#EAB308`), not the spike's `chog_skin` vocabulary, so
   * tinting has to key off what is actually in the file.
   */
  tint?: Record<string, string>;
}): Promise<Chog> {
  const [{ scene: source, animations }, palette] = await Promise.all([
    parseGlb(opts.glbUrl),
    paletteFor(opts.manifestUrl, opts.tokenId),
  ]);

  // The parsed GLTF is cached and shared, so every character needs its own copy
  // before anything is mutated — otherwise the second Chog painted the first one.
  // SkeletonUtils rather than Object3D.clone, because a naive clone leaves
  // SkinnedMesh pointing at the original skeleton.
  const scene = cloneSkinned(source) as THREE.Group;

  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });

  for (const mesh of meshes) {
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const name = src ? src.name : '';
    // Try the exact name first. Blender disambiguates cloned materials with a
    // .001 suffix and those variants carry *different* colours, so stripping it
    // unconditionally painted M_Pink.001 with M_Pink's blue.
    // A tint wins over the manifest for the parts it names, so a crowd of Chogs
    // sharing one model still reads as different characters.
    const hex =
      opts.tint?.[name] ?? palette[name] ?? palette[name.split('.')[0] ?? ''];
    mesh.material = new THREE.MeshToonMaterial({
      color: new THREE.Color(hex ? `#${hex}` : 0xffffff),
      gradientMap: ramp,
    });
    // Collected before the loop so the hull we are about to add cannot be
    // traversed into its own hull.
    mesh.add(new THREE.Mesh(mesh.geometry, hullMaterial));
  }

  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Re-centre on the origin and sit the feet on y=0: the exporter keeps the
  // Blender pivot at the hip, which floats once a town places them on a floor.
  scene.position.set(-center.x, -box.min.y, -center.z);

  const mixer = new THREE.AnimationMixer(scene);
  const byName = new Map<string, THREE.AnimationClip>();
  for (const clip of animations) byName.set(clip.name, clip);
  const clips = [...byName.keys()] as ChogClip[];
  let current: THREE.AnimationAction | null = null;

  // The exported model has a bone hierarchy but no keyframes, so motion is
  // procedural. If clips ever exist for a name, they win — this must not fight
  // a real animation once the rig is fixed on the Blender side.
  const bones = rigOf(scene);
  let kind: MotionKind = 'idle';
  let clock = Math.random() * 40;
  let speed = 0;
  let impulseAt: number | null = null;

  return {
    root: scene,
    clips,
    height: size.y,
    play(name: ChogClip) {
      kind = name === 'attack' || name === 'hit' ? name : name === 'walk' ? 'walk' : 'idle';
      if (name === 'attack' || name === 'hit') impulseAt = clock;
      const clip = byName.get(name);
      if (!clip) return;
      const next = mixer.clipAction(clip);
      if (next === current) return;
      next.reset().fadeIn(0.12).play();
      current?.fadeOut(0.12);
      current = next;
    },
    setSpeed(v: number) {
      speed = Math.max(0, Math.min(1, v));
      if (speed > 0.05 && kind === 'idle') kind = 'walk';
      if (speed <= 0.05 && kind === 'walk') kind = 'idle';
    },
    impulse(seconds?: number) {
      if (seconds === undefined || impulseAt === null) return 0;
      return Math.max(0, Math.min(1, (seconds - impulseAt) / 0.45));
    },
    update(dt: number) {
      clock += dt;
      if (byName.has(kind) && current) mixer.update(dt);
      else applyMotion(bones, { kind, t: clock, speed, impulse: impulseAt === null ? null : (clock - impulseAt) / 0.45 });
    },
  };
}

// ---------------------------------------------------------------------------
// NFT assembly -- one neutral base plus one small GLB per trait value.
//
// A player signs in with a wallet, and the model has to be THAT token's model:
// 1,969 Chogs cannot each ship a 750 KB GLB, but they share one body. The
// Blender pipeline bakes `chog-base.glb` (body, rig, idle + walk clips) and a
// part file per Head/Body/Eyes/Mouth value; the server hands the client the
// token's raw trait values, and this loader bolts the matching parts onto the
// rig. Colours come from `trait-colors.json`, keyed per file, because the
// toon shader still exports black.
// ---------------------------------------------------------------------------

/** Trait categories the assembly understands. Accessory is not one: it is
 *  gameplay (a skill), not geometry -- the pipeline keeps it off the model. */
export type TraitCategory = 'Head' | 'Body' | 'Eyes' | 'Mouth';

export interface PartsModel {
  baseUrl: string;
  partsUrl: string;
  colorsUrl: string;
  skinsUrl: string;
}

interface PartsIndex {
  parts: Record<string, Record<string, string>>;
  /** Head value -> mane tufts/tufts bands that hat hides. */
  hairHide: Record<string, string[]>;
}

const partIndexCache = new Map<string, Promise<PartsIndex>>();
const partColorsCache = new Map<string, Promise<Record<string, Record<string, string>>>>();
const partGlbCache = new Map<string, Promise<GLTF>>();

function fetchJson<T>(url: string, cache: Map<string, Promise<T>>): Promise<T> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`no ${url}`);
      return r.json();
    }) as Promise<T>;
    cache.set(url, pending);
  }
  return pending;
}

/** Colour a mesh from the manifest and give it the ink hull, like loadChog. */
function paint(mesh: THREE.Mesh, hex: string | undefined, tint: Record<string, string>): void {
  const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const name = src ? src.name : '';
  // A mesh whose material has no name is the exporter's phantom icosphere:
  // geometry with nothing to paint. Hide it rather than draw it white.
  if (!name) {
    mesh.visible = false;
    return;
  }
  const colour = tint[name] ?? hex;
  mesh.material = new THREE.MeshToonMaterial({
    color: new THREE.Color(colour ? `#${colour}` : 0xffffff),
    gradientMap: ramp,
  });
  // The eyes sit on the face plate; a hull around each one is a pair of black
  // discs over the face, which is exactly what the breath animation exposed.
  // Keyed on the OBJECT name (chog_eye_L, trait_eye_disc_R...) -- the material
  // names are M_Eye/M_Pink and never matched an object-prefixed list, which is
  // why the first attempt at this fix silently did nothing.
  if (NO_HULL.some((p) => mesh.name.startsWith(p))) return;
  mesh.add(new THREE.Mesh(mesh.geometry, hullMaterial));
}

/** Which bone a trait part hangs off. Hats and faces swing with the head;
 *  the jersey belongs to the spine. */
function boneFor(name: string): string {
  return name.startsWith('trait_body') ? 'Spine' : 'Head';
}

export async function loadChogNFT(opts: PartsModel & {
  traits?: Record<string, string>;
  tokenId?: string | number;
  tint?: Record<string, string>;
}): Promise<Chog> {
  const tint = opts.tint ?? {};
  const [base, index, colors, skins] = await Promise.all([
    parseGlb(opts.baseUrl),
    fetchJson<PartsIndex>(opts.partsUrl, partIndexCache),
    fetchJson<Record<string, Record<string, string>>>(opts.colorsUrl, partColorsCache),
    fetchJson<Record<string, Record<string, string>>>(opts.skinsUrl, partColorsCache),
  ]);
  const baseColors = colors[opts.baseUrl.split('/').pop() ?? ''] ?? {};
  const skinSheet = opts.traits?.Skin ? skins[opts.traits.Skin] : undefined;

  const { scene, animations } = base;
  const root = cloneSkinned(scene) as THREE.Group;

  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const name = src ? src.name : '';
    paint(mesh, skinSheet?.[name] ?? baseColors[name], tint);
  }

  const byName = new Map<string, THREE.Object3D>();
  root.traverse((o) => byName.set(o.name, o));

  // The hat hides whole mane bands; the base ships them all visible.
  const hairGone = new Set(index.hairHide[opts.traits?.Head ?? ''] ?? []);
  // An eye or mouth part replaces the base one, so the base flat goes away.
  let eyesPart = false;
  let mouthPart = false;

  const dir = opts.baseUrl.slice(0, opts.baseUrl.lastIndexOf('/') + 1);
  root.updateMatrixWorld(true);

  for (const category of ['Head', 'Body', 'Eyes', 'Mouth'] as TraitCategory[]) {
    const value = opts.traits?.[category];
    if (!value) continue;
    const file = index.parts[category]?.[value];
    if (!file) continue;
    if (category === 'Eyes') eyesPart = true;
    if (category === 'Mouth') mouthPart = true;
    let part: GLTF;
    try {
      part = await parseGlb(dir + file);
    } catch {
      continue;
    }
    const sheet = colors[file] ?? {};
    // The parsed part is cached and shared, so harvest a CLONE: attaching the cached
    // scene's own meshes re-parents them out from under the next Chog wearing the same
    // file, which is how the second of two identical hats came out bald. Rig-free static
    // meshes, so a plain deep clone is enough (geometry stays shared; paint() replaces
    // the shared materials with per-mesh toons anyway).
    const owned = part.scene.clone(true);
    // Collect first: re-parenting a mesh inside traverse() mutates the tree
    // being walked and three.js drops the rest of it.
    const partMeshes: THREE.Mesh[] = [];
    owned.updateMatrixWorld(true);
    owned.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) partMeshes.push(o as THREE.Mesh);
    });
    for (const mesh of partMeshes) {
      paint(mesh, sheet[mesh.material && !Array.isArray(mesh.material) ? mesh.material.name : ''], tint);
      // Parts export rig-free in world space; re-home each mesh under its bone
      // so rig animation carries it. attach() — not a hand-rolled position copy —
      // because the bone's rest rotation is part of the conversion: copying only
      // the position swung every part about the feet by the rest pitch and buried
      // each shirt's back 2 cm inside the torso, which is the tear the street saw.
      const bone = byName.get(boneFor(mesh.name));
      (bone ?? root).attach(mesh);
    }
  }

  for (const name of ['chog_eye_L', 'chog_eye_R', 'chog_glint_L', 'chog_glint_R']) {
    if (eyesPart) byName.get(name)?.traverse((o) => { o.visible = false; });
  }
  if (mouthPart) byName.get('chog_mouth')?.traverse((o) => { o.visible = false; });
  for (const name of hairGone) {
    byName.get(name)?.traverse((o) => { o.visible = false; });
  }

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -box.min.y, -center.z);

  const mixer = new THREE.AnimationMixer(root);
  const byNameClip = new Map<string, THREE.AnimationClip>();
  for (const clip of animations) byNameClip.set(clip.name, clip);
  const clips = [...byNameClip.keys()] as ChogClip[];
  let current: THREE.AnimationAction | null = null;

  const bones = rigOf(root);
  let kind: MotionKind = 'idle';
  let clock = Math.random() * 40;
  let speed = 0;
  let impulseAt: number | null = null;

  return {
    root,
    clips,
    height: size.y,
    play(name: ChogClip) {
      kind = name === 'attack' || name === 'hit' ? name : name === 'walk' ? 'walk' : 'idle';
      if (name === 'attack' || name === 'hit') impulseAt = clock;
      const clip = byNameClip.get(name);
      if (!clip) return;
      const next = mixer.clipAction(clip);
      if (next === current) return;
      next.reset().fadeIn(0.12).play();
      current?.fadeOut(0.12);
      current = next;
    },
    setSpeed(v: number) {
      speed = Math.max(0, Math.min(1, v));
      if (speed > 0.05 && kind === 'idle') kind = 'walk';
      if (speed <= 0.05 && kind === 'walk') kind = 'idle';
    },
    impulse(seconds?: number): number {
      if (seconds === undefined || impulseAt === null) return 0;
      return Math.max(0, Math.min(1, (seconds - impulseAt) / 0.45));
    },
    update(dt: number) {
      clock += dt;
      if (byNameClip.has(kind) && current) mixer.update(dt);
      else applyMotion(bones, { kind, t: clock, speed, impulse: impulseAt === null ? null : (clock - impulseAt) / 0.45 });
    },
  };
}
