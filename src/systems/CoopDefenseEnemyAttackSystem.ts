import * as Phaser from 'phaser';
import type { BaseManager } from '../entities/BaseManager';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { BaseWeapon } from '../loadout/BaseWeapon';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import type { CombatSystem } from './CombatSystem';
import { COLORS, PLAYER_SIZE } from '../config';

interface EnemyAttackCandidate {
  readonly priority: 1 | 2 | 3;
  readonly distance: number;
  readonly targetX: number;
  readonly targetY: number;
}

export class CoopDefenseEnemyAttackSystem {
  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly playerManager: PlayerManager,
    private readonly baseManager: BaseManager,
    private readonly combatSystem: CombatSystem,
    private readonly loadoutManager: LoadoutManager,
    private readonly getRockObjects: () => readonly (Phaser.GameObjects.Image | null)[] | null,
  ) {}

  hostUpdate(delta: number, now: number): void {
    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (!enemy.sprite.active) continue;
      enemy.decayWeaponSpread(delta, now);

      if (!enemy.canScanForAttack(now)) continue;

      enemy.scheduleNextAttackScan(now);
      const attack = this.selectAttack(enemy, now);
      if (!attack) continue;

      const { weapon, target } = attack;

      const angle = Phaser.Math.Angle.Between(enemy.sprite.x, enemy.sprite.y, target.targetX, target.targetY);
      enemy.faceAngle(angle);
      enemy.pauseAttackMovement(now);

      const didFire = this.loadoutManager.fireAutomatedWeapon(
        weapon.config,
        enemy.sprite.x,
        enemy.sprite.y,
        angle,
        target.targetX,
        target.targetY,
        enemy.id,
        COLORS.RED_2,
      );
      if (didFire) {
        enemy.recordWeaponUse(weapon, now);
      }
    }
  }

  private selectAttack(enemy: EnemyEntity, now: number): SelectedEnemyAttack | null {
    // Reihenfolge ist Absicht: Der zuerst konfigurierte Biss gewinnt im
    // absoluten Nahbereich, erst danach kommt eine moegliche Fernkampfwaffe.
    for (const attackWeapon of enemy.getAttackWeapons()) {
      const weapon = attackWeapon.weapon;
      if (weapon.config.fire.type === 'healing_aura' || weapon.config.fire.type === 'tesla_dome') continue;
      const target = attackWeapon.targetMode === 'players'
        ? this.findNearestPlayerTarget(enemy, weapon.config.range)
        : this.selectTarget(enemy, weapon.config.range);
      if (!target) continue;
      // Existiert ein Ziel fuer eine hoeher priorisierte Waffe, wartet der
      // Gegner deren Cooldown ab, statt im Nahkampf auf Fernkampf zu wechseln.
      if (!enemy.isWeaponReady(weapon, now)) return null;
      return { weapon, target };
    }

    return null;
  }

  private selectTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    let best = this.findNearestBaseTarget(enemy, range);

    const obstacle = this.findNearestObstacleTarget(enemy, range);
    if (this.isBetterCandidate(obstacle, best)) {
      best = obstacle;
    }

    const player = this.findNearestPlayerTarget(enemy, range);
    if (this.isBetterCandidate(player, best)) {
      best = player;
    }

    return best;
  }

  private findNearestBaseTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    let best: EnemyAttackCandidate | null = null;

    for (const base of this.baseManager.getBases()) {
      if (base.getHp() <= 0) continue;

      const surface = base.getNearestSurfacePoint(enemy.sprite.x, enemy.sprite.y);
      if (!surface) continue;
      const targetX = surface.x;
      const targetY = surface.y;
      const distance = surface.distance;
      if (distance > range) continue;
      if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, targetX, targetY)) continue;

      const candidate: EnemyAttackCandidate = { priority: 1, distance, targetX, targetY };
      if (this.isBetterCandidate(candidate, best)) {
        best = candidate;
      }
    }

    return best;
  }

  private findNearestObstacleTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    let best: EnemyAttackCandidate | null = null;
    const rockObjects = this.getRockObjects() ?? [];

    for (let index = 0; index < rockObjects.length; index += 1) {
      const rock = rockObjects[index];
      if (!rock?.active) continue;

      const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, rock.x, rock.y);
      if (distance > range) continue;
      if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, rock.x, rock.y, index)) continue;

      const candidate: EnemyAttackCandidate = {
        priority: 2,
        distance,
        targetX: rock.x,
        targetY: rock.y,
      };
      if (this.isBetterCandidate(candidate, best)) {
        best = candidate;
      }
    }

    return best;
  }

  private findNearestPlayerTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    let best: EnemyAttackCandidate | null = null;

    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.sprite.active) continue;
      if (!this.combatSystem.isAlive(player.id)) continue;
      if (this.combatSystem.isBurrowed(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(enemy.id, player.id)) continue;

      const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y);
      if (distance > range + PLAYER_SIZE * 0.5) continue;
      if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y)) continue;

      const candidate: EnemyAttackCandidate = {
        priority: 3,
        distance,
        targetX: player.sprite.x,
        targetY: player.sprite.y,
      };
      if (this.isBetterCandidate(candidate, best)) {
        best = candidate;
      }
    }

    return best;
  }

  private isBetterCandidate(candidate: EnemyAttackCandidate | null, current: EnemyAttackCandidate | null): boolean {
    if (!candidate) return false;
    if (!current) return true;
    if (candidate.priority !== current.priority) {
      return candidate.priority < current.priority;
    }
    return candidate.distance < current.distance;
  }
}

interface SelectedEnemyAttack {
  readonly weapon: BaseWeapon;
  readonly target: EnemyAttackCandidate;
}
