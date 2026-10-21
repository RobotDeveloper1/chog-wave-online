import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * The post chain: bloom, a whisper of tilt-shift, then a grade.
 *
 * Flat-lit boxes become a city mostly in post. Bloom is what makes a neon sign *glow*
 * instead of being a bright rectangle; the tilt-shift blurs the very top and bottom of
 * the frame so the street reads as a lit miniature with a focal plane, which is a large
 * part of why "2.5D diorama" looks expensive; the grade pulls each district's palette
 * together (warm lift in Ashflat, crushed blue in Voltgrid, a pale veil in Hollow) and
 * the vignette keeps the eye on the middle of the screen where the Chog is.
 */

export interface Look {
  /** Bloom strength, radius and the luminance a pixel needs before it blooms. */
  bloom: { strength: number; radius: number; threshold: number };
  /** Renderer exposure, applied by the output pass's tone mapping. */
  exposure: number;
  /** 0..1 darkening towards the corners. */
  vignette: number;
  saturation: number;
  contrast: number;
  /** Multiplied into the shadows and the highlights separately. */
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  /** Strength of the focal-plane blur; 0 turns it off. */
  tilt: number;
  grain: number;
  /** ACES crushes blacks and pushes colour, which suits neon; neutral keeps a palette honest. */
  tone?: 'aces' | 'neutral' | 'agx';
}

export const DEFAULT_LOOK: Look = {
  bloom: { strength: 0.3, radius: 0.45, threshold: 0.86 },
  exposure: 1.0,
  vignette: 0.28,
  saturation: 1.1,
  contrast: 1.08,
  shadowTint: [1, 1, 1],
  highlightTint: [1, 1, 1],
  tilt: 0.1,
  grain: 0,
};

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.3 },
    uSat: { value: 1.0 },
    uContrast: { value: 1.0 },
    uShadow: { value: new THREE.Vector3(1, 1, 1) },
    uHigh: { value: new THREE.Vector3(1, 1, 1) },
    uGrain: { value: 0.02 },
    uTime: { value: 0 },
    uTilt: { value: 0.5 },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSat, uContrast, uGrain, uTime, uTilt;
    uniform vec3 uShadow, uHigh;
    uniform vec2 uTexel;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    // A single-pass tilt-shift: a 9-tap gaussian whose radius grows with the distance of
    // the pixel from the horizontal focal band through the middle of the frame.
    vec3 tiltShift(vec2 uv) {
      // Sharp across the whole middle of the frame — where the Chog, the people and the
      // prompts are — and only the very edge softens. Where the blur is not wanted the
      // image is read once: the earlier version ran the gaussian at one texel everywhere,
      // which is a global blur, and a global blur is what a player calls "foggy".
      float d = abs(uv.y - 0.52);
      float amount = smoothstep(0.36, 0.6, d) * uTilt;
      if (amount < 0.02) return texture2D(tDiffuse, uv).rgb;
      vec2 r = uTexel * (1.0 + amount * 5.0);
      vec3 c = texture2D(tDiffuse, uv).rgb * 0.2270270270;
      c += texture2D(tDiffuse, uv + vec2(r.x * 1.3846153846, 0.0)).rgb * 0.1581081081;
      c += texture2D(tDiffuse, uv - vec2(r.x * 1.3846153846, 0.0)).rgb * 0.1581081081;
      c += texture2D(tDiffuse, uv + vec2(0.0, r.y * 1.3846153846)).rgb * 0.1581081081;
      c += texture2D(tDiffuse, uv - vec2(0.0, r.y * 1.3846153846)).rgb * 0.1581081081;
      c += texture2D(tDiffuse, uv + vec2(r.x * 3.2307692308, 0.0)).rgb * 0.0351351351;
      c += texture2D(tDiffuse, uv - vec2(r.x * 3.2307692308, 0.0)).rgb * 0.0351351351;
      c += texture2D(tDiffuse, uv + vec2(0.0, r.y * 3.2307692308)).rgb * 0.0351351351;
      c += texture2D(tDiffuse, uv - vec2(0.0, r.y * 3.2307692308)).rgb * 0.0351351351;
      return c;
    }

    void main() {
      vec3 c = tiltShift(vUv);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Split-toning: the grade pulls shadows and highlights towards different colours.
      c *= mix(uShadow, uHigh, smoothstep(0.1, 0.8, l));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      vec2 q = vUv - 0.5;
      float v = 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      c *= v;
      // Static, never animated: noise that changes every frame reads as flicker on every
      // flat dark surface in the city (measured: ~21% of pixels moving on a still frame),
      // and the grade runs in linear light, so it is amplified most in exactly the roofs
      // and shadows where it is least wanted. With the default of 0 it costs nothing.
      c += (hash(vUv * 900.0) - 0.5) * uGrain;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export class Pipeline {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly output: OutputPass;
  private look: Look = DEFAULT_LOOK;
  private time = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    // The grade runs before the output pass, in linear light, so tone mapping sees the
    // graded image and the sRGB encode happens exactly once, at the very end.
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.setLook(DEFAULT_LOOK);
  }

  setLook(look: Look): void {
    this.look = look;
    this.bloom.strength = look.bloom.strength;
    this.bloom.radius = look.bloom.radius;
    this.bloom.threshold = look.bloom.threshold;
    this.renderer.toneMapping =
      look.tone === 'neutral' ? THREE.NeutralToneMapping : look.tone === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = look.exposure;
    const u = this.grade.uniforms as Record<string, { value: unknown }>;
    u.uVignette!.value = look.vignette;
    u.uSat!.value = look.saturation;
    u.uContrast!.value = look.contrast;
    (u.uShadow!.value as THREE.Vector3).set(...look.shadowTint);
    (u.uHigh!.value as THREE.Vector3).set(...look.highlightTint);
    u.uGrain!.value = look.grain;
    u.uTilt!.value = look.tilt;
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    const px = new THREE.Vector2(1 / (w * pixelRatio), 1 / (h * pixelRatio));
    (this.grade.uniforms as Record<string, { value: THREE.Vector2 }>).uTexel!.value = px;
  }

  render(dt: number): void {
    this.time += dt;
    (this.grade.uniforms as Record<string, { value: number }>).uTime!.value = this.time % 100;
    this.composer.render(dt);
  }

  /** Free the composer's targets. The gate's backdrop stage is thrown away on login. */
  dispose(): void {
    this.composer.dispose();
  }

  get tone(): Look {
    return this.look;
  }
}
