import * as Phaser from 'phaser';
import { COLORS } from '../config';
import { getCoopDefenseEnemyXp, type CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyDeathInfo, EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import type { CombatSystem } from './CombatSystem';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';

const STAT_PREFIX = 'player.necromancy';
const DEFAULT_INTERVAL_MS = 4000;
const DEFAULT_CORPSE_LIFETIME_MS = 6000;
const DEFAULT_REVIVE_RADIUS = 300;
const DEFAULT_TARGET_RADIUS = 350;
const DEFAULT_LEASH_RADIUS = 500;
const STEER_RESPONSIVENESS = 9;

export type NecromancyStatResolver = (playerId: string, stat: string, baseValue: number) => number;

interface CorpseRecord {
  readonly kind: CoopDefenseEnemyKind;
  readonly x: number;
  readonly y: number;
  readonly xp: number;
  readonly diedAt: number;
  readonly expiresAt: number;
}

interface OwnerState {
  nextRaiseAt: number;
}

interface NecromancyConfig {
  enabled: boolean;
  maxAllies: number;
  hpMultiplier: number;
  moveSpeedMultiplier: number;
  hpRegenPerSecond: number;
  intervalMs: number;
  corpseLifetimeMs: number;
  reviveRadius: number;
  targetRadius: number;
  leashRadius: number;
}

/** Host-authoritative summons for the Nekromantie boss upgrade. */
export class NecromancySystem {
  private readonly corpses: CorpseRecord[] = [];
  private readonly owners = new Map<string, OwnerState>();

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly enemyManager: EnemyManager,
    private readonly combatSystem: CombatSystem,
    private readonly loadoutManager: LoadoutManager,
    private readonly homeFlowFields: ReadonlyMap<string, EnemyFlowFieldService>,
    private readonly resolveStat: NecromancyStatResolver,
  ) {}

  recordEnemyDeath(death: EnemyDeathInfo, now = Date.now()): void {
    if (death.faction !== 'hostile') return;
    this.corpses.push({
      kind: death.kind,
      x: death.x,
      y: death.y,
      xp: getCoopDefenseEnemyXp(death.kind),
      diedAt: now,
      expiresAt: now + DEFAULT_CORPSE_LIFETIME_MS,
    });
  }

  hostUpdate(now: number, deltaMs: number): void {
    this.pruneExpiredCorpses(now);
    const activeOwners = new Set<string>();

    for (const player of this.playerManager.getAllPlayers()) {
      const cfg = this.resolveConfig(player.id);
      const alive = player.sprite.active && this.combatSystem.isAlive(player.id);
      if (!cfg.enabled || !alive) {
        this.clearOwner(player.id);
        continue;
      }

      activeOwners.add(player.id);
      const owner = this.owners.get(player.id) ?? { nextRaiseAt: now };
      this.owners.set(player.id, owner);

      if (now >= owner.nextRaiseAt && this.enemyManager.getAlliedEnemies(player.id).length < cfg.maxAllies) {
        const corpseIndex = this.findBestCorpseIndex(player.sprite.x, player.sprite.y, cfg.reviveRadius);
        if (corpseIndex >= 0) {
          const [corpse] = this.corpses.splice(corpseIndex, 1);
          this.enemyManager.hostSpawnAllyAtWorld(corpse.x, corpse.y, corpse.kind, player.id, player.color, cfg.hpMultiplier);
        }
        owner.nextRaiseAt = now + cfg.intervalMs;
      }

      for (const ally of this.enemyManager.getAlliedEnemies(player.id)) {
        this.updateAlly(ally, player.id, player.sprite.x, player.sprite.y, player.color, cfg, now, deltaMs);
      }
    }

    for (const ownerId of [...this.owners.keys()]) {
      if (activeOwners.has(ownerId)) continue;
      this.clearOwner(ownerId);
    }
  }

  clear(): void {
    this.corpses.length = 0;
    for (const ownerId of [...this.owners.keys()]) this.clearOwner(ownerId);
    this.owners.clear();
  }

  private updateAlly(
    ally: EnemyEntity,
    ownerId: string,
    ownerX: number,
    ownerY: number,
    ownerColor: number,
    cfg: NecromancyConfig,
    now: number,
    deltaMs: number,
  ): void {
    ally.setMoveSpeedMultiplier(cfg.moveSpeedMultiplier);
    if (cfg.hpRegenPerSecond > 0 && ally.getHp() > 0 && ally.getHp() < ally.getMaxHp()) {
      ally.setHp(Math.min(ally.getMaxHp(), ally.getHp() + cfg.hpRegenPerSecond * Math.max(0, deltaMs) / 1000));
    }
    const target = this.findTarget(ownerX, ownerY, cfg.targetRadius);
    const ownerDistance = Phaser.Math.Distance.Between(ally.sprite.x, ally.sprite.y, ownerX, ownerY);
    const targetInLeash = target
      && Phaser.Math.Distance.Between(target.sprite.x, target.sprite.y, ownerX, ownerY) <= cfg.leashRadius;
    const returningHome = ownerDistance > cfg.leashRadius || !targetInLeash;
    const destination = returningHome ? { x: ownerX, y: ownerY, target: undefined } : {
      x: target.sprite.x,
      y: target.sprite.y,
      target,
    };

    if (!ally.isAttackMovementPaused(now)) {
      const dx = destination.x - ally.sprite.x;
      const dy = destination.y - ally.sprite.y;
      const length = Math.hypot(dx, dy);
      if (length > 8) {
        const homeVector = returningHome ? this.getHomeVector(ownerId, ally) : null;
        const desiredVx = (homeVector?.x ?? dx / length) * ally.getMoveSpeed();
        const desiredVy = (homeVector?.y ?? dy / length) * ally.getMoveSpeed();
        const current = ally.getDesiredVelocity();
        const lerp = 1 - Math.exp(-STEER_RESPONSIVENESS * Math.min(100, Math.max(0, deltaMs)) / 1000);
        ally.setDesiredVelocity(
          Phaser.Math.Linear(current.vx, desiredVx, lerp),
          Phaser.Math.Linear(current.vy, desiredVy, lerp),
        );
      } else {
        ally.stopMovement();
      }
    }

    if (!destination.target || !ally.canScanForAttack(now)) return;
    ally.scheduleNextAttackScan(now);
    for (const attackWeapon of ally.getAttackWeapons()) {
      const weapon = attackWeapon.weapon;
      if (weapon.config.fire.type === 'healing_aura' || weapon.config.fire.type === 'tesla_dome') continue;
      const distance = Phaser.Math.Distance.Between(ally.sprite.x, ally.sprite.y, destination.target.sprite.x, destination.target.sprite.y);
      if (distance > weapon.config.range || !this.combatSystem.hasLineOfSight(ally.sprite.x, ally.sprite.y, destination.target.sprite.x, destination.target.sprite.y)) continue;
      if (!ally.isWeaponReady(weapon, now)) return;
      const angle = Phaser.Math.Angle.Between(ally.sprite.x, ally.sprite.y, destination.target.sprite.x, destination.target.sprite.y);
      if (!this.loadoutManager.fireAutomatedWeapon(
        weapon.config,
        ally.sprite.x,
        ally.sprite.y,
        angle,
        destination.target.sprite.x,
        destination.target.sprite.y,
        ally.id,
        ownerColor || COLORS.GREEN_2,
      )) return;
      ally.faceAngle(angle);
      ally.pauseAttackMovement(now);
      ally.recordWeaponUse(weapon, now);
      return;
    }
  }

  private findTarget(ownerX: number, ownerY: number, radius: number): EnemyEntity | null {
    let best: EnemyEntity | null = null;
    let bestDistance = radius;
    for (const enemy of this.enemyManager.getHostileEnemies()) {
      if (!enemy.sprite.active || !this.combatSystem.isAlive(enemy.id)) continue;
      const distance = Phaser.Math.Distance.Between(ownerX, ownerY, enemy.sprite.x, enemy.sprite.y);
      if (distance > bestDistance) continue;
      best = enemy;
      bestDistance = distance;
    }
    return best;
  }

  private getHomeVector(ownerId: string, ally: EnemyEntity): { x: number; y: number } | null {
    const flowField = this.homeFlowFields.get(ownerId);
    if (!flowField) return null;
    const cell = flowField.worldToGrid(ally.sprite.x, ally.sprite.y);
    if (!cell) return null;
    if (flowField.getIntegrationValueAt(cell.gridX, cell.gridY) >= EnemyFlowFieldService.INTEGRATION_INFINITY) return null;
    const vector = flowField.getVectorAt(cell.gridX, cell.gridY);
    return vector.x === 0 && vector.y === 0 ? null : vector;
  }

  private findBestCorpseIndex(ownerX: number, ownerY: number, radius: number): number {
    let bestIndex = -1;
    for (let index = 0; index < this.corpses.length; index += 1) {
      const candidate = this.corpses[index];
      const candidateDistance = Phaser.Math.Distance.Between(ownerX, ownerY, candidate.x, candidate.y);
      if (candidateDistance > radius) continue;
      if (bestIndex < 0) {
        bestIndex = index;
        continue;
      }
      const best = this.corpses[bestIndex];
      const bestDistance = Phaser.Math.Distance.Between(ownerX, ownerY, best.x, best.y);
      if (candidate.xp > best.xp || (candidate.xp === best.xp && (candidateDistance < bestDistance || (candidateDistance === bestDistance && candidate.diedAt < best.diedAt)))) {
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  private pruneExpiredCorpses(now: number): void {
    for (let index = this.corpses.length - 1; index >= 0; index -= 1) {
      if (now >= this.corpses[index].expiresAt) this.corpses.splice(index, 1);
    }
  }

  private clearOwner(ownerId: string): void {
    for (const ally of this.enemyManager.getAlliedEnemies(ownerId)) this.enemyManager.hostRemoveEnemy(ally.id);
    this.owners.delete(ownerId);
  }

  private resolveConfig(playerId: string): NecromancyConfig {
    return {
      enabled: this.resolveStat(playerId, `${STAT_PREFIX}.enabled`, 0) > 0,
      maxAllies: Math.max(0, Math.floor(this.resolveStat(playerId, `${STAT_PREFIX}.maxAllies`, 0))),
      hpMultiplier: Math.max(1, this.resolveStat(playerId, `${STAT_PREFIX}.hpMultiplier`, 1)),
      moveSpeedMultiplier: Math.max(0, this.resolveStat(playerId, `${STAT_PREFIX}.moveSpeedMultiplier`, 1)),
      hpRegenPerSecond: Math.max(0, this.resolveStat(playerId, `${STAT_PREFIX}.hpRegenPerSecond`, 0)),
      intervalMs: Math.max(100, this.resolveStat(playerId, `${STAT_PREFIX}.intervalMs`, DEFAULT_INTERVAL_MS)),
      corpseLifetimeMs: Math.max(100, this.resolveStat(playerId, `${STAT_PREFIX}.corpseLifetimeMs`, DEFAULT_CORPSE_LIFETIME_MS)),
      reviveRadius: this.resolveStat(playerId, `${STAT_PREFIX}.reviveRadius`, DEFAULT_REVIVE_RADIUS),
      targetRadius: this.resolveStat(playerId, `${STAT_PREFIX}.targetRadius`, DEFAULT_TARGET_RADIUS),
      leashRadius: this.resolveStat(playerId, `${STAT_PREFIX}.leashRadius`, DEFAULT_LEASH_RADIUS),
    };
  }
}
