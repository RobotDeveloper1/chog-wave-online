import * as THREE from 'three';

/**
 * The city's geometry sink.
 *
 * A district is tens of thousands of small pieces — window quads, cornices, awnings,
 * lamps, trees — and drawing each as a mesh would cost more than the GPU has to give.
 * Everything is therefore *poured* into per-chunk, per-material typed arrays and merged
 * into one mesh each at the end. Chunking is what keeps the merged meshes culled: a
 * district-sized mesh is always on screen, a 40-unit one is only drawn when you are near.
 *
 * Three decisions keep it light:
 *
 *   - colour is a **vertex** attribute, so every solid-coloured piece in the city shares
 *     one material instead of one per paint pot, and a chunk is a handful of draws;
 *   - the writer emits triangles straight into arrays, with no BufferGeometry per piece,
 *     because allocating tens of thousands of tiny geometries is the slow part of a build;
 *   - normals and colours are packed into bytes: a vertex is 32 bytes, not 56.
 */

export type MatKey = string;

interface Acc {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
  glow: number[];
  seed: number[];
}

const newAcc = (): Acc => ({ pos: [], nor: [], uv: [], col: [], glow: [], seed: [] });

export interface BatchOptions {
  chunk?: number;
}

const _c = new THREE.Color();

/** `#rrggbb` or 0xrrggbb → three bytes, in the linear-ish space the shader expects (sRGB bytes). */
function rgb(color: string | number): [number, number, number] {
  _c.set(color as THREE.ColorRepresentation);
  // The material treats the vertex colour as sRGB-encoded bytes and decodes in the shader,
  // so what we store is the sRGB value, which is what `getHex()` returns in sRGB mode.
  const hex = _c.getHex(THREE.SRGBColorSpace);
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export class ChunkBatcher {
  private readonly chunk: number;
  private readonly cells = new Map<string, Map<MatKey, Acc>>();
  /** Pieces that were poured, for budgeting. */
  triangles = 0;

  constructor(opts: BatchOptions = {}) {
    this.chunk = opts.chunk ?? 40;
  }

  private acc(mat: MatKey, x: number, z: number): Acc {
    const key = `${Math.floor(x / this.chunk)},${Math.floor(z / this.chunk)}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Map();
      this.cells.set(key, cell);
    }
    let a = cell.get(mat);
    if (!a) {
      a = newAcc();
      cell.set(mat, a);
    }
    return a;
  }

  /** One vertex. Normals are written as signed bytes. */
  private v(a: Acc, p: [number, number, number], n: [number, number, number], u: number, w: number, c: [number, number, number], glow: number, seed: number): void {
    a.pos.push(p[0], p[1], p[2]);
    a.nor.push(Math.round(n[0] * 127), Math.round(n[1] * 127), Math.round(n[2] * 127));
    a.uv.push(u, w);
    a.col.push(c[0], c[1], c[2]);
    a.glow.push(Math.round(Math.min(1, glow) * 255));
    a.seed.push(Math.round(seed * 255));
  }

  /**
   * A quad from four corners given counter-clockwise as seen from the front. `uv` is the
   * rectangle of the texture it samples: [u0, v0, u1, v1].
   */
  quad(
    mat: MatKey,
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    uv: [number, number, number, number] = [0, 0, 1, 1],
    color: string | number = 0xffffff,
    glow = 0,
    seed = 0,
  ): void {
    const a = this.acc(mat, (p0[0] + p2[0]) / 2, (p0[2] + p2[2]) / 2);
    const e1: [number, number, number] = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2: [number, number, number] = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    const n: [number, number, number] = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= len;
    n[1] /= len;
    n[2] /= len;
    const c = rgb(color);
    const [u0, v0, u1, v1] = uv;
    this.v(a, p0, n, u0, v0, c, glow, seed);
    this.v(a, p1, n, u1, v0, c, glow, seed);
    this.v(a, p2, n, u1, v1, c, glow, seed);
    this.v(a, p0, n, u0, v0, c, glow, seed);
    this.v(a, p2, n, u1, v1, c, glow, seed);
    this.v(a, p3, n, u0, v1, c, glow, seed);
    this.triangles += 2;
  }

  /** A single triangle, normal from winding. */
  tri(
    mat: MatKey,
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    uv: [number, number, number, number, number, number] = [0, 0, 1, 0, 0.5, 1],
    color: string | number = 0xffffff,
    glow = 0,
    seed = 0,
  ): void {
    const a = this.acc(mat, (p0[0] + p1[0] + p2[0]) / 3, (p0[2] + p1[2] + p2[2]) / 3);
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n: [number, number, number] = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= len;
    n[1] /= len;
    n[2] /= len;
    const c = rgb(color);
    this.v(a, p0, n, uv[0], uv[1], c, glow, seed);
    this.v(a, p1, n, uv[2], uv[3], c, glow, seed);
    this.v(a, p2, n, uv[4], uv[5], c, glow, seed);
    this.triangles += 1;
  }

  /**
   * An axis-aligned box about its centre, optionally turned about Y. Six quads, written
   * directly. The top face's UVs are in world units (so a roof texture tiles at a fixed
   * scale whatever the building's size); the side faces' are 0..1 per face.
   */
  box(
    mat: MatKey,
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    color: string | number,
    glow = 0,
    opts: { rot?: number; skipBottom?: boolean; skipTop?: boolean; uvScale?: number; seed?: number } = {},
  ): void {
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const rot = opts.rot ?? 0;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const P = (x: number, y: number, z: number): [number, number, number] => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
    const s = opts.seed ?? 0;
    const k = opts.uvScale ?? 1 / 6;
    // +z, -z, +x, -x faces (the sides), then top and bottom.
    this.quad(mat, P(-hw, -hh, hd), P(hw, -hh, hd), P(hw, hh, hd), P(-hw, hh, hd), [0, 0, 1, 1], color, glow, s);
    this.quad(mat, P(hw, -hh, -hd), P(-hw, -hh, -hd), P(-hw, hh, -hd), P(hw, hh, -hd), [0, 0, 1, 1], color, glow, s);
    this.quad(mat, P(hw, -hh, hd), P(hw, -hh, -hd), P(hw, hh, -hd), P(hw, hh, hd), [0, 0, 1, 1], color, glow, s);
    this.quad(mat, P(-hw, -hh, -hd), P(-hw, -hh, hd), P(-hw, hh, hd), P(-hw, hh, -hd), [0, 0, 1, 1], color, glow, s);
    if (!opts.skipTop) {
      this.quad(mat, P(-hw, hh, hd), P(hw, hh, hd), P(hw, hh, -hd), P(-hw, hh, -hd), [(cx - hw) * k, (cz - hd) * k, (cx + hw) * k, (cz + hd) * k], color, glow, s);
    }
    if (!opts.skipBottom) {
      this.quad(mat, P(-hw, -hh, -hd), P(hw, -hh, -hd), P(hw, -hh, hd), P(-hw, -hh, hd), [0, 0, 1, 1], color, glow, s);
    }
  }

  /** Any BufferGeometry, transformed into place and recoloured. Slower; used for round things. */
  geo(mat: MatKey, g: THREE.BufferGeometry, m: THREE.Matrix4, color: string | number, glow = 0, seed = 0): void {
    const src = g.index ? g.toNonIndexed() : g;
    const pos = src.getAttribute('position') as THREE.BufferAttribute;
    const nor = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const c = rgb(color);
    for (let i = 0; i < pos.count; i += 3) {
      // The chunk follows the first vertex of each triangle, so a long piece stays whole.
      p.fromBufferAttribute(pos, i).applyMatrix4(m);
      const a = this.acc(mat, p.x, p.z);
      for (let k = 0; k < 3; k++) {
        p.fromBufferAttribute(pos, i + k).applyMatrix4(m);
        if (nor) n.fromBufferAttribute(nor, i + k).applyMatrix3(nm).normalize();
        else n.set(0, 1, 0);
        this.v(a, [p.x, p.y, p.z], [n.x, n.y, n.z], uv ? uv.getX(i + k) : 0, uv ? uv.getY(i + k) : 0, c, glow, seed);
      }
      this.triangles += 1;
    }
    if (src !== g) src.dispose();
  }

  /** Merge everything into one mesh per chunk and material. */
  build(materials: Record<MatKey, THREE.Material>, flags: Partial<Record<MatKey, { cast?: boolean; receive?: boolean }>> = {}): { group: THREE.Group; chunks: Chunk[] } {
    const root = new THREE.Group();
    const chunks: Chunk[] = [];
    for (const [key, cell] of this.cells) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      const group = new THREE.Group();
      group.name = `chunk:${key}`;
      const centre = new THREE.Vector3((cx + 0.5) * this.chunk, 0, (cz + 0.5) * this.chunk);
      for (const [mat, a] of cell) {
        const material = materials[mat];
        if (!material) throw new Error(`no material "${mat}"`);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(a.nor), 3, true));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
        g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(a.col), 3, true));
        g.setAttribute('glow', new THREE.BufferAttribute(new Uint8Array(a.glow), 1, true));
        g.setAttribute('seed', new THREE.BufferAttribute(new Uint8Array(a.seed), 1, true));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const mesh = new THREE.Mesh(g, material);
        const f = flags[mat];
        mesh.castShadow = f?.cast ?? true;
        mesh.receiveShadow = f?.receive ?? true;
        mesh.name = mat;
        group.add(mesh);
      }
      root.add(group);
      chunks.push({ key, group, centre });
    }
    return { group: root, chunks };
  }
}

export interface Chunk {
  key: string;
  group: THREE.Group;
  centre: THREE.Vector3;
}
