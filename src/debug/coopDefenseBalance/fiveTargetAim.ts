import type { WeaponConfig } from '../../loadout/LoadoutConfig';
import { resolveEffectivePelletCount } from '../../loadout/ShotPlanResolver';
import { calcPelletAngles } from '../../loadout/SpreadMath';
import {
  checkHitscanRayCircleHit,
  checkMeleeArcHit,
} from '../../combat/rules/DirectCombatHitResolver';
import { resolveProjectileTargetImpact } from '../../combat/rules/ProjectileImpactResolver';
import type { HeadlessTarget } from './HeadlessStaticTargetWorld';
import {
  calculateMaxAllowedSpreadDeg,
  calculateTriggerDisciplineReadyTime,
  isSpreadWithinTriggerDiscipline,
} from './triggerDiscipline';
import type {
  FiveTargetAimPolicy,
  FiveTargetScenarioConfig,
  FiveTargetTriggerPolicy,
} from './scenarioTypes';

export interface FiveTargetTriggerAim {
  readonly aimAngle: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly triggerTargetDistance: number;
  readonly triggerTargetRadius: number;
}

export interface FiveTargetAimSolution extends FiveTargetTriggerAim {
  readonly reachableTargetIds: readonly string[];
  /** Nur Diagnose/Trigger-Kontext; enthaelt keine zufaelligen zukuenftigen Rolls. */
  readonly intentionalCoverageCount: number;
  readonly maxAllowedAccuracySpreadDeg: number;
}

const SHOOTER_X = 0;
const SHOOTER_Y = 0;

function targetAngle(target: HeadlessTarget): number {
  return Math.atan2(target.y - SHOOTER_Y, target.x - SHOOTER_X);
}

function targetDistance(target: HeadlessTarget): number {
  return Math.hypot(target.x - SHOOTER_X, target.y - SHOOTER_Y);
}

function compareNumbers(a: number, b: number): number {
  if (Math.abs(a - b) <= 1e-9) return 0;
  return a < b ? -1 : 1;
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Geometrie ist der eigentliche Tie-Breaker; die ID ist nur der letzte stabile Fallback. */
function compareTargetGeometry(a: HeadlessTarget, b: HeadlessTarget): number {
  return compareNumbers(targetDistance(a), targetDistance(b))
    || compareNumbers(targetAngle(a), targetAngle(b))
    || compareNumbers(a.x, b.x)
    || compareNumbers(a.y, b.y)
    || compareNumbers(a.radius, b.radius)
    || compareIds(a.id, b.id);
}

function sortTargets(targets: readonly HeadlessTarget[]): HeadlessTarget[] {
  return [...targets].sort(compareTargetGeometry);
}

/** Fuer Einzel-Aims gewinnt die geometrisch toleranteste Loesung, danach die Geometrie. */
function compareSingleAimTargets(config: WeaponConfig, a: HeadlessTarget, b: HeadlessTarget): number {
  return compareNumbers(
    calculateMaxAllowedSpreadDeg(config, targetDistance(b), b.radius),
    calculateMaxAllowedSpreadDeg(config, targetDistance(a), a.radius),
  ) || compareTargetGeometry(a, b);
}

function isReachable(config: WeaponConfig, target: HeadlessTarget): boolean {
  return targetDistance(target) <= config.range + target.radius + 1e-9;
}

function resolveClusterTarget(targets: readonly HeadlessTarget[]): { x: number; y: number } {
  if (targets.length === 0) return { x: 150, y: 0 };
  return {
    x: targets.reduce((sum, target) => sum + target.x, 0) / targets.length,
    y: targets.reduce((sum, target) => sum + target.y, 0) / targets.length,
  };
}

function resolveProjectileCoverage(
  config: WeaponConfig,
  aimAngle: number,
  targets: readonly HeadlessTarget[],
  pelletOffsets: readonly number[],
): { count: number; coveredTargets: readonly HeadlessTarget[] } {
  const range = Math.max(0, config.range);
  const projectileRadius = (config.fire.type === 'projectile' ? config.fire.projectileSize : 0) * 0.5;
  const covered = new Map<string, HeadlessTarget>();
  for (const offset of pelletOffsets) {
    const angle = aimAngle + offset;
    const endX = Math.cos(angle) * range;
    const endY = Math.sin(angle) * range;
    let best: { target: HeadlessTarget; distance: number } | undefined;
    for (const target of targets) {
      const hit = config.fire.type === 'hitscan'
        ? checkHitscanRayCircleHit(
          SHOOTER_X,
          SHOOTER_Y,
          angle,
          range,
          config.fire.traceThickness,
          target.x,
          target.y,
          target.radius,
        )
        : resolveProjectileTargetImpact({
          startX: SHOOTER_X,
          startY: SHOOTER_Y,
          endX,
          endY,
          targetX: target.x,
          targetY: target.y,
          radius: target.radius + projectileRadius,
        });
      if (!hit) continue;
      if (
        !best
        || hit.distance < best.distance - 1e-9
        || (Math.abs(hit.distance - best.distance) <= 1e-9
          && compareTargetGeometry(target, best.target) < 0)
      ) {
        best = { target, distance: hit.distance };
      }
    }
    if (best) covered.set(best.target.id, best.target);
  }
  return {
    count: covered.size,
    coveredTargets: sortTargets([...covered.values()]),
  };
}

function resolveTriggerTarget(
  config: WeaponConfig,
  targets: readonly HeadlessTarget[],
): HeadlessTarget | undefined {
  return [...targets].sort((a, b) => {
    // Die kleinste zulässige Gesamtstreuung ist die konservative Grenze für eine
    // Multi-Target-Lösung. Bei gleicher Grenze bleibt die Geometrie deterministisch.
    const accuracy = compareNumbers(
      calculateMaxAllowedSpreadDeg(config, targetDistance(a), a.radius),
      calculateMaxAllowedSpreadDeg(config, targetDistance(b), b.radius),
    );
    return accuracy || compareTargetGeometry(a, b);
  })[0];
}

function resolveMeleeCoverage(
  config: WeaponConfig,
  targets: readonly HeadlessTarget[],
): { angle: number; count: number; targetX: number; targetY: number } {
  const reachable = targets.filter((target) => isReachable(config, target));
  const cluster = resolveClusterTarget(reachable);
  const orderedReachable = sortTargets(reachable);
  const candidates = [
    ...orderedReachable.map((target) => targetAngle(target)),
    Math.atan2(cluster.y, cluster.x),
  ];
  let best: { angle: number; count: number; triggerTarget?: HeadlessTarget } | undefined;
  for (const angle of candidates) {
    const covered = orderedReachable.filter((target) => checkMeleeArcHit(
      SHOOTER_X,
      SHOOTER_Y,
      angle,
      config.range,
      config.fire.type === 'melee' ? config.fire.hitArcDegrees : 0,
      target.x,
      target.y,
      target.radius,
    ));
    const triggerTarget = resolveTriggerTarget(config, covered) ?? orderedReachable[0];
    const candidate = {
      angle,
      count: covered.length,
      triggerTarget,
    };
    if (
      !best
      || candidate.count > best.count
      || (candidate.count === best.count && candidate.angle < best.angle)
    ) {
      best = candidate;
    }
  }
  const triggerTarget = best?.triggerTarget;
  return {
    angle: best?.angle ?? Math.atan2(cluster.y, cluster.x),
    count: best?.count ?? 0,
    targetX: triggerTarget?.x ?? cluster.x,
    targetY: triggerTarget?.y ?? cluster.y,
  };
}

/** Deterministischer, RNG-blinder Aim-Resolver fuer fuenf statische Ziele. */
export function resolveFiveTargetAim(
  policy: FiveTargetAimPolicy,
  config: WeaponConfig,
  targets: readonly HeadlessTarget[],
): FiveTargetAimSolution {
  switch (policy) {
    case 'coverage_aware_v1': {
      const reachable = targets.filter((target) => isReachable(config, target));
      const orderedReachable = sortTargets(reachable);
      const pelletCount = resolveEffectivePelletCount(config);
      let aimAngle: number;
      let targetX: number;
      let targetY: number;
      let intentionalCoverageCount: number;
      let triggerTarget: HeadlessTarget | undefined;

      if (config.fire.type === 'melee') {
        const melee = resolveMeleeCoverage(config, targets);
        aimAngle = melee.angle;
        targetX = melee.targetX;
        targetY = melee.targetY;
        intentionalCoverageCount = melee.count;
        triggerTarget = resolveTriggerTarget(config, reachable.filter((target) => checkMeleeArcHit(
          SHOOTER_X,
          SHOOTER_Y,
          aimAngle,
          config.range,
          config.fire.type === 'melee' ? config.fire.hitArcDegrees : 0,
          target.x,
          target.y,
          target.radius,
        )));
      } else if (pelletCount > 1) {
        const pelletOffsets = calcPelletAngles(pelletCount, config.pelletSpreadAngle ?? 0);
        const candidates = [
          ...orderedReachable.flatMap((target) => pelletOffsets.map((offset) => targetAngle(target) - offset)),
          Math.atan2(resolveClusterTarget(reachable).y, resolveClusterTarget(reachable).x),
        ];
        let best: {
          angle: number;
          count: number;
          coveredTargets: readonly HeadlessTarget[];
          limitingAccuracy: number;
          totalAccuracy: number;
        } | undefined;
        for (const candidateAngle of candidates) {
          const coverage = resolveProjectileCoverage(config, candidateAngle, reachable, pelletOffsets);
          const accuracies = coverage.coveredTargets.map((target) => calculateMaxAllowedSpreadDeg(
            config,
            targetDistance(target),
            target.radius,
          ));
          const limitingAccuracy = accuracies.length > 0 ? Math.min(...accuracies) : -Infinity;
          const totalAccuracy = accuracies.reduce((sum, accuracy) => sum + accuracy, 0);
          if (
            !best
            || coverage.count > best.count
            || (coverage.count === best.count && limitingAccuracy > best.limitingAccuracy + 1e-9)
            || (coverage.count === best.count
              && Math.abs(limitingAccuracy - best.limitingAccuracy) <= 1e-9
              && totalAccuracy > best.totalAccuracy + 1e-9)
            || (coverage.count === best.count
              && Math.abs(limitingAccuracy - best.limitingAccuracy) <= 1e-9
              && Math.abs(totalAccuracy - best.totalAccuracy) <= 1e-9
              && candidateAngle < best.angle)
          ) {
            best = { angle: candidateAngle, ...coverage, limitingAccuracy, totalAccuracy };
          }
        }
        const fallback = resolveClusterTarget(reachable);
        aimAngle = best?.angle ?? Math.atan2(fallback.y, fallback.x);
        triggerTarget = resolveTriggerTarget(config, best?.coveredTargets ?? orderedReachable);
        targetX = triggerTarget?.x ?? fallback.x;
        targetY = triggerTarget?.y ?? fallback.y;
        intentionalCoverageCount = best?.count ?? 0;
      } else {
        const targetCandidates = [...(reachable.length > 0 ? reachable : targets)]
          .sort((a, b) => compareSingleAimTargets(config, a, b));
        const target = targetCandidates[0];
        const fallback = resolveClusterTarget(reachable);
        targetX = target?.x ?? fallback.x;
        targetY = target?.y ?? fallback.y;
        aimAngle = Math.atan2(targetY, targetX);
        intentionalCoverageCount = target ? 1 : 0;
        triggerTarget = target;
      }

      const fallbackTriggerTarget = triggerTarget ?? orderedReachable[0] ?? sortTargets(targets)[0];
      const triggerDistance = fallbackTriggerTarget ? targetDistance(fallbackTriggerTarget) : Math.max(1, config.range);
      const triggerRadius = fallbackTriggerTarget?.radius ?? 1;
      return {
        aimAngle,
        targetX,
        targetY,
        triggerTargetDistance: triggerDistance,
        triggerTargetRadius: triggerRadius,
        reachableTargetIds: orderedReachable.map((target) => target.id).sort(),
        intentionalCoverageCount,
        maxAllowedAccuracySpreadDeg: calculateMaxAllowedSpreadDeg(config, triggerDistance, triggerRadius),
      };
    }
    default: {
      const exhaustivePolicy: never = policy;
      throw new Error(`[WeaponBalanceLab] Unbekannte Five-Target-Aim-Policy "${exhaustivePolicy}"`);
    }
  }
}

export function isFiveTargetTriggerReady(
  policy: FiveTargetTriggerPolicy,
  config: WeaponConfig,
  dynamicSpread: number,
  aim: FiveTargetTriggerAim,
): boolean {
  switch (policy) {
    case 'spread_coverage_and_recovery_v1':
      return isSpreadWithinTriggerDiscipline(
        config,
        dynamicSpread,
        aim.triggerTargetDistance,
        aim.triggerTargetRadius,
      );
    default: {
      const exhaustivePolicy: never = policy;
      throw new Error(`[WeaponBalanceLab] Unbekannte Five-Target-Trigger-Policy "${exhaustivePolicy}"`);
    }
  }
}

export function calculateFiveTargetTriggerReadyTime(
  policy: FiveTargetTriggerPolicy,
  config: WeaponConfig,
  dynamicSpread: number,
  lastUsedAt: number,
  now: number,
  aim: FiveTargetTriggerAim,
): number {
  switch (policy) {
    case 'spread_coverage_and_recovery_v1':
      return calculateTriggerDisciplineReadyTime(
        config,
        dynamicSpread,
        lastUsedAt,
        now,
        aim.triggerTargetDistance,
        aim.triggerTargetRadius,
      );
    default: {
      const exhaustivePolicy: never = policy;
      throw new Error(`[WeaponBalanceLab] Unbekannte Five-Target-Trigger-Policy "${exhaustivePolicy}"`);
    }
  }
}
