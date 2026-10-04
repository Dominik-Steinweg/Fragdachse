import type { UtilityConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { LoadoutToolRef, LoadoutUseParams, LoadoutUseResult, WeaponSlot } from '../types';
import type { SustainedWeaponActionRequest, SustainedWeaponBehaviorPort } from '../loadout/SustainedWeaponBehaviorPort';
import type { PlayerWeaponActivationRequest } from './PlayerWeaponActivationRuntime';
import { HELD_WEAPON_INPUT_TIMEOUT_MS, type RocketMagazineRuntime } from './RocketMagazineRuntime';

/** Optional client-position compensation supplied by a player-action request. */
export interface PlayerActionPositionInput {
  readonly x?: number;
  readonly y?: number;
}

/** Resolved gameplay position used by the activation path. */
export interface PlayerActionPosition {
  readonly x: number;
  readonly y: number;
}

/** Semantic player-action capabilities materialized by the runtime cutover. */
export type PlayerActionCategory = 'weapon' | 'utility' | 'ultimate';

/** Semantic host request for one player weapon action. */
export interface PlayerWeaponActionRequest {
  readonly category: 'weapon';
  readonly playerId: string;
  readonly slot: WeaponSlot;
  readonly angle: number;
  readonly targetX: number;
  readonly targetY: number;
  /** One host timestamp for readiness, resource and commit decisions. */
  readonly hostNowMs: number;
  /** Optional request/attempt correlation when a transport already carries one. */
  readonly attemptId?: string;
  /** Execution/shot identity. It is deliberately not an attempt/prediction identity. */
  readonly shotId?: number;
  readonly predictionId?: number;
  readonly params?: LoadoutUseParams;
  /** Host tooling only: a zero-duration tap, never copied from an RPC payload. */
  readonly scopeTrigger?: 'tap';
  /** Legacy client-position compensation, resolved explicitly before activation. */
  readonly clientPosition?: PlayerActionPositionInput;
}

export type PlayerUtilityActionSource =
  | { readonly kind: 'equipped' }
  | { readonly kind: 'temporary'; readonly instanceId: string }
  | { readonly kind: 'tool'; readonly toolRef: LoadoutToolRef; readonly config: UtilityConfig };

/** Semantic host request for one equipped or temporary utility action. */
export interface PlayerUtilityActionRequest {
  readonly category: 'utility';
  readonly playerId: string;
  readonly angle: number;
  readonly targetX: number;
  readonly targetY: number;
  /** One host timestamp for readiness, resource and commit decisions. */
  readonly hostNowMs: number;
  /** Request/attempt identity. It is distinct from held-action and execution identities. */
  readonly attemptId?: string;
  readonly params?: LoadoutUseParams;
  readonly clientPosition?: PlayerActionPositionInput;
  /** Optional semantic source. The temporary id in params remains a wire compatibility fallback. */
  readonly source?: PlayerUtilityActionSource;
}

export interface PlayerUltimateActionRequest {
  readonly category: 'ultimate';
  readonly playerId: string;
  readonly angle: number;
  readonly targetX: number;
  readonly targetY: number;
  /** One host timestamp for readiness, resource and commit decisions. */
  readonly hostNowMs: number;
  /** Request/attempt identity for duplicate-safe activation commits. */
  readonly attemptId?: string;
  readonly params?: LoadoutUseParams;
  readonly clientPosition?: PlayerActionPositionInput;
}

export type PlayerActionRequest = PlayerWeaponActionRequest | PlayerUtilityActionRequest | PlayerUltimateActionRequest;

export interface PlayerActionActor {
  readonly x: number;
  readonly y: number;
  readonly color: number;
  readonly displaySize?: number;
}

export interface PlayerActionActorPort {
  getPlayer(playerId: string): PlayerActionActor | undefined;
  canInteract(playerId: string): boolean;
  isAlive(playerId: string): boolean;
  isWeaponBlocked(playerId: string): boolean;
  isDashBurst(playerId: string): boolean;
  breakStealth?(playerId: string, now: number): void;
}

/**
 * Narrow loadout boundary used by the World-owned action owner.
 * The concrete LoadoutManager remains the equipment/ability owner; this port keeps the
 * action runtime from traversing its internal state or execution capabilities.
 */
export interface PlayerActionLoadoutPort {
  getEquippedWeaponConfig(playerId: string, slot: WeaponSlot): WeaponConfig | undefined;
  noteWeaponAction(playerId: string, slot: WeaponSlot, now: number, angle: number, holdDurationMs?: number): void;
  clearHeldWeaponAction(playerId: string): void;
}

/** Narrow immediate-weapon activation boundary owned by the World runtime. */
export interface PlayerWeaponActivationPort {
  canStartScope(playerId: string, slot: WeaponSlot, config: WeaponConfig, nowMs: number): LoadoutUseResult;
  activateWeapon(request: PlayerWeaponActivationRequest): LoadoutUseResult;
  noteWeaponFired(playerId: string, slot: WeaponSlot, now: number): void;
}

/** Explicit position policy preserving the pre-6A clientX/clientY semantics. */
export function resolvePlayerActionPosition(
  actor: PlayerActionActor,
  clientPosition?: PlayerActionPositionInput,
): PlayerActionPosition {
  return {
    x: clientPosition?.x ?? actor.x,
    y: clientPosition?.y ?? actor.y,
  };
}

/** Shared optional Attempt-ID contract for state-changing player actions. */
export function isValidPlayerActionAttemptId(value: unknown): value is string | undefined {
  return value === undefined
    || (typeof value === 'string'
      && value.length > 0
      && value.length <= 120
      && value.trim() === value);
}

/**
 * World-scoped owner for host-authoritative Player Actions.
 *
 * Weapon activation remains the narrow weapon capability of this runtime. Utility and Ultimate
 * activation are owned by sibling behavior runtimes and dispatched by the World owner.
 */
export class PlayerActionRuntime {
  private destroyed = false;
  private readonly scopes = new Map<string, { id: number; config: WeaponConfig; startedAt: number; lastHeldAt: number }>();
  private readonly latestScopeIds = new Map<string, number>();

  constructor(
    private readonly actor: PlayerActionActorPort,
    private readonly loadout: PlayerActionLoadoutPort,
    private readonly sustainedWeaponBehavior: SustainedWeaponBehaviorPort | null = null,
    private readonly weaponActivation: PlayerWeaponActivationPort,
    private readonly rocketMagazine: RocketMagazineRuntime | null = null,
  ) {}

  execute(request: PlayerWeaponActionRequest): LoadoutUseResult {
    if (this.destroyed || request.category !== 'weapon') {
      return { ok: false, reason: 'invalid' };
    }
    if (!isValidPlayerActionAttemptId(request.attemptId)) {
      return { ok: false, reason: 'invalid' };
    }
    if (request.params?.scope !== undefined && (request.params.rocketMagazine !== undefined
      || request.params.scopeHolding !== undefined || request.params.inputStarted !== undefined)) {
      return { ok: false, reason: 'invalid' };
    }
    if (request.params?.rocketMagazine !== undefined && (request.params.scopeHolding !== undefined
      || request.params.scopeProgress !== undefined || request.params.scopeChargeProgress !== undefined)) {
      return { ok: false, reason: 'invalid' };
    }

    if (request.params?.rocketMagazine) {
      this.cancelScope(request.playerId);
      if (request.slot !== 'weapon2') return { ok: false, reason: 'invalid' };
      const result = this.rocketMagazine?.input(request.playerId, request.params.rocketMagazine,
        request.angle, request.targetX, request.targetY, request.hostNowMs) ?? { ok: false, reason: 'invalid' as const };
      if (result.ok && request.params.rocketMagazine.phase !== 'cancel') {
        this.sustainedWeaponBehavior?.claimWeaponAction(request.playerId, request.slot, request.hostNowMs, request.angle);
        this.loadout.noteWeaponAction(request.playerId, request.slot, request.hostNowMs, request.angle);
      }
      return result;
    }

    const player = this.actor.getPlayer(request.playerId);
    const config: WeaponConfig | undefined = this.loadout.getEquippedWeaponConfig(request.playerId, request.slot);
    if (request.scopeTrigger === 'tap' && config?.scopeConfig) {
      const id = (this.latestScopeIds.get(request.playerId) ?? 0) + 1;
      const tap = { ...request, scopeTrigger: undefined };
      const held = this.execute({ ...tap, params: { scope: { id, phase: 'hold' } } });
      return held.ok ? this.execute({ ...tap, params: { scope: { id, phase: 'release' } } }) : held;
    }
    if (request.params?.scope !== undefined) {
      return this.inputScope(request, config);
    }
    this.cancelScope(request.playerId);
    if (!player || !config) return { ok: false, reason: 'invalid' };
    // Scope weapons fire only by consuming a host-observed gesture.
    if (config.scopeConfig || request.params?.scopeHolding) return { ok: false, reason: 'invalid' };
    if (config.rocketLauncher && config.rocketLauncher.magazineLevel > 0) return { ok: false, reason: 'invalid' };
    this.rocketMagazine?.cancel(request.playerId);
    if (!this.actor.canInteract(request.playerId)
      || !this.actor.isAlive(request.playerId)
      || this.actor.isWeaponBlocked(request.playerId)) {
      return { ok: false, reason: 'blocked' };
    }
    if (this.actor.isDashBurst(request.playerId)) return { ok: false, reason: 'blocked' };

    // Claim before readiness/resource resolution: switching away from a channel is immediate even
    // when the newly requested weapon is on cooldown or lacks adrenaline. Sustained behavior owns
    // the switch semantics; Loadout only records its generic held-item input observation.
    this.sustainedWeaponBehavior?.claimWeaponAction(request.playerId, request.slot, request.hostNowMs, request.angle);
    this.loadout.noteWeaponAction(request.playerId, request.slot, request.hostNowMs, request.angle);

    return this.activate(request, player, config);
  }

  private activate(request: PlayerWeaponActionRequest, player: PlayerActionActor, config: WeaponConfig): LoadoutUseResult {
    const position = resolvePlayerActionPosition(player, request.clientPosition);
    const sustainedRequest: SustainedWeaponActionRequest = {
      playerId: request.playerId,
      slot: request.slot,
      config,
      x: position.x,
      y: position.y,
      angle: request.angle,
      nowMs: request.hostNowMs,
      playerColor: player.color,
      params: request.params,
    };
    const sustainedResult = this.sustainedWeaponBehavior?.activateWeapon(sustainedRequest) ?? null;
    if (sustainedResult !== null) {
      if (sustainedResult.ok) {
        this.actor.breakStealth?.(request.playerId, request.hostNowMs);
        this.weaponActivation.noteWeaponFired(request.playerId, request.slot, request.hostNowMs);
      }
      return sustainedResult;
    }

    const result = this.weaponActivation.activateWeapon({
      playerId: request.playerId,
      slot: request.slot,
      config,
      x: position.x,
      y: position.y,
      angle: request.angle,
      targetX: request.targetX,
      targetY: request.targetY,
      nowMs: request.hostNowMs,
      shotId: request.shotId,
      predictionId: request.predictionId,
      params: request.params,
    });
    if (result.ok) {
      this.actor.breakStealth?.(request.playerId, request.hostNowMs);
      this.weaponActivation.noteWeaponFired(request.playerId, request.slot, request.hostNowMs);
    }
    return result;
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelAllScopes();
    this.latestScopeIds.clear();
  }

  /** Revalidated before movement, and also at every input to close pre-update races. */
  updateScopes(nowMs: number): void {
    for (const [playerId, state] of this.scopes) {
      if (!Number.isFinite(nowMs) || nowMs < state.lastHeldAt
        || nowMs - state.lastHeldAt >= HELD_WEAPON_INPUT_TIMEOUT_MS
        || this.loadout.getEquippedWeaponConfig(playerId, 'weapon2') !== state.config
        || !this.canScope(playerId)) this.cancelScope(playerId);
    }
  }

  cancelScope(playerId: string): void {
    if (!this.scopes.delete(playerId)) return;
    this.loadout.clearHeldWeaponAction(playerId);
  }

  cancelAllScopes(): void {
    for (const playerId of this.scopes.keys()) this.cancelScope(playerId);
  }

  removePlayer(playerId: string): void {
    this.cancelScope(playerId);
    // The same peer can re-enter this World; old gesture IDs remain consumed until destroy.
  }

  private canScope(playerId: string): boolean {
    return this.actor.getPlayer(playerId) !== undefined && this.actor.canInteract(playerId)
      && this.actor.isAlive(playerId) && !this.actor.isWeaponBlocked(playerId) && !this.actor.isDashBurst(playerId);
  }

  private inputScope(request: PlayerWeaponActionRequest, config: WeaponConfig | undefined): LoadoutUseResult {
    const input = request.params!.scope;
    if (!input || request.slot !== 'weapon2' || !Number.isSafeInteger(input.id) || input.id <= 0
      || !['hold', 'release', 'cancel'].includes(input.phase)
      || ![request.angle, request.targetX, request.targetY, request.hostNowMs].every(Number.isFinite)) {
      return { ok: false, reason: 'invalid' };
    }
    const playerId = request.playerId, now = request.hostNowMs;
    const latest = this.latestScopeIds.get(playerId) ?? 0;
    if (input.id < latest) return { ok: false, reason: 'invalid', scopeGestureIdFloor: latest };
    if (input.phase === 'cancel') {
      this.latestScopeIds.set(playerId, input.id);
      this.cancelScope(playerId);
      return { ok: true };
    }
    let state = this.scopes.get(playerId);
    if (state && (state.config !== config || now < state.lastHeldAt
      || now - state.lastHeldAt >= HELD_WEAPON_INPUT_TIMEOUT_MS)) {
      this.cancelScope(playerId);
      state = undefined;
    }
    if (!config?.scopeConfig || !this.canScope(playerId)) {
      this.cancelScope(playerId);
      this.latestScopeIds.set(playerId, input.id);
      return { ok: false, reason: 'blocked' };
    }
    if (!state || state.id !== input.id) {
      if (input.id <= latest || input.phase !== 'hold') {
        return { ok: false, reason: 'invalid', scopeGestureIdFloor: latest };
      }
      this.cancelScope(playerId);
      this.latestScopeIds.set(playerId, input.id);
      this.rocketMagazine?.cancel(playerId);
      this.sustainedWeaponBehavior?.claimWeaponAction(playerId, request.slot, now, request.angle);
      const readiness = this.weaponActivation.canStartScope(playerId, request.slot, config, now);
      if (!readiness.ok) return readiness;
      state = { id: input.id, config, startedAt: now, lastHeldAt: now };
      this.scopes.set(playerId, state);
    } else {
      this.sustainedWeaponBehavior?.claimWeaponAction(playerId, request.slot, now, request.angle);
    }
    this.rocketMagazine?.cancel(playerId);
    if (input.phase === 'hold') {
      state.lastHeldAt = now;
      this.loadout.noteWeaponAction(playerId, request.slot, now, request.angle, HELD_WEAPON_INPUT_TIMEOUT_MS);
      return { ok: true };
    }
    // Close before dispatch so retries, rejection and reentrant actions cannot reuse the charge.
    this.cancelScope(playerId);
    const elapsed = Math.max(0, now - state.startedAt);
    return this.activate({ ...request, params: { ...request.params,
      scopeProgress: Math.min(1, elapsed / Math.max(1, config.scopeConfig.scopeInMs)),
      scopeChargeProgress: config.awpCharge ? Math.min(1, elapsed / Math.max(1, config.awpCharge.durationMs)) : 0,
    } }, this.actor.getPlayer(playerId)!, config);
  }
}
