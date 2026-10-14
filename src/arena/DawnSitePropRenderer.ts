import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../config';
import type { LightingSystem } from '../effects/LightingSystem';
import { ensureExplosionSparkTexture, TEX_EXPLOSION_SPARK } from '../effects/gpu/GpuVfxSourceTextures';
import { DAWN_SITE_DISPLAY_SIZE, DAWN_SUPPLY_CRATE_DISPLAY_SIZE } from '../assets/DawnAssets';
import { DAWN_M3_ASSET_KEYS } from '../dawn/contracts/DawnContentIds';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { DawnWorldPlan } from '../dawn/contracts/DawnPlans';
import { toDawnSiteBaseId, toDawnSiteObjectiveId } from '../dawn/resolution/DawnScenarioResolution';
import type { CoopDefenseSecondaryObjectivePresentationState, SyncedCoopDefenseCarryItem } from '../types';
import { resolveCoopDefenseWorldMetrics } from '../world/WorldMetrics';
import { getBaseWorldBounds, resolveWorldBases } from './BaseRegistry';
import { DAWN_SITE_LIGHT, DAWN_SITE_SPARKS, resolveDawnSiteLights, resolveDawnSitePropHitFlash,
  resolveDawnSitePropVisual, type DawnSiteLight, type DawnSitePropHitFlash } from './DawnSitePropModel';

export type DawnSiteLightingPort = Pick<LightingSystem, 'setLight' | 'releaseLight' | 'getArtificialLightFactor'>;

const DAWN_SITE_HIT_FLASH_TINT = 0x6a6a6a;

/** World material on the main camera, independent of the base's dormant representation. */
export class DawnSitePropRenderer {
  private readonly sites;
  private readonly sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly hitFlashes = new Map<string, DawnSitePropHitFlash>();
  private readonly emissions = new Map<string, Phaser.GameObjects.Image>();
  private readonly sparks = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly lightKeys = new Set<string>();
  private readonly crates = new Map<string, Phaser.GameObjects.Image>();
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    plan: DawnWorldPlan,
    world: WorldDefinition,
    private readonly isStructureDestroyed: (baseId: string) => boolean,
    private readonly getStructureHp: (baseId: string) => number | null,
    private readonly lighting: DawnSiteLightingPort | null = null,
  ) {
    const metrics = resolveCoopDefenseWorldMetrics(world.metrics.widthCells, world.metrics.heightCells);
    const bases = resolveWorldBases(world, metrics);
    this.sites = plan.sites.flatMap(site => {
      const baseId = toDawnSiteBaseId(site.slotId);
      const base = bases.find(entry => entry.id === baseId);
      if (!base || base.cells.length === 0) return [];
      const bounds = getBaseWorldBounds(base.region, metrics);
      return [{ ...site, baseId, objectiveId: toDawnSiteObjectiveId(site.slotId),
        x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }];
    });
  }

  sync(objectives: CoopDefenseSecondaryObjectivePresentationState | null): void {
    if (this.destroyed) return;
    const seenLights = new Set<string>();
    for (const site of this.sites) {
      const state = objectives?.find(entry => entry.objectiveId === site.objectiveId)?.state;
      const destroyed = this.isStructureDestroyed(site.baseId);
      const visual = resolveDawnSitePropVisual(site.archetypeId, site.tier, state, destroyed, site.variant);
      let sprite = this.sprites.get(site.baseId);
      if (!visual || !this.scene.textures.exists(visual.textureKey)
        || (visual.animationKey !== null && !this.scene.anims.exists(visual.animationKey))) {
        sprite?.destroy();
        this.sprites.delete(site.baseId);
        this.hitFlashes.delete(site.baseId);
        this.sparks.get(site.baseId)?.destroy();
        this.sparks.delete(site.baseId);
        continue;
      }
      if (!sprite) {
        sprite = this.scene.add.sprite(site.x, site.y, visual.textureKey)
          .setOrigin(0.5).setDepth(DEPTH.BASES);
        this.sprites.set(site.baseId, sprite);
      }
      if (visual.animationKey) {
        sprite.play(visual.animationKey, true);
      } else {
        sprite.stop();
        sprite.setTexture(visual.textureKey);
      }
      const size = visual.displaySize ?? DAWN_SITE_DISPLAY_SIZE;
      sprite.setDisplaySize(size, size);
      const flash = resolveDawnSitePropHitFlash(
        this.hitFlashes.get(site.baseId), this.getStructureHp(site.baseId), this.scene.time.now,
      );
      this.hitFlashes.set(site.baseId, flash);
      // Brighten, keep the texture: a flat fill read as an untextured square under dusk/night light.
      if (flash.active) sprite.setTint(DAWN_SITE_HIT_FLASH_TINT).setTintMode(Phaser.TintModes.ADD);
      else sprite.clearTint();
      if (this.lighting) {
        const lights = resolveDawnSiteLights(site.archetypeId, site.tier, state, destroyed, this.scene.time.now, site.variant);
        for (const light of lights) {
          const key = `dawn-site:${site.baseId}:${light.id}`;
          this.syncLight(key, site.x, site.y, light);
          seenLights.add(key);
        }
        if (site.archetypeId === 'wreck') {
          const ember = lights.find(light => light.id === 'warm')!;
          this.syncSparks(site.baseId, site.x + ember.offsetX, site.y + ember.offsetY);
        }
      }
    }
    for (const key of this.lightKeys) {
      if (seenLights.has(key)) continue;
      this.lighting?.releaseLight(key, { immediate: true });
      this.emissions.get(key)?.destroy();
      this.emissions.delete(key);
      this.lightKeys.delete(key);
    }
  }

  private syncLight(key: string, x: number, y: number, light: DawnSiteLight): void {
    const beacon = light.id === 'beacon';
    this.lighting!.setLight(key, beacon ? 'dawnSiteBeacon' : 'dawnSiteGlow', x + light.offsetX, y + light.offsetY, light);
    this.lightKeys.add(key);
    let emission = this.emissions.get(key);
    if (!emission) {
      ensureExplosionSparkTexture(this.scene);
      emission = this.scene.add.image(x + light.offsetX, y + light.offsetY, TEX_EXPLOSION_SPARK)
        .setDepth(DEPTH_LIGHTING + 0.08).setBlendMode(Phaser.BlendModes.ADD);
      this.emissions.set(key, emission);
    }
    const factor = this.lighting!.getArtificialLightFactor();
    if (beacon) {
      // Elongated reflector glint turning with the cone; it stays readable by day, where the cone light fades.
      emission.setOrigin(0.2, 0.5).setRotation(light.angle ?? 0)
        .setDisplaySize(light.emissionSize * 2.6, light.emissionSize).setTint(light.color)
        .setAlpha(light.emissionAlpha * Math.max(DAWN_SITE_LIGHT.beaconDayFloor, factor));
      return;
    }
    emission.setDisplaySize(light.emissionSize, light.emissionSize).setTint(light.color)
      .setAlpha(light.emissionAlpha * factor);
  }

  private syncSparks(baseId: string, x: number, y: number): void {
    let emitter = this.sparks.get(baseId);
    if (!emitter) {
      ensureExplosionSparkTexture(this.scene);
      const c = DAWN_SITE_SPARKS;
      emitter = this.scene.add.particles(x, y, TEX_EXPLOSION_SPARK, {
        frequency: c.intervalMs, quantity: 1, maxParticles: c.maxParticles,
        lifespan: { min: c.lifespanMinMs, max: c.lifespanMaxMs },
        speed: { min: c.speedMin, max: c.speedMax },
        x: { min: -c.spreadPx, max: c.spreadPx }, y: { min: -c.spreadPx, max: c.spreadPx },
        scale: { start: c.scaleStart, end: c.scaleEnd }, alpha: { start: 0.8, end: 0 },
        tint: DAWN_SITE_LIGHT.ember, blendMode: Phaser.BlendModes.ADD,
      }).setDepth(DEPTH_LIGHTING + 0.09);
      this.sparks.set(baseId, emitter);
    }
    emitter.setAlpha(this.lighting!.getArtificialLightFactor());
  }

  /** Objectives of this round's sites; their carry items are supply crates, not campaign bottles. */
  ownsObjective(objectiveId: string): boolean {
    return this.sites.some(site => site.objectiveId === objectiveId);
  }

  /** Replicated supply crates: on the ground below figures, carried above the carrier. */
  syncCrates(items: readonly SyncedCoopDefenseCarryItem[]): void {
    if (this.destroyed) return;
    const seen = new Set<string>();
    for (const item of items) {
      if (!this.scene.textures.exists(DAWN_M3_ASSET_KEYS.supplyCrate)) break;
      let crate = this.crates.get(item.id);
      if (!crate) {
        crate = this.scene.add.image(item.x, item.y, DAWN_M3_ASSET_KEYS.supplyCrate)
          .setDisplaySize(DAWN_SUPPLY_CRATE_DISPLAY_SIZE, DAWN_SUPPLY_CRATE_DISPLAY_SIZE);
        this.crates.set(item.id, crate);
      }
      const carried = item.holderId !== null;
      crate.setPosition(item.x, item.y - (carried ? 10 : 0)).setDepth(carried ? DEPTH.PLAYERS + 0.2 : DEPTH.BASES + 1);
      seen.add(item.id);
    }
    for (const [id, crate] of this.crates) {
      if (seen.has(id)) continue;
      crate.destroy();
      this.crates.delete(id);
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const crate of this.crates.values()) crate.destroy();
    this.crates.clear();
    for (const key of this.lightKeys) this.lighting?.releaseLight(key, { immediate: true });
    this.lightKeys.clear();
    for (const emission of this.emissions.values()) emission.destroy();
    this.emissions.clear();
    for (const emitter of this.sparks.values()) emitter.destroy();
    this.sparks.clear();
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.hitFlashes.clear();
  }
}
