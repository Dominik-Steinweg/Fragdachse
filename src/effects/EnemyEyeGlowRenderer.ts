import * as Phaser from 'phaser';
import { DEPTH_LIGHTING } from '../config';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import { fillRadialGradientTexture, mixColors, registerGraphicsObject } from './EffectUtils';
import { emissiveAlpha, getEmissiveScale } from './EmissiveScale';
import { EnemyEyeBatch } from './EnemyEyeBatch';
import { EnemyEyeGlowModel } from './EnemyEyeGlowModel';
import type { LightingSystem } from './LightingSystem';

const CORE = '__enemy_eye_core', HALO = '__enemy_eye_halo', BLOOM = '__enemy_eye_bloom', AURA = '__enemy_eye_aura';
const SOCKET = '__enemy_eye_socket';
/** Rad per ms: a slow, uneasy breathing of the glow (~2.4 s period). */
const PULSE_SPEED = .0026, PULSE_DEPTH = .16;
// At native size the two eye centres are only 2–6 px apart. Everything drawn per eye is
// bounded by that spacing, so the dark gap between them survives; only the faint aura
// (one per enemy) may cover both.
const CORE_MAX_SPACING = .6, HALO_MAX_SPACING = .95, BLOOM_PER_SPACING = 1.5;
/** Emissive scale at noon and at full night (see TimeOfDay); drives the day/night core tint. */
const DAY_EMISSIVE = .55, NIGHT_EMISSIVE = 1;

/**
 * Scene-owned buffers, World-owned binding. Reads the displayed pose after enemy visual sync.
 *
 * Five layers above the night overlay, back to front:
 * - aura (ADD, one per enemy): faint coloured light around both eyes;
 * - socket (NORMAL, per eye): dark, sunken surround that separates the eyes from bright
 *   heads and daylight ground; overlapping sockets only darken the gap between the eyes;
 * - bloom (ADD, per eye): steep spill whose tail barely reaches the other eye;
 * - halo (NORMAL): opaque coloured rim that stays readable over bright daylight ground,
 *   where additive colour washes out;
 * - core (NORMAL): white-hot pupil.
 */
export class EnemyEyeGlowRenderer {
  readonly model = new EnemyEyeGlowModel();
  private readonly core: EnemyEyeBatch;
  private readonly halo: EnemyEyeBatch;
  private readonly bloom: EnemyEyeBatch;
  private readonly aura: EnemyEyeBatch;
  private readonly socket: EnemyEyeBatch;
  private world: object | null = null;
  private required: () => boolean = () => false;
  private destroyed = false;
  private suppressed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly lighting: LightingSystem) {
    fillRadialGradientTexture(scene.textures, CORE, 32, [[0, '#ffffff'], [.6, '#ffffff'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, HALO, 32, [[0, 'rgba(255,255,255,1)'], [.55, 'rgba(255,255,255,.85)'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, BLOOM, 64, [[0, 'rgba(255,255,255,1)'], [.2, 'rgba(255,255,255,.6)'],
      [.45, 'rgba(255,255,255,.2)'], [.7, 'rgba(255,255,255,.05)'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, AURA, 64, [[0, 'rgba(255,255,255,1)'], [.3, 'rgba(255,255,255,.6)'],
      [.6, 'rgba(255,255,255,.2)'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, SOCKET, 32, [[0, 'rgba(255,255,255,1)'], [.5, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]);
    this.aura = new EnemyEyeBatch(scene, AURA, 256, DEPTH_LIGHTING + .09);
    this.socket = new EnemyEyeBatch(scene, SOCKET, 512, DEPTH_LIGHTING + .095);
    this.bloom = new EnemyEyeBatch(scene, BLOOM, 512, DEPTH_LIGHTING + .1);
    this.halo = new EnemyEyeBatch(scene, HALO, 512, DEPTH_LIGHTING + .11);
    this.core = new EnemyEyeBatch(scene, CORE, 512, DEPTH_LIGHTING + .12);
    this.aura.layer.setBlendMode(Phaser.BlendModes.ADD);
    this.bloom.layer.setBlendMode(Phaser.BlendModes.ADD);
    this.core.layer.setName('enemy-eye-cores'); this.halo.layer.setName('enemy-eye-halos');
    this.bloom.layer.setName('enemy-eye-blooms'); this.aura.layer.setName('enemy-eye-auras');
    this.socket.layer.setName('enemy-eye-sockets');
    for (const batch of this.batches()) registerGraphicsObject(scene, 'enemyStatus', batch.layer);
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
    this.core.begin(count); this.halo.begin(count); this.bloom.begin(count); this.socket.begin(count); this.aura.begin(count / 2);
    const auraAlpha = emissiveAlpha(.34), bloomAlpha = emissiveAlpha(.9);
    // White-hot at night; by day a whitish pupil vanishes against pale heads, so keep colour.
    const night = Math.max(0, Math.min(1, (getEmissiveScale() - DAY_EMISSIVE) / (NIGHT_EMISSIVE - DAY_EMISSIVE)));
    const coreWhite = .2 + .35 * night;
    const now = this.scene.time.now;
    for (let i = 0; i < count; i++) {
      const eye = this.model.eyes[i];
      const pulse = Math.sin(now * PULSE_SPEED + eye.phase) * PULSE_DEPTH;
      const breathe = 1 - PULSE_DEPTH + pulse;
      const spacing = eye.spacing > 0 ? eye.spacing : Infinity;
      if (i % 2 === 0) {
        const other = this.model.eyes[i + 1], glow = eye.glowPx * (1 + pulse * .35);
        this.aura.write((eye.x + other.x) * .5, (eye.y + other.y) * .5, glow, glow, 0, eye.color, eye.alpha * auraAlpha * breathe);
      }
      const coreW = Math.min(eye.width, spacing * CORE_MAX_SPACING), coreH = Math.min(eye.height, coreW);
      const haloMax = Math.max(spacing * HALO_MAX_SPACING, coreW);
      const haloW = Math.min(coreW * 1.6 + 1, haloMax), haloH = Math.min(coreH * 1.6 + 1, haloMax);
      this.socket.write(eye.x, eye.y, haloW + 2.4, haloH + 2.4, eye.rotation, mixColors(eye.color, 0x000000, .88), eye.alpha * .6);
      const bloom = Math.max(Math.min(spacing * BLOOM_PER_SPACING, eye.glowPx), eye.width * 1.6);
      this.bloom.write(eye.x, eye.y, bloom, bloom, 0, eye.color, eye.alpha * bloomAlpha * breathe);
      this.halo.write(eye.x, eye.y, haloW, haloH, eye.rotation, eye.color, eye.alpha * .85);
      this.core.write(eye.x, eye.y, coreW, coreH, eye.rotation, mixColors(eye.color, 0xffffff, coreWhite), eye.alpha);
    }
    this.lighting.setEnemyEyeLights(this.model);
  }

  private clear(): void {
    this.model.clear();
    for (const batch of this.batches()) batch.begin(0);
    this.lighting.setEnemyEyeLights(null);
  }
  private batches(): readonly EnemyEyeBatch[] { return [this.core, this.halo, this.bloom, this.socket, this.aura]; }
  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.world = null; this.required = () => false; this.destroyed = true;
    for (const batch of this.batches()) batch.destroy();
  }
}
