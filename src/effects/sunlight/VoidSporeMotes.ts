import * as Phaser from 'phaser';
import { DEPTH_LIGHTING, VOID_PALETTE } from '../../config';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import type { FogAirBinding } from '../groundFog/FogAirBinding';
import { VOID_SPORE_MOTES_FRAGMENT, VOID_SPORE_MOTES_SHADER_NAME } from './VoidSporeMoteShaders';

/** Self-lit motes sit just above the light map and below canopies (band E), like the void veins. */
const MOTES_DEPTH = DEPTH_LIGHTING + .06;
/** Glow of the motes by day and at full night; in between it follows the lamps' dusk curve. */
const DAY_GLOW = .36, NIGHT_GLOW = .62;
const FALLBACK = '__DEFAULT';

const rgb = (color: number): Float32Array => new Float32Array([(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255]);

/** Quality of the motes: one or two layers, and whether stirred air pushes them outwards. */
export interface VoidMoteQuality { readonly layers: number; readonly gradient: boolean }

/**
 * Luminous spore motes over the void haze (GDD Void-Gefahrenzonen V1, E9), one camera-following
 * quad. Owned by the World's void creep presentation, which hands it the creep field; the ground
 * fog lends it its air for this frame only.
 */
export class VoidSporeMotes {
  private readonly quad: Phaser.GameObjects.Shader;
  private readonly deep = rgb(VOID_PALETTE.primary);
  private readonly bright = rgb(VOID_PALETTE.bright);
  private air: FogAirBinding | null = null;
  private glow = DAY_GLOW;
  private quality: VoidMoteQuality = { layers: 2, gradient: true };

  constructor(scene: Phaser.Scene, private readonly creepKey: string,
    creep: { frame: Float32Array; time: number; alerts: Float32Array; alertLevels: Float32Array },
    view: Float32Array, pixelWorld: () => number) {
    this.quad = new Phaser.GameObjects.Shader(scene, {
      name: VOID_SPORE_MOTES_SHADER_NAME, shaderName: VOID_SPORE_MOTES_SHADER_NAME, fragmentSource: VOID_SPORE_MOTES_FRAGMENT,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        set('uCreep', 0); set('uCreepFrame', creep.frame); set('uCreepTime', creep.time); set('uView', view);
        set('uVoidAlert[0]', creep.alerts); set('uVoidAlertLevel[0]', creep.alertLevels);
        set('uPixelWorld', pixelWorld()); set('uGlow', this.glow);
        set('uLayers', this.quality.layers); set('uGradient', this.quality.gradient ? 1 : 0);
        set('uMoteDeep', this.deep); set('uMoteBright', this.bright);
        const air = this.air;
        set('uHasAir', air ? 1 : 0); set('uFogVelocity', 1); set('uFogLookup', 2); set('uFogState', 3);
        if (air) { set('uFogOrigin', air.origin); set('uFogWorldSize', air.worldSize); set('uFogLookupSize', air.lookupSize); }
      },
    }, 0, 0, 1, 1, [creepKey, FALLBACK, FALLBACK, FALLBACK]);
    const node = this.quad.renderNode;
    if (node) this.quad.once('destroy', () => disposeShaderWarmupNode(node));
    this.quad.setOrigin(0).setDepth(MOTES_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
    scene.add.existing(this.quad);
  }

  /** The fog's air after its step this frame; null without simulating fog (motes still draw). */
  setAir(air: FogAirBinding | null): void {
    this.air = air;
    const textures = this.quad.scene.textures;
    this.quad.setTextures(air ? [textures.get(this.creepKey), air.velocity, air.lookup, air.state] : [this.creepKey, FALLBACK, FALLBACK, FALLBACK]);
  }

  /** Covers the view; `night` 0..1 follows the lamps' dusk curve. */
  update(x: number, y: number, width: number, height: number, night: number, quality: VoidMoteQuality): void {
    this.glow = DAY_GLOW + (NIGHT_GLOW - DAY_GLOW) * Math.max(0, Math.min(1, night));
    this.quality = quality;
    this.quad.setPosition(x, y).setDisplaySize(width, height);
  }

  destroy(): void { this.air = null; this.quad.destroy(); }
}
