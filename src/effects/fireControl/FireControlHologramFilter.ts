import * as Phaser from 'phaser';
import { addInternalGlowLegacy, removeInternalFx, type GlowHandle } from '../../utils/phaserFx';

export type HologramPreset = 'A' | 'B' | 'C';
export interface HologramUniforms {
  color: number; time: number; materialize: number; vanish: number; warning: number;
  /** 0 = relay look (accepted at G1); 1 = Holo-Offensive: darker panels, stronger lines for type readability. */
  clarity: number;
  preset: HologramPreset;
}
const NODE = 'FireControlHologram';
const managers = new WeakSet<object>();
const parameters = new WeakMap<object, HologramUniforms>();
const FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform sampler2D uMainSampler;
uniform vec2 resolution;
uniform vec3 uColor;
uniform float uTime, uMaterialize, uVanish, uWarning, uPreset, uClarity;
varying vec2 outTexCoord;
#pragma phaserTemplate(fragmentHeader)
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
const vec3 LUMA = vec3(.2126, .7152, .0722);
const vec3 CORE = vec3(.91, 1.0, .976);
void main() {
  vec2 uv = outTexCoord;
  float tick = floor(uTime * 22.0);
  float glitch = step(mix(.992, .80, uWarning), hash(vec2(tick, 9.0)));
  uv.x += glitch * (hash(vec2(floor(uv.y * 15.0), tick)) - .5) * .03;
  vec2 px = 1.0 / resolution;
  vec4 src = boundedSampler(uMainSampler, uv);
  float lo = src.a, hi = src.a, halo = 0.0;
  // Alpha-neighbourhood Fresnel: follows each animated barrel, never a rectangular outline.
  for (int i = 0; i < 8; i++) {
    float a = float(i) * .785398;
    vec2 d = vec2(cos(a), sin(a)) * px;
    float n = boundedSampler(uMainSampler, uv + d * 2.4).a;
    lo = min(lo, n); hi = max(hi, n);
    halo += boundedSampler(uMainSampler, uv + d * 6.0).a / 8.0;
  }
  float rim = clamp((hi - lo) * 1.35, 0.0, 1.0);
  float lum = dot(src.rgb / max(src.a, .001), LUMA);
  // Panel lines: luminance gradient of the real sprite, so pods, barrels and hatches stay legible.
  float gx = dot(boundedSampler(uMainSampler, uv + vec2(px.x, 0.0)).rgb - boundedSampler(uMainSampler, uv - vec2(px.x, 0.0)).rgb, LUMA);
  float gy = dot(boundedSampler(uMainSampler, uv + vec2(0.0, px.y)).rgb - boundedSampler(uMainSampler, uv - vec2(0.0, px.y)).rgb, LUMA);
  float lines = clamp((abs(gx) + abs(gy)) * 2.4, 0.0, 1.0) * src.a;
  bool scanPreset = uPreset > .5 && uPreset < 1.5;
  float scanY = uv.y * resolution.y;
  float scan = mix(1.0, .45 + .55 * smoothstep(.3, .7, fract(scanY / (scanPreset ? 2.5 : 3.0) - uTime * .9)), scanPreset ? .75 : .45);
  // A soft bright band sweeps over the projection every ~2.4 s.
  float band = exp(-pow(fract(uTime * .42) * 1.5 - .25 - (1.0 - uv.y), 2.0) / .006);
  float detail = (scanPreset ? .30 : .52) + .2 * uClarity;
  // Contrast curve: dark panels stay dark so pods, hatches and barrels read as detail, not as glow.
  // Clarity steepens the luminance ramp: dark bases recede, bright weapon bodies and barrels lead.
  float lumRamp = mix(smoothstep(.04, .80, lum), smoothstep(.2, .7, lum), uClarity);
  float bodyLight = (mix(.07, .025, uClarity) + detail * pow(lumRamp, mix(1.35, 1.7, uClarity))) * scan;
  float body = bodyLight;
  float grid = 1.0;
  if (uPreset > 1.5) {
    vec2 cell = fract(uv * resolution / 5.0);
    grid = .6 + .4 * step(.16, min(cell.x, cell.y));
    rim *= .65 + .35 * step(.3, hash(floor(uv * resolution / 4.0) + floor(uTime * 4.0)));
  }
  float amount = clamp(uMaterialize * (1.0 - uVanish), 0.0, 1.0);
  float noise = hash(floor(uv * resolution / 3.0));
  float edge = amount * 1.3 - .15;
  float field = 1.0 - uv.y + (noise - .5) * .12;
  float reveal = smoothstep(field - .025, field + .025, edge);
  float front = (1.0 - smoothstep(.008, .05, abs(field - edge))) * step(.001, amount) * (1.0 - step(.999, amount));
  float sparks = step(.975, noise) * (1.0 - smoothstep(.015, .14, abs(field - edge))) * hi;
  if (uPreset > 1.5) {
    vec2 cell = floor(uv * resolution / 4.0);
    float drift = fract(uTime * .8 + hash(cell));
    vec2 pull = vec2(sin(hash(cell)*6.283), -1.0) * drift * 8.0 / resolution;
    float neighbour = boundedSampler(uMainSampler, uv-pull).a;
    sparks += (1.0-src.a) * neighbour * step(.88,hash(cell)) * (1.0-drift) * .7;
  }
  // Premultiplied glass: the body only partly covers the ground (alpha < light), so the
  // projection reads as emitted light; panel lines and the Fresnel rim carry the silhouette.
  vec3 rgb = uColor * (body * src.a * grid + band * src.a * .16 + halo * (1.0 - src.a) * .14);
  rgb += uColor * lines * mix(.55, .85, uClarity) + mix(uColor, CORE, .25) * rim * .80;
  rgb += CORE * (front * hi * .85 + sparks);
  // Clarity lets dark panels fall back towards the ground, so barrels and pods read as shape, not a disc.
  float coverage = mix(.46, .12 + .5 * lumRamp, uClarity);
  float alpha = clamp(src.a * coverage + lines * mix(.25, .42, uClarity) + rim * .75 + halo * (1.0 - src.a) * .12, 0.0, 1.0);
  float flicker = 1.0 - glitch * (.2 + .25 * uWarning);
  gl_FragColor = vec4(rgb, alpha) * reveal * flicker;
}`;

function nodeConstructor() {
  return class FireControlHologramNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
    constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) { super(NODE, manager, undefined, FRAGMENT); }
    override setupUniforms(controller: Phaser.Filters.Glow, context: Phaser.Renderer.WebGL.DrawingContext): void {
      const p = parameters.get(controller)!;
      const u = this.programManager;
      u.setUniform('resolution', [context.width, context.height]);
      u.setUniform('uColor', [(p.color >> 16 & 255) / 255, (p.color >> 8 & 255) / 255, (p.color & 255) / 255]);
      u.setUniform('uTime', p.time); u.setUniform('uMaterialize', p.materialize);
      u.setUniform('uVanish', p.vanish); u.setUniform('uWarning', p.warning);
      u.setUniform('uPreset', p.preset === 'A' ? 0 : p.preset === 'B' ? 1 : 2);
      u.setUniform('uClarity', p.clarity);
    }
  };
}

/** One internal pass per copy, using the same ownership/quality path as PlayerGlow. */
export class FireControlHologramFilter {
  readonly uniforms: HologramUniforms;
  private handle: GlowHandle | null = null;
  constructor(private readonly sprite: Phaser.GameObjects.Sprite, preset: HologramPreset) {
    this.uniforms = { color: 0x3dffd0, time: 0, materialize: 0, vanish: 0, warning: 0, preset, clarity: 0 };
    const renderer = sprite.scene.sys?.renderer;
    if (!renderer || !('gl' in renderer)) return;
    const manager = renderer.renderNodes;
    if (!managers.has(manager)) { manager.addNodeConstructor(NODE, nodeConstructor()); managers.add(manager); }
    this.handle = addInternalGlowLegacy(sprite, 0x3dffd0, 1, 0, false, .1, 8, 'critical');
    if (this.handle) {
      parameters.set(this.handle, this.uniforms);
      this.handle.renderNode = NODE;
      this.handle.setPaddingOverride?.(-10, -10, 10, 10);
    }
  }
  destroy(): void {
    if (this.handle && !this.sprite.isDestroyed) removeInternalFx(this.sprite, this.handle);
    this.handle = null;
  }
}
