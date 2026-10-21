import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

// Every material this module shares across instances. A caller that despawns one body
// must not dispose a member, or it tears the program out from under all the others —
// `dungeon/mob.ts collectOwned` skips the set for exactly this reason.
export const SHARED_MATERIALS = new Set<THREE.Material>([hullMaterial]);

// The Blender pipeline keeps its own NO_INK list: eyes, highlights, blush, nose
// and mouth are flat facial details with NO hull there -- hulling them in the
// client drew a dark shell over the face, which is the "black face on breathe"
// the rig showed. Same names here so the two stay one decision.
const NO_HULL = ['chog_eye_', 'chog_glint_', 'chog_blush_', 'chog_nose', 'chog_mouth', 'trait_eye_', 'trait_mouth_'];

const gltfLoader = new GLTFLoader();
const geometryCache = new Map<string, Promise<GLTF>>();
// tokenId -> material name -> hex, so the manifest is indexed twice.
const manifestCache = new Map<string, Promise<Record<string, Record<string, string>>>>();

export function parseGlb(url: string): Promise<GLTF> {
  let pending = geometryCache.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) =>
      gltfLoader.load(url, resolve, undefined, reject),
    );
    geometryCache.set(url, pending);
  }
  return pending;
}

/**
 * The house style, applied to any body: every mesh gets a fresh toon material on the shared
 * ramp plus an ink-hull child, so a generated import lands next to the Chogs instead of beside
 * them. `solid` paints the toon colour (it multiplies the export's own texture, which is kept);
 * `flat` unindexes the geometry so facets read as facets. Both the material and — when flat —
 * the geometry are fresh per call: nothing is shared with the cached source GLB, and the hull
 * child is marked `userData.hull` so `collectOwned` skips the geometry it shares with its mesh.
 */
export function dress(root: THREE.Object3D, opts: { solid?: string; flat?: boolean }): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  // Collected before the loop so the hulls we are about to add cannot be traversed into
  // their own hulls.
  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const src = mats[0] as THREE.MeshStandardMaterial | undefined;
    if (opts.flat && mesh.geometry.index) mesh.geometry = mesh.geometry.toNonIndexed();
    mesh.material = new THREE.MeshToonMaterial({
      color: new THREE.Color(opts.solid ?? src?.color ?? 0xffffff),
      gradientMap: ramp,
      map: src?.map ?? null,
    });
    const hull = new THREE.Mesh(mesh.geometry, hullMaterial);
    hull.userData.hull = true;
    mesh.add(hull);
  }
}

async function paletteFor(
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
  /** The skull-form base + its bone sheet. Skulls are picked by Form/Base, not by part. */
  skullBaseUrl: string;
  skullSkinsUrl: string;
}

/**
 * The one parts-model constant: the street and the picker shelf mount the same
 * files, so the card cannot show a different Chog than the world will.
 */
export const PARTS_MODEL: PartsModel = {
  baseUrl: '/models/chog-base.glb',
  partsUrl: '/models/trait-parts.json',
  colorsUrl: '/models/trait-colors.json',
  skinsUrl: '/models/skins.json',
  skullBaseUrl: '/models/chog-skull.glb',
  skullSkinsUrl: '/models/skull-skins.json',
};

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

/**
 * Fold a finished avatar's static meshes together, per parent and material.
 *
 * A trait-heavy Chog arrives as ~70 meshes (every tuft, tooth and plate its own
 * draw, plus an ink hull each), and the street stands several of them. Motion is
 * rigid per-node transforms, so meshes that share a parent and a material can
 * share one draw with no visual change: bake each local matrix into its
 * geometry and merge. Hulls merge the same way, into one ink shell per parent.
 *
 * What it will not touch: hidden subtrees (trait parts the toggles just killed
 * cost nothing and must stay dead), meshes with non-hull children (re-homing
 * them would orphan the riders), and anything skinned or morphed. Original
 * geometries are shared with the GLB cache and are never disposed — the merged
 * copies are the only new GPU memory, and each replaces dozens of draws.
 */
function mergeStaticMeshes(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const shown = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => {
    nodes.push(o);
  });
  // Pass 1: lift the ink hulls off their meshes into per-parent buckets, baked
  // with the mesh's own matrix (a hull sits at identity under its mesh).
  const hulls = new Map<THREE.Object3D, THREE.BufferGeometry[]>();
  for (const o of nodes) {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !shown(o)) continue;
    for (const child of [...mesh.children]) {
      const hull = child as THREE.Mesh;
      if (!hull.isMesh || hull.material !== hullMaterial) continue;
      mesh.remove(hull);
      const g = hull.geometry.index ? hull.geometry.toNonIndexed() : hull.geometry.clone();
      g.applyMatrix4(mesh.matrix);
      // The ink shader reads position and normal and nothing else, but the parts do not
      // agree on the rest — some carry uv, some do not — and one mixed bucket used to
      // fail the whole hull merge. Strip to what the shader sees; the look is identical.
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      }
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const bucket = hulls.get(mesh.parent ?? root) ?? [];
      bucket.push(g);
      hulls.set(mesh.parent ?? root, bucket);
    }
  }
  // Pass 2: fold plain meshes per parent and material.
  const groups = new Map<string, { parent: THREE.Object3D; material: THREE.Material; geos: THREE.BufferGeometry[]; sources: THREE.Mesh[] }>();
  for (const o of nodes) {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !shown(o)) continue;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) continue;
    if (mesh.morphTargetInfluences) continue;
    if (mesh.material === hullMaterial || Array.isArray(mesh.material)) continue;
    if (mesh.children.length > 0) continue;
    const parent = mesh.parent;
    if (!parent) continue;
    const attrs = Object.keys(mesh.geometry.attributes).sort().join(',');
    // paint() mints one material per mesh, so the uuid would fold nothing: key on
    // what the eye sees instead. Nothing animates these materials after build —
    // motion is rigid transforms — so sharing one per colour is invisible.
    const mat = mesh.material as THREE.MeshToonMaterial;
    const sig = mesh.material.type + '#' + (mat.color ? mat.color.getHexString() : '');
    const key = parent.uuid + '|' + sig + '|' + attrs;
    let g = groups.get(key);
    if (!g) {
      g = { parent, material: mesh.material, geos: [], sources: [] };
      groups.set(key, g);
    }
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrix);
    g.geos.push(geo);
    g.sources.push(mesh);
  }
  for (const g of groups.values()) {
    if (g.geos.length < 2) {
      for (const geo of g.geos) geo.dispose();
      continue;
    }
    const merged = mergeGeometries(g.geos, false);
    for (const geo of g.geos) geo.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const out = new THREE.Mesh(merged, g.material);
    out.castShadow = g.sources.some((s) => s.castShadow);
    out.receiveShadow = g.sources.some((s) => s.receiveShadow);
    out.name = (g.parent.name || 'part') + ':merged';
    for (const s of g.sources) g.parent.remove(s);
    g.parent.add(out);
  }
  // Pass 3: one ink shell per parent.
  for (const [parent, geos] of hulls) {
    if (geos.length === 0) continue;
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
    if (geos.length > 1) for (const geo of geos) geo.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const out = new THREE.Mesh(merged, hullMaterial);
    out.name = 'hull:merged';
    out.castShadow = false;
    out.receiveShadow = false;
    parent.add(out);
  }
}

/** Which bone a trait part hangs off. Hats and faces swing with the head;
 *  the jersey belongs to the spine. */
function boneFor(name: string): string {
  return name.startsWith('trait_body') || name.startsWith('trait_oneoff_body') ? 'Spine' : 'Head';
}

interface OneoffEntry {
  file: string | null;
  skull: boolean;
  hideMane: string[];
  tint: Record<string, string>;
  parts: Partial<Record<TraitCategory, string>>;
  eyes: boolean;
  mouth: boolean;
}

interface OneoffIndex {
  byToken: Record<string, string>;
  ones: Record<string, OneoffEntry>;
}

const EMPTY_ONEOFF: OneoffIndex = { byToken: {}, ones: {} };

const oneoffCache = new Map<string, Promise<OneoffIndex>>();

export async function loadChogNFT(opts: PartsModel & {
  traits?: Record<string, string>;
  tokenId?: string | number;
  tint?: Record<string, string>;
}): Promise<Chog> {
  const dir = opts.baseUrl.slice(0, opts.baseUrl.lastIndexOf('/') + 1);
  // A 1/1 carries no traits to build from (Base "1:1" only), so the token id
  // picks a bespoke override: base choice, mane hides, re-tint, table parts
  // and one bespoke GLB. Missing file, unknown token, non-1/1 traits: no-op.
  const oneoff = await fetchJson<OneoffIndex>(dir + 'trait-oneoff.json', oneoffCache)
    .catch(() => EMPTY_ONEOFF);
  const ooName = opts.traits?.Base === '1:1' && opts.tokenId != null
    ? oneoff.byToken[String(opts.tokenId)]
    : undefined;
  const oo = ooName ? oneoff.ones[ooName] : undefined;
  const traits: Record<string, string> = { ...(opts.traits ?? {}), ...(oo?.parts ?? {}) };
  const tint = { ...(oo?.tint ?? {}), ...(opts.tint ?? {}) };
  const skull = oo ? oo.skull : (traits.Form === 'Skull' || traits.Base === 'Skull');
  const baseFile = skull ? opts.skullBaseUrl : opts.baseUrl;
  const [base, index, colors, skins, skullSkins] = await Promise.all([
    parseGlb(baseFile),
    fetchJson<PartsIndex>(opts.partsUrl, partIndexCache),
    fetchJson<Record<string, Record<string, string>>>(opts.colorsUrl, partColorsCache),
    fetchJson<Record<string, Record<string, string>>>(opts.skinsUrl, partColorsCache),
    skull
      ? fetchJson<Record<string, Record<string, string>>>(opts.skullSkinsUrl, partColorsCache)
      : Promise.resolve({} as Record<string, Record<string, string>>),
  ]);
  const baseColors = colors[baseFile.split('/').pop() ?? ''] ?? {};
  const skinSheet = traits.Skin
    ? { ...skins[traits.Skin], ...(skull ? skullSkins[traits.Skin] : undefined) }
    : undefined;

  // Radioactive art draws a translucent glowing skull-head in the skin's own
  // colour (lime Green, cyan Blue, hot pink Red, pale pink Multi) with no
  // blush -- never the cream face plate the skin sheet carries.
  if (traits.Base === 'Radioactive' && skinSheet) {
    const glow = (
      { Green: '84cc16', Blue: '22d3ee', Red: 'f472b6', 'Multi Colored': 'fbcfe8' } as Record<string, string>
    )[traits.Skin ?? ''] ?? '84cc16';
    skinSheet['M_Face'] = glow;
    skinSheet['M_Pink'] = glow;
  }
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
  const hairGone = new Set([...(index.hairHide[traits.Head ?? ''] ?? []), ...(oo?.hideMane ?? [])]);
  // An eye or mouth part replaces the base one, so the base flat goes away.
  let eyesPart = !!oo?.eyes;
  let mouthPart = !!oo?.mouth || traits.Base === 'Radioactive';

  root.updateMatrixWorld(true);

  for (const category of ['Head', 'Body', 'Eyes', 'Mouth'] as TraitCategory[]) {
    const value = traits[category];
    // The tooth band is the skull's mouth: lips would land between the sockets
    // and the jaw, so Blender skips mouth parts on bone and so do we.
    if (skull && category === 'Mouth') continue;
    // The x-ray jaw is a Radioactive's mouth: none of the 30 has a Mouth
    // trait, and a table mouth would float over the tooth band.
    if (traits.Base === 'Radioactive' && category === 'Mouth') continue;
    if (!value) continue;
    let file = index.parts[category]?.[value];
    // Socket-mode eyes: fur eyes overflow the sockets, so skulls wear the
    // shrunken bone-seated variants. The colours table is the existence check.
    if (skull && category === 'Eyes' && file) {
      const socketed = file.replace(/\.glb$/, '-skull.glb');
      if (colors[socketed]) file = socketed;
    }
    if (!file) continue;
    if (category === 'Eyes') eyesPart = true;
    if (category === 'Mouth') mouthPart = true;
    let part: GLTF;
    try {
      part = await parseGlb(dir + file);
    } catch {
      continue;
    }
    const partSheet = colors[file] ?? {};
    // Socket-mode sclera is bone: seat it in this skull's own shade, not the neutral.
    // Cloned: the colours table is a shared cache, and a per-skin write would leak
    // this skull's shade into every token wearing socket eyes afterwards.
    const sheet = { ...partSheet };
    if (skull && skinSheet && (partSheet['M_form_bone_x'] || partSheet['M_form_hi_x'])) {
      if (skinSheet['M_form_bone_x']) sheet['M_form_bone_x'] = skinSheet['M_form_bone_x'];
      if (skinSheet['M_form_hi_x']) sheet['M_form_hi_x'] = skinSheet['M_form_hi_x'];
    }
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
      // Every cap shares one bill template, and the template floats: the brim juts
      // forward of the crown with a forehead of daylight between them. Tuck it back
      // under the crown edge, converted into bone space so the rest pitch is honoured.
      // Only caps carry a bill mesh, so nothing else can catch this.
      if (/bill/i.test(mesh.name) && bone) {
        const q = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
        mesh.position.add(new THREE.Vector3(0, 0.05, -0.08).applyQuaternion(q));
        mesh.updateMatrix();
      }
    }
  }

  // Bespoke overlays outside the trait tables: a 1/1's own GLB, and the
  // Radioactive x-ray jaw (furry head, teeth on the chin, green drips).
  const extraFiles = [
    oo?.file,
    traits.Base === 'Radioactive' ? 'trait-form-radioactive.glb' : undefined,
  ];
  for (const extraFile of extraFiles) {
    if (!extraFile) continue;
    try {
      const part = await parseGlb(dir + extraFile);
      const sheet = { ...(colors[extraFile] ?? {}) };
      const owned = part.scene.clone(true);
      owned.updateMatrixWorld(true);
      const ooMeshes: THREE.Mesh[] = [];
      owned.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) ooMeshes.push(o as THREE.Mesh);
      });
      for (const mesh of ooMeshes) {
        paint(mesh, sheet[mesh.material && !Array.isArray(mesh.material) ? mesh.material.name : ''], tint);
        const bone = byName.get(boneFor(mesh.name));
        (bone ?? root).attach(mesh);
      }
    } catch {
      // Bespoke file missing: tint + table parts still apply.
    }
  }

  for (const name of ['chog_eye_L', 'chog_eye_R', 'chog_glint_L', 'chog_glint_R']) {
    if (eyesPart) byName.get(name)?.traverse((o) => { o.visible = false; });
  }
  if (mouthPart) byName.get('chog_mouth')?.traverse((o) => { o.visible = false; });
  // A naked skull has no barrel of fur: hide the torso and the ribcage shows.
  if (skull && !traits.Body) byName.get('chog_torso')?.traverse((o) => { o.visible = false; });
  for (const name of hairGone) {
    byName.get(name)?.traverse((o) => { o.visible = false; });
  }

  // The toggles just decided what lives; fold the survivors before the first frame.
  mergeStaticMeshes(root);

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
