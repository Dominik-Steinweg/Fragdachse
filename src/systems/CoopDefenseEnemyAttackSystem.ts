import * as Phaser from 'phaser';
import type { BaseManager } from '../entities/BaseManager';
import type { EnemyAttackWeapon, EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import type { CombatSystem } from './CombatSystem';
import type { CoopDefenseEnemyTrainAwarenessSystem } from './CoopDefenseEnemyTrainAwarenessSystem';
import { COLORS, PLAYER_SIZE } from '../config';

type EnemyAttackTargetKind = 'base' | 'player' | 'ally' | 'train' | 'obstacle';

interface EnemyAttackCandidate {
  readonly kind: EnemyAttackTargetKind;
  readonly priority: 1 | 2 | 3 | 4;
  readonly distance: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetId?: string;
  readonly obstacle?: Phaser.GameObjects.Image;
}

interface SustainedEnemyAttackState {
  readonly weaponId: string;
  readonly targetId: string;
  targetX: number;
  targetY: number;
  readonly fireUntil: number;
  lastShotAt: number;
}

interface MeleeWindupState {
  readonly weaponId: string;
  readonly targetId: string;
  readonly aimAngle: number;
  readonly executeAt: number;
}

interface EnemyMovementProgressState {
  anchorX: number;
  anchorY: number;
  lastProgressAt: number;
  clearingObstacle: Phaser.GameObjects.Image | null;
}

interface EnemyObstacleContactState {
  readonly obstacle: Phaser.GameObjects.Image;
  readonly lastContactAt: number;
}

export class CoopDefenseEnemyAttackSystem {
  private static readonly MOVEMENT_PROGRESS_DISTANCE_PX = 4;
  private static readonly OBSTACLE_CONTACT_FRESHNESS_MS = 150;

  private readonly sustainedAttacks = new Map<string, SustainedEnemyAttackState>();
  private readonly meleeWindups = new Map<string, MeleeWindupState>();
  private readonly movementProgress = new Map<string, EnemyMovementProgressState>();
  private readonly obstacleContacts = new Map<string, EnemyObstacleContactState>();

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly playerManager: PlayerManager,
    private readonly baseManager: BaseManager,
    private readonly combatSystem: CombatSystem,
    private readonly loadoutManager: LoadoutManager,
    private readonly getRockObjects: () => readonly (Phaser.GameObjects.Image | null)[] | null,
    private readonly trainAwarenessSystem: CoopDefenseEnemyTrainAwarenessSystem | null = null,
  ) {}

  recordObstacleContact(enemyId: string, obstacle: Phaser.GameObjects.Image, now: number): void {
    if (!obstacle.active || !this.enemyManager.hasEnemy(enemyId)) return;
    this.obstacleContacts.set(enemyId, { obstacle, lastContactAt: now });
  }

  hostUpdate(delta: number, now: number): void {
    const activeEnemyIds = new Set<string>();
    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (!enemy.sprite.active) continue;
      if (enemy.faction !== 'hostile') continue;
      activeEnemyIds.add(enemy.id);
      enemy.decayWeaponSpread(delta, now);

      if (this.enemyManager.isEnemyPanicking(enemy.id)) {
        this.sustainedAttacks.delete(enemy.id);
        this.meleeWindups.delete(enemy.id);
        this.obstacleContacts.delete(enemy.id);
        this.resetMovementProgress(enemy, now);
        continue;
      }

      if (this.trainAwarenessSystem?.blocksRegularAttacks(enemy.id)) {
        this.sustainedAttacks.delete(enemy.id);
        this.meleeWindups.delete(enemy.id);
        this.obstacleContacts.delete(enemy.id);
        this.resetMovementProgress(enemy, now);
        continue;
      }

      if (this.meleeWindups.has(enemy.id)) {
        this.resetMovementProgress(enemy, now);
        this.updateMeleeWindup(enemy, now);
        continue;
      }

      this.updateMovementProgress(enemy, now);

      if (!enemy.canScanForAttack(now)) continue;

      enemy.scheduleNextAttackScan(now);
      const sustained = this.getSustainedAttack(enemy, now);
      const attack = sustained.active ? sustained.attack : this.selectAttack(enemy, now);
      if (!attack) continue;

      if (this.shouldStartMeleeWindup(attack)) {
        this.startMeleeWindup(enemy, attack, now);
        continue;
      }

      this.fireAttack(enemy, attack, now);
    }

    this.cleanupInactiveEnemies(activeEnemyIds);
  }

  private shouldStartMeleeWindup(attack: SelectedEnemyAttack): boolean {
    return attack.target.kind === 'player'
      && attack.attackWeapon.weapon.config.fire.type === 'melee'
      && attack.attackWeapon.playerMeleeWindupMs > 0
      && attack.target.targetId !== undefined;
  }

  private startMeleeWindup(enemy: EnemyEntity, attack: SelectedEnemyAttack, now: number): void {
    const targetId = attack.target.targetId;
    if (!targetId) return;

    const aimAngle = Phaser.Math.Angle.Between(
      enemy.sprite.x,
      enemy.sprite.y,
      attack.target.targetX,
      attack.target.targetY,
    );
    this.meleeWindups.set(enemy.id, {
      weaponId: attack.attackWeapon.weapon.config.id,
      targetId,
      aimAngle,
      executeAt: now + attack.attackWeapon.playerMeleeWindupMs,
    });
    this.resetMovementProgress(enemy, now);
    enemy.stopMovement();
    enemy.faceAngle(aimAngle);
  }

  private updateMeleeWindup(enemy: EnemyEntity, now: number): void {
    const state = this.meleeWindups.get(enemy.id);
    if (!state) return;

    const attackWeapon = enemy.getAttackWeapons().find(candidate => candidate.weapon.config.id === state.weaponId);
    const player = this.playerManager.getPlayer(state.targetId);
    if (
      !attackWeapon
      || attackWeapon.weapon.config.fire.type !== 'melee'
      || !player
      || !this.isValidPlayerTarget(enemy, player.id, attackWeapon.weapon.config.range)
    ) {
      this.meleeWindups.delete(enemy.id);
      return;
    }

    enemy.stopMovement();
    enemy.faceAngle(state.aimAngle);
    if (now < state.executeAt) return;

    this.meleeWindups.delete(enemy.id);
    if (!enemy.isWeaponReady(attackWeapon.weapon, now)) return;

    this.fireAttack(
      enemy,
      {
        attackWeapon,
        target: {
          kind: 'player',
          priority: 2,
          distance: Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y),
          targetX: player.sprite.x,
          targetY: player.sprite.y,
          targetId: player.id,
        },
      },
      now,
      state.aimAngle,
    );
  }

  private fireAttack(
    enemy: EnemyEntity,
    attack: SelectedEnemyAttack,
    now: number,
    forcedAngle?: number,
  ): void {
    const { attackWeapon, target } = attack;
    const weapon = attackWeapon.weapon;
    const angle = forcedAngle ?? Phaser.Math.Angle.Between(
      enemy.sprite.x,
      enemy.sprite.y,
      target.targetX,
      target.targetY,
    );
    enemy.faceAngle(angle);

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
    if (!didFire) return;

    enemy.pauseAttackMovement(now);
    enemy.recordWeaponUse(weapon, now);
    this.updateObstacleClearingState(enemy, target, now);

    const existingSustainedAttack = this.sustainedAttacks.get(enemy.id);
    if (existingSustainedAttack) {
      existingSustainedAttack.lastShotAt = now;
    } else if (attackWeapon.minimumFireDurationMs > 0 && target.targetId) {
      this.sustainedAttacks.set(enemy.id, {
        weaponId: weapon.config.id,
        targetId: target.targetId,
        targetX: target.targetX,
        targetY: target.targetY,
        fireUntil: now + attackWeapon.minimumFireDurationMs,
        lastShotAt: now,
      });
    }
  }

  private updateObstacleClearingState(enemy: EnemyEntity, target: EnemyAttackCandidate, now: number): void {
    if (target.kind !== 'obstacle' || !target.obstacle?.active) {
      this.resetMovementProgress(enemy, now);
      return;
    }

    const progress = this.ensureMovementProgress(enemy, now);
    progress.clearingObstacle = target.obstacle;
  }

  private selectAttack(enemy: EnemyEntity, now: number): SelectedEnemyAttack | null {
    // Die Konfigurationsreihenfolge ist zugleich die Waffenpriorität:
    // Die erste Waffe mit einem gültigen Ziel gewinnt.
    for (const attackWeapon of enemy.getAttackWeapons()) {
      const weapon = attackWeapon.weapon;
      if (weapon.config.fire.type === 'healing_aura' || weapon.config.fire.type === 'tesla_dome') continue;
      let target = attackWeapon.targetMode === 'players'
        ? this.findNearestLivingTarget(enemy, weapon.config.range)
        : attackWeapon.targetMode === 'rocks'
          ? this.findNearestObstacleTarget(enemy, weapon.config.range, now)
          : this.selectTarget(enemy, weapon.config.range, now);
      const trainTarget = (weapon.config.trainDamageMult ?? 1) > 0
        ? this.findTrainTarget(enemy, weapon.config.range)
        : null;
      if (this.isBetterCandidate(trainTarget, target)) target = trainTarget;
      if (!target) continue;
      // Existiert ein Ziel fuer eine hoeher priorisierte Waffe, wartet der
      // Gegner deren Cooldown ab, statt im Nahkampf auf Fernkampf zu wechseln.
      if (!enemy.isWeaponReady(weapon, now)) return null;
      return { attackWeapon, target };
    }

    return null;
  }

  private getSustainedAttack(
    enemy: EnemyEntity,
    now: number,
  ): { active: boolean; attack: SelectedEnemyAttack | null } {
    const state = this.sustainedAttacks.get(enemy.id);
    if (!state) return { active: false, attack: null };
    if (now >= state.fireUntil && state.lastShotAt >= state.fireUntil) {
      this.sustainedAttacks.delete(enemy.id);
      return { active: false, attack: null };
    }

    const attackWeapon = enemy.getAttackWeapons().find(candidate => candidate.weapon.config.id === state.weaponId);
    if (!attackWeapon) {
      this.sustainedAttacks.delete(enemy.id);
      return { active: false, attack: null };
    }
    if (!enemy.isWeaponReady(attackWeapon.weapon, now)) {
      return { active: true, attack: null };
    }

    const player = this.playerManager.getPlayer(state.targetId);
    if (player?.sprite.active && this.combatSystem.isAlive(player.id)) {
      state.targetX = player.sprite.x;
      state.targetY = player.sprite.y;
    } else {
      const ally = this.enemyManager.getEnemy(state.targetId);
      if (ally?.faction === 'allied' && ally.sprite.active && this.combatSystem.isAlive(ally.id)) {
        state.targetX = ally.sprite.x;
        state.targetY = ally.sprite.y;
      }
    }

    return {
      active: true,
      attack: {
        attackWeapon,
        target: {
          kind: this.enemyManager.getEnemy(state.targetId)?.faction === 'allied' ? 'ally' : 'player',
          priority: 2,
          distance: Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, state.targetX, state.targetY),
          targetX: state.targetX,
          targetY: state.targetY,
          targetId: state.targetId,
        },
      },
    };
  }

  private selectTarget(enemy: EnemyEntity, range: number, now: number): EnemyAttackCandidate | null {
    let best = this.findNearestBaseTarget(enemy, range);

    const obstacle = this.findNearestObstacleTarget(enemy, range, now);
    if (this.isBetterCandidate(obstacle, best)) {
      best = obstacle;
    }

    const livingTarget = this.findNearestLivingTarget(enemy, range);
    if (this.isBetterCandidate(livingTarget, best)) {
      best = livingTarget;
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

      const candidate: EnemyAttackCandidate = { kind: 'base', priority: 1, distance, targetX, targetY };
      if (this.isBetterCandidate(candidate, best)) {
        best = candidate;
      }
    }

    return best;
  }

  private findNearestObstacleTarget(enemy: EnemyEntity, range: number, now: number): EnemyAttackCandidate | null {
    if (!this.isObstacleAttackUnlocked(enemy, now)) return null;

    const rockObjects = this.getRockObjects() ?? [];
    const progress = this.movementProgress.get(enemy.id);
    const clearingCandidate = progress?.clearingObstacle
      ? this.buildObstacleCandidate(enemy, progress.clearingObstacle, rockObjects, range)
      : null;
    if (clearingCandidate) return clearingCandidate;

    const contact = this.obstacleContacts.get(enemy.id);
    if (contact && now - contact.lastContactAt <= CoopDefenseEnemyAttackSystem.OBSTACLE_CONTACT_FRESHNESS_MS) {
      const contactCandidate = this.buildObstacleCandidate(enemy, contact.obstacle, rockObjects, range);
      if (contactCandidate) return contactCandidate;
    } else if (contact) {
      this.obstacleContacts.delete(enemy.id);
    }

    let best: EnemyAttackCandidate | null = null;
    for (let index = 0; index < rockObjects.length; index += 1) {
      const rock = rockObjects[index];
      if (!rock?.active) continue;

      const candidate = this.buildObstacleCandidate(enemy, rock, rockObjects, range, index);
      if (candidate && this.isBetterCandidate(candidate, best)) {
        best = candidate;
      }
    }

    return best;
  }

  private buildObstacleCandidate(
    enemy: EnemyEntity,
    obstacle: Phaser.GameObjects.Image,
    rockObjects: readonly (Phaser.GameObjects.Image | null)[],
    range: number,
    knownIndex?: number,
  ): EnemyAttackCandidate | null {
    if (!obstacle.active) return null;
    const index = knownIndex ?? rockObjects.indexOf(obstacle);
    if (index < 0) return null;

    const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, obstacle.x, obstacle.y);
    if (distance > range) return null;
    if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, obstacle.x, obstacle.y, index)) return null;

    return {
      kind: 'obstacle',
      priority: 4,
      distance,
      targetX: obstacle.x,
      targetY: obstacle.y,
      obstacle,
    };
  }

  private findNearestPlayerTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    let best: EnemyAttackCandidate | null = null;

    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isValidPlayerTarget(enemy, player.id, range)) continue;

      const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y);
      const candidate: EnemyAttackCandidate = {
        kind: 'player',
        priority: 2,
        distance,
        targetX: player.sprite.x,
        targetY: player.sprite.y,
        targetId: player.id,
      };
      if (this.isBetterCandidate(candidate, best)) {
        best = candidate;
      }
    }

    return best;
  }

  private findNearestLivingTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    let best = this.findNearestPlayerTarget(enemy, range);
    for (const ally of this.enemyManager.getAlliedEnemies()) {
      if (!ally.sprite.active || !this.combatSystem.isAlive(ally.id)) continue;
      if (!this.combatSystem.canDamageTarget(enemy.id, ally.id)) continue;
      const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, ally.sprite.x, ally.sprite.y);
      if (distance > range || !this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, ally.sprite.x, ally.sprite.y)) continue;
      const candidate: EnemyAttackCandidate = {
        kind: 'ally',
        priority: 2,
        distance,
        targetX: ally.sprite.x,
        targetY: ally.sprite.y,
        targetId: ally.id,
      };
      if (this.isBetterCandidate(candidate, best)) best = candidate;
    }
    return best;
  }

  private isValidPlayerTarget(enemy: EnemyEntity, playerId: string, range: number): boolean {
    const player = this.playerManager.getPlayer(playerId);
    if (!player?.sprite.active) return false;
    if (!this.combatSystem.isAlive(player.id)) return false;
    if (this.combatSystem.isBurrowed(player.id)) return false;
    if (!this.combatSystem.canDamageTarget(enemy.id, player.id)) return false;

    const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y);
    if (distance > range + PLAYER_SIZE * 0.5) return false;
    return this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y);
  }

  private findTrainTarget(enemy: EnemyEntity, range: number): EnemyAttackCandidate | null {
    const target = this.trainAwarenessSystem?.getTrainAttackTarget(enemy);
    if (!target || target.distance > range) return null;
    if (!this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, target.x, target.y)) return null;
    return {
      kind: 'train',
      priority: 3,
      distance: target.distance,
      targetX: target.x,
      targetY: target.y,
    };
  }

  private updateMovementProgress(enemy: EnemyEntity, now: number): void {
    const progress = this.ensureMovementProgress(enemy, now);
    if (progress.clearingObstacle && !progress.clearingObstacle.active) {
      this.resetMovementProgress(enemy, now);
      return;
    }

    const movedDistance = Phaser.Math.Distance.Between(
      progress.anchorX,
      progress.anchorY,
      enemy.sprite.x,
      enemy.sprite.y,
    );
    if (movedDistance >= CoopDefenseEnemyAttackSystem.MOVEMENT_PROGRESS_DISTANCE_PX) {
      this.resetMovementProgress(enemy, now);
      return;
    }

    if (enemy.isAttackMovementPaused(now) && !progress.clearingObstacle) {
      this.resetMovementProgress(enemy, now);
    }
  }

  private isObstacleAttackUnlocked(enemy: EnemyEntity, now: number): boolean {
    const progress = this.movementProgress.get(enemy.id);
    if (!progress) return false;
    if (progress.clearingObstacle?.active) return true;
    return now - progress.lastProgressAt >= enemy.getObstacleAttackDelayMs();
  }

  private ensureMovementProgress(enemy: EnemyEntity, now: number): EnemyMovementProgressState {
    let progress = this.movementProgress.get(enemy.id);
    if (!progress) {
      progress = {
        anchorX: enemy.sprite.x,
        anchorY: enemy.sprite.y,
        lastProgressAt: now,
        clearingObstacle: null,
      };
      this.movementProgress.set(enemy.id, progress);
    }
    return progress;
  }

  private resetMovementProgress(enemy: EnemyEntity, now: number): void {
    this.movementProgress.set(enemy.id, {
      anchorX: enemy.sprite.x,
      anchorY: enemy.sprite.y,
      lastProgressAt: now,
      clearingObstacle: null,
    });
  }

  private cleanupInactiveEnemies(activeEnemyIds: ReadonlySet<string>): void {
    this.deleteInactiveEntries(this.sustainedAttacks, activeEnemyIds);
    this.deleteInactiveEntries(this.meleeWindups, activeEnemyIds);
    this.deleteInactiveEntries(this.movementProgress, activeEnemyIds);
    this.deleteInactiveEntries(this.obstacleContacts, activeEnemyIds);
  }

  private deleteInactiveEntries<T>(entries: Map<string, T>, activeEnemyIds: ReadonlySet<string>): void {
    for (const enemyId of entries.keys()) {
      if (!activeEnemyIds.has(enemyId)) entries.delete(enemyId);
    }
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
  readonly attackWeapon: EnemyAttackWeapon;
  readonly target: EnemyAttackCandidate;
}
