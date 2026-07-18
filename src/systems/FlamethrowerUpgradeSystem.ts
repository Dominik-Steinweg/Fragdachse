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
import type { BurnOnHitConfig, FireChunkBurstConfig, FireChunkTarget, FireGrenadeEffect, GroundFireCellEffect, TrackedProjectile } from '../types';
import type { FireSystem } from '../effects/FireSystem';
import { BURN_TICK_INTERVAL_MS } from '../config';
import type { ActiveBurnSource, CombatSystem } from './CombatSystem';

interface ResolvedFlameOwner {
  playerId: string;
  fire: FlamethrowerWeaponFireConfig;
  burn: BurnOnHitConfig;
}

interface RingRuntime {
  playerId: string;
  burn: BurnOnHitConfig;
  x: number;
  y: number;
  radius: number;
  thickness: number;
  igniteProjectiles: boolean;
}

interface PendingFireChunkLanding {
  ownerId: string;
  target: FireChunkTarget;
  landsAt: number;
  effect: GroundFireCellEffect;
  sourceKey: string;
}

export type FlamethrowerBurrowResolver = (playerId: string) => boolean;
export type FlamethrowerFriendlyResolver = (firstPlayerId: string, secondPlayerId: string) => boolean;
export type FireUpgradeStatResolver = (playerId: string, stat: string, baseValue: number) => number;

/** Host-authoritative simulation for the Flamethrower's passive upgrade branches. */
export class FlamethrowerUpgradeSystem {
  private lastRingContactTick = -1;
  private readonly pendingChunkLandings: PendingFireChunkLanding[] = [];

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
    private readonly resolvePlayerStat: FireUpgradeStatResolver,
    private readonly playFireChunkBurst: (x: number, y: number, targets: readonly FireChunkTarget[], landsAt: number) => void,
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

      const generalBurnEnabled = this.resolvePlayerStat(
        projectile.ownerId,
        'player.fire.burningProjectiles.enabled',
        0,
      ) > 0;
      if (generalBurnEnabled) {
        const burn: BurnOnHitConfig = {
          durationMs: this.resolvePlayerStat(projectile.ownerId, 'player.fire.burningProjectiles.durationMs', 0),
          damagePerTick: this.resolvePlayerStat(projectile.ownerId, 'player.fire.burningProjectiles.damagePerTick', 0),
        };
        for (const fireOwner of this.fireSystem.collectGroundFireOwnersAlongSegment(fromX, fromY, toX, toY, now)) {
          if (!this.areFriendly(fireOwner.ownerId, projectile.ownerId)) continue;
          this.applyStrongestSupplementalBurn(projectile, burn);
          break;
        }
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
    this.updateFireballTrails(now);
    this.landPendingFireChunks(now);
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
          'fire_ring',
        );
      }
    }
  }

  handleEnemyDeath(x: number, y: number, burnSources: readonly ActiveBurnSource[], now = Date.now()): void {
    const handledOwners = new Set<string>();
    for (const source of burnSources) {
      if (handledOwners.has(source.attackerId)) continue;
      const ownerId = source.attackerId;
      const durationMs = Math.max(0, this.resolvePlayerStat(ownerId, 'player.fire.deathGround.durationMs', 0));
      if (durationMs <= 0) continue;
      handledOwners.add(ownerId);
      const effect: GroundFireCellEffect = {
        durationMs,
        burnDurationMs: Math.max(0, this.resolvePlayerStat(ownerId, 'player.fire.deathGround.burnDurationMs', 0)),
        burnDamagePerTick: Math.max(0, this.resolvePlayerStat(ownerId, 'player.fire.deathGround.burnDamagePerTick', 0)),
        weaponName: 'Brennender Boden',
      };
      this.refreshGenericGround(ownerId, x, y, effect, now, `death-ground:${ownerId}`);
      const count = Math.max(0, Math.floor(this.resolvePlayerStat(ownerId, 'player.fire.deathGround.burstCount', 0)));
      const radius = Math.max(0, this.resolvePlayerStat(ownerId, 'player.fire.deathGround.burstRadius', 0));
      if (count > 0 && radius > 0) {
        this.launchFireChunks(ownerId, x, y, {
          count,
          searchRadius: radius,
          flightMs: 320,
          igniteCenter: false,
          ...effect,
          weaponName: 'Brandexplosion',
        }, now, `death-fire-burst:${ownerId}`);
      }
    }
  }

  hostCreateFireChunkBurst(
    ownerId: string,
    x: number,
    y: number,
    burst: FireChunkBurstConfig,
    sourceKey: string,
    now = Date.now(),
  ): void {
    this.launchFireChunks(ownerId, x, y, burst, now, sourceKey);
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
      wildfire: inherit && (molotov.wildfireEnabled ?? 0) > 0 ? {
        speedMultiplier: molotov.wildfirePanicSpeedMultiplier ?? 1.5,
        trailDurationMs: molotov.wildfireTrailDurationMs ?? 2000,
        trailDamagePerTick: molotov.wildfireTrailDamagePerTick ?? 2,
      } : undefined,
    };
    this.fireSystem.hostCreateZone(x, y, effect, playerId);
    this.playKamikazeExplosion(x, y, effect.radius);
  }

  getActiveRingRadius(playerId: string): number | undefined {
    return this.getActiveRings().find(ring => ring.playerId === playerId)?.radius;
  }

  clear(): void {
    this.lastRingContactTick = -1;
    this.pendingChunkLandings.length = 0;
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
      const radius = this.resolvePlayerStat(player.id, 'player.fire.ring.radius', 0);
      const thickness = this.resolvePlayerStat(player.id, 'player.fire.ring.thickness', 0);
      if (radius <= 0 || thickness <= 0) continue;
      rings.push({
        playerId: player.id,
        burn: {
          durationMs: this.resolvePlayerStat(player.id, 'player.fire.ring.burnDurationMs', 0),
          damagePerTick: this.resolvePlayerStat(player.id, 'player.fire.ring.burnDamagePerTick', 0),
        },
        x: player.sprite.x,
        y: player.sprite.y,
        radius,
        thickness,
        igniteProjectiles: this.resolvePlayerStat(player.id, 'player.fire.ring.igniteProjectiles', 0) > 0,
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

  private updateFireballTrails(now: number): void {
    for (const projectile of this.projectileManager.getActiveProjectiles()) {
      if (!projectile.fireTrail || projectile.pendingDestroy || projectile.projectileStyle !== 'fireball') continue;
      const gridX = Math.floor(projectile.sprite.x / 16);
      const gridY = Math.floor(projectile.sprite.y / 16);
      const cellKey = `${gridX}:${gridY}`;
      if (projectile.lastFireTrailCellKey === cellKey) continue;
      projectile.lastFireTrailCellKey = cellKey;
      this.refreshGenericGround(projectile.ownerId, projectile.sprite.x, projectile.sprite.y, projectile.fireTrail, now, `fireball-trail:${projectile.id}`);
    }
  }

  private launchFireChunks(
    ownerId: string,
    x: number,
    y: number,
    burst: FireChunkBurstConfig,
    now: number,
    sourceKey: string,
  ): void {
    const effect: GroundFireCellEffect = {
      durationMs: burst.durationMs,
      burnDurationMs: burst.burnDurationMs,
      burnDamagePerTick: burst.burnDamagePerTick,
      weaponName: burst.weaponName,
    };
    if (burst.igniteCenter) this.refreshGenericGround(ownerId, x, y, effect, now, `${sourceKey}:center`);
    const count = Math.max(0, Math.floor(burst.count));
    if (count <= 0) return;
    const targets = this.selectRandomFireCells(x, y, burst.searchRadius, count);
    if (targets.length === 0) return;
    const landsAt = now + Math.max(1, burst.flightMs);
    for (const target of targets) {
      this.pendingChunkLandings.push({ ownerId, target, landsAt, effect, sourceKey });
    }
    this.playFireChunkBurst(x, y, targets, landsAt);
  }

  private landPendingFireChunks(now: number): void {
    for (let index = this.pendingChunkLandings.length - 1; index >= 0; index -= 1) {
      const landing = this.pendingChunkLandings[index];
      if (landing.landsAt > now) continue;
      this.refreshGenericGround(
        landing.ownerId,
        landing.target.x,
        landing.target.y,
        landing.effect,
        now,
        `${landing.sourceKey}:chunk`,
      );
      this.pendingChunkLandings.splice(index, 1);
    }
  }

  private refreshGenericGround(
    ownerId: string,
    x: number,
    y: number,
    effect: GroundFireCellEffect,
    now: number,
    sourceKey: string,
  ): void {
    this.fireSystem.hostRefreshGroundCell(x, y, {
      sourceKey,
      ownerId,
      durationMs: effect.durationMs,
      burn: { durationMs: effect.burnDurationMs, damagePerTick: effect.burnDamagePerTick },
      weaponName: effect.weaponName,
    }, now);
  }

  private selectRandomFireCells(x: number, y: number, radius: number, count: number): FireChunkTarget[] {
    const candidates: FireChunkTarget[] = [];
    const minGridX = Math.floor((x - radius) / 16);
    const maxGridX = Math.floor((x + radius) / 16);
    const minGridY = Math.floor((y - radius) / 16);
    const maxGridY = Math.floor((y + radius) / 16);
    const radiusSq = radius * radius;
    const originGridX = Math.floor(x / 16);
    const originGridY = Math.floor(y / 16);
    for (let gridY = minGridY; gridY <= maxGridY; gridY += 1) {
      for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
        if (gridX === originGridX && gridY === originGridY) continue;
        const target = { x: gridX * 16 + 8, y: gridY * 16 + 8 };
        const dx = target.x - x;
        const dy = target.y - y;
        if (dx * dx + dy * dy > radiusSq || !this.fireSystem.canPlaceGroundCell(target.x, target.y)) continue;
        candidates.push(target);
      }
    }
    Phaser.Utils.Array.Shuffle(candidates);
    return candidates.slice(0, Math.max(0, Math.floor(count)));
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
