import * as Phaser from 'phaser';
import { PLAYER_SIZE } from '../config';
import {
  getCoopDefenseEnemyConfig,
  type CoopDefenseEnemyTranslocatorConfig,
} from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { StinkCloudSystem } from '../effects/StinkCloudSystem';
import {
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
  type HealingAuraWeaponFireConfig,
  type StinkCloudUtilityConfig,
  type TeslaDomeWeaponFireConfig,
  type TranslocatorUtilityConfig,
  type WeaponConfig,
} from '../loadout/LoadoutConfig';
import { bridge } from '../network/bridge';
import type { CombatSystem } from './CombatSystem';
import type { EnergyShieldSystem } from './EnergyShieldSystem';

interface EnemyTeleportState {
  nextReadyAt: number;
  puckId?: number;
  teleportAt?: number;
}

/** Host-seitige, dauerhaft aktive Spezialfaehigkeiten der Coop-Gegner. */
export class CoopDefenseEnemyAbilitySystem {
  private readonly lastHealingTickAt = new Map<string, number>();
  private readonly lastMiniDomeTickAt = new Map<string, number>();
  private readonly teleportStates = new Map<string, EnemyTeleportState>();
  private readonly activeStinkAuraEnemyIds = new Set<string>();

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly playerManager: PlayerManager,
    private readonly projectileManager: ProjectileManager,
    private readonly combatSystem: CombatSystem,
    private readonly energyShieldSystem: EnergyShieldSystem | null,
    private readonly stinkCloudSystem: StinkCloudSystem,
  ) {}

  hostUpdate(now: number): void {
    const activeEnemyIds = new Set<string>();

    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (!enemy.sprite.active || enemy.getHp() <= 0) continue;
      activeEnemyIds.add(enemy.id);

      const healingAura = this.getWeaponConfig(enemy, 'HEALING_AURA');
      if (healingAura?.fire.type === 'healing_aura') {
        this.updateHealingAura(enemy, healingAura.fire, now);
      }

      const miniDome = this.getWeaponConfig(enemy, 'MINI_TESLA_DOME');
      if (miniDome?.fire.type === 'tesla_dome') {
        this.updateMiniDome(enemy, miniDome, miniDome.fire, now);
      }

      const stinkAura = getCoopDefenseEnemyConfig(enemy.kind).stinkAura;
      if (stinkAura && !this.activeStinkAuraEnemyIds.has(enemy.id)) {
        this.activateStinkAura(enemy, stinkAura.utilityId);
      }

      const translocator = getCoopDefenseEnemyConfig(enemy.kind).translocator;
      if (translocator) this.updateTranslocator(enemy, translocator, now);
    }

    this.pruneInactiveEnemies(activeEnemyIds);
  }

  clear(): void {
    for (const state of this.teleportStates.values()) {
      if (state.puckId !== undefined) this.projectileManager.destroyProjectile(state.puckId);
    }
    this.lastHealingTickAt.clear();
    this.lastMiniDomeTickAt.clear();
    this.teleportStates.clear();
    this.activeStinkAuraEnemyIds.clear();
  }

  private activateStinkAura(enemy: EnemyEntity, utilityId: string): void {
    const utility = UTILITY_CONFIGS[utilityId as keyof typeof UTILITY_CONFIGS] as StinkCloudUtilityConfig | undefined;
    if (!utility || utility.type !== 'stinkcloud') return;

    this.stinkCloudSystem.hostActivate(
      enemy.id,
      utility.cloudRadius,
      utility.continuous ? Number.POSITIVE_INFINITY : utility.cloudDuration,
      utility.cloudDamagePerTick,
      utility.cloudTickInterval,
      utility.rockDamageMult ?? 0,
      utility.trainDamageMult ?? 0,
      utility.afterCloudDurationMs ?? 0,
      utility.afterCloudRadiusFactor ?? 0,
      utility.afterCloudDamageFactor ?? 0,
    );
    this.activeStinkAuraEnemyIds.add(enemy.id);
  }

  private updateHealingAura(enemy: EnemyEntity, fire: HealingAuraWeaponFireConfig, now: number): void {
    const tickCount = this.consumeTicks(this.lastHealingTickAt, enemy.id, now, fire.tickInterval);
    if (tickCount <= 0) return;
    const healing = fire.healPerTick * tickCount;
    const radiusSq = fire.radius * fire.radius;

    for (const target of this.enemyManager.getAllEnemies()) {
      if (target.faction !== enemy.faction) continue;
      if (target === enemy || !target.sprite.active || target.getHp() <= 0 || target.getHp() >= target.getMaxHp()) continue;
      const distanceSq = Phaser.Math.Distance.Squared(enemy.sprite.x, enemy.sprite.y, target.sprite.x, target.sprite.y);
      if (distanceSq > radiusSq) continue;
      target.setHp(Math.min(target.getMaxHp(), target.getHp() + healing));
    }
  }

  private updateMiniDome(
    enemy: EnemyEntity,
    weapon: WeaponConfig,
    fire: TeslaDomeWeaponFireConfig,
    now: number,
  ): void {
    const tickCount = this.consumeTicks(this.lastMiniDomeTickAt, enemy.id, now, fire.tickInterval);
    if (tickCount <= 0) return;
    const damage = fire.damagePerTick * tickCount;

    if (enemy.faction === 'allied') {
      for (const target of this.enemyManager.getHostileEnemies()) {
        if (!target.sprite.active || !this.combatSystem.isAlive(target.id)) continue;
        if (!this.combatSystem.canDamageTarget(enemy.id, target.id)) continue;
        if (Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, target.sprite.x, target.sprite.y) > fire.radius) continue;
        if (fire.requireLineOfSight && !this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, target.sprite.x, target.sprite.y)) continue;
        this.combatSystem.applyDamage(target.id, damage, false, enemy.id, weapon.displayName, {
          sourceX: enemy.sprite.x,
          sourceY: enemy.sprite.y,
        });
      }
      return;
    }

    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.sprite.active || !this.combatSystem.isAlive(player.id)) continue;
      if (this.combatSystem.isBurrowed(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(enemy.id, player.id)) continue;
      if (Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y) > fire.radius) continue;
      if (fire.requireLineOfSight
        && !this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y)) continue;
      if (this.energyShieldSystem?.tryBlockDamage({
        targetId: player.id,
        category: 'tesla',
        damage,
        sourceX: enemy.sprite.x,
        sourceY: enemy.sprite.y,
        now,
      })) continue;

      this.combatSystem.applyDamage(player.id, damage, false, enemy.id, weapon.displayName, {
        sourceX: enemy.sprite.x,
        sourceY: enemy.sprite.y,
      });
    }
  }

  private updateTranslocator(
    enemy: EnemyEntity,
    ability: CoopDefenseEnemyTranslocatorConfig,
    now: number,
  ): void {
    const state = this.teleportStates.get(enemy.id) ?? { nextReadyAt: 0 };
    this.teleportStates.set(enemy.id, state);

    if (state.puckId !== undefined) {
      if (now < (state.teleportAt ?? Number.POSITIVE_INFINITY)) return;
      const puck = this.projectileManager.getProjectileById(state.puckId);
      if (puck) this.teleportEnemyToPuck(enemy, puck.id, puck.sprite.x, puck.sprite.y, now, ability, state);
      else this.resetTeleportState(state, now + ability.cooldownMs);
      return;
    }

    if (now < state.nextReadyAt) return;
    const target = this.findTranslocatorTarget(enemy, ability);
    if (!target) return;

    const utility = UTILITY_CONFIGS[ability.utilityId] as TranslocatorUtilityConfig;
    const angle = Phaser.Math.Angle.Between(enemy.sprite.x, enemy.sprite.y, target.x, target.y);
    const spawnDistance = enemy.getCollisionRadius() + (utility.projectileSize ?? 16) * 0.5;
    const spawnX = enemy.sprite.x + Math.cos(angle) * spawnDistance;
    const spawnY = enemy.sprite.y + Math.sin(angle) * spawnDistance;
    const color = getCoopDefenseEnemyConfig(enemy.kind).color ?? 0x9b32ff;
    const plannedFlightSeconds = Math.max(0.1, ability.flightTimeMs / 1000);
    const throwSpeed = Phaser.Math.Clamp(target.distance / plannedFlightSeconds, 16, utility.projectileSpeed);

    state.puckId = this.projectileManager.spawnProjectile(spawnX, spawnY, angle, enemy.id, {
      speed: throwSpeed,
      size: utility.projectileSize,
      damage: 0,
      color,
      ownerColor: color,
      lifetime: ability.flightTimeMs + 5000,
      maxBounces: utility.maxBounces,
      isGrenade: true,
      adrenalinGain: 0,
      weaponName: utility.displayName,
      projectileStyle: utility.projectileStyle,
      frictionDelayMs: utility.frictionDelayMs,
      airFrictionDecayPerSec: utility.airFrictionDecayPerSec,
      bounceFrictionMultiplier: utility.bounceFrictionMultiplier,
      stopSpeedThreshold: utility.stopSpeedThreshold,
    });
    state.teleportAt = now + ability.flightTimeMs;
  }

  private findTranslocatorTarget(
    enemy: EnemyEntity,
    ability: CoopDefenseEnemyTranslocatorConfig,
  ): { x: number; y: number; distance: number } | null {
    let best: { x: number; y: number; distance: number } | null = null;

    if (enemy.faction === 'allied') {
      for (const target of this.enemyManager.getHostileEnemies()) {
        if (!target.sprite.active || !this.combatSystem.isAlive(target.id)) continue;
        const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, target.sprite.x, target.sprite.y);
        if (distance < ability.minRange || distance > ability.maxRange || (best && distance >= best.distance)) continue;
        if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, target.sprite.x, target.sprite.y)) continue;
        best = { x: target.sprite.x, y: target.sprite.y, distance };
      }
      return best;
    }

    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.sprite.active || !this.combatSystem.isAlive(player.id) || this.combatSystem.isBurrowed(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(enemy.id, player.id)) continue;
      const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y);
      if (distance < ability.minRange || distance > ability.maxRange || (best && distance >= best.distance)) continue;
      if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y)) continue;
      best = { x: player.sprite.x, y: player.sprite.y, distance };
    }

    return best;
  }

  private teleportEnemyToPuck(
    enemy: EnemyEntity,
    puckId: number,
    targetX: number,
    targetY: number,
    now: number,
    ability: CoopDefenseEnemyTranslocatorConfig,
    state: EnemyTeleportState,
  ): void {
    const color = getCoopDefenseEnemyConfig(enemy.kind).color ?? 0x9b32ff;
    bridge.broadcastTranslocatorFlash(enemy.sprite.x, enemy.sprite.y, color, 'start');
    this.projectileManager.destroyProjectile(puckId);
    enemy.setPosition(targetX, targetY);
    bridge.broadcastTranslocatorFlash(targetX, targetY, color, 'end');

    const telefragRadius = enemy.getCollisionRadius() + PLAYER_SIZE * 0.5;
    if (enemy.faction === 'allied') {
      for (const target of this.enemyManager.getHostileEnemies()) {
        if (!target.sprite.active || !this.combatSystem.isAlive(target.id)) continue;
        if (Phaser.Math.Distance.Between(targetX, targetY, target.sprite.x, target.sprite.y) > telefragRadius + target.getCollisionRadius()) continue;
        this.combatSystem.applyDamage(target.id, 9999, true, enemy.id, 'Telefrag', {
          sourceX: targetX,
          sourceY: targetY,
        });
      }
      this.resetTeleportState(state, now + ability.cooldownMs);
      return;
    }
    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.sprite.active || !this.combatSystem.isAlive(player.id)) continue;
      if (Phaser.Math.Distance.Between(targetX, targetY, player.sprite.x, player.sprite.y) > telefragRadius) continue;
      this.combatSystem.applyDamage(player.id, 9999, true, enemy.id, 'Telefrag', {
        sourceX: targetX,
        sourceY: targetY,
      });
    }

    this.resetTeleportState(state, now + ability.cooldownMs);
  }

  private consumeTicks(
    ticks: Map<string, number>,
    enemyId: string,
    now: number,
    intervalMs: number,
  ): number {
    const interval = Math.max(1, intervalMs);
    const lastTickAt = ticks.get(enemyId) ?? now;
    const tickCount = Math.min(10, Math.floor((now - lastTickAt) / interval));
    if (tickCount > 0) ticks.set(enemyId, lastTickAt + tickCount * interval);
    else if (!ticks.has(enemyId)) ticks.set(enemyId, now);
    return tickCount;
  }

  private getWeaponConfig(enemy: EnemyEntity, weaponId: string): WeaponConfig | null {
    const hasWeapon = getCoopDefenseEnemyConfig(enemy.kind).weapons.some(weapon => weapon.weaponId === weaponId);
    if (!hasWeapon) return null;
    return WEAPON_CONFIGS[weaponId as keyof typeof WEAPON_CONFIGS] ?? null;
  }

  private resetTeleportState(state: EnemyTeleportState, nextReadyAt: number): void {
    state.puckId = undefined;
    state.teleportAt = undefined;
    state.nextReadyAt = nextReadyAt;
  }

  private pruneInactiveEnemies(activeEnemyIds: ReadonlySet<string>): void {
    for (const enemyId of this.lastHealingTickAt.keys()) {
      if (!activeEnemyIds.has(enemyId)) this.lastHealingTickAt.delete(enemyId);
    }
    for (const enemyId of this.lastMiniDomeTickAt.keys()) {
      if (!activeEnemyIds.has(enemyId)) this.lastMiniDomeTickAt.delete(enemyId);
    }
    for (const [enemyId, state] of this.teleportStates) {
      if (activeEnemyIds.has(enemyId)) continue;
      if (state.puckId !== undefined) this.projectileManager.destroyProjectile(state.puckId);
      this.teleportStates.delete(enemyId);
    }
    for (const enemyId of this.activeStinkAuraEnemyIds) {
      if (!activeEnemyIds.has(enemyId)) this.activeStinkAuraEnemyIds.delete(enemyId);
    }
  }
}
