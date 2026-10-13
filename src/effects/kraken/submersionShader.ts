import * as Phaser from 'phaser';
import materialLook from '../../config/krakenMaterialLighting.json';
import { characterLocalVector } from '../CharacterMaterialModel';
import { setCloudUniforms, type SunCloudState } from '../sunlight/cloudShadow';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { KRAKEN_MATERIAL_HEADER } from './krakenMaterialShader';

/** Presentation response after the hash-bound albedo calibration; shared by game and viewer. */
export function krakenMaterialExposure(id: string, exposure: number): number {
  return exposure * (id === 'abyssal-kraken-tentacle' ? materialLook.tentacleExposureScale : 1);
}

export interface KrakenMaterialGrade { readonly exposure: number; readonly tint: readonly number[]; readonly saturation: number }
const AUTHORED_GRADES: Readonly<Record<string, KrakenMaterialGrade>> = materialLook.grades;
/** Separately rendered parts (spines, eggs) are graded to belong to the body's palette instead of matching
 * their own isolated beauty render; everything else keeps its hash-bound calibration. */
export function krakenMaterialGrade(id: string, pass: { exposure: number; tint?: readonly number[]; saturation?: number }): KrakenMaterialGrade {
  return AUTHORED_GRADES[id] ?? { exposure: krakenMaterialExposure(id, pass.exposure), tint: pass.tint ?? [1, 1, 1], saturation: pass.saturation ?? 1 };
}
export const KRAKEN_BROOD = materialLook.brood;
/** Lift of a thrown egg (0..1 arc height): mostly read from its shadow, so the egg itself barely grows. */
export function krakenEggArc(height: number, sun: readonly number[] | null): { scale: number; shadowX: number; shadowY: number } {
  const b = KRAKEN_BROOD, lift = height * b.arcHeightPx, s = sun ?? [-.45, -.45, .77];
  const planar = Math.hypot(s[0]!, s[1]!), reach = Math.min(b.arcShadowMaxSlope, planar / Math.max(.05, s[2]!)) * lift;
  return { scale: 1 + height * b.arcScale, shadowX: planar > 1e-4 ? -s[0]! / planar * reach : 0, shadowY: planar > 1e-4 ? -s[1]! / planar * reach : 0 };
}
/** Ember strength of an egg for a heartbeat in [-1, 1]: dim while carried/flying, brighter and throbbing
 * harder as it incubates (the caller owns the beat so glow and swelling stay in phase). */
export function krakenBroodGlow(beat: number, incubation = 0): number {
  const b = KRAKEN_BROOD, k = Math.max(0, Math.min(1, incubation));
  return b.glow + (b.incubatedGlow - b.glow) * k + (b.glowPulse + (b.incubatedPulse - b.glowPulse) * k) * beat;
}
/** The carried/flying heartbeat. */
export const krakenBroodBeat = (seconds: number): number => Math.sin(seconds * KRAKEN_BROOD.pulseHz * Math.PI * 2);
/** Brood eggs baked into a body frame, regraded in-shader to the egg's own grade. */
export interface KrakenBroodMaterial {
  /** Linear tint (egg grade relative to the body exposure) and saturation. */
  readonly tint: readonly [number, number, number, number];
  /** Up to six discs: logical x, y, logical radius, socket z (Blender units). */
  readonly discs: readonly (readonly [number, number, number, number])[];
  /** Magnification of the carried eggs so they match the thrown/landed egg sprite. */
  readonly scale: number;
}

/** Heights are Blender units; colours are linear shader RGB in [0, 1]. */
export const SUBMERSION_DEFAULTS = {
  waterLevel: 0, time: 0,
  deepColor: [0.025, 0.16, 0.17] as readonly number[],
  shallowColor: [0.12, 0.40, 0.38] as readonly number[],
  foamColor: [0.70, 0.90, 0.92] as readonly number[],
  wetBand: 0.06, wetDarkening: 0.12, wetSaturation: 0.12,
  foamBand: 0.022, foamOpacity: 0.42,
  depthFalloff: 0.35, desaturation: 0.45, shallowTint: 0.22,
  fadeStart: 0.15, fadeEnd: 1.2, refractionPx: 2,
  // On land nothing can lie below the ground: parts deeper than this under the waterline (a tentacle's
  // coil before it erupts, the bank side of the body during ashore) fade out instead of being drawn on grass.
  buriedStart: 0.5, buriedEnd: 1.0,
  exposure: 1,
};

/** World lighting lifts sprites roughly 3x in linear light; the boss keeps its dark plum menace. */
export const KRAKEN_WORLD_EXPOSURE = 0.55;
/** On land the body sits in ordinary (often shaded) world light; dimming it like the sunlit pond made it unreadable. */
export const KRAKEN_LAND_EXPOSURE = 1;

export const SUBMERSION_FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform sampler2D uMainSampler, uElevation, uWaterMask;
uniform vec4 elevationUV, elevationTrim;
uniform vec2 elevationSize, displaySize;
uniform float waterLevel, elevationMin, elevationMax, time;
uniform vec3 deepColor, shallowColor, foamColor;
uniform float wetBand, wetDarkening, wetSaturation, foamBand, foamOpacity;
uniform float depthFalloff, desaturation, shallowTint, fadeStart, fadeEnd, refractionPx, exposure;
uniform float buriedStart, buriedEnd;
varying vec2 outTexCoord;
#pragma phaserTemplate(fragmentHeader)
${KRAKEN_MATERIAL_HEADER}
float krakenElevationAt(vec2 logical){
vec2 local=(logical*elevationSize-elevationTrim.xy)/elevationTrim.zw;
if(any(lessThan(local,vec2(0)))||any(greaterThan(local,vec2(1))))return -1e3;
vec4 h=texture2D(uElevation,mix(elevationUV.xy,elevationUV.zw,local));
return h.a>.001?mix(elevationMin,elevationMax,clamp(h.r/h.a,0.0,1.0)):-1e3;}
// Carried eggs are baked smaller than the egg sprite: inside a socket disc, read the frame through a lens
// centred on the egg, but only where that lens lands on the shell (at/above the socket height).
vec2 krakenMagnify(vec4 disc,vec2 logical,vec2 best){
if(disc.z<=0.0)return best;
vec2 d=logical-disc.xy;
if(length(d)>=disc.z)return best;
vec2 c=disc.xy+d/broodScale;
return krakenElevationAt(c)>=disc.w-.02?c:best;}
vec2 krakenBroodLens(vec2 uv){
if(broodTint.a<=0.0||broodScale<=1.0)return uv;
vec2 logical=vec2(uv.x,1.0-uv.y),m=logical;
m=krakenMagnify(broodDisc0,logical,m);m=krakenMagnify(broodDisc1,logical,m);m=krakenMagnify(broodDisc2,logical,m);
m=krakenMagnify(broodDisc3,logical,m);m=krakenMagnify(broodDisc4,logical,m);m=krakenMagnify(broodDisc5,logical,m);
return vec2(m.x,1.0-m.y);}
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
void main() {
  vec2 uv=krakenBroodLens(outTexCoord);
  vec4 source=boundedSampler(uMainSampler,uv);
  vec2 logical=vec2(uv.x,1.0-uv.y);
  vec2 local=(logical*elevationSize-elevationTrim.xy)/elevationTrim.zw;
  vec4 height=texture2D(uElevation,mix(elevationUV.xy,elevationUV.zw,clamp(local,0.0,1.0)));
  source=krakenLight(source,logical,height);
  source.rgb*=exposure;
  float mask=texture2D(uWaterMask,logical).r;
  if(source.a<=0.0 || any(lessThan(local,vec2(0))) || any(greaterThan(local,vec2(1)))) {
    gl_FragColor=source; return;
  }
  if(height.a<=0.001) { gl_FragColor=source; return; }
  // Phaser uploads PNGs with premultiplied alpha. Undo it for this data pass.
  float elevation=mix(elevationMin,elevationMax,clamp(height.r/height.a,0.0,1.0));
  float d=waterLevel-elevation;
  vec4 ground=source*(1.0-smoothstep(buriedStart,buriedEnd,d));
  if(mask<=0.0) { gl_FragColor=ground; return; }
  vec3 rgb=source.rgb/source.a;
  float alpha=source.a;
  if(d>0.0) {
    float f=1.0-exp(-d/max(depthFalloff,0.0001));
    vec2 shift=vec2(sin(logical.y*37.0+time*1.3),cos(logical.x*31.0+time*1.1));
    shift*=min(refractionPx,2.0)*0.70710678*f/max(displaySize,vec2(1));
    vec4 refracted=boundedSampler(uMainSampler,uv+shift);
    vec2 refractedLogical=vec2(uv.x+shift.x,1.0-uv.y-shift.y);
    vec2 refractedLocal=(refractedLogical*elevationSize-elevationTrim.xy)/elevationTrim.zw;
    vec4 refractedData=texture2D(uElevation,mix(elevationUV.xy,elevationUV.zw,clamp(refractedLocal,0.0,1.0)));
    refracted=krakenLight(refracted,refractedLogical,refractedData);
    refracted.rgb*=exposure;
    rgb=refracted.a>0.001 ? refracted.rgb/refracted.a : rgb;
    rgb=mix(rgb,vec3(dot(rgb,vec3(.2126,.7152,.0722))),desaturation*f);
    rgb=mix(rgb,shallowColor,shallowTint*f);
    rgb=mix(rgb,deepColor,f);
    alpha*=1.0-smoothstep(fadeStart,fadeEnd,d);
  } else {
    float wet=1.0-smoothstep(0.0,wetBand,-d);
    float luminance=dot(rgb,vec3(.2126,.7152,.0722));
    rgb=mix(vec3(luminance),rgb,1.0+wetSaturation*wet)*(1.0-wetDarkening*wet);
  }
  float foam=(1.0-smoothstep(0.0,foamBand,abs(d)))*foamOpacity;
  foam*=smoothstep(.25,.65,noise(logical*displaySize*.16+vec2(time*.5,-time*.3)));
  rgb=mix(rgb,foamColor,foam);
  // No halo beyond beauty coverage; premultiplied output remains valid as it fades.
  gl_FragColor=mix(ground,vec4(clamp(rgb,0.0,1.0)*alpha,alpha),clamp(mask,0.0,1.0));
}
`;

const NODE = 'KrakenSubmersion';
const managers = new WeakSet<object>();
type Sprite = Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;

/** Internal object filter, no padding. Borrowed frames/mask must outlive the filter.
 * The mask is a whole texture in logical sprite space: red=water, black=land.
 * __WHITE supplies constant 1. Owners update the matching elevation frame each pose.
 */
export class SubmersionFilter extends Phaser.Filters.Controller {
  /** Pilot/new-revision opt-in only; scalar elevation never implies a material. */
  material: { clouds: SunCloudState; emission: Phaser.Textures.Frame; emissionRange: number; tint?: readonly number[]; saturation?: number; highlightRollOff?: boolean; highlightRole?: 'body' | 'tentacle';
    /** Linear ember colour and strength; `whole` lights the entire sprite (an egg) instead of only brood discs. */
    glow?: { readonly color: readonly number[]; readonly strength: number; readonly falloff: number; readonly whole: boolean };
    brood?: KrakenBroodMaterial | null } | null = null;
  params = { ...SUBMERSION_DEFAULTS };
  elevationMin: number;
  elevationMax: number;
  constructor(public target: Sprite, public elevationFrame: Phaser.Textures.Frame,
    encoding: { min: number; max: number }, public waterMask: Phaser.Textures.Frame) {
    super(target.filterCamera, NODE);
    this.elevationMin = encoding.min;
    this.elevationMax = encoding.max;
    this.setPaddingOverride(0, 0, 0, 0);
  }
}

class SubmersionNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(NODE, manager, undefined, SUBMERSION_FRAGMENT);
  }
  override setupTextures(c: SubmersionFilter, textures: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper[]): void {
    textures[1] = c.elevationFrame.glTexture;
    textures[2] = c.waterMask.glTexture;
    textures[3] = (c.material?.emission ?? c.elevationFrame).glTexture;
  }
  override setupUniforms(c: SubmersionFilter): void {
    const f = c.elevationFrame;
    const m = c.material, e = m?.emission ?? f, sun = [0, 0, 1], s = c.target;
    const light = m?.clouds.sunPath?.sun ?? [0, 0, 1];
    characterLocalVector(light[0], light[1], light[2], s.rotation, s.flipX, s.flipY, sun);
    const uniforms = {
      uEmission: 3, materialEnabled: Number(!!m), materialLow: Number(getGraphicsQualityProfile(c.target.scene).level === 'low'),
      materialTint: m?.tint ?? [1, 1, 1], materialSaturation: m?.saturation ?? 1,
      materialHighlightTone: m?.highlightRollOff === false ? [1, 1] : [m?.highlightRole === 'tentacle' ? materialLook.tentacleAlbedoHighlightKnee : materialLook.albedoHighlightKnee, materialLook.albedoHighlightSlope],
      materialSun: sun, materialStrength: m?.clouds.sunPath?.strength ?? 0,
      materialNormalScale: [1 / Math.max(.001, Math.abs(s.scaleX)), 1 / Math.max(.001, Math.abs(s.scaleY)),
        1 / Math.max(.001, Math.sqrt(Math.abs(s.scaleX * s.scaleY)))],
      materialWorld: [s.x, s.y, Math.cos(s.rotation), Math.sin(s.rotation)], materialOrigin: [s.originX, s.originY],
      emissionRange: m?.emissionRange ?? 1, emissionUV: [e.u0, e.v0, e.u1, e.v1],
      emissionSize: [e.realWidth, e.realHeight], emissionTrim: [e.x, e.y, e.width, e.height],
      materialGlow: m?.glow ? [...m.glow.color, m.glow.strength] : [0, 0, 0, 0],
      materialGlowShape: [m?.glow?.falloff ?? 1, m?.glow?.whole ? 1 : 0],
      broodTint: m?.brood?.tint ?? [1, 1, 1, 0], broodScale: m?.brood?.scale ?? 1,
      ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`broodDisc${i}`, m?.brood?.discs[i] ?? [0, 0, 0, 0]])),
      ...c.params, uElevation: 1, uWaterMask: 2,
      elevationMin: c.elevationMin, elevationMax: c.elevationMax,
      elevationUV: [f.u0, f.v0, f.u1, f.v1],
      elevationSize: [f.realWidth, f.realHeight],
      elevationTrim: [f.x, f.y, f.width, f.height],
      displaySize: [Math.abs(c.target.displayWidth), Math.abs(c.target.displayHeight)],
    };
    for (const [key, value] of Object.entries(uniforms)) this.programManager.setUniform(key, value);
    setCloudUniforms((key, value) => this.programManager.setUniform(key, value), m?.clouds);
  }
}

/** Sprite owns the controller through its internal FilterList (including teardown). */
export function addSubmersionFilter(target: Sprite, elevationFrame: Phaser.Textures.Frame,
  encoding: { min: number; max: number }, maskKey = '__WHITE'): SubmersionFilter {
  const renderer = target.scene.sys.renderer;
  if (!('gl' in renderer)) throw new Error('Submersion requires WebGL');
  const manager = renderer.renderNodes;
  if (!managers.has(manager)) { manager.addNodeConstructor(NODE, SubmersionNode); managers.add(manager); }
  target.enableFilters();
  const filter = new SubmersionFilter(target, elevationFrame, encoding, target.scene.textures.getFrame(maskKey));
  target.filters!.internal.add(filter);
  return filter;
}

export interface KrakenMaskTransform {
  readonly x: number; readonly y: number; readonly rotation: number;
  readonly originX: number; readonly originY: number;
  readonly displayWidth: number; readonly displayHeight: number;
}

export interface KrakenWaterSampler {
  (x: number, y: number): number;
  /** Optional exact proof for the entire transformed rectangle, never a corner approximation. */
  uniformMask?(transform: KrakenMaskTransform): 0 | 1 | null;
}
export const KRAKEN_DRY_SAMPLER: KrakenWaterSampler = Object.assign(() => 0, { uniformMask: () => 0 as const });

/** Full logical canvas -> world, independent of color/elevation atlas trimming or resolution.
 * waterAt accepts world presentation coordinates (the composition owns any world offset). */
export function krakenWaterMask(width: number, height: number, transform: KrakenMaskTransform,
  waterAt: (x: number, y: number) => number, result = new Uint8ClampedArray(width * height * 4)): Uint8ClampedArray {
  const c = Math.cos(transform.rotation), s = Math.sin(transform.rotation);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = ((x + .5) / width - transform.originX) * transform.displayWidth;
    const dy = ((y + .5) / height - transform.originY) * transform.displayHeight;
    const offset = (y * width + x) * 4;
    result[offset] = Math.round(Math.max(0, Math.min(1,
      waterAt(transform.x + dx * c - dy * s, transform.y + dx * s + dy * c))) * 255);
    result[offset + 1] = result[offset + 2] = 0;
    result[offset + 3] = 255;
  }
  return result;
}

let maskSerial = 0;
/** Owns only its small world mask and filter. Residency owns the borrowed atlas frames. */
export class KrakenSubmersion {
  readonly filter: SubmersionFilter;
  private readonly mask: Phaser.Textures.CanvasTexture;
  private signature = '';
  private readonly pixels: ImageData;
  private uniform: 0 | 1 | null = null;
  private destroyed = false;

  constructor(private readonly sprite: Sprite, elevation: Phaser.Textures.Frame, encoding: { min: number; max: number },
    private readonly waterAt: KrakenWaterSampler, exposure = KRAKEN_WORLD_EXPOSURE) {
    this.mask = sprite.scene.textures.createCanvas(`kraken-runtime-mask-${++maskSerial}`, 128, 128)!;
    this.pixels = this.mask.context.createImageData(128, 128);
    this.filter = addSubmersionFilter(sprite, elevation, encoding, this.mask.key);
    this.filter.params.exposure = exposure;
  }

  update(elevation: Phaser.Textures.Frame, level: number, timeSeconds: number, waterRevision = 0): void {
    if (this.destroyed) return;
    this.filter.elevationFrame = elevation;
    this.filter.params.waterLevel = level;
    this.filter.params.time = timeSeconds;
    const s = this.sprite;
    const signature = [s.x, s.y, s.originX, s.originY, s.displayWidth, s.displayHeight, s.rotation, waterRevision].join(',');
    if (signature === this.signature) return;
    this.signature = signature;
    const uniform = this.waterAt.uniformMask?.(s) ?? null;
    if (uniform !== null && uniform === this.uniform) return;
    this.uniform = uniform;
    if (uniform === null) krakenWaterMask(128, 128, s, this.waterAt, this.pixels.data);
    else for (let i = 0; i < this.pixels.data.length; i += 4) {
      this.pixels.data[i] = uniform * 255; this.pixels.data[i + 3] = 255;
    }
    this.mask.context.putImageData(this.pixels, 0, 0);
    this.mask.refresh();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sprite.filters?.internal.remove(this.filter);
    this.mask.destroy();
  }
}
