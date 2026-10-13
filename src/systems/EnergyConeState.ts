/**
 * Replicated, host-fixed energy cone ("Energie-Fächer") of one enemy. The host decides every
 * value; clients only draw it (no target prediction, no local clock). `revision` grows with every
 * change so stale deltas never restart a telegraph.
 *
 * Timeline (host time, ms): startedAt → windup (origin, direction and range fixed; the cover
 * profile may still shrink or grow) → hitAt (single impulse) → recover → recoverUntil.
 * A windup that ends in phase `none` was cancelled: no impulse happened. Phase `recover` is only
 * published after the impulse was resolved.
 */
export type EnergyConePhase = 'none' | 'windup' | 'recover';
export const ENERGY_CONE_PHASES = ['none', 'windup', 'recover'] as const satisfies readonly EnergyConePhase[];

/** Rays of the cover profile, evenly from the left to the right edge (both edges included). */
export const ENERGY_CONE_CLIP_RAYS = 16;
/** Wire quantization of one ray reach (fraction of `range`). */
export const ENERGY_CONE_CLIP_QUANT = 255;

export interface EnergyConeAttack {
  readonly originX: number;
  readonly originY: number;
  /** Fixed world direction of the cone axis in radians. */
  readonly angle: number;
  /** Nominal reach before cover clipping (px). */
  readonly range: number;
  /** Full opening angle in degrees. */
  readonly arcDegrees: number;
  readonly startedAt: number;
  readonly hitAt: number;
  readonly recoverUntil: number;
  /**
   * Reach of each ray as a fraction of `range` (0..1), clipped at shot-blocking world geometry.
   * Presentation only: the impulse resolves cover per target at `hitAt`.
   */
  readonly clip: readonly number[];
}

export interface EnergyConeState {
  readonly revision: number;
  readonly phase: EnergyConePhase;
  readonly attack: EnergyConeAttack | null;
}

export const EMPTY_ENERGY_CONE_STATE: EnergyConeState = Object.freeze({ revision: 0, phase: 'none', attack: null });

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Structural validation for decoded or remote state; invalid optional state is ignored. */
export function isEnergyConeState(value: unknown): value is EnergyConeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as EnergyConeState;
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) return false;
  if (!(ENERGY_CONE_PHASES as readonly string[]).includes(state.phase)) return false;
  const attack = state.attack;
  if (state.phase === 'none' && attack === null) return true;
  return !!attack && [attack.originX, attack.originY, attack.angle, attack.range, attack.arcDegrees,
    attack.startedAt, attack.hitAt, attack.recoverUntil].every(finite)
    && attack.range > 0 && attack.arcDegrees > 0 && attack.arcDegrees < 360
    && attack.startedAt <= attack.hitAt && attack.hitAt <= attack.recoverUntil
    && Array.isArray(attack.clip) && attack.clip.length === ENERGY_CONE_CLIP_RAYS
    && attack.clip.every(reach => finite(reach) && reach >= 0 && reach <= 1);
}

/** World angle of clip ray `index` (0 = left edge, last = right edge). */
export function energyConeRayAngle(attack: Pick<EnergyConeAttack, 'angle' | 'arcDegrees'>, index: number): number {
  const half = attack.arcDegrees * Math.PI / 360;
  return attack.angle - half + 2 * half * index / (ENERGY_CONE_CLIP_RAYS - 1);
}

/**
 * Clipped reach (px) at `offset` radians from the axis, linearly interpolated between the two
 * neighbouring rays; 0 outside the opening angle.
 */
export function energyConeReachAt(attack: EnergyConeAttack, offset: number): number {
  const half = attack.arcDegrees * Math.PI / 360;
  if (Math.abs(offset) > half) return 0;
  const position = (offset + half) / (2 * half) * (ENERGY_CONE_CLIP_RAYS - 1);
  const low = Math.min(ENERGY_CONE_CLIP_RAYS - 2, Math.floor(position));
  const t = position - low;
  return attack.range * (attack.clip[low] * (1 - t) + attack.clip[low + 1] * t);
}

/** Quantize a reach fraction the way the wire carries it, so host and clients agree exactly. */
export function quantizeEnergyConeReach(fraction: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction)) * ENERGY_CONE_CLIP_QUANT) / ENERGY_CONE_CLIP_QUANT;
}
