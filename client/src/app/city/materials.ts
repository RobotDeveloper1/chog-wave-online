import * as THREE from 'three';
import type { DistrictArt } from '../art.ts';
import type { MatKey } from './batch.ts';
import type { Textures } from './textures.ts';

/**
 * The city's materials: Lambert with a few shader grafts.
 *
 * Three small things are done in the shader because they cannot be done any other way
 * on merged static geometry:
 *
 *   hole      a dithered see-through disc around the player on anything that stands between
 *             the camera and them. An isometric city is made of things that hide the
 *             player; this is the standard answer, and it keeps every building solid
 *             everywhere else.
 *   flicker   each lit window blinks on its own slow clock, driven by a per-quad seed, so
 *             the street breathes instead of being a still image of lights.
 *   glow      per-vertex emissive, so a neon edge or a lamp head is just a vertex colour
 *             with a number — no separate material, no extra draw call.
 *
 * Uniforms are shared by reference, so moving the hole or ticking the clock is one write
 * for every material in the city.
 */

export const WU = {
  uTime: { value: 0 },
  uPlayer: { value: new THREE.Vector3(0, 1.1, 0) },
  uHoleR: { value: 2.9 },
  uGlow: { value: 1 },
  uWind: { value: 1 },
};

export interface PatchOpts {
  hole?: boolean;
  flicker?: boolean;
  sway?: boolean;
  water?: boolean;
  glow?: boolean;
}

const HASH = /* glsl */ `
  float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
  const float BAYER[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
  float bayer4(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    return (BAYER[y * 4 + x] + 0.5) / 16.0;
  }
`;

/**
 * Graft the city's shader language onto any Lambert-family material: the see-through hole
 * around the player, wind sway, water shimmer, window flicker and per-vertex glow. Keys name
 * programs, so a key must be unique per material recipe — city and Line keys must never match.
 */
export function patch(m: THREE.Material, key: string, o: PatchOpts): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WU.uTime;
    shader.uniforms.uPlayer = WU.uPlayer;
    shader.uniforms.uHoleR = WU.uHoleR;
    shader.uniforms.uGlow = WU.uGlow;
    shader.uniforms.uWind = WU.uWind;

    shader.vertexShader = shader.vertexShader
      .replace(
        'varying vec3 vViewPosition;',
        `varying vec3 vViewPosition;
         varying vec3 vWP;
         varying float vGlow;
         varying float vSeed;
         attribute float glow;
         attribute float seed;
         uniform float uTime;
         uniform float uWind;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         ${
           o.sway
             ? `{
                  vec3 w0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
                  float sw = sin(uTime * 1.4 + w0.x * 0.6 + w0.z * 0.4) * 0.07 + sin(uTime * 2.3 + w0.z * 0.9) * 0.03;
                  float k = smoothstep(0.8, 4.2, transformed.y) * uWind;
                  transformed.x += sw * k;
                  transformed.z += sw * 0.6 * k;
                }`
             : ''
         }
         vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vGlow = glow;
         vSeed = seed;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'uniform vec3 diffuse;',
        `uniform vec3 diffuse;
         varying vec3 vWP;
         varying float vGlow;
         varying float vSeed;
         uniform float uTime;
         uniform vec3 uPlayer;
         uniform float uHoleR;
         uniform float uGlow;
         ${HASH}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         ${
           o.hole
             ? `{
                  vec3 pv = (viewMatrix * vec4(uPlayer, 1.0)).xyz;
                  vec3 fv = -vViewPosition;
                  // Only things standing up, and only things nearer the lens than the player.
                  if (vWP.y > 0.55 && fv.z > pv.z + 0.9) {
                    vec2 d = fv.xy / -fv.z - pv.xy / -pv.z;
                    float r = length(d) * -pv.z;
                    float k = smoothstep(uHoleR, uHoleR * 0.6, r);
                    if (k > bayer4(gl_FragCoord.xy)) discard;
                  }
                }`
             : ''
         }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         ${
           o.water
             ? `{
                  float wv = sin(vWP.x * 1.3 + uTime * 0.9) + sin(vWP.z * 1.7 - uTime * 0.7) + sin((vWP.x - vWP.z) * 0.8 + uTime * 0.5);
                  float crest = smoothstep(1.5, 2.7, wv);
                  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.5 + vec3(0.05, 0.09, 0.13), crest * 0.75);
                  diffuseColor.rgb *= 0.88 + 0.12 * sin(vWP.x * 0.35) * sin(vWP.z * 0.3);
                }`
             : ''
         }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         ${
           o.flicker
             ? `#ifdef USE_EMISSIVEMAP
                  {
                    float ph = vSeed * 61.0;
                    float cyc = floor(uTime * 0.22 + ph);
                    float on = step(0.05, hash11(ph + cyc * 1.37));
                    float breathe = 0.97 + 0.03 * sin(uTime * 1.3 + ph * 6.2831);
                    totalEmissiveRadiance *= on * breathe * uGlow;
                  }
                #endif`
             : ''
         }
         ${o.glow ? 'totalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlow;' : ''}
         ${o.water ? 'totalEmissiveRadiance += vec3(0.5, 0.75, 1.0) * pow(smoothstep(1.7, 2.8, sin(vWP.x * 1.3 + uTime * 0.9) + sin(vWP.z * 1.7 - uTime * 0.7) + sin((vWP.x - vWP.z) * 0.8 + uTime * 0.5)), 3.0) * 0.45 * uGlow;' : ''}`,
      );
  };
  m.customProgramCacheKey = () => `wm:${key}`;
}

/** A lit sign: albedo and emissive from two canvases, with the same see-through hole as walls. */
export function makeSignMaterial(map: THREE.Texture, emi: THREE.Texture): THREE.Material {
  const m = new THREE.MeshLambertMaterial({ map, emissiveMap: emi, emissive: 0xffffff });
  patch(m, 'signs', { hole: true });
  return m;
}

export interface Built {
  materials: Record<MatKey, THREE.Material>;
  flags: Partial<Record<MatKey, { cast?: boolean; receive?: boolean }>>;
  dispose(): void;
}

export function makeMaterials(a: DistrictArt, tex: Textures): Built {
  const mats: Record<MatKey, THREE.Material> = {};
  const flags: Built['flags'] = {};

  const lam = (key: string, p: THREE.MeshLambertMaterialParameters, o: PatchOpts, f?: { cast?: boolean; receive?: boolean }): THREE.MeshLambertMaterial => {
    const m = new THREE.MeshLambertMaterial(p);
    patch(m, key, o);
    mats[key] = m;
    if (f) flags[key] = f;
    return m;
  };

  // Solid-coloured pieces: one material for every paint pot in the city.
  lam('solid', { vertexColors: true }, { hole: true, glow: true });

  tex.wall.forEach((t, i) =>
    lam(`wall${i}`, { map: t.map, emissiveMap: t.emi, emissive: 0xffffff }, { hole: true, flicker: true }),
  );
  tex.gnd.forEach((t, i) =>
    lam(`gnd${i}`, { map: t.map, emissiveMap: t.emi, emissive: 0xffffff }, { hole: true, flicker: true }),
  );
  lam('roofSlate', { map: tex.roof.slate }, { hole: true });
  lam('roofTar', { map: tex.roof.tar }, { hole: true });
  lam('roofMetal', { map: tex.roof.metal }, { hole: true });
  lam('roofGreen', { map: tex.roof.green }, { hole: true });

  for (const k of ['asphalt', 'walk', 'plaza', 'grass', 'dirt', 'gravel', 'cobble', 'floor'] as const) {
    lam(k, { map: tex.ground[k] }, {}, { cast: false, receive: true });
  }
  lam('water', { color: new THREE.Color(a.wet ? '#14344a' : a.skyTop === '#7e8489' ? '#5b7f78' : '#5a86a6'), vertexColors: true }, { water: true }, { cast: false, receive: true });
  // Flat-shaded: a smooth-shaded icosahedron lobe turns its unlit side into one pale lavender
  // balloon under the dusk ambient, which is exactly the placeholder look. Facets catch the
  // key light individually and read as leaves instead.
  lam('foliage', { vertexColors: true, flatShading: true }, { sway: true, hole: true });
  lam('paint', { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { glow: true }, { cast: false, receive: true });

  const glass = lam('glass', { vertexColors: true, transparent: true, opacity: 0.5 }, { glow: true, hole: true }, { cast: false, receive: true });
  glass.depthWrite = false;

  // Decals sit just above the ground and never write depth, so they blend rather than fight.
  const ao = new THREE.MeshBasicMaterial({ map: tex.ao, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, vertexColors: true });
  mats.ao = ao;
  flags.ao = { cast: false, receive: false };

  const pool = new THREE.MeshBasicMaterial({
    map: tex.pool,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    fog: true,
  });
  // A lamp's pool of light is a night thing. By day the same additive blob reads as a grey
  // smudge on the road — the "fog patches" — so it is held back unless the district is wet.
  pool.opacity = a.wet ? 1 : 0.4;
  mats.pool = pool;
  flags.pool = { cast: false, receive: false };

  return {
    materials: mats,
    flags,
    dispose() {
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}
