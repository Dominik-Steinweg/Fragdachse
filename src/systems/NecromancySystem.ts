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
const DEFAULT_TELEPORT_DISTANCE = 1200;
const TELEPORT_SEARCH_RADIUS_CELLS = 3;
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
  teleportDistance: number;
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
    private readonly allyFlowFields: ReadonlyMap<string, EnemyFlowFieldService>,
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

      const allies = this.enemyManager.getAlliedEnemies(player.id);
      for (const ally of allies) {
        this.prepareAlly(ally, player.id, player.sprite.x, player.sprite.y, cfg, deltaMs);
      }

      const target = this.findTarget(player.sprite.x, player.sprite.y, cfg.targetRadius);
      const targetInLeash = target
        && Phaser.Math.Distance.Between(target.sprite.x, target.sprite.y, player.sprite.x, player.sprite.y) <= cfg.leashRadius;
      // Ein Flowfield wird pro Besitzer geteilt. Wenn auch nur ein Mitglied der
      // Gruppe die Leash verlassen hat, kehrt deshalb die ganze Gruppe kurz zum
      // Besitzer zurueck. So zeigen Navigation und tatsaechliches Ziel immer auf
      // dieselbe Position.
      const returningHome = !targetInLeash || allies.some((ally) => (
        Phaser.Math.Distance.Between(ally.sprite.x, ally.sprite.y, player.sprite.x, player.sprite.y) > cfg.leashRadius
      ));
      const destination = returningHome
        ? { x: player.sprite.x, y: player.sprite.y, target: undefined }
        : { x: target.sprite.x, y: target.sprite.y, target };

      this.updateFlowFieldGoal(player.id, destination.x, destination.y, now);
      for (const ally of allies) {
        this.updateAlly(ally, player.id, player.color, destination, now, deltaMs);
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
    ownerColor: number,
    destination: { x: number; y: number; target?: EnemyEntity },
    now: number,
    deltaMs: number,
  ): void {
    if (!ally.isAttackMovementPaused(now)) {
      const dx = destination.x - ally.sprite.x;
      const dy = destination.y - ally.sprite.y;
      const length = Math.hypot(dx, dy);
      if (length > 8) {
        const flowDirection = this.getFlowDirection(ownerId, ally);
        if (flowDirection === null) {
          ally.stopMovement();
        } else {
          const desiredVx = (flowDirection?.x ?? dx / length) * ally.getMoveSpeed();
          const desiredVy = (flowDirection?.y ?? dy / length) * ally.getMoveSpeed();
          const current = ally.getDesiredVelocity();
          const lerp = 1 - Math.exp(-STEER_RESPONSIVENESS * Math.min(100, Math.max(0, deltaMs)) / 1000);
          ally.setDesiredVelocity(
            Phaser.Math.Linear(current.vx, desiredVx, lerp),
            Phaser.Math.Linear(current.vy, desiredVy, lerp),
          );
        }
      } else {
        ally.stopMovement();
      }
    }

    if (!destination.target?.sprite.active || !this.combatSystem.isAlive(destination.target.id) || !ally.canScanForAttack(now)) return;
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

  private prepareAlly(
    ally: EnemyEntity,
    ownerId: string,
    ownerX: number,
    ownerY: number,
    cfg: NecromancyConfig,
    deltaMs: number,
  ): void {
    ally.setMoveSpeedMultiplier(cfg.moveSpeedMultiplier);
    if (cfg.hpRegenPerSecond > 0 && ally.getHp() > 0 && ally.getHp() < ally.getMaxHp()) {
      ally.setHp(Math.min(ally.getMaxHp(), ally.getHp() + cfg.hpRegenPerSecond * Math.max(0, deltaMs) / 1000));
    }

    if (Phaser.Math.Distance.Between(ally.sprite.x, ally.sprite.y, ownerX, ownerY) <= cfg.teleportDistance) return;
    const fallback = this.findTeleportPosition(ownerId, ownerX, ownerY);
    ally.stopMovement();
    ally.setPosition(fallback.x, fallback.y);
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

  private updateFlowFieldGoal(ownerId: string, worldX: number, worldY: number, now: number): void {
    const flowField = this.allyFlowFields.get(ownerId);
    if (!flowField) return;
    const goal = flowField.worldToGrid(worldX, worldY);
    flowField.setDynamicGoalCells(goal ? [goal] : []);
    flowField.update(now);
  }

  /**
   * Nutzt dieselben Integrationswerte und Richtungsvektoren wie normale Gegner.
   * undefined bedeutet: Zielzelle erreicht, die letzten Pixel direkt laufen.
   * null bedeutet: kein erreichbarer Pfad; nicht blind durch Hindernisse steuern.
   */
  private getFlowDirection(ownerId: string, ally: EnemyEntity): { x: number; y: number } | null | undefined {
    const flowField = this.allyFlowFields.get(ownerId);
    if (!flowField) return undefined;
    const cell = flowField.worldToGrid(ally.sprite.x, ally.sprite.y);
    if (!cell) return undefined;
    const integration = flowField.getIntegrationValueAt(cell.gridX, cell.gridY);
    if (integration >= EnemyFlowFieldService.INTEGRATION_INFINITY) {
      const recovery = flowField.findNearestReachableWorldPosition(cell.gridX, cell.gridY);
      if (!recovery) return null;
      const dx = recovery.x - ally.sprite.x;
      const dy = recovery.y - ally.sprite.y;
      const length = Math.hypot(dx, dy);
      return length > 0.001 ? { x: dx / length, y: dy / length } : null;
    }
    if (integration <= 0) return undefined;
    const vector = flowField.getVectorAt(cell.gridX, cell.gridY);
    if (vector.x === 0 && vector.y === 0) return null;
    if (!ally.isBoss()) return vector;
    const waypoint = flowField.getNextCellWorldPosition(cell.gridX, cell.gridY);
    if (!waypoint) return vector;
    const dx = waypoint.x - ally.sprite.x;
    const dy = waypoint.y - ally.sprite.y;
    const length = Math.hypot(dx, dy);
    return length > 0.001 ? { x: dx / length, y: dy / length } : vector;
  }

  private findTeleportPosition(ownerId: string, ownerX: number, ownerY: number): { x: number; y: number } {
    const flowField = this.allyFlowFields.get(ownerId);
    const ownerCell = flowField?.worldToGrid(ownerX, ownerY);
    if (!flowField || !ownerCell) return { x: ownerX, y: ownerY };

    for (let radius = 1; radius <= TELEPORT_SEARCH_RADIUS_CELLS; radius += 1) {
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
          const gridX = ownerCell.gridX + offsetX;
          const gridY = ownerCell.gridY + offsetY;
          if (!flowField.isTraversableAt(gridX, gridY)) continue;
          const world = flowField.gridToWorld(gridX, gridY);
          if (world) return world;
        }
      }
    }

    return { x: ownerX, y: ownerY };
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
    const leashRadius = Math.max(0, this.resolveStat(playerId, `${STAT_PREFIX}.leashRadius`, DEFAULT_LEASH_RADIUS));
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
      leashRadius,
      teleportDistance: Math.max(
        leashRadius,
        this.resolveStat(playerId, `${STAT_PREFIX}.teleportDistance`, DEFAULT_TELEPORT_DISTANCE),
      ),
    };
  }
}
