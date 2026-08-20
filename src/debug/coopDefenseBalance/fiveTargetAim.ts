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
): { count: number; targetX: number; targetY: number } {
  const range = Math.max(0, config.range);
  const projectileRadius = (config.fire.type === 'projectile' ? config.fire.projectileSize : 0) * 0.5;
  const covered = new Set<string>();
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
          && target.id.localeCompare(best.target.id) < 0)
      ) {
        best = { target, distance: hit.distance };
      }
    }
    if (best) covered.add(best.target.id);
  }

  const firstTarget = targets.find((target) => covered.has(target.id)) ?? targets[0];
  const cluster = resolveClusterTarget(targets);
  return {
    count: covered.size,
    targetX: firstTarget?.x ?? cluster.x,
    targetY: firstTarget?.y ?? cluster.y,
  };
}

function resolveMeleeCoverage(
  config: WeaponConfig,
  targets: readonly HeadlessTarget[],
): { angle: number; count: number; targetX: number; targetY: number } {
  const reachable = targets.filter((target) => isReachable(config, target));
  const cluster = resolveClusterTarget(reachable);
  const candidates = [
    ...reachable.map((target) => targetAngle(target)),
    Math.atan2(cluster.y, cluster.x),
  ];
  let best: { angle: number; count: number; firstId: string; targetX: number; targetY: number } | undefined;
  for (const angle of candidates) {
    const covered = reachable.filter((target) => checkMeleeArcHit(
      SHOOTER_X,
      SHOOTER_Y,
      angle,
      config.range,
      config.fire.type === 'melee' ? config.fire.hitArcDegrees : 0,
      target.x,
      target.y,
      target.radius,
    ));
    const first = covered[0] ?? reachable[0];
    const candidate = {
      angle,
      count: covered.length,
      firstId: first?.id ?? 'target_9',
      targetX: first?.x ?? cluster.x,
      targetY: first?.y ?? cluster.y,
    };
    if (
      !best
      || candidate.count > best.count
      || (candidate.count === best.count && candidate.firstId.localeCompare(best.firstId) < 0)
      || (candidate.count === best.count && candidate.firstId === best.firstId && candidate.angle < best.angle)
    ) {
      best = candidate;
    }
  }
  return best ?? { angle: Math.atan2(cluster.y, cluster.x), count: 0, targetX: cluster.x, targetY: cluster.y };
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
      const pelletCount = resolveEffectivePelletCount(config);
      let aimAngle: number;
      let targetX: number;
      let targetY: number;
      let intentionalCoverageCount: number;

      if (config.fire.type === 'melee') {
        const melee = resolveMeleeCoverage(config, targets);
        aimAngle = melee.angle;
        targetX = melee.targetX;
        targetY = melee.targetY;
        intentionalCoverageCount = melee.count;
      } else if (pelletCount > 1) {
        const pelletOffsets = calcPelletAngles(pelletCount, config.pelletSpreadAngle ?? 0);
        const candidates = [
          ...reachable.flatMap((target) => pelletOffsets.map((offset) => targetAngle(target) - offset)),
          Math.atan2(resolveClusterTarget(reachable).y, resolveClusterTarget(reachable).x),
        ];
        let best: { angle: number; count: number; targetX: number; targetY: number } | undefined;
        for (const candidateAngle of candidates) {
          const coverage = resolveProjectileCoverage(config, candidateAngle, reachable, pelletOffsets);
          if (
            !best
            || coverage.count > best.count
            || (coverage.count === best.count && candidateAngle < best.angle)
          ) {
            best = { angle: candidateAngle, ...coverage };
          }
        }
        const fallback = resolveClusterTarget(reachable);
        aimAngle = best?.angle ?? Math.atan2(fallback.y, fallback.x);
        targetX = best?.targetX ?? fallback.x;
        targetY = best?.targetY ?? fallback.y;
        intentionalCoverageCount = best?.count ?? 0;
      } else {
        const target = reachable[0] ?? targets[0];
        const fallback = resolveClusterTarget(reachable);
        targetX = target?.x ?? fallback.x;
        targetY = target?.y ?? fallback.y;
        aimAngle = Math.atan2(targetY, targetX);
        intentionalCoverageCount = target ? 1 : 0;
      }

      const triggerTarget = reachable[0] ?? targets[0];
      const triggerDistance = triggerTarget ? targetDistance(triggerTarget) : Math.max(1, config.range);
      const triggerRadius = triggerTarget?.radius ?? 1;
      return {
        aimAngle,
        targetX,
        targetY,
        triggerTargetDistance: triggerDistance,
        triggerTargetRadius: triggerRadius,
        reachableTargetIds: reachable.map((target) => target.id),
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
