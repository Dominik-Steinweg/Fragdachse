import type { RechargeableChargeSnapshot } from '../systems/RechargeableCharges';

/** Player adapter projection. The reusable charge stock knows neither utility IDs nor lockouts. */
export interface UtilityChargeState extends RechargeableChargeSnapshot {
  readonly utilityId: string;
  readonly revision: number;
  readonly lockoutUntil: number;
  readonly lastCommittedAttemptId?: string;
}

export function getUtilityChargeReadyAt(state: UtilityChargeState): number {
  return Math.max(state.lockoutUntil, state.availableCharges > 0 ? 0 : state.nextChargeAt ?? Infinity);
}

export function getUtilityRechargeFraction(state: UtilityChargeState, now: number): number {
  return state.nextChargeAt === null || state.rechargeIntervalMs <= 0 ? 0
    : Math.max(0, Math.min(1, (state.nextChargeAt - now) / state.rechargeIntervalMs));
}

export function parseUtilityChargeState(raw: unknown): UtilityChargeState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as UtilityChargeState;
  if (typeof s.utilityId !== 'string' || s.utilityId.length === 0
    || !Number.isSafeInteger(s.revision) || s.revision < 0
    || !Number.isSafeInteger(s.maxCharges) || s.maxCharges < 1
    || !Number.isSafeInteger(s.availableCharges) || s.availableCharges < 0 || s.availableCharges > s.maxCharges
    || !Number.isFinite(s.rechargeIntervalMs) || s.rechargeIntervalMs < 0
    || !Number.isFinite(s.lockoutUntil)
    || (s.nextChargeAt !== null && !Number.isFinite(s.nextChargeAt))
    || (s.lastCommittedAttemptId !== undefined && typeof s.lastCommittedAttemptId !== 'string')) return null;
  return { utilityId: s.utilityId, revision: s.revision, maxCharges: s.maxCharges,
    availableCharges: s.availableCharges, rechargeIntervalMs: s.rechargeIntervalMs,
    nextChargeAt: s.nextChargeAt, lockoutUntil: s.lockoutUntil,
    ...(s.lastCommittedAttemptId === undefined ? {} : { lastCommittedAttemptId: s.lastCommittedAttemptId }) };
}
