import * as Phaser from 'phaser';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import {
  UTILITY_CONFIGS,
  type FlamethrowerWeaponFireConfig,
  type MolotovUtilityConfig,
} from '../loadout/LoadoutConfig';
import type { BurnOnHitConfig, FireGrenadeEffect, TrackedProjectile } from '../types';
import type { FireSystem } from '../effects/FireSystem';
import { BURN_TICK_INTERVAL_MS } from '../config';
import type { ActiveBurnSource, CombatSystem } from './CombatSystem';

interface ResolvedFlameOwner {
  playerId: string;
  fire: FlamethrowerWeaponFireConfig;
  burn: BurnOnHitConfig;
}

interface RingRuntime extends ResolvedFlameOwner {
  x: number;
  y: number;
  radius: number;
  thickness: number;
  igniteProjectiles: boolean;
}

export type FlamethrowerBurrowResolver = (playerId: string) => boolean;
export type FlamethrowerFriendlyResolver = (firstPlayerId: string, secondPlayerId: string) => boolean;

/** Host-authoritative simulation for the Flamethrower's passive upgrade branches. */
export class FlamethrowerUpgradeSystem {
  private lastRingContactTick = -1;

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly enemyManager: EnemyManager,
    private readonly projectileManager: ProjectileManager,
    private readonly combatSystem: CombatSystem,
    private readonly loadoutManager: LoadoutManager,
    private readonly fireSystem: FireSystem,
    private readonly isBurrowed: FlamethrowerBurrowResolver,
    private readonly areFriendly: FlamethrowerFriendlyResolver,
    private readonly playKamikazeExplosion: (x: number, y: number, radius: number) => void,
  ) {}

  /** Must run before CombatSystem.update so a swept projectile is imbued before a same-frame hit. */
  prepareProjectileBurns(now: number): void {
    const rings = this.getActiveRings();
    for (const projectile of this.projectileManager.getActiveProjectiles()) {
      if (!projectile.canReceiveFireImbue || projectile.pendingDestroy) continue;
      if (projectile.isGrenade || projectile.isFlame) continue;
      const fromX = projectile.lastX;
      const fromY = projectile.lastY;
      const toX = projectile.sprite.x;
      const toY = projectile.sprite.y;
      if (Math.abs(toX - fromX) + Math.abs(toY - fromY) <= 0.01) continue;

      for (const igniter of this.fireSystem.collectProjectileIgnitersAlongSegment(fromX, fromY, toX, toY, now)) {
        if (!this.areFriendly(igniter.ownerId, projectile.ownerId)) continue;
        this.applyStrongestSupplementalBurn(projectile, igniter.burn);
      }

      for (const ring of rings) {
        if (!ring.igniteProjectiles || !this.areFriendly(ring.playerId, projectile.ownerId)) continue;
        if (!this.segmentTouchesRing(fromX, fromY, toX, toY, ring)) continue;
        this.applyStrongestSupplementalBurn(projectile, ring.burn);
      }
    }
  }

  /** Flammenring-Kontakte; alle Boden-Kontakte verarbeitet das gemeinsame FireSystem. */
  hostUpdate(now: number): void {
    const contactTick = Math.floor(now / BURN_TICK_INTERVAL_MS);
    if (contactTick === this.lastRingContactTick) return;
    this.lastRingContactTick = contactTick;

    const rings = this.getActiveRings();
    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (!this.combatSystem.isAlive(enemy.id)) continue;
      for (const ring of this.findRingContacts(enemy, rings)) {
        this.combatSystem.applyBurnHit(
          enemy.id,
          ring.playerId,
          ring.burn.durationMs,
          ring.burn.damagePerTick,
          `flame-ring:${ring.playerId}`,
          'Flammenring',
        );
      }
    }
  }

  handleEnemyDeath(x: number, y: number, burnSources: readonly ActiveBurnSource[], now = Date.now()): void {
    const handledOwners = new Set<string>();
    for (const source of burnSources) {
      if (handledOwners.has(source.attackerId)) continue;
      const owner = this.getEquippedFlameOwner(source.attackerId);
      if (!owner || (owner.fire.burningGround?.durationMs ?? 0) <= 0) continue;
      handledOwners.add(owner.playerId);
      this.refreshGroundAt(x, y, owner, now);
    }
  }

  handleNaturalFlameExpiry(projectile: TrackedProjectile, x: number, y: number, now = Date.now()): void {
    const owner = this.getEquippedFlameOwner(projectile.ownerId);
    if (!owner || (owner.fire.burningGround?.createOnFlameExpiry ?? 0) <= 0) return;
    if ((owner.fire.burningGround?.durationMs ?? 0) <= 0) return;
    this.refreshGroundAt(x, y, owner, now);
  }

  handlePlayerDeath(playerId: string, x: number, y: number): void {
    const owner = this.getEquippedFlameOwner(playerId);
    if (!owner || (owner.fire.kamikaze?.enabled ?? 0) <= 0) return;
    const base = UTILITY_CONFIGS.MOLOTOV_GRENADE as MolotovUtilityConfig;
    const inherit = (owner.fire.kamikaze?.inheritMolotovBonuses ?? 0) > 0;
    const molotov = inherit
      ? this.loadoutManager.resolveUtilityConfig(playerId, base) as MolotovUtilityConfig
      : base;
    const effect: FireGrenadeEffect = {
      type: 'fire',
      radius: molotov.fireRadius,
      damagePerTick: molotov.fireDamagePerTick,
      lingerDuration: molotov.fireLingerDuration,
      burnDurationMs: molotov.fireBurnDurationMs,
      burnDamagePerTick: molotov.fireBurnDamagePerTick,
      allowTeamDamage: molotov.allowTeamDamage,
      rockDamageMult: molotov.rockDamageMult,
      trainDamageMult: molotov.trainDamageMult,
      weaponName: 'Kamikaze-Napalm',
    };
    this.fireSystem.hostCreateZone(x, y, effect, playerId);
    this.playKamikazeExplosion(x, y, effect.radius);
  }

  getActiveRingRadius(playerId: string): number | undefined {
    return this.getActiveRings().find(ring => ring.playerId === playerId)?.radius;
  }

  clear(): void {
    this.lastRingContactTick = -1;
  }

  private getEquippedFlameOwner(playerId: string): ResolvedFlameOwner | null {
    const weapon = this.loadoutManager.getEquippedWeaponConfig(playerId, 'weapon2');
    if (!weapon || weapon.id !== 'FLAMETHROWER' || weapon.fire.type !== 'flamethrower') return null;
    return {
      playerId,
      fire: weapon.fire,
      burn: {
        durationMs: weapon.fire.burnDurationMs,
        damagePerTick: weapon.fire.burnDamagePerTick,
      },
    };
  }

  private getActiveRings(): RingRuntime[] {
    const rings: RingRuntime[] = [];
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.combatSystem.isAlive(player.id) || this.isBurrowed(player.id)) continue;
      const owner = this.getEquippedFlameOwner(player.id);
      if (!owner) continue;
      const radius = owner.fire.fireRing?.radius ?? 0;
      const thickness = owner.fire.fireRing?.thickness ?? 0;
      if (radius <= 0 || thickness <= 0) continue;
      rings.push({
        ...owner,
        x: player.sprite.x,
        y: player.sprite.y,
        radius,
        thickness,
        igniteProjectiles: (owner.fire.fireRing?.igniteProjectiles ?? 0) > 0,
      });
    }
    return rings;
  }

  private refreshGroundAt(x: number, y: number, owner: ResolvedFlameOwner, now: number): void {
    const durationMs = Math.max(0, owner.fire.burningGround?.durationMs ?? 0);
    if (durationMs <= 0) return;
    this.fireSystem.hostRefreshGroundCell(x, y, {
      sourceKey: `flamethrower:${owner.playerId}`,
      ownerId: owner.playerId,
      durationMs,
      burn: owner.burn,
      igniteProjectiles: (owner.fire.burningGround?.igniteProjectiles ?? 0) > 0,
      weaponName: 'Brennender Boden',
    }, now);
  }

  private findRingContacts(enemy: EnemyEntity, rings: readonly RingRuntime[]): RingRuntime[] {
    const contacts: RingRuntime[] = [];
    const enemyRadius = enemy.getCollisionRadius();
    for (const ring of rings) {
      const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, ring.x, ring.y);
      if (Math.abs(distance - ring.radius) > ring.thickness * 0.5 + enemyRadius) continue;
      contacts.push(ring);
    }
    return contacts.sort((left, right) => left.playerId.localeCompare(right.playerId));
  }

  private segmentTouchesRing(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    ring: RingRuntime,
  ): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq <= 0
      ? 0
      : Phaser.Math.Clamp(((ring.x - fromX) * dx + (ring.y - fromY) * dy) / lengthSq, 0, 1);
    const nearestX = fromX + dx * t;
    const nearestY = fromY + dy * t;
    const minDistance = Phaser.Math.Distance.Between(nearestX, nearestY, ring.x, ring.y);
    const maxEndpointDistance = Math.max(
      Phaser.Math.Distance.Between(fromX, fromY, ring.x, ring.y),
      Phaser.Math.Distance.Between(toX, toY, ring.x, ring.y),
    );
    const halfThickness = ring.thickness * 0.5;
    return minDistance <= ring.radius + halfThickness
      && maxEndpointDistance >= Math.max(0, ring.radius - halfThickness);
  }

  private applyStrongestSupplementalBurn(projectile: TrackedProjectile, burn: BurnOnHitConfig): void {
    if (!projectile.supplementalBurnOnHit || this.burnDps(burn) > this.burnDps(projectile.supplementalBurnOnHit)) {
      projectile.supplementalBurnOnHit = { ...burn };
    }
  }

  private burnDps(burn: BurnOnHitConfig): number {
    return burn.damagePerTick * 1000 / BURN_TICK_INTERVAL_MS;
  }
}
