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
import type { PlayerUltimateActionRequest } from './PlayerActionRuntime';
import { PLAYER_SIZE, type MuzzleOrigin } from '../config';
import { getHeldWeaponGameplayMuzzleOrigin } from '../loadout/HeldItemVisuals';

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

/** World-owned player-Ultimate activation plus sustained buff behavior. */
export class PlayerUltimateBehaviorRuntime implements UltimateModifierReadPort {
  private readonly states = new Map<string, BuffUltimateState>();
  private readonly committedAttempts = new Map<string, LoadoutUseResult>();
  private readonly gaussChargeStartedAt = new Map<string, number>();
  private readonly gaussPressAttempts = new Map<string, LoadoutUseResult>();
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

    const attemptKey = request.attemptId ? `${request.playerId}:${request.attemptId}` : null;
    if (attemptKey) {
      const committed = this.committedAttempts.get(attemptKey);
      if (committed) return committed;
    }

    const playerId = request.playerId;
    const config = this.options.loadout.getEquippedUltimateConfig(playerId);
    if (!config) return { ok: false, reason: 'invalid' };
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
    if (attemptKey) this.committedAttempts.set(attemptKey, result);
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
      if (attemptKey) {
        const previous = this.gaussPressAttempts.get(attemptKey);
        if (previous) return previous;
      }
      if (this.gaussChargeStartedAt.has(request.playerId)) return { ok: false, reason: 'blocked' };
      if (this.options.resourceSystem.getRage(request.playerId) < config.rageRequired) {
        return { ok: false, reason: 'resource', resourceKind: 'rage' };
      }
      this.gaussChargeStartedAt.set(request.playerId, request.hostNowMs);
      const result: LoadoutUseResult = { ok: true };
      if (attemptKey) this.gaussPressAttempts.set(attemptKey, result);
      return result;
    }

    if (action !== 'release') {
      this.clearGaussCharge(request.playerId);
      return { ok: false, reason: 'blocked' };
    }

    const startedAt = this.gaussChargeStartedAt.get(request.playerId);
    if (startedAt === undefined) return { ok: false, reason: 'blocked' };
    const chargeFraction = config.chargeDuration <= 0
      ? 1
      : Math.max(0, Math.min(1, (request.hostNowMs - startedAt) / config.chargeDuration));
    if (chargeFraction < 1) {
      this.clearGaussCharge(request.playerId);
      return { ok: false, reason: 'blocked' };
    }
    if (this.options.resourceSystem.getRage(request.playerId) < config.rageCost) {
      this.clearGaussCharge(request.playerId);
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
    this.clearGaussCharge(request.playerId);
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
    const config = this.options.loadout.getEquippedUltimateConfig(playerId);
    const gaussMultiplier = config?.type === 'gauss' && this.gaussChargeStartedAt.has(playerId)
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
    return this.gaussChargeStartedAt.has(playerId);
  }

  getUltimateChargeFraction(playerId: string, nowMs: number): number {
    const config = this.options.loadout.getEquippedUltimateConfig(playerId);
    const startedAt = this.gaussChargeStartedAt.get(playerId);
    if (config?.type !== 'gauss' || startedAt === undefined) return 0;
    if (config.chargeDuration <= 0) return 1;
    return Math.max(0, Math.min(1, (nowMs - startedAt) / config.chargeDuration));
  }

  getUltimateChargeRange(playerId: string): number {
    const config = this.options.loadout.getEquippedUltimateConfig(playerId);
    return config?.type === 'gauss' ? config.range : 0;
  }

  resetPlayer(playerId: string): void {
    const state = this.states.get(playerId);
    if (state?.config.armageddon) this.armageddon?.deactivate(playerId);
    this.states.delete(playerId);
    this.clearGaussCharge(playerId);
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
    this.gaussChargeStartedAt.clear();
    this.gaussPressAttempts.clear();
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
    for (const key of this.gaussPressAttempts.keys()) {
      if (key.startsWith(`${playerId}:`)) this.gaussPressAttempts.delete(key);
    }
  }

  private clearGaussCharge(playerId: string): void {
    this.gaussChargeStartedAt.delete(playerId);
    for (const key of this.gaussPressAttempts.keys()) {
      if (key.startsWith(`${playerId}:`)) this.gaussPressAttempts.delete(key);
    }
  }
}
