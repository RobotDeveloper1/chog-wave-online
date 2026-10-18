import * as THREE from 'three';
import { REGIONS, type RegionId } from '@chog/shared';

/**
 * How the Line looks, one mood per region.
 *
 * The city has three districts and the dungeon has one mood per element. The Line has six places
 * that are supposed to feel like six places, so the mood is a whole table of its own rather than
 * a palette swap — and the fiction is already written in `line.ts`'s `tagline` and `blurb`, so
 * this is only choosing colours to match sentences that exist.
 *
 * `haze` is the one that matters most. It feeds the fog distance, and a marsh you can see all the
 * way across is not a marsh: Glass Marsh sits at 0.58 and The Static Line at 0.86, so the last
 * region is the one you genuinely cannot see the end of.
 */

export interface LineMood {
  id: RegionId;
  name: string;
  /** One line, printed on the banner when the player arrives. */
  air: string;
  skyTop: number;
  skyHorizon: number;
  fog: number;
  /** 0 = a clear day, 1 = you cannot see the far side of your own region. */
  haze: number;
  key: number;
  keyI: number;
  hemi: number;
  hemiI: number;
  fill: number;
  fillI: number;
  bounce: number;
  /** The post chain's grade. `duel/` and `stage.ts` each keep their own; this one is the Line's. */
  look: { exposure: number; saturation: number; contrast: number; lift: number };
  /** How hard the wind moves the foliage. The Static Line does not sway; the Relay Flats do. */
  wind: number;
}

export const LINE_MOODS: Record<RegionId, LineMood> = {
  tolls: {
    id: 'tolls', name: 'TOLLS', air: 'dry wheat, and a dusk that never quite arrives',
    skyTop: 0x3d3658, skyHorizon: 0xa8764e, fog: 0x7a6040, haze: 0.42,
    key: 0xffb774, keyI: 1.25, hemi: 0x8a7bb0, hemiI: 0.62, fill: 0x4a3f5c, fillI: 0.35, bounce: 0x6b4f2e,
    look: { exposure: 1.1, saturation: 1.04, contrast: 1.02, lift: 0.028 },
    wind: 0.5,
  },
  ashpine: {
    id: 'ashpine', name: 'ASH PINE', air: 'the ash has not stopped in eleven years, and the needles are warm',
    skyTop: 0x1e1c26, skyHorizon: 0x54423c, fog: 0x453a36, haze: 0.66,
    key: 0xd8926a, keyI: 0.8, hemi: 0x6a6274, hemiI: 0.5, fill: 0x2e2a34, fillI: 0.3, bounce: 0x3a2e28,
    look: { exposure: 0.96, saturation: 0.9, contrast: 1.06, lift: 0.02 },
    wind: 0.35,
  },
  marsh: {
    id: 'marsh', name: 'GLASS MARSH', air: 'no wind at all, so the whole marsh reads as one mirror until you move',
    skyTop: 0x1b2a33, skyHorizon: 0x6e8a8c, fog: 0x40565a, haze: 0.58,
    key: 0xcfe4e0, keyI: 0.9, hemi: 0x7fa0a4, hemiI: 0.7, fill: 0x2c3d42, fillI: 0.4, bounce: 0x2f4648,
    look: { exposure: 1.0, saturation: 0.86, contrast: 1.08, lift: 0.026 },
    wind: 0.18,
  },
  relay: {
    id: 'relay', name: 'RELAY FLATS', air: 'a storm parked over it that will not leave, and everything repeats itself',
    skyTop: 0x15161f, skyHorizon: 0x3f4a6b, fog: 0x333a52, haze: 0.74,
    key: 0xa9b6ff, keyI: 0.85, hemi: 0x6e7ba8, hemiI: 0.55, fill: 0x232838, fillI: 0.32, bounce: 0x39405c,
    look: { exposure: 0.94, saturation: 0.92, contrast: 1.1, lift: 0.018 },
    wind: 1.0,
  },
  causeway: {
    id: 'causeway', name: 'CAUSEWAY', air: 'eighteen centimetres of water over a road long enough that the far end is a rumour',
    skyTop: 0x141e2b, skyHorizon: 0x3f5a6b, fog: 0x2b3d4c, haze: 0.5,
    key: 0x9fc4d8, keyI: 0.95, hemi: 0x5d7d94, hemiI: 0.65, fill: 0x1e2b38, fillI: 0.38, bounce: 0x25394a,
    look: { exposure: 1.0, saturation: 0.9, contrast: 1.05, lift: 0.022 },
    wind: 0.3,
  },
  static: {
    id: 'static', name: 'THE STATIC LINE', air: 'distance is something other people measured',
    skyTop: 0x0d0c16, skyHorizon: 0x2a2440, fog: 0x1a1726, haze: 0.86,
    key: 0xb79ae8, keyI: 0.7, hemi: 0x4a4270, hemiI: 0.45, fill: 0x17142a, fillI: 0.3, bounce: 0x1d1930,
    look: { exposure: 0.9, saturation: 0.78, contrast: 1.16, lift: 0.03 },
    wind: 0.05,
  },
};

export const moodOf = (region: RegionId): LineMood => LINE_MOODS[region] ?? LINE_MOODS.tolls;

export const skyGradient = (m: LineMood): THREE.Color[] => [
  new THREE.Color(m.skyTop),
  new THREE.Color(m.skyHorizon),
];

/** The banner text, taken from the region itself so the table cannot drift from the fiction. */
export const arrivalLine = (region: RegionId): string =>
  `${REGIONS.find((r) => r.id === region)?.tagline ?? ''}`;