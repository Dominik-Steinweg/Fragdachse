import * as Phaser from 'phaser';

const NODE = 'KrakenReviewDrain';
const managers = new WeakSet<object>();
const fragment = `
#pragma phaserTemplate(shaderName)
precision highp float;
uniform sampler2D uMainSampler, uElevation;
uniform vec4 elevationUV, elevationTrim;
uniform vec2 elevationSize, encoding;
uniform float level, amount, time;
varying vec2 outTexCoord;
#pragma phaserTemplate(fragmentHeader)
void main() {
  vec4 source=boundedSampler(uMainSampler,outTexCoord);
  vec2 logical=vec2(outTexCoord.x,1.0-outTexCoord.y);
  vec2 local=(logical*elevationSize-elevationTrim.xy)/elevationTrim.zw;
  if(source.a<.001 || any(lessThan(local,vec2(0))) || any(greaterThan(local,vec2(1)))) { gl_FragColor=source; return; }
  vec4 h=texture2D(uElevation,mix(elevationUV.xy,elevationUV.zw,local));
  float z=mix(encoding.x,encoding.y,h.r/max(h.a,.001))-level;
  float rim=exp(-pow(z/.055,2.0));
  // Thin rivulets follow height contours; draining changes height, not screen-space gravity.
  float bands=pow(.5+.5*sin(z*35.0+time*9.0+sin(logical.x*91.0)*2.0),9.0);
  float lanes=pow(.5+.5*sin(logical.x*171.0+sin(logical.y*59.0)*1.8),6.0);
  float drain=bands*lanes*exp(-max(0.0,z)*2.8)*step(0.0,z);
  float foam=clamp((rim*.75+drain*.5)*amount,0.0,.8)*step(.01,h.a);
  gl_FragColor=vec4(mix(source.rgb,vec3(.66,.86,.88)*source.a,foam),source.a);
}`;

/** Borrowed elevation frames; sprite FilterList owns teardown. No edits to the world submersion look. */
export class KrakenReviewDrainFilter extends Phaser.Filters.Controller {
  amount = 0;
  time = 0;
  level = 0;
  constructor(target: Phaser.GameObjects.Sprite, public elevation: Phaser.Textures.Frame,
    public encoding: { min: number; max: number }) {
    super(target.filterCamera, NODE);
    this.setPaddingOverride(0, 0, 0, 0);
  }
}
class DrainNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) { super(NODE, manager, undefined, fragment); }
  override setupTextures(c: KrakenReviewDrainFilter, textures: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper[]): void {
    textures[1] = c.elevation.glTexture;
  }
  override setupUniforms(c: KrakenReviewDrainFilter): void {
    const f = c.elevation;
    for (const [key, value] of Object.entries({ uElevation: 1, amount: c.amount, time: c.time, level: c.level,
      encoding: [c.encoding.min, c.encoding.max], elevationUV: [f.u0, f.v0, f.u1, f.v1],
      elevationSize: [f.realWidth, f.realHeight], elevationTrim: [f.x, f.y, f.width, f.height] })) this.programManager.setUniform(key, value);
  }
}
export function addReviewDrain(target: Phaser.GameObjects.Sprite, elevation: Phaser.Textures.Frame,
  encoding: { min: number; max: number }): KrakenReviewDrainFilter {
  const renderer = target.scene.sys.renderer;
  if (!('gl' in renderer)) throw Error('Kraken drain requires WebGL');
  if (!managers.has(renderer.renderNodes)) { renderer.renderNodes.addNodeConstructor(NODE, DrainNode); managers.add(renderer.renderNodes); }
  target.enableFilters();
  const filter = new KrakenReviewDrainFilter(target, elevation, encoding);
  target.filters!.internal.add(filter); filter.active = false;
  return filter;
}
