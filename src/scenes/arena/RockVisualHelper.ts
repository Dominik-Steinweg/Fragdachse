import Phaser from 'phaser';
import { ArenaBuilder }     from '../../arena/ArenaBuilder';
import { UTILITY_CONFIGS }  from '../../loadout/LoadoutConfig';
import type { PlaceableTurretUtilityConfig, PlaceableUtilityConfig, PlaceableRockUtilityConfig } from '../../loadout/LoadoutConfig';
import { WEAPON_CONFIGS }   from '../../loadout/LoadoutConfig';
import { bridge }           from '../../network/bridge';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, COLORS, DEPTH } from '../../config';
import { createEmitter, destroyEmitter, fillRadialGradientTexture } from '../../effects/EffectUtils';
import type { ShadowSystem } from '../../effects/ShadowSystem';
import type { ArenaContext } from './ArenaContext';
import type { SyncedPlaceableRock } from '../../types';

interface TurretVisualState {
  image:     Phaser.GameObjects.Image;
  rangeCircle: Phaser.GameObjects.Graphics;
  hpBarBg:   Phaser.GameObjects.Rectangle;
  hpBarFg:   Phaser.GameObjects.Rectangle;
}

/**
 * Manages all rock and turret visual state.
 *
 * Methods are called from both HostUpdateCoordinator and ClientUpdateCoordinator
 * (via PlacementSystem snapshot sync) as well as ArenaLifecycleCoordinator (teardown).
 */
export class RockVisualHelper {
  private readonly turretVisuals = new Map<number, TurretVisualState>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly arenaClipMask: Phaser.Display.Masks.GeometryMask | null,
    private readonly shadowSystem: ShadowSystem | null,
  ) {
    this.ensureTurretTextures();
  }

  private ensureTurretTextures(): void {
    if (!this.scene.textures.exists('placeable_turret')) {
      const g = this.scene.make.graphics({ x: 0, y: 0 });
      g.clear();
      g.fillStyle(0x000000, 0.18); g.fillEllipse(16, 18, 20, 12);
      g.fillStyle(0x78161e, 1);    g.fillCircle(16, 14, 10.5);
      g.fillStyle(0xa91e24, 1);    g.fillCircle(16, 13, 9.5);
      g.fillStyle(0xcf3135, 1);    g.fillCircle(16, 12, 8.4);
      g.fillStyle(0xf4f0e6, 1);
      g.fillCircle(11.5, 9.8, 1.9); g.fillCircle(16.2, 8.4, 1.5);
      g.fillCircle(20.3, 10.8, 1.8); g.fillCircle(12.8, 14.2, 1.6);
      g.fillCircle(19.4, 15.2, 1.3);
      g.fillStyle(0xe6dcc1, 1);    g.fillEllipse(16, 18.6, 7.5, 5.5);
      g.lineStyle(1.2, 0x4a1014, 0.7); g.strokeCircle(16, 13.4, 9.8);
      g.generateTexture('placeable_turret', 32, 32);
      g.destroy();
    }
    if (!this.scene.textures.exists('placeable_turret_proxy')) {
      const g = this.scene.make.graphics({ x: 0, y: 0 });
      g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 32, 32);
      g.generateTexture('placeable_turret_proxy', 32, 32);
      g.destroy();
    }
  }

  materializePlaceableRock(rock: SyncedPlaceableRock, playSpawnFx: boolean): void {
    if (!this.ctx.arenaResult || !this.ctx.currentLayout) return;
    this.ensureRuntimeRockSlot(rock);
    let refreshStaticShadows = false;

    if (!this.ctx.arenaResult.rockObjects[rock.id]?.active && rock.kind === 'rock') {
      ArenaBuilder.spawnRockAndRetile(
        this.scene,
        this.ctx.arenaResult.rockObjects,
        this.ctx.arenaResult.rockGroup,
        this.ctx.arenaResult.rockGrid,
        this.ctx.currentLayout.rocks,
        rock.id,
        rock.ownerColor,
        (UTILITY_CONFIGS.FELSBAU as PlaceableRockUtilityConfig).placeable.ownerTintStrength,
        rock.hp,
        rock.maxHp,
      );
      refreshStaticShadows = true;
    } else if (!this.ctx.arenaResult.rockObjects[rock.id]?.active && rock.kind === 'turret') {
      const world = this.gridToWorld(rock.gridX, rock.gridY);
      const proxy = this.scene.add.image(world.x, world.y, 'placeable_turret_proxy')
        .setDisplaySize(CELL_SIZE, CELL_SIZE)
        .setDepth(DEPTH.ROCKS)
        .setVisible(false)
        .setActive(true);
      this.ctx.arenaResult.rockObjects[rock.id] = proxy;
      this.ctx.arenaResult.rockGroup.add(proxy);
      (proxy.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      this.ctx.arenaResult.rockGroup.refresh();
      this.createOrUpdateTurretVisual(rock);
      refreshStaticShadows = true;
    } else if (rock.kind === 'turret') {
      this.createOrUpdateTurretVisual(rock);
    }

    this.updateRockVisualById(rock.id, rock.hp);
    if (refreshStaticShadows) this.refreshStaticShadows();

    if (playSpawnFx) {
      const world = this.gridToWorld(rock.gridX, rock.gridY);
      if (rock.kind === 'turret') {
        this.playTurretSpawnBurst(world.x, world.y, rock.ownerColor);
      } else {
        this.playRockDustBurst(world.x, world.y, rock.ownerColor);
      }
      if (rock.ownerId === bridge.getLocalPlayerId()) {
        const shakeCfg = rock.kind === 'turret'
          ? (UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig).placeable
          : (UTILITY_CONFIGS.FELSBAU as PlaceableRockUtilityConfig).placeable;
        this.scene.cameras.main.shake(shakeCfg.spawnShakeDuration, shakeCfg.spawnShakeIntensity);
      }
    }
  }

  removePlaceableRockVisual(rock: SyncedPlaceableRock, playDust: boolean): void {
    if (!this.ctx.arenaResult || !this.ctx.currentLayout) return;
    if (playDust) {
      const world = this.gridToWorld(rock.gridX, rock.gridY);
      if (rock.kind === 'turret') {
        this.playTurretSpawnBurst(world.x, world.y, rock.ownerColor);
      } else {
        this.playRockDustBurst(world.x, world.y, rock.ownerColor);
      }
    }
    if (rock.kind === 'turret') {
      ArenaBuilder.destroyRock(this.ctx.arenaResult.rockObjects, this.ctx.arenaResult.rockGroup, rock.id);
      this.ctx.arenaResult.rockGrid.remove(rock.gridX, rock.gridY);
      this.destroyTurretVisual(rock.id);
      this.refreshStaticShadows();
      return;
    }
    ArenaBuilder.destroyRockAndRetile(
      this.ctx.arenaResult.rockObjects,
      this.ctx.arenaResult.rockGroup,
      this.ctx.arenaResult.rockGrid,
      this.ctx.currentLayout.rocks,
      rock.id,
    );
    this.refreshStaticShadows();
  }

  updateRockVisualById(rockId: number, hp: number): void {
    if (!this.ctx.arenaResult || !this.ctx.currentLayout) return;
    const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(rockId);
    if (runtimeRock?.kind === 'turret') {
      this.createOrUpdateTurretVisual({ ...runtimeRock, hp });
      return;
    }
    ArenaBuilder.updateRockVisual(
      this.ctx.arenaResult.rockObjects,
      this.ctx.arenaResult.rockGroup,
      this.ctx.arenaResult.rockGrid,
      this.ctx.currentLayout.rocks,
      rockId,
      hp,
      runtimeRock?.maxHp ?? this.ctx.rockRegistry?.getMaxHP(rockId) ?? 200,
      runtimeRock?.ownerColor,
      runtimeRock ? (UTILITY_CONFIGS.FELSBAU as PlaceableRockUtilityConfig).placeable.ownerTintStrength : 0,
    );
  }

  applyObstacleDamageById(rockId: number, damage: number, attackerId: string): number {
    const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(rockId);
    if (runtimeRock) {
      if (runtimeRock.kind === 'turret' && runtimeRock.ownerId === attackerId) {
        return runtimeRock.hp;
      }
      const updated = this.ctx.placementSystem?.applyDamage(rockId, damage);
      const hp = updated?.hp ?? 0;
      this.updateRockVisualById(rockId, hp);
      return hp;
    }

    if (!this.ctx.rockRegistry) return 0;
    const newHp = this.ctx.rockRegistry.applyDamage(rockId, damage);
    this.updateRockVisualById(rockId, newHp);
    return newHp;
  }

  handleDestroyedRock(rockId: number, reason: 'damage' | 'decay'): void {
    void reason;
    const runtimeRock = this.ctx.placementSystem?.getRuntimeRock(rockId);
    if (runtimeRock) {
      if (runtimeRock.kind === 'turret') {
        this.spawnTurretDeathCloud(runtimeRock);
      }
      this.ctx.placementSystem?.removeRock(rockId);
      this.removePlaceableRockVisual(runtimeRock, true);
      return;
    }

    this.refreshStaticShadows();
    this.ctx.powerUpSystem?.onRockDestroyed(rockId);
  }

  createOrUpdateTurretVisual(rock: SyncedPlaceableRock): void {
    const world = this.gridToWorld(rock.gridX, rock.gridY);
    let visual = this.turretVisuals.get(rock.id);
    if (!visual) {
      const image = this.scene.add.image(world.x, world.y, 'placeable_turret')
        .setDisplaySize(CELL_SIZE, CELL_SIZE)
        .setDepth(DEPTH.ROCKS + 0.2);
      image.preFX?.addGlow(rock.ownerColor, 5, 0, false, 0.12, 10);

      const rangeCircle = this.scene.add.graphics().setDepth(DEPTH.ROCKS - 0.2);
      if (this.arenaClipMask) {
        rangeCircle.setMask(this.arenaClipMask);
      }
      const hpBarBg = this.scene.add.rectangle(world.x, world.y + 22, 24, 4, 0x333333)
        .setDepth(DEPTH.ROCKS + 0.35);
      const hpBarFg = this.scene.add.rectangle(world.x - 12, world.y + 22, 24, 4, 0x00cc44)
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.ROCKS + 0.4);

      visual = { image, rangeCircle, hpBarBg, hpBarFg };
      this.turretVisuals.set(rock.id, visual);
    }

    const ratio = Phaser.Math.Clamp(rock.hp / Math.max(1, rock.maxHp), 0, 1);
    visual.image.setPosition(world.x, world.y).setRotation(rock.angle);
    visual.rangeCircle.clear();
    visual.rangeCircle.lineStyle(1.4, rock.ownerColor, 0.48);
    visual.rangeCircle.strokeCircle(world.x, world.y, (UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig).placeable.targetRange);

    visual.hpBarBg.setPosition(world.x, world.y + 22).setVisible(ratio < 1);
    visual.hpBarFg
      .setPosition(world.x - 12, world.y + 22)
      .setSize(24 * ratio, 4)
      .setFillStyle(ratio > 0.5 ? 0x00cc44 : ratio > 0.25 ? 0xffcc00 : 0xff3300)
      .setVisible(ratio < 1);
  }

  destroyTurretVisual(id: number): void {
    const visual = this.turretVisuals.get(id);
    if (!visual) return;
    visual.image.destroy();
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

  spawnTurretDeathCloud(rock: SyncedPlaceableRock): void {
    if (rock.kind !== 'turret') return;
    const turretCfg = UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig;
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

  gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2,
      y: ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  private ensureRuntimeRockSlot(rock: SyncedPlaceableRock): void {
    if (!this.ctx.currentLayout || !this.ctx.arenaResult) return;
    this.ctx.currentLayout.rocks[rock.id] = { gridX: rock.gridX, gridY: rock.gridY };
    while (this.ctx.arenaResult.rockObjects.length <= rock.id) {
      this.ctx.arenaResult.rockObjects.push(null);
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

  private refreshStaticShadows(): void {
    this.shadowSystem?.rebuildArenaStaticShadows(
      this.ctx.currentLayout,
      this.ctx.arenaResult,
      this.ctx.placementSystem?.getAllRuntimeRocks() ?? [],
    );
  }
}
