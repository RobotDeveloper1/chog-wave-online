import * as THREE from 'three';
import { skyTexture, type DistrictArt } from './art.ts';
import { CameraDirector, type Bounds, type Rig, type RigName } from './camera.ts';
import { WU } from './city/materials.ts';
import type { DungeonMood } from './dungeon/themes.ts';
import { Pipeline, type Look } from './render/pipeline.ts';

/**
 * One renderer for the top screen. The framing lives in `camera.ts` and the post chain in
 * `render/pipeline.ts`; this owns the scene, the lights, the shadow, the sky and the floor
 * that everything else stands on.
 *
 * `'town'` is still accepted as a rig name because the battle code predates the camera
 * director and asks for it by that name when a fight ends.
 */

export type { RigName } from './camera.ts';

/** How each district is lit and graded. The palette lives in art.ts; the *mood* lives here. */
interface Mood {
  look: Look;
  /** Where the key light sits relative to the thing it follows. */
  sunAt: [number, number, number];
  sun: number;
  hemi: number;
  /** What the shade is lit by: the sky above and the warm bounce off the ground below. */
  sky: string;
  bounce: string;
  fill: number;
  fogK: [number, number];
}

const MOODS: Record<'ashflat' | 'voltgrid' | 'hollow', Mood> = {
  // Golden hour: a low warm key from the west throwing long shadows down every street,
  // violet in the shade, a lift of bloom on the windows.
  ashflat: {
    look: {
      bloom: { strength: 0.2, radius: 0.4, threshold: 0.95 },
      exposure: 1.08,
      vignette: 0.22,
      saturation: 1.2,
      contrast: 1.12,
      shadowTint: [0.97, 0.98, 1.04],
      highlightTint: [1.05, 1.0, 0.94],
      tilt: 0.1,
      grain: 0,
      tone: 'neutral',
    },
    sunAt: [-46, 34, 30],
    sun: 3.0,
    hemi: 1.5,
    // Warm sun, cool shade: the whole golden-hour look is those two lights disagreeing.
    // The shade is a pale sky blue, not lavender: a violet fill over grey asphalt is what
    // made the whole street read as a purple haze.
    sky: '#b6c8ec',
    bounce: '#b89068',
    fill: 0.4,
    fogK: [1.5, 4.6],
  },
  // Night: a cool moon, a dim sky, and everything that matters is lit by itself.
  voltgrid: {
    look: {
      bloom: { strength: 0.6, radius: 0.5, threshold: 0.78 },
      exposure: 1.0,
      vignette: 0.34,
      saturation: 1.16,
      contrast: 1.1,
      shadowTint: [0.88, 0.97, 1.14],
      highlightTint: [0.96, 1.04, 1.1],
      tilt: 0.1,
      grain: 0,
    },
    sunAt: [34, 46, -24],
    sun: 1.25,
    hemi: 1.15,
    sky: '#2f5c92',
    bounce: '#0e2a40',
    fill: 0.5,
    fogK: [1.1, 3.4],
  },
  // Overcast: no hard shadow to speak of, a pale veil, everything slightly green.
  hollow: {
    look: {
      bloom: { strength: 0.2, radius: 0.4, threshold: 0.92 },
      exposure: 1.1,
      vignette: 0.24,
      saturation: 1.08,
      contrast: 1.08,
      shadowTint: [0.97, 1.0, 1.03],
      highlightTint: [1.0, 1.02, 0.98],
      tilt: 0.1,
      grain: 0,
    },
    sunAt: [-24, 58, 28],
    sun: 1.9,
    hemi: 1.35,
    sky: '#c3d2cc',
    bounce: '#6a7468',
    fill: 0.3,
    fogK: [1.3, 3.6],
  },
};

/** The duel's atmosphere: no district, no haze — a dark void lit from the two sides of the field. */
export interface DuelMood {
  bg: string;
  sky: string;
  bounce: string;
  hemi: number;
  key: string;
  sun: number;
  sunAt: [number, number, number];
  fill: string;
  fillI: number;
  look: Look;
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly director: CameraDirector;
  readonly renderer: THREE.WebGLRenderer;
  private readonly pipeline: Pipeline;
  private readonly hemi: THREE.HemisphereLight;
  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private skyMesh: THREE.Mesh | null = null;
  private mood: Mood = MOODS.ashflat;
  private post = true;
  private dpr = 1;
  private size = { w: 1, h: 1 };
  /** The ground under the ground, so past the last tile of the map there is haze, not a void. */
  private readonly floor: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.dpr = Math.min(devicePixelRatio, 1.75);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // r186 dropped PCFSoftShadowMap; PCF with a shadow radius gives the same soft edge.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x0b0714);
    this.scene.fog = new THREE.Fog(0x0b0714, 70, 220);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x3a2a55, 1);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.06;
    this.key.shadow.radius = 2.2;
    this.key.shadow.intensity = 0.82;
    this.scene.add(this.key, this.key.target);
    this.fill = new THREE.DirectionalLight(0x8899ff, 0.4);
    this.scene.add(this.fill);

    this.camera = new THREE.PerspectiveCamera(28, 1, 1, 900);
    this.director = new CameraDirector(this.camera);
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera);

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshBasicMaterial({ color: 0x0b0714 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.09;
    this.floor.renderOrder = -10;
    this.scene.add(this.floor);

    this.director.update(0);
  }

  /**
   * Adopt a district's atmosphere: sky, haze, the two lights, the shadow and the grade.
   * Every concept painting is defined as much by its light as by its buildings.
   */
  setDistrict(a: DistrictArt, sector: 'ashflat' | 'voltgrid' | 'hollow' = 'ashflat') {
    this.mood = MOODS[sector];
    this.floor.visible = true;
    this.pipeline.setLook(this.mood.look);
    this.scene.fog = new THREE.Fog(new THREE.Color(a.fog).getHex(), 70, 220);
    // The sky colour lights upward faces and the ground colour bounces up into the shade;
    // both are lifted toward the district's haze so the shadows carry the palette instead
    // of going black.
    this.hemi.color = new THREE.Color(this.mood.sky);
    this.hemi.groundColor = new THREE.Color(this.mood.bounce);
    this.hemi.intensity = this.mood.hemi;
    this.key.color = new THREE.Color(a.sun);
    this.key.intensity = this.mood.sun;
    this.fill.color = new THREE.Color(this.mood.sky);
    this.fill.intensity = this.mood.fill;
    (this.floor.material as THREE.MeshBasicMaterial).color = new THREE.Color(a.dark);

    const sky = skyTexture(a.skyTop, a.skyLow, a.wet ? 160 : 0);
    if (this.skyMesh) {
      this.scene.remove(this.skyMesh);
      (this.skyMesh.material as THREE.Material).dispose();
      this.skyMesh.geometry.dispose();
      this.skyMesh = null;
    }
    // Only the battle rig, which looks along the horizon, ever sees this.
    const geo = new THREE.PlaneGeometry(1100, 46);
    this.skyMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: sky, fog: false }));
    this.skyMesh.position.set(0, 33.5, -260);
    this.scene.add(this.skyMesh);
    this.scene.background = new THREE.Color(a.skyTop);
  }

  /** Swap the district's light for the duel's. Undone by the next `setDistrict`. */
  setDuelMood(m: DuelMood): void {
    this.mood = { look: m.look, sunAt: m.sunAt, sun: m.sun, hemi: m.hemi, sky: m.sky, bounce: m.bounce, fill: m.fillI, fogK: [4, 9] };
    this.pipeline.setLook(m.look);
    this.scene.fog = null;
    this.scene.background = new THREE.Color(m.bg);
    this.hemi.color = new THREE.Color(m.sky);
    this.hemi.groundColor = new THREE.Color(m.bounce);
    this.hemi.intensity = m.hemi;
    this.key.color = new THREE.Color(m.key);
    this.key.intensity = m.sun;
    this.fill.color = new THREE.Color(m.fill);
    this.fill.intensity = m.fillI;
    this.floor.visible = false;
    if (this.skyMesh) this.skyMesh.visible = false;
  }

  /**
   * A dungeon's atmosphere: its own sky, fog, ground tint and lights. Undone by
   * `setDistrict` when the player walks back out, which is why the city keeps
   * its mood object rather than this mutating it.
   */
  setDungeonMood(m: DungeonMood): void {
    this.pipeline.setLook({
      bloom: { strength: 0.55, radius: 0.55, threshold: 0.72 },
      exposure: 1.02,
      vignette: 0.5,
      saturation: 1.15,
      contrast: 1.16,
      shadowTint: [0.92, 0.9, 1.06],
      highlightTint: [1.06, 1.0, 0.94],
      tilt: 0.12,
      grain: 0.05,
      tone: 'neutral',
    });
    this.scene.fog = new THREE.Fog(new THREE.Color(m.fog).getHex(), m.fogNear, m.fogFar);
    this.scene.background = new THREE.Color(m.sky);
    this.hemi.color = new THREE.Color(m.hemi);
    this.hemi.groundColor = new THREE.Color(m.bounce);
    this.hemi.intensity = m.hemiI;
    this.key.color = new THREE.Color(m.key);
    this.key.intensity = m.sunI;
    this.fill.color = new THREE.Color(m.accent);
    this.fill.intensity = m.fillI;
    (this.floor.material as THREE.MeshBasicMaterial).color = new THREE.Color(m.ground);
    this.floor.visible = false;      // the dungeon brings its own floor
    if (this.skyMesh) this.skyMesh.visible = false;
  }

  /** Take the lens (the duel poses it every frame), or hand it back with `null`. */
  setCameraControl(fn: ((camera: THREE.PerspectiveCamera, dt: number) => void) | null): void {
    this.director.setCustom(fn);
  }

  get rig(): RigName {
    return this.director.rig;
  }

  setRig(rig: RigName | 'town', cut = false) {
    this.director.setRig(rig === 'town' ? 'street' : rig, cut);
  }

  /** The walkable rectangle, so the camera never frames the world beyond its edge. */
  setBounds(b: Bounds | null) {
    this.director.setBounds(b);
  }

  /** Aim a fixed rig (the battle field, a room). Follow rigs track the player instead. */
  focusOn(x: number, y: number, z: number) {
    this.director.focusOn(x, y, z);
  }

  follow(x: number, z: number, facing: number, moving: boolean, dt: number) {
    this.director.follow(x, z, facing, moving, dt);
    WU.uPlayer.value.set(x, 1.1, z);
  }

  /** Cut straight to the target after a door, a teleport or a district change. */
  snap() {
    this.director.snap();
  }

  shake(amplitude = 0.35, seconds = 0.45) {
    this.director.shake(amplitude, seconds);
  }

  get zoom(): number {
    return this.director.zoom;
  }

  /** Clamp and set the zoom. Returns the value actually used. */
  setZoom(v: number): number {
    return this.director.setZoom(v);
  }

  tuneCamera(patch: Partial<Rig>): Rig {
    return this.director.tune(patch);
  }

  /** Post on or off, for machines that cannot afford it. */
  setPost(on: boolean) {
    this.post = on;
  }

  resizeTo(element: HTMLElement) {
    const w = element.clientWidth;
    const h = element.clientHeight;
    if (!w || !h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h, this.dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the key light, its shadow frustum and the haze matched to what the camera sees. */
  private light(): void {
    const focus = this.director.focusPoint();
    const span = this.director.visibleSpan();
    const m = this.mood;
    // Depth precision is set by the near plane, and the street camera floats ~90 units above
    // the city: a near plane of 1 wastes it all on empty air and lets coplanar-ish surfaces
    // (a roof and its trim) fight. Keep it a fixed fraction of the distance to what we look at.
    const near = THREE.MathUtils.clamp(this.camera.position.distanceTo(focus) * 0.12, 1, 14);
    if (Math.abs(near - this.camera.near) > 0.25) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    // Snap the light to a grid of shadow texels, or the shadow crawls as the camera moves.
    const half = Math.max(38, span * 1.35);
    const texel = (half * 2) / this.key.shadow.mapSize.x;
    // A normalBias smaller than one shadow texel leaves grazing surfaces — roof slopes, flat
    // gravel courts — stippled with shadow acne, and the stipple crawls as you walk, which
    // reads as the texture flickering. One texel and a fifth is where acne dies without the
    // shadows detaching from what casts them.
    this.key.shadow.normalBias = texel * 1.2;
    const sx = Math.round(focus.x / texel) * texel;
    const sz = Math.round(focus.z / texel) * texel;
    this.key.target.position.set(sx, 0, sz);
    this.key.position.set(sx + m.sunAt[0], m.sunAt[1], sz + m.sunAt[2]);
    const sc = this.key.shadow.camera;
    if (sc.right !== half) {
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.near = 1;
      sc.far = 220;
      sc.updateProjectionMatrix();
    }
    this.fill.position.set(sx - m.sunAt[0] * 0.5, 30, sz - m.sunAt[2] * 0.5);
    WU.uHoleR.value = 2.2 + span * 0.045;

    if (this.scene.fog instanceof THREE.Fog) {
      const dist = this.camera.position.distanceTo(focus);
      this.scene.fog.near = dist * m.fogK[0] + 6;
      this.scene.fog.far = dist * m.fogK[1] + 40;
    }
  }

  render(dt = 1 / 60) {
    this.director.update(dt);
    this.light();
    this.floor.position.x = this.camera.position.x;
    this.floor.position.z = this.camera.position.z - 20;
    if (this.post) this.pipeline.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /**
   * What the renderer actually drew. Reading pixels from a WebGL canvas outside
   * the render task is unreliable, so this is how you tell "nothing is in the
   * scene" apart from "the readback was blank".
   */
  debug(): { calls: number; triangles: number; objects: number; camFar: number; fogFar: number } {
    let objects = 0;
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.visible) objects++;
    });
    const info = this.renderer.info.render;
    return {
      calls: info.calls,
      triangles: info.triangles,
      objects,
      camFar: this.camera.far,
      fogFar: this.scene.fog instanceof THREE.Fog ? this.scene.fog.far : -1,
    };
  }

  snapshot(): string {
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** The rendered canvas itself, so a caller can downsample before encoding. */
  snapshotCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
