import * as Phaser from 'phaser';
import { ArenaBuilder }     from '../../arena/ArenaBuilder';
import { RockPresentation, arenaWorldFrameSource } from '../../arena/RockPresentation';
import { UTILITY_CONFIGS }  from '../../loadout/LoadoutConfig';
import type { PlaceableTurretUtilityConfig, PlaceableUtilityConfig, PlaceableRockUtilityConfig } from '../../loadout/LoadoutConfig';
import { WEAPON_CONFIGS }   from '../../loadout/LoadoutConfig';
import { bridge }           from '../../network/bridge';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, COLORS, DEPTH, ROCK_HP_MAX } from '../../config';
import { createEmitter, destroyEmitter, fillRadialGradientTexture } from '../../effects/EffectUtils';
import type { RockDestructionRenderer } from '../../effects/RockDestructionRenderer';
import type { ShadowSystem } from '../../effects/ShadowSystem';
import type { LightingSystem } from '../../effects/LightingSystem';
import type { ArenaContext } from './ArenaContext';
import type { SyncedPlaceableRock } from '../../types';
import { emitArenaMapGridChanged } from './ArenaEvents';
import { isCoopDefenseMode } from '../../gameModes';
import { CAMERA_FEEDBACK_PRIORITY, legacyShakeAmplitudePx } from '../../effects/camera/cameraFeedbackPresets';
import { getCoopDefenseConstructionDefinition } from '../../config/coopDefenseConstructions';
import { getTurretVisualSpec, getTurretVisualTransform } from '../../config/turretVisuals';

interface TurretVisualState {
  image:     Phaser.GameObjects.Image;
  aura:      Phaser.GameObjects.Image;
  rangeCircle: Phaser.GameObjects.Graphics;
  hpBarBg:   Phaser.GameObjects.Rectangle;
  hpBarFg:   Phaser.GameObjects.Rectangle;
  constructionId?: SyncedPlaceableRock['constructionId'];
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
  /**
   * Gemeinsame Fels-Darstellung. Die Lobby führt ihren Ambient-Bestand mit derselben Klasse
   * und demselben Ablauf, nur mit ihrem eigenen Weltrahmen.
   */
  private readonly rockPresentation: RockPresentation;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly shadowSystem: ShadowSystem | null,
    private readonly rockDestructionRenderer: RockDestructionRenderer,
    private readonly lighting: LightingSystem | null = null,
  ) {
    this.ensureTurretTextures();
    this.rockPresentation = new RockPresentation(
      {
        scene,
        getResult: () => this.ctx.arenaResult,
        getLayout: () => this.ctx.currentLayout,
        getWorldFrame: arenaWorldFrameSource,
      },
      rockDestructionRenderer,
    );
  }

  private ensureTurretTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_TURRET_AURA, 64, [
      [0, 'rgba(255,255,255,0.34)'],
      [0.46, 'rgba(255,255,255,0.16)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }

  materializePlaceableRock(rock: SyncedPlaceableRock, playSpawnFx: boolean): void {
    if (!this.ctx.arenaResult || !this.ctx.currentLayout) return;
    this.ensureRuntimeRockSlot(rock);

    // Power-up-Podeste werden vollständig vom PowerUpRenderer visualisiert und sind wie
    // feste Arena-Podeste begehbar. Der Runtime-Rock bleibt trotzdem im PlacementSystem,
    // damit Ownership, Grid-Belegung und Rückbau erhalten bleiben.
    if (rock.kind === 'pedestal') {
      const staleProxy = this.ctx.arenaResult.rockPhysicsProxies[rock.id];
      if (staleProxy) {
        ArenaBuilder.destroyRock(this.ctx.arenaResult, rock.id);
        this.markObstaclesDirty(rock.id, false);
      }
      this.destroyTurretVisual(rock.id);
      if (playSpawnFx) {
        const world = this.gridToWorld(rock.gridX, rock.gridY);
        this.ctx.gameAudioSystem.playSound('sfx_place_rock', world.x, world.y, rock.ownerId);
      }
      return;
    }

    let refreshStaticShadows = false;

    if (!this.ctx.arenaResult.rockPhysicsProxies[rock.id]?.active && rock.kind === 'rock') {
      ArenaBuilder.spawnRockAndRetile(
        this.scene,
        this.ctx.arenaResult,
        this.ctx.currentLayout.rocks,
        rock.id,
        rock.ownerColor,
        this.getPlaceableRockConfig(rock).placeable.ownerTintStrength,
        rock.hp,
        rock.maxHp,
      );
      refreshStaticShadows = true;
    } else if (!this.ctx.arenaResult.rockPhysicsProxies[rock.id]?.active && rock.kind === 'turret') {
      ArenaBuilder.spawnRockAndRetile(
        this.scene,
        this.ctx.arenaResult,
        this.ctx.currentLayout.rocks,
        rock.id,
        undefined,
        0,
        rock.hp,
        rock.maxHp,
      );
      this.createOrUpdateTurretVisual(rock);
      refreshStaticShadows = true;
    } else if (rock.kind === 'turret') {
      this.createOrUpdateTurretVisual(rock);
    }

    this.updateRockVisualById(rock.id, rock.hp);
    if (refreshStaticShadows) this.markObstaclesDirty(rock.id);

    if (playSpawnFx) {
      const world = this.gridToWorld(rock.gridX, rock.gridY);
      if (rock.kind !== 'rock') {
        this.playTurretSpawnBurst(world.x, world.y, rock.ownerColor);
        this.ctx.gameAudioSystem.playSound(
          rock.constructionId ? 'sfx_place_rock' : 'sfx_place_spore_turret',
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
  }

  removePlaceableRockVisual(rock: SyncedPlaceableRock, playDust: boolean): void {
    if (!this.ctx.arenaResult || !this.ctx.currentLayout) return;
    const currentProxy = this.ctx.arenaResult.rockPhysicsProxies[rock.id];
    if (rock.kind === 'pedestal') {
      if (currentProxy) {
        ArenaBuilder.destroyRock(this.ctx.arenaResult, rock.id);
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
        const snapshot = this.ctx.arenaResult.rockVisualSystem.getDestructionSnapshot(rock.id);
        if (snapshot) this.rockDestructionRenderer.playDestruction(snapshot);
      } else {
        this.playRockDustBurst(world.x, world.y, rock.ownerColor);
      }
    }
    if (rock.kind === 'turret') {
      ArenaBuilder.destroyRockAndRetile(
        this.ctx.arenaResult,
        this.ctx.currentLayout.rocks,
        rock.id,
      );
      this.destroyTurretVisual(rock.id);
      this.markObstaclesDirty(rock.id, false);
      return;
    }
    ArenaBuilder.destroyRockAndRetile(
      this.ctx.arenaResult,
      this.ctx.currentLayout.rocks,
      rock.id,
    );
    this.markObstaclesDirty(rock.id, false);
  }

  updateRockVisualById(rockId: number, hp: number): void {
    if (!this.ctx.arenaResult || !this.ctx.currentLayout) return;
    const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(rockId);
    if (runtimeRock?.kind === 'pedestal') return;
    if (runtimeRock && runtimeRock.kind !== 'rock') {
      ArenaBuilder.updateRockVisual(
        this.ctx.arenaResult,
        this.ctx.currentLayout.rocks,
        rockId,
        hp,
        runtimeRock.maxHp,
      );
      this.createOrUpdateTurretVisual({ ...runtimeRock, hp });
      return;
    }
    ArenaBuilder.updateRockVisual(
      this.ctx.arenaResult,
      this.ctx.currentLayout.rocks,
      rockId,
      hp,
      runtimeRock?.maxHp ?? this.ctx.rockRegistry?.getMaxHP(rockId) ?? ROCK_HP_MAX,
      runtimeRock?.ownerColor,
      runtimeRock ? this.getPlaceableRockConfig(runtimeRock).placeable.ownerTintStrength : 0,
    );
  }

  applyObstacleDamageById(rockId: number, damage: number, attackerId: string): number {
    const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(rockId);
    if (runtimeRock) {
      if (runtimeRock.kind === 'turret' && runtimeRock.ownerId === attackerId) {
        return runtimeRock.hp;
      }
      const updated = this.ctx.placementSystem?.applyDamage(rockId, damage, attackerId);
      const hp = updated?.hp ?? 0;
      this.updateRockVisualById(rockId, hp);
      return hp;
    }

    if (!this.ctx.rockRegistry) return 0;
    const newHp = this.ctx.rockRegistry.applyDamage(rockId, damage);
    this.updateRockVisualById(rockId, newHp);
    return newHp;
  }

  /**
   * Gegenstueck zu {@link applyObstacleDamageById} fuer den Plasmabrenner. Deckt beide
   * Herkuenfte ab: platzierte Konstrukte fuehrt das `PlacementSystem`, Layout-Felsen die
   * `RockRegistry`. Gibt die tatsaechlich zugefuehrten HP zurueck (0 = nichts zu reparieren),
   * damit der Aufrufer den Heileffekt nur bei echter Wirkung zeigt.
   */
  applyObstacleRepairById(rockId: number, amount: number): number {
    if (amount <= 0) return 0;
    const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(rockId);
    if (runtimeRock) {
      const before = runtimeRock.hp;
      const updated = this.ctx.placementSystem?.repairRock(rockId, amount);
      if (!updated) return 0;
      this.updateRockVisualById(rockId, updated.hp);
      return updated.hp - before;
    }

    const registry = this.ctx.rockRegistry;
    if (!registry) return 0;
    const before = registry.getHP(rockId);
    const maxHp = registry.getMaxHP(rockId);
    if (before <= 0 || before >= maxHp) return 0;
    const newHp = Math.min(maxHp, before + amount);
    registry.setHP(rockId, newHp);
    this.updateRockVisualById(rockId, newHp);
    return newHp - before;
  }

  handleDestroyedRock(rockId: number, reason: 'damage' | 'decay', attackerId?: string): void {
    const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(rockId);
    if (runtimeRock) {
      this.ctx.targetStatusSystem?.removeTarget({ targetType: 'construction', targetId: String(rockId) });
      this.ctx.energyInjectorSystem?.removeTarget({ targetType: 'construction', targetId: String(rockId) });
      if (runtimeRock.kind === 'turret') {
        this.spawnTurretDeathCloud(runtimeRock);
      }
      if (runtimeRock.kind === 'pedestal') {
        this.ctx.powerUpSystem?.unregisterConstructionPedestal(runtimeRock.id);
      }
      if (runtimeRock.kind === 'rock' && reason === 'damage' && runtimeRock.lastAttackerId !== runtimeRock.ownerId && (runtimeRock.enemyDestroyedExplosionRadius ?? 0) > 0) {
        const world = { x: ARENA_OFFSET_X + runtimeRock.gridX * CELL_SIZE + CELL_SIZE / 2, y: ARENA_OFFSET_Y + runtimeRock.gridY * CELL_SIZE + CELL_SIZE / 2 };
        this.ctx.combatSystem.applyAoeDamage(world.x, world.y, runtimeRock.enemyDestroyedExplosionRadius ?? 0, runtimeRock.enemyDestroyedExplosionDamage ?? 0, runtimeRock.ownerId, false, { category: 'explosion', allowTeamDamage: false, sourceId: 'environment.rock_collapse', sourceSlot: 'utility' });
        this.ctx.hostPhysics.applyRadialImpulse(world.x, world.y, runtimeRock.enemyDestroyedExplosionRadius ?? 0, runtimeRock.enemyDestroyedExplosionKnockback ?? 0, runtimeRock.ownerId, 0);
        bridge.broadcastExplosionEffect(world.x, world.y, runtimeRock.enemyDestroyedExplosionRadius ?? 0);
      }
      this.ctx.placementSystem?.removeRock(rockId);
      this.removePlaceableRockVisual(runtimeRock, true);
      emitArenaMapGridChanged(this.scene.game.events, {
        reason: 'placeable_removed',
        source: runtimeRock.kind === 'rock'
          ? 'placeable_rock'
          : runtimeRock.kind === 'pedestal' ? 'placeable_pedestal' : 'placeable_turret',
        obstacleId: runtimeRock.id,
        gridX: runtimeRock.gridX,
        gridY: runtimeRock.gridY,
      });
      return;
    }

    if (!this.rockPresentation.destroyRock(rockId)) return;
    this.ctx.rockRegistry?.remove(rockId);
    this.markObstaclesDirty(rockId, false);
    const dropsArmor = !isCoopDefenseMode(bridge.getGameMode())
      || (
        reason === 'damage'
        && this.ctx.coopDefensePlayerModifierSystem?.getClassId(attackerId ?? '') === 'dachs_of_steel'
      );
    if (dropsArmor) this.ctx.powerUpSystem?.onRockDestroyed(rockId);
    const rockCell = this.ctx.currentLayout?.rocks[rockId];
    emitArenaMapGridChanged(this.scene.game.events, {
      reason: 'static_rock_destroyed',
      source: 'static_rock',
      obstacleId: rockId,
      gridX: rockCell?.gridX,
      gridY: rockCell?.gridY,
    });
  }

  createOrUpdateTurretVisual(rock: SyncedPlaceableRock): void {
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
      const image = this.scene.add.image(world.x, world.y, visualSpec.textureKey)
        .setDisplaySize(visualSpec.displaySize, visualSpec.displaySize)
        .setDepth(DEPTH.ROCKS + 0.2);

      const rangeCircle = this.scene.add.graphics().setDepth(DEPTH.ROCKS - 0.2);
      const hpBarBg = this.scene.add.rectangle(world.x, world.y + 22, 24, 4, 0x333333)
        .setDepth(DEPTH.ROCKS + 0.35);
      const hpBarFg = this.scene.add.rectangle(world.x - 12, world.y + 22, 24, 4, 0x00cc44)
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.ROCKS + 0.4);

      visual = { image, aura, rangeCircle, hpBarBg, hpBarFg, constructionId: rock.constructionId };
      this.turretVisuals.set(rock.id, visual);
    }

    const definition = rock.constructionId
      ? getCoopDefenseConstructionDefinition(rock.constructionId)
      : undefined;
    const indestructible = definition?.indestructible === true;
    const ratio = Phaser.Math.Clamp(rock.hp / Math.max(1, rock.maxHp), 0, 1);
    const transform = getTurretVisualTransform(visualSpec, world.x, world.y, rock.angle);
    visual.image
      .setTexture(visualSpec.textureKey)
      .setDisplaySize(visualSpec.displaySize, visualSpec.displaySize)
      .setPosition(transform.x, transform.y)
      .setRotation(transform.rotation);
    visual.aura
      .setPosition(world.x, world.y)
      .setTint(rock.ownerColor)
      .setVisible(visual.image.visible);
    visual.constructionId = rock.constructionId;
    visual.rangeCircle.clear();
    visual.rangeCircle.lineStyle(1.4, rock.ownerColor, 0.48);
    if (rock.kind === 'turret') {
      visual.rangeCircle.strokeCircle(
        world.x,
        world.y,
        rock.targetRange ?? this.getPlaceableTurretConfig(rock).placeable.targetRange,
      );
    }
    visual.rangeCircle.setVisible(!rock.constructionId);

    visual.hpBarBg.setPosition(world.x, world.y + 22).setVisible(!indestructible && ratio < 1);
    visual.hpBarFg
      .setPosition(world.x - 12, world.y + 22)
      .setSize(24 * ratio, 4)
      .setFillStyle(ratio > 0.5 ? 0x00cc44 : ratio > 0.25 ? 0xffcc00 : 0xff3300)
      .setVisible(!indestructible && ratio < 1);
  }

  updateTurretAngle(rockId: number, angle: number): void {
    if (!Number.isFinite(angle)) return;
    const rock = this.ctx.placementSystem?.getRuntimeRock(rockId);
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
      if (visual.constructionId) {
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
    visual.hpBarBg.destroy();
    visual.hpBarFg.destroy();
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
    if (rock.kind !== 'turret' || rock.constructionId) return;
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
    return {
      x: ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2,
      y: ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  private ensureRuntimeRockSlot(rock: SyncedPlaceableRock): void {
    if (!this.ctx.currentLayout || !this.ctx.arenaResult) return;
    this.ctx.currentLayout.rocks[rock.id] = { gridX: rock.gridX, gridY: rock.gridY };
    while (this.ctx.arenaResult.rockPhysicsProxies.length <= rock.id) {
      this.ctx.arenaResult.rockPhysicsProxies.push(null);
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
    }, DEPTH.ROCKS + 1);
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
    }, DEPTH.ROCKS + 1);
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
    // Ein neu gesetzter Fels muss noch im selben Frame blockieren. Entfernte Felsen brauchen
    // dagegen keinen Rebuild: ArenaObstacleIndex liest `active` live und ueberspringt das
    // zerstoerte Quellobjekt sofort. Das vermeidet einen Vollaufbau zwischen Shotgun-Pellets.
    if (requiresIndexRebuild) this.ctx.combatSystem.invalidateObstacleIndex();
    if (rockId === undefined) {
      this.obstacleVisualsRequireFullRefresh = true;
      this.dirtyRockIds.clear();
    } else if (!this.obstacleVisualsRequireFullRefresh) {
      this.dirtyRockIds.add(rockId);
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
      && this.ctx.arenaResult?.rockOverlaySurface != null;
    if (canRefreshRegions) {
      this.rockPresentation.refreshOverlayRegions(dirtyRockIds);
      this.shadowSystem?.rebuildArenaStaticShadowRegions(
        this.ctx.currentLayout,
        this.ctx.arenaResult,
        dirtyRockIds,
        this.ctx.placementSystem?.getAllRuntimeRocks() ?? [],
      );
    } else {
      this.rockPresentation.refreshOverlays();
      this.shadowSystem?.rebuildArenaStaticShadows(
        this.ctx.currentLayout,
        this.ctx.arenaResult,
        this.ctx.placementSystem?.getAllRuntimeRocks() ?? [],
      );
    }
    this.ctx.lightOccluderIndex?.markDirty();
  }
}

function turretLightKey(id: number): string {
  return `spore_turret:${id}`;
}
