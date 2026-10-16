import type { CoopDefenseEnemyHopWeights } from '../config/coopDefenseEnemies';

interface Point { readonly x: number; readonly y: number }

/** Everything one landing decision reads; ports keep the rule pure and testable. */
export interface HopLandingQuery {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Where the route wants the body to go next. */
  readonly steering: Point;
  /** Route cost at the origin, or null when only a straight-line hint exists. */
  readonly originCost: number | null;
  /** Route cost at a point (ground pixels); null where the route is unknown or unreachable. */
  readonly costAt: (x: number, y: number) => number | null;
  readonly isFree: (x: number, y: number, radius: number) => boolean;
  /** Swept body path; a hop never crosses walls, bases, water or rocks. */
  readonly canMove: (fromX: number, fromY: number, toX: number, toY: number, radius: number) => boolean;
  /** Heal value of resting at a point, normalised to [0, 1]. */
  readonly healValue: (x: number, y: number) => number;
  /** Bodies the landing circle would overlap. */
  readonly crowdAt: (x: number, y: number) => number;
  /** Hop lengths tried in order (longest first); the last entry is the short fallback. */
  readonly distances: readonly number[];
  readonly fanSteps: number;
  readonly fanHalfAngleRad: number;
  /** Deterministic fan rotation in [-0.5, 0.5] of one step, so neighbours do not land in lockstep. */
  readonly jitter: number;
  readonly weights: CoopDefenseEnemyHopWeights;
  readonly minProgressShare: number;
  readonly maxRegressPx: number;
  /** Anti-loitering: heal value may not excuse a weak advance this time. */
  readonly forceProgress: boolean;
}

export interface HopLanding {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /** Route progress of this hop in ground pixels (negative = loses ground). */
  readonly progress: number;
  readonly heal: number;
}

interface Candidate extends HopLanding { readonly deviation: number; readonly index: number }

/**
 * Landing point of the next hop: a fan of points around the route direction, filtered hard by
 * free ground and a clear swept path, then scored by route progress, heal value, turning and
 * crowding. Without heal value (or when forced) a landing must make real progress; with heal
 * value it may lose only a small, bounded amount of ground, so the body still heads to its goal.
 */
export function selectHopLanding(query: HopLandingQuery): HopLanding | null {
  const { x, y, radius } = query;
  const base = Math.atan2(query.steering.y - y, query.steering.x - x);
  const steps = Math.max(1, query.fanSteps), step = steps > 1 ? 2 * query.fanHalfAngleRad / (steps - 1) : 0;
  const straight = Math.hypot(query.steering.x - x, query.steering.y - y);
  const valid: Candidate[] = [];
  let index = 0;
  for (const distance of query.distances) {
    for (let i = 0; i < steps; i++) {
      const offset = -query.fanHalfAngleRad + (i + query.jitter) * step;
      const angle = base + offset;
      const px = Math.round(x + Math.cos(angle) * distance), py = Math.round(y + Math.sin(angle) * distance);
      index++;
      if (!query.isFree(px, py, radius) || !query.canMove(x, y, px, py, radius)) continue;
      let progress: number;
      if (query.originCost !== null) {
        const cost = query.costAt(px, py);
        // A landing the route cannot continue from would strand the body.
        if (cost === null) continue;
        progress = query.originCost - cost;
      } else {
        progress = straight - Math.hypot(query.steering.x - px, query.steering.y - py);
      }
      valid.push({ x: px, y: py, angle, progress, heal: clamp01(query.healValue(px, py)),
        deviation: Math.abs(offset) / Math.max(1e-6, query.fanHalfAngleRad), index });
    }
  }
  if (!valid.length) return null;
  const bestProgress = valid.reduce((best, candidate) => Math.max(best, candidate.progress), -Infinity);
  const advanceFloor = bestProgress > 0 ? bestProgress * query.minProgressShare : bestProgress;
  const w = query.weights;
  let chosen: Candidate | null = null, chosenScore = -Infinity;
  for (const candidate of valid) {
    const healing = candidate.heal > 0 && !query.forceProgress;
    if (healing ? candidate.progress < -query.maxRegressPx : candidate.progress < advanceFloor) continue;
    const progressN = bestProgress > 0 ? candidate.progress / bestProgress : 0;
    const score = w.progress * progressN + w.heal * (query.forceProgress ? 0 : candidate.heal)
      - w.deviation * candidate.deviation - w.crowd * query.crowdAt(candidate.x, candidate.y);
    if (!chosen || score > chosenScore + 1e-9 || (Math.abs(score - chosenScore) <= 1e-9 && better(candidate, chosen))) {
      chosen = candidate; chosenScore = score;
    }
  }
  return chosen ? { x: chosen.x, y: chosen.y, angle: chosen.angle, progress: chosen.progress, heal: chosen.heal } : null;
}

function better(candidate: Candidate, current: Candidate): boolean {
  if (candidate.progress !== current.progress) return candidate.progress > current.progress;
  if (candidate.deviation !== current.deviation) return candidate.deviation < current.deviation;
  return candidate.index < current.index;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
