import type { WeaponConfig } from '../../loadout/LoadoutConfig';
import { resolveTotalSpreadDeg } from '../../loadout/ShotPlanResolver';
import type { SingleTargetAimPolicy, SingleTargetTriggerPolicy } from './scenarioTypes';

/** Liefert den Zielwinkel gemaess der expliziten Benchmark-Aim-Policy. */
export function resolveSingleTargetAimAngle(
  policy: SingleTargetAimPolicy,
  shooterX: number,
  shooterY: number,
  targetX: number,
  targetY: number,
): number {
  switch (policy) {
    case 'target_center':
      return Math.atan2(targetY - shooterY, targetX - shooterX);
    default: {
      const exhaustivePolicy: never = policy;
      throw new Error(`[WeaponBalanceLab] Unbekannte Aim-Policy "${exhaustivePolicy}"`);
    }
  }
}

/**
 * Berechnet den halben Bogenwinkel, den das kreisförmige Ziel vom Schützen aus einnimmt.
 */
export function calculateTargetSubtendedHalfAngleRad(
  targetRadius: number,
  targetDistance: number,
): number {
  if (targetDistance <= targetRadius || targetDistance <= 0) {
    return Math.PI / 2;
  }
  return Math.asin(Math.min(1, targetRadius / targetDistance));
}

/**
 * Berechnet den maximal zulässigen Gesamtwinkel des Spreads (in Grad), bei dem das Ziel
 * unter optimaler Zentrierung noch vollständig abgedeckt wird.
 *
 * Liegt der Basis-Spread der Waffe bereits über dem Zielwinkel, gilt der Basis-Spread als
 * minimaler Schwellenwert, damit die Waffe im Ruhezustand immer feuern kann.
 */
export function calculateMaxAllowedSpreadDeg(
  config: WeaponConfig,
  targetDistance: number,
  targetRadius: number,
): number {
  const targetHalfAngleRad = calculateTargetSubtendedHalfAngleRad(targetRadius, targetDistance);
  const targetSubtendedTotalDeg = targetHalfAngleRad * (180 / Math.PI) * 2;
  return Math.max(config.spreadStanding, targetSubtendedTotalDeg);
}

/**
 * Prüft, ob der aktuelle Spread die Schussfreigabe nach Trigger Discipline erlaubt.
 */
export function isSpreadWithinTriggerDiscipline(
  config: WeaponConfig,
  dynamicSpread: number,
  targetDistance: number,
  targetRadius: number,
): boolean {
  // Waffen ohne positiven dynamischen Spread (z.B. Negev-Warmup oder 0-Bloom) sind immer freigegeben
  if (config.maxDynamicSpread <= 0 || config.spreadPerShot <= 0) {
    return true;
  }

  const totalSpreadDeg = resolveTotalSpreadDeg({
    config,
    dynamicSpread,
    isMoving: false,
  });
  const maxAllowedDeg = calculateMaxAllowedSpreadDeg(config, targetDistance, targetRadius);
  return totalSpreadDeg <= maxAllowedDeg + 1e-6;
}

/** Schussfreigabe des versionierten Single-Target-Controllers. */
export function isSingleTargetTriggerReady(
  policy: SingleTargetTriggerPolicy,
  config: WeaponConfig,
  dynamicSpread: number,
  targetDistance: number,
  targetRadius: number,
): boolean {
  switch (policy) {
    case 'spread_coverage_and_recovery':
      return isSpreadWithinTriggerDiscipline(config, dynamicSpread, targetDistance, targetRadius);
    default: {
      const exhaustivePolicy: never = policy;
      throw new Error(`[WeaponBalanceLab] Unbekannte Trigger-Policy "${exhaustivePolicy}"`);
    }
  }
}

/**
 * Berechnet den exakten virtuellen Zeitstempel, an dem der dynamische Spread wieder weit genug
 * abgeklungen ist, um die Schussfreigabe zu erteilen.
 *
 * @param config WeaponConfig mit Spread-Recovery-Parametern
 * @param dynamicSpread Aktueller dynamischer Spread in Grad
 * @param lastUsedAt Zeitstempel des letzten Schusses
 * @param now Aktueller virtueller Zeitstempel
 * @param targetDistance Distanz zum Ziel in Pixeln
 * @param targetRadius Radius des Ziels in Pixeln
 */
export function calculateTriggerDisciplineReadyTime(
  config: WeaponConfig,
  dynamicSpread: number,
  lastUsedAt: number,
  now: number,
  targetDistance: number,
  targetRadius: number,
): number {
  if (isSpreadWithinTriggerDiscipline(config, dynamicSpread, targetDistance, targetRadius)) {
    return now;
  }

  const maxAllowedDeg = calculateMaxAllowedSpreadDeg(config, targetDistance, targetRadius);
  const maxAllowedDynamicSpread = Math.max(0, maxAllowedDeg - config.spreadStanding);
  const excessSpreadDeg = dynamicSpread - maxAllowedDynamicSpread;

  if (excessSpreadDeg <= 0) {
    return now;
  }

  const recoveryRate = Math.abs(config.spreadRecoveryRate);
  const recoverySpeed = Math.max(1, config.spreadRecoverySpeed);
  const ratePerMs = recoveryRate / recoverySpeed;

  if (ratePerMs <= 0) {
    return Infinity; // Kein Abbau konfiguriert
  }

  const elapsedSinceShot = Math.max(0, now - lastUsedAt);
  const remainingDelay = Math.max(0, config.spreadRecoveryDelay - elapsedSinceShot);
  const decayTimeMs = excessSpreadDeg / ratePerMs;

  return now + remainingDelay + decayTimeMs;
}

/** Exakter naechster Freigabezeitpunkt fuer die versionierte Trigger-Policy. */
export function calculateSingleTargetTriggerReadyTime(
  policy: SingleTargetTriggerPolicy,
  config: WeaponConfig,
  dynamicSpread: number,
  lastUsedAt: number,
  now: number,
  targetDistance: number,
  targetRadius: number,
): number {
  switch (policy) {
    case 'spread_coverage_and_recovery':
      return calculateTriggerDisciplineReadyTime(
        config,
        dynamicSpread,
        lastUsedAt,
        now,
        targetDistance,
        targetRadius,
      );
    default: {
      const exhaustivePolicy: never = policy;
      throw new Error(`[WeaponBalanceLab] Unbekannte Trigger-Policy "${exhaustivePolicy}"`);
    }
  }
}
