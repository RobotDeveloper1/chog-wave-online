import type { Element } from '@chog/shared';

/**
 * What a dungeon looks like from the inside.
 *
 * The city is one place with three districts; the dungeons are six *places*,
 * and the whole point of walking into one is that it does not look like the
 * street you left. So each element gets its own sky, fog, ground, rock, a full
 * palette of built stone (base course, pillars, rubble), one signature prop
 * family, drifting motes, and a landmark on the horizon -- and
 * `buildDungeonField` assembles all of it.
 *
 * Keyed by element, not by dungeon id: the six dungeons map one-to-one onto the
 * six elements, so a seventh dungeon of any element would get a look for free.
 */
export interface DungeonMood {
  /** Sky, top and horizon, and the fog between them. */
  sky: string;
  skyLow: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  /** The floor, and the lip of rock around it. */
  ground: string;
  groundEdge: string;
  rock: string;
  /** The signature colour of the place, used on props and the node rings. */
  accent: string;
  glow: string;

  /**
   * Built stone. `course` is the dressed base course that faces every wall,
   * `pillar` the columns, `rubble` the loose stone that collects at the foot of
   * the rock, `crust` the cooled / frozen skin over the element itself.
   */
  course: string;
  pillar: string;
  rubble: string;
  crust: string;
  flame: string;

  /** Motes drifting through the air, and how they move. */
  mote: string;
  drift: 'ember' | 'snow' | 'spark' | 'bubble' | 'dust' | 'wisp';

  /** How high the rock piles, so each element has its own silhouette. */
  rockLo: number;
  rockHi: number;

  /** What stands on the horizon, far enough away to read as depth. */
  landmark: 'volcano' | 'glacier' | 'pylons' | 'basin' | 'geode' | 'rift';

  /** Light. `key` is the sun, `bounce` the ground bounce. */
  key: string;
  hemi: string;
  bounce: string;
  hemiI: number;
  sunI: number;
  fillI: number;
  prop: 'lava' | 'ice' | 'coil' | 'water' | 'crystal' | 'storm';
  /** One line for the entry banner. */
  air: string;
}

export const DUNGEON_MOODS: Record<Element, DungeonMood> = {
  burn: {
    sky: '#2a0d08', skyLow: '#6b2410', fog: '#3a1208', fogNear: 40, fogFar: 210,
    ground: '#3d1d14', groundEdge: '#7a3a22', rock: '#241210',
    accent: '#ff7a2e', glow: '#ff3d00',
    course: '#5c2a18', pillar: '#6b3720', rubble: '#3a1c12', crust: '#150a06', flame: '#ffb347',
    mote: '#ffb15c', drift: 'ember',
    rockLo: 3.6, rockHi: 8.4, landmark: 'volcano',
    key: '#ffb066', hemi: '#8a3a1c', bounce: '#5a1a08',
    hemiI: 1.05, sunI: 2.6, fillI: 0.9, prop: 'lava',
    air: 'the floor is warm through your boots',
  },
  frost: {
    sky: '#0b1622', skyLow: '#24455f', fog: '#16283a', fogNear: 45, fogFar: 240,
    ground: '#2b4055', groundEdge: '#6f9dc4', rock: '#1b2c3e',
    accent: '#7fd8ff', glow: '#cdefff',
    course: '#41607d', pillar: '#527596', rubble: '#2c4459', crust: '#8fc4e0', flame: '#dff0ff',
    mote: '#eaf7ff', drift: 'snow',
    rockLo: 4.2, rockHi: 10.5, landmark: 'glacier',
    key: '#dff0ff', hemi: '#4a6b8a', bounce: '#12212f',
    hemiI: 1.25, sunI: 2.8, fillI: 1.0, prop: 'ice',
    air: 'your breath hangs in the air',
  },
  volt: {
    sky: '#14102a', skyLow: '#3a2a6b', fog: '#241a44', fogNear: 40, fogFar: 200,
    ground: '#2b2150', groundEdge: '#6b58a0', rock: '#1c1636',
    accent: '#ffe066', glow: '#fff3a8',
    course: '#3f3070', pillar: '#4d3c86', rubble: '#2a2050', crust: '#241a44', flame: '#fff3a8',
    mote: '#fff3a8', drift: 'spark',
    rockLo: 3.4, rockHi: 9.0, landmark: 'pylons',
    key: '#fff0a0', hemi: '#5a4a8a', bounce: '#1a1430',
    hemiI: 1.1, sunI: 2.6, fillI: 0.9, prop: 'coil',
    air: 'the air is full of static',
  },
  wave: {
    sky: '#06202a', skyLow: '#0d4a5c', fog: '#0d3340', fogNear: 35, fogFar: 190,
    ground: '#1a4650', groundEdge: '#4b8f9a', rock: '#123138',
    accent: '#43e2a8', glow: '#8ff0d0',
    course: '#2b6070', pillar: '#357585', rubble: '#1c4a56', crust: '#0b2c33', flame: '#b8fff0',
    mote: '#b8fff0', drift: 'bubble',
    rockLo: 2.8, rockHi: 6.4, landmark: 'basin',
    key: '#b8fff0', hemi: '#2a6b78', bounce: '#08202a',
    hemiI: 1.15, sunI: 2.5, fillI: 1.0, prop: 'water',
    air: 'water is running somewhere below',
  },
  prism: {
    sky: '#1a0f26', skyLow: '#4a2a6b', fog: '#2c1b42', fogNear: 40, fogFar: 205,
    ground: '#3a2a52', groundEdge: '#8a6cbc', rock: '#241a35',
    accent: '#cbb2f2', glow: '#e0c8ff',
    course: '#4a3468', pillar: '#5c4280', rubble: '#33244a', crust: '#2a1c3e', flame: '#f0e0ff',
    mote: '#e8d4ff', drift: 'dust',
    rockLo: 3.8, rockHi: 9.6, landmark: 'geode',
    key: '#f0e0ff', hemi: '#6a4a8a', bounce: '#1f1430',
    hemiI: 1.2, sunI: 2.7, fillI: 1.0, prop: 'crystal',
    air: 'everything is refracting',
  },
  void: {
    sky: '#0a0612', skyLow: '#2a1440', fog: '#150c22', fogNear: 30, fogFar: 185,
    ground: '#1d1430', groundEdge: '#573680', rock: '#120b1e',
    accent: '#a874ff', glow: '#ff5d72',
    course: '#2e1f4a', pillar: '#3a2760', rubble: '#1e1436', crust: '#0f0a1a', flame: '#c0a0ff',
    mote: '#c0a0ff', drift: 'wisp',
    rockLo: 4.0, rockHi: 11.0, landmark: 'rift',
    key: '#c0a0ff', hemi: '#3a2a5a', bounce: '#0d0718',
    hemiI: 1.0, sunI: 2.5, fillI: 0.9, prop: 'storm',
    air: 'the ground hums under the static',
  },
};

/** The mood for a dungeon, by the element its rooms lean toward. */
export const moodFor = (element: string): DungeonMood =>
  DUNGEON_MOODS[element as Element] ?? DUNGEON_MOODS.void;
