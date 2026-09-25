import * as Phaser from 'phaser';
import { DEPTH_LIGHTING } from '../config';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { fillRadialGradientTexture, mixColors, registerGraphicsObject } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import { EnemyEyeBatch } from './EnemyEyeBatch';
import { EnemyEyeGlowModel } from './EnemyEyeGlowModel';
import type { LightingSystem } from './LightingSystem';

const CORE = '__enemy_eye_core', HALO = '__enemy_eye_halo';

/** Scene-owned buffers, World-owned binding. Reads the displayed pose after enemy visual sync. */
export class EnemyEyeGlowRenderer {
  readonly model = new EnemyEyeGlowModel();
  private readonly core: EnemyEyeBatch;
  private readonly halo: EnemyEyeBatch;
  private world: object | null = null;
  private required: () => boolean = () => false;
  private destroyed = false;
  private suppressed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly lighting: LightingSystem) {
    fillRadialGradientTexture(scene.textures, CORE, 32, [[0, '#ffffff'], [.7, '#ffffff'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, HALO, 32, [[0, 'rgba(255,255,255,.8)'], [.35, 'rgba(255,255,255,.32)'], [1, 'rgba(255,255,255,0)']]);
    this.halo = new EnemyEyeBatch(scene, HALO, 512, DEPTH_LIGHTING + .11);
    this.core = new EnemyEyeBatch(scene, CORE, 512, DEPTH_LIGHTING + .12);
    this.halo.layer.setBlendMode(Phaser.BlendModes.ADD);
    this.core.layer.setName('enemy-eye-cores'); this.halo.layer.setName('enemy-eye-halos');
    registerGraphicsObject(scene, 'enemyStatus', this.core.layer);
    registerGraphicsObject(scene, 'enemyStatus', this.halo.layer);
  }

  openWorld(scope: object, required: () => boolean): void {
    if (this.destroyed) return;
    this.clear(); this.world = scope; this.required = required;
  }
  closeWorld(scope: object): void {
    if (this.world !== scope) return;
    this.clear(); this.world = null; this.required = () => false;
  }
  /** Diagnostic A/B switch; never changes simulation or enemy visibility. */
  setSuppressed(value: boolean): void { this.suppressed = value; if (value) this.clear(); }

  sync(enemies: readonly EnemyVisualSource[]): void {
    if (this.destroyed) return;
    if (!this.world || !this.required() || this.suppressed) { this.clear(); return; }
    this.model.update(enemies, this.scene.cameras.main.worldView);
    this.core.begin(this.model.eyeCount); this.halo.begin(this.model.eyeCount);
    const haloAlpha = emissiveAlpha(.55);
    for (let i = 0; i < this.model.eyeCount; i++) {
      const eye = this.model.eyes[i];
      this.core.write(eye.x, eye.y, eye.width, eye.height, eye.rotation, mixColors(eye.color, 0xffffff, .25), eye.alpha);
      this.halo.write(eye.x, eye.y, eye.width + 3.2, eye.height + 3.2, eye.rotation, eye.color, eye.alpha * haloAlpha);
    }
    this.lighting.setEnemyEyeLights(this.model);
  }

  private clear(): void {
    this.model.clear(); this.core.begin(0); this.halo.begin(0);
    this.lighting.setEnemyEyeLights(null);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.world = null; this.required = () => false; this.destroyed = true;
    this.core.destroy(); this.halo.destroy();
  }
}
