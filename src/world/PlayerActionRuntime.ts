import type { UtilityConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { LoadoutToolRef, LoadoutUseParams, LoadoutUseResult, WeaponSlot } from '../types';

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
  readonly params?: LoadoutUseParams;
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
  claimWeaponAction(playerId: string, slot: WeaponSlot, now: number, angle: number): void;
  activateWeapon(
    playerId: string,
    slot: WeaponSlot,
    x: number,
    y: number,
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    shotId?: number,
    params?: LoadoutUseParams,
  ): LoadoutUseResult;
  completeWeaponAction(playerId: string, slot: WeaponSlot, now: number): void;
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

  constructor(
    private readonly actor: PlayerActionActorPort,
    private readonly loadout: PlayerActionLoadoutPort,
  ) {}

  execute(request: PlayerWeaponActionRequest): LoadoutUseResult {
    if (this.destroyed || request.category !== 'weapon') {
      return { ok: false, reason: 'invalid' };
    }
    if (!isValidPlayerActionAttemptId(request.attemptId)) {
      return { ok: false, reason: 'invalid' };
    }

    const player = this.actor.getPlayer(request.playerId);
    const config: WeaponConfig | undefined = this.loadout.getEquippedWeaponConfig(request.playerId, request.slot);
    if (!player || !config) return { ok: false, reason: 'invalid' };
    if (!this.actor.canInteract(request.playerId)
      || !this.actor.isAlive(request.playerId)
      || this.actor.isWeaponBlocked(request.playerId)) {
      return { ok: false, reason: 'blocked' };
    }
    if (this.actor.isDashBurst(request.playerId)) return { ok: false, reason: 'blocked' };

    this.actor.breakStealth?.(request.playerId, request.hostNowMs);

    // Claim before readiness/resource resolution: switching away from a channel is immediate even
    // when the newly requested weapon is on cooldown or lacks adrenaline.
    this.loadout.claimWeaponAction(request.playerId, request.slot, request.hostNowMs, request.angle);

    // A held scope input claims the slot and updates the hold state but does not execute a shot.
    if (request.params?.scopeHolding) return { ok: true };

    const position = resolvePlayerActionPosition(player, request.clientPosition);
    const result = this.loadout.activateWeapon(
      request.playerId,
      request.slot,
      position.x,
      position.y,
      request.angle,
      request.targetX,
      request.targetY,
      request.hostNowMs,
      request.shotId,
      request.params,
    );
    if (result.ok) {
      this.loadout.completeWeaponAction(request.playerId, request.slot, request.hostNowMs);
    }
    return result;
  }

  destroy(): void {
    this.destroyed = true;
  }
}
