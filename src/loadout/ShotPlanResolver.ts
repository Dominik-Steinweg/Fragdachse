import type { WeaponConfig } from './LoadoutConfig';
import { calcPelletAngles } from './SpreadMath';

export interface ResolveShotSpreadOptions {
  readonly config: WeaponConfig;
  readonly dynamicSpread: number;
  readonly isMoving?: boolean;
  readonly scopeProgress?: number;
  readonly fireControlSpreadMultiplier?: number;
}

export interface ShotFanoutItem {
  readonly angle: number;
  readonly config: WeaponConfig;
  readonly isMainAudioShot: boolean;
}

export interface ResolveShotPlanOptions {
  readonly config: WeaponConfig;
  readonly aimAngle: number;
  readonly dynamicSpread: number;
  readonly isMoving?: boolean;
  readonly scopeProgress?: number;
  readonly fireControlSpreadMultiplier?: number;
  readonly random?: () => number;
}

export interface ResolvedShotPlan {
  readonly totalSpreadDeg: number;
  readonly halfSpreadRad: number;
  readonly pelletCount: number;
  readonly shots: readonly ShotFanoutItem[];
}

/**
 * Berechnet den Gesamtwinkel des Spreads (in Grad) aus statischem Spread, dynamischem Bloom,
 * Bewegungsstatus und Scope-Fortschritt.
 */
export function resolveTotalSpreadDeg(options: ResolveShotSpreadOptions): number {
  const { config, dynamicSpread, isMoving = false, scopeProgress, fireControlSpreadMultiplier = 1 } = options;
  const fullyAimedSpread = isMoving ? config.spreadMoving : config.spreadStanding;
  let baseSpread: number;
  if (config.scopeConfig !== undefined && scopeProgress !== undefined) {
    baseSpread = config.scopeConfig.unscopedSpreadDeg + (fullyAimedSpread - config.scopeConfig.unscopedSpreadDeg) * scopeProgress;
  } else {
    baseSpread = fullyAimedSpread;
  }
  return Math.max(0, (baseSpread + dynamicSpread) * fireControlSpreadMultiplier);
}

/**
 * Berechnet die effektive Pelletanzahl unter Berücksichtigung von Pellet-Multiplikatoren.
 */
export function resolveEffectivePelletCount(config: WeaponConfig): number {
  return Math.max(1, Math.round((config.pelletCount ?? 1) * (config.pelletCountMultiplier ?? 1)));
}

/**
 * Gemeinsamer Shot-Plan-Resolver für Runtime (`LoadoutManager`) und Headless-Simulation (`Balance Lab`).
 *
 * Berechnet Spread, Pellet-Auffächerung und individuelle Schusswinkel über eine injizierbare RNG-Quelle.
 */
export function resolveShotPlan(options: ResolveShotPlanOptions): ResolvedShotPlan {
  const {
    config,
    aimAngle,
    dynamicSpread,
    isMoving = false,
    scopeProgress,
    fireControlSpreadMultiplier = 1,
    random = Math.random,
  } = options;

  const totalSpreadDeg = resolveTotalSpreadDeg({
    config,
    dynamicSpread,
    isMoving,
    scopeProgress,
    fireControlSpreadMultiplier,
  });
  const halfSpreadRad = (totalSpreadDeg * Math.PI / 180) / 2;
  const pelletCount = resolveEffectivePelletCount(config);

  const shots: ShotFanoutItem[] = [];

  if (pelletCount > 1) {
    const pelletOffsets = calcPelletAngles(pelletCount, config.pelletSpreadAngle ?? 0);
    for (let index = 0; index < pelletOffsets.length; index += 1) {
      const offset = pelletOffsets[index];
      const spreadRoll = (random() * 2 - 1) * halfSpreadRad;
      const angle = aimAngle + offset + spreadRoll;
      const shotConfig = index === 0 ? config : { ...config, shotAudio: undefined };
      shots.push({
        angle,
        config: shotConfig,
        isMainAudioShot: index === 0,
      });
    }
  } else {
    const spreadRoll = (random() * 2 - 1) * halfSpreadRad;
    const angle = aimAngle + spreadRoll;
    shots.push({
      angle,
      config,
      isMainAudioShot: true,
    });
  }

  return {
    totalSpreadDeg,
    halfSpreadRad,
    pelletCount,
    shots,
  };
}
