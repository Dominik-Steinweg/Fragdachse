import type {
  AirstrikeUltimateConfig,
  ArmageddonMeteorConfig,
  BuffUltimateConfig,
  GaussUltimateConfig,
  TunnelUltimateConfig,
} from '../loadout/LoadoutConfig';
import type { LoadoutUseParams, LoadoutUseResult } from '../types';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem } from '../systems/CombatSystem';
import type { ResourceSystem } from '../systems/ResourceSystem';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { LoadoutManager, UltimateModifierReadPort } from '../loadout/LoadoutManager';
import {
  isValidPlayerActionAttemptId,
  type PlayerUltimateActionRequest,
} from './PlayerActionRuntime';
import { PLAYER_SIZE, type MuzzleOrigin } from '../config';
import { getHeldWeaponGameplayMuzzleOrigin } from '../loadout/HeldItemVisuals';
import type { PlayerRelationshipPort } from './PlayerRelationshipPort';

export interface PlayerUltimateArmageddonCapability {
  activate(
    playerId: string,
    config: ArmageddonMeteorConfig,
    getPlayerPos: () => { x: number; y: number } | null,
  ): void;
  deactivate(playerId: string): void;
}

/** World-owned deferred execution capability for a player Airstrike commit. */
export interface PlayerUltimateAirstrikeCapability {
  scheduleStrike(
    playerId: string,
    targetX: number,
    targetY: number,
    config: AirstrikeUltimateConfig,
    armedAt: number,
  ): boolean;
}

/** Construction-owned placement capability for the player Tunnel activation. */
export interface PlayerUltimateTunnelPlacementCapability {
  placeTunnel(
    config: TunnelUltimateConfig,
    playerId: string,
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    playerColor: number,
    params?: LoadoutUseParams,
  ): boolean;
}

/** Narrow immediate execution capability for the player Gauss shot. */
export interface PlayerUltimateGaussExecutionCapability {
  fireGauss(
    config: GaussUltimateConfig,
    params: {
      readonly x: number;
      readonly y: number;
      readonly angle: number;
      readonly ownerId: string;
      readonly ownerColor: number;
      readonly gameplayMuzzleOrigin?: MuzzleOrigin;
    },
  ): boolean;
}

export interface PlayerUltimateBehaviorNetworkPort {
  readonly relationship: PlayerRelationshipPort;
  readonly roundStats: {
    readonly recordUltimateUsed: (playerId: string) => void;
  };
}

export interface PlayerUltimateBehaviorRuntimeOptions {
  readonly playerManager: PlayerManager;
  readonly combatSystem: Pick<CombatSystem, 'addArmor' | 'applyAoeDamage'>;
  readonly resourceSystem: Pick<ResourceSystem, 'getRage' | 'getMaxRage' | 'addRage'>;
  readonly loadout: Pick<LoadoutManager, 'getEquippedUltimateConfig'>;
  readonly physics: Pick<HostPhysicsSystem, 'addRecoil'>;
  readonly gaussExecution: PlayerUltimateGaussExecutionCapability;
  readonly canInteract: (playerId: string) => boolean;
  readonly isAlive: (playerId: string) => boolean;
  readonly isUltimateBlocked: (playerId: string) => boolean;
  readonly breakStealth?: (playerId: string, nowMs: number) => void;
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

interface GaussChargeState {
  readonly chargeId: string;
  readonly startedAt: number;
}

type GaussChargeEndReason = 'cancelled' | 'released' | 'reset';

const MAX_RECENT_ATTEMPTS_PER_PLAYER = 64;
const MAX_RECENT_GAUSS_CHARGES_PER_PLAYER = 64;

/** World-owned player-Ultimate activation plus sustained buff behavior. */
export class PlayerUltimateBehaviorRuntime implements UltimateModifierReadPort {
  private readonly states = new Map<string, BuffUltimateState>();
  private readonly committedAttempts = new Map<string, Map<string, LoadoutUseResult>>();
  private readonly gaussCharges = new Map<string, GaussChargeState>();
  private readonly gaussChargeHistory = new Map<string, Map<string, GaussChargeEndReason>>();
  private armageddon: PlayerUltimateArmageddonCapability | null = null;
  private airstrike: PlayerUltimateAirstrikeCapability | null = null;
  private tunnelPlacement: PlayerUltimateTunnelPlacementCapability | null = null;
  private gaussExecution: PlayerUltimateGaussExecutionCapability | null;
  private destroyed = false;

  constructor(private readonly options: PlayerUltimateBehaviorRuntimeOptions) {
    this.gaussExecution = options.gaussExecution;
  }

  setArmageddonCapability(capability: PlayerUltimateArmageddonCapability | null): void {
    this.armageddon = capability;
  }

  setAirstrikeCapability(capability: PlayerUltimateAirstrikeCapability | null): void {
    this.airstrike = capability;
  }

  setTunnelPlacementCapability(capability: PlayerUltimateTunnelPlacementCapability | null): void {
    this.tunnelPlacement = capability;
  }

  setGaussExecutionCapability(capability: PlayerUltimateGaussExecutionCapability | null): void {
    this.gaussExecution = capability;
  }

  execute(request: PlayerUltimateActionRequest): LoadoutUseResult {
    if (this.destroyed || request.category !== 'ultimate') return { ok: false, reason: 'invalid' };
    if (!isValidPlayerActionAttemptId(request.attemptId)) return { ok: false, reason: 'invalid' };

    const attemptKey = request.attemptId === undefined ? null : request.attemptId;
    const activeGaussCharge = this.gaussCharges.get(request.playerId);
    if (activeGaussCharge
      && request.params?.gaussChargeId !== undefined
      && activeGaussCharge.chargeId !== request.params.gaussChargeId) {
      return { ok: false, reason: 'blocked' };
    }
    if (attemptKey) {
      const committed = this.committedAttempts.get(request.playerId)?.get(attemptKey);
      if (committed) return committed;
    }

    const playerId = request.playerId;
    const config = this.options.loadout.getEquippedUltimateConfig(playerId);
    if (!config) return { ok: false, reason: 'invalid' };

    // Gauss cancellation is a lifecycle cleanup command. It must still reach this owner when
    // stun, burrow or another input gate has already made ordinary combat actions unavailable.
    if (config.type === 'gauss' && request.params?.ultimateAction === 'cancel') {
      return this.cancelGaussCharge(playerId, request.params.gaussChargeId);
    }
    if (!this.options.canInteract(playerId)
      || !this.options.isAlive(playerId)
      || this.options.isUltimateBlocked(playerId)) {
      return { ok: false, reason: 'blocked' };
    }
    this.options.breakStealth?.(playerId, request.hostNowMs);

    switch (config.type) {
      case 'buff':
        return this.executeBuff(request, config, attemptKey);
      case 'airstrike':
        return this.executeAirstrike(request, config, attemptKey);
      case 'tunnel':
        return this.executeTunnel(request, config, attemptKey);
      case 'gauss':
        return this.executeGauss(request, config, attemptKey);
      default:
        return { ok: false, reason: 'invalid' };
    }
  }

  private executeBuff(
    request: PlayerUltimateActionRequest,
    config: BuffUltimateConfig,
    attemptKey: string | null,
  ): LoadoutUseResult {
    const playerId = request.playerId;

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
    if (attemptKey) this.rememberCommittedAttempt(playerId, attemptKey, result);
    return result;
  }

  private executeAirstrike(
    request: PlayerUltimateActionRequest,
    config: AirstrikeUltimateConfig,
    attemptKey: string | null,
  ): LoadoutUseResult {
    if (!Number.isFinite(request.targetX) || !Number.isFinite(request.targetY)) {
      return { ok: false, reason: 'invalid' };
    }
    if (this.options.resourceSystem.getRage(request.playerId) < config.rageRequired) {
      return { ok: false, reason: 'resource', resourceKind: 'rage' };
    }
    if (!this.airstrike?.scheduleStrike(
      request.playerId,
      request.targetX,
      request.targetY,
      config,
      request.hostNowMs,
    )) {
      return { ok: false, reason: 'blocked' };
    }
    return this.commitRageUltimate(request.playerId, config.rageCost, attemptKey);
  }

  private executeTunnel(
    request: PlayerUltimateActionRequest,
    config: TunnelUltimateConfig,
    attemptKey: string | null,
  ): LoadoutUseResult {
    if (request.params?.tunnelAction !== 'commit') return { ok: false, reason: 'blocked' };
    const player = this.options.playerManager.getPlayer(request.playerId);
    if (!player) return { ok: false, reason: 'invalid' };
    if (this.options.resourceSystem.getRage(request.playerId) < config.rageRequired) {
      return { ok: false, reason: 'resource', resourceKind: 'rage' };
    }
    const originX = request.clientPosition?.x ?? player.x;
    const originY = request.clientPosition?.y ?? player.y;
    if (!Number.isFinite(originX) || !Number.isFinite(originY)
      || !Number.isFinite(request.targetX) || !Number.isFinite(request.targetY)) {
      return { ok: false, reason: 'invalid' };
    }
    if (!this.tunnelPlacement?.placeTunnel(
      config,
      request.playerId,
      originX,
      originY,
      request.targetX,
      request.targetY,
      player.color,
      request.params,
    )) {
      return { ok: false, reason: 'blocked' };
    }
    return this.commitRageUltimate(request.playerId, config.rageCost, attemptKey);
  }

  private executeGauss(
    request: PlayerUltimateActionRequest,
    config: GaussUltimateConfig,
    attemptKey: string | null,
  ): LoadoutUseResult {
    const action = request.params?.ultimateAction;
    if (action === 'press') {
      const chargeId = request.params?.gaussChargeId;
      if (!this.isValidGaussChargeId(chargeId)) return { ok: false, reason: 'invalid' };
      const current = this.gaussCharges.get(request.playerId);
      if (current) {
        // A retransmitted press for the current charge is idempotent. A press for another
        // charge can never replace an active charge and therefore cannot affect its lifetime.
        return current.chargeId === chargeId
          ? { ok: true }
          : { ok: false, reason: 'blocked' };
      }
      if (this.hasGaussChargeEnded(request.playerId, chargeId)) return { ok: false, reason: 'blocked' };
      if (this.options.resourceSystem.getRage(request.playerId) < config.rageRequired) {
        return { ok: false, reason: 'resource', resourceKind: 'rage' };
      }
      this.gaussCharges.set(request.playerId, { chargeId, startedAt: request.hostNowMs });
      return { ok: true };
    }

    if (action !== 'release') return { ok: false, reason: 'invalid' };

    const chargeId = request.params?.gaussChargeId;
    if (!this.isValidGaussChargeId(chargeId)) return { ok: false, reason: 'invalid' };
    const charge = this.gaussCharges.get(request.playerId);
    if (!charge || charge.chargeId !== chargeId) return { ok: false, reason: 'blocked' };

    const chargeFraction = config.chargeDuration <= 0
      ? 1
      : Math.max(0, Math.min(1, (request.hostNowMs - charge.startedAt) / config.chargeDuration));
    if (chargeFraction < 1) {
      this.endGaussCharge(request.playerId, chargeId, 'cancelled');
      return { ok: false, reason: 'blocked' };
    }
    if (this.options.resourceSystem.getRage(request.playerId) < config.rageCost) {
      this.endGaussCharge(request.playerId, chargeId, 'released');
      return { ok: false, reason: 'resource', resourceKind: 'rage' };
    }
    const player = this.options.playerManager.getPlayer(request.playerId);
    const x = request.clientPosition?.x ?? player?.x;
    const y = request.clientPosition?.y ?? player?.y;
    if (!player || !this.gaussExecution?.fireGauss(config, {
      x: x ?? 0,
      y: y ?? 0,
      angle: request.angle,
      ownerId: request.playerId,
      ownerColor: player.color,
      gameplayMuzzleOrigin: getHeldWeaponGameplayMuzzleOrigin(
        config.id,
        x ?? 0,
        y ?? 0,
        request.angle,
        player.displayObject?.displayWidth ?? PLAYER_SIZE,
      ) ?? undefined,
    })) {
      return { ok: false, reason: 'blocked' };
    }

    this.options.physics.addRecoil(
      request.playerId,
      -Math.cos(request.angle) * config.shotRecoilForce,
      -Math.sin(request.angle) * config.shotRecoilForce,
      config.shotRecoilDuration,
    );
    this.endGaussCharge(request.playerId, chargeId, 'released');
    return this.commitRageUltimate(request.playerId, config.rageCost, attemptKey);
  }

  private commitRageUltimate(
    playerId: string,
    rageCost: number,
    attemptKey: string | null,
  ): LoadoutUseResult {
    const result: LoadoutUseResult = { ok: true };
    this.options.resourceSystem.addRage(playerId, -rageCost);
    this.options.network.roundStats.recordUltimateUsed(playerId);
    if (attemptKey) this.rememberCommittedAttempt(playerId, attemptKey, result);
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
                if (ally.id === playerId || this.options.network.relationship.isEnemyPair(playerId, ally.id)) continue;
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
    const config = this.options.loadout.getEquippedUltimateConfig(playerId);
    const gaussMultiplier = config?.type === 'gauss' && this.gaussCharges.has(playerId)
      ? config.movementSlowFactor
      : 1;
    return ownMultiplier * gaussMultiplier * this.getAllyAuraMultiplier(playerId, 'speed', nowMs);
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

  isUltimateCharging(playerId: string): boolean {
    return this.gaussCharges.has(playerId);
  }

  getUltimateChargeFraction(playerId: string, nowMs: number): number {
    const config = this.options.loadout.getEquippedUltimateConfig(playerId);
    const charge = this.gaussCharges.get(playerId);
    if (config?.type !== 'gauss' || !charge) return 0;
    if (config.chargeDuration <= 0) return 1;
    return Math.max(0, Math.min(1, (nowMs - charge.startedAt) / config.chargeDuration));
  }

  getUltimateChargeRange(playerId: string): number {
    const config = this.options.loadout.getEquippedUltimateConfig(playerId);
    return config?.type === 'gauss' ? config.range : 0;
  }

  resetPlayer(playerId: string): void {
    const state = this.states.get(playerId);
    if (state?.config.armageddon) this.armageddon?.deactivate(playerId);
    this.states.delete(playerId);
    const charge = this.gaussCharges.get(playerId);
    if (charge) this.endGaussCharge(playerId, charge.chargeId, 'reset');
    this.clearAttempts(playerId);
  }

  removePlayer(playerId: string): void {
    this.resetPlayer(playerId);
    // Detach is a player-lifetime boundary: no retry or charge tombstone may survive it.
    this.gaussChargeHistory.delete(playerId);
    this.committedAttempts.delete(playerId);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [playerId, state] of this.states) {
      if (state.config.armageddon) this.armageddon?.deactivate(playerId);
    }
    this.states.clear();
    this.committedAttempts.clear();
    this.gaussCharges.clear();
    this.gaussChargeHistory.clear();
    this.armageddon = null;
    this.airstrike = null;
    this.tunnelPlacement = null;
    this.gaussExecution = null;
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
      if (this.options.network.relationship.isEnemyPair(ownerId, playerId)) continue;
      const owner = this.options.playerManager.getPlayer(ownerId);
      if (!owner || Math.hypot(owner.x - target.x, owner.y - target.y) > aura.radius) continue;
      multiplier *= kind === 'speed'
        ? (aura.allySpeedMultiplier ?? 1)
        : (aura.allyDamageMultiplier ?? 1);
    }
    return multiplier;
  }

  private clearAttempts(playerId: string): void {
    this.committedAttempts.delete(playerId);
  }

  private rememberCommittedAttempt(playerId: string, attemptId: string, result: LoadoutUseResult): void {
    const history = this.committedAttempts.get(playerId) ?? new Map<string, LoadoutUseResult>();
    history.delete(attemptId);
    history.set(attemptId, result);
    while (history.size > MAX_RECENT_ATTEMPTS_PER_PLAYER) {
      const oldest = history.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      history.delete(oldest);
    }
    this.committedAttempts.set(playerId, history);
  }

  private cancelGaussCharge(playerId: string, chargeId: string | undefined): LoadoutUseResult {
    if (!this.isValidGaussChargeId(chargeId)) return { ok: false, reason: 'invalid' };
    const current = this.gaussCharges.get(playerId);
    if (!current) return this.hasGaussChargeEnded(playerId, chargeId)
      ? { ok: true }
      : { ok: false, reason: 'blocked' };
    if (current.chargeId !== chargeId) return { ok: false, reason: 'blocked' };
    this.endGaussCharge(playerId, chargeId, 'cancelled');
    return { ok: true };
  }

  private endGaussCharge(playerId: string, chargeId: string, reason: GaussChargeEndReason): void {
    const current = this.gaussCharges.get(playerId);
    if (!current || current.chargeId !== chargeId) return;
    this.gaussCharges.delete(playerId);
    const history = this.gaussChargeHistory.get(playerId) ?? new Map<string, GaussChargeEndReason>();
    history.delete(chargeId);
    history.set(chargeId, reason);
    while (history.size > MAX_RECENT_GAUSS_CHARGES_PER_PLAYER) {
      const oldest = history.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      history.delete(oldest);
    }
    this.gaussChargeHistory.set(playerId, history);
  }

  private hasGaussChargeEnded(playerId: string, chargeId: string): boolean {
    return this.gaussChargeHistory.get(playerId)?.has(chargeId) ?? false;
  }

  private isValidGaussChargeId(value: unknown): value is string {
    return typeof value === 'string'
      && value.length > 0
      && value.length <= 120
      && value.trim() === value;
  }
}
