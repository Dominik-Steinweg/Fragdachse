import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../config';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import { enemyEmissionTextureKey } from '../config/enemyEmission';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { enemyHeatAt, enemyHeatBurstPhaseAt } from '../systems/EnemyHeatBurstState';
import { pounceUnitHash } from '../systems/enemyPounceRules';
import type { EnemyZoneAttack } from './EnemyClawRenderer';
import { fillRadialGradientTexture, makeAdditive } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import { enemyHeatGlowAt, type EnemyHeatGlow } from './enemyHeatGlowModel';
import type { LightingSystem } from './LightingSystem';

export type EnemyHeatZoneSink = (id: string, attack: EnemyZoneAttack | null, now: number, visible: boolean) => void;

/** The zone turns from warning to strike this long before the burst. */
const STRIKE_LEAD_MS = 120;
/** The zone lingers briefly after the burst so the hit reads as its result. */
const BURST_LINGER_MS = 80;
const TEX_HEAT_HALO = '_enemy_heat_halo';
/** Halo diameter as a multiple of the body size, cold and at full heat. */
const HALO_COLD = 1.5;
const HALO_HOT = 2.6;
/** Halo opacity relative to the glow; the emission overlay carries the shape, the halo the heat around it. */
const HALO_SHARE = 0.55;
/** Emission overlay (the sheet's heat channels) sits just above the light map, like turret emission. */
const EMISSION_DEPTH = DEPTH_LIGHTING + 0.08;
/** Ground light radius as a multiple of the body size, cold and at full glow. */
const LIGHT_RADIUS_MIN = 2.2;
const LIGHT_RADIUS_MAX = 4.2;

interface HeatVisual {
  readonly halo: Phaser.GameObjects.Image;
  emission: Phaser.GameObjects.Sprite | null;
  readonly lightKey: string;
  readonly offset: number;
  lit: boolean;
}

/**
 * Always-on presentation of heat-burst enemies (the Demon Badger), read from the replicated heat
 * timeline: the heat glow on the body (emission sheet when the asset has one, a soft halo under the
 * body and a ground light), the gait sped up with the heat, and the red warning zone that travels
 * with a running body until its burst. It only observes replicated state.
 */
export class EnemyHeatBurstPresentation {
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private zoneSink: EnemyHeatZoneSink | null = null;
  private lighting: LightingSystem | null = null;
  private readonly visuals = new Map<string, HeatVisual>();
  private readonly sunk = new Set<string>();
  private readonly glow = {} as EnemyHeatGlow;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: heat timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }
  /** The warning is drawn by the shared enemy danger renderer as a tracking zone. */
  setZoneSink(sink: EnemyHeatZoneSink | null): void { this.zoneSink = sink; }
  setLightingSystem(lighting: LightingSystem | null): void {
    if (lighting !== this.lighting) for (const visual of this.visuals.values()) this.releaseLight(visual);
    this.lighting = lighting;
  }

  /** A new flame visual appeared: a heat-burst owner plays its spit gesture (host-synchronised time). */
  onFlameShot(ownerId: string): void {
    const enemy = this.enemies().find(candidate => candidate.id === ownerId);
    if (enemy && getCoopDefenseEnemyConfig(enemy.kind).heatBurst) enemy.playSpit?.(this.clock());
  }

  clear(): void {
    const now = this.clock();
    for (const id of this.sunk) this.zoneSink?.(id, null, now, false);
    this.sunk.clear();
    for (const id of [...this.visuals.keys()]) this.destroyVisual(id);
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.clear();
  }

  private render(): void {
    const now = this.clock();
    const live = new Set<string>();
    for (const enemy of this.enemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).heatBurst;
      const state = enemy.getHeatBurstState?.();
      if (!config || !state || !enemy.sprite.active) continue;
      live.add(enemy.id);
      const sprite = enemy.sprite, size = getCoopDefenseEnemyConfig(enemy.kind).size;
      const visible = sprite.visible && enemy.getHp() > 0;
      const phase = enemyHeatBurstPhaseAt(state, now), heat = enemyHeatAt(state, now);
      const visual = this.visuals.get(enemy.id) ?? this.createVisual(enemy);
      const glow = enemyHeatGlowAt(this.glow, phase, heat, now, state.ventFromAt, enemy.faction === 'allied', visual.offset);

      const haloSize = size * (HALO_COLD + (HALO_HOT - HALO_COLD) * Math.max(heat, phase === 'vent' ? glow.alpha : 0));
      // During the warning the red zone owns the ground around the body; the halo steps back.
      const haloShare = phase === 'telegraph' ? HALO_SHARE * 0.25 : HALO_SHARE;
      visual.halo.setVisible(visible).setPosition(sprite.x, sprite.y).setDisplaySize(haloSize, haloSize)
        .setTint(glow.color).setAlpha(emissiveAlpha(glow.alpha * haloShare * sprite.alpha));
      this.syncEmission(visual, sprite, visible, glow);
      this.syncLight(visual, sprite, visible, glow, size);

      const zone: EnemyZoneAttack | null = enemy.faction === 'hostile' && state.burstAt > 0 && now >= state.telegraphAt
        && now < state.burstAt + BURST_LINGER_MS ? {
          attackId: `heat:${enemy.id}:${state.telegraphAt}`, x: sprite.x, y: sprite.y, radius: config.burst.radiusPx,
          startedAt: state.telegraphAt, strikeAt: Math.max(state.telegraphAt, state.burstAt - STRIKE_LEAD_MS),
          hitAt: state.burstAt, endsAt: state.burstAt + BURST_LINGER_MS,
        } : null;
      if (zone) {
        this.zoneSink?.(enemy.id, zone, now, visible);
        this.sunk.add(enemy.id);
      } else if (this.sunk.has(enemy.id)) {
        this.zoneSink?.(enemy.id, null, now, false);
        this.sunk.delete(enemy.id);
      }
    }
    for (const id of [...this.sunk]) if (!live.has(id)) { this.zoneSink?.(id, null, now, false); this.sunk.delete(id); }
    for (const id of [...this.visuals.keys()]) if (!live.has(id)) this.destroyVisual(id);
  }

  /** The emission sheet's heat channels follow the body frame by frame, tinted and faded by the heat. */
  private syncEmission(visual: HeatVisual, sprite: Phaser.GameObjects.Sprite, visible: boolean, glow: EnemyHeatGlow): void {
    const key = enemyEmissionTextureKey(sprite.texture.key);
    if (!visual.emission || visual.emission.texture.key !== key) {
      visual.emission?.destroy();
      visual.emission = this.scene.textures.exists(key)
        ? this.scene.add.sprite(sprite.x, sprite.y, key, sprite.frame.name).setBlendMode(Phaser.BlendModes.ADD).setDepth(EMISSION_DEPTH)
        : null;
    }
    const emission = visual.emission;
    if (!emission) return;
    emission.setVisible(visible && glow.alpha > 0.01);
    if (!emission.visible) return;
    if (emission.frame.name !== sprite.frame.name && emission.texture.has(sprite.frame.name)) emission.setFrame(sprite.frame.name);
    emission.setOrigin(sprite.originX, sprite.originY).setPosition(sprite.x, sprite.y).setRotation(sprite.rotation)
      .setScale(sprite.scaleX, sprite.scaleY).setFlip(sprite.flipX, sprite.flipY)
      .setTint(glow.color).setAlpha(emissiveAlpha(glow.alpha * sprite.alpha));
  }

  /** Ground light only while the body glows noticeably: a horde of cold badgers costs no lights. */
  private syncLight(visual: HeatVisual, sprite: Phaser.GameObjects.Sprite, visible: boolean, glow: EnemyHeatGlow, size: number): void {
    if (!this.lighting || !visible || glow.light <= 0.02) { this.releaseLight(visual); return; }
    this.lighting.setLight(visual.lightKey, 'entityGlow', sprite.x, sprite.y, {
      color: glow.color,
      radiusPx: size * (LIGHT_RADIUS_MIN + (LIGHT_RADIUS_MAX - LIGHT_RADIUS_MIN) * glow.light),
      intensity: 0.3 + 0.7 * glow.light,
    });
    visual.lit = true;
  }

  private releaseLight(visual: HeatVisual): void {
    if (visual.lit) this.lighting?.releaseLight(visual.lightKey);
    visual.lit = false;
  }

  private createVisual(enemy: EnemyVisualSource): HeatVisual {
    fillRadialGradientTexture(this.scene.textures, TEX_HEAT_HALO, 96, [
      [0, 'rgba(255,255,255,1)'],
      [0.3, 'rgba(255,255,255,0.5)'],
      [0.65, 'rgba(255,255,255,0.14)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    // Under the body, like the configured enemy glow halo: the heat radiates around it.
    const halo = makeAdditive(this.scene.add.image(enemy.sprite.x, enemy.sprite.y, TEX_HEAT_HALO).setDepth(DEPTH.PLAYERS - 0.09));
    const visual: HeatVisual = { halo, emission: null, lightKey: `heat-burst:${enemy.id}`,
      offset: pounceUnitHash(enemy.id, 0, 31) * 1000, lit: false };
    this.visuals.set(enemy.id, visual);
    return visual;
  }

  private destroyVisual(id: string): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    this.visuals.delete(id);
    this.releaseLight(visual);
    visual.halo.destroy();
    visual.emission?.destroy();
  }
}
