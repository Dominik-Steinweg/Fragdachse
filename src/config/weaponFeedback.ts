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
  light: { mode: 'impulse', kickPx: 3, rotationDeg: 3, returnMs: 120, cameraPx: 2.6, cameraMs: 130 },
  rapid: { mode: 'impulse', kickPx: 2.7, rotationDeg: 2.5, returnMs: 100, cameraPx: 1.8, cameraMs: 100 },
  medium: { mode: 'impulse', kickPx: 4.5, rotationDeg: 4, returnMs: 150, cameraPx: 3.6, cameraMs: 150 },
  heavy: { mode: 'impulse', kickPx: 6, rotationDeg: 5, returnMs: 190, cameraPx: 5.5, cameraMs: 190 },
  precision: { mode: 'impulse', kickPx: 7, rotationDeg: 4, returnMs: 210, cameraPx: 6.5, cameraMs: 210 },
  stream: { mode: 'sustained', kickPx: 2.8, rotationDeg: 0, returnMs: 150, cameraPx: 1.8, cameraMs: 130 },
} as const satisfies Readonly<Record<string, WeaponFeedbackProfile>>;

export type WeaponFeedbackProfileId = keyof typeof WEAPON_FEEDBACK_PROFILES;
export function isWeaponFeedbackProfileId(value: unknown): value is WeaponFeedbackProfileId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WEAPON_FEEDBACK_PROFILES, value);
}

export const WEAPON_FEEDBACK_ATTACK_MS = 10;
/** Keep the silhouette displaced across several render frames before returning. */
export const WEAPON_FEEDBACK_HOLD_MS = 24;
export const WEAPON_FEEDBACK_MAX_STACK = 1.5;
export const WEAPON_FEEDBACK_STREAM_ATTACK_MS = 40;
export const WEAPON_FEEDBACK_STREAM_TIMEOUT_MS = 220;
