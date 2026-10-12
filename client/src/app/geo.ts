import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometry batching for the street.
 *
 * A believable city is hundreds of objects: bollards, planters, window frames,
 * roof vents, trees, cracks. Emitting each as its own Mesh costs a draw call, and
 * the town already spends ~215 before any of that. So props are pushed in here
 * keyed by material and merged into one geometry per material at build time — the
 * street ends up costing a couple dozen draws no matter how much detail is in it.
 *
 * The trade-off is that batched geometry cannot be animated or moved per piece.
 * Anything that needs to move (a door, a sign that swings, a vehicle) must be its
 * own object; anything static and repeated should go through here.
 */

interface Bucket {
  material: THREE.Material;
  geos: THREE.BufferGeometry[];
}

export class Batcher {
  private buckets = new Map<string, Bucket>();
  /** Objects that could not be merged and were added individually. */
  readonly group = new THREE.Group();

  /**
   * Add a geometry transformed into place. The transform is baked so the merged
   * result needs no node of its own.
   *
   * The bucket is keyed by name *and* material: five roofs of five different
   * colours must not collapse into one flat merge.
   */
  push(
    key: string,
    material: THREE.Material,
    geometry: THREE.BufferGeometry,
    matrix: THREE.Matrix4,
  ): void {
    const id = `${key}|${material.uuid}`;
    let bucket = this.buckets.get(id);
    if (!bucket) {
      bucket = { material, geos: [] };
      this.buckets.set(id, bucket);
    }
    const clone = geometry.clone();
    clone.applyMatrix4(matrix);
    bucket.geos.push(clone);
  }

  /** Merge everything accumulated. Call once, after all props are pushed. */
  build(): THREE.Group {
    for (const bucket of this.buckets.values()) {
      if (!bucket.geos.length) continue;
      const first = bucket.geos[0];
      if (!first) continue;
      // Merge needs a consistent attribute set; drop anything that disagrees
      // rather than producing a corrupt buffer.
      const reference = first.attributes;
      const compatible = bucket.geos.filter((g) =>
        Object.keys(reference).every((k) => !!g.attributes[k]) &&
        Object.keys(g.attributes).every((k) => !!reference[k]),
      );
      const skipped = bucket.geos.length - compatible.length;
      if (skipped) {
        for (const g of bucket.geos.filter((x) => !compatible.includes(x))) {
          this.group.add(new THREE.Mesh(g, bucket.material));
        }
      }
      if (!compatible.length) continue;
      const merged =
        compatible.length === 1 ? compatible[0] : mergeGeometries(compatible, false);
      if (merged) {
        merged.computeBoundingSphere();
        this.group.add(new THREE.Mesh(merged, bucket.material));
      }
    }
    return this.group;
  }

  get parts(): number {
    return [...this.buckets.values()].reduce((s, b) => s + b.geos.length, 0);
  }
}

/** Convenience: a transform from position/rotation/scale, applied in that order. */
export function xform(
  pos: [number, number, number],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
  m.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...scale));
  return m;
}

/**
 * A pavement texture drawn in canvas. Real asphalt is not a flat colour, and at
 * the town camera's distance a flat plane is the single fastest way to make a
 * street look like an unfinished level.
 */
export function asphaltTexture(tint = '#2a2334', seed = 7): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  g.fillStyle = tint;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const v = 0.04 + rand() * 0.1;
    g.fillStyle = `rgba(255,255,255,${v.toFixed(3)})`;
    g.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
  }
  // A few darker patches read as repaired tarmac.
  for (let i = 0; i < 7; i++) {
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.beginPath();
    g.ellipse(rand() * 256, rand() * 256, 12 + rand() * 26, 8 + rand() * 18, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sidewalk slabs, with the joint lines that make the scale readable. */
export function pavementTexture(tint = '#4a3a52'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = tint;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,.34)';
  g.lineWidth = 3;
  for (const p of [0, 64]) {
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, 128);
    g.moveTo(0, p + 32);
    g.lineTo(128, p + 32);
    g.stroke();
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${(Math.random() * 0.05).toFixed(3)})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Shared primitive helpers. props.ts and town.ts both go through these so a
// bucket key and its material are agreed on in one place, not two.
// ---------------------------------------------------------------------------

const matCache = new Map<string, THREE.Material>();

/** A cached toon material. Identity is keyed by colour so batches stay shared. */
export function toonMat(color: string, emissive = 0): THREE.Material {
  const key = `${color}|${emissive}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color: new THREE.Color(color),
      ...(emissive ? { emissive: new THREE.Color(color), emissiveIntensity: emissive } : {}),
    });
    matCache.set(key, m);
  }
  return m;
}

const unlitCache = new Map<string, THREE.MeshBasicMaterial>();

/** Flat materials for paint, decals and glass-like emissives that should not shade. */
export function unlitMat(color: string): THREE.MeshBasicMaterial {
  let m = unlitCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
    unlitCache.set(color, m);
  }
  return m;
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

export function cyl(rt: number, rb: number, h: number, seg = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rt, rb, h, seg);
}

/** Palette lookup that cannot yield undefined. */
export function pick<T>(arr: readonly T[], n: number): T {
  const v = arr[Math.abs(Math.trunc(n)) % arr.length];
  if (v === undefined) throw new Error('empty palette array');
  return v;
}
