import * as THREE from 'three';
import { SF, type Element, type SectorId } from '@chog/shared';

/**
 * Where things stand in the duel, and what colour they are.
 *
 * The SF field is three to six files wide and five lanes deep — six across a PvP
 * field, three a side. The player's Chog stands on the near lanes, the boss looms
 * over the three far ones, and the camera
 * looks down the files from behind and above the player — the Star Force shot, turned
 * ninety degrees so the lanes recede instead of running across the screen.
 */

export const FILES = SF.MIN_COLS;
/** Buffers cover the widest authoritative SF floor. */
export const MAX_FILES = SF.MAX_COLS;
export const LANES = SF.LANES;
/** Buffers cover the deepest authoritative floor: six lanes in PvP. */
export const MAX_LANES = SF.PVP_LANES;
/** A panel's edge and the gap between panels, in world units. */
export const PANEL = 2.05;
export const GAP = 0.18;
export const PITCH = PANEL + GAP;

/**
 * x of a file, z of a lane. Lane 0 is the far wall; the last lane is under the
 * player's feet — lane 4 in PvE, lane 5 across a PvP field.
 *
 * `files` and `lanes` are the depth from the server snapshot rather than constants.
 * Centring on them keeps three files in the middle of the board and six filling it,
 * instead of a wide arena that slides off to the right as the Chog grows.
 */
export const fileX = (file: number, files = FILES): number => (file - (files - 1) / 2) * PITCH;
export const laneZ = (lane: number, lanes = LANES): number => (lane - (lanes - 1) / 2) * PITCH;

/** The two sides of the board: lanes 0-2 are the anomaly's, the rest are yours. */
export const isEnemyLane = (lane: number, firstMine = SF.FIRST_PLAYER_LANE): boolean => lane < firstMine;

export const ELEMENT_HEX: Record<string, number> = {
  burn: 0xff7a45,
  frost: 0x7fd8ff,
  volt: 0xffe066,
  wave: 0x43e2a8,
  prism: 0xcbb2f2,
  void: 0xa874ff,
};

export const elementColour = (e: string): THREE.Color => new THREE.Color(ELEMENT_HEX[e] ?? 0xffffff);

export interface Palette {
  /** The void behind everything, top and horizon. */
  top: string;
  low: string;
  /** The two teams' panels. */
  mine: string;
  theirs: string;
  /** Rings, streams, motes. */
  accent: string;
  accent2: string;
}

export const PALETTES: Record<SectorId, Palette> = {
  // Golden hour turned into a battle network: a violet void with an ember horizon.
  ashflat: { top: '#150a2c', low: '#8a3a4a', mine: '#ff7a45', theirs: '#5aa0ff', accent: '#ffb45e', accent2: '#ff5a8a' },
  // Night: black glass, cyan edges, magenta flares.
  voltgrid: { top: '#02040e', low: '#0a3552', mine: '#ff4fd8', theirs: '#2fe0ff', accent: '#35e0ff', accent2: '#ff4fd8' },
  // Overcast: a green-grey dome and a lit lagoon.
  hollow: { top: '#0b1a17', low: '#2a6a58', mine: '#ffd070', theirs: '#5ff0c0', accent: '#6fe3c8', accent2: '#c9ff8a' },
};

/**
 * A dungeon's fights are lit by what the dungeon is made of, not by the district they began in:
 * the enemy side of the board takes the element's colour and the player's side keeps a hue that
 * contrasts with it, so "mine" and "theirs" read at a glance in every one of the six.
 */
export const ELEMENT_PALETTES: Record<Element, Palette> = {
  // the foundry: black iron over a red-hot horizon
  burn: { top: '#14060a', low: '#a8300f', mine: '#6fd0ff', theirs: '#ff5a2a', accent: '#ffb347', accent2: '#ff3d2e' },
  // the archive: cold glass and ice-blue light
  frost: { top: '#040c1c', low: '#2a6a9a', mine: '#ffb86b', theirs: '#8fe0ff', accent: '#b8ecff', accent2: '#6aa8ff' },
  // the spire: indigo night and yellow lightning
  volt: { top: '#07061a', low: '#3b2f8a', mine: '#59a8ff', theirs: '#ffe45c', accent: '#ffe45c', accent2: '#8a6cff' },
  // the reservoir: deep water, aqua light
  wave: { top: '#021018', low: '#0f6a78', mine: '#ffcf6a', theirs: '#35d6c4', accent: '#6fe3c8', accent2: '#2f9bff' },
  // the vault: violet glass, every reflection a little too bright
  prism: { top: '#120826', low: '#7a3aa8', mine: '#ffd070', theirs: '#d9a0ff', accent: '#e8c8ff', accent2: '#6af0ff' },
  // the core: nearly black, one hot magenta seam
  void: { top: '#04010a', low: '#2a0f4a', mine: '#6af0c8', theirs: '#b06bff', accent: '#c08cff', accent2: '#ff3a9a' },
};

/** A smooth 0..1 -> 0..1 ease used by the little tweens. */
export const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
export const easeInOut = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
