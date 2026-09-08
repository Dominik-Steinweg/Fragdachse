import type { TurretAnimationController } from '../../effects/TurretAnimationController';
import type { WorldHealthBarRenderer, HealthBarHandle } from '../../effects/health/WorldHealthBarRenderer';
import { TURRET_HEALTH_BAR_STYLE } from '../../effects/health/healthBarStyles';
import * as Phaser from 'phaser';
import { ArenaBuilder }     from '../../arena/ArenaBuilder';
import { RockPresentation, arenaWorldFrameSource } from '../../arena/RockPresentation';
import { UTILITY_CONFIGS }  from '../../loadout/LoadoutConfig';
import type { PlaceableTurretUtilityConfig, PlaceableUtilityConfig, PlaceableRockUtilityConfig } from '../../loadout/LoadoutConfig';
import { WEAPON_CONFIGS }   from '../../loadout/LoadoutConfig';
import { bridge }           from '../../network/bridge';
import { CELL_SIZE, COLORS, DEPTH, ROCK_HP_MAX } from '../../config';
import { createEmitter, destroyEmitter, fillRadialGradientTexture, registerGraphicsObject } from '../../effects/EffectUtils';
import type { RockDestructionRenderer } from '../../effects/RockDestructionRenderer';
import type { ShadowSystem } from '../../effects/ShadowSystem';
import type { LightingSystem } from '../../effects/LightingSystem';
import type { ArenaContext } from './ArenaContext';
import type { SyncedPlaceableRock } from '../../types';
import { CAMERA_FEEDBACK_PRIORITY, legacyShakeAmplitudePx } from '../../effects/camera/cameraFeedbackPresets';
import { getCoopDefenseConstructionDefinition } from '../../config/coopDefenseConstructions';
import { getTurretVisualSpec, getTurretVisualTransform } from '../../config/turretVisuals';
import type { WorldRuntime } from '../../world/WorldRuntime';
import type { WorldTargetingRuntime } from '../../world/WorldTargetingRuntime';
import type { WorldPlayerGameplayRuntime } from '../../world/WorldPlayerGameplayRuntime';
import type { WorldPowerUpRuntime } from '../../world/WorldPowerUpRuntime';

export interface RockVisualWorldPort {
  readonly getWorldRuntime: () => WorldRuntime | null;
  readonly getTargetingRuntime: () => WorldTargetingRuntime | null;
  readonly getPlayerGameplayRuntime: () => WorldPlayerGameplayRuntime | null;
  readonly getPowerUpRuntime: () => WorldPowerUpRuntime | null;
}

interface TurretVisualState {
  image:     Phaser.GameObjects.Sprite;
  aura:      Phaser.GameObjects.Image;
  rangeCircle: Phaser.GameObjects.Graphics;

  healthBar: HealthBarHandle | null;
  constructionId?: SyncedPlaceableRock['constructionId'];
  turretWeaponId?: SyncedPlaceableRock['turretWeaponId'];
}

const TEX_TURRET_AURA = '__placeable_turret_aura';

/**
 * Manages all rock and turret visual state.
 *
 * Methods are called from both HostUpdateCoordinator and ClientUpdateCoordinator
 * (via PlacementSystem snapshot sync) as well as ArenaLifecycleCoordinator (teardown).
 */
export class RockVisualHelper {
  private readonly turretVisuals = new Map<number, TurretVisualState>();
  private obstaclesDirty = false;
  private obstacleVisualsRequireFullRefresh = false;
  private readonly dirtyRockIds = new Set<number>();
  /** Fels-Darstellung für die jeweils über den Context gebundene World-Geometrie. */
  private worldPort: RockVisualWorldPort | null;
  private readonly rockPresentation: RockPresentation;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly shadowSystem: ShadowSystem | null,
    private readonly rockDestructionRenderer: RockDestructionRenderer,
    private readonly lighting: LightingSystem | null,
    worldPort?: RockVisualWorldPort | null,
    private readonly healthBars: WorldHealthBarRenderer | null = null,
    private readonly turretAnimations: TurretAnimationController | null = null,
  ) {
    this.worldPort = worldPort ?? null;
    this.ensureTurretTextures();
    this.rockPresentation = new RockPresentation(
      {
        scene,
        getResult: () => this.arenaResult,
        getLayout: () => this.currentLayout,
        getWorldFrame: arenaWorldFrameSource,
      },
      rockDestructionRenderer,
    );
  }

  setWorldPort(worldPort: RockVisualWorldPort): void {
    this.worldPort = worldPort;
  }

  private ensureTurretTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_TURRET_AURA, 64, [
      [0, 'rgba(255,255,255,0.34)'],
      [0.46, 'rgba(255,255,255,0.16)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }

  materializePlaceableRock(rock: SyncedPlaceableRock, playSpawnFx: boolean): void {
    this.materializePlaceableRockBatch([rock], playSpawnFx);
  }

  /**
   * Materialisiert eine Snapshot-Aenderungswelle in zwei Phasen: erst werden alle Layout- und
   * Laufzeit-Slots angelegt, danach alle Hindernis-Gitterzellen und erst dann die eigentlichen
   * Koerper/VisualStates. So sieht der erste Spawn eines Client-Batches denselben vollstaendigen
   * Nachbarschaftsbestand wie der letzte Spawn.
   */
  materializePlaceableRockBatch(
    rocks: readonly SyncedPlaceableRock[],
    playSpawnFx: boolean,
  ): void {
    if (!this.arenaResult || !this.currentLayout) return;

    const materialization = rocks.filter((rock) => rock.kind !== 'pedestal' && rock.collisionMode !== 'none');
    for (const rock of rocks) this.ensureRuntimeRockSlot(rock);
    for (const rock of materialization) {
      this.arenaResult.rockGrid.set(rock.gridX, rock.gridY, rock.id);
    }

    let refreshStaticShadows = false;
    let requiresObstacleIndexRebuild = false;
    const dirtyRockIds = new Set<number>();
    for (const rock of rocks) {
      const effects = this.materializePlaceableRockInternal(rock, playSpawnFx);
      refreshStaticShadows ||= effects.refreshStaticShadows;
      requiresObstacleIndexRebuild ||= effects.requiresObstacleIndexRebuild;
      if (effects.refreshStaticShadows || effects.hasStalePedestalProxy) dirtyRockIds.add(rock.id);
    }

    if (refreshStaticShadows) {
      this.markObstaclesDirtyBatch(dirtyRockIds, requiresObstacleIndexRebuild);
    } else if (dirtyRockIds.size > 0) {
      this.markObstaclesDirtyBatch(dirtyRockIds, false);
    }
  }

  private materializePlaceableRockInternal(
    rock: SyncedPlaceableRock,
    playSpawnFx: boolean,
  ): {
    refreshStaticShadows: boolean;
    requiresObstacleIndexRebuild: boolean;
    hasStalePedestalProxy: boolean;
  } {
    if (!this.arenaResult || !this.currentLayout) {
      return {
        refreshStaticShadows: false,
        requiresObstacleIndexRebuild: false,
        hasStalePedestalProxy: false,
      };
    }
    const presentation = this.arenaResult.rockVisualSystem !== null;

    // Power-up-Podeste werden vollständig vom PowerUpRenderer visualisiert und sind wie
    // feste Arena-Podeste begehbar. Der Runtime-Rock bleibt trotzdem im PlacementSystem,
    // damit Ownership, Grid-Belegung und Rückbau erhalten bleiben.
    if (rock.kind === 'pedestal') {
      const staleProxy = this.arenaResult.rockPhysicsProxies[rock.id];
      if (staleProxy) {
        ArenaBuilder.destroyRock(this.arenaResult, rock.id);
      }
      this.destroyTurretVisual(rock.id);
      if (playSpawnFx && presentation) {
        const world = this.gridToWorld(rock.gridX, rock.gridY);
        this.ctx.gameAudioSystem.playSound('sfx_place_rock', world.x, world.y, rock.ownerId);
      }
      return {
        refreshStaticShadows: false,
        requiresObstacleIndexRebuild: false,
        hasStalePedestalProxy: Boolean(staleProxy),
      };
    }

    // Persistent reward turrets are visible and targetable, but deliberately have neither a
    // physics proxy nor an ArenaBuilder obstacle footprint. Their cell remains reserved in the
    // PlacementSystem grid and is therefore still unavailable to player construction.
    if (rock.collisionMode === 'none') {
      this.destroyRockProxyIfPresent(rock.id);
      if (rock.kind === 'turret' && presentation) this.createOrUpdateTurretVisual(rock);
      if (playSpawnFx && presentation) {
        const world = this.gridToWorld(rock.gridX, rock.gridY);
        this.playTurretSpawnBurst(world.x, world.y, rock.ownerColor);
        this.ctx.gameAudioSystem.playSound('sfx_place_spore_turret', world.x, world.y, rock.ownerId);
      }
      return {
        refreshStaticShadows: false,
        requiresObstacleIndexRebuild: false,
        hasStalePedestalProxy: false,
      };
    }

    let refreshStaticShadows = false;

    if (!this.arenaResult.rockPhysicsProxies[rock.id]?.active && rock.kind === 'rock') {
      ArenaBuilder.spawnRockAndRetile(
        this.scene,
        this.arenaResult,
        this.currentLayout.rocks,
        rock.id,
        rock.ownerColor,
        this.getPlaceableRockConfig(rock).placeable.ownerTintStrength,
        rock.hp,
        rock.maxHp,
      );
      refreshStaticShadows = true;
    } else if (!this.arenaResult.rockPhysicsProxies[rock.id]?.active && rock.kind === 'turret') {
      ArenaBuilder.spawnRockAndRetile(
        this.scene,
        this.arenaResult,
        this.currentLayout.rocks,
        rock.id,
        undefined,
        0,
        rock.hp,
        rock.maxHp,
      );
      if (presentation) this.createOrUpdateTurretVisual(rock);
      refreshStaticShadows = true;
    } else if (rock.kind === 'turret') {
      if (presentation) this.createOrUpdateTurretVisual(rock);
    }

    this.updateRockVisualById(rock.id, rock.hp);

    if (playSpawnFx && presentation) {
      const world = this.gridToWorld(rock.gridX, rock.gridY);
      if (rock.kind !== 'rock') {
        this.playTurretSpawnBurst(world.x, world.y, rock.ownerColor);
        this.ctx.gameAudioSystem.playSound(
          rock.turretWeaponId === 'TURRET_SPORES' ? 'sfx_place_spore_turret' : 'sfx_place_rock',
          world.x,
          world.y,
          rock.ownerId,
        );
      } else {
        this.playRockDustBurst(world.x, world.y, rock.ownerColor);
        this.ctx.gameAudioSystem.playSound('sfx_place_rock', world.x, world.y, rock.ownerId);
      }
      if (rock.ownerId === bridge.getLocalPlayerId()) {
        const shakeCfg = rock.kind !== 'rock'
          ? this.getPlaceableTurretConfig(rock).placeable
          : this.getPlaceableRockConfig(rock).placeable;
        this.ctx.visualFeedback.camera.request({
          channel: 'impact',
          amplitudePx: legacyShakeAmplitudePx(shakeCfg.spawnShakeIntensity),
          durationMs: shakeCfg.spawnShakeDuration,
          priority: CAMERA_FEEDBACK_PRIORITY.lightImpact,
          decay: 'impulse',
          sourceX: world.x,
          sourceY: world.y,
        });
      }
    }

    return {
      refreshStaticShadows,
      requiresObstacleIndexRebuild: refreshStaticShadows,
      hasStalePedestalProxy: false,
    };
  }

  removePlaceableRockVisual(rock: SyncedPlaceableRock, playDust: boolean): void {
    if (!this.arenaResult || !this.currentLayout) return;
    const currentProxy = this.arenaResult.rockPhysicsProxies[rock.id];
    if (rock.collisionMode === 'none') {
      if (playDust) {
        const world = this.gridToWorld(rock.gridX, rock.gridY);
        this.playTurretSpawnBurst(world.x, world.y, rock.ownerColor);
      }
      this.destroyTurretVisual(rock.id);
      this.destroyRockProxyIfPresent(rock.id);
      return;
    }
    if (rock.kind === 'pedestal') {
      if (currentProxy) {
        ArenaBuilder.destroyRock(this.arenaResult, rock.id);
      }
      this.destroyTurretVisual(rock.id);
      this.markObstaclesDirty(rock.id, false);
      return;
    }
    if (playDust) {
      const world = this.gridToWorld(rock.gridX, rock.gridY);
      if (rock.kind !== 'rock') {
        this.playTurretSpawnBurst(world.x, world.y, rock.ownerColor);
      } else if (currentProxy?.active) {
        const snapshot = this.arenaResult.rockVisualSystem?.getDestructionSnapshot(rock.id);
        if (snapshot) this.rockDestructionRenderer.playDestruction(snapshot);
      } else {
        this.playRockDustBurst(world.x, world.y, rock.ownerColor);
      }
    }
    if (rock.kind === 'turret') {
      ArenaBuilder.destroyRockAndRetile(
        this.arenaResult,
        this.currentLayout.rocks,
        rock.id,
      );
      this.destroyTurretVisual(rock.id);
      this.markObstaclesDirty(rock.id, false);
      return;
    }
    ArenaBuilder.destroyRockAndRetile(
      this.arenaResult,
      this.currentLayout.rocks,
      rock.id,
    );
    this.markObstaclesDirty(rock.id, false);
  }

  updateRockVisualById(rockId: number, hp: number): void {
    if (!this.arenaResult || !this.currentLayout) return;
    const runtimeRock = this.placementSystem?.getRuntimeRock(rockId);
    if (runtimeRock?.kind === 'pedestal') return;
    if (runtimeRock?.collisionMode === 'none') {
      if (runtimeRock.kind === 'turret') this.createOrUpdateTurretVisual({ ...runtimeRock, hp });
      return;
    }
    if (runtimeRock && runtimeRock.kind !== 'rock') {
      ArenaBuilder.updateRockVisual(
        this.arenaResult,
        this.currentLayout.rocks,
        rockId,
        hp,
        runtimeRock.maxHp,
      );
      this.createOrUpdateTurretVisual({ ...runtimeRock, hp });
      return;
    }
    ArenaBuilder.updateRockVisual(
      this.arenaResult,
      this.currentLayout.rocks,
      rockId,
      hp,
      runtimeRock?.maxHp ?? this.rockRegistry?.getMaxHP(rockId) ?? ROCK_HP_MAX,
      runtimeRock?.ownerColor,
      runtimeRock ? this.getPlaceableRockConfig(runtimeRock).placeable.ownerTintStrength : 0,
    );
  }

  /** Presentation-only observation captured before the World owner removes the rock proxy. */
  presentStaticRockDestruction(rockId: number): void {
    const snapshot = this.arenaResult?.rockVisualSystem?.getDestructionSnapshot(rockId);
    if (snapshot) this.rockDestructionRenderer.playDestruction(snapshot);
  }

  /** Presentation invalidation after authoritative World removal. */
  observeStaticRockRemoved(rockId: number): void {
    this.markObstaclesDirty(rockId, false);
  }

  /** Applies an authoritative replicated removal; no HP or gameplay consequence is decided here. */
  applyStaticRockRemovalProjection(rockId: number): void {
    this.rockPresentation.destroyRock(rockId);
    this.markObstaclesDirty(rockId, false);
  }

  private get worldRuntime(): WorldRuntime | null { return this.worldPort?.getWorldRuntime() ?? null; }
  private get arenaResult() { return this.worldRuntime?.materialization?.arena ?? null; }
  private get currentLayout() { return this.worldRuntime?.presentation?.layout ?? null; }
  private get placementSystem() { return this.worldRuntime?.materialization?.placement ?? null; }
  private get rockRegistry() { return this.worldRuntime?.materialization?.rocks ?? null; }
  private get lightOccluderIndex() { return this.worldRuntime?.materialization?.lightOccluders ?? null; }
  private get world() { return this.worldRuntime?.context ?? null; }

  private destroyRockProxyIfPresent(rockId: number): void {
    if (this.arenaResult?.rockPhysicsProxies[rockId]) {
      ArenaBuilder.destroyRock(this.arenaResult, rockId);
    }
  }

  createOrUpdateTurretVisual(rock: SyncedPlaceableRock): void {
    if (!this.arenaResult || this.arenaResult.rockVisualSystem === null) return;
    const world = this.gridToWorld(rock.gridX, rock.gridY);
    const weaponId = rock.turretWeaponId ?? 'SPORES';
    const visualSpec = getTurretVisualSpec(weaponId);
    let visual = this.turretVisuals.get(rock.id);
    if (!visual) {
      const aura = this.scene.add.image(world.x, world.y, TEX_TURRET_AURA)
        .setDisplaySize(CELL_SIZE + 24, CELL_SIZE + 24)
        .setTint(rock.ownerColor)
        .setAlpha(0.2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.ROCKS + 0.1);
      const image = this.scene.add.sprite(world.x, world.y, visualSpec.textureKey)
        .setDisplaySize(visualSpec.displaySize, visualSpec.displaySize)
        .setDepth(DEPTH.ROCKS + 0.2);

      const rangeCircle = this.scene.add.graphics().setDepth(DEPTH.ROCKS - 0.2);
      registerGraphicsObject(this.scene, 'rockTools', rangeCircle);

      visual = {
        image,
        aura,
        rangeCircle,
        healthBar: null,
        constructionId: rock.constructionId,
        turretWeaponId: rock.turretWeaponId,
      };
      this.turretVisuals.set(rock.id, visual);
    }

    const definition = rock.constructionId
      ? getCoopDefenseConstructionDefinition(rock.constructionId)
      : undefined;
    const indestructible = definition?.indestructible === true;
    const transform = getTurretVisualTransform(visualSpec, world.x, world.y, rock.angle);
    this.turretAnimations?.bind(String(rock.id), visual.image, weaponId);
    if (!this.turretAnimations) visual.image.setTexture(visualSpec.textureKey);
    visual.image
      .setDisplaySize(visualSpec.displaySize, visualSpec.displaySize)
      .setPosition(transform.x, transform.y)
      .setRotation(transform.rotation);
    visual.aura
      .setPosition(world.x, world.y)
      .setTint(rock.ownerColor)
      .setVisible(visual.image.visible);
    visual.constructionId = rock.constructionId;
    visual.turretWeaponId = rock.turretWeaponId;
    visual.rangeCircle.clear();
    visual.rangeCircle.lineStyle(1.4, rock.ownerColor, 0.48);
    if (rock.kind === 'turret') {
      visual.rangeCircle.strokeCircle(
        world.x,
        world.y,
        rock.targetRange ?? this.getPlaceableTurretConfig(rock).placeable.targetRange,
      );
    }
    visual.rangeCircle.setVisible(!rock.constructionId || rock.turretWeaponId === 'TURRET_SPORES');

    if (!indestructible && !this.healthBars?.isValid(visual.healthBar)) {
      visual.healthBar = this.healthBars?.bind(TURRET_HEALTH_BAR_STYLE, rock.hp, rock.maxHp,
        world.x, world.y + 22, !visual.image.visible) ?? null;
    }
    this.healthBars?.suppress(visual.healthBar, indestructible || !visual.image.visible);
    this.healthBars?.observe(visual.healthBar, rock.hp, rock.maxHp);
    this.healthBars?.position(visual.healthBar, world.x, world.y + 22);
  }

  updateTurretAngle(rockId: number, angle: number): void {
    if (!Number.isFinite(angle)) return;
    const rock = this.placementSystem?.getRuntimeRock(rockId);
    const visual = this.turretVisuals.get(rockId);
    if (!rock || rock.kind !== 'turret' || !visual) return;

    const world = this.gridToWorld(rock.gridX, rock.gridY);
    const visualSpec = getTurretVisualSpec(rock.turretWeaponId ?? 'SPORES');
    const transform = getTurretVisualTransform(visualSpec, world.x, world.y, angle);
    visual.image
      .setPosition(transform.x, transform.y)
      .setRotation(transform.rotation);
  }

  /**
   * Bestätigt die Dauerlichter aller sichtbaren Fliegenpilz-Türme pro Frame. Ein einmaliges
   * Setzen beim Materialisieren reicht nicht, weil `LightingSystem` verwaiste keyed-Lichter
   * nach kurzer Zeit absichtlich entfernt.
   */
  syncTurretLights(active: boolean): void {
    if (!this.lighting) return;
    for (const [id, visual] of this.turretVisuals) {
      const key = turretLightKey(id);
      if (!active || !visual.image.active || !visual.image.visible) {
        this.lighting.releaseLight(key);
        continue;
      }
      if (visual.constructionId && visual.turretWeaponId !== 'TURRET_SPORES') {
        this.lighting.releaseLight(key);
      } else {
        this.lighting.setLight(key, 'spore_turret', visual.image.x, visual.image.y);
      }
    }
  }

  destroyTurretVisual(id: number): void {
    this.lighting?.releaseLight(turretLightKey(id));
    const visual = this.turretVisuals.get(id);
    if (!visual) return;
    visual.image.destroy();
    visual.aura.destroy();
    visual.rangeCircle.destroy();
    this.healthBars?.release(visual.healthBar);
    this.turretVisuals.delete(id);
  }

  destroyAllTurretVisuals(): void {
    for (const id of [...this.turretVisuals.keys()]) {
      this.destroyTurretVisual(id);
    }
  }

  rebuildStaticShadows(): void {
    this.markObstaclesDirty();
  }

  spawnTurretDeathCloud(rock: SyncedPlaceableRock): void {
    if (rock.kind !== 'turret' || (rock.constructionId && rock.turretWeaponId !== 'TURRET_SPORES')) return;
    const turretCfg = this.getPlaceableTurretConfig(rock);
    const weaponCfg = WEAPON_CONFIGS[turretCfg.weaponId as keyof typeof WEAPON_CONFIGS];
    if (weaponCfg.fire.type !== 'projectile' || !weaponCfg.fire.impactCloud) return;

    const world = this.gridToWorld(rock.gridX, rock.gridY);
    const cloud = weaponCfg.fire.impactCloud;
    this.ctx.stinkCloudSystem.hostCreateStationaryCloud(
      rock.ownerId,
      rock.ownerColor,
      world.x,
      world.y,
      turretCfg.placeable.deathCloudRadius,
      cloud.duration,
      cloud.damagePerTick,
      cloud.tickInterval,
      cloud.rockDamageMult ?? 1,
      cloud.trainDamageMult ?? 1,
    );
  }

  private getPlaceableRockConfig(rock: SyncedPlaceableRock): PlaceableRockUtilityConfig {
    const configured = rock.toolRef?.kind === 'utility'
      ? UTILITY_CONFIGS[rock.toolRef.id]
      : undefined;
    if (configured?.type === 'placeable_rock') return configured;
    return UTILITY_CONFIGS.ROCK_BARRIER as PlaceableRockUtilityConfig;
  }

  private getPlaceableTurretConfig(rock: SyncedPlaceableRock): PlaceableTurretUtilityConfig {
    const configured = rock.toolRef?.kind === 'utility'
      ? UTILITY_CONFIGS[rock.toolRef.id]
      : undefined;
    if (configured?.type === 'placeable_turret') return configured;
    return UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig;
  }

  gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    const metrics = this.world?.metrics;
    if (!metrics) throw new Error('[RockVisualHelper] Cannot resolve a grid cell without an active World');
    return {
      x: metrics.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2,
      y: metrics.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  private ensureRuntimeRockSlot(rock: SyncedPlaceableRock): void {
    if (!this.currentLayout || !this.arenaResult) return;
    this.currentLayout.rocks[rock.id] = { gridX: rock.gridX, gridY: rock.gridY };
    while (this.arenaResult.rockPhysicsProxies.length <= rock.id) {
      this.arenaResult.rockPhysicsProxies.push(null);
    }
  }

  private playRockDustBurst(x: number, y: number, ownerColor: number): void {
    fillRadialGradientTexture(this.scene.textures, 'placement_dust_particle', 24, [
      [0, '#fff6d6'],
      [0.35, '#d7b594'],
      [0.75, '#7a4841'],
      [1, 'rgba(0,0,0,0)'],
    ]);

    const emitter = createEmitter(this.scene, x, y, 'placement_dust_particle', {
      lifespan: { min: 260, max: 520 },
      speed:    { min: 30, max: 120 },
      angle:    { min: 0, max: 360 },
      quantity: 16,
      scale:    { start: 0.55, end: 0.05 },
      alpha:    { start: 0.45, end: 0 },
      tint:     [ownerColor, COLORS.BROWN_2, COLORS.BROWN_4],
      gravityY: -20,
      emitting: false,
    }, DEPTH.ROCKS + 1, 'standard', 'rockVisual');
    emitter.explode(18);
    this.scene.time.delayedCall(650, () => destroyEmitter(emitter));
  }

  private playTurretSpawnBurst(x: number, y: number, ownerColor: number): void {
    fillRadialGradientTexture(this.scene.textures, 'turret_spore_particle', 20, [
      [0, '#fff6b8'],
      [0.45, '#e3d86b'],
      [0.8, '#9e5b2d'],
      [1, 'rgba(0,0,0,0)'],
    ]);

    const emitter = createEmitter(this.scene, x, y, 'turret_spore_particle', {
      lifespan: { min: 260, max: 620 },
      speedX:   { min: -55, max: 55 },
      speedY:   { min: -65, max: 20 },
      quantity: 12,
      scale:    { start: 0.38, end: 0.05 },
      alpha:    { start: 0.55, end: 0 },
      tint:     [ownerColor, 0xe6da7a, 0xf5edd0],
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
    }, DEPTH.ROCKS + 1, 'standard', 'rockVisual');
    emitter.explode(14);
    this.scene.time.delayedCall(700, () => destroyEmitter(emitter));
  }

  /**
   * Einziger Trichter für "die Hindernisse haben sich geändert".
   *
   * Statischer Sonnenschatten und dynamische Lichtverdeckung hängen hier gemeinsam
   * dran, damit ein zerstörter Fels nicht seinen Schatten verlieren, aber weiter Licht
   * blockieren kann. Beide leiten sich aus denselben Referenzen ab
   * (`arenaResult.rockPhysicsProxies`, `placementSystem.getAllRuntimeRocks()`), es gibt keine
   * zweite Liste zerstörbarer Felsen.
   */
  /**
   * Sammelstelle statt Sofortaufruf: Eine Explosion zerstoert typischerweise mehrere Felsen
   * und wuerde sonst pro Fels einen vollstaendigen Rebuild aller statischen Schatten
   * ausloesen. Der Rebuild laeuft deshalb einmal am Ende des laufenden Frames.
   *
   * Bewusst ein Frame-Sammelpunkt und kein Zeit-Timer: Eine Verzoegerung von z.B. 200 ms
   * wuerde den Schatten sichtbar laenger stehen lassen als den zerstoerten Fels.
   */
  private markObstaclesDirty(rockId?: number, requiresIndexRebuild = true): void {
    this.markObstaclesDirtyBatch(rockId === undefined ? undefined : [rockId], requiresIndexRebuild);
  }

  private markObstaclesDirtyBatch(
    rockIds: ReadonlySet<number> | readonly number[] | undefined,
    requiresIndexRebuild = true,
  ): void {
    // Ein neu gesetzter Fels muss noch im selben Frame blockieren. Entfernte Felsen brauchen
    // dagegen keinen Rebuild: ArenaObstacleIndex liest `active` live und ueberspringt das
    // zerstoerte Quellobjekt sofort. Das vermeidet einen Vollaufbau zwischen Shotgun-Pellets.
    if (requiresIndexRebuild) this.ctx.getWorldCombatCore()!.invalidateObstacleIndex();
    if (rockIds === undefined) {
      this.obstacleVisualsRequireFullRefresh = true;
      this.dirtyRockIds.clear();
    } else if (!this.obstacleVisualsRequireFullRefresh) {
      for (const rockId of rockIds) this.dirtyRockIds.add(rockId);
    }
    if (this.obstaclesDirty) return;
    this.obstaclesDirty = true;
    this.scene.events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
      this.obstaclesDirty = false;
      const requireFullRefresh = this.obstacleVisualsRequireFullRefresh;
      const dirtyRockIds = new Set(this.dirtyRockIds);
      this.obstacleVisualsRequireFullRefresh = false;
      this.dirtyRockIds.clear();
      this.refreshObstacleVisuals(requireFullRefresh, dirtyRockIds);
    });
  }

  private refreshObstacleVisuals(requireFullRefresh: boolean, dirtyRockIds: ReadonlySet<number>): void {
    const canRefreshRegions = !requireFullRefresh
      && dirtyRockIds.size > 0
      && this.arenaResult?.rockOverlaySurface != null;
    if (canRefreshRegions) {
      this.rockPresentation.refreshOverlayRegions(dirtyRockIds);
      this.shadowSystem?.rebuildArenaStaticShadowRegions(
        this.currentLayout,
        this.arenaResult,
        dirtyRockIds,
        this.placementSystem?.getAllRuntimeRocks() ?? [],
      );
    } else {
      this.rockPresentation.refreshOverlays();
      this.shadowSystem?.rebuildArenaStaticShadows(
        this.currentLayout,
        this.arenaResult,
        this.placementSystem?.getAllRuntimeRocks() ?? [],
      );
    }
    this.lightOccluderIndex?.markDirty();
  }
}

function turretLightKey(id: number): string {
  return `spore_turret:${id}`;
}
