import type { ExplosionVisualStyle } from '../../types';
import type { CombatExplosionVisualStyle } from '../ExplosionVisualProfiles';
import {
  DISTORTION_PRIORITY,
  type DistortionSourceState,
} from './distortionFramePlanner';

export const EXPLOSION_SHOCKWAVE_MIN_RADIUS_PX = 128;
export const EXPLOSION_SHOCKWAVE_DURATION_MS = 280;

const PHYSICAL_EXPLOSION_STYLES = new Set<ExplosionVisualStyle>([
  'default',
  'rocket',
  'mini_rocket',
  'mini_rocket_cascade',
  'train',
]);

export interface ExplosionShockwaveSequence {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  readonly peakStrength: number;
  elapsedMs: number;
}

export function shouldStartExplosionShockwave(
  style: CombatExplosionVisualStyle,
  radiusPx: number,
): boolean {
  return radiusPx >= EXPLOSION_SHOCKWAVE_MIN_RADIUS_PX
    && PHYSICAL_EXPLOSION_STYLES.has(style);
}

export function createExplosionShockwaveSequence(
  id: number,
  x: number,
  y: number,
  radiusPx: number,
  style: CombatExplosionVisualStyle,
): ExplosionShockwaveSequence {
  return {
    id: `explosionShockwave:${id}`,
    x,
    y,
    radiusPx,
    peakStrength: style === 'train' ? 0.3 : 0.22,
    elapsedMs: 0,
  };
}

export function resolveExplosionShockwaveFrame(
  sequence: ExplosionShockwaveSequence,
): DistortionSourceState | null {
  const progress = Math.min(1, Math.max(0, sequence.elapsedMs / EXPLOSION_SHOCKWAVE_DURATION_MS));
  if (progress >= 1) return null;

  return {
    id: sequence.id,
    profile: 'ring',
    worldX: sequence.x,
    worldY: sequence.y,
    radiusPx: sequence.radiusPx * (0.35 + 0.9 * progress),
    strength: sequence.peakStrength * Math.sin(Math.PI * progress),
    priority: DISTORTION_PRIORITY.shockwave,
  };
}
