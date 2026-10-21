import * as THREE from 'three';
import { loadChogNFT, type Chog, type PartsModel } from '../chogLoader.ts';
import { TRIBE_TINT } from '../tribes.ts';

/**
 * A close-up of an NPC's head and shoulders, drawn into a small canvas for the dialogue box.
 *
 * The box used to hold a single element glyph, which stole a third of the panel from the
 * words and told the player nothing about who was talking. The portrait reuses the same
 * Chog model the city already streams for this NPC — same `loadChogNFT` call, same
 * `TRIBE_TINT` map, same `id -> tokenId` hash — so the person in the chip is the same
 * person standing at the door. The rig runs the same idle motion (head sway, spine breath)
 * it runs in the plaza, so the figure never goes static while the player reads.
 *
 * The canvas is re-attached on every page turn (the dialogue box is rebuilt from innerHTML
 * when pages advance), so the host keeps the same `portrait.canvas` reference alive across
 * the lifetime of the dialogue and disposes it once.
 */
const PORTRAIT_MODEL: PartsModel = {
  baseUrl: '/models/chog-base.glb',
  partsUrl: '/models/trait-parts.json',
  colorsUrl: '/models/trait-colors.json',
  skinsUrl: '/models/skins.json',
  skullBaseUrl: '/models/chog-skull.glb',
  skullSkinsUrl: '/models/skull-skins.json',
};

/** Same FNV-1a the explorer uses to pin an NPC id to a token, kept local so the HUD module
 *  does not reach across files just to spell an id. */
const tokenOf = (id: string): number => 1 + (hash(id) % 1900);
const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Where the face sits on a chog, as a fraction of its height, and how many heights back
 *  the camera stands. Both were picked off `client/portrait-test.html`. */
const FACE_Y = 0.58;
const FACE_D = 1.02;

export class DialoguePortrait {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private chog: Chog | null = null;
  /** Called once the chog is in the scene, so the host can drop the placeholder glyph. */
  private onReady: (() => void) | undefined;
  /** Set once the chog has been added to the scene — the host toggles CSS on this to swap
   *  the placeholder glyph for the live render without a layout jump. */
  ready = false;
  private raf = 0;
  private last = 0;
  private resizeObs: ResizeObserver | null = null;
  private disposed = false;

  constructor(npcId: string, tribe: string, onReady?: () => void) {
    this.onReady = onReady;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'face-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);

    // A small three-point rig tuned for a head-and-shoulders chip: warm key from the
    // upper-right (the kind the city's lanterns cast), cool fill from the left, and
    // enough ambient that the underside of the mane does not collapse to black.
    const key = new THREE.DirectionalLight(0xfff2dd, 1.5);
    key.position.set(0.8, 1.4, 1.2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfd6ff, 0.75);
    fill.position.set(-1.1, 0.6, 0.5);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    this.camera.position.set(0, 1.55, 4.5);
    this.camera.lookAt(0, 1.45, 0);

    void this.load(npcId, tribe);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Called by the host after the canvas is in the DOM. The chip is square by layout, but
   *  we listen in case the box resizes between phones and desktops. */
  attach(): void {
    this.syncSize();
    if (typeof ResizeObserver !== 'undefined' && !this.resizeObs) {
      this.resizeObs = new ResizeObserver(() => this.syncSize());
      this.resizeObs.observe(this.canvas);
    }
  }

  private async load(npcId: string, tribe: string): Promise<void> {
    try {
      const chog = await loadChogNFT({
        ...PORTRAIT_MODEL,
        traits: {},
        tokenId: tokenOf(npcId),
        tint: TRIBE_TINT[tribe] ?? {},
      });
      if (this.disposed) return;
      this.chog = chog;
      // An off-axis angle reads as a portrait; a dead-frontal one reads as a mugshot.
      chog.root.rotation.y = -0.28;
      this.scene.add(chog.root);
      this.frameCamera();
      this.ready = true;
      this.onReady?.();
    } catch {
      // Missing GLB: the chip keeps showing the element glyph and nobody has to know.
    }
  }

  /**
   * The crop, calibrated against `client/portrait-test.html` — keep the two in step.
   *
   * The chog is chibi: the head and its mane are most of the body, and the face sits around
   * 0.58 of the model's height, *not* at the top. The first attempt framed at 0.86 and got a
   * chip full of spikes with no face in it. At 1.02 heights back, with the camera level with
   * the eyes, the face fills the chip and the mane frames it without cropping the mouth.
   */
  private frameCamera(): void {
    if (!this.chog) return;
    const h = this.chog.height;
    this.camera.position.set(0, FACE_Y * h, FACE_D * h);
    this.camera.lookAt(0, FACE_Y * h, 0);
  }

  private syncSize(): void {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width || 96));
    const h = Math.max(1, Math.floor(r.height || 96));
    const dpr = this.renderer.getPixelRatio();
    if (this.canvas.width !== w * dpr) this.canvas.width = w * dpr;
    if (this.canvas.height !== h * dpr) this.canvas.height = h * dpr;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick = (t: number): void => {
    if (this.disposed) return;
    const dt = this.last === 0 ? 0.016 : (t - this.last) / 1000;
    this.last = t;
    // The same `update` the city runs; the chog's own speed stays 0, so the rig reads
    // `idle` and applies the head sway and spine breath the motion file defines.
    this.chog?.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((mm) => mm?.dispose?.());
    });
    // `dispose` alone leaves the context alive until the GC gets round to it, and a browser
    // caps how many live contexts a page may hold — a player who talks to twenty people in a
    // row would run out and the next portrait would come up blank. Dropping it by hand makes
    // the free deterministic.
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}
