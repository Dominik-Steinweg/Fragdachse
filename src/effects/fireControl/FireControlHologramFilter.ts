import * as Phaser from 'phaser';
import { addInternalGlowLegacy, removeInternalFx, type GlowHandle } from '../../utils/phaserFx';

export type HologramPreset = 'A' | 'B' | 'C';
export interface HologramUniforms {
  color: number; time: number; materialize: number; vanish: number; warning: number;
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
uniform float uTime, uMaterialize, uVanish, uWarning, uPreset;
varying vec2 outTexCoord;
#pragma phaserTemplate(fragmentHeader)
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = outTexCoord;
  float tick = floor(uTime * 22.0);
  float glitch = step(mix(.989, .78, uWarning), hash(vec2(tick, 9.0)));
  uv.x += glitch * (hash(vec2(floor(uv.y * 15.0), tick)) - .5) * .028;
  vec4 src = boundedSampler(uMainSampler, uv);
  float lo = src.a, hi = src.a, halo = 0.0;
  // Alpha-neighbourhood Fresnel: follows each animated barrel, never a rectangular outline.
  for (int i = 0; i < 8; i++) {
    float a = float(i) * .785398;
    vec2 d = vec2(cos(a), sin(a)) / resolution;
    float n = boundedSampler(uMainSampler, uv + d * 3.2).a;
    lo = min(lo, n); hi = max(hi, n);
    halo += boundedSampler(uMainSampler, uv + d * 7.0).a / 8.0;
  }
  float rim = hi - lo;
  float lum = dot(src.rgb / max(src.a, .001), vec3(.2126,.7152,.0722));
  float scanPitch = uPreset > .5 && uPreset < 1.5 ? .9 : 1.25;
  float scan = .5 + .5 * sin(uv.y * resolution.y * scanPitch - uTime * 2.0);
  float scanMix = uPreset > .5 && uPreset < 1.5 ? .42 : .12;
  float detail = uPreset > .5 && uPreset < 1.5 ? .22 : .40;
  float body = (.04 + detail * smoothstep(.06, .65, lum)) * mix(1.0, scan, scanMix);
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
  vec3 rgb = uColor * (body * src.a * grid + rim * .52 + halo * (1.0-src.a) * .16);
  rgb += vec3(.91, 1.0, .976) * (rim * .14 + front * hi * .85 + sparks);
  float alpha = clamp(src.a * .66 + rim * .8 + halo * (1.0-src.a) * .15, 0.0, 1.0);
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
    }
  };
}

/** One internal pass per copy, using the same ownership/quality path as PlayerGlow. */
export class FireControlHologramFilter {
  readonly uniforms: HologramUniforms;
  private handle: GlowHandle | null = null;
  constructor(private readonly sprite: Phaser.GameObjects.Sprite, preset: HologramPreset) {
    this.uniforms = { color: 0x3dffd0, time: 0, materialize: 0, vanish: 0, warning: 0, preset };
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
