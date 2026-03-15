import type { WeaponConfig } from './LoadoutConfig';

export function addDynamicSpread(current: number, config: WeaponConfig): number {
  return Math.min(config.maxDynamicSpread, current + config.spreadPerShot);
}

export function decayDynamicSpread(
  current: number,
  config: WeaponConfig,
  delta: number,
  elapsedSinceShot: number,
): number {
  if (current <= 0) return 0;
  if (elapsedSinceShot < config.spreadRecoveryDelay) return current;

  const ticks = delta / config.spreadRecoverySpeed;
  return Math.max(0, current - ticks * config.spreadRecoveryRate);
}

export function isVelocityMoving(vx: number, vy: number): boolean {
  return Math.abs(vx) > 0.5 || Math.abs(vy) > 0.5;
}