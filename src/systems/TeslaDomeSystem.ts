import Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { TeslaDomeWeaponFireConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { SyncedTeslaDome, SyncedTeslaDomeTarget } from '../types';
import type { CombatSystem } from './CombatSystem';
import type { EnergyShieldSystem } from './EnergyShieldSystem';
import type { ResourceSystem } from './ResourceSystem';

interface ActiveTeslaDome {
  ownerId: string;
  x: number;
  y: number;
  color: number;
  config: WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
  lastRefreshAt: number;
  lastDrainAt: number;
  lastTickAt: number;
}

interface TeslaRockTarget {
  index: number;
  x: number;
  y: number;
}

interface TeslaTurretTarget {
  id: number;
  x: number;
  y: number;
  ownerId: string;
}

type LineOfSightChecker = (sx: number, sy: number, ex: number, ey: number, skipRockIndex?: number) => boolean;
type RockTargetProvider = () => readonly TeslaRockTarget[];
type RockDamageHandler = (index: number, damage: number, ownerId: string) => void;
type TrainTargetProvider = () => readonly { x: number; y: number }[];
type TrainDamageHandler = (damage: number, ownerId: string) => void;
type TurretTargetProvider = () => readonly TeslaTurretTarget[];
type TurretDamageHandler = (id: number, damage: number, ownerId: string) => void;

export class TeslaDomeSystem {
  private readonly activeDomes = new Map<string, ActiveTeslaDome>();

  private lineOfSightChecker: LineOfSightChecker | null = null;
  private rockTargetProvider: RockTargetProvider | null = null;
  private rockDamageHandler: RockDamageHandler | null = null;
  private trainTargetProvider: TrainTargetProvider | null = null;
  private trainDamageHandler: TrainDamageHandler | null = null;
  private turretTargetProvider: TurretTargetProvider | null = null;
  private turretDamageHandler: TurretDamageHandler | null = null;
  private energyShieldSystem: EnergyShieldSystem | null = null;

  private static readonly HOLD_GRACE_MS = 500;

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly combatSystem: CombatSystem,
    private readonly resourceSystem: ResourceSystem,
  ) {}

  setLineOfSightChecker(checker: LineOfSightChecker | null): void {
    this.lineOfSightChecker = checker;
  }

  setRockCallbacks(provider: RockTargetProvider | null, damageHandler: RockDamageHandler | null): void {
    this.rockTargetProvider = provider;
    this.rockDamageHandler = damageHandler;
  }

  setTrainCallbacks(provider: TrainTargetProvider | null, damageHandler: TrainDamageHandler | null): void {
    this.trainTargetProvider = provider;
    this.trainDamageHandler = damageHandler;
  }

  setTurretCallbacks(provider: TurretTargetProvider | null, damageHandler: TurretDamageHandler | null): void {
    this.turretTargetProvider = provider;
    this.turretDamageHandler = damageHandler;
  }

  setEnergyShieldSystem(system: EnergyShieldSystem | null): void {
    this.energyShieldSystem = system;
  }

  hostRefresh(
    ownerId: string,
    x: number,
    y: number,
    now: number,
    config: WeaponConfig & { fire: TeslaDomeWeaponFireConfig },
    color: number,
  ): void {
    const existing = this.activeDomes.get(ownerId);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.color = color;
      existing.config = config;
      existing.lastRefreshAt = now;
      return;
    }

    this.activeDomes.set(ownerId, {
      ownerId,
      x,
      y,
      color,
      config,
      lastRefreshAt: now,
      lastDrainAt: now,
      lastTickAt: now,
    });
  }

  hostDeactivateForPlayer(playerId: string): void {
    this.activeDomes.delete(playerId);
  }

  isActive(playerId: string): boolean {
    return this.activeDomes.has(playerId);
  }

  hostUpdate(now: number): SyncedTeslaDome[] {
    const synced: SyncedTeslaDome[] = [];

    for (const [ownerId, dome] of this.activeDomes) {
      if (now - dome.lastRefreshAt > TeslaDomeSystem.HOLD_GRACE_MS) {
        this.activeDomes.delete(ownerId);
        continue;
      }

      const owner = this.playerManager.getPlayer(ownerId);
      if (!owner || !owner.sprite.active || !this.combatSystem.isAlive(ownerId) || this.combatSystem.isBurrowed(ownerId)) {
        this.activeDomes.delete(ownerId);
        continue;
      }

      dome.x = owner.sprite.x;
      dome.y = owner.sprite.y;

      if (this.resourceSystem.getAdrenaline(ownerId) <= 0) {
        this.activeDomes.delete(ownerId);
        continue;
      }

      const elapsedDrainMs = Math.max(0, now - dome.lastDrainAt);
      if (elapsedDrainMs > 0) {
        const drainAmount = dome.config.fire.adrenalineDrainPerSecond * (elapsedDrainMs / 1000);
        if (drainAmount > 0) {
          this.resourceSystem.drainAdrenaline(ownerId, drainAmount);
        }
        dome.lastDrainAt = now;
      }

      if (this.resourceSystem.getAdrenaline(ownerId) <= 0) {
        this.activeDomes.delete(ownerId);
        continue;
      }

      const targets = this.collectTargets(dome);
      const tickInterval = Math.max(1, dome.config.fire.tickInterval);
      while (now - dome.lastTickAt >= tickInterval) {
        dome.lastTickAt += tickInterval;
        this.applyTickDamage(dome, targets);
      }

      synced.push({
        ownerId,
        x: Math.round(dome.x),
        y: Math.round(dome.y),
        radius: dome.config.fire.radius,
        color: dome.color,
        alpha: 1,
        targets: targets.map(target => ({
          x: Math.round(target.x),
          y: Math.round(target.y),
          type: target.type,
        })),
      });
    }

    return synced;
  }

  private collectTargets(dome: ActiveTeslaDome): SyncedTeslaDomeTarget[] {
    const targets: SyncedTeslaDomeTarget[] = [];
    const fire = dome.config.fire;
    const radius = Math.max(1, fire.radius);

    if (fire.targetTypes.includes('players')) {
      for (const player of this.playerManager.getAllPlayers()) {
        if (player.id === dome.ownerId) continue;
        if (!player.sprite.active) continue;
        if (!this.combatSystem.isAlive(player.id)) continue;
        if (this.combatSystem.isBurrowed(player.id)) continue;
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, player.sprite.x, player.sprite.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, player.sprite.x, player.sprite.y)) continue;
        targets.push({ x: player.sprite.x, y: player.sprite.y, type: 'players' });
      }
    }

    if (fire.targetTypes.includes('rocks') && this.rockTargetProvider) {
      for (const rock of this.rockTargetProvider()) {
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, rock.x, rock.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, rock.x, rock.y, rock.index)) continue;
        targets.push({ x: rock.x, y: rock.y, type: 'rocks' });
      }
    }

    if (fire.targetTypes.includes('turrets') && this.turretTargetProvider) {
      for (const turret of this.turretTargetProvider()) {
        if (turret.ownerId === dome.ownerId) continue;
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, turret.x, turret.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, turret.x, turret.y, turret.id)) continue;
        targets.push({ x: turret.x, y: turret.y, type: 'turrets' });
      }
    }

    if (fire.targetTypes.includes('train') && this.trainTargetProvider) {
      for (const segment of this.trainTargetProvider()) {
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, segment.x, segment.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, segment.x, segment.y)) continue;
        targets.push({ x: segment.x, y: segment.y, type: 'train' });
        break;
      }
    }

    return targets;
  }

  private applyTickDamage(dome: ActiveTeslaDome, targets: SyncedTeslaDomeTarget[]): void {
    const damage = dome.config.fire.damagePerTick;
    const playerTargets = targets.filter(target => target.type === 'players');
    const rockTargets = targets.filter(target => target.type === 'rocks');
    const hasTrainTarget = targets.some(target => target.type === 'train');

    for (const player of this.playerManager.getAllPlayers()) {
      if (player.id === dome.ownerId) continue;
      if (!player.sprite.active) continue;
      if (!this.combatSystem.isAlive(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(dome.ownerId, player.id)) continue;
      if (!this.combatSystem.isBurrowed(player.id) && playerTargets.some(target => target.x === player.sprite.x && target.y === player.sprite.y)) {
        if (this.energyShieldSystem?.tryBlockDamage({
          targetId: player.id,
          category: 'tesla',
          damage,
          sourceX: dome.x,
          sourceY: dome.y,
          now: Date.now(),
        })) {
          continue;
        }
        this.combatSystem.applyDamage(player.id, damage, false, dome.ownerId, dome.config.displayName, {
          sourceX: dome.x,
          sourceY: dome.y,
        });
      }
    }

    const rockDamage = damage * (dome.config.rockDamageMult ?? 1);
    if (rockDamage > 0 && rockTargets.length > 0 && this.rockTargetProvider && this.rockDamageHandler) {
      for (const rock of this.rockTargetProvider()) {
        if (!rockTargets.some(target => target.x === rock.x && target.y === rock.y)) continue;
        this.rockDamageHandler(rock.index, rockDamage, dome.ownerId);
      }
    }

    const turretTargets = targets.filter(target => target.type === 'turrets');
    const turretDamage = damage * (dome.config.rockDamageMult ?? 1);
    if (turretDamage > 0 && turretTargets.length > 0 && this.turretTargetProvider && this.turretDamageHandler) {
      for (const turret of this.turretTargetProvider()) {
        if (turret.ownerId === dome.ownerId) continue;
        if (!turretTargets.some(target => target.x === turret.x && target.y === turret.y)) continue;
        this.turretDamageHandler(turret.id, turretDamage, dome.ownerId);
      }
    }

    const trainDamage = damage * (dome.config.trainDamageMult ?? 1);
    if (trainDamage > 0 && hasTrainTarget && this.trainDamageHandler) {
      this.trainDamageHandler(trainDamage, dome.ownerId);
    }
  }

  private hasLineOfSight(
    fire: TeslaDomeWeaponFireConfig,
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    skipRockIndex?: number,
  ): boolean {
    if (!fire.requireLineOfSight) return true;
    if (!this.lineOfSightChecker) return true;
    return this.lineOfSightChecker(sx, sy, ex, ey, skipRockIndex);
  }
}
