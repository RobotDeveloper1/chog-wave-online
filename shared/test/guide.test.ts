import { describe, expect, it } from 'vitest';
import { bearingOf, gpsArrow } from '../src/guide.ts';

/**
 * The GPS arrow must agree with the screen, not just the map. The distance is a
 * hypotenuse and cannot be wrong while the target is right — but the arrow combines
 * the target's bearing with the camera's yaw, and the wrong combination points
 * exactly backwards while every metre stays correct.
 */

const YAWS = [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 4, (3 * Math.PI) / 2, 0.3];

describe('the GPS arrow', () => {
  it('points up-screen at a target straight ahead of the camera, at any yaw', () => {
    for (const yaw of YAWS) {
      // Screen-up in world units: the vector the camera looks along.
      const dx = -Math.sin(yaw) * 10;
      const dz = -Math.cos(yaw) * 10;
      expect(gpsArrow(dx, dz, yaw).arrow, `yaw ${yaw}`).toBe('↑');
    }
  });

  it('points down-screen at what is behind the camera, at any yaw', () => {
    for (const yaw of YAWS) {
      expect(gpsArrow(Math.sin(yaw) * 10, Math.cos(yaw) * 10, yaw).arrow, `yaw ${yaw}`).toBe('↓');
    }
  });

  it('points left and right along the screen, at any yaw', () => {
    for (const yaw of YAWS) {
      // Screen-right in world units.
      expect(gpsArrow(Math.cos(yaw) * 10, -Math.sin(yaw) * 10, yaw).arrow, `yaw ${yaw} right`).toBe('→');
      expect(gpsArrow(-Math.cos(yaw) * 10, Math.sin(yaw) * 10, yaw).arrow, `yaw ${yaw} left`).toBe('←');
    }
  });

  it('is a compass when the camera looks north', () => {
    expect(gpsArrow(0, -10, 0).arrow).toBe('↑');
    expect(gpsArrow(10, 0, 0).arrow).toBe('→');
    expect(gpsArrow(0, 10, 0).arrow).toBe('↓');
    expect(gpsArrow(-10, 0, 0).arrow).toBe('←');
    expect(gpsArrow(10, -10, 0).arrow).toBe('↗');
  });

  it('turns with the camera: one world target, four yaws, four arrows', () => {
    // A target due east of the player.
    expect(gpsArrow(10, 0, 0).arrow).toBe('→');
    expect(gpsArrow(10, 0, Math.PI / 2).arrow).toBe('↓');
    expect(gpsArrow(10, 0, Math.PI).arrow).toBe('←');
    expect(gpsArrow(10, 0, -Math.PI / 2).arrow).toBe('↑');
  });

  it('reports the straight distance alongside the arrow', () => {
    expect(gpsArrow(6, -8, 0.7)).toEqual({ arrow: expect.any(String), dist: 10 });
    expect(bearingOf(0, -1)).toBeCloseTo(0, 10);
    expect(bearingOf(1, 0)).toBeCloseTo(Math.PI / 2, 10);
  });
});
