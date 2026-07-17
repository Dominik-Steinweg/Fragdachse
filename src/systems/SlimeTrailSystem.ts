import * as Phaser from 'phaser';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { SlimeBloomTarget, SyncedSlimeTrailSnapshot } from '../types';
import type { CombatSystem } from './CombatSystem';

const STAT_PREFIX = 'player.slimeTrail';
const FADE_OUT_MS = 900;
const MAX_DAMAGE_TICKS_PER_UPDATE = 12;

export type SlimeTrailStatResolver = (playerId: string, stat: string, baseValue: number) => number;
export type SlimeTrailWalkingResolver = (playerId: string) => boolean;

export interface SlimeDeathBurst {
  x: number;
  y: number;
  targets: SlimeBloomTarget[];
  ownerId: string;
}

interface SlimeTrailConfig {
  enabled: boolean;
  cellSize: number;
  lingerDurationMs: number;
  effectDurationMs: number;
  tickIntervalMs: number;
  damagePerTick: number;
  slowFraction: number;
  deathBurstSearchRadius: number;
  deathBurstPatchCount: number;
}

interface ActiveSlimeCell {
  id: number;
  key: string;
  gridX: number;
  gridY: number;
  size: number;
  ownerId: string;
  expiresAt: number;
  lingerDurationMs: number;
  effectDurationMs: number;
  tickIntervalMs: number;
  damagePerTick: number;
  slowFraction: number;
  deathBurstSearchRadius: number;
  deathBurstPatchCount: number;
}

interface SlimedEnemyState {
  enemyId: string;
  ownerId: string;
  expiresAt: number;
  effectDurationMs: number;
  nextTickAt: number;
  tickIntervalMs: number;
  damagePerTick: number;
  slowFraction: number;
  cellSize: number;
  lingerDurationMs: number;
  deathBurstSearchRadius: number;
  deathBurstPatchCount: number;
}

interface LastOwnerCell {
  gridX: number;
  gridY: number;
  size: number;
}

/**
 * Host-autoritative, gerasterte Schleimspur. Eine Rasterzelle existiert global
 * nur einmal; erneutes Betreten erneuert Zustand und Ablaufzeit, ohne zu stacken.
 */
export class SlimeTrailSystem {
  private readonly cells = new Map<string, ActiveSlimeCell>();
  private readonly cellSizes = new Set<number>();
  private readonly affectedEnemies = new Map<string, SlimedEnemyState>();
  private readonly lastOwnerCells = new Map<string, LastOwnerCell>();
  private nextCellId = 1;

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly enemyManager: EnemyManager,
    private readonly combatSystem: CombatSystem,
    private readonly resolveStat: SlimeTrailStatResolver,
    private readonly isNormallyWalking: SlimeTrailWalkingResolver,
  ) {}

  hostUpdate(now: number): SyncedSlimeTrailSnapshot {
    this.removeExpiredCells(now);
    this.updatePlayerTrails(now);
    this.refreshEnemyContacts(now);
    this.updateAffectedEnemies(now);
    return this.getSnapshot(now);
  }

  getEnemyMovementFactor(enemyId: string, now = Date.now()): number {
    const state = this.affectedEnemies.get(enemyId);
    if (!state || now > state.expiresAt) return 1;
    return 1 - Phaser.Math.Clamp(state.slowFraction, 0, 0.95);
  }

  handleEnemyDeath(enemyId: string, x: number, y: number, now = Date.now()): SlimeDeathBurst | null {
    const state = this.affectedEnemies.get(enemyId);
    if (!state || state.deathBurstSearchRadius <= 0 || state.deathBurstPatchCount <= 0) return null;
    this.affectedEnemies.delete(enemyId);

    const config: SlimeTrailConfig = {
      enabled: true,
      cellSize: state.cellSize,
      lingerDurationMs: state.lingerDurationMs,
      effectDurationMs: state.effectDurationMs,
      tickIntervalMs: state.tickIntervalMs,
      damagePerTick: state.damagePerTick,
      slowFraction: state.slowFraction,
      deathBurstSearchRadius: state.deathBurstSearchRadius,
      deathBurstPatchCount: state.deathBurstPatchCount,
    };
    const targets = this.selectRandomBloomCells(
      x,
      y,
      state.deathBurstSearchRadius,
      state.deathBurstPatchCount,
      state.cellSize,
    );
    for (const target of targets) {
      this.refreshCell(
        Math.floor(target.x / state.cellSize),
        Math.floor(target.y / state.cellSize),
        state.ownerId,
        config,
        now,
      );
    }
    return targets.length > 0 ? { x, y, targets, ownerId: state.ownerId } : null;
  }

  clear(): void {
    this.cells.clear();
    this.cellSizes.clear();
    this.affectedEnemies.clear();
    this.lastOwnerCells.clear();
    this.nextCellId = 1;
  }

  private updatePlayerTrails(now: number): void {
    const presentPlayerIds = new Set<string>();
    for (const player of this.playerManager.getAllPlayers()) {
      presentPlayerIds.add(player.id);
      const config = this.resolveConfig(player.id);
      if (!config.enabled || !this.combatSystem.isAlive(player.id) || !this.isNormallyWalking(player.id)) {
        this.lastOwnerCells.delete(player.id);
        continue;
      }

      const gridX = Math.floor(player.sprite.x / config.cellSize);
      const gridY = Math.floor(player.sprite.y / config.cellSize);
      const previous = this.lastOwnerCells.get(player.id);
      if (previous && previous.size === config.cellSize) {
        this.stampGridLine(previous.gridX, previous.gridY, gridX, gridY, player.id, config, now);
      } else {
        this.refreshCell(gridX, gridY, player.id, config, now);
      }
      this.lastOwnerCells.set(player.id, { gridX, gridY, size: config.cellSize });
    }

    for (const playerId of [...this.lastOwnerCells.keys()]) {
      if (!presentPlayerIds.has(playerId)) this.lastOwnerCells.delete(playerId);
    }
  }

  private stampGridLine(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    ownerId: string,
    config: SlimeTrailConfig,
    now: number,
  ): void {
    let x = startX;
    let y = startY;
    const dx = Math.abs(endX - startX);
    const dy = Math.abs(endY - startY);
    const stepX = startX < endX ? 1 : -1;
    const stepY = startY < endY ? 1 : -1;
    let error = dx - dy;

    while (true) {
      this.refreshCell(x, y, ownerId, config, now);
      if (x === endX && y === endY) break;
      const doubledError = error * 2;
      if (doubledError > -dy) {
        error -= dy;
        x += stepX;
      }
      if (doubledError < dx) {
        error += dx;
        y += stepY;
      }
    }
  }

  private selectRandomBloomCells(
    centerX: number,
    centerY: number,
    radius: number,
    count: number,
    cellSize: number,
  ): SlimeBloomTarget[] {
    const candidates: SlimeBloomTarget[] = [];
    const minGridX = Math.floor((centerX - radius) / cellSize);
    const maxGridX = Math.floor((centerX + radius) / cellSize);
    const minGridY = Math.floor((centerY - radius) / cellSize);
    const maxGridY = Math.floor((centerY + radius) / cellSize);
    const radiusSquared = radius * radius;
    for (let gridY = minGridY; gridY <= maxGridY; gridY += 1) {
      for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
        const cellX = gridX * cellSize + cellSize * 0.5;
        const cellY = gridY * cellSize + cellSize * 0.5;
        if (Phaser.Math.Distance.Squared(centerX, centerY, cellX, cellY) > radiusSquared) continue;
        candidates.push({ x: cellX, y: cellY });
      }
    }
    Phaser.Utils.Array.Shuffle(candidates);
    return candidates.slice(0, Math.min(Math.max(0, Math.floor(count)), candidates.length));
  }

  private refreshCell(gridX: number, gridY: number, ownerId: string, config: SlimeTrailConfig, now: number): void {
    const key = `${config.cellSize}:${gridX}:${gridY}`;
    const existing = this.cells.get(key);
    if (existing) {
      existing.ownerId = ownerId;
      existing.expiresAt = now + config.lingerDurationMs;
      existing.lingerDurationMs = config.lingerDurationMs;
      existing.effectDurationMs = config.effectDurationMs;
      existing.tickIntervalMs = config.tickIntervalMs;
      existing.damagePerTick = config.damagePerTick;
      existing.slowFraction = config.slowFraction;
      existing.deathBurstSearchRadius = config.deathBurstSearchRadius;
      existing.deathBurstPatchCount = config.deathBurstPatchCount;
      return;
    }

    this.cells.set(key, {
      id: this.nextCellId++,
      key,
      gridX,
      gridY,
      size: config.cellSize,
      ownerId,
      expiresAt: now + config.lingerDurationMs,
      lingerDurationMs: config.lingerDurationMs,
      effectDurationMs: config.effectDurationMs,
      tickIntervalMs: config.tickIntervalMs,
      damagePerTick: config.damagePerTick,
      slowFraction: config.slowFraction,
      deathBurstSearchRadius: config.deathBurstSearchRadius,
      deathBurstPatchCount: config.deathBurstPatchCount,
    });
    this.cellSizes.add(config.cellSize);
  }

  private removeExpiredCells(now: number): void {
    for (const [key, cell] of this.cells) {
      if (now >= cell.expiresAt) this.cells.delete(key);
    }
  }

  private refreshEnemyContacts(now: number): void {
    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (!enemy.sprite.active || enemy.getHp() <= 0) continue;
      const cell = this.findTouchingCell(enemy);
      if (!cell) continue;

      const existing = this.affectedEnemies.get(enemy.id);
      if (existing) {
        existing.ownerId = cell.ownerId;
        existing.expiresAt = now + cell.effectDurationMs;
        existing.effectDurationMs = cell.effectDurationMs;
        existing.tickIntervalMs = cell.tickIntervalMs;
        existing.damagePerTick = cell.damagePerTick;
        existing.slowFraction = cell.slowFraction;
        existing.cellSize = cell.size;
        existing.lingerDurationMs = cell.lingerDurationMs;
        existing.deathBurstSearchRadius = cell.deathBurstSearchRadius;
        existing.deathBurstPatchCount = cell.deathBurstPatchCount;
      } else {
        this.affectedEnemies.set(enemy.id, {
          enemyId: enemy.id,
          ownerId: cell.ownerId,
          expiresAt: now + cell.effectDurationMs,
          effectDurationMs: cell.effectDurationMs,
          nextTickAt: now + cell.tickIntervalMs,
          tickIntervalMs: cell.tickIntervalMs,
          damagePerTick: cell.damagePerTick,
          slowFraction: cell.slowFraction,
          cellSize: cell.size,
          lingerDurationMs: cell.lingerDurationMs,
          deathBurstSearchRadius: cell.deathBurstSearchRadius,
          deathBurstPatchCount: cell.deathBurstPatchCount,
        });
      }
    }
  }

  private findTouchingCell(enemy: EnemyEntity): ActiveSlimeCell | undefined {
    const radius = enemy.getCollisionRadius();
    for (const cellSize of this.cellSizes) {
      const minGridX = Math.floor((enemy.sprite.x - radius) / cellSize);
      const maxGridX = Math.floor((enemy.sprite.x + radius) / cellSize);
      const minGridY = Math.floor((enemy.sprite.y - radius) / cellSize);
      const maxGridY = Math.floor((enemy.sprite.y + radius) / cellSize);
      for (let gridY = minGridY; gridY <= maxGridY; gridY += 1) {
        for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
          const cell = this.cells.get(`${cellSize}:${gridX}:${gridY}`);
          if (!cell) continue;
          const left = cell.gridX * cell.size;
          const top = cell.gridY * cell.size;
          const closestX = Phaser.Math.Clamp(enemy.sprite.x, left, left + cell.size);
          const closestY = Phaser.Math.Clamp(enemy.sprite.y, top, top + cell.size);
          if (Phaser.Math.Distance.Squared(enemy.sprite.x, enemy.sprite.y, closestX, closestY) <= radius * radius) {
            return cell;
          }
        }
      }
    }
    return undefined;
  }

  private updateAffectedEnemies(now: number): void {
    for (const [enemyId, state] of this.affectedEnemies) {
      const enemy = this.enemyManager.getEnemy(enemyId);
      if (!enemy || !enemy.sprite.active || enemy.getHp() <= 0) {
        this.affectedEnemies.delete(enemyId);
        continue;
      }

      const tickUntil = Math.min(now, state.expiresAt);
      let tickCount = 0;
      while (state.nextTickAt <= tickUntil && tickCount < MAX_DAMAGE_TICKS_PER_UPDATE) {
        this.combatSystem.applyDamage(enemyId, state.damagePerTick, false, state.ownerId, 'Schleimspur', {
          sourceX: enemy.sprite.x,
          sourceY: enemy.sprite.y,
        });
        state.nextTickAt += state.tickIntervalMs;
        tickCount += 1;
        if (!this.enemyManager.hasEnemy(enemyId)) break;
      }

      if (!this.enemyManager.hasEnemy(enemyId) || now >= state.expiresAt) {
        this.affectedEnemies.delete(enemyId);
      }
    }
  }

  private resolveConfig(playerId: string): SlimeTrailConfig {
    return {
      enabled: this.resolveStat(playerId, `${STAT_PREFIX}.enabled`, 0) >= 0.5,
      cellSize: Math.max(8, Math.round(this.resolveStat(playerId, `${STAT_PREFIX}.cellSize`, 0))),
      lingerDurationMs: Math.max(100, this.resolveStat(playerId, `${STAT_PREFIX}.lingerDurationMs`, 0)),
      effectDurationMs: Math.max(100, this.resolveStat(playerId, `${STAT_PREFIX}.effectDurationMs`, 0)),
      tickIntervalMs: Math.max(50, this.resolveStat(playerId, `${STAT_PREFIX}.tickIntervalMs`, 0)),
      damagePerTick: Math.max(0, this.resolveStat(playerId, `${STAT_PREFIX}.damagePerTick`, 0)),
      slowFraction: Phaser.Math.Clamp(this.resolveStat(playerId, `${STAT_PREFIX}.slowFraction`, 0), 0, 0.95),
      deathBurstSearchRadius: Math.max(0, this.resolveStat(playerId, `${STAT_PREFIX}.deathBurstSearchRadius`, 0)),
      deathBurstPatchCount: Math.max(0, Math.floor(this.resolveStat(playerId, `${STAT_PREFIX}.deathBurstPatchCount`, 0))),
    };
  }

  private getSnapshot(now: number): SyncedSlimeTrailSnapshot {
    return {
      cells: [...this.cells.values()]
        .sort((left, right) => left.id - right.id)
        .map(cell => ({
          id: cell.id,
          x: cell.gridX * cell.size + cell.size * 0.5,
          y: cell.gridY * cell.size + cell.size * 0.5,
          size: cell.size,
          alpha: Math.round(Phaser.Math.Clamp((cell.expiresAt - now) / FADE_OUT_MS, 0, 1) * 100) / 100,
        })),
      affectedEnemies: [...this.affectedEnemies.values()]
        .map(state => {
          const enemy = this.enemyManager.getEnemy(state.enemyId);
          if (!enemy) return null;
          return {
            enemyId: state.enemyId,
            x: Math.round(enemy.sprite.x * 10) / 10,
            y: Math.round(enemy.sprite.y * 10) / 10,
            alpha: Math.round(Phaser.Math.Clamp((state.expiresAt - now) / Math.min(500, state.effectDurationMs), 0, 1) * 100) / 100,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry != null),
    };
  }
}
