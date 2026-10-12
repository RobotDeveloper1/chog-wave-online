import type { CityLayout, Rect } from '@chog/shared';
import type { DistrictArt } from '../art.ts';

/**
 * The radar.
 *
 * The district is drawn once into an offscreen canvas straight from the plan — roads,
 * pavements, the footprint of every building shaded by how tall it is, parks, water —
 * and then each frame a window of it is blitted into the HUD disc, turned so that "up"
 * on the radar is "up" on the screen. That last part is what makes it usable in an
 * isometric city: the camera is a quarter turn off the grid, and a north-up map would
 * make every left turn a puzzle.
 */

export type MarkerKind = 'npc' | 'quest' | 'turnin' | 'door' | 'gate' | 'poi' | 'remote' | 'anomaly' | 'board' | 'wave' | 'hole';

export interface MapMarker {
  x: number;
  z: number;
  kind: MarkerKind;
  label?: string;
}

const COLOUR: Record<MarkerKind, string> = {
  npc: '#a093c2',
  quest: '#f5c343',
  turnin: '#43e2a8',
  door: '#7fd8ff',
  gate: '#ff9ef0',
  poi: '#cbb2f2',
  remote: '#ffffff',
  anomaly: '#ff5d72',
  board: '#f5c343',
  wave: '#6ad2e6',
  hole: '#ff7a45',
};

const PX = 2.4;

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement | null = null;
  private extent: Rect = { x0: 0, z0: 0, x1: 1, z1: 1 };
  /** World units from the player to the edge of the disc. */
  radius = 38;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Paint the district's static layer. Called once per district. */
  setCity(layout: CityLayout, art: DistrictArt): void {
    this.extent = layout.extent;
    const w = Math.ceil((layout.extent.x1 - layout.extent.x0) * PX);
    const h = Math.ceil((layout.extent.z1 - layout.extent.z0) * PX);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const X = (x: number): number => (x - layout.extent.x0) * PX;
    const Z = (z: number): number => (z - layout.extent.z0) * PX;
    const fill = (r: Rect, col: string): void => {
      g.fillStyle = col;
      g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * PX, (r.z1 - r.z0) * PX);
    };

    g.fillStyle = '#0a0612';
    g.fillRect(0, 0, w, h);
    // Blocks as pavement, streets as the dark between them.
    for (const b of layout.blocks) fill(b.rect, '#3a3050');
    for (const s of layout.streets) fill(s.rect, s.main ? '#241c38' : '#1b1430');
    for (const s of layout.streets) {
      if (!s.main) continue;
      g.strokeStyle = 'rgba(255,210,77,.35)';
      g.lineWidth = 1;
      g.setLineDash([6, 6]);
      g.beginPath();
      if (s.axis === 'x') {
        g.moveTo(X(s.rect.x0), Z((s.rect.z0 + s.rect.z1) / 2));
        g.lineTo(X(s.rect.x1), Z((s.rect.z0 + s.rect.z1) / 2));
      } else {
        g.moveTo(X((s.rect.x0 + s.rect.x1) / 2), Z(s.rect.z0));
        g.lineTo(X((s.rect.x0 + s.rect.x1) / 2), Z(s.rect.z1));
      }
      g.stroke();
      g.setLineDash([]);
    }
    for (const ct of layout.courts) {
      const col =
        ct.kind === 'lawn' || ct.kind === 'garden' || ct.kind === 'allotment'
          ? '#2f5a3c'
          : ct.kind === 'water'
            ? '#2c5f86'
            : ct.kind === 'plaza' || ct.kind === 'market'
              ? '#6a5878'
              : ct.kind === 'dirt' || ct.kind === 'yard' || ct.kind === 'track'
                ? '#4a3c34'
                : '#4a4060';
      fill(ct.rect, col);
    }
    // Buildings, brighter the taller they are, so the skyline is legible from above.
    for (const l of layout.lots) {
      const t = Math.min(1, l.h / 40);
      const v = Math.round(90 + t * 110);
      g.fillStyle = `rgb(${Math.round(v * 0.95)},${Math.round(v * 0.82)},${Math.round(v * 1.1)})`;
      g.fillRect(X(l.x - l.w / 2), Z(l.z - l.d / 2), l.w * PX, l.d * PX);
    }
    for (const lm of layout.landmarks) {
      g.fillStyle = lm.kind === 'waveStation' ? '#6ad2e6' : '#cbb2f2';
      g.fillRect(X(lm.x - lm.w / 2), Z(lm.z - lm.d / 2), lm.w * PX, lm.d * PX);
    }
    void art;
    this.layer = c;
  }

  draw(px: number, pz: number, yaw: number, facing: number, markers: MapMarker[], t: number): void {
    const { canvas, ctx: g } = this;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = Math.round(canvas.clientWidth * dpr) || 224;
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const s = size / (this.radius * 2);
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#07040e';
    g.fillRect(0, 0, size, size);

    if (this.layer) {
      g.save();
      g.translate(size / 2, size / 2);
      g.rotate(yaw);
      g.scale(s / PX, s / PX);
      g.translate(-(px - this.extent.x0) * PX, -(pz - this.extent.z0) * PX);
      g.imageSmoothingEnabled = true;
      g.drawImage(this.layer, 0, 0);
      g.restore();
    }

    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - px;
      const dz = z - pz;
      return [size / 2 + (dx * cs - dz * sn) * s, size / 2 + (dx * sn + dz * cs) * s];
    };

    for (const m of markers) {
      let [sx, sy] = toScreen(m.x, m.z);
      const dist = Math.hypot(sx - size / 2, sy - size / 2);
      const edge = size / 2 - 7 * dpr;
      const important = m.kind === 'quest' || m.kind === 'turnin' || m.kind === 'anomaly' || m.kind === 'gate';
      let clamped = false;
      if (dist > edge) {
        if (!important) continue;
        const k = edge / dist;
        sx = size / 2 + (sx - size / 2) * k;
        sy = size / 2 + (sy - size / 2) * k;
        clamped = true;
      }
      const r = (m.kind === 'remote' ? 2.4 : m.kind === 'npc' ? 2.6 : 4) * dpr;
      g.fillStyle = COLOUR[m.kind];
      g.strokeStyle = '#08040f';
      g.lineWidth = 1.6 * dpr;
      g.beginPath();
      if (m.kind === 'quest' || m.kind === 'turnin' || m.kind === 'anomaly') {
        // A diamond that breathes: these are the things the player is being sent to.
        const pulse = 1 + 0.18 * Math.sin(t * 5);
        g.moveTo(sx, sy - r * 1.6 * pulse);
        g.lineTo(sx + r * 1.2 * pulse, sy);
        g.lineTo(sx, sy + r * 1.6 * pulse);
        g.lineTo(sx - r * 1.2 * pulse, sy);
        g.closePath();
      } else if (m.kind === 'gate') {
        g.rect(sx - r, sy - r, r * 2, r * 2);
      } else {
        g.arc(sx, sy, r, 0, Math.PI * 2);
      }
      g.fill();
      g.stroke();
      void clamped;
    }

    // The player: an arrow pointing the way the Chog faces, relative to the turned view.
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const ax = fx * cs - fz * sn;
    const ay = fx * sn + fz * cs;
    const a = Math.atan2(ay, ax);
    g.save();
    g.translate(size / 2, size / 2);
    g.rotate(a + Math.PI / 2);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#9a72ea';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.moveTo(0, -7 * dpr);
    g.lineTo(5 * dpr, 6 * dpr);
    g.lineTo(0, 3 * dpr);
    g.lineTo(-5 * dpr, 6 * dpr);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    g.restore();
  }

  /** The whole district, for the lower screen's world map. */
  drawWorld(target: HTMLCanvasElement, px: number, pz: number, markers: MapMarker[]): void {
    if (!this.layer) return;
    const g = target.getContext('2d')!;
    const w = target.clientWidth || 400;
    const h = target.clientHeight || 260;
    if (target.width !== w) target.width = w;
    if (target.height !== h) target.height = h;
    g.clearRect(0, 0, w, h);
    const k = Math.min(w / this.layer.width, h / this.layer.height);
    const ox = (w - this.layer.width * k) / 2;
    const oz = (h - this.layer.height * k) / 2;
    g.drawImage(this.layer, ox, oz, this.layer.width * k, this.layer.height * k);
    const at = (x: number, z: number): [number, number] => [ox + (x - this.extent.x0) * PX * k, oz + (z - this.extent.z0) * PX * k];
    for (const m of markers) {
      if (m.kind === 'remote') continue;
      const [sx, sy] = at(m.x, m.z);
      g.fillStyle = COLOUR[m.kind];
      g.strokeStyle = '#08040f';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(sx, sy, m.kind === 'quest' || m.kind === 'turnin' ? 4.5 : 3, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      // A dot nobody can name is noise: the places the game sends you to carry their name.
      if (m.label && (m.kind === 'door' || m.kind === 'anomaly' || m.kind === 'quest' || m.kind === 'turnin' || m.kind === 'board')) {
        g.fillStyle = COLOUR[m.kind];
        g.font = '600 9px ui-monospace, monospace';
        g.textAlign = sx > w * 0.6 ? 'right' : 'left';
        g.fillText(m.label.toUpperCase(), sx + (sx > w * 0.6 ? -6 : 6), sy + 3);
      }
    }
    // The tracked quest gets an arrow on the edge of the map, so "where do I go" has an answer
    // even when the target is behind you or off the page.
    const quest = markers.find((m) => m.kind === 'quest' || m.kind === 'turnin');
    if (quest) {
      const [tx, ty] = at(quest.x, quest.z);
      const [mx, my] = at(px, pz);
      const dx = tx - mx;
      const dy = ty - my;
      const dist = Math.hypot(quest.x - px, quest.z - pz);
      const ang = Math.atan2(dy, dx);
      const r = Math.min(w, h) / 2 - 14;
      const cx = w / 2 + Math.cos(ang) * r;
      const cy = h / 2 + Math.sin(ang) * r;
      g.save();
      g.translate(cx, cy);
      g.rotate(ang);
      g.fillStyle = COLOUR.quest;
      g.strokeStyle = '#08040f';
      g.beginPath();
      g.moveTo(9, 0);
      g.lineTo(-6, -6);
      g.lineTo(-6, 6);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
      g.fillStyle = COLOUR.quest;
      g.font = '700 10px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText(`${Math.round(dist)}m`, cx, cy + (dy > 0 ? 16 : -10));
    }
    const [sx, sy] = at(px, pz);
    g.fillStyle = '#fff';
    g.strokeStyle = '#9a72ea';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(sx, sy, 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}
