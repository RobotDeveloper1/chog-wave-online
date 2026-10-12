import * as THREE from 'three';
import type { MarketTick } from '@chog/shared';

/**
 * The market billboard.
 *
 * The whole premise is that this world's monsters come from real trading, and a
 * player cannot see "real trading" — they see a number in a corner. A physical
 * board on the street, scrolling actual fills with actual transaction fragments,
 * turns an invisible feed into set dressing you walk past. It is also the single
 * clearest answer to "why is the NFT essential" that the game can produce on
 * camera, because the board stops being interesting the moment the chain stops.
 *
 * Drawn to a canvas rather than as meshes: this is text, and text wants to be
 * legible at street distance.
 */

const WIDTH = 8.4;
const HEIGHT = 2.3;

export class MarketBillboard {
  readonly mesh: THREE.Mesh;
  /** Board plus its legs, so the shell adds one object. */
  readonly root = new THREE.Group();
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private ticks: MarketTick[] = [];
  private scroll = 0;
  private lastPaint = 0;

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = 280;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, HEIGHT),
      new THREE.MeshBasicMaterial({ map: this.tex, side: THREE.DoubleSide }),
    );
    // Dead centre on the player's sightline down the street, raised clear of the
    // shop roofs. Off to the side it sat half out of frame, because the camera
    // follows the player rather than the board.
    this.mesh.position.set(0, 2.9, 0);
    const legMat = new THREE.MeshToonMaterial({ color: new THREE.Color('#241a3a') });
    for (const dx of [-4.2, 4.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 0.4), legMat);
      leg.position.set(dx, 0.8, 0);
      this.root.add(leg);
    }
    // Frame the board so it reads as a structure and not a floating decal.
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(WIDTH + 0.7, HEIGHT + 0.7, 0.3),
      new THREE.MeshToonMaterial({ color: new THREE.Color('#120c22') }),
    );
    frame.position.set(0, 2.9, 0.22);
    this.root.add(frame);
    // A pavement sign by the shop door. Anything farther down the street is
    // either above the camera's band or behind a roof.
    this.root.position.set(-30, 0, -11.2);
    this.root.rotation.y = 0.5;
    this.paint();
  }

  setTicks(ticks: MarketTick[]): void {
    if (ticks.length === this.ticks.length && ticks.at(-1)?.tx === this.ticks.at(-1)?.tx) return;
    this.ticks = ticks.slice(-12);
    this.paint();
  }

  /** Scroll the strip and repaint only a few times a second — it is a sign, not a game. */
  update(dt: number, now: number): void {
    if (!this.ticks.length) return;
    this.scroll -= dt * 46;
    if (now - this.lastPaint < 90) return;
    this.lastPaint = now;
    this.paint();
  }

  private paint(): void {
    const g = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.fillStyle = '#0a0714';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4a2f86';
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);

    g.fillStyle = '#6f5f96';
    g.font = 'bold 30px ui-monospace, monospace';
    g.fillText('CHOG GENESIS · LIVE FILLS', 22, 44);
    g.fillStyle = '#2a1f42';
    g.fillRect(18, 58, w - 36, 3);

    if (!this.ticks.length) {
      g.fillStyle = '#4a3a5c';
      g.font = 'bold 44px ui-monospace, monospace';
      g.fillText('waiting for the market…', 26, 178);
      this.tex.needsUpdate = true;
      return;
    }

    g.font = 'bold 52px ui-monospace, monospace';
    g.textBaseline = 'middle';
    let x = this.scroll;
    const mid = 170;
    // Wrap by measuring, so the strip never shows a gap when it loops.
    const total = this.ticks.reduce((s, t) => s + this.entryWidth(t) + 70, 0);
    while (x < w) {
      for (const t of this.ticks) {
        if (x > -this.entryWidth(t) && x < w) this.drawEntry(t, x, mid);
        x += this.entryWidth(t) + 70;
      }
      if (x >= w) break;
    }
    this.scroll = x - total > -w ? this.scroll : -(total - w);
    this.tex.needsUpdate = true;
  }

  private entryWidth(t: MarketTick): number {
    return 250 + Math.round(String(Math.round(t.mon)).length * 30);
  }

  private drawEntry(t: MarketTick, x: number, y: number): void {
    const g = this.ctx;
    const hot = t.mon >= 15_000;
    g.fillStyle = hot ? '#ff6b8a' : '#f0e6ff';
    g.fillText(`#${t.tokenId}`, x, y);
    g.fillStyle = hot ? '#ffe066' : '#8fe8cf';
    const price = `${Math.round(t.mon).toLocaleString()} MON`;
    g.fillText(price, x + 150, y);
    g.font = '24px ui-monospace, monospace';
    g.fillStyle = '#4a3a5c';
    g.fillText(t.tx, x + 150, y + 44);
    g.font = 'bold 52px ui-monospace, monospace';
  }
}
