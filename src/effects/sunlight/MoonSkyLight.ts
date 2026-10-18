import * as Phaser from 'phaser';
import { MOON_TUNING } from '../../config/sunlight';
import type { LightMapAmbientLayer } from '../LightingSystem';
import { CLOUD_SHADOW_GLSL, setCloudUniforms, type SunCloudState } from './cloudShadow';
import { moonIslandAt, type MoonSkyState } from './MoonSky';
import { SunRenderTarget } from './SunRenderTarget';

/** Fixed program key: one linked program per renderer, warmed while loading and reused by every World. */
export const MOON_SKY_SHADER_NAME = 'WorldMoonSky';
export const MOON_SKY_FRAGMENT = `#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec4 uMoonWorld;
uniform vec3 uMoonLight;
uniform vec2 uMoonEdge;
${CLOUD_SHADOW_GLSL}
void main() {
  vec2 world=uMoonWorld.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uMoonWorld.zw;
  float island=smoothstep(uMoonEdge.x,uMoonEdge.y,cloudLightAnalytic(world,uCloudTime).r);
  gl_FragColor=vec4(uMoonLight*island,1.0);
}`;

/**
 * Moon islands in light-map space: one world-anchored evaluation per light-map pixel and
 * frame, added to the map after its ambient fill. Island rims stay put while the camera
 * scrolls. Lamps add on top unchanged; ground, water, fog and rocks below the map receive it
 * like any light, the bleed treats it as ambient, canopies sample the same field on the CPU.
 */
export class MoonSkyLight implements LightMapAmbientLayer {
  private readonly target: SunRenderTarget;
  private readonly image: Phaser.GameObjects.Image;
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly world = new Float32Array(4);
  private readonly light = new Float32Array(3);
  private readonly edge = new Float32Array(MOON_TUNING.islandEdge);
  private width = 0;
  private height = 0;

  constructor(scene: Phaser.Scene, private readonly clouds: SunCloudState, private readonly sky: MoonSkyState) {
    this.renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    this.target = new SunRenderTarget(scene, 'MoonSky', MOON_SKY_FRAGMENT, set => {
      setCloudUniforms(set, this.clouds, false);
      set('uMoonWorld', this.world); set('uMoonLight', this.light); set('uMoonEdge', this.edge);
    }, undefined, MOON_SKY_SHADER_NAME);
    this.image = new Phaser.GameObjects.Image(scene, 0, 0, this.target.shader.texture!.key)
      .setOrigin(0).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** The production moon is night, not glow; a blood moon keeps the bleed of its approved look. */
  get bleedWeight(): number { return this.sky.nightShare; }

  /** The added light in light-map space, valid for the frame of the last update. */
  get lightTexture(): Phaser.Textures.Texture | null { return this.sky.active ? this.target.shader.texture : null; }

  update(worldX: number, worldY: number, worldWidth: number, worldHeight: number, width: number, height: number):
    Phaser.GameObjects.GameObject | null {
    if (!this.sky.active) return null;
    this.world[0] = worldX; this.world[1] = worldY; this.world[2] = worldWidth; this.world[3] = worldHeight;
    for (let channel = 0; channel < 3; channel++) this.light[channel] = this.sky.light[channel];
    this.renderer.renderNodes.finishBatch();
    this.target.draw(width, height);
    if (this.width !== width || this.height !== height) {
      this.width = width; this.height = height;
      this.image.setTexture(this.target.shader.texture!.key).setDisplaySize(width, height);
    }
    return this.image;
  }

  /** Light this layer adds at a world point, RGB 0..1; canopies above the map read it here. */
  sampleAt(x: number, y: number, out: number[]): number[] {
    const island = this.sky.active ? moonIslandAt(x, y, this.clouds) : 0;
    for (let channel = 0; channel < 3; channel++) out[channel] = this.sky.light[channel] * island;
    return out;
  }

  destroy(): void { this.image.destroy(); this.target.destroy(); }
}
