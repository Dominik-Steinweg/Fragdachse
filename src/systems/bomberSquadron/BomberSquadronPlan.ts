import type { BomberSquadronUltimateConfig } from '../../loadout/LoadoutTypes';
import type {
  BomberSquadronAnchor, BomberSquadronDeploymentSnapshot, BomberSquadronPlanParams,
} from './BomberSquadronSnapshot';

type Squadron = Pick<BomberSquadronDeploymentSnapshot, 'startedAt' | 'angle' | 'params'>;

export interface BomberSquadronDrop {
  readonly drone: number;
  readonly pass: number;
  readonly bomb: number;
  readonly dropAt: number;
  readonly impactAt: number;
  readonly x: number;
  readonly y: number;
}

export interface BomberDronePose {
  x: number;
  y: number;
  heading: number;
  alpha: number;
  phase: 'approach' | 'run' | 'turn' | 'return' | 'departure';
}

/** World-lokale Ausdehnung; Adapter können WorldMetrics-Offsets mitgeben. Obere Grenzen exklusiv. */
export interface BomberSquadronWorldBounds {
  readonly width: number;
  readonly height: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export function bomberPlanParamsFromConfig(config: BomberSquadronUltimateConfig): BomberSquadronPlanParams {
  return {
    droneCount: config.droneCount, bombsPerPass: config.bombsPerPass,
    passCount: 1 + (config.secondPassEnabled > 0 ? 1 : 0),
    launchIntervalMs: config.launchIntervalMs, approachMs: config.approachMs,
    approachDistancePx: config.approachDistancePx, runSpeedPxPerSec: config.runSpeedPxPerSec,
    corridorLeadPx: config.corridorLeadPx, corridorLengthPx: config.corridorLengthPx,
    corridorWidthPx: config.corridorWidthPx, turnMs: config.turnMs,
    departureMs: config.departureMs, bombFallMs: config.bombFallMs,
    explosionRadius: config.explosionRadius,
  };
}

function laneAt(droneCount: number, droneIndex: number): number {
  const middle = Math.floor((droneCount - 1) / 2);
  if (droneCount % 2 === 0) return middle + (droneIndex % 2 ? (droneIndex + 1) / 2 : -droneIndex / 2);
  return middle + (droneIndex % 2 ? -(droneIndex + 1) / 2 : droneIndex / 2);
}

export function bomberLaneOrder(droneCount: number): readonly number[] {
  return Array.from({ length: droneCount }, (_, i) => laneAt(droneCount, i));
}

export function bomberLaneOffsetPx(params: BomberSquadronPlanParams, lane: number): number {
  return -params.corridorWidthPx / 2 + params.corridorWidthPx * (lane + 0.5) / params.droneCount;
}

export function bomberLaunchAt(squadron: Squadron, droneIndex: number): number {
  return squadron.startedAt + droneIndex * squadron.params.launchIntervalMs;
}

export function bomberCorridor(squadron: Squadron, droneIndex: number, anchor: BomberSquadronAnchor) {
  const dir = { x: Math.cos(squadron.angle), y: Math.sin(squadron.angle) };
  const normal = { x: -dir.y, y: dir.x };
  const p = squadron.params;
  const offset = bomberLaneOffsetPx(p, laneAt(p.droneCount, droneIndex));
  const start = { x: anchor.x + dir.x * p.corridorLeadPx + normal.x * offset,
    y: anchor.y + dir.y * p.corridorLeadPx + normal.y * offset };
  const end = { x: start.x + dir.x * p.corridorLengthPx, y: start.y + dir.y * p.corridorLengthPx };
  return { start, end, dir, normal };
}

function runDurationMs(params: BomberSquadronPlanParams): number {
  return params.corridorLengthPx / params.runSpeedPxPerSec * 1000;
}

export function bomberDrops(squadron: Squadron, droneIndex: number, anchor: BomberSquadronAnchor): readonly BomberSquadronDrop[] {
  const p = squadron.params;
  const { start, dir } = bomberCorridor(squadron, droneIndex, anchor);
  const runMs = runDurationMs(p);
  const corridorStartAt = bomberLaunchAt(squadron, droneIndex) + p.approachMs;
  const drops: BomberSquadronDrop[] = [];
  for (let pass = 0; pass < p.passCount; pass++) {
    for (let bomb = 0; bomb < p.bombsPerPass; bomb++) {
      const fraction = (bomb + 0.5) / p.bombsPerPass;
      const distance = p.corridorLengthPx * (pass === 0 ? fraction : 1 - fraction);
      const dropAt = corridorStartAt + pass * (runMs + p.turnMs) + runMs * fraction;
      drops.push({ drone: droneIndex, pass, bomb, dropAt, impactAt: dropAt + p.bombFallMs,
        x: start.x + dir.x * distance, y: start.y + dir.y * distance });
    }
  }
  return drops;
}

/** Mit `out` allokationsfrei; benötigt nur die replizierten Fakten, keine Besitzerabfrage. */
export function bomberDronePose(
  squadron: Squadron, droneIndex: number, anchor: BomberSquadronAnchor, t: number, out?: BomberDronePose,
): BomberDronePose | null {
  const p = squadron.params;
  const elapsed = t - bomberLaunchAt(squadron, droneIndex);
  const runMs = runDurationMs(p);
  const flightMs = p.approachMs + p.passCount * runMs + (p.passCount - 1) * p.turnMs;
  if (elapsed < 0 || elapsed >= flightMs + p.departureMs) return null;
  const dirX = Math.cos(squadron.angle), dirY = Math.sin(squadron.angle);
  const offset = bomberLaneOffsetPx(p, laneAt(p.droneCount, droneIndex));
  const side = offset > 0 ? 1 : -1;
  let along: number, lateral = offset, heading = squadron.angle, alpha = 1;
  let phase: BomberDronePose['phase'];
  const runElapsed = elapsed - p.approachMs;
  if (elapsed < p.approachMs) {
    phase = 'approach';
    alpha = elapsed / p.approachMs;
    along = -p.approachDistancePx * (1 - alpha);
  } else if (runElapsed < runMs) {
    phase = 'run';
    along = p.corridorLengthPx * runElapsed / runMs;
  } else if (p.passCount === 2 && runElapsed < runMs + p.turnMs) {
    phase = 'turn';
    const a = Math.PI * (runElapsed - runMs) / p.turnMs;
    const sin = Math.sin(a), cos = Math.cos(a);
    const radius = p.runSpeedPxPerSec * p.turnMs / 1000 / Math.PI;
    // Geschlossene Tropfenkurve hinter E: kein Stillstand, Tangenten und Tempo passen zu ±u.
    along = p.corridorLengthPx + radius * sin;
    lateral += side * radius * sin * sin * (1 + cos / 2);
    heading += Math.atan2(side * (2 * sin * cos * (1 + cos / 2) - sin * sin * sin / 2), cos);
  } else if (p.passCount === 2 && elapsed < flightMs) {
    phase = 'return';
    along = p.corridorLengthPx * (1 - (runElapsed - runMs - p.turnMs) / runMs);
    heading -= side * Math.PI;
  } else {
    phase = 'departure';
    const departureElapsed = elapsed - flightMs;
    const distance = p.runSpeedPxPerSec * departureElapsed / 1000;
    along = p.passCount === 2 ? -distance : p.corridorLengthPx + distance;
    if (p.passCount === 2) heading -= side * Math.PI;
    alpha = 1 - departureElapsed / p.departureMs;
  }
  const pose = out ?? { x: 0, y: 0, heading: 0, alpha: 0, phase };
  pose.x = anchor.x + dirX * (p.corridorLeadPx + along) - dirY * lateral;
  pose.y = anchor.y + dirY * (p.corridorLeadPx + along) + dirX * lateral;
  pose.heading = heading;
  pose.alpha = alpha;
  pose.phase = phase;
  return pose;
}

export function bomberSquadronEndsAt(
  squadron: Pick<BomberSquadronDeploymentSnapshot, 'startedAt' | 'params' | 'anchors' | 'stoppedAt'>,
): number {
  const p = squadron.params;
  for (let drone = p.droneCount - 1; drone >= 0; drone--) {
    const launchAt = squadron.startedAt + drone * p.launchIntervalMs;
    if (squadron.stoppedAt !== null && (launchAt >= squadron.stoppedAt || !squadron.anchors[drone])) continue;
    const runMs = runDurationMs(p);
    return launchAt + p.approachMs + (p.passCount - 1) * (runMs + p.turnMs)
      + runMs * ((p.bombsPerPass - 0.5) / p.bombsPerPass) + p.bombFallMs;
  }
  return squadron.stoppedAt ?? squadron.startedAt;
}

export function isBomberImpactInWorld(x: number, y: number, bounds: BomberSquadronWorldBounds): boolean {
  const left = bounds.offsetX ?? 0, top = bounds.offsetY ?? 0;
  return x >= left && x < left + bounds.width && y >= top && y < top + bounds.height;
}
