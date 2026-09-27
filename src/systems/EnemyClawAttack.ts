/** Host-owned timing; presentation samples this timeline without deciding hits. */
export interface EnemyMeleeTiming {
  readonly hitDelayMs: number;
  readonly strikeMs: number;
  readonly recoveryMs: number;
}

export interface EnemyClawAttack {
  readonly attackId: string;
  readonly weaponId: string;
  readonly startedAt: number;
  readonly strikeAt: number;
  readonly hitAt: number;
  readonly endsAt: number;
  readonly angle: number;
  readonly range: number;
  readonly arcDegrees: number;
}

export interface EnemyClawState {
  readonly revision: number;
  readonly attack: EnemyClawAttack | null;
}

export interface EnemyClawEvent {
  readonly enemyId: string;
  readonly entityGeneration: number;
  readonly state: EnemyClawState;
}

export interface EnemyClawNetworkPort {
  broadcast(event: EnemyClawEvent): void;
  subscribe(handler: (event: EnemyClawEvent) => void): () => void;
}

export const EMPTY_ENEMY_CLAW_STATE: EnemyClawState = Object.freeze({ revision: 0, attack: null });

export function isEnemyClawEvent(value: unknown): value is EnemyClawEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as EnemyClawEvent;
  return typeof event.enemyId === 'string' && Number.isSafeInteger(event.entityGeneration)
    && event.entityGeneration > 0 && isEnemyClawState(event.state);
}

export function isEnemyClawState(value: unknown): value is EnemyClawState {
  if (!value || typeof value !== 'object') return false;
  const { revision, attack } = value as EnemyClawState;
  if (!Number.isSafeInteger(revision) || revision < 0) return false;
  if (attack === null) return true;
  return !!attack && typeof attack.attackId === 'string' && attack.attackId.length > 0
    && typeof attack.weaponId === 'string'
    && [attack.startedAt, attack.strikeAt, attack.hitAt, attack.endsAt, attack.angle, attack.range, attack.arcDegrees].every(Number.isFinite)
    && attack.startedAt < attack.strikeAt && attack.strikeAt < attack.hitAt && attack.hitAt < attack.endsAt
    && attack.range > 0 && attack.arcDegrees > 0 && attack.arcDegrees <= 360;
}

/** Clip-local indices. The authored markers separate slow anticipation from the fast strike. */
export function clawFrameIndex(attack: EnemyClawAttack, now: number, count: number, markers: { strike: number; impact: number }): number {
  const [fromTime, toTime, fromFrame, toFrame] = now < attack.strikeAt
    ? [attack.startedAt, attack.strikeAt, 0, markers.strike]
    : now < attack.hitAt ? [attack.strikeAt, attack.hitAt, markers.strike, markers.impact]
      : [attack.hitAt, attack.endsAt, markers.impact, count - 1];
  const progress = Math.max(0, Math.min(1, (now - fromTime) / (toTime - fromTime)));
  return Math.min(count - 1, Math.floor(fromFrame + (toFrame - fromFrame) * progress));
}
