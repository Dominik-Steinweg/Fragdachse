import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import type { DamageZoneVisualStyle } from '../types';
import { registerGraphicsObject } from './EffectUtils';
import { STINK_FRAGMENT_SOURCE, STINK_SHADER_NAME } from './stinkCloudShader';

const PALETTES: Record<DamageZoneVisualStyle, readonly [number, number, number]> = {
  stink: [0x35581f, 0xa4dd18, 0xdbff9a],
  spore: [0x586023, 0xb5bc42, 0xf0e97f],
  spore_void: [0x3a1a58, 0x9d35ee, 0xd887ff],
  electric: [0x0d2b45, 0x3aa8e0, 0x9fe8ff],
};
const DETAIL = { high: 2, medium: 1, low: 0 };
function rgb(color: number): readonly number[] {
  return [(color >>> 16) / 255, ((color >>> 8) & 255) / 255, (color & 255) / 255];
}

/** Owns one gas quad. Animation is GPU-side; the system owns pose and lifetime. */
export class StinkCloudBody {
  private readonly quad: Phaser.GameObjects.Shader;
  private readonly birthTime: number;
  private readonly uniforms = { time: 0, pixels: 1, detail: 2, opacity: 0 };

  constructor(private readonly scene: Phaser.Scene, id: number, variant: DamageZoneVisualStyle) {
    this.birthTime = scene.time.now;
    const [deep, body, light] = PALETTES[variant].map(rgb);
    const seed = ((Math.imul(id + 1, 0x9e3779b9) >>> 0) / 0x100000000) * 997;
    const u = this.uniforms;
    this.quad = scene.add.shader({
      name: STINK_SHADER_NAME, shaderName: STINK_SHADER_NAME, fragmentSource: STINK_FRAGMENT_SOURCE,
      setupUniforms: (set: (name: string, value: number | readonly number[]) => void) => {
        set('uTime', u.time); set('uSeed', seed); set('uPixels', u.pixels);
        set('uDetail', u.detail); set('uOpacity', u.opacity);
        set('uDeep', deep); set('uBody', body); set('uLight', light);
        set('uElectric', variant === 'electric' ? 1 : 0);
      },
    }, 0, 0, 1, 1).setOrigin(.5).setDepth(DEPTH.STINK).setVisible(false);
    registerGraphicsObject(scene, 'stinkCloudGraphics', this.quad);
  }

  update(x: number, y: number, radius: number, alpha: number, visible: boolean): void {
    const u = this.uniforms;
    u.time = Math.max(0, this.scene.time.now - this.birthTime) * .001;
    u.opacity = alpha;
    u.pixels = Math.max(1, radius * 2 * this.scene.cameras.main.zoom);
    u.detail = DETAIL[getGraphicsQualityProfile(this.scene).level];
    // Shader Size does not refresh displayOrigin after a radius change.
    this.quad.setPosition(x, y).setSize(radius * 2, radius * 2).setOrigin(.5).setVisible(visible);
  }

  destroy(): void { this.quad.destroy(); }
}
