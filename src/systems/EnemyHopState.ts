import { MAX_HOP_HEAL_LINKS } from '../config/coopDefenseEnemies';

/**
 * Replicated, host-fixed hop of one enemy. The host decides the jump and the heal links; the phase
 * is never sent but derived from the timeline (`enemyHopPhaseAt`) by host and clients alike, so
 * planned transitions cost no revision. `revision` grows with every published change (new jump,
 * cancel, abort, stretched flight, new links) so stale deltas never restart a jump.
 *
 * Timeline (host time, ms): crouchAt → crouch → takeoffAt → air → landAt → land → settleUntil → rest.
 */
export type EnemyHopPhase = 'rest' | 'crouch' | 'air' | 'land';

export interface EnemyHopJump {
  readonly originX: number;
  readonly originY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly crouchAt: number;
  readonly takeoffAt: number;
  readonly landAt: number;
  readonly settleUntil: number;
  /** The landing was armed against a nearby player and is telegraphed. */
  readonly shock: boolean;
}

export interface EnemyHopState {
  readonly revision: number;
  /** Last decided jump; the body rests once its timeline has passed. */
  readonly jump: EnemyHopJump | null;
  /** Ids of the allies currently healed by this resting body (at most MAX_HOP_HEAL_LINKS). */
  readonly links: readonly string[];
}

export const EMPTY_ENEMY_HOP_STATE: EnemyHopState = Object.freeze({ revision: 0, jump: null, links: Object.freeze([]) });

export function enemyHopPhaseAt(state: EnemyHopState, now: number): EnemyHopPhase {
  const jump = state.jump;
  if (!jump || now >= jump.settleUntil) return 'rest';
  if (now < jump.takeoffAt) return 'crouch';
  if (now < jump.landAt) return 'air';
  return 'land';
}

/** Flight progress in [0, 1]; 0 before take-off, 1 once landed. */
export function enemyHopAirProgress(jump: EnemyHopJump, now: number): number {
  return Math.max(0, Math.min(1, (now - jump.takeoffAt) / Math.max(1, jump.landAt - jump.takeoffAt)));
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Structural validation for decoded or remote state; invalid optional state is ignored. */
export function isEnemyHopState(value: unknown): value is EnemyHopState {
  if (!value || typeof value !== 'object') return false;
  const state = value as EnemyHopState;
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) return false;
  const links = state.links;
  if (!Array.isArray(links) || links.length > MAX_HOP_HEAL_LINKS
    || links.some(id => typeof id !== 'string' || id.length === 0) || new Set(links).size !== links.length) return false;
  const jump = state.jump;
  if (jump === null) return true;
  return !!jump && typeof jump === 'object' && typeof jump.shock === 'boolean'
    && [jump.originX, jump.originY, jump.targetX, jump.targetY, jump.crouchAt, jump.takeoffAt, jump.landAt, jump.settleUntil].every(finite)
    && jump.crouchAt <= jump.takeoffAt && jump.takeoffAt <= jump.landAt && jump.landAt <= jump.settleUntil;
}
