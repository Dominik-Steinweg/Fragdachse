import type { EnemyManager } from '../entities/EnemyManager';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { PlayerManager } from '../entities/PlayerManager';
import type { TrackedProjectile, SyncedAk47StrategicTarget } from '../types';
import type { CombatSystem, Ak47DirectEnemyHitImpact } from './CombatSystem';
import type { LoadoutManager } from '../loadout/LoadoutManager';
import { getCoopDefenseEnemyXp } from '../config/coopDefenseEnemies';

const TARGET_RESELECT_DEBOUNCE_MS = 200;
const TARGET_HIT_CONFIRMATION_MS = 150;
const CURSOR_DISTANCE_PX = 1_000;

const EXPLOSION_BY_LEVEL = [
  { radius: 0, fraction: 0 },
  { radius: 35, fraction: 0.2 },
  { radius: 50, fraction: 0.3 },
  { radius: 65, fraction: 0.4 },
] as const;

interface StrategicTargetState {
  targetId: string | null;
  noTargetUntil: number;
  deathHandledTargetId: string | null;
  confirmationUntil: number;
}

interface Candidate {
  enemy: EnemyEntity;
  cursorDistance: number;
  visible: boolean;
  strength: number;
}

/** Host-authoritative AK target state; the renderer only consumes its compact snapshot. */
export class Ak47StrategicTargetSystem {
  private readonly states = new Map<string, StrategicTargetState>();

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly enemyManager: EnemyManager,
    private readonly combatSystem: CombatSystem,
    private readonly loadoutManager: LoadoutManager,
  ) {}

  hostUpdate(now: number): void {
    for (const player of this.playerManager.getAllPlayers()) {
      const focus = this.loadoutManager.getEquippedWeaponConfig(player.id, 'weapon2')?.ak47Focus;
      if (!focus || focus.strategicTargetEnabled <= 0) {
        this.states.delete(player.id);
        continue;
      }

      const state = this.states.get(player.id) ?? this.createState(now);
      this.states.set(player.id, state);

      if (state.targetId && !this.isLivingEnemy(state.targetId)) {
        this.handleMarkedTargetDeath(state, now);
      }

      if (state.targetId === null && now >= state.noTargetUntil) {
        state.targetId = this.chooseTarget(player.id, focus.targetPrioritizationEnabled > 0);
        state.deathHandledTargetId = null;
      }
    }
  }

  handleDirectAk47EnemyHit(projectile: TrackedProjectile, enemyId: string, now = Date.now()): Ak47DirectEnemyHitImpact | null {
    const state = this.states.get(projectile.ownerId);
    const focus = this.loadoutManager.getEquippedWeaponConfig(projectile.ownerId, 'weapon2')?.ak47Focus;
    if (
      !state
      || !focus
      || focus.strategicTargetEnabled <= 0
      || state.targetId !== enemyId
    ) return null;

    state.confirmationUntil = now + TARGET_HIT_CONFIRMATION_MS;
    this.loadoutManager.registerAk47StrategicTargetHit(projectile, enemyId);
    const explosion = EXPLOSION_BY_LEVEL[Math.max(0, Math.min(
      EXPLOSION_BY_LEVEL.length - 1,
      Math.round(focus.explosiveTargetAcquisitionLevel),
    ))];
    return {
      damageMultiplier: 1 + Math.max(0, focus.strategicTargetDamageBonus),
      explosionRadius: explosion.radius,
      explosionDamageFraction: explosion.fraction,
    };
  }

  isCurrentTarget(playerId: string, enemyId: string, now = Date.now()): boolean {
    const state = this.states.get(playerId);
    void now;
    return !!state && state.targetId === enemyId;
  }

  getNetSnapshot(now = Date.now()): SyncedAk47StrategicTarget[] {
    const result: SyncedAk47StrategicTarget[] = [];
    for (const [ownerId, state] of this.states) {
      if (state.targetId === null) continue;
      result.push({
        ownerId,
        enemyId: state.targetId,
        confirmationUntil: state.confirmationUntil,
      });
    }
    void now;
    return result;
  }

  clear(): void {
    this.states.clear();
  }

  private createState(now: number): StrategicTargetState {
    void now;
    return {
      targetId: null,
      noTargetUntil: 0,
      deathHandledTargetId: null,
      confirmationUntil: 0,
    };
  }

  private handleMarkedTargetDeath(state: StrategicTargetState, now: number): void {
    if (state.targetId === null || state.deathHandledTargetId === state.targetId) return;
    state.deathHandledTargetId = state.targetId;
    state.targetId = null;
    state.noTargetUntil = now + TARGET_RESELECT_DEBOUNCE_MS;
    state.confirmationUntil = 0;
  }

  private chooseTarget(playerId: string, prioritized: boolean): string | null {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return null;
    const candidates = this.getCandidates(playerId, player.sprite.x, player.sprite.y, player.sprite.rotation);
    if (candidates.length === 0) return null;

    if (!prioritized) {
      const visible = candidates.filter(candidate => candidate.visible);
      const pool = visible.length > 0 ? visible : candidates;
      return pool[Math.floor(Math.random() * pool.length)]?.enemy.id ?? null;
    }

    candidates.sort((left, right) => {
      const tolerance = Math.max(48, Math.min(left.cursorDistance, right.cursorDistance) * 0.15);
      if (Math.abs(left.cursorDistance - right.cursorDistance) > tolerance) {
        return left.cursorDistance - right.cursorDistance;
      }
      if (left.visible !== right.visible) return left.visible ? -1 : 1;
      if (left.strength !== right.strength) return right.strength - left.strength;
      return left.enemy.id.localeCompare(right.enemy.id);
    });
    return candidates[0]?.enemy.id ?? null;
  }

  private getCandidates(playerId: string, playerX: number, playerY: number, rotation: number): Candidate[] {
    const cursorX = playerX + Math.cos(rotation) * CURSOR_DISTANCE_PX;
    const cursorY = playerY + Math.sin(rotation) * CURSOR_DISTANCE_PX;
    return this.enemyManager.getAllEnemies()
      .filter(enemy => this.isLivingEnemy(enemy.id) && this.combatSystem.canDamageTarget(playerId, enemy.id))
      .map(enemy => ({
        enemy,
        cursorDistance: Math.hypot(enemy.sprite.x - cursorX, enemy.sprite.y - cursorY),
        visible: this.combatSystem.hasLineOfSight(playerX, playerY, enemy.sprite.x, enemy.sprite.y),
        strength: getCoopDefenseEnemyXp(enemy.kind),
      }));
  }

  private isLivingEnemy(enemyId: string): boolean {
    const enemy = this.enemyManager.getEnemy(enemyId);
    return !!enemy && enemy.sprite.active && enemy.getHp() > 0 && !enemy.isBurrowed();
  }
}
