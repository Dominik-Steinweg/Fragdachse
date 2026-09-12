import { resolveMolotovFireEffect } from '../loadout/resolveMolotovFireEffect';
import * as Phaser from 'phaser';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import {
  UTILITY_CONFIGS,
  type FlamethrowerWeaponFireConfig,
  type MolotovUtilityConfig,
} from '../loadout/LoadoutConfig';
import type { BurnOnHitConfig, FireChunkBurstConfig, FireChunkFlight, FireChunkTarget, FireGrenadeEffect, GroundFireCellEffect, GroundFireVisualStyle } from '../types';
import type { FireSystem } from '../effects/FireSystem';
import { BURN_TICK_INTERVAL_MS } from '../config';
import { createSingleOwnerProvenance } from '../projectile/ProjectileSpawnRequest';
import { portalDamageMultiplier } from './PortalTraversal';
import type {
  ProjectileEnvironmentInteractionPort,
  ProjectileTravelReadPort,
  ProjectileTravelSample,
} from '../projectile/ProjectileTravelPort';
import type { ProjectileId } from '../projectile/ProjectileSpawnPort';
import type { ProjectileFlameExpiryEvent } from '../projectile/ProjectileGameplayPort';
import type { ActiveBurnSource } from '../combat/rules/BurnStateMachine';
import type { CombatActorStatePort, CombatDamageEffectPort } from '../combat/CombatCapabilities';

interface ResolvedFlameOwner {
  playerId: string;
  fire: FlamethrowerWeaponFireConfig;
  burn: BurnOnHitConfig;
  baseDamageMult: number;
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
  landingExplosion?: import('../types').FireChunkLandingExplosion;
  combatSource?: import('../combat/CombatScope').CombatSource;
  ownerId: string;
  target: FireChunkTarget;
  landsAt: number;
  effect: GroundFireCellEffect;
  sourceKey: string;
}

export type FlamethrowerBurrowResolver = (playerId: string) => boolean;
export type FlamethrowerFriendlyResolver = (firstPlayerId: string, secondPlayerId: string) => boolean;
export type FireUpgradeStatResolver = (playerId: string, stat: string, baseValue: number) => number;

/** Narrow world/activity capability for creating authored ground-fire bursts. */
export interface FireChunkBurstPort {
  hostCreateFireChunkBurst(
    ownerId: string,
    x: number,
    y: number,
    burst: FireChunkBurstConfig,
    sourceKey: string,
    now: number,
    combatSource?: import('../combat/CombatScope').CombatSource,
    preferredTargets?: readonly FireChunkTarget[],
  ): void;
}

/** Host-authoritative simulation for the Flamethrower's passive upgrade branches. */
export class FlamethrowerUpgradeSystem implements FireChunkBurstPort {
  private lastRingContactTick = -1;
  private generation = 0;
  private readonly pendingChunkLandings: PendingFireChunkLanding[] = [];
  private readonly fireTrailCellByProjectile = new Map<ProjectileId, string>();
  private readonly activeFireTrailIds = new Set<ProjectileId>();
  private enemyManager: EnemyManager | null;

  constructor(
    private readonly playerManager: PlayerManager,
    enemyManager: EnemyManager | null,
    private readonly projectileTravel: ProjectileTravelReadPort,
    private readonly projectileEnvironment: ProjectileEnvironmentInteractionPort,
    private readonly combatSystem: CombatActorStatePort & CombatDamageEffectPort,
    private readonly loadoutManager: LoadoutManager,
    private readonly fireSystem: FireSystem,
    private readonly isBurrowed: FlamethrowerBurrowResolver,
    private readonly areFriendly: FlamethrowerFriendlyResolver,
    private readonly playKamikazeExplosion: (x: number, y: number, radius: number) => void,
    private readonly resolvePlayerStat: FireUpgradeStatResolver,
    private readonly playFireChunkBurst: (
      x: number,
      y: number,
      targets: readonly FireChunkFlight[],
      startedAt: number,
      visualStyle: GroundFireVisualStyle,
    ) => void,
    private readonly chunkEffects?: {
      hasLineOfSight(x: number, y: number, tx: number, ty: number): boolean;
      canTarget(ownerId: string, enemyId: string, source?: import('../combat/CombatScope').CombatSource): boolean;
      explode(landing: { x: number; y: number; ownerId: string; effect: import('../types').FireChunkLandingExplosion;
        source?: import('../combat/CombatScope').CombatSource; now: number }): void;
    },
  ) {
    this.enemyManager = enemyManager;
  }

  setEnemyManager(enemyManager: EnemyManager | null): void {
    this.enemyManager = enemyManager;
  }

  /** Must run before WorldCombatCore.update so a swept projectile is imbued before a same-frame hit. */
  prepareProjectileBurns(now: number, samples = this.projectileTravel.getTravelSamples()): void {
    const rings = this.getActiveRings();
    for (const sample of samples) {
      if (!sample.capabilities.canReceiveFireImbue) continue;
      const ownerId = sample.provenance.allegiance.ownerId;
      const fromX = sample.fromX;
      const fromY = sample.fromY;
      const toX = sample.toX;
      const toY = sample.toY;
      if (Math.abs(toX - fromX) + Math.abs(toY - fromY) <= 0.01) continue;

      const generalBurnEnabled = this.resolvePlayerStat(
        ownerId,
        'player.fire.burningProjectiles.enabled',
        0,
      ) > 0;
      if (generalBurnEnabled) {
        const burn: BurnOnHitConfig = {
          durationMs: this.resolvePlayerStat(ownerId, 'player.fire.burningProjectiles.durationMs', 0),
          damagePerTick: this.resolvePlayerStat(ownerId, 'player.fire.burningProjectiles.damagePerTick', 0),
        };
        for (const fireOwner of this.fireSystem.collectGroundFireOwnersAlongSegment(fromX, fromY, toX, toY, now)) {
          if (!this.areFriendly(fireOwner.ownerId, ownerId)) continue;
          this.addBurnAugment(sample, burn, fireOwner.ownerId, fireOwner.sourceId);
          break;
        }
      }

      for (const ring of rings) {
        if (!ring.igniteProjectiles || !this.areFriendly(ring.playerId, ownerId)) continue;
        if (!this.segmentTouchesRing(fromX, fromY, toX, toY, ring)) continue;
        this.addBurnAugment(sample, ring.burn, ring.playerId, `flame-ring:${ring.playerId}`);
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
    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
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

  handleEnemyDeath(x: number, y: number, burnSources: readonly ActiveBurnSource[], now: number): void {
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
        sourceId: 'ground_fire.player_death',
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
          sourceId: 'ground_fire.player_death_burst',
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
    now: number,
    combatSource?: import('../combat/CombatScope').CombatSource,
    preferredTargets?: readonly FireChunkTarget[],
  ): void {
    this.launchFireChunks(ownerId, x, y, burst, now, sourceKey, combatSource, preferredTargets);
  }

  handleNaturalFlameExpiry(projectile: ProjectileFlameExpiryEvent, now: number): void {
    const owner = this.getEquippedFlameOwner(projectile.ownerId);
    if (!owner || (owner.fire.burningGround?.createOnFlameExpiry ?? 0) <= 0) return;
    if ((owner.fire.burningGround?.durationMs ?? 0) <= 0) return;
    this.refreshGroundAt(projectile.x, projectile.y, { ...owner, burn: { ...owner.burn,
      damagePerTick: owner.burn.damagePerTick * portalDamageMultiplier(projectile.provenance.portalDamage) } }, now);
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
      ...resolveMolotovFireEffect(molotov),
      sourceId: 'ground_fire.kamikaze_napalm',
    };
    this.fireSystem.hostCreateZone(x, y, effect, playerId);
    this.playKamikazeExplosion(x, y, effect.radius);
  }

  getActiveRingRadius(playerId: string): number | undefined {
    return this.getActiveRings().find(ring => ring.playerId === playerId)?.radius;
  }

  clear(): void {
    this.generation += 1;
    this.lastRingContactTick = -1;
    this.pendingChunkLandings.length = 0;
    this.fireTrailCellByProjectile.clear();
    this.activeFireTrailIds.clear();
  }

  private getEquippedFlameOwner(playerId: string): ResolvedFlameOwner | null {
    const weapon = this.loadoutManager.getEquippedWeaponConfig(playerId, 'weapon2');
    if (!weapon || weapon.id !== 'FLAMETHROWER' || weapon.fire.type !== 'flamethrower') return null;
    return {
      playerId,
      fire: weapon.fire,
      baseDamageMult: weapon.baseDamageMult ?? 1,
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
        x: player.x,
        y: player.y,
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
      sourceId: 'ground_fire.flamethrower',
      baseDamageMult: owner.baseDamageMult,
    }, now);
  }

  private updateFireballTrails(now: number): void {
    this.activeFireTrailIds.clear();
    for (const sample of this.projectileTravel.getTravelSamples()) {
      const trail = sample.capabilities.pathEffect?.fireTrail;
      if (!trail || sample.capabilities.pathEffect?.kind !== 'fireball') continue;
      this.activeFireTrailIds.add(sample.projectileId);
      if (this.fireTrailCellByProjectile.get(sample.projectileId) === trail.cellKey) continue;
      this.fireTrailCellByProjectile.set(sample.projectileId, trail.cellKey);
      this.refreshGenericGround(
        sample.provenance.allegiance.ownerId,
        sample.toX,
        sample.toY,
        trail.effect,
        now,
        `fireball-trail:${sample.projectileId}`,
        this.fireSystem.captureCombatSource?.(sample.provenance.allegiance.ownerId,
          trail.effect.sourceId ?? 'ground_fire.fireball', sample.provenance),
      );
    }
    for (const projectileId of this.fireTrailCellByProjectile.keys()) {
      if (!this.activeFireTrailIds.has(projectileId)) this.fireTrailCellByProjectile.delete(projectileId);
    }
  }

  private launchFireChunks(
    ownerId: string,
    x: number,
    y: number,
    burst: FireChunkBurstConfig,
    now: number,
    sourceKey: string,
    combatSource = this.fireSystem.captureCombatSource?.(ownerId, burst.sourceId ?? 'ground_fire.chunk'),
    preferredTargets: readonly FireChunkTarget[] = [],
  ): void {
    const effect: GroundFireCellEffect = {
      durationMs: burst.durationMs,
      burnDurationMs: burst.burnDurationMs,
      burnDamagePerTick: burst.burnDamagePerTick,
      sourceId: burst.sourceId,
      visualStyle: burst.visualStyle,
      damageTarget: burst.damageTarget,
      baseDamageMult: burst.baseDamageMult,
    };
    if (burst.igniteCenter) this.refreshGenericGround(ownerId, x, y, effect, now, `${sourceKey}:center`, combatSource);
    const count = Math.max(0, Math.floor(burst.count));
    if (count <= 0) return;
    const valid = (target: FireChunkTarget) => Math.hypot(target.x - x, target.y - y) <= burst.searchRadius
      && this.fireSystem.canPlaceGroundCell(target.x, target.y)
      && (!burst.requireLineOfSight || this.chunkEffects?.hasLineOfSight(x, y, target.x, target.y) === true);
    const targets: FireChunkTarget[] = preferredTargets.filter(valid).slice(0, count).map(t => ({ x: t.x, y: t.y }));
    const survivorTargets: FireChunkTarget[] = [];
    if (targets.length === 0 && burst.targetSurvivors) {
      const survivors = (this.enemyManager?.getAllEnemies() ?? []).filter(enemy => enemy.getHp() > 0
        && !enemy.isBurrowed() && this.chunkEffects?.canTarget(ownerId, enemy.id, combatSource) === true
        && valid(enemy.sprite));
      Phaser.Utils.Array.Shuffle(survivors);
      for (const enemy of survivors.slice(0, count)) survivorTargets.push({ x: enemy.sprite.x, y: enemy.sprite.y });
      targets.push(...survivorTargets);
    }
    const cellKey = (t: FireChunkTarget) => Math.floor(t.x / 16) + ':' + Math.floor(t.y / 16);
    const occupied = new Set(targets.map(cellKey));
    const candidates = targets.length < count
      ? this.selectRandomFireCells(x, y, burst.searchRadius, Infinity).filter(t => !occupied.has(cellKey(t)))
      : [];
    // Only near candidates and actual random fallback attempts need a flight-line query.
    const validity = new Map<FireChunkTarget, boolean>();
    const validCandidate = (candidate: FireChunkTarget): boolean => {
      let result = validity.get(candidate);
      if (result === undefined) { result = valid(candidate); validity.set(candidate, result); }
      return result;
    };
    const nearby = this.selectNearbyFireCells(survivorTargets, candidates, count - targets.length,
      burst.nearbyChunksPerTarget ?? 0, burst.landingExplosion?.radius ?? 0, validCandidate);
    targets.push(...nearby);
    for (const target of nearby) occupied.add(cellKey(target));
    for (const candidate of candidates) {
      if (targets.length >= count) break;
      if (!occupied.has(cellKey(candidate)) && validCandidate(candidate)) { targets.push(candidate); occupied.add(cellKey(candidate)); }
    }
    if (targets.length === 0) return;
    const flights: FireChunkFlight[] = targets.map(target => ({ ...target, landsAt: now + Math.max(1,
      burst.flightMs * Math.min(1, Math.hypot(target.x - x, target.y - y) / Math.max(1, burst.searchRadius))) }));
    for (const target of flights) {
      this.pendingChunkLandings.push({ ownerId, target, landsAt: target.landsAt, effect, sourceKey, combatSource,
        landingExplosion: burst.landingExplosion });
    }
    this.playFireChunkBurst(x, y, flights, now, effect.visualStyle ?? 'normal');
  }

  /**
   * Match extra slots to unique cells, round-robin over the shuffled survivor list.
   * Augmenting paths preserve earlier quotas when survivors compete for scarce cells.
   * The shuffled cell pool breaks ties; available cells prefer separation from all landings.
   */
  private selectNearbyFireCells(
    survivors: readonly FireChunkTarget[],
    candidates: readonly FireChunkTarget[],
    count: number,
    perTarget: number,
    radius: number,
    valid: (target: FireChunkTarget) => boolean,
  ): FireChunkTarget[] {
    if (!survivors.length || !candidates.length || count <= 0
      || !Number.isSafeInteger(perTarget) || perTarget <= 0 || !Number.isFinite(radius) || radius <= 0) return [];
    const distanceSq = (a: FireChunkTarget, b: FireChunkTarget) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    const eligible = survivors.map(target => candidates.flatMap((cell, index) =>
      distanceSq(target, cell) <= radius * radius && valid(cell) ? [index] : []));
    const slots: Array<{ target: number; cell: number }> = [];
    const cellOwners = new Map<number, number>();
    const separation = (cell: number, slotIndex: number): number => {
      let min = Infinity;
      for (const direct of survivors) min = Math.min(min, distanceSq(candidates[cell], direct));
      for (let index = 0; index < slots.length; index++) {
        if (index !== slotIndex && slots[index].cell >= 0) {
          min = Math.min(min, distanceSq(candidates[cell], candidates[slots[index].cell]));
        }
      }
      return min;
    };
    const assign = (slotIndex: number, visited: Set<number>): boolean => {
      const ranked = eligible[slots[slotIndex].target]
        .filter(cell => !visited.has(cell))
        .map(cell => ({ cell, separation: separation(cell, slotIndex) }))
        .sort((a, b) => b.separation - a.separation);
      // Do not disturb prior placements while a free reachable cell exists.
      for (const { cell } of ranked) {
        if (cellOwners.has(cell)) continue;
        visited.add(cell);
        cellOwners.set(cell, slotIndex);
        slots[slotIndex].cell = cell;
        return true;
      }
      for (const { cell } of ranked) {
        if (visited.has(cell)) continue;
        visited.add(cell);
        const owner = cellOwners.get(cell)!;
        if (assign(owner, visited)) {
          cellOwners.set(cell, slotIndex);
          slots[slotIndex].cell = cell;
          return true;
        }
      }
      return false;
    };
    for (let round = 0; round < Math.min(perTarget, count) && slots.length < count; round++) {
      const before = slots.length;
      for (let target = 0; target < survivors.length && slots.length < count; target++) {
        slots.push({ target, cell: -1 });
        if (!assign(slots.length - 1, new Set())) slots.pop();
      }
      if (slots.length === before) break;
    }
    return slots.map(slot => candidates[slot.cell]);
  }

  private landPendingFireChunks(now: number): void {
    const generation = this.generation;
    for (let index = this.pendingChunkLandings.length - 1; index >= 0; index -= 1) {
      if (generation !== this.generation) return;
      const landing = this.pendingChunkLandings[index];
      if (landing.landsAt > now) continue;
      this.pendingChunkLandings.splice(index, 1);
      this.refreshGenericGround(
        landing.ownerId,
        landing.target.x,
        landing.target.y,
        landing.effect,
        now,
        `${landing.sourceKey}:chunk`,
        landing.combatSource,
      );
      if (generation !== this.generation) return;
      if (landing.landingExplosion) this.chunkEffects?.explode({ x: landing.target.x, y: landing.target.y,
        ownerId: landing.ownerId, effect: landing.landingExplosion, source: landing.combatSource, now });
    }
  }

  private refreshGenericGround(
    ownerId: string,
    x: number,
    y: number,
    effect: GroundFireCellEffect,
    now: number,
    sourceKey: string,
    combatSource?: import('../combat/CombatScope').CombatSource,
  ): void {
    this.fireSystem.hostRefreshGroundCell(x, y, {
      combatSource,
      sourceKey,
      ownerId,
      durationMs: effect.durationMs,
      burn: { durationMs: effect.burnDurationMs, damagePerTick: effect.burnDamagePerTick },
      sourceId: effect.sourceId,
      visualStyle: effect.visualStyle,
      damageTarget: effect.damageTarget,
      baseDamageMult: effect.baseDamageMult,
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

  private addBurnAugment(
    sample: ProjectileTravelSample,
    burn: BurnOnHitConfig,
    sourceOwnerId: string,
    sourceId: string,
  ): void {
    this.projectileEnvironment.addBurnAugment(sample.projectileId, {
      burn: { ...burn },
      provenance: createSingleOwnerProvenance(sourceOwnerId, { weaponSourceId: sourceId }),
    });
  }
}
