/** Shortest signed difference. An exact half-turn consistently takes the negative path. */
export function turretAngleDifference(from: number, to: number): number {
  const tau = 2 * Math.PI;
  return ((to - from + Math.PI) % tau + tau) % tau - Math.PI;
}

export function stepTurretAngle(from: number, to: number, speedDegPerSec: number, deltaMs: number): number {
  const difference = turretAngleDifference(from, to);
  const step = speedDegPerSec * Math.PI / 180 * (Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0) / 1000;
  return from + Math.sign(difference) * Math.min(Math.abs(difference), step);
}
