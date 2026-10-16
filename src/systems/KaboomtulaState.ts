/**
 * Replicated, host-decided state of one Kabummtula (kamikaze spider). The host publishes every
 * transition with a growing `revision`; clients only draw the timeline (alert pose, tracking
 * telegraph towards `target`, the locked leap on its flight line, recovery, web spit).
 *
 * Timeline per phase (host time, ms): `startedAt` → `endsAt` (0 = open-ended). In `pounce`,
 * `endsAt` is the launch moment; in `leap` the flight runs `leap.takeoffAt` → `leap.landAt`.
 */
// Append-only: the index is the wire code.
export const KABOOMTULA_PHASES = ['approach', 'alert', 'rush', 'pounce', 'leap', 'recover', 'spit'] as const;
export type KaboomtulaPhase = typeof KABOOMTULA_PHASES[number];

// Append-only: the index is the wire code.
export const KABOOMTULA_TARGET_KINDS = ['player', 'decoy', 'structure', 'base', 'turret'] as const;
export type KaboomtulaTargetKind = typeof KABOOMTULA_TARGET_KINDS[number];

export interface KaboomtulaTargetRef {
  readonly kind: KaboomtulaTargetKind;
  readonly id: string;
}

/** Host-locked leap: fixed lane from origin to end, flown between take-off and landing. */
export interface KaboomtulaLeap {
  readonly originX: number;
  readonly originY: number;
  readonly endX: number;
  readonly endY: number;
  readonly takeoffAt: number;
  readonly landAt: number;
}

export interface KaboomtulaState {
  readonly revision: number;
  readonly phase: KaboomtulaPhase;
  readonly startedAt: number;
  readonly endsAt: number;
  readonly target: KaboomtulaTargetRef | null;
  readonly leap: KaboomtulaLeap | null;
}

export const EMPTY_KABOOMTULA_STATE: KaboomtulaState = Object.freeze({
  revision: 0, phase: 'approach', startedAt: 0, endsAt: 0, target: null, leap: null,
});

/** Flight progress in [0, 1]; 0 before take-off, 1 once landed. */
export function kaboomtulaLeapProgress(leap: KaboomtulaLeap, now: number): number {
  return Math.max(0, Math.min(1, (now - leap.takeoffAt) / Math.max(1, leap.landAt - leap.takeoffAt)));
}

/** Progress of the current phase window in [0, 1]; open-ended phases report 0. */
export function kaboomtulaPhaseProgress(state: KaboomtulaState, now: number): number {
  if (state.endsAt <= state.startedAt) return 0;
  return Math.max(0, Math.min(1, (now - state.startedAt) / (state.endsAt - state.startedAt)));
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Structural validation for decoded or remote state; invalid optional state is ignored. */
export function isKaboomtulaState(value: unknown): value is KaboomtulaState {
  if (!value || typeof value !== 'object') return false;
  const state = value as KaboomtulaState;
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) return false;
  if (!KABOOMTULA_PHASES.includes(state.phase) || !finite(state.startedAt) || !finite(state.endsAt)) return false;
  const target = state.target;
  if (target !== null && (!target || typeof target !== 'object' || !KABOOMTULA_TARGET_KINDS.includes(target.kind)
    || typeof target.id !== 'string' || target.id.length === 0)) return false;
  const leap = state.leap;
  if (leap === null) return true;
  return !!leap && typeof leap === 'object'
    && [leap.originX, leap.originY, leap.endX, leap.endY, leap.takeoffAt, leap.landAt].every(finite)
    && leap.takeoffAt <= leap.landAt;
}
