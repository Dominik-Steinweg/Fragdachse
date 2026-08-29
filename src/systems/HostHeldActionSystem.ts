import type { HostHeldActionKind, LoadoutToolRef } from '../types';

/** Stable identity of the loadout action that started a held action. */
export interface HeldActionIdentity {
  readonly toolRef?: LoadoutToolRef;
  readonly temporaryUtilityInstanceId?: string;
}

interface ActiveHeldAction {
  readonly actionId: string;
  readonly kind: HostHeldActionKind;
  readonly identity?: HeldActionIdentity;
  readonly startedAtHostMs: number;
  readonly timeoutAtHostMs: number;
}

export interface ConsumedHeldAction {
  readonly elapsedMs: number;
  readonly chargeFraction: number;
}

const ACTION_TIMEOUT_GRACE_MS = 2_000;

/** Rundenbezogene Host-Autoritaet fuer aufladbare Client-Aktionen. */
export class HostHeldActionSystem {
  private readonly actions = new Map<string, ActiveHeldAction>();

  start(
    playerId: string,
    actionId: string,
    kind: HostHeldActionKind,
    expectedDurationMs: number,
    hostNowMs: number,
    identity?: HeldActionIdentity,
  ): boolean {
    if (!isValidActionId(actionId) || !isHeldActionKind(kind)
      || !Number.isFinite(expectedDurationMs) || expectedDurationMs <= 0
      || !Number.isFinite(hostNowMs)
      || !isValidHeldActionIdentity(identity)) return false;
    this.actions.set(playerId, {
      actionId,
      kind,
      ...(identity ? { identity: cloneHeldActionIdentity(identity) } : {}),
      startedAtHostMs: hostNowMs,
      timeoutAtHostMs: hostNowMs + Math.max(1, expectedDurationMs) + ACTION_TIMEOUT_GRACE_MS,
    });
    return true;
  }

  cancel(playerId: string, actionId?: string): void {
    const action = this.actions.get(playerId);
    if (!action || (actionId !== undefined && action.actionId !== actionId)) return;
    this.actions.delete(playerId);
  }

  consume(
    playerId: string,
    actionId: string | undefined,
    kind: HostHeldActionKind,
    fullChargeDurationMs: number,
    hostNowMs: number,
    expectedIdentity?: HeldActionIdentity,
  ): ConsumedHeldAction | null {
    const action = this.actions.get(playerId);
    // Ein verspaeteter Commit einer ersetzten Action darf die neuere Action nicht loeschen.
    if (!action || !actionId || action.actionId !== actionId) return null;
    this.actions.delete(playerId);
    if (action.kind !== kind
      || !isValidHeldActionIdentity(expectedIdentity)
      || getHeldActionIdentityKey(action.identity) !== getHeldActionIdentityKey(expectedIdentity)
      || !Number.isFinite(fullChargeDurationMs) || fullChargeDurationMs <= 0
      || !Number.isFinite(hostNowMs) || hostNowMs < action.startedAtHostMs
      || hostNowMs > action.timeoutAtHostMs) return null;
    const elapsedMs = Math.max(0, hostNowMs - action.startedAtHostMs);
    return {
      elapsedMs,
      chargeFraction: Math.max(0, Math.min(1, elapsedMs / fullChargeDurationMs)),
    };
  }

  clearPlayer(playerId: string): void {
    this.actions.delete(playerId);
  }

  clearExpired(hostNowMs: number): void {
    for (const [playerId, action] of this.actions) {
      if (hostNowMs > action.timeoutAtHostMs) this.actions.delete(playerId);
    }
  }

  reset(): void {
    this.actions.clear();
  }
}

export function isHeldActionKind(value: unknown): value is HostHeldActionKind {
  return value === 'charged_throw' || value === 'charged_gate' || value === 'global_dismantle';
}

function isValidActionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 && value.trim() === value;
}

function isValidHeldActionIdentity(value: HeldActionIdentity | undefined): boolean {
  if (!value) return true;
  if (value.toolRef !== undefined && value.temporaryUtilityInstanceId !== undefined) return false;
  if (value.temporaryUtilityInstanceId !== undefined && !isValidActionId(value.temporaryUtilityInstanceId)) return false;
  if (value.toolRef !== undefined) {
    if (value.toolRef.kind !== 'utility' && value.toolRef.kind !== 'construction') return false;
    if (!isValidActionId(value.toolRef.id)) return false;
  }
  return true;
}

function cloneHeldActionIdentity(identity: HeldActionIdentity): HeldActionIdentity {
  return {
    ...(identity.toolRef ? { toolRef: { ...identity.toolRef } } : {}),
    ...(identity.temporaryUtilityInstanceId !== undefined
      ? { temporaryUtilityInstanceId: identity.temporaryUtilityInstanceId }
      : {}),
  } as HeldActionIdentity;
}

function getHeldActionIdentityKey(identity: HeldActionIdentity | undefined): string {
  if (!identity) return 'equipped-utility';
  if (identity.temporaryUtilityInstanceId !== undefined) {
    return `temporary-utility:${identity.temporaryUtilityInstanceId}`;
  }
  if (identity.toolRef) return `tool:${identity.toolRef.kind}:${identity.toolRef.id}`;
  return 'equipped-utility';
}
