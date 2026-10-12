import Phaser from 'phaser';
import { GENESIS_SUPPLY, SECTORS, deriveBuild } from '@chog/shared';
import { GAME_H, GAME_W } from '../config.ts';
import { net } from '../net.ts';
import { drawChogDot, lookFor, type ChogLook } from '../sprites.ts';

interface Agent {
  tokenId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  sector: number;
  look: ChogLook;
  speed: number;
  spooked: number;
}

const BAND_W = GAME_W / SECTORS.length;

/**
 * The whole collection at once. This is the shot that explains the game without
 * a word: 1,969 creatures reacting to a market none of them control.
 */
export class Habitat extends Phaser.Scene {
  private agents: Agent[] = [];
  private tex!: Phaser.Textures.CanvasTexture;
  private ctx!: CanvasRenderingContext2D;
  private clock = 0;
  private focus: Agent | null = null;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private banner = '';
  private bannerUntil = 0;
  private board: { tokenId: number; kills: number; streak: number }[] = [];

  constructor() {
    super('Habitat');
  }

  create(): void {
    this.tex = this.textures.createCanvas('habitat', GAME_W, GAME_H)!;
    this.ctx = this.tex.getContext();
    this.add.image(0, 0, 'habitat').setOrigin(0).setScale(1);

    for (let id = 1; id <= GENESIS_SUPPLY; id++) {
      const b = deriveBuild({ tokenId: id, transferCount: id % 7, daysHeld: (id * 13) % 400 });
      // Must match routeOf() in shared/wave.ts or the swarm disagrees with the sim.
      const sector = id % SECTORS.length;
      this.agents.push({
        tokenId: id,
        x: sector * BAND_W + Math.random() * BAND_W,
        y: 120 + Math.random() * (GAME_H - 180),
        vx: 0,
        vy: 0,
        r: 3 + b.personality.stamina * 2.5,
        sector,
        look: lookFor(id, b.personality),
        speed: 12 + b.personality.curiosity * 34,
        spooked: 0,
      });
    }

    this.keys = this.input.keyboard!.addKeys('W,E,TAB,SPACE,ONE,TWO,THREE') as Record<string, Phaser.Input.Keyboard.Key>;

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      let best: Agent | null = null;
      let bd = 26 * 26;
      for (const a of this.agents) {
        const d = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      this.focus = best;
    });

    net.on('signal', (m: any) => {
      if (m.signal?.type === 'spawn') {
        this.banner = `${m.signal.sector.toUpperCase()} ANOMALY — ${m.signal.boss.tier.toUpperCase()}`;
        this.bannerUntil = this.clock + 4;
        const idx = SECTORS.indexOf(m.signal.sector);
        for (const a of this.agents) if (a.sector === idx) a.spooked = 1;
      }
    });

    this.cameras.main.setBackgroundColor('#0b0714');

    // Refreshed on a timer rather than per tick: it only moves when someone
    // clears a boss, and a 1969-row query every 50ms would be silly.
    const pull = () => {
      void net.leaderboard().then((rows) => {
        this.board = rows;
      });
    };
    pull();
    this.time.addEvent({ delay: 8000, loop: true, callback: pull });
  }

  /**
   * The competitive half of retention: your rank is attached to your NFT, so a
   * holder can see exactly where their Chog sits against the rest of the pass.
   */
  private drawBoard(ctx: CanvasRenderingContext2D): void {
    const rows = this.board.slice(0, 6);
    if (!rows.length) return;
    const w = 214;
    const h = 26 + rows.length * 14;
    const x = GAME_W - w - 12;
    const y = 12;
    ctx.fillStyle = 'rgba(11,7,20,0.88)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(139,123,184,0.4)';
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = '#ffe14d';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillText('SEASON — anomalies cleared per token', x + 8, y + 15);
    rows.forEach((r, i) => {
      const mine = r.tokenId === net.me?.tokenId;
      ctx.fillStyle = mine ? '#7cf2e0' : 'rgba(200,185,235,0.8)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(
        `${String(i + 1).padStart(2, '0')}  #${r.tokenId}  ${r.kills} cleared  x${r.streak}`,
        x + 8,
        y + 30 + i * 14,
      );
    });
  }

  override update(dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000);
    this.clock += dt;

    if (Phaser.Input.Keyboard.JustDown(this.keys.E!) && net.me) {
      window.location.assign('/');
      return;
    }

    const sectors = net.sectors();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, GAME_W, GAME_H);

    for (let i = 0; i < SECTORS.length; i++) {
      const s = sectors[i];
      const wave = s?.wave ?? 0;
      const heat = Math.min(1, wave / 100);
      const x0 = i * BAND_W;

      const g = ctx.createLinearGradient(x0, 0, x0, GAME_H);
      g.addColorStop(0, `rgba(${40 + heat * 150}, ${18 + heat * 10}, ${70 - heat * 40}, 0.85)`);
      g.addColorStop(1, 'rgba(11,7,20,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, 0, BAND_W, GAME_H);

      ctx.strokeStyle = 'rgba(139,123,184,0.18)';
      ctx.beginPath();
      ctx.moveTo(x0 + BAND_W, 0);
      ctx.lineTo(x0 + BAND_W, GAME_H);
      ctx.stroke();

      // the wave bar doubles as terrain: Chogs climb toward their sector's pressure
      ctx.fillStyle = `rgba(124,242,224,${0.15 + heat * 0.4})`;
      ctx.fillRect(x0 + 8, GAME_H - 26, (BAND_W - 16) * heat, 4);

      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(200,185,235,0.75)';
      ctx.fillText(SECTORS[i]!.toUpperCase(), x0 + 10, 18);
      ctx.fillText(`wave ${wave.toFixed(0)}`, x0 + 10, 32);
      if (s?.tier && s.tier !== 'normal') {
        ctx.fillStyle = s.tier === 'storm' ? '#b04dff' : '#ff4d6d';
        ctx.fillText(s.tier.toUpperCase(), x0 + 10, 46);
      }

      if (s?.boss) {
        const bx = x0 + BAND_W / 2;
        const by = GAME_H * 0.42;
        const pulse = 1 + Math.sin(this.clock * 3) * 0.08;
        ctx.fillStyle = 'rgba(176,77,255,0.22)';
        ctx.beginPath();
        ctx.arc(bx, by, 62 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a0a2e';
        ctx.beginPath();
        ctx.arc(bx, by, 34 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff4d6d';
        ctx.fillRect(bx - 12, by - 5, 8, 8);
        ctx.fillRect(bx + 4, by - 5, 8, 8);
      }
    }

    const mine = net.me?.tokenId ?? -1;
    for (const a of this.agents) {
      const s = sectors[a.sector];
      const wave = s?.wave ?? 0;
      const heat = Math.min(1, wave / 100);
      const bx = a.sector * BAND_W + BAND_W / 2;
      const by = GAME_H * 0.42;

      // steering: wander + pressure pull + panic flee when a boss is standing
      a.vx += (Math.random() - 0.5) * a.speed * dt * 8;
      a.vy += (Math.random() - 0.5) * a.speed * dt * 8;
      a.vx += (bx - a.x) * 0.02 * heat * dt;
      if (s?.boss) {
        const dx = a.x - bx;
        const dy = a.y - by;
        const d = Math.max(40, Math.hypot(dx, dy));
        a.vx += (dx / d) * 260 * dt * a.spooked;
        a.vy += (dy / d) * 260 * dt * a.spooked;
        a.spooked = Math.max(0, a.spooked - dt * 0.12);
      }
      a.vx *= 0.94;
      a.vy *= 0.94;
      a.x += a.vx * dt;
      a.y += a.vy * dt;

      const x0 = a.sector * BAND_W;
      if (a.x < x0 + 6) { a.x = x0 + 6; a.vx = Math.abs(a.vx); }
      if (a.x > x0 + BAND_W - 6) { a.x = x0 + BAND_W - 6; a.vx = -Math.abs(a.vx); }
      if (a.y < 60) { a.y = 60; a.vy = Math.abs(a.vy); }
      if (a.y > GAME_H - 34) { a.y = GAME_H - 34; a.vy = -Math.abs(a.vy); }

      drawChogDot(ctx, a.x, a.y, a.r, a.look, heat);
      if (a.tokenId === mine) {
        ctx.strokeStyle = '#7cf2e0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r + 7 + Math.sin(this.clock * 4) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#7cf2e0';
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText('YOU', a.x - 9, a.y - a.r - 11);
      }
    }

    if (this.focus) this.drawCard(this.focus);
    else this.drawHint();
    this.drawBoard(ctx);

    if (this.clock < this.bannerUntil) {
      ctx.fillStyle = 'rgba(176,77,255,0.9)';
      ctx.font = 'bold 22px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.banner, GAME_W / 2, 92);
      ctx.textAlign = 'left';
    }

    const feed = net.world?.feed;
    if (feed) {
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillStyle = feed.mode === 'chain' ? '#7cf2e0' : '#8b7bb8';
      ctx.fillText(`FEED ${feed.describe}`, 10, GAME_H - 8);
    }
    this.tex.refresh();
  }

  private drawCard(a: Agent): void {
    const ctx = this.ctx;
    const b = deriveBuild({ tokenId: a.tokenId, transferCount: a.tokenId % 7, daysHeld: (a.tokenId * 13) % 400 });
    const x = 16;
    const y = GAME_H - 150;
    ctx.fillStyle = 'rgba(11,7,20,0.92)';
    ctx.fillRect(x, y, 300, 132);
    ctx.strokeStyle = 'rgba(139,123,184,0.5)';
    ctx.strokeRect(x + 0.5, y + 0.5, 300, 132);
    drawChogDot(ctx, x + 40, y + 46, 22, a.look, 0);
    ctx.fillStyle = '#f2e3d0';
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillText(b.callsign, x + 78, y + 24);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#8b7bb8';
    const lines = [
      `sector ${SECTORS[a.sector]} · ${b.linkSlots}x${b.linkSlots} link`,
      `wave affinity ${(b.waveAffinity * 100) | 0}%  clean ${(b.cleanSignal * 100) | 0}%`,
      `signature ${b.signature}`,
      a.tokenId === net.me?.tokenId ? 'MINE — press E to drop in' : 'not yours',
    ];
    lines.forEach((l, i) => ctx.fillText(l, x + 78, y + 42 + i * 14));
  }

  private drawHint(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(200,185,235,0.6)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('click a chog to read it   ·   E opens the shell', GAME_W - 300, GAME_H - 8);
  }
}
