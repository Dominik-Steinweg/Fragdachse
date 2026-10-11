import * as Phaser from 'phaser';

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
  exposure: 1,
};

/** World lighting lifts sprites roughly 3x in linear light; the boss keeps its dark plum menace. */
export const KRAKEN_WORLD_EXPOSURE = 0.55;

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
varying vec2 outTexCoord;
#pragma phaserTemplate(fragmentHeader)
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
void main() {
  vec2 uv=outTexCoord;
  vec4 source=boundedSampler(uMainSampler,uv);
  source.rgb*=exposure;  // per-object exposure, also on land
  vec2 logical=vec2(uv.x,1.0-uv.y);
  vec2 local=(logical*elevationSize-elevationTrim.xy)/elevationTrim.zw;
  float mask=texture2D(uWaterMask,logical).r;
  if(source.a<=0.0 || mask<=0.0 || any(lessThan(local,vec2(0))) || any(greaterThan(local,vec2(1)))) {
    gl_FragColor=source; return;
  }
  vec4 height=texture2D(uElevation,mix(elevationUV.xy,elevationUV.zw,local));
  if(height.a<=0.001) { gl_FragColor=source; return; }
  // Phaser uploads PNGs with premultiplied alpha. Undo it for this data pass.
  float elevation=mix(elevationMin,elevationMax,clamp(height.r/height.a,0.0,1.0));
  float d=waterLevel-elevation;
  vec3 rgb=source.rgb/source.a;
  float alpha=source.a;
  if(d>0.0) {
    float f=1.0-exp(-d/max(depthFalloff,0.0001));
    vec2 shift=vec2(sin(logical.y*37.0+time*1.3),cos(logical.x*31.0+time*1.1));
    shift*=min(refractionPx,2.0)*0.70710678*f/max(displaySize,vec2(1));
    vec4 refracted=boundedSampler(uMainSampler,uv+shift);
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
  gl_FragColor=mix(source,vec4(clamp(rgb,0.0,1.0)*alpha,alpha),clamp(mask,0.0,1.0));
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
  }
  override setupUniforms(c: SubmersionFilter): void {
    const f = c.elevationFrame;
    const uniforms = {
      ...c.params, uElevation: 1, uWaterMask: 2,
      elevationMin: c.elevationMin, elevationMax: c.elevationMax,
      elevationUV: [f.u0, f.v0, f.u1, f.v1],
      elevationSize: [f.realWidth, f.realHeight],
      elevationTrim: [f.x, f.y, f.width, f.height],
      displaySize: [Math.abs(c.target.displayWidth), Math.abs(c.target.displayHeight)],
    };
    for (const [key, value] of Object.entries(uniforms)) this.programManager.setUniform(key, value);
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
