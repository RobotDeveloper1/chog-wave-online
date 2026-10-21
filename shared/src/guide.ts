/**
 * The GPS arrow: "which way, how far" in one line.
 *
 * The distance is a straight hypotenuse. The arrow is screen-relative: "up" on the
 * screen is the camera's forward direction, which at yaw sits at world
 * (-sin yaw, -cos yaw) — the same vector `screenToWorld` walks along and the minimap
 * turns by. A target's compass bearing is `atan2(dx, -dz)` (0 = north, clockwise),
 * and the bearing of screen-up itself is `-yaw`, so the relative arrow is simply
 * `bearing + yaw`. Anything else (notably `bearing - (PI - yaw)`) points exactly
 * backwards, which is a bug no distance number can reveal.
 */

const TAU = Math.PI * 2;
const ARROWS = '↑↗→↘↓↙←↖';

export interface GpsReading {
  /** One of ↑↗→↘↓↙←↖, relative to the screen. */
  arrow: string;
  /** Straight-line distance in world units. */
  dist: number;
}

/** Compass bearing of a target offset: 0 = north (-z), clockwise. */
export function bearingOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

/**
 * The arrow + distance for a target `dx, dz` away, at camera `yaw`.
 * `yaw` is the director's yaw: radians clockwise from south, the corner the lens
 * sits over. At yaw 0 the camera sits south looking north, so screen-up is -z.
 */
export function gpsArrow(dx: number, dz: number, yaw: number): GpsReading {
  const rel = bearingOf(dx, dz) + yaw;
  const k = Math.round((((rel % TAU) + TAU) % TAU) / (Math.PI / 4)) % 8;
  return { arrow: ARROWS[k]!, dist: Math.hypot(dx, dz) };
}
