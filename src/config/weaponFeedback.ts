/** Presentation tuning in the held-item 32 px reference space; camera values are design pixels. */
export interface WeaponFeedbackProfile {
  readonly mode: 'impulse' | 'sustained';
  readonly kickPx: number;
  readonly rotationDeg: number;
  readonly returnMs: number;
  readonly cameraPx: number;
  readonly cameraMs: number;
}

export const WEAPON_FEEDBACK_PROFILES = {
  light: { mode: 'impulse', kickPx: 1.5, rotationDeg: 0.5, returnMs: 100, cameraPx: 0.6, cameraMs: 70 },
  rapid: { mode: 'impulse', kickPx: 1.2, rotationDeg: 0.5, returnMs: 80, cameraPx: 0.4, cameraMs: 60 },
  medium: { mode: 'impulse', kickPx: 2.2, rotationDeg: 1, returnMs: 130, cameraPx: 1, cameraMs: 90 },
  heavy: { mode: 'impulse', kickPx: 3.5, rotationDeg: 1.5, returnMs: 170, cameraPx: 2.2, cameraMs: 120 },
  precision: { mode: 'impulse', kickPx: 4, rotationDeg: 1, returnMs: 190, cameraPx: 3, cameraMs: 140 },
  stream: { mode: 'sustained', kickPx: 1.5, rotationDeg: 0, returnMs: 120, cameraPx: 0.3, cameraMs: 70 },
} as const satisfies Readonly<Record<string, WeaponFeedbackProfile>>;

export type WeaponFeedbackProfileId = keyof typeof WEAPON_FEEDBACK_PROFILES;
export function isWeaponFeedbackProfileId(value: unknown): value is WeaponFeedbackProfileId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WEAPON_FEEDBACK_PROFILES, value);
}

export const WEAPON_FEEDBACK_ATTACK_MS = 10;
export const WEAPON_FEEDBACK_MAX_STACK = 1.5;
export const WEAPON_FEEDBACK_STREAM_ATTACK_MS = 40;
export const WEAPON_FEEDBACK_STREAM_TIMEOUT_MS = 220;

