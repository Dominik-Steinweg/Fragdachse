import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem } from '../systems/CombatSystem';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { SyncedActiveHudBuff } from '../types';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import type {
  NegevBehaviorPort,
  NegevKillOutcome,
  NegevKillstreakExplosionEvent,
  NegevLoadoutReadPort,
  NegevShotPreparation,
} from '../loadout/NegevBehaviorPort';

interface NegevCombatState {
  kills: number;
  /** Timestamp of the last successfully dispatched Negev shot. */
  lastShotAt: number;
}

type CombatReactions = Pick<CombatSystem, 'addArmor' | 'heal' | 'applyAoeDamage'>;
type PhysicsReactions = Pick<HostPhysicsSystem, 'applyRadialImpulse'>;

export interface NegevBehaviorRuntimeOptions {
  readonly loadout: NegevLoadoutReadPort;
  readonly playerManager: Pick<PlayerManager, 'getPlayer'>;
  readonly combatSystem: CombatReactions;
  readonly physicsSystem: PhysicsReactions;
  readonly onKillstreakExplosion?: (event: NegevKillstreakExplosionEvent) => void;
}

/** Host-owned Negev killstreak behavior and its post-streak reaction. */
export class NegevBehaviorRuntime implements NegevBehaviorPort {
  static readonly NEGEV_STREAK_GAP_MS = 300;
  static readonly NEGEV_STREAK_FULL_INTENSITY_KILLS = 15;

  private readonly states = new Map<string, NegevCombatState>();
  private destroyed = false;

  constructor(private readonly options: NegevBehaviorRuntimeOptions) {}

  prepareShot(playerId: string, config: WeaponConfig): NegevShotPreparation | null {
    if (this.destroyed || config.id !== 'NEGEV' || !config.negevKillstreak) return null;

    const state = this.getOrCreateState(playerId);
    const damageMultiplier = 1 + state.kills * config.negevKillstreak.damageBonusPerKill;
    if (damageMultiplier <= 1) {
      return { shotConfig: config, damageMultiplier };
    }

    return {
      damageMultiplier,
      shotConfig: {
        ...config,
        damage: config.damage * damageMultiplier,
        burnOnHit: config.burnOnHit
          ? {
            ...config.burnOnHit,
            damagePerTick: config.burnOnHit.damagePerTick * damageMultiplier,
          }
          : undefined,
      },
    };
  }

  commitShot(playerId: string, nowMs: number): void {
    if (this.destroyed) return;
    const config = this.getNegevConfig(playerId);
    if (!config) return;
    this.getOrCreateState(playerId).lastShotAt = nowMs;
  }

  registerKill(outcome: NegevKillOutcome): void {
    if (this.destroyed) return;
    const config = this.getNegevConfig(outcome.killerId);
    const streak = config?.negevKillstreak;
    if (!config || outcome.sourceId !== config.id || !streak || streak.damageBonusPerKill <= 0) return;

    const state = this.getOrCreateState(outcome.killerId);
    state.kills += 1;
    if (streak.healPerKill > 0) this.options.combatSystem.heal(outcome.killerId, streak.healPerKill);
    if (streak.armorPerKill > 0) this.options.combatSystem.addArmor(outcome.killerId, streak.armorPerKill);
  }

  terminateStreak(playerId: string, nowMs: number): void {
    if (this.destroyed) return;
    const kills = this.states.get(playerId)?.kills ?? 0;
    if (kills > 0) this.finishStreak(playerId, kills, nowMs);
  }

  update(nowMs: number): void {
    if (this.destroyed) return;
    for (const [playerId, state] of this.states) {
      if (state.kills <= 0) continue;
      const stillFiringNegev = nowMs - state.lastShotAt < NegevBehaviorRuntime.NEGEV_STREAK_GAP_MS
        && this.getNegevConfig(playerId) !== null;
      if (!stillFiringNegev) this.finishStreak(playerId, state.kills, nowMs);
    }
  }

  resetPlayer(playerId: string): void {
    if (this.destroyed) return;
    this.states.set(playerId, { kills: 0, lastShotAt: 0 });
  }

  removePlayer(playerId: string): void {
    this.states.delete(playerId);
  }

  clear(): void {
    this.states.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear();
  }

  getHudBuffs(playerId: string): readonly SyncedActiveHudBuff[] {
    if (this.destroyed) return [];
    const config = this.getNegevConfig(playerId);
    const state = this.states.get(playerId);
    const damagePerKill = config?.negevKillstreak?.damageBonusPerKill ?? 0;
    if (!state || state.kills <= 0 || damagePerKill <= 0) return [];

    return [{
      defId: 'NEGEV_KILLSTREAK',
      remainingFrac: 1,
      count: state.kills,
      value: state.kills * damagePerKill,
      intensity: Math.min(1, state.kills / NegevBehaviorRuntime.NEGEV_STREAK_FULL_INTENSITY_KILLS),
    }];
  }

  private finishStreak(playerId: string, kills: number, nowMs: number): void {
    const state = this.states.get(playerId);
    if (state) state.kills = 0;
    if (kills <= 0) return;

    const streak = this.getNegevConfig(playerId)?.negevKillstreak;
    if (!streak || streak.explosionEnabled <= 0) return;
    const player = this.options.playerManager.getPlayer(playerId);
    if (!player) return;

    const radius = streak.explosionBaseRadius + kills * streak.explosionRadiusPerKill;
    const damage = kills * streak.explosionDamagePerKill;
    const knockback = streak.explosionBaseKnockback + kills * streak.explosionKnockbackPerKill;
    if (damage > 0 && radius > 0) {
      this.options.combatSystem.applyAoeDamage(player.x, player.y, radius, damage, playerId, false, {
        category: 'explosion',
        sourceId: 'weapon.NEGEV.killstreak',
        sourceSlot: 'weapon2',
      });
    }
    if (knockback > 0 && radius > 0) {
      this.options.physicsSystem.applyRadialImpulse(player.x, player.y, radius, knockback, playerId, 0);
    }
    this.options.onKillstreakExplosion?.({
      ownerId: playerId,
      x: player.x,
      y: player.y,
      kills,
      radius,
      damage,
      nowMs,
      fireChunkDurationMs: streak.fireChunkDurationMs,
      fireChunkBurnDurationMs: streak.fireChunkBurnDurationMs,
      fireChunkBurnDamagePerTick: streak.fireChunkBurnDamagePerTick,
    });
  }

  private getNegevConfig(playerId: string): WeaponConfig | null {
    const config = this.options.loadout.getEquippedWeaponConfig(playerId, 'weapon2');
    return config?.id === 'NEGEV' ? config : null;
  }

  private getOrCreateState(playerId: string): NegevCombatState {
    const current = this.states.get(playerId);
    if (current) return current;
    const state = { kills: 0, lastShotAt: 0 };
    this.states.set(playerId, state);
    return state;
  }
}
