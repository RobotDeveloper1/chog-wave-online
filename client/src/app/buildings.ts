import * as THREE from 'three';

/**
 * Procedural buildings for the town.
 *
 * Modelled in code rather than authored because the whole reason this project is
 * Phaser-and-Three and not Godot is that an agent can edit the world as text: a
 * street is a list of lots, and a lot is a handful of numbers. It also means the
 * three sectors can vary their skyline from the same generator instead of
 * shipping three sets of art.
 *
 * Everything is built to the same rules as the Chog models — flat toon colour, no
 * specular, and a back-face hull pushed out along the normals so silhouettes read
 * against the street the way the characters' do.
 */

export type RoofStyle = 'flat' | 'gable' | 'slant' | 'dome' | 'tank';

export interface BuildingSpec {
  /** metres */
  width: number;
  depth: number;
  height: number;
  roof: RoofStyle;
  wall: string;
  trim: string;
  roofColor: string;
  /** Shop name on the fascia. Omit for an anonymous block. */
  sign?: string;
  /** Lit windows, columns x rows. */
  windows?: [number, number];
  door?: boolean;
}

const OUTLINE = 0.06;

const hullMaterial = new THREE.ShaderMaterial({
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
    kThickness: { value: OUTLINE },
    kColor: { value: new THREE.Color(0x0a0713) },
  },
  side: THREE.BackSide,
});

const toon = (hex: string, emissive = 0) =>
  new THREE.MeshToonMaterial({
    color: new THREE.Color(hex),
    ...(emissive ? { emissive: new THREE.Color(hex), emissiveIntensity: emissive } : {}),
  });

/** Adds the outline hull for a mesh. Collected first so hulls never hull hulls. */
function outline(mesh: THREE.Mesh): THREE.Mesh {
  const hull = new THREE.Mesh(mesh.geometry, hullMaterial);
  hull.renderOrder = -1;
  mesh.add(hull);
  return mesh;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return outline(m);
}

/**
 * A sign drawn to a canvas rather than as geometry. Lettering at street scale is
 * unreadable as extruded meshes, and a texture keeps the type crisp at the fixed
 * camera distance the town uses.
 */
function signPlane(text: string, width: number, bg: string, fg: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(0,0,0,.55)';
  g.lineWidth = 10;
  g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = fg;
  g.font = 'bold 62px ui-monospace, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 14).toUpperCase(), c.width / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  return mesh;
}

/** A gable roof as a triangular prism, so the skyline is not all flat slabs. */
function gableRoof(w: number, d: number, rise: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - 0.25, 0);
  shape.lineTo(0, rise);
  shape.lineTo(w / 2 + 0.25, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d + 0.5, bevelEnabled: false });
  geo.translate(0, 0, -(d + 0.5) / 2);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = Math.PI / 2;
  m.rotation.z = Math.PI / 2;
  return outline(m);
}

export interface BuiltBuilding {
  group: THREE.Group;
  /** Street-space AABB the player cannot walk through. */
  solid: { x: number; z: number; halfW: number; halfD: number };
}

export function makeBuilding(spec: BuildingSpec): BuiltBuilding {
  const { width: w, depth: d, height: h } = spec;
  const group = new THREE.Group();
  const wall = toon(spec.wall);
  const trim = toon(spec.trim);
  const roofMat = toon(spec.roofColor);

  group.add(box(w, h, d, wall, 0, h / 2, 0));

  // A plinth keeps the base from reading as a floating box on the pavement.
  group.add(box(w + 0.3, 0.35, d + 0.3, trim, 0, 0.175, 0));

  switch (spec.roof) {
    case 'gable':
      group.add(gableRoof(w, d, Math.max(1.1, w * 0.3), roofMat));
      group.children.at(-1)!.position.y = h;
      break;
    case 'slant': {
      const slab = box(w + 0.5, 0.5, d + 0.5, roofMat, 0, h + 0.2, 0);
      slab.rotation.z = 0.09;
      group.add(slab);
      break;
    }
    case 'dome': {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(Math.min(w, d) * 0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        roofMat,
      );
      dome.position.y = h;
      group.add(outline(dome));
      break;
    }
    case 'tank': {
      group.add(box(w * 0.34, 1.5, d * 0.34, roofMat, w * 0.18, h + 0.75, 0));
      group.add(box(w + 0.4, 0.35, d + 0.4, trim, 0, h + 0.17, 0));
      break;
    }
    case 'flat':
    default:
      group.add(box(w + 0.4, 0.4, d + 0.4, trim, 0, h + 0.2, 0));
  }

  // Windows: one instanced-ish grid of emissive quads on the street-facing wall.
  const [cols, rows] = spec.windows ?? [Math.max(1, Math.round(w / 2.4)), Math.max(1, Math.floor(h / 2.2))];
  const lit = toon('#ffd98a', 0.85);
  const dark = toon('#1a1428');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * (w / cols) - w / 2;
      const y = h - 1.1 - r * 2.0;
      if (y < 1.2) continue;
      // Deterministic per building so a reload does not re-lit a different set.
      const on = ((r * 7 + c * 13 + Math.round(w * 10)) % 5) > 1;
      const pane = box(w / cols - 0.75, 1.05, 0.12, on ? lit : dark, x, y, d / 2 + 0.02);
      group.add(pane);
    }
  }

  if (spec.door !== false) {
    group.add(box(1.5, 2.4, 0.2, toon('#0e0a18'), 0, 1.2, d / 2 + 0.05));
    group.add(box(1.9, 0.22, 0.3, trim, 0, 2.5, d / 2 + 0.1));
  }

  if (spec.sign) {
    const s = signPlane(spec.sign, Math.min(w * 0.9, 7), spec.trim, '#f7f0ff');
    s.position.set(0, Math.min(h - 0.9, h * 0.78), d / 2 + 0.16);
    group.add(s);
  }

  return { group, solid: { x: 0, z: 0, halfW: w / 2 + 0.2, halfD: d / 2 + 0.2 } };
}

/** Street furniture. Small, repeated, and cheap enough to scatter. */
export function lampPost(color = '#6f5f96'): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.22, 4.4, 0.22, toon('#241a3a'), 0, 2.2, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), toon(color, 1.2));
  head.position.y = 4.5;
  g.add(outline(head));
  return g;
}

export function kiosk(color = '#c83780'): THREE.Group {
  const g = new THREE.Group();
  g.add(box(1.5, 2.2, 1.5, toon(color), 0, 1.1, 0));
  g.add(box(1.9, 0.25, 1.9, toon('#f0eddb'), 0, 2.35, 0));
  return g;
}
