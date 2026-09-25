import * as Phaser from 'phaser';
import { DEPTH_LIGHTING } from '../config';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import { fillRadialGradientTexture, mixColors, registerGraphicsObject } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import { EnemyEyeBatch } from './EnemyEyeBatch';
import { EnemyEyeGlowModel } from './EnemyEyeGlowModel';
import type { LightingSystem } from './LightingSystem';

const CORE = '__enemy_eye_core', HALO = '__enemy_eye_halo', BLOOM = '__enemy_eye_bloom';
/** Rad per ms: a slow, uneasy breathing of the bloom (~2.4 s period). */
const PULSE_SPEED = .0026, PULSE_DEPTH = .16;

/**
 * Scene-owned buffers, World-owned binding. Reads the displayed pose after enemy visual sync.
 *
 * Three layers above the night overlay, back to front:
 * - bloom (ADD): wide, saturated spill that lights up the face at night;
 * - halo (NORMAL): opaque coloured rim that stays readable over bright daylight ground,
 *   where additive colour washes out;
 * - core (NORMAL): white-hot pupil.
 */
export class EnemyEyeGlowRenderer {
  readonly model = new EnemyEyeGlowModel();
  private readonly core: EnemyEyeBatch;
  private readonly halo: EnemyEyeBatch;
  private readonly bloom: EnemyEyeBatch;
  private world: object | null = null;
  private required: () => boolean = () => false;
  private destroyed = false;
  private suppressed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly lighting: LightingSystem) {
    fillRadialGradientTexture(scene.textures, CORE, 32, [[0, '#ffffff'], [.7, '#ffffff'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, HALO, 32, [[0, 'rgba(255,255,255,1)'], [.45, 'rgba(255,255,255,.75)'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, BLOOM, 64, [[0, 'rgba(255,255,255,1)'], [.12, 'rgba(255,255,255,.8)'],
      [.35, 'rgba(255,255,255,.32)'], [.65, 'rgba(255,255,255,.09)'], [1, 'rgba(255,255,255,0)']]);
    this.bloom = new EnemyEyeBatch(scene, BLOOM, 512, DEPTH_LIGHTING + .1);
    this.halo = new EnemyEyeBatch(scene, HALO, 512, DEPTH_LIGHTING + .11);
    this.core = new EnemyEyeBatch(scene, CORE, 512, DEPTH_LIGHTING + .12);
    this.bloom.layer.setBlendMode(Phaser.BlendModes.ADD);
    this.core.layer.setName('enemy-eye-cores'); this.halo.layer.setName('enemy-eye-halos');
    this.bloom.layer.setName('enemy-eye-blooms');
    registerGraphicsObject(scene, 'enemyStatus', this.core.layer);
    registerGraphicsObject(scene, 'enemyStatus', this.halo.layer);
    registerGraphicsObject(scene, 'enemyStatus', this.bloom.layer);
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
    // The arena camera uses origin (0, 0); Phaser's `worldView` assumes 0.5 and would cull
    // enemies along the left/top edge at render resolutions above 1.
    this.model.update(enemies, getVisibleWorldView(this.scene.cameras.main));
    const count = this.model.eyeCount;
    this.core.begin(count); this.halo.begin(count); this.bloom.begin(count);
    const bloomAlpha = emissiveAlpha(.95);
    const now = this.scene.time.now;
    for (let i = 0; i < count; i++) {
      const eye = this.model.eyes[i];
      const pulse = Math.sin(now * PULSE_SPEED + eye.phase) * PULSE_DEPTH;
      const glow = eye.glowPx * (1 + pulse * .35);
      this.bloom.write(eye.x, eye.y, glow, glow, 0, eye.color, eye.alpha * bloomAlpha * (1 - PULSE_DEPTH + pulse));
      this.halo.write(eye.x, eye.y, eye.width * 1.9 + 2.6, eye.height * 1.9 + 2.6, eye.rotation, eye.color, eye.alpha * .85);
      this.core.write(eye.x, eye.y, eye.width, eye.height, eye.rotation, mixColors(eye.color, 0xffffff, .55), eye.alpha);
    }
    this.lighting.setEnemyEyeLights(this.model);
  }

  private clear(): void {
    this.model.clear(); this.core.begin(0); this.halo.begin(0); this.bloom.begin(0);
    this.lighting.setEnemyEyeLights(null);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.world = null; this.required = () => false; this.destroyed = true;
    this.core.destroy(); this.halo.destroy(); this.bloom.destroy();
  }
}
