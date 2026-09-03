import type { ArmageddonMeteorConfig, BuffUltimateConfig } from '../loadout/LoadoutConfig';
import type { LoadoutUseResult } from '../types';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem } from '../systems/CombatSystem';
import type { ResourceSystem } from '../systems/ResourceSystem';
import type { LoadoutManager, UltimateModifierReadPort } from '../loadout/LoadoutManager';
import type { PlayerUltimateActionRequest } from './PlayerActionRuntime';

export interface PlayerUltimateArmageddonCapability {
  activate(
    playerId: string,
    config: ArmageddonMeteorConfig,
    getPlayerPos: () => { x: number; y: number } | null,
  ): void;
  deactivate(playerId: string): void;
}

export interface PlayerUltimateBehaviorNetworkPort {
  readonly teams: {
    readonly isEnemyPair: (firstPlayerId: string, secondPlayerId: string) => boolean;
  };
  readonly roundStats: {
    readonly recordUltimateUsed: (playerId: string) => void;
  };
}

export interface PlayerUltimateBehaviorRuntimeOptions {
  readonly playerManager: PlayerManager;
  readonly combatSystem: Pick<CombatSystem, 'addArmor' | 'applyAoeDamage'>;
  readonly resourceSystem: Pick<ResourceSystem, 'getRage' | 'getMaxRage' | 'addRage'>;
  readonly loadout: Pick<LoadoutManager, 'getEquippedUltimateConfig'>;
  readonly canInteract: (playerId: string) => boolean;
  readonly isAlive: (playerId: string) => boolean;
  readonly isUltimateBlocked: (playerId: string) => boolean;
  readonly network: PlayerUltimateBehaviorNetworkPort;
}

interface BuffUltimateState {
  readonly config: BuffUltimateConfig;
  active: boolean;
  startTime: number;
  consumedRage: number;
  durationMs: number;
  drainDurationMs: number;
  nextArmorTickAt: number;
  nextAuraTickAt: number;
  auraLingerUntil: number;
}

/** World-owned lifecycle and effect behavior for sustained player buff ultimates. */
export class PlayerUltimateBehaviorRuntime implements UltimateModifierReadPort {
  private readonly states = new Map<string, BuffUltimateState>();
  private readonly committedAttempts = new Map<string, LoadoutUseResult>();
  private armageddon: PlayerUltimateArmageddonCapability | null = null;
  private destroyed = false;

  constructor(private readonly options: PlayerUltimateBehaviorRuntimeOptions) {}

  setArmageddonCapability(capability: PlayerUltimateArmageddonCapability | null): void {
    this.armageddon = capability;
  }

  execute(request: PlayerUltimateActionRequest): LoadoutUseResult {
    if (this.destroyed || request.category !== 'ultimate') return { ok: false, reason: 'invalid' };

    const attemptKey = request.attemptId ? `${request.playerId}:${request.attemptId}` : null;
    if (attemptKey) {
      const committed = this.committedAttempts.get(attemptKey);
      if (committed) return committed;
    }

    const playerId = request.playerId;
    const config = this.options.loadout.getEquippedUltimateConfig(playerId);
    if (!config || config.type !== 'buff') return { ok: false, reason: 'invalid' };
    if (!this.options.canInteract(playerId)
      || !this.options.isAlive(playerId)
      || this.options.isUltimateBlocked(playerId)) {
      return { ok: false, reason: 'blocked' };
    }

    const state = this.states.get(playerId);
    if (state?.active) return { ok: false, reason: 'blocked' };

    const rage = this.options.resourceSystem.getRage(playerId);
    if (rage < config.rageRequired) return { ok: false, reason: 'resource', resourceKind: 'rage' };

    const consumedRage = Math.min(rage, this.options.resourceSystem.getMaxRage(playerId));
    const scale = consumedRage / config.rageRequired;
    const nextState: BuffUltimateState = {
      active: true,
      startTime: request.hostNowMs,
      config,
      consumedRage,
      durationMs: Math.max(1, Math.round(config.duration * scale)),
      drainDurationMs: Math.max(1, Math.round(config.rageDrainDuration * scale)),
      nextArmorTickAt: request.hostNowMs + config.armorTickIntervalMs,
      nextAuraTickAt: config.aura && config.aura.tickIntervalMs > 0
        ? request.hostNowMs + config.aura.tickIntervalMs
        : 0,
      auraLingerUntil: 0,
    };
    this.states.set(playerId, nextState);

    if (config.armageddon && this.armageddon) {
      this.armageddon.activate(playerId, config.armageddon, () => {
        const player = this.options.playerManager.getPlayer(playerId);
        return player ? { x: player.x, y: player.y } : null;
      });
    }
    this.options.network.roundStats.recordUltimateUsed(playerId);

    const result: LoadoutUseResult = { ok: true };
    if (attemptKey) this.committedAttempts.set(attemptKey, result);
    return result;
  }

  update(_deltaMs: number, nowMs: number): void {
    if (this.destroyed) return;

    for (const [playerId, state] of this.states) {
      if (!state.active) continue;

      const elapsed = nowMs - state.startTime;
      const endTime = state.startTime + state.durationMs;
      const fraction = Math.min(1, elapsed / state.drainDurationMs);
      const targetRage = state.consumedRage * (1 - fraction);
      const currentRage = this.options.resourceSystem.getRage(playerId);
      const drain = currentRage - targetRage;
      if (drain > 0) this.options.resourceSystem.addRage(playerId, -drain);

      if (state.config.armorPerTick > 0 && state.config.armorTickIntervalMs > 0) {
        while (state.nextArmorTickAt > 0
          && state.nextArmorTickAt <= nowMs
          && state.nextArmorTickAt <= endTime) {
          this.options.combatSystem.addArmor(playerId, state.config.armorPerTick);
          const aura = state.config.aura;
          if (aura && aura.allyArmorPerTick !== undefined && aura.allyArmorPerTick > 0) {
            const owner = this.options.playerManager.getPlayer(playerId);
            if (owner) {
              for (const ally of this.options.playerManager.getAllPlayers()) {
                if (ally.id === playerId || this.options.network.teams.isEnemyPair(playerId, ally.id)) continue;
                if (Math.hypot(owner.x - ally.x, owner.y - ally.y) <= aura.radius) {
                  this.options.combatSystem.addArmor(ally.id, aura.allyArmorPerTick ?? 0);
                }
              }
            }
          }
          state.nextArmorTickAt += state.config.armorTickIntervalMs;
        }
      }

      const aura = state.config.aura;
      const auraOwner = aura ? this.options.playerManager.getPlayer(playerId) : null;
      if (aura && aura.damagePerTick > 0 && aura.tickIntervalMs > 0 && aura.radius > 0) {
        while (state.nextAuraTickAt > 0
          && state.nextAuraTickAt <= nowMs
          && state.nextAuraTickAt <= endTime) {
          if (auraOwner) {
            this.options.combatSystem.applyAoeDamage(
              auraOwner.x,
              auraOwner.y,
              aura.radius,
              aura.damagePerTick,
              playerId,
              false,
              {
                category: 'damage_over_time',
                sourceId: state.config.id,
                sourceSlot: 'ultimate',
                baseDamageMult: aura.baseDamageMult,
              },
            );
          }
          state.nextAuraTickAt += aura.tickIntervalMs;
        }
      }

      if (elapsed >= state.durationMs) this.finishState(playerId, state, nowMs);
    }
  }

  getSpeedMultiplier(playerId: string, nowMs: number): number {
    const state = this.states.get(playerId);
    const ownMultiplier = state?.active ? state.config.speedMultiplier : 1;
    return ownMultiplier * this.getAllyAuraMultiplier(playerId, 'speed', nowMs);
  }

  getDamageMultiplier(playerId: string, nowMs: number): number {
    const state = this.states.get(playerId);
    const ownMultiplier = state?.active ? state.config.damageMultiplier : 1;
    return ownMultiplier * this.getAllyAuraMultiplier(playerId, 'damage', nowMs);
  }

  isUltimateActive(playerId: string): boolean {
    return this.states.get(playerId)?.active ?? false;
  }

  getActiveUltimateId(playerId: string): string | null {
    const state = this.states.get(playerId);
    return state?.active ? state.config.id : null;
  }

  resetPlayer(playerId: string): void {
    const state = this.states.get(playerId);
    if (state?.config.armageddon) this.armageddon?.deactivate(playerId);
    this.states.delete(playerId);
    this.clearAttempts(playerId);
  }

  removePlayer(playerId: string): void {
    this.resetPlayer(playerId);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [playerId, state] of this.states) {
      if (state.config.armageddon) this.armageddon?.deactivate(playerId);
    }
    this.states.clear();
    this.committedAttempts.clear();
    this.armageddon = null;
  }

  private finishState(playerId: string, state: BuffUltimateState, nowMs: number): void {
    state.auraLingerUntil = nowMs + (state.config.aura?.lingerMs ?? 0);
    state.active = false;
    state.consumedRage = 0;
    state.durationMs = 0;
    state.drainDurationMs = 0;
    state.nextArmorTickAt = 0;
    state.nextAuraTickAt = 0;
    if (state.config.armageddon) this.armageddon?.deactivate(playerId);
  }

  private getAllyAuraMultiplier(
    playerId: string,
    kind: 'speed' | 'damage',
    nowMs: number,
  ): number {
    const target = this.options.playerManager.getPlayer(playerId);
    if (!target) return 1;

    let multiplier = 1;
    for (const [ownerId, state] of this.states) {
      const aura = state.config.aura;
      if (ownerId === playerId || !aura) continue;
      if (!state.active && state.auraLingerUntil < nowMs) continue;
      if (this.options.network.teams.isEnemyPair(ownerId, playerId)) continue;
      const owner = this.options.playerManager.getPlayer(ownerId);
      if (!owner || Math.hypot(owner.x - target.x, owner.y - target.y) > aura.radius) continue;
      multiplier *= kind === 'speed'
        ? (aura.allySpeedMultiplier ?? 1)
        : (aura.allyDamageMultiplier ?? 1);
    }
    return multiplier;
  }

  private clearAttempts(playerId: string): void {
    for (const key of this.committedAttempts.keys()) {
      if (key.startsWith(`${playerId}:`)) this.committedAttempts.delete(key);
    }
  }
}
