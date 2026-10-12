import Phaser from 'phaser';
import { GENESIS_SUPPLY } from '@chog/shared';
import { sfx, toggleMute, unlock } from '../audio.ts';
import { GAME_H, GAME_W } from '../config.ts';
import { net } from '../net.ts';
import { drawChogDot, lookFor } from '../sprites.ts';

/**
 * Three sentences and a picture. A judge decides in about ten seconds whether the
 * premise is interesting, so the premise goes before the controls.
 */
export class Title extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    const tex = this.textures.createCanvas('title', GAME_W, GAME_H)!;
    const ctx = tex.getContext();
    this.add.image(0, 0, 'title').setOrigin(0);

    ctx.fillStyle = '#0b0714';
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    // The Chog swarm, already alive behind the type, so the screen is the pitch.
    for (let i = 0; i < 420; i++) {
      const id = 1 + ((i * 977) % GENESIS_SUPPLY);
      const look = lookFor(id, {
        aggression: (i % 7) / 7,
        skittish: ((i * 3) % 11) / 11,
        curiosity: ((i * 5) % 13) / 13,
        stamina: ((i * 7) % 17) / 17,
      });
      const x = (i * 173) % GAME_W;
      const y = 150 + ((i * 271) % (GAME_H - 150));
      ctx.globalAlpha = 0.55;
      drawChogDot(ctx, x, y, 3 + ((i * 13) % 5), look, 0.2);
    }
    ctx.globalAlpha = 1;

    // The scrim has to cover the controls block too: stopping at the pitch left
    // the swarm dots punching through the smallest text on screen.
    const grad = ctx.createLinearGradient(0, 0, 0, 390);
    grad.addColorStop(0, 'rgba(11,7,20,0.99)');
    grad.addColorStop(0.72, 'rgba(11,7,20,0.94)');
    grad.addColorStop(1, 'rgba(11,7,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, GAME_W, 390);

    ctx.fillStyle = '#7cf2e0';
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.fillText('A MONAD GAME', 40, 44);

    ctx.fillStyle = '#f2e3d0';
    ctx.font = 'bold 56px ui-monospace, monospace';
    ctx.fillText('CHOG WAVE', 40, 96);

    ctx.font = '14px ui-monospace, monospace';
    ctx.fillStyle = '#b8a6e0';
    const pitch = [
      'Every Chog you swap stresses the chain. The chain answers with Anomalies.',
      `All ${GENESIS_SUPPLY} Genesis Chogs live in three sectors, and the market decides`,
      'which sector tears open next. You do not pick a character — you bring your NFT.',
    ];
    pitch.forEach((l, i) => ctx.fillText(l, 40, 130 + i * 21));

    ctx.fillStyle = '#8b7bb8';
    ctx.font = '12px ui-monospace, monospace';
    const controls = [
      'HABITAT   click a Chog to read it  ·  E opens the current shell',
      'DUEL      step off marked panels  ·  pick cards when the Custom Screen opens',
      '          build an element chain  ·  fire the Buster between screens',
    ];
    controls.forEach((l, i) => ctx.fillText(l, 40, 232 + i * 19));

    ctx.fillStyle = '#ffe14d';
    ctx.font = 'bold 16px ui-monospace, monospace';
    ctx.fillText('press any key to enter the habitat', 40, 320);

    ctx.fillStyle = '#6b5a8f';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('sign in with a wallet and pick a chog — or take a foster chog, no wallet', 40, 344);

    tex.refresh();

    this.input.keyboard!.on('keydown', () => {
      unlock();
      sfx.ui();
      this.scene.start('Habitat');
    });
    this.input.on('pointerdown', () => {
      unlock();
      this.scene.start('Habitat');
    });

    // Mute is a key on both screens because procedural audio that cannot be
    // silenced is worse than no audio.
    this.input.keyboard!.on('keydown-M', () => toggleMute());

    net.on('signal', (m: any) => {
      if (m.signal?.type === 'spawn' && this.sys.isActive()) {
        sfx.spawn();
        this.cameras.main.flash(240, 120, 40, 180);
      }
    });
  }
}
