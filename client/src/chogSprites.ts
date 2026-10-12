import Phaser from 'phaser';
import { GENESIS_SUPPLY } from '@chog/shared';
import { SERVER_HTTP } from './config.ts';

/**
 * Runtime loader for the baked 3D Chogs.
 *
 * The atlas layout is fixed by tools/bake_atlas.py: a 6x4 grid of 128px cells
 * holding idle(6), walk(8), attack(5) and hit(4). Slot order is duplicated here
 * on purpose rather than fetched, so a missing index.json cannot break rendering.
 *
 * Atlases come from the server one token at a time. Bundling all 1969 would be
 * ~280MB for a client that only ever displays its own Chog and two friends.
 */
const CELL = 128;
const ACTIONS = [
  { name: 'idle', first: 0, count: 6, rate: 8, repeat: -1 },
  { name: 'walk', first: 6, count: 8, rate: 14, repeat: -1 },
  { name: 'attack', first: 14, count: 5, rate: 16, repeat: 0 },
  { name: 'hit', first: 19, count: 4, rate: 12, repeat: 0 },
] as const;

const inflight = new Map<number, Promise<boolean>>();

export function hasChog(tokenId: number): boolean {
  // 1..1969 inclusive. A `< 1969` bound silently dropped the last Chog in the
  // pass — and the last Chog is exactly the kind of token a judge holds.
  return Number.isInteger(tokenId) && tokenId >= 1 && tokenId <= GENESIS_SUPPLY;
}

/** Resolves true when the texture is registered; false means "use the fallback". */
export function loadChog(scene: Phaser.Scene, tokenId: number): Promise<boolean> {
  const key = texKey(tokenId);
  if (scene.textures.exists(key)) return Promise.resolve(true);
  // Fostered visitors get an out-of-range id, and asking the server for
  // /chogs/900001.png is a guaranteed 404 on every join.
  if (!hasChog(tokenId)) return Promise.resolve(false);
  if (inflight.has(tokenId)) return inflight.get(tokenId)!;

  const p = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (!scene.textures.exists(key)) {
        scene.textures.addSpriteSheet(key, img as HTMLImageElement, {
          frameWidth: CELL,
          frameHeight: CELL,
        });
        for (const a of ACTIONS) {
          const animKey = animKeyFor(tokenId, a.name);
          if (!scene.anims.exists(animKey)) {
            scene.anims.create({
              key: animKey,
              frames: scene.anims.generateFrameNumbers(key, {
                start: a.first,
                end: a.first + a.count - 1,
              }),
              frameRate: a.rate,
              repeat: a.repeat,
            });
          }
        }
      }
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = `${SERVER_HTTP}/chogs/${tokenId}.png`;
  });
  inflight.set(tokenId, p);
  return p;
}

export const texKey = (tokenId: number) => `chog3d-${tokenId}`;
export const animKeyFor = (tokenId: number, action: string) => `chog3d-${tokenId}-${action}`;

/**
 * The baked walk cycle is shot from one side, so left is the same art mirrored.
 * Mirroring a sprite is free; baking a second yaw is not.
 */
export function playChog(
  sprite: Phaser.GameObjects.Sprite,
  tokenId: number,
  action: 'idle' | 'walk' | 'attack' | 'hit',
): void {
  const key = animKeyFor(tokenId, action);
  // currentAnim, not a name property: Phaser has no `animationName`, so the
  // comparison was always true and play() restarted the clip every single frame.
  if (sprite.anims.currentAnim?.key !== key) sprite.play(key, true);
}
