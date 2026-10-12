import * as THREE from 'three';

/**
 * The colour script, read off the four concept paintings rather than invented.
 *
 * Each district owns a palette, a sky, a light temperature and a road surface, and
 * those four things change *together*. That is what makes a screenshot say "I am in
 * Voltgrid" before any sign is readable — which is the whole reason the concepts were
 * painted first instead of tuning numbers in the dark.
 *
 * Nothing here is a magic number pulled from thin air: the hex values are the ones the
 * concept art actually shows, and the comments name the thing they are standing for.
 */

export interface DistrictArt {
  /** Building walls, in the order a block plan cycles them. */
  wall: string[];
  /** Stone/brick secondary, used for plinths, dormers and frames. */
  stone: string;
  /** Roofing. */
  roof: string[];
  /** Painted trim: cornices, window frames, kerb faces. */
  trim: string;
  /** Accent that appears on signs, awnings and doors. */
  accent: string;
  /** Second awning colour, for the stripe. */
  cloth: string;
  /** Structural metal: railings, poles, trestles, bins. */
  metal: string;
  /** Lit window colour, and how strongly it glows. */
  window: string;
  windowGlow: number;
  /** Unlit window / recess. */
  dark: string;
  /** Neon or emissive edge trim. Zero for districts that have none. */
  neon: string;
  neonGlow: number;
  /** Foliage and trunk. */
  leaf: string;
  trunk: string;
  /** Road, pavement and paint. */
  asphalt: string;
  pavement: string;
  paint: string;
  /** Whether the road is wet enough to mirror the lights. */
  wet: boolean;
  /** Sky gradient, top to horizon, plus the haze band behind the skyline. */
  skyTop: string;
  skyLow: string;
  haze: string;
  /** Fog colour and how soon it starts eating distance. */
  fog: string;
  fogNear: number;
  fogFar: number;
  /** Key light. */
  sun: string;
  sunIntensity: number;
  ambient: string;
  ambientIntensity: number;
}

export const DISTRICTS: Record<'ashflat' | 'voltgrid' | 'hollow', DistrictArt> = {
  // Ashflat: brick row houses at dusk, warm windows, cream trim, dusty rose haze.
  // The wall ramp is deliberately *not* five bricks: a street where every house is the same
  // red reads as one long building. Painted stucco and ochre and sage houses between the
  // brick ones are what give a row its identity, and palette() cycles the first, second and
  // fourth of these across the three facade atlases.
  ashflat: {
    wall: ['#8c4b39', '#b7a687', '#7b4436', '#8f8a5e', '#6f7f6e'],
    stone: '#c9bda3',
    // Clay tile, tar and a warm slate. The old set was three shades of violet-grey, and from
    // above — where roofs are half of what the camera sees — that was the "purple haze".
    roof: ['#8a4e3c', '#575660', '#6a5a52'],
    trim: '#e4d6b6',
    accent: '#c2523f',
    cloth: '#e8dcc0',
    metal: '#4a4038',
    window: '#ffd48a',
    windowGlow: 1.15,
    dark: '#241c2c',
    neon: '#ffb45e',
    neonGlow: 0.35,
    leaf: '#5f7a3c',
    trunk: '#4a3324',
    asphalt: '#3a3836',
    pavement: '#867a6c',
    paint: '#e8dcc0',
    wet: false,
    skyTop: '#3f3a63',
    skyLow: '#e8926a',
    haze: '#b87a7e',
    fog: '#a98279',
    fogNear: 60,
    fogFar: 210,
    sun: '#ffcf9e',
    sunIntensity: 1.35,
    ambient: '#6a5a78',
    ambientIntensity: 0.62,
  },
  // Voltgrid: night, wet asphalt, cyan edge trim and magenta signage on dark steel.
  voltgrid: {
    wall: ['#28313f', '#2f3b4c', '#1f2836', '#354354', '#232d3a'],
    stone: '#3d4a5c',
    roof: ['#151d28', '#1b2531', '#101720'],
    trim: '#5c6f86',
    accent: '#39d7ff',
    cloth: '#1f4a5c',
    metal: '#2a3441',
    window: '#8fe8ff',
    windowGlow: 1.3,
    dark: '#0d141d',
    neon: '#45e6ff',
    neonGlow: 1.7,
    leaf: '#2f5a4a',
    trunk: '#241f1a',
    asphalt: '#10141d',
    pavement: '#28313d',
    paint: '#cfe8f5',
    wet: true,
    skyTop: '#050914',
    skyLow: '#123049',
    haze: '#1b4560',
    fog: '#0d1b28',
    fogNear: 55,
    fogFar: 190,
    sun: '#7fb8ff',
    sunIntensity: 0.75,
    ambient: '#2a4256',
    ambientIntensity: 0.8,
  },
  // Hollow: overcast, verdigris concrete, arches, greenhouses and ivy.
  hollow: {
    wall: ['#7d8f77', '#6b8266', '#8a9a82', '#5f7460', '#94a08c'],
    stone: '#a8b09c',
    roof: ['#4a5a4c', '#3d4c42', '#566052'],
    trim: '#c3ccba',
    accent: '#4f7a48',
    cloth: '#8a9a6a',
    metal: '#4c5450',
    window: '#d9e8b0',
    windowGlow: 0.7,
    dark: '#2a3330',
    neon: '#7fd0a0',
    neonGlow: 0.25,
    leaf: '#4f7a48',
    trunk: '#3a2f22',
    asphalt: '#2b2c30',
    pavement: '#767d72',
    paint: '#dfe4d8',
    wet: false,
    skyTop: '#7e8489',
    skyLow: '#a9aeb0',
    haze: '#8f989a',
    fog: '#7e8689',
    fogNear: 58,
    fogFar: 200,
    sun: '#cfd6d2',
    sunIntensity: 0.85,
    ambient: '#8a938f',
    ambientIntensity: 0.9,
  },
};

/** The Data Area is its own place: indigo void, teal grid, torn voxel edges. */
export const FOLD = {
  void: '#070c1c',
  voidLow: '#12204a',
  grid: '#2ee6d6',
  gridDim: '#1a6f78',
  edge: '#7ffcff',
  hazard: '#ff3f8c',
  core: '#59ffe0',
  wall: ['#b98a5e', '#8a6a4a', '#6d7f8a'],
  roof: '#2f3a48',
  pavement: '#7f8f8a',
  paint: '#dfeae6',
  metal: '#39434f',
  window: '#ffd48a',
  leaf: '#4f7a48',
};

const matCache = new Map<string, THREE.Material>();

/** Toon material, cached by colour so batches merge. */
export function toon(color: string, emissive = 0): THREE.Material {
  const key = `t:${color}:${emissive}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color: new THREE.Color(color),
      ...(emissive ? { emissive: new THREE.Color(color), emissiveIntensity: emissive } : {}),
    });
    matCache.set(key, m);
  }
  return m;
}

const basicCache = new Map<string, THREE.MeshBasicMaterial>();

/** Flat material for paint, decals and anything that must not shade. */
export function flat(color: string, opacity = 1): THREE.MeshBasicMaterial {
  const key = `b:${color}:${opacity}`;
  let m = basicCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: opacity < 1,
      opacity,
    });
    basicCache.set(key, m);
  }
  return m;
}

/**
 * A vertical sky gradient, painted once into a canvas and mapped to a large backing
 * plane. A flat clear colour is the single biggest reason the old street looked like
 * an unfinished level: the concepts all carry a strong top-to-horizon ramp.
 */
export function skyTexture(top: string, low: string, stars = 0): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const g = c.getContext('2d')!;
  // The horizon band is deliberately compressed into the bottom of the ramp: the
  // plane extends far above the camera, and a linear top-to-bottom blend spends all
  // its interest above the frame and leaves the visible strip a flat sheet.
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.45, mix(top, low, 0.35));
  grad.addColorStop(0.78, mix(top, low, 0.72));
  grad.addColorStop(0.93, low);
  grad.addColorStop(1, low);
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  if (stars > 0) {
    // A night sky with no stars reads as a black rectangle; with them it reads as a city.
    g.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < stars; i++) {
      const y = Math.pow(Math.random(), 1.7) * 150;
      g.globalAlpha = 0.25 + Math.random() * 0.6;
      g.fillRect(Math.random() * 8, y, 1, 1);
    }
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Asphalt that is not a flat colour. The wet variant paints vertical light smears,
 * which is what the Voltgrid concept actually shows: the road mirrors the neon.
 */
export function roadTexture(
  tint: string,
  wet: boolean,
  paint: string,
  seed = 11,
  painted = true,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  g.fillStyle = tint;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4200; i++) {
    g.fillStyle = `rgba(255,255,255,${(0.02 + rand() * 0.07).toFixed(3)})`;
    g.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
  }
  for (let i = 0; i < 8; i++) {
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.beginPath();
    g.ellipse(rand() * 256, rand() * 256, 14 + rand() * 30, 8 + rand() * 16, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  if (wet) {
    const hues = ['#45e6ff', '#ff4fd8', '#ffd48a', '#7ffcff'];
    for (let i = 0; i < 26; i++) {
      const x = rand() * 256;
      const w = 3 + rand() * 10;
      const grad = g.createLinearGradient(0, 0, 0, 256);
      const hue = hues[Math.floor(rand() * hues.length)]!;
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.35, hue + '38');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x, 0, w, 256);
    }
    // Puddles catch the sky and read as standing water.
    for (let i = 0; i < 9; i++) {
      g.fillStyle = 'rgba(120,190,255,.14)';
      g.beginPath();
      g.ellipse(rand() * 256, rand() * 256, 12 + rand() * 26, 5 + rand() * 9, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // A centre-line pair, because both street concepts show one. Only on the road:
  // the same texture tiles the ground behind the buildings, and painted lines there
  // read as a dashed sky above the horizon.
  if (painted) {
    g.fillStyle = paint + '55';
    g.fillRect(0, 122, 256, 3);
    g.fillRect(0, 131, 256, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Pavement with real slab joints. */
export function slabTexture(tint: string, wet: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = tint;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(255,255,255,${(Math.random() * 0.05).toFixed(3)})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,.4)';
  g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.moveTo(0, i);
    g.lineTo(128, i);
    g.stroke();
  }
  if (wet) {
    g.fillStyle = 'rgba(90,150,200,.12)';
    g.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Blend two hex colours, used to build the sky ramp without a third magic number. */
function mix(a: string, b: string, t: number): string {
  const pa = new THREE.Color(a);
  const pb = new THREE.Color(b);
  return `#${pa.lerp(pb, t).getHexString()}`;
}
