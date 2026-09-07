import type { WeaponSlot } from '../types';

/** One accepted player activation, independent of pellet or child-projectile count. */
export interface WeaponShotFeedbackEvent {
  readonly shooterId: string;
  readonly weaponId: string;
  readonly slot: WeaponSlot;
  readonly angle: number;
  readonly sequence: number;
  readonly predictionId?: number;
}

export function isWeaponShotFeedbackEvent(value: unknown): value is WeaponShotFeedbackEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as WeaponShotFeedbackEvent;
  return typeof e.shooterId === 'string' && e.shooterId.length > 0
    && typeof e.weaponId === 'string' && e.weaponId.length > 0
    && (e.slot === 'weapon1' || e.slot === 'weapon2')
    && Number.isFinite(e.angle) && Number.isSafeInteger(e.sequence) && e.sequence > 0
    && (e.predictionId === undefined || (Number.isSafeInteger(e.predictionId) && e.predictionId > 0));
}
