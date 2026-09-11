/** Authored angular motion; angles in runtime and snapshots remain radians. */
export interface TurretAimConfig {
  readonly rotationSpeedDegPerSec?: number;
  readonly aimToleranceDeg?: number;
}

export const DEFAULT_TURRET_AIM_TOLERANCE_DEG = 3;

export function validateTurretAimConfig(value: {
  rotationSpeedDegPerSec?: unknown; aimToleranceDeg?: unknown;
}): string[] {
  const issues: string[] = [];
  const speed = value.rotationSpeedDegPerSec;
  const tolerance = value.aimToleranceDeg;
  if (speed !== undefined && (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0)) {
    issues.push('rotationSpeedDegPerSec: positive finite number required');
  }
  if (tolerance !== undefined && (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 180)) {
    issues.push('aimToleranceDeg: finite number from 0 to 180 required');
  }
  return issues;
}

/** Copy only this contract, preserving absent optional fields. */
export function turretAimConfig(config: TurretAimConfig): TurretAimConfig {
  return {
    ...(config.rotationSpeedDegPerSec === undefined ? {} : { rotationSpeedDegPerSec: config.rotationSpeedDegPerSec }),
    ...(config.aimToleranceDeg === undefined ? {} : { aimToleranceDeg: config.aimToleranceDeg }),
  };
}
