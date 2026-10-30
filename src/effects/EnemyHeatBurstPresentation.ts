import * as Phaser from 'phaser';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { ALLIED_PALETTE, DEPTH, DEPTH_LIGHTING } from '../config';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import { enemyEmissionTextureKey, enemyEmissionZones } from '../config/enemyEmission';
import { getPipelineAssetForTexture } from '../config/pipelineAssets';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { enemyHeatAt, enemyHeatBurstPhaseAt, type EnemyHeatBurstPhase } from '../systems/EnemyHeatBurstState';
import { pounceUnitHash } from '../systems/enemyPounceRules';
import { ENEMY_CLAW_HOSTILE_COLOR, type EnemyZoneAttack } from './EnemyClawRenderer';
import { fillRadialGradientTexture, makeAdditive } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import { DEMON_HEAT_FISSURE_COLOR, DEMON_HEAT_FLARE_COLOR, DEMON_HEAT_HAZE_COLOR, DEMON_HEAT_SPARK_COLOR, enemyHeatGlowAt,
  type EnemyHeatGlow } from './enemyHeatGlowModel';
import { createHeatEmissionGpuLayer, HeatEmissionBatchData, type HeatEmissionGpuLayer } from './demonHeat/HeatEmissionGpuLayer';
import type { LightingSystem } from './LightingSystem';

export type EnemyHeatZoneSink = (id: string, attack: EnemyZoneAttack | null, now: number, visible: boolean) => void;

/** GPU heat particles of a body (DemonHeatGpuRenderer): lit-zone embers, step bursts, the meltdown inhale. */
export interface EnemyHeatParticleSink {
  glow(x: number, y: number, rotation: number, frame: number, stage: number, color: number, ember: number, running: boolean): void;
  step(x: number, y: number, rotation: number, frame: number, zone: number, color: number, ember: number): void;
  inhale(x: number, y: number, radius: number, strength: number, color: number, ember: number): void;
}

/** The zone turns from warning to strike this long before the burst. */
const STRIKE_LEAD_MS = 120;
/** The zone lingers briefly after the burst so the hit reads as its result. */
const BURST_LINGER_MS = 80;
/** A warning seen this late (join, lag) starts silently. */
const SOUND_GRACE_MS = 250;
/** A step seen this late (join, lag) bursts no embers. */
const STEP_GRACE_MS = 300;
/** Overlay alpha a step's flare adds (enemyHeatGlowModel); the halo leaves it out. */
const FLARE_ALPHA = 0.3;
/**
 * By day additive effects are damped so they do not clip to white over bright ground. The heat seams sit
 * on dark crust in the beauty sheet and cannot clip, so they keep most of their strength by day.
 */
const SEAM_DAY_FLOOR = 0.8;
/** Moving at least this far per frame trails embers (a pinned or standing body never does). */
const RUNNING_PX = 1.4;
const TEX_HEAT_HALO = '_enemy_heat_halo';
/** Halo diameter as a multiple of the body size, cold and at full heat. */
const HALO_COLD = 1.1;
const HALO_HOT = 1.9;
/** Halo opacity relative to the glow; the emission overlay carries the shape, the halo the heat around it. */
const HALO_SHARE = 0.32;
/** Emission overlay (the sheet's heat channels) sits just above the light map, like turret emission. */
const EMISSION_DEPTH = DEPTH_LIGHTING + 0.08;
/** Ground light radius as a multiple of the body size, cold and at full glow. */
const LIGHT_RADIUS_MIN = 2.2;
const LIGHT_RADIUS_MAX = 4.2;
/** Warning light radius as a multiple of the burst radius (a radial light fades towards its edge). */
const WARNING_LIGHT_RADIUS = 1.05;

interface HeatVisual {
  readonly halo: Phaser.GameObjects.Image;
  readonly lightKey: string;
  readonly offset: number;
  lit: boolean;
  /** Warning whose countdown sound already played. */
  warnedAt: number;
  /** Step whose ember burst already played. */
  steppedAt: number;
  lastX: number;
  lastY: number;
}

/**
 * Always-on presentation of heat-burst enemies (the Demon Badger), read from the replicated heat:
 * the stage glow on the body (the emission sheet's zones up to the stage, drawn by one GPU layer per
 * sheet, a soft halo under the body and a ground light), the flare of every step, the fissures and the
 * red zone of the meltdown around the standing body until its burst. It only observes replicated state.
 */
export class EnemyHeatBurstPresentation {
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private zoneSink: EnemyHeatZoneSink | null = null;
  private particles: EnemyHeatParticleSink | null = null;
  private lighting: LightingSystem | null = null;
  private audio: GameAudioSystem | null = null;
  private readonly visuals = new Map<string, HeatVisual>();
  private readonly sunk = new Set<string>();
  private readonly glow = {} as EnemyHeatGlow;
  private readonly emissionData = new Map<string, HeatEmissionBatchData>();
  private readonly emissionLayers = new Map<string, HeatEmissionGpuLayer | null>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: heat timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }
  /** The warning is drawn by the shared enemy danger renderer as a tracking zone. */
  setZoneSink(sink: EnemyHeatZoneSink | null): void { this.zoneSink = sink; }
  setParticleSink(sink: EnemyHeatParticleSink | null): void { this.particles = sink; }
  setAudioSystem(audio: GameAudioSystem | null): void { this.audio = audio; }
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
    for (const layer of this.emissionLayers.values()) layer?.image.destroy();
    this.emissionLayers.clear();
    this.emissionData.clear();
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.clear();
  }

  private render(): void {
    const now = this.clock();
    const live = new Set<string>();
    for (const data of this.emissionData.values()) data.begin();
    for (const enemy of this.enemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).heatBurst;
      const state = enemy.getHeatBurstState?.();
      if (!config || !state || !enemy.sprite.active) continue;
      live.add(enemy.id);
      const sprite = enemy.sprite, size = getCoopDefenseEnemyConfig(enemy.kind).size;
      const visible = sprite.visible && enemy.getHp() > 0;
      const phase = enemyHeatBurstPhaseAt(state, now), heat = enemyHeatAt(state, config.stages);
      const visual = this.visuals.get(enemy.id) ?? this.createVisual(enemy);
      const glow = enemyHeatGlowAt(this.glow, phase, state.stage, config.stages, now, state.stageAt, enemy.faction === 'allied',
        visual.offset, now - state.telegraphAt, state.burstAt - state.telegraphAt);

      const haloSize = size * (HALO_COLD + (HALO_HOT - HALO_COLD) * heat);
      // The warning halo throbs with the body: the red zone marks the reach, the halo the countdown. A step's
      // flare stays on the seams: under the body it would shine out between legs and horns as rays.
      const haloShare = phase === 'telegraph' ? HALO_SHARE * 0.8 : HALO_SHARE;
      visual.halo.setVisible(visible).setPosition(sprite.x, sprite.y).setDisplaySize(haloSize, haloSize)
        .setTint(glow.color).setAlpha(emissiveAlpha(Math.max(0, glow.alpha - FLARE_ALPHA * glow.flare) * haloShare * sprite.alpha));
      const meltdownFrom = state.stage >= config.stages ? state.stageAt : 0;
      const fissures = meltdownFrom > 0 && phase !== 'burst' && state.burstAt > meltdownFrom
        ? Math.sqrt(Math.max(0, Math.min(1, (now - meltdownFrom) / (state.burstAt - meltdownFrom)))) : 0;
      if (visible) this.pushEmission(enemy, glow, phase === 'heat' ? state.stage : config.stages, state.stage, fissures);
      this.emitParticles(enemy, visual, visible, phase, config.stages, config.burst.radiusPx, glow.color, now, fissures, meltdownFrom > 0);
      // A hostile warning lights the danger area itself in telegraph red, so it reads at night too.
      const warningRadius = phase === 'telegraph' && enemy.faction === 'hostile' ? config.burst.radiusPx : 0;
      this.syncLight(visual, sprite, visible, glow, size, warningRadius);

      const zone: EnemyZoneAttack | null = enemy.faction === 'hostile' && state.burstAt > 0 && now >= state.telegraphAt
        && now < state.burstAt + BURST_LINGER_MS ? {
          attackId: `heat:${enemy.id}:${state.telegraphAt}`, x: sprite.x, y: sprite.y, radius: config.burst.radiusPx,
          startedAt: state.telegraphAt, strikeAt: Math.max(state.telegraphAt, state.burstAt - STRIKE_LEAD_MS),
          hitAt: state.burstAt, endsAt: state.burstAt + BURST_LINGER_MS,
        } : null;
      if (zone) {
        this.zoneSink?.(enemy.id, zone, now, visible);
        this.sunk.add(enemy.id);
        if (visual.warnedAt !== state.telegraphAt) {
          visual.warnedAt = state.telegraphAt;
          // A rising countdown under the throb; it ends with the burst.
          if (visible && now - state.telegraphAt < SOUND_GRACE_MS) this.audio?.playSound('sfx_demon_badger_warning', sprite.x, sprite.y, enemy.id);
        }
      } else if (this.sunk.has(enemy.id)) {
        this.zoneSink?.(enemy.id, null, now, false);
        this.sunk.delete(enemy.id);
      }
    }
    for (const id of [...this.sunk]) if (!live.has(id)) { this.zoneSink?.(id, null, now, false); this.sunk.delete(id); }
    for (const id of [...this.visuals.keys()]) if (!live.has(id)) this.destroyVisual(id);
  }

  /**
   * The emission sheet's zones up to `litStage` follow the body frame by frame, tinted and faded by the
   * glow; the zone of the last step flares, and the meltdown opens fissures over the body.
   */
  private pushEmission(enemy: EnemyVisualSource, glow: EnemyHeatGlow, litStage: number, freshStage: number, fissures: number): void {
    const sprite = enemy.sprite, key = enemyEmissionTextureKey(sprite.texture.key);
    const alpha = glow.alpha * sprite.alpha, strength = Math.max(emissiveAlpha(alpha), alpha * SEAM_DAY_FLOOR);
    if (strength <= 0.01 && fissures <= 0) return;
    const data = this.emissionData.get(key)
      ?? this.createEmissionLayer(key, sprite.texture.key, getCoopDefenseEnemyConfig(enemy.kind).imageKey);
    const frame = data && this.scene.textures.getFrame(key, sprite.frame.name);
    if (!data || !frame) return;
    const allied = enemy.faction === 'allied';
    data.push({ x: sprite.x, y: sprite.y, rotation: sprite.rotation, width: Math.abs(sprite.displayWidth),
      height: Math.abs(sprite.displayHeight), originX: sprite.originX, originY: sprite.originY, flipX: sprite.flipX,
      flipY: sprite.flipY, u0: frame.u0, v0: frame.v0, u1: frame.u1, v1: frame.v1, seed: this.visuals.get(enemy.id)!.offset / 97,
      color: glow.color, strength, litStage, freshStage, flare: glow.flare,
      flareColor: allied ? ALLIED_PALETTE.bright : DEMON_HEAT_FLARE_COLOR,
      fissures, fissureColor: allied ? ALLIED_PALETTE.primary : DEMON_HEAT_FISSURE_COLOR });
  }

  /**
   * Embers burst from the zone a step just lit, lit zones shed embers (a runner trails them), and
   * through the meltdown void haze is drawn in from the burst circle.
   */
  private emitParticles(enemy: EnemyVisualSource, visual: HeatVisual, visible: boolean, phase: EnemyHeatBurstPhase,
    stages: number, radius: number, color: number, now: number, fissures: number, melting: boolean): void {
    const state = enemy.getHeatBurstState!(), sprite = enemy.sprite;
    const moved = Math.hypot(sprite.x - visual.lastX, sprite.y - visual.lastY);
    visual.lastX = sprite.x; visual.lastY = sprite.y;
    const stepped = state.stageAt !== visual.steppedAt;
    visual.steppedAt = state.stageAt;
    if (!this.particles || !visible || phase === 'burst') return;
    const allied = enemy.faction === 'allied', frame = Math.abs(sprite.displayWidth);
    const ember = allied ? ALLIED_PALETTE.bright : DEMON_HEAT_SPARK_COLOR, haze = allied ? ALLIED_PALETTE.deep : DEMON_HEAT_HAZE_COLOR;
    const stage = Math.min(state.stage, stages);
    if (stepped && stage > 0 && now - state.stageAt < STEP_GRACE_MS) {
      this.particles.step(sprite.x, sprite.y, sprite.rotation, frame, stage, haze, ember);
      // One sound for every step, fuller with the heat (never a rising pitch ladder).
      this.audio?.playSound('sfx_demon_badger_heat_step', sprite.x, sprite.y, enemy.id, 0.55 + 0.45 * stage / stages);
    }
    if (stage > 0) this.particles.glow(sprite.x, sprite.y, sprite.rotation, frame, stage, color, ember, moved > RUNNING_PX);
    if (melting) this.particles.inhale(sprite.x, sprite.y, radius, fissures, haze, ember);
  }

  /** One GPU layer per emission sheet, created once both sheets are loaded (null without WebGL). */
  private createEmissionLayer(key: string, beautyKey: string, imageKey: string): HeatEmissionBatchData | null {
    if (this.emissionLayers.has(key)) return this.emissionData.get(key) ?? null;
    if (!this.scene.textures.exists(key)) return null;
    const asset = getPipelineAssetForTexture(imageKey);
    const data = new HeatEmissionBatchData();
    const layer = createHeatEmissionGpuLayer(this.scene, data, key, beautyKey, asset ? enemyEmissionZones(asset) : 0,
      EMISSION_DEPTH, () => this.clock() % 3_600_000);
    this.emissionLayers.set(key, layer);
    if (!layer) return null;
    this.emissionData.set(key, data);
    data.begin();
    return data;
  }

  /**
   * Ground light only while the body glows noticeably: a horde of cold badgers costs no lights.
   * Through a warning the light covers the burst radius in telegraph red and throbs with the body.
   */
  private syncLight(visual: HeatVisual, sprite: Phaser.GameObjects.Sprite, visible: boolean, glow: EnemyHeatGlow,
    size: number, warningRadius: number): void {
    if (!this.lighting || !visible || glow.light <= 0.02) { this.releaseLight(visual); return; }
    this.lighting.setLight(visual.lightKey, 'entityGlow', sprite.x, sprite.y, warningRadius > 0 ? {
      color: ENEMY_CLAW_HOSTILE_COLOR,
      radiusPx: warningRadius * WARNING_LIGHT_RADIUS,
      // Modest per body: a pack melting down side by side must not add up to a washed-out red field.
      intensity: 0.2 + 0.55 * glow.light,
    } : {
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
    const visual: HeatVisual = { halo, lightKey: `heat-burst:${enemy.id}`, steppedAt: enemy.getHeatBurstState?.().stageAt ?? 0,
      lastX: enemy.sprite.x, lastY: enemy.sprite.y,
      offset: pounceUnitHash(enemy.id, 0, 31) * 1000, lit: false, warnedAt: 0 };
    this.visuals.set(enemy.id, visual);
    return visual;
  }

  private destroyVisual(id: string): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    this.visuals.delete(id);
    this.releaseLight(visual);
    visual.halo.destroy();
  }
}
