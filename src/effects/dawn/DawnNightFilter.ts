import * as Phaser from 'phaser';
import { DAWN_NIGHT_TEXTURES, type DawnNightFilterParams } from './DawnNightAtmosphereConfig';

const NODE = 'FilterDawnNight';

/**
 * One grade pass over the finished world image (camera output, below the clarity HUD): subtle LUT
 * (sRGB codes, 16 slices of 16x16), organic screen-edge tint and, for fire, embers rising in world
 * space. It adds no fog: the ground fog is composited once by its owner and only graded here.
 */
const FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)
precision mediump float;
uniform sampler2D uMainSampler;
uniform sampler2D uLut;
uniform sampler2D uEmber;
uniform sampler2D uEdge;
uniform vec4 uView;
uniform float uTime;
uniform float uStrength;
uniform float uLutAmount;
uniform vec4 uEmbers;
uniform vec3 uEmberColor;
uniform vec4 uEdgeColor;
varying vec2 outTexCoord;

vec3 grade(vec3 c) {
  vec3 p = clamp(c, 0.0, 1.0) * 15.0;
  float b0 = floor(p.b);
  float b1 = min(b0 + 1.0, 15.0);
  // Texture rows are uploaded bottom-up in this pass: green index 0 (top image row) sits at v = 1.
  vec2 rg = vec2(p.r + 0.5, 1.0 - (p.g + 0.5) / 16.0);
  vec3 lo = texture2D(uLut, vec2((b0 * 16.0 + rg.x) / 256.0, rg.y)).rgb;
  vec3 hi = texture2D(uLut, vec2((b1 * 16.0 + rg.x) / 256.0, rg.y)).rgb;
  return mix(lo, hi, p.b - b0);
}

void main() {
  vec4 base = texture2D(uMainSampler, outTexCoord);
  vec3 c = base.rgb;
  vec2 world = vec2(uView.x + outTexCoord.x * uView.z, uView.y + (1.0 - outTexCoord.y) * uView.w);
  vec3 result = mix(c, grade(c), uLutAmount);
  float edge = texture2D(uEdge, outTexCoord).r;
  if (uEmbers.x > 0.0) {
    vec2 at = (world + vec2(6.0 * sin(uTime * 0.7), uEmbers.z * uTime)) / uEmbers.y;
    float e = texture2D(uEmber, at).r;
    float flicker = 0.6 + 0.4 * sin(uTime * uEmbers.w + world.x * 0.05 + world.y * 0.03);
    // Embers gather toward the burning edge; the playfield centre keeps only a few.
    result += uEmberColor * e * flicker * uEmbers.x * (0.3 + 0.7 * edge);
  }
  result = mix(result, uEdgeColor.rgb, edge * uEdgeColor.a);
  gl_FragColor = vec4(mix(c, clamp(result, 0.0, 1.0), uStrength), base.a);
}`;

const rgb = (color: number): [number, number, number] =>
  [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];

/** Camera filter controller; the render node is registered lazily on the first WebGL use. */
export function createDawnNightFilter(camera: Phaser.Cameras.Scene2D.Camera) {
  const scene = camera.scene;
  const renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  ensureNode(renderer);
  const glTexture = (key: string) => scene.textures.exists(key) ? scene.textures.get(key).source[0].glTexture : null;
  if (scene.textures.exists(DAWN_NIGHT_TEXTURES.ember)) {
    scene.textures.get(DAWN_NIGHT_TEXTURES.ember).source[0].setWrap(Phaser.Textures.WrapMode.REPEAT, Phaser.Textures.WrapMode.REPEAT);
  }
  class DawnNightFilter extends Phaser.Filters.Controller {
    params: DawnNightFilterParams | null = null;
    strength = 0;
    time = 0;
    constructor() { super(camera, NODE); }
    textures(): (Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null)[] {
      return [glTexture(DAWN_NIGHT_TEXTURES.lut(this.params?.lut ?? 'identity')), glTexture(DAWN_NIGHT_TEXTURES.ember),
        glTexture(DAWN_NIGHT_TEXTURES.edge)];
    }
    /** All art present: missing art keeps the pass off instead of sampling an unbound unit. */
    ready(): boolean { return this.textures().every(Boolean); }
  }
  return new DawnNightFilter();
}
export type DawnNightFilter = ReturnType<typeof createDawnNightFilter>;

function ensureNode(renderer: Phaser.Renderer.WebGL.WebGLRenderer): void {
  const manager = renderer.renderNodes;
  class FilterDawnNight extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
    constructor(nodes: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) { super(NODE, nodes, undefined, FRAGMENT); }
    override setupTextures(controller: Phaser.Filters.Controller, textures: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper[]): void {
      const own = (controller as DawnNightFilter).textures();
      for (let i = 0; i < own.length; i++) textures[i + 1] = own[i]!;
    }
    override setupUniforms(controller: Phaser.Filters.Controller): void {
      const filter = controller as DawnNightFilter, p = filter.params!, program = this.programManager;
      const view = filter.camera.worldView;
      ['uLut', 'uEmber', 'uEdge'].forEach((name, index) => program.setUniform(name, index + 1));
      program.setUniform('uView', [view.x, view.y, view.width, view.height]);
      program.setUniform('uTime', filter.time);
      program.setUniform('uStrength', filter.strength);
      program.setUniform('uLutAmount', p.lutAmount);
      program.setUniform('uEmbers', [...p.embers]);
      program.setUniform('uEmberColor', rgb(p.emberColor));
      program.setUniform('uEdgeColor', [...rgb(p.edgeColor), p.edgeAmount]);
    }
  }
  try { manager.addNodeConstructor(NODE, FilterDawnNight); } catch { /* already registered for this renderer */ }
}
