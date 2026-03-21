import type { WeaponConfig } from './LoadoutConfig';

export function addDynamicSpread(current: number, config: WeaponConfig): number {
  const next = current + config.spreadPerShot;
  // Negev-style weapons: spreadPerShot < 0 → dynamic spread decreases from 0 towards negative maxDynamicSpread
  if (config.maxDynamicSpread >= 0) {
    return Math.min(config.maxDynamicSpread, Math.max(0, next));
  }
  return Math.max(config.maxDynamicSpread, Math.min(0, next));
}

export function decayDynamicSpread(
  current: number,
  config: WeaponConfig,
  delta: number,
  elapsedSinceShot: number,
): number {
  if (current === 0) return 0;
  if (elapsedSinceShot < config.spreadRecoveryDelay) return current;

  const ticks = delta / config.spreadRecoverySpeed;
  const step = ticks * Math.abs(config.spreadRecoveryRate);
  // Decay towards 0 from either direction (positive bloom or negative Negev-warmup)
  if (current > 0) return Math.max(0, current - step);
  return Math.min(0, current + step);
}

export function isVelocityMoving(vx: number, vy: number): boolean {
  return Math.abs(vx) > 0.5 || Math.abs(vy) > 0.5;
}

/**
 * Berechnet die Winkeloffsets (in Radiant) für alle Pellets einer Mehrfach-Projektil-Waffe.
 *
 * Verteilungsregel:
 *   - pelletCount = 1  → [0]
 *   - ungerade Anzahl  → gleichmäßig verteilt mit mittlerem Projektil bei 0°
 *   - gerade Anzahl   → gleichmäßig verteilt, kein Projektil bei 0°
 *
 * Beispiele (spreadAngleDeg = y):
 *   x=3, y=10  → [-10°, 0°, 10°]
 *   x=5, y=30  → [-30°, -15°, 0°, 15°, 30°]
 *   x=4, y=20  → [-20°, -10°, 10°, 20°]
 *
 * @param pelletCount     Anzahl der Projektile
 * @param spreadAngleDeg  Halbwinkel des Auffächerungsbereichs in Grad (Range: [-y, +y])
 */
export function calcPelletAngles(pelletCount: number, spreadAngleDeg: number): number[] {
  if (pelletCount <= 1) return [0];

  const isOdd  = pelletCount % 2 !== 0;
  const nHalf  = isOdd ? (pelletCount - 1) / 2 : pelletCount / 2;
  const stepDeg = nHalf > 0 ? spreadAngleDeg / nHalf : 0;

  const offsets: number[] = [];

  if (isOdd) {
    offsets.push(0); // mittleres Projektil bei 0°
  }

  for (let i = 1; i <= nHalf; i++) {
    const rad = (i * stepDeg) * (Math.PI / 180);
    offsets.push(-rad, rad);
  }

  return offsets.sort((a, b) => a - b);
}
