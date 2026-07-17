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
import type { BurnOnHitConfig, FireGrenadeEffect, SyncedBurningGroundSnapshot, TrackedProjectile } from '../types';
import type { FireSystem } from '../effects/FireSystem';
import { BURN_TICK_INTERVAL_MS } from '../config';
import type { ActiveBurnSource, CombatSystem } from './CombatSystem';

const DEFAULT_CELL_SIZE = 32;

interface ResolvedFlameOwner {
  playerId: string;
  fire: FlamethrowerWeaponFireConfig;
  burn: BurnOnHitConfig;
}

interface GroundContributor {
  ownerId: string;
  expiresAt: number;
  burn: BurnOnHitConfig;
  igniteProjectiles: boolean;
}

interface ActiveGroundCell {
  id: number;
  key: string;
  gridX: number;
  gridY: number;
  cellSize: number;
  contributors: Map<string, GroundContributor>;
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
  private readonly cells = new Map<string, ActiveGroundCell>();
  private nextCellId = 1;
  private lastContactTick = -1;

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
    this.removeExpiredCells(now);
    const rings = this.getActiveRings();
    for (const projectile of this.projectileManager.getActiveProjectiles()) {
      if (!projectile.canReceiveFireImbue || projectile.pendingDestroy) continue;
      if (projectile.isGrenade || projectile.isFlame) continue;
      const fromX = projectile.lastX;
      const fromY = projectile.lastY;
      const toX = projectile.sprite.x;
      const toY = projectile.sprite.y;
      if (Math.abs(toX - fromX) + Math.abs(toY - fromY) <= 0.01) continue;

      this.visitGridSegment(fromX, fromY, toX, toY, DEFAULT_CELL_SIZE, (gridX, gridY) => {
        const cell = this.cells.get(this.cellKey(gridX, gridY));
        if (!cell) return false;
        for (const contributor of cell.contributors.values()) {
          if (contributor.expiresAt <= now || !contributor.igniteProjectiles) continue;
          if (!this.areFriendly(contributor.ownerId, projectile.ownerId)) continue;
          this.applyStrongestSupplementalBurn(projectile, contributor.burn);
        }
        return false;
      });

      for (const ring of rings) {
        if (!ring.igniteProjectiles || !this.areFriendly(ring.playerId, projectile.ownerId)) continue;
        if (!this.segmentTouchesRing(fromX, fromY, toX, toY, ring)) continue;
        this.applyStrongestSupplementalBurn(projectile, ring.burn);
      }
    }
  }

  hostUpdate(now: number): SyncedBurningGroundSnapshot {
    this.removeExpiredCells(now);
    const contactTick = Math.floor(now / BURN_TICK_INTERVAL_MS);
    if (contactTick === this.lastContactTick) return this.getSnapshot();
    this.lastContactTick = contactTick;

    const rings = this.getActiveRings();
    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (!this.combatSystem.isAlive(enemy.id)) continue;
      for (const ground of this.findGroundContactsByOwner(enemy, now)) {
        this.combatSystem.applyBurnHit(
          enemy.id,
          ground.ownerId,
          ground.burn.durationMs,
          ground.burn.damagePerTick,
          `burning-ground:${ground.ownerId}`,
          'Brennender Boden',
        );
      }
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
    return this.getSnapshot();
  }

  handleEnemyDeath(x: number, y: number, burnSources: readonly ActiveBurnSource[], now = Date.now()): void {
    const handledOwners = new Set<string>();
    for (const source of burnSources) {
      if (handledOwners.has(source.attackerId)) continue;
      const owner = this.getEquippedFlameOwner(source.attackerId);
      if (!owner) continue;
      if ((owner.fire.burningGround?.durationMs ?? 0) <= 0) continue;
      if ((owner.fire.burningGround?.cellSize ?? 0) <= 0) continue;
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
    this.cells.clear();
    this.nextCellId = 1;
    this.lastContactTick = -1;
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
    const cellSize = Math.max(1, Math.round(owner.fire.burningGround?.cellSize ?? DEFAULT_CELL_SIZE));
    const durationMs = Math.max(0, owner.fire.burningGround?.durationMs ?? 0);
    if (durationMs <= 0) return;
    const gridX = Math.floor(x / cellSize);
    const gridY = Math.floor(y / cellSize);
    const key = this.cellKey(gridX, gridY);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = {
        id: this.nextCellId++,
        key,
        gridX,
        gridY,
        cellSize,
        contributors: new Map(),
      };
      this.cells.set(key, cell);
    }
    cell.contributors.set(owner.playerId, {
      ownerId: owner.playerId,
      expiresAt: now + durationMs,
      burn: { ...owner.burn },
      igniteProjectiles: (owner.fire.burningGround?.igniteProjectiles ?? 0) > 0,
    });
  }

  private findGroundContactsByOwner(enemy: EnemyEntity, now: number): GroundContributor[] {
    const radius = enemy.getCollisionRadius();
    const minGridX = Math.floor((enemy.sprite.x - radius) / DEFAULT_CELL_SIZE);
    const maxGridX = Math.floor((enemy.sprite.x + radius) / DEFAULT_CELL_SIZE);
    const minGridY = Math.floor((enemy.sprite.y - radius) / DEFAULT_CELL_SIZE);
    const maxGridY = Math.floor((enemy.sprite.y + radius) / DEFAULT_CELL_SIZE);
    const byOwner = new Map<string, GroundContributor>();
    for (let gridY = minGridY; gridY <= maxGridY; gridY++) {
      for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
        const cell = this.cells.get(this.cellKey(gridX, gridY));
        if (!cell || !this.enemyTouchesCell(enemy, cell)) continue;
        for (const contributor of cell.contributors.values()) {
          if (contributor.expiresAt <= now) continue;
          const existing = byOwner.get(contributor.ownerId);
          if (!existing || this.burnDps(contributor.burn) > this.burnDps(existing.burn)) {
            byOwner.set(contributor.ownerId, contributor);
          }
        }
      }
    }
    return [...byOwner.values()].sort((left, right) => left.ownerId.localeCompare(right.ownerId));
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

  private enemyTouchesCell(enemy: EnemyEntity, cell: ActiveGroundCell): boolean {
    const left = cell.gridX * cell.cellSize;
    const top = cell.gridY * cell.cellSize;
    const nearestX = Phaser.Math.Clamp(enemy.sprite.x, left, left + cell.cellSize);
    const nearestY = Phaser.Math.Clamp(enemy.sprite.y, top, top + cell.cellSize);
    const dx = enemy.sprite.x - nearestX;
    const dy = enemy.sprite.y - nearestY;
    return dx * dx + dy * dy <= enemy.getCollisionRadius() ** 2;
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

  private removeExpiredCells(now: number): void {
    for (const [key, cell] of this.cells) {
      for (const [ownerId, contributor] of cell.contributors) {
        if (contributor.expiresAt <= now) cell.contributors.delete(ownerId);
      }
      if (cell.contributors.size === 0) this.cells.delete(key);
    }
  }

  private getSnapshot(): SyncedBurningGroundSnapshot {
    return {
      cells: [...this.cells.values()]
        .sort((left, right) => left.id - right.id)
        .map(cell => ({
          id: cell.id,
          gridX: cell.gridX,
          gridY: cell.gridY,
          expiresAt: Math.max(...[...cell.contributors.values()].map(contributor => contributor.expiresAt)),
        })),
    };
  }

  private cellKey(gridX: number, gridY: number): string {
    return `${gridX}:${gridY}`;
  }

  private visitGridSegment(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    cellSize: number,
    visitor: (gridX: number, gridY: number) => boolean,
  ): void {
    let gridX = Math.floor(fromX / cellSize);
    let gridY = Math.floor(fromY / cellSize);
    const endGridX = Math.floor(toX / cellSize);
    const endGridY = Math.floor(toY / cellSize);
    const dx = toX - fromX;
    const dy = toY - fromY;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const tDeltaX = stepX === 0 ? Infinity : cellSize / Math.abs(dx);
    const tDeltaY = stepY === 0 ? Infinity : cellSize / Math.abs(dy);
    const nextBoundaryX = stepX > 0 ? (gridX + 1) * cellSize : gridX * cellSize;
    const nextBoundaryY = stepY > 0 ? (gridY + 1) * cellSize : gridY * cellSize;
    let tMaxX = stepX === 0 ? Infinity : Math.abs((nextBoundaryX - fromX) / dx);
    let tMaxY = stepY === 0 ? Infinity : Math.abs((nextBoundaryY - fromY) / dy);

    for (;;) {
      if (visitor(gridX, gridY)) return;
      if (gridX === endGridX && gridY === endGridY) return;
      if (tMaxX < tMaxY) {
        gridX += stepX;
        tMaxX += tDeltaX;
      } else {
        gridY += stepY;
        tMaxY += tDeltaY;
      }
    }
  }
}
