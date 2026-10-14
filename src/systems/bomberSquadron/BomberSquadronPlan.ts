import type { BomberSquadronUltimateConfig } from '../../loadout/LoadoutTypes';
import type {
  BomberSquadronAnchor, BomberSquadronDeploymentSnapshot, BomberSquadronPlanParams,
} from './BomberSquadronSnapshot';

type Squadron = Pick<BomberSquadronDeploymentSnapshot, 'id' | 'startedAt' | 'angle' | 'params'>;

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
  /** Filled by bomberDronePose; optional only for existing renderer scratch objects. */
  bank?: number;
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
    entrySpreadPx: config.entrySpreadPx,
    entryAngleSpreadDeg: config.entryAngleSpreadDeg,
    swayPx: config.swayPx,
    departureSpeedPxPerSec: config.departureSpeedPxPerSec,
    departureTurnDeg: config.departureTurnDeg,
    aimOffsetPx: config.aimOffsetPx,
    aimAngleDeg: config.aimAngleDeg,
    aimOffsetSteps: config.aimOffsetSteps,
    aimAngleSteps: config.aimAngleSteps,
    aimOverlapPenalty: config.aimOverlapPenalty,
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
  const offset = bomberLaneOffsetPx(p, laneAt(p.droneCount, droneIndex)) + anchor.aimOffset;
  const start = { x: anchor.x + dir.x * p.corridorLeadPx + normal.x * offset,
    y: anchor.y + dir.y * p.corridorLeadPx + normal.y * offset };
  dir.x = Math.cos(squadron.angle + anchor.aimAngle);
  dir.y = Math.sin(squadron.angle + anchor.aimAngle);
  normal.x = -dir.y; normal.y = dir.x;
  const end = { x: start.x + dir.x * p.corridorLengthPx, y: start.y + dir.y * p.corridorLengthPx };
  return { start, end, dir, normal };
}

function runDurationMs(params: BomberSquadronPlanParams): number {
  return params.corridorLengthPx / params.runSpeedPxPerSec * 1000;
}

/** Gemeinsame Flug-Invarianten für Content, Host und Wire-Grenze. */
export function isBomberFlightPlanValid(p: BomberSquadronPlanParams): boolean {
  const values = [p.approachMs, p.approachDistancePx, p.runSpeedPxPerSec, p.entrySpreadPx,
    p.entryAngleSpreadDeg, p.swayPx, p.departureMs, p.departureSpeedPxPerSec, p.departureTurnDeg,
    p.aimOffsetPx, p.aimAngleDeg, p.aimOffsetSteps, p.aimAngleSteps, p.aimOverlapPenalty];
  return values.every(v => Number.isFinite(v) && v >= 0)
    && p.approachMs > 0 && p.departureMs > 0 && p.runSpeedPxPerSec > 0
    && p.approachDistancePx >= 1.1 * p.runSpeedPxPerSec * p.approachMs / 1000
    && p.departureSpeedPxPerSec >= p.runSpeedPxPerSec
    && p.entryAngleSpreadDeg < 90 && p.aimAngleDeg < 90 && p.departureTurnDeg <= 180
    && [p.aimOffsetSteps, p.aimAngleSteps].every(v => Number.isInteger(v) && v >= 1 && v <= 64);
}

export function bomberDroneFlightEndAt(squadron: Squadron, drone: number): number {
  const p = squadron.params;
  return bomberLaunchAt(squadron, drone) + p.approachMs + p.passCount * runDurationMs(p)
    + (p.passCount - 1) * p.turnMs + p.departureMs;
}

const RAD = Math.PI / 180;
const ARC_SAMPLES = 48;
const ARC_STEPS = ARC_SAMPLES - 1;
const smoothstep = (x: number): number => x * x * (3 - 2 * x);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
type Point = { x: number; y: number };
interface FlightCurve {
  id: number; angle: number; aimAngle: number;
  x0: number; y0: number; mx: number; my: number; length: number;
  phase: number; turn: number; arc: Float64Array; speed: Float64Array; pathLength: number;
}
// Params leben mit dem eingefrorenen Plan; kein global wachsender Staffel-/Anker-Cache.
const flightCurves = new WeakMap<BomberSquadronPlanParams, Map<number, FlightCurve>>();
const workA: Point = { x: 0, y: 0 }, workB: Point = { x: 0, y: 0 };

function seededRandom(id: number, drone: number): () => number {
  let seed = 2166136261;
  for (const value of [id, drone]) for (let shift = 0; shift < 32; shift += 8) {
    seed = Math.imul(seed ^ ((value >>> shift) & 255), 16777619);
  }
  return () => {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hermite(c: FlightCurve, s: number, out: Point, tangent = false): void {
  const h0 = tangent ? 6 * s * s - 6 * s : 2 * s ** 3 - 3 * s * s + 1;
  const h1 = tangent ? 3 * s * s - 4 * s + 1 : s ** 3 - 2 * s * s + s;
  const h2 = tangent ? 3 * s * s - 2 * s : s ** 3 - s * s;
  out.x = h0 * c.x0 + h1 * c.mx + h2 * c.length;
  out.y = h0 * c.y0 + h1 * c.my;
}

function flightCurve(squadron: Squadron, drone: number, anchor: BomberSquadronAnchor): FlightCurve {
  const p = squadron.params;
  let curves = flightCurves.get(p);
  if (!curves) { curves = new Map(); flightCurves.set(p, curves); }
  const cached = curves.get(drone);
  if (cached && cached.id === squadron.id && cached.angle === squadron.angle && cached.aimAngle === anchor.aimAngle) return cached;
  const random = seededRandom(squadron.id, drone);
  const phi = (random() * 2 - 1) * p.entryAngleSpreadDeg * RAD;
  const lateral = (random() * 2 - 1) * p.entrySpreadPx;
  const phase = random() * Math.PI * 2, sign = random() < 0.5 ? -1 : 1;
  const turn = sign * (0.5 + random() * 0.5) * p.departureTurnDeg * RAD;
  const x0 = -Math.cos(phi) * p.approachDistancePx, y0 = -Math.sin(phi) * p.approachDistancePx + lateral;
  const length = Math.hypot(x0, y0);
  const c: FlightCurve = { id: squadron.id, angle: squadron.angle, aimAngle: anchor.aimAngle,
    x0, y0, mx: Math.cos(phi) * length, my: Math.sin(phi) * length, length, phase, turn,
    arc: new Float64Array(ARC_SAMPLES), speed: new Float64Array(ARC_SAMPLES), pathLength: 0 };
  let lastX = x0, lastY = y0;
  for (let i = 0; i <= ARC_STEPS; i++) {
    hermite(c, i / ARC_STEPS, workA);
    if (i) c.arc[i] = c.arc[i - 1] + Math.hypot(workA.x - lastX, workA.y - lastY);
    lastX = workA.x; lastY = workA.y;
    hermite(c, i / ARC_STEPS, workA, true);
    c.speed[i] = Math.hypot(workA.x, workA.y);
  }
  c.pathLength = c.arc[ARC_STEPS];
  curves.set(drone, c);
  return c;
}

/** C1-Interpolation der inversen Bogenlängentabelle: keine Knicke an Sample-Grenzen. */
function arcParameter(c: FlightCurve, distance: number): number {
  if (distance <= 0) return 0;
  if (distance >= c.pathLength) return 1;
  let lo = 0, hi = ARC_STEPS;
  while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (c.arc[mid] < distance) lo = mid; else hi = mid; }
  const span = c.arc[hi] - c.arc[lo], f = (distance - c.arc[lo]) / span;
  return lo / ARC_STEPS + smoothstep(f) / ARC_STEPS
    + (f ** 3 - 2 * f * f + f) * span / c.speed[lo]
    + (f ** 3 - f * f) * span / c.speed[hi];
}

/** Unverschlungener Hermite-Start P0, für den Einblend-Fallback des Renderers. */
export function bomberDroneEntryPoint(squadron: Squadron, drone: number, anchor: BomberSquadronAnchor): Point {
  const c = flightCurve(squadron, drone, anchor), corridor = bomberCorridor(squadron, drone, anchor);
  return { x: corridor.start.x + corridor.dir.x * c.x0 + corridor.normal.x * c.y0,
    y: corridor.start.y + corridor.dir.y * c.x0 + corridor.normal.y * c.y0 };
}

// Position relativ zu S in u'/n'. Außerhalb der Lifetime nur für einseitige Tangenten abgetastet.
function flightPosition(p: BomberSquadronPlanParams, c: FlightCurve, side: number, elapsed: number, out: Point): BomberDronePose['phase'] {
  const runMs = runDurationMs(p), runElapsed = elapsed - p.approachMs;
  const flightMs = p.approachMs + p.passCount * runMs + (p.passCount - 1) * p.turnMs;
  if (elapsed < p.approachMs) {
    const f = clamp01(elapsed / p.approachMs), seconds = p.approachMs / 1000;
    const extraSpeed = 3 * (c.pathLength - p.runSpeedPxPerSec * seconds) / seconds;
    const distance = p.runSpeedPxPerSec * f * seconds + extraSpeed * seconds / 3 * (1 - (1 - f) ** 3);
    const s = arcParameter(c, distance);
    hermite(c, s, out); hermite(c, s, workB, true);
    const sway = p.swayPx * Math.sin(3 * Math.PI * f + c.phase) * (1 - f) ** 2;
    const speed = Math.hypot(workB.x, workB.y);
    out.x -= workB.y / speed * sway; out.y += workB.x / speed * sway;
    return 'approach';
  }
  out.y = 0;
  if (runElapsed < runMs) { out.x = p.runSpeedPxPerSec * runElapsed / 1000; return 'run'; }
  if (p.passCount === 2 && runElapsed < runMs + p.turnMs) {
    const a = Math.PI * (runElapsed - runMs) / p.turnMs, sin = Math.sin(a), cos = Math.cos(a);
    const radius = p.runSpeedPxPerSec * p.turnMs / 1000 / Math.PI;
    out.x = p.corridorLengthPx + radius * sin;
    out.y = side * radius * sin * sin * (1 + cos / 2);
    return 'turn';
  }
  if (p.passCount === 2 && elapsed < flightMs) {
    out.x = p.corridorLengthPx - p.runSpeedPxPerSec * (runElapsed - runMs - p.turnMs) / 1000;
    return 'return';
  }
  const f = clamp01((elapsed - flightMs) / p.departureMs), sign = p.passCount === 2 ? -1 : 1;
  out.x = sign === 1 ? p.corridorLengthPx : 0;
  // Feste 32 Mittelpunkt-Schritte: gleiche Position unabhängig von Framerate und Aufrufhistorie.
  const dt = f * p.departureMs / 1000 / 32;
  for (let i = 0; i < 32; i++) {
    const ease = smoothstep(f * (i + 0.5) / 32), angle = c.turn * ease;
    const distance = (p.runSpeedPxPerSec + (p.departureSpeedPxPerSec - p.runSpeedPxPerSec) * ease) * dt * sign;
    out.x += Math.cos(angle) * distance; out.y += Math.sin(angle) * distance;
  }
  const angle = c.turn * smoothstep(f), sway = p.swayPx * Math.sin(3 * Math.PI * f + c.phase) * f * f * sign;
  out.x -= Math.sin(angle) * sway; out.y += Math.cos(angle) * sway;
  return 'departure';
}

function flightHeading(p: BomberSquadronPlanParams, c: FlightCurve, side: number, elapsed: number): number {
  elapsed = Math.max(0, elapsed);
  flightPosition(p, c, side, elapsed - 8, workA);
  const x = workA.x, y = workA.y;
  flightPosition(p, c, side, elapsed + 8, workA);
  return Math.atan2(workA.y - y, workA.x - x);
}

/** Nach Cache-Aufbau mit `out` allokationsfrei; Clients benötigen nur replizierte Fakten. */
export function bomberDronePose(
  squadron: Squadron, droneIndex: number, anchor: BomberSquadronAnchor, t: number, out?: BomberDronePose,
): (BomberDronePose & { bank: number }) | null {
  const p = squadron.params, elapsed = t - bomberLaunchAt(squadron, droneIndex);
  const endAt = bomberDroneFlightEndAt(squadron, droneIndex);
  if (elapsed < 0 || t >= endAt) return null;
  const c = flightCurve(squadron, droneIndex, anchor);
  const lane = bomberLaneOffsetPx(p, laneAt(p.droneCount, droneIndex)), side = lane > 0 ? 1 : -1;
  const pose = out ?? { x: 0, y: 0, heading: 0, alpha: 1, bank: 0, phase: 'approach' };
  pose.phase = flightPosition(p, c, side, elapsed, pose);
  const angle = squadron.angle + anchor.aimAngle, dx = Math.cos(angle), dy = Math.sin(angle);
  const ux = Math.cos(squadron.angle), uy = Math.sin(squadron.angle), offset = lane + anchor.aimOffset;
  const x = pose.x, y = pose.y;
  pose.x = anchor.x + ux * p.corridorLeadPx - uy * offset + dx * x - dy * y;
  pose.y = anchor.y + uy * p.corridorLeadPx + ux * offset + dy * x + dx * y;
  pose.heading = angle + flightHeading(p, c, side, elapsed);
  const turn = flightHeading(p, c, side, elapsed + 8) - flightHeading(p, c, side, elapsed - 8);
  pose.bank = Math.max(-1, Math.min(1, Math.atan2(Math.sin(turn), Math.cos(turn)) / 0.016 / 2.5));
  pose.alpha = pose.phase === 'departure' ? clamp01((endAt - t) / 300) : 1;
  return pose as BomberDronePose & { bank: number };
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

export interface BomberAimTarget extends Point { readonly weight: number }

/** Host-Regel: genau eine Wahl beim Start, keine Zielverfolgung während des Flugs. */
export function chooseBomberAim(
  squadron: Squadron, drone: number, anchor: Point, targets: readonly BomberAimTarget[],
  launchedImpacts: readonly Point[], bounds: BomberSquadronWorldBounds,
): Pick<BomberSquadronAnchor, 'aimOffset' | 'aimAngle'> {
  const p = squadron.params, maxAngle = p.aimAngleDeg * RAD, radius = p.explosionRadius;
  const planned = { ...anchor, aimOffset: 0, aimAngle: 0 };
  if (radius <= 0 || targets.length === 0) return { aimOffset: 0, aimAngle: 0 };
  const corridor = bomberCorridor(squadron, drone, planned);
  // Konservative Hülle aller gedrehten Korridore inklusive Offset und Explosionsradius.
  const margin = p.aimOffsetPx + 2 * p.corridorLengthPx * Math.sin(maxAngle / 2) + radius;
  const left = Math.min(corridor.start.x, corridor.end.x) - margin, right = Math.max(corridor.start.x, corridor.end.x) + margin;
  const top = Math.min(corridor.start.y, corridor.end.y) - margin, bottom = Math.max(corridor.start.y, corridor.end.y) + margin;
  const relevant = targets.filter(t => t.weight > 0 && t.x >= left && t.x <= right && t.y >= top && t.y <= bottom);
  if (!relevant.length) return { aimOffset: 0, aimAngle: 0 };
  const ux = Math.cos(squadron.angle), uy = Math.sin(squadron.angle);
  let bestScore = -Infinity, bestTarget = 0, bestCost = Infinity, aimOffset = 0, aimAngle = 0;
  const candidate = (i: number, steps: number, limit: number, scale: number): number => {
    const raw = steps === 1 ? 0 : -limit + 2 * limit * i / (steps - 1);
    // Host und Client verwenden dieselben Wire-genauen Winkel/Offsets, auch am Fenster-Rand.
    const cap = Math.floor(limit * scale);
    return Math.max(-cap, Math.min(cap, Math.round(raw * scale))) / scale;
  };
  for (let oi = 0; oi < p.aimOffsetSteps; oi++) for (let ai = 0; ai < p.aimAngleSteps; ai++) {
    const offset = candidate(oi, p.aimOffsetSteps, p.aimOffsetPx, 10);
    const angle = candidate(ai, p.aimAngleSteps, maxAngle, 1000);
    const dx = Math.cos(squadron.angle + angle), dy = Math.sin(squadron.angle + angle);
    let targetScore = 0, overlap = 0;
    for (let bomb = 0; bomb < p.bombsPerPass; bomb++) {
      const distance = p.corridorLengthPx * (bomb + 0.5) / p.bombsPerPass;
      const x = corridor.start.x - uy * offset + dx * distance;
      const y = corridor.start.y + ux * offset + dy * distance;
      if (!isBomberImpactInWorld(x, y, bounds)) continue;
      for (const target of relevant) targetScore += target.weight * Math.max(0, 1 - Math.hypot(x - target.x, y - target.y) / radius);
      for (const impact of launchedImpacts) overlap += Math.max(0, 1 - Math.hypot(x - impact.x, y - impact.y) / (2 * radius));
    }
    const score = targetScore - p.aimOverlapPenalty * overlap;
    const cost = (p.aimOffsetPx ? Math.abs(offset) / p.aimOffsetPx : 0) + (maxAngle ? Math.abs(angle) / maxAngle : 0);
    if (score > bestScore || score === bestScore && cost < bestCost) {
      bestScore = score; bestTarget = targetScore; bestCost = cost; aimOffset = offset; aimAngle = angle;
    }
  }
  return bestTarget > 0 ? { aimOffset, aimAngle } : { aimOffset: 0, aimAngle: 0 };
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

/** World-Grenzen aus den World-Metriken; Host-Schaden und Darstellung verwenden dieselbe Abbildung. */
export function bomberWorldBoundsFromMetrics(metrics: {
  readonly widthPx: number; readonly heightPx: number; readonly offsetX: number; readonly offsetY: number;
}): BomberSquadronWorldBounds {
  return { width: metrics.widthPx, height: metrics.heightPx, offsetX: metrics.offsetX, offsetY: metrics.offsetY };
}
