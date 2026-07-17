import * as Phaser from 'phaser';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { GuardianSpiritPhase, SyncedGuardianSpirit } from '../types';
import type { CombatSystem } from './CombatSystem';

const STAT_PREFIX = 'player.guardianSpirit';
const IMPACT_VISUAL_MS = 180;
const ORBIT_RADIANS_PER_SECOND = 1.75;
const ARRIVAL_DISTANCE_PX = 10;
const MIN_INTERVAL_MS = 100;

export type GuardianSpiritStatResolver = (playerId: string, stat: string, baseValue: number) => number;

interface GuardianSpiritRuntime {
  id: number;
  ownerId: string;
  ownerColor: number;
  x: number;
  y: number;
  phase: GuardianSpiritPhase;
  orbitAngle: number;
  targetId?: string;
  impactUntil?: number;
}

interface GuardianSpiritOwnerRuntime {
  nextSpawnAt: number;
  nextAttackAt: number;
}

interface GuardianSpiritConfig {
  maxCount: number;
  damage: number;
  spawnIntervalMs: number;
  scanRadius: number;
  attackSpeed: number;
  returnSpeed: number;
  orbitRadius: number;
  attackStaggerMs: number;
}

/**
 * Host-autoritaere Schutzgeist-Simulation. Die Logik kennt bereits variable
 * Maximalzahlen; der erste Capstone liefert 1, Geistertrias erhoeht auf 3.
 */
export class GuardianSpiritSystem {
  private readonly spirits = new Map<number, GuardianSpiritRuntime>();
  private readonly owners = new Map<string, GuardianSpiritOwnerRuntime>();
  private nextSpiritId = 1;

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly enemyManager: EnemyManager,
    private readonly combatSystem: CombatSystem,
    private readonly resolveStat: GuardianSpiritStatResolver,
  ) {}

  hostUpdate(now: number, deltaMs: number): SyncedGuardianSpirit[] {
    const deltaSeconds = Math.max(0, Math.min(deltaMs, 100)) / 1000;
    const activeOwnerIds = new Set<string>();

    for (const player of this.playerManager.getAllPlayers()) {
      const cfg = this.resolveConfig(player.id);
      if (cfg.maxCount <= 0 || !this.combatSystem.isAlive(player.id)) {
        this.clearOwner(player.id);
        this.owners.delete(player.id);
        continue;
      }

      activeOwnerIds.add(player.id);
      let ownerState = this.owners.get(player.id);
      if (!ownerState) {
        ownerState = { nextSpawnAt: now + cfg.spawnIntervalMs, nextAttackAt: now };
        this.owners.set(player.id, ownerState);
      }

      this.updateOwnerSpirits(player.id, player.color, player.sprite.x, player.sprite.y, cfg, ownerState, now, deltaSeconds);
    }

    for (const ownerId of [...this.owners.keys()]) {
      if (activeOwnerIds.has(ownerId)) continue;
      this.clearOwner(ownerId);
      this.owners.delete(ownerId);
    }

    return this.getSnapshot();
  }

  clear(): void {
    this.spirits.clear();
    this.owners.clear();
    this.nextSpiritId = 1;
  }

  private updateOwnerSpirits(
    ownerId: string,
    ownerColor: number,
    ownerX: number,
    ownerY: number,
    cfg: GuardianSpiritConfig,
    ownerState: GuardianSpiritOwnerRuntime,
    now: number,
    deltaSeconds: number,
  ): void {
    const ownerSpirits = this.getOwnerSpirits(ownerId);

    for (const spirit of ownerSpirits) {
      spirit.ownerColor = ownerColor;
      spirit.orbitAngle = Phaser.Math.Angle.Wrap(spirit.orbitAngle + ORBIT_RADIANS_PER_SECOND * deltaSeconds);

      if (spirit.phase === 'impact') {
        if (now >= (spirit.impactUntil ?? 0)) this.spirits.delete(spirit.id);
        continue;
      }

      if (spirit.phase === 'orbiting') {
        const orbit = this.getOrbitPoint(ownerX, ownerY, cfg.orbitRadius, spirit.orbitAngle);
        spirit.x = orbit.x;
        spirit.y = orbit.y;
        continue;
      }

      if (spirit.phase === 'returning') {
        const orbit = this.getOrbitPoint(ownerX, ownerY, cfg.orbitRadius, spirit.orbitAngle);
        this.moveTowards(spirit, orbit.x, orbit.y, cfg.returnSpeed, deltaSeconds);
        if (Phaser.Math.Distance.Between(spirit.x, spirit.y, orbit.x, orbit.y) <= ARRIVAL_DISTANCE_PX) {
          spirit.x = orbit.x;
          spirit.y = orbit.y;
          spirit.phase = 'orbiting';
          spirit.targetId = undefined;
        }
        continue;
      }

      const target = spirit.targetId ? this.enemyManager.getEnemy(spirit.targetId) : undefined;
      if (!target || !this.combatSystem.isAlive(target.id)) {
        spirit.phase = 'returning';
        spirit.targetId = undefined;
        continue;
      }

      this.moveTowards(spirit, target.sprite.x, target.sprite.y, cfg.attackSpeed, deltaSeconds);
      const hitDistance = target.getCollisionRadius() + 7;
      if (Phaser.Math.Distance.Between(spirit.x, spirit.y, target.sprite.x, target.sprite.y) <= hitDistance) {
        spirit.x = target.sprite.x;
        spirit.y = target.sprite.y;
        spirit.phase = 'impact';
        spirit.targetId = undefined;
        spirit.impactUntil = now + IMPACT_VISUAL_MS;
        ownerState.nextSpawnAt = now + cfg.spawnIntervalMs;
        this.combatSystem.applyDamage(target.id, cfg.damage, false, ownerId, 'Schutzgeist', {
          sourceX: spirit.x,
          sourceY: spirit.y,
        });
      }
    }

    const activeCount = this.getOwnerSpirits(ownerId).filter(spirit => spirit.phase !== 'impact').length;
    if (activeCount < cfg.maxCount && now >= ownerState.nextSpawnAt) {
      this.spawnSpirit(ownerId, ownerColor, ownerX, ownerY, cfg.orbitRadius);
      ownerState.nextSpawnAt = now + cfg.spawnIntervalMs;
    }

    if (now < ownerState.nextAttackAt) return;
    const readySpirit = this.getOwnerSpirits(ownerId)
      .filter(spirit => spirit.phase === 'orbiting')
      .sort((left, right) => left.id - right.id)[0];
    if (!readySpirit) return;

    const target = this.findNearestTarget(ownerX, ownerY, cfg.scanRadius);
    if (!target) return;
    readySpirit.phase = 'attacking';
    readySpirit.targetId = target.id;
    ownerState.nextAttackAt = now + cfg.attackStaggerMs;
  }

  private spawnSpirit(ownerId: string, ownerColor: number, ownerX: number, ownerY: number, orbitRadius: number): void {
    const id = this.nextSpiritId++;
    const orbitAngle = Phaser.Math.Angle.Wrap(id * 2.399963229728653);
    const orbit = this.getOrbitPoint(ownerX, ownerY, orbitRadius, orbitAngle);
    this.spirits.set(id, {
      id,
      ownerId,
      ownerColor,
      x: orbit.x,
      y: orbit.y,
      phase: 'orbiting',
      orbitAngle,
    });
  }

  private findNearestTarget(ownerX: number, ownerY: number, radius: number) {
    let nearest: ReturnType<EnemyManager['getEnemy']>;
    let nearestDistance = radius;
    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (!this.combatSystem.isAlive(enemy.id)) continue;
      const distance = Phaser.Math.Distance.Between(ownerX, ownerY, enemy.sprite.x, enemy.sprite.y);
      if (distance > nearestDistance) continue;
      nearest = enemy;
      nearestDistance = distance;
    }
    return nearest;
  }

  private moveTowards(spirit: GuardianSpiritRuntime, targetX: number, targetY: number, speed: number, deltaSeconds: number): void {
    const dx = targetX - spirit.x;
    const dy = targetY - spirit.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.001) return;
    const step = Math.min(distance, Math.max(0, speed) * deltaSeconds);
    spirit.x += dx / distance * step;
    spirit.y += dy / distance * step;
  }

  private getOrbitPoint(ownerX: number, ownerY: number, radius: number, angle: number): { x: number; y: number } {
    return {
      x: ownerX + Math.cos(angle) * radius,
      y: ownerY + Math.sin(angle) * radius * 0.72,
    };
  }

  private getOwnerSpirits(ownerId: string): GuardianSpiritRuntime[] {
    return [...this.spirits.values()].filter(spirit => spirit.ownerId === ownerId);
  }

  private clearOwner(ownerId: string): void {
    for (const spirit of this.getOwnerSpirits(ownerId)) this.spirits.delete(spirit.id);
  }

  private resolveConfig(playerId: string): GuardianSpiritConfig {
    return {
      maxCount: Math.max(0, Math.floor(this.resolveStat(playerId, `${STAT_PREFIX}.maxCount`, 0))),
      damage: this.resolveStat(playerId, `${STAT_PREFIX}.damage`, 0),
      spawnIntervalMs: Math.max(MIN_INTERVAL_MS, this.resolveStat(playerId, `${STAT_PREFIX}.spawnIntervalMs`, 0)),
      scanRadius: this.resolveStat(playerId, `${STAT_PREFIX}.scanRadius`, 0),
      attackSpeed: this.resolveStat(playerId, `${STAT_PREFIX}.attackSpeed`, 0),
      returnSpeed: this.resolveStat(playerId, `${STAT_PREFIX}.returnSpeed`, 0),
      orbitRadius: this.resolveStat(playerId, `${STAT_PREFIX}.orbitRadius`, 0),
      attackStaggerMs: Math.max(0, this.resolveStat(playerId, `${STAT_PREFIX}.attackStaggerMs`, 0)),
    };
  }

  private getSnapshot(): SyncedGuardianSpirit[] {
    return [...this.spirits.values()].map(spirit => ({
      id: spirit.id,
      ownerId: spirit.ownerId,
      ownerColor: spirit.ownerColor,
      x: Math.round(spirit.x * 10) / 10,
      y: Math.round(spirit.y * 10) / 10,
      phase: spirit.phase,
      targetId: spirit.targetId,
    }));
  }
}
