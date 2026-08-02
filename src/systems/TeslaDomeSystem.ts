import * as Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { TeslaDomeWeaponFireConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { LoadoutSlot, SyncedTeslaDome, SyncedTeslaDomeTarget } from '../types';
import type { CombatSystem } from './CombatSystem';
import type { EnergyShieldSystem } from './EnergyShieldSystem';
import type { ResourceSystem } from './ResourceSystem';

interface ActiveTeslaDome {
  ownerId: string;
  sourceSlot: LoadoutSlot;
  damageMultiplier: number;
  x: number;
  y: number;
  skipRockIndex?: number;
  color: number;
  config: WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
  lastRefreshAt: number;
  lastDrainAt: number;
  lastTickAt: number;
  activatedAt: number;
  chargeStacks: number;
}

interface TeslaConstructionSource {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  color: number;
  /** Laufzeitboni des Besitzers und lokale Turmbuffs; globale Coop-Werte folgen im CombatSystem. */
  damageMultiplier?: number;
  config: WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
}

interface ActiveConstructionTeslaDome extends ActiveTeslaDome {
  sourceId: number;
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

interface TeslaEnemyTarget {
  id: string;
  x: number;
  y: number;
}

interface TeslaBaseTarget {
  id: string;
  faction: 'friendly' | 'hostile';
  getHp(): number;
  getNearestSurfacePoint(x: number, y: number): { x: number; y: number; distance: number } | null;
}

interface TeslaDomeTarget extends SyncedTeslaDomeTarget {
  /** Host-only identity for applying a tick to the same base that was selected. */
  targetId?: string;
}

type LineOfSightChecker = (sx: number, sy: number, ex: number, ey: number, skipRockIndex?: number) => boolean;
type RockTargetProvider = () => readonly TeslaRockTarget[];
type RockDamageHandler = (index: number, damage: number, ownerId: string) => void;
type TrainTargetProvider = () => readonly { x: number; y: number }[];
type TrainDamageHandler = (damage: number, ownerId: string) => void;
type TurretTargetProvider = () => readonly TeslaTurretTarget[];
type TurretDamageHandler = (id: number, damage: number, ownerId: string) => void;
type EnemyTargetProvider = () => readonly TeslaEnemyTarget[];
type BaseTargetProvider = () => readonly TeslaBaseTarget[];
type BaseDamageHandler = (baseId: string, damage: number, ownerId: string, sourceSlot?: LoadoutSlot) => void;
type TeslaConstructionSourceProvider = () => readonly TeslaConstructionSource[];

export class TeslaDomeSystem {
  private readonly activeDomes = new Map<string, ActiveTeslaDome>();
  private readonly activeConstructionDomes = new Map<number, ActiveConstructionTeslaDome>();

  private lineOfSightChecker: LineOfSightChecker | null = null;
  private rockTargetProvider: RockTargetProvider | null = null;
  private rockDamageHandler: RockDamageHandler | null = null;
  private trainTargetProvider: TrainTargetProvider | null = null;
  private trainDamageHandler: TrainDamageHandler | null = null;
  private turretTargetProvider: TurretTargetProvider | null = null;
  private turretDamageHandler: TurretDamageHandler | null = null;
  private enemyTargetProvider: EnemyTargetProvider | null = null;
  private baseTargetProvider: BaseTargetProvider | null = null;
  private baseDamageHandler: BaseDamageHandler | null = null;
  private energyShieldSystem: EnergyShieldSystem | null = null;
  private constructionSourceProvider: TeslaConstructionSourceProvider | null = null;

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

  setEnemyTargetProvider(provider: EnemyTargetProvider | null): void {
    this.enemyTargetProvider = provider;
  }

  setBaseCallbacks(provider: BaseTargetProvider | null, damageHandler: BaseDamageHandler | null): void {
    this.baseTargetProvider = provider;
    this.baseDamageHandler = damageHandler;
  }

  setEnergyShieldSystem(system: EnergyShieldSystem | null): void {
    this.energyShieldSystem = system;
  }

  setConstructionSourceProvider(provider: TeslaConstructionSourceProvider | null): void {
    this.constructionSourceProvider = provider;
    if (!provider) this.activeConstructionDomes.clear();
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
      sourceSlot: 'weapon2',
      damageMultiplier: 1,
      x,
      y,
      color,
      config,
      lastRefreshAt: now,
      lastDrainAt: now,
      lastTickAt: now,
      activatedAt: now,
      chargeStacks: 0,
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

      const chargeInterval = dome.config.fire.chargeIntervalMs ?? 0;
      const maxChargeStacks = Math.max(0, Math.floor(dome.config.fire.maxChargeStacks ?? 0));
      dome.chargeStacks = chargeInterval > 0
        ? Math.min(maxChargeStacks, Math.floor((now - dome.activatedAt) / chargeInterval))
        : 0;

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
        radius: this.getEffectiveRadius(dome),
        color: dome.color,
        alpha: maxChargeStacks > 0 ? 0.7 + dome.chargeStacks * 0.1 : 1,
        targets: targets.map(target => ({
          x: Math.round(target.x),
          y: Math.round(target.y),
          type: target.type,
        })),
      });
    }

    synced.push(...this.hostUpdateConstructionDomes(now));
    return synced;
  }

  private hostUpdateConstructionDomes(now: number): SyncedTeslaDome[] {
    const synced: SyncedTeslaDome[] = [];
    const activeSourceIds = new Set<number>();

    for (const source of this.constructionSourceProvider?.() ?? []) {
      activeSourceIds.add(source.id);
      const domeState: ActiveTeslaDome = {
        ownerId: source.ownerId,
        sourceSlot: 'utility',
        damageMultiplier: Math.max(0, source.damageMultiplier ?? 1),
        x: source.x,
        y: source.y,
        skipRockIndex: source.id,
        color: source.color,
        config: source.config,
        lastRefreshAt: now,
        lastDrainAt: now,
        lastTickAt: now,
        activatedAt: now,
        chargeStacks: 0,
      };
      const targets = this.collectTargets(domeState);

      // Ein Tesla-Turm ist nur bei einem erreichbaren Gegner aktiv. Dadurch bleiben
      // Kuppelvisual und Netzwerk-Snapshot im Ruhezustand vollständig aus.
      if (targets.length === 0) {
        this.activeConstructionDomes.delete(source.id);
        continue;
      }

      let dome = this.activeConstructionDomes.get(source.id);
      if (!dome) {
        dome = {
          ...domeState,
          sourceId: source.id,
        };
        this.activeConstructionDomes.set(source.id, dome);
      } else {
        dome.ownerId = source.ownerId;
        dome.x = source.x;
        dome.y = source.y;
        dome.color = source.color;
        dome.config = source.config;
        dome.damageMultiplier = Math.max(0, source.damageMultiplier ?? 1);
      }

      const tickInterval = Math.max(1, dome.config.fire.tickInterval);
      while (now - dome.lastTickAt >= tickInterval) {
        dome.lastTickAt += tickInterval;
        this.applyTickDamage(dome, targets);
      }

      synced.push({
        ownerId: constructionVisualId(source.id),
        x: Math.round(source.x),
        y: Math.round(source.y),
        radius: this.getEffectiveRadius(dome),
        color: source.color,
        alpha: 1,
        weaponId: source.config.id,
        targets: targets.map(target => ({
          x: Math.round(target.x),
          y: Math.round(target.y),
          type: target.type,
        })),
      });
    }

    for (const sourceId of [...this.activeConstructionDomes.keys()]) {
      if (!activeSourceIds.has(sourceId)) this.activeConstructionDomes.delete(sourceId);
    }

    return synced;
  }

  private collectTargets(dome: ActiveTeslaDome): TeslaDomeTarget[] {
    const targets: TeslaDomeTarget[] = [];
    const fire = dome.config.fire;
    const radius = Math.max(1, this.getEffectiveRadius(dome));

    if (fire.targetTypes.includes('players')) {
      for (const player of this.playerManager.getAllPlayers()) {
        if (player.id === dome.ownerId) continue;
        if (!player.sprite.active) continue;
        if (!this.combatSystem.isAlive(player.id)) continue;
        if (this.combatSystem.isBurrowed(player.id)) continue;
        if (!this.combatSystem.canDamageTarget(dome.ownerId, player.id)) continue;
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, player.sprite.x, player.sprite.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, player.sprite.x, player.sprite.y, dome.skipRockIndex)) continue;
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
        if (!this.combatSystem.canDamageTarget(dome.ownerId, turret.ownerId)) continue;
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, turret.x, turret.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, turret.x, turret.y, turret.id)) continue;
        targets.push({ x: turret.x, y: turret.y, type: 'turrets' });
      }
    }

    if (fire.targetTypes.includes('enemies') && this.enemyTargetProvider) {
      for (const enemy of this.enemyTargetProvider()) {
        if (!this.combatSystem.canDamageTarget(dome.ownerId, enemy.id)) continue;
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, enemy.x, enemy.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, enemy.x, enemy.y, dome.skipRockIndex)) continue;
        targets.push({ x: enemy.x, y: enemy.y, type: 'enemies' });
      }
    }

    if (fire.targetTypes.includes('bases') && this.baseTargetProvider) {
      for (const base of this.baseTargetProvider()) {
        // The provider is intentionally filtered again here: a future caller must not be able
        // to make a Tesla dome damage friendly bases by accidentally returning all structures.
        if (base.faction !== 'hostile' || base.getHp() <= 0) continue;
        const surface = base.getNearestSurfacePoint(dome.x, dome.y);
        if (!surface || surface.distance > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, surface.x, surface.y, dome.skipRockIndex)) continue;
        targets.push({ x: surface.x, y: surface.y, type: 'bases', targetId: base.id });
      }
    }

    if (fire.targetTypes.includes('train') && this.trainTargetProvider) {
      for (const segment of this.trainTargetProvider()) {
        const dist = Phaser.Math.Distance.Between(dome.x, dome.y, segment.x, segment.y);
        if (dist > radius) continue;
        if (!this.hasLineOfSight(fire, dome.x, dome.y, segment.x, segment.y, dome.skipRockIndex)) continue;
        targets.push({ x: segment.x, y: segment.y, type: 'train' });
        break;
      }
    }

    return targets;
  }

  private applyTickDamage(dome: ActiveTeslaDome, targets: TeslaDomeTarget[]): void {
    const damage = dome.config.fire.damagePerTick
      * (1 + dome.chargeStacks * (dome.config.fire.damageBonusPerCharge ?? 0));
    const resolvedDamage = damage * dome.damageMultiplier;
    const playerTargets = targets.filter(target => target.type === 'players');
    const enemyTargets = targets.filter(target => target.type === 'enemies');
    const rockTargets = targets.filter(target => target.type === 'rocks');
    const baseTargets = targets.filter(target => target.type === 'bases');
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
          damage: resolvedDamage,
          sourceX: dome.x,
          sourceY: dome.y,
          now: Date.now(),
        })) {
          continue;
        }
        this.combatSystem.applyDamage(player.id, resolvedDamage, false, dome.ownerId, dome.config.displayName, {
          sourceX: dome.x,
          sourceY: dome.y,
        }, { damageKind: 'chain', sourceSlot: dome.sourceSlot, allowCritical: true });
      }
    }

    if (enemyTargets.length > 0 && this.enemyTargetProvider) {
      for (const enemy of this.enemyTargetProvider()) {
        if (!enemyTargets.some(target => target.x === enemy.x && target.y === enemy.y)) continue;
        this.combatSystem.applyDamage(enemy.id, resolvedDamage, false, dome.ownerId, dome.config.displayName, {
          sourceX: dome.x,
          sourceY: dome.y,
        }, { damageKind: 'chain', sourceSlot: dome.sourceSlot, allowCritical: true });
      }
    }

    if (baseTargets.length > 0 && this.baseTargetProvider && this.baseDamageHandler) {
      for (const base of this.baseTargetProvider()) {
        if (base.faction !== 'hostile' || base.getHp() <= 0) continue;
        if (!baseTargets.some(target => target.targetId === base.id)) continue;
        // Bases use the ordinary Tesla tick. In particular, rockDamageMult must not bleed
        // into this target class; the central base path applies Coop modifiers afterwards.
        this.baseDamageHandler(base.id, resolvedDamage, dome.ownerId, dome.sourceSlot);
      }
    }

    const rockDamage = resolvedDamage * (dome.config.rockDamageMult ?? 1);
    if (rockDamage > 0 && rockTargets.length > 0 && this.rockTargetProvider && this.rockDamageHandler) {
      for (const rock of this.rockTargetProvider()) {
        if (!rockTargets.some(target => target.x === rock.x && target.y === rock.y)) continue;
        this.rockDamageHandler(rock.index, rockDamage, dome.ownerId);
      }
    }

    const turretTargets = targets.filter(target => target.type === 'turrets');
    const turretDamage = resolvedDamage * (dome.config.rockDamageMult ?? 1);
    if (turretDamage > 0 && turretTargets.length > 0 && this.turretTargetProvider && this.turretDamageHandler) {
      for (const turret of this.turretTargetProvider()) {
        if (!this.combatSystem.canDamageTarget(dome.ownerId, turret.ownerId)) continue;
        if (!turretTargets.some(target => target.x === turret.x && target.y === turret.y)) continue;
        this.turretDamageHandler(turret.id, turretDamage, dome.ownerId);
      }
    }

    const trainDamage = resolvedDamage * (dome.config.trainDamageMult ?? 1);
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

  private getEffectiveRadius(dome: ActiveTeslaDome): number {
    return dome.config.fire.radius
      * (1 + dome.chargeStacks * (dome.config.fire.radiusBonusPerCharge ?? 0));
  }
}

function constructionVisualId(sourceId: number): string {
  return `tesla-turret:${sourceId}`;
}
