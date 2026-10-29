import type { LocomotionRequest, MovementFeedback } from './NavigationContracts';
import { NavigationGeometry, segmentObstacleDistanceSq, type NavigationObstacle } from './NavigationGeometry';

interface Neighbor { readonly id: string; readonly x: number; readonly y: number; readonly radius: number; readonly vx: number; readonly vy: number; readonly routeCost?: number }
const ANGLES = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2];
const RECOVERY_ANGLES = [...ANGLES, Math.PI * 0.75, -Math.PI * 0.75, Math.PI];
const SPEED_SCALES = [1, 0.45];
const STEERING_SWITCH_MARGIN = 0.04;
const CELL = 96;
/** Crowd level of detail: from this many bodies, each ordinary mover re-solves on alternate frames. */
const CROWD_SLICE_BODIES = 96;
/** Reuse stays inside the capsule the previous solve proved free (horizon >= 0.12 s) for two frames. */
const CROWD_SLICE_MAX_DT = 0.05;
/** Far detail keeps a geometry-verified course for at most this many following frames ... */
const FAR_REUSE_FRAMES = 3;
/** ... and only while the body stays inside the verified capsule (horizon >= 0.12 s) including the next step. */
const FAR_REUSE_WINDOW_MS = 100;
/** With a body close ahead, a far course is kept only for one frame, like a sliced crowd. */
const FAR_CROWDED_REUSE_FRAMES = 1;
/** A far unit stalled this long waits only for bodies ahead of it on the route (breaks mutual waits). */
const FAR_ORDERED_AFTER_STALL_S = 1;
/** ...and one stalled this long ignores the far crowd until it moves again, so no off-screen wait lasts. */
const FAR_CROWD_RELEASE_S = 2;
/** An arriving body this close to its attack position counts as there; it does not chase sub-pixel corrections. */
const ARRIVAL_DEAD_ZONE_PX = 3;
interface Conflict { dx: number; dy: number; vx: number; vy: number; separation: number;
  separationSq: number; existingOverlap: number; weight: number }
interface SteeringChoice { angle: number; scale: number; heading: number; vx: number; vy: number; frame: number;
  /** Chosen without crowd avoidance; never a commitment for a full-detail solve. */
  far: boolean; solvedAtMs: number; reuses: number;
  /** Far only: nobody ahead could be reached within the reuse window, so the course may be kept. */
  clearAhead: boolean }
interface MovementHistory { x: number; y: number; targetX: number; targetY: number; stalled: number;
  retryAt: number; geometry: NavigationGeometry; crowdNeighbors?: readonly Neighbor[]; steering?: SteeringChoice }

/** One consistent position/velocity snapshot for both hostile and allied ordinary movement. */
export class EnemyLocomotion {
  private readonly buckets = new Map<number, Map<number, Neighbor[]>>();
  private readonly rowPool: Map<number, Neighbor[]>[] = [];
  private readonly activeBuckets: Neighbor[][] = [];
  private readonly neighborsById = new Map<string, Neighbor>();
  private readonly pool: Neighbor[][] = [];
  private readonly previous = new Map<string, MovementHistory>();
  private frame = 0;
  private elapsedMs = 0;
  private neighborsExamined = 0;
  private waitingNeighborsObserved = 0;
  private farSolves = 0;
  private farSteeringReuses = 0;
  private maxRadius = 0;
  private maxNeighborSpeed = 0;
  private geometry: NavigationGeometry | null = null;
  private deltaSeconds = 0;
  private sliced = false;
  private readonly slicePhases = new Map<string, number>();
  private readonly nearby: Neighbor[] = [];
  /** Far detail: bodies around the unit, without sight lines or scoring. */
  private readonly farCrowd: Neighbor[] = [];
  private readonly conflicts: Conflict[] = [];
  private readonly movementObstacles: NavigationObstacle[] = [];
  private readonly neighborObstacles: NavigationObstacle[] = [];
  private readonly collectMovementObstacle = (obstacle: NavigationObstacle): boolean => {
    this.movementObstacles.push(obstacle); return false;
  };
  private readonly collectNeighborObstacle = (obstacle: NavigationObstacle): boolean => {
    this.neighborObstacles.push(obstacle); return false;
  };

  begin(neighbors: readonly Neighbor[], geometry: NavigationGeometry, deltaMs: number): void {
    this.frame++;
    for (const bucket of this.activeBuckets) { bucket.length = 0; this.pool.push(bucket); }
    this.activeBuckets.length = 0;
    for (const row of this.buckets.values()) { row.clear(); this.rowPool.push(row); }
    this.buckets.clear(); this.maxRadius = 0; this.maxNeighborSpeed = 0;
    this.geometry = geometry; this.deltaSeconds = Math.min(0.1, Math.max(0, deltaMs / 1000));
    this.elapsedMs += Math.max(0, deltaMs);
    this.neighborsById.clear();
    for (const neighbor of neighbors) {
      this.neighborsById.set(neighbor.id, neighbor); this.maxRadius = Math.max(this.maxRadius, neighbor.radius);
      this.maxNeighborSpeed = Math.max(this.maxNeighborSpeed, Math.hypot(neighbor.vx, neighbor.vy));
      const col = Math.floor(neighbor.x / CELL), row = Math.floor(neighbor.y / CELL);
      let columns = this.buckets.get(row);
      if (!columns) { columns = this.rowPool.pop() ?? new Map(); this.buckets.set(row, columns); }
      let bucket = columns.get(col);
      if (!bucket) {
        bucket = this.pool.pop() ?? []; columns.set(col, bucket); this.activeBuckets.push(bucket);
      }
      bucket.push(neighbor);
    }
    for (const id of this.previous.keys()) if (!this.neighborsById.has(id)) this.previous.delete(id);
    this.sliced = neighbors.length >= CROWD_SLICE_BODIES;
    if (this.slicePhases.size > neighbors.length * 2) {
      for (const id of this.slicePhases.keys()) if (!this.neighborsById.has(id)) this.slicePhases.delete(id);
    }
  }

  /** Stable 0/1 per unit, so a horde splits evenly across alternate frames. */
  private slicePhase(id: string): number {
    let phase = this.slicePhases.get(id);
    if (phase === undefined) {
      let hash = 0;
      for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
      this.slicePhases.set(id, phase = hash & 1);
    }
    return phase;
  }

  solve(request: LocomotionRequest): MovementFeedback {
    const { x, y, radius, speed, waypoint } = request, geometry = request.geometry ?? this.geometry;
    const result = (vx: number, vy: number, waitReason: MovementFeedback['waitReason'], progress = 0, neighborsVisited = 0): MovementFeedback =>
      ({ vx, vy, waitReason, progress, neighborsVisited });
    if (!geometry || request.priority !== 'ordinary' || !waypoint) this.previous.delete(request.id);
    if (!geometry || request.priority === 'exclusive') return result(0, 0, 'exclusive');
    if (request.priority === 'attack') return result(0, 0, 'attack');
    if (!waypoint) return result(0, 0, 'route-pending');
    const targetDx = waypoint.x - x, targetDy = waypoint.y - y;
    const distance = Math.hypot(targetDx, targetDy);
    const prior = this.previous.get(request.id);
    const progress = prior ? Math.hypot(x - prior.x, y - prior.y) : 0;
    const sameTarget = prior && Math.hypot(waypoint.x - prior.targetX, waypoint.y - prior.targetY) < 16;
    const stalled = sameTarget && progress < Math.max(0.1, speed * this.deltaSeconds * 0.08) ? prior.stalled + this.deltaSeconds : 0;
    const history: MovementHistory = { x, y, targetX: waypoint.x, targetY: waypoint.y, stalled,
      retryAt: prior?.retryAt ?? 0, geometry, crowdNeighbors: prior?.crowdNeighbors };
    this.previous.set(request.id, history);
    // A waypoint may be the precise attachment needed to turn around a rock corner.
    // Stopping a pixel short can leave the following body sweep permanently blocked.
    if (distance < (request.arrive ? ARRIVAL_DEAD_ZONE_PX : 1e-3)) return result(0, 0, 'arrival', progress);
    const dt = this.deltaSeconds;
    if (dt <= 0 || speed <= 0) return result(0, 0, 'arrival', progress);
    const far = request.detail === 'far';
    // Crowd LOD: between its solves a unit keeps last frame's committed steering, as long as
    // nothing invalidated it (same waypoint and geometry, no recovery stall, no foreign velocity
    // change). The stall bound matches the solver's own continuity rule; stall time keeps
    // accumulating above, so recovery headings still start on time. Two short frames stay
    // inside the swept capsule that choice was verified against.
    const kept = prior?.steering;
    const keepable = kept && kept.frame === this.frame - 1 && sameTarget && stalled <= 0.8 && prior.geometry === geometry
      && Math.abs(request.previousVx - kept.vx) < 1e-3 && Math.abs(request.previousVy - kept.vy) < 1e-3
      && distance > Math.hypot(kept.vx, kept.vy) * Math.max(dt, 0.12) * 2;
    if (!far && keepable && !kept.far && this.sliced && dt <= CROWD_SLICE_MAX_DT
      && ((this.frame + this.slicePhase(request.id)) & 1) === 1) {
      history.steering = { ...kept, frame: this.frame };
      return result(kept.vx, kept.vy, 'none', progress);
    }
    // Far detail: the same continuity rules, but a few frames in a row, as long as the motion
    // since that solve plus the next step stays inside the capsule it was verified against.
    if (far && keepable && kept.far && kept.reuses < (kept.clearAhead ? FAR_REUSE_FRAMES : FAR_CROWDED_REUSE_FRAMES)
      && this.elapsedMs - kept.solvedAtMs + dt * 1000 <= FAR_REUSE_WINDOW_MS) {
      this.farSteeringReuses++;
      history.steering = { ...kept, frame: this.frame, reuses: kept.reuses + 1 };
      return result(kept.vx, kept.vy, 'none', progress);
    }
    if (far) this.farSolves++;
    const horizon = Math.max(dt, 0.12);
    // An arriving body drops its momentum: smoothed, it would sail past its attack position and back.
    const blend = request.arrive ? 1 : 1 - Math.exp(-dt * 14);
    // Every smoothed candidate lies inside this envelope, including previous dash/impulse
    // velocities. Query buckets once, then retain the exact capsule test for each heading.
    const reach = (Math.hypot(request.previousVx, request.previousVy) * (1 - blend) + speed * blend) * horizon;
    this.movementObstacles.length = 0;
    geometry.visit(x - reach, y - reach, x + reach, y + reach, radius, this.collectMovementObstacle);
    if (!geometry.canMoveAgainst(x, y, x, y, radius, this.movementObstacles)) return this.recover(request, geometry, dt, progress);
    // Waiting is safe while a static crowd stays unchanged. Observe its members every frame,
    // so movement or removal wakes the unit before the bounded recovery retry expires.
    if (sameTarget && progress < .1 && prior?.geometry === geometry && this.elapsedMs < history.retryAt
      && history.crowdNeighbors?.every(neighbor => {
        this.waitingNeighborsObserved++;
        const current = this.neighborsById.get(neighbor.id);
        return current && Math.abs(current.x - neighbor.x) < 1 && Math.abs(current.y - neighbor.y) < 1
          && Math.abs(current.vx) < 1 && Math.abs(current.vy) < 1;
      })) {
      return result(0, 0, 'crowd', progress);
    }
    history.retryAt = 0;
    history.crowdNeighbors = undefined;

    const neighbors = this.nearby;
    neighbors.length = 0;
    // Far detail skips sight lines and crowd scoring. It only keeps the crowd's throughput:
    // a heading that closes in on a body ahead is not taken and a queue keeps a following
    // distance, so far hordes still meter through bottlenecks like full-detail ones.
    const crowd = this.farCrowd;
    crowd.length = 0;
    if (!far) this.gatherVisibleNeighbors(request, geometry, neighbors);
    else if (stalled <= FAR_CROWD_RELEASE_S) this.gatherFarCrowd(request, crowd, horizon, stalled > FAR_ORDERED_AFTER_STALL_S);
    const conflicts = this.conflicts;
    const radiusSq = radius ** 2;
    let lastOverlap = -1;
    for (let index = 0; index < neighbors.length; index++) {
      const neighbor = neighbors[index];
      const dx = x - neighbor.x, dy = y - neighbor.y, separation = radius + neighbor.radius + 2;
      const precedes = request.routeCost !== undefined && neighbor.routeCost !== undefined
        && (request.routeCost < neighbor.routeCost - 2 || (Math.abs(request.routeCost - neighbor.routeCost) <= 2 && request.id < neighbor.id));
      const conflict = conflicts[index] ?? (conflicts[index] = {} as Conflict);
      conflict.dx = dx; conflict.dy = dy; conflict.vx = neighbor.vx; conflict.vy = neighbor.vy;
      conflict.separation = separation; conflict.separationSq = separation * separation;
      conflict.existingOverlap = Math.max(0, separation - Math.sqrt(dx * dx + dy * dy));
      if (conflict.existingOverlap > 0) lastOverlap = index;
      const neighborRadiusSq = neighbor.radius ** 2;
      conflict.weight = neighborRadiusSq / (radiusSq + neighborRadiusSq) * (precedes ? .06 : 1) / 5;
    }
    const heading = Math.atan2(targetDy, targetDx);
    // Retain a decision only across uninterrupted ordinary movement. Re-score it against
    // today's geometry and crowd; momentum from an override is not a steering commitment.
    const priorChoice = prior?.steering;
    // A far course ignored the crowd, so it is no commitment once the unit steers in full again.
    const choice = priorChoice && (far || !priorChoice.far) && prior?.geometry === geometry && priorChoice.frame === this.frame - 1
      && stalled <= 0.8 && Math.cos(heading - priorChoice.heading) >= 0.5
      && Math.abs(request.previousVx - priorChoice.vx) < 1e-3
      && Math.abs(request.previousVy - priorChoice.vy) < 1e-3 ? priorChoice : undefined;
    const maxVelocity = distance / dt, improvementScale = Math.max(1, speed * horizon);
    let bestScore = -0.05, bestVx = 0, bestVy = 0, safeCandidate = false;
    let bestAngle = 0, bestScale = 1, freeStraightVx = 0, freeStraightVy = 0;
    const angles = stalled > 0.8 ? RECOVERY_ANGLES : ANGLES;
    for (const angle of angles) {
      const cos = Math.cos(heading + angle), sin = Math.sin(heading + angle);
      const anglePenalty = Math.abs(angle) * 0.035;
      candidate: for (const scale of SPEED_SCALES) {
        const continuityBonus = choice?.angle === angle && choice.scale === scale ? STEERING_SWITCH_MARGIN : 0;
        const velocity = Math.min(speed * scale, maxVelocity);
        const desiredX = cos * velocity, desiredY = sin * velocity;
        // Smoothing is included in the safety check, rather than applied after collision avoidance.
        const vx = request.previousVx + (desiredX - request.previousVx) * blend;
        const vy = request.previousVy + (desiredY - request.previousVy) * blend;
        if (!geometry.canMoveAgainst(x, y, x + vx * horizon, y + vy * horizon, radius, this.movementObstacles)) continue;
        safeCandidate = true;
        if (crowd.length && closesInAhead(x, y, vx, vy, radius, speed, horizon, crowd)) continue;
        const straight = angle === 0 && scale === 1;
        let improvement = straight ? 0 : (distance - Math.hypot(targetDx - vx * horizon, targetDy - vy * horizon)) / improvementScale;
        let penalty = 0;
        for (let index = 0; index < neighbors.length; index++) {
          const neighbor = conflicts[index];
          const dx = neighbor.dx + (vx - neighbor.vx) * horizon, dy = neighbor.dy + (vy - neighbor.vy) * horizon;
          const lengthSq = dx * dx + dy * dy;
          const overlap = lengthSq < neighbor.separationSq ? neighbor.separation - Math.sqrt(lengthSq) : 0;
          const difference = overlap - neighbor.existingOverlap;
          penalty += difference * (difference > 0 ? 1 : .25) * neighbor.weight;
          // Once all initial overlaps have been scored, remaining contributions cannot be
          // negative. The same subtraction order gives an upper bound on the final score.
          // Include the possible continuity bonus in the bound so a retained choice is
          // never pruned before its full overlap relief has been evaluated.
          if (!straight && index >= lastOverlap && improvement - penalty - anglePenalty + continuityBonus <= bestScore) continue candidate;
        }
        if (straight && penalty <= .005) {
          if (!choice || continuityBonus) {
            history.steering = { angle, scale, heading, vx, vy, frame: this.frame, far, solvedAtMs: this.elapsedMs, reuses: 0,
              clearAhead: far && clearAhead(x, y, vx, vy, radius, crowd) };
            return result(vx, vy, 'none', progress, neighbors.length);
          }
          // A clear straight path still accepts reversing momentum if no useful detour
          // remains. It must first compete with the current avoidance choice, though.
          freeStraightVx = vx; freeStraightVy = vy;
        }
        if (straight) improvement = (distance - Math.hypot(targetDx - vx * horizon, targetDy - vy * horizon)) / improvementScale;
        const score = improvement - penalty - anglePenalty;
        // Hysteresis never makes a rejected movement preferable to waiting.
        if (score > -0.05 && score + continuityBonus > bestScore) {
          bestScore = score + continuityBonus; bestVx = vx; bestVy = vy; bestAngle = angle; bestScale = scale;
        }
      }
    }
    if (!bestVx && !bestVy && (freeStraightVx || freeStraightVy)) {
      bestVx = freeStraightVx; bestVy = freeStraightVy;
    }
    if (bestVx || bestVy) history.steering = { angle: bestAngle, scale: bestScale, heading,
      vx: bestVx, vy: bestVy, frame: this.frame, far, solvedAtMs: this.elapsedMs, reuses: 0,
      clearAhead: far && clearAhead(x, y, bestVx, bestVy, radius, crowd) };
    if (!bestVx && !bestVy && safeCandidate) {
      // Waiting behind a far queue wakes as soon as one of its bodies moves, like a crowd wait.
      history.retryAt = this.elapsedMs + 250;
      history.crowdNeighbors = far ? crowd.slice() : neighbors.slice();
    }
    return result(bestVx, bestVy, bestVx || bestVy ? 'none' : safeCandidate ? 'crowd' : 'geometry', progress, neighbors.length);
  }

  /**
   * Bodies a far step could close in on, without the sight-line test. Once the unit has stalled,
   * bodies it precedes on the route (the full solver nearly ignores them) are left out, so two
   * far bodies never wait for each other for good.
   */
  private gatherFarCrowd(request: LocomotionRequest, crowd: Neighbor[], horizon: number, ordered: boolean): void {
    const { x, y, routeCost, radius, speed } = request;
    // Reach of the closing test over the horizon and of a kept course over the reuse window.
    const range = radius + this.maxRadius + 2 + FAR_QUEUE_GAP_PX + Math.max((speed + this.maxNeighborSpeed) * horizon,
      speed * (FAR_REUSE_WINDOW_MS / 1000 + horizon));
    const rangeSq = range * range;
    const minRow = Math.floor((y - range) / CELL), maxRow = Math.floor((y + range) / CELL);
    const minCol = Math.floor((x - range) / CELL), maxCol = Math.floor((x + range) / CELL);
    for (let row = minRow; row <= maxRow; row++) {
      const columns = this.buckets.get(row);
      if (!columns) continue;
      for (let col = minCol; col <= maxCol; col++) {
        const bucket = columns.get(col);
        if (!bucket) continue;
        for (const neighbor of bucket) {
          if (neighbor.id === request.id) continue;
          this.neighborsExamined++;
          const dx = neighbor.x - x, dy = neighbor.y - y;
          if (dx * dx + dy * dy > rangeSq) continue;
          if (ordered && routeCost !== undefined && neighbor.routeCost !== undefined && (routeCost < neighbor.routeCost - 2
            || (Math.abs(routeCost - neighbor.routeCost) <= 2 && request.id < neighbor.id))) continue;
          crowd.push(neighbor);
        }
      }
    }
  }

  private neighborRange(request: LocomotionRequest): number {
    return request.radius + this.maxRadius + (request.speed + this.maxNeighborSpeed) * 0.16 + 8;
  }

  /** Neighbours whose predicted bodies can reach this one before the next frames, minus those behind walls. */
  private gatherVisibleNeighbors(request: LocomotionRequest, geometry: NavigationGeometry, neighbors: Neighbor[]): void {
    const { x, y } = request;
    const range = this.neighborRange(request);
    const rangeSq = range * range;
    const minRow = Math.floor((y - range) / CELL), maxRow = Math.floor((y + range) / CELL);
    const minCol = Math.floor((x - range) / CELL), maxCol = Math.floor((x + range) / CELL);
    for (let row = minRow; row <= maxRow; row++) {
      const columns = this.buckets.get(row);
      if (!columns) continue;
      for (let col = minCol; col <= maxCol; col++) {
        const bucket = columns.get(col);
        if (!bucket) continue;
        for (const neighbor of bucket) {
          if (neighbor.id === request.id) continue;
          this.neighborsExamined++;
          const dx = neighbor.x - x, dy = neighbor.y - y;
          if (dx * dx + dy * dy > rangeSq) continue;
          neighbors.push(neighbor);
        }
      }
    }
    // All neighbor sight lines lie inside this envelope. A dense crowd reuses one
    // broad phase; sparse groups keep the cheaper individual segment queries.
    const reuseBroadPhase = neighbors.length > 4;
    if (reuseBroadPhase) {
      this.neighborObstacles.length = 0;
      geometry.visit(x - range, y - range, x + range, y + range, 0, this.collectNeighborObstacle);
    }
    let visibleNeighbors = 0;
    for (const neighbor of neighbors) {
      // Bodies separated by geometry exert no social force through the wall.
      if (reuseBroadPhase
        ? geometry.canMoveAgainst(x, y, neighbor.x, neighbor.y, 0, this.neighborObstacles)
        : geometry.canMove(x, y, neighbor.x, neighbor.y, 0)) neighbors[visibleNeighbors++] = neighbor;
    }
    neighbors.length = visibleNeighbors;
  }

  private recover(request: LocomotionRequest, geometry: NavigationGeometry, dt: number, progress: number): MovementFeedback {
    const { x, y, radius } = request;
    const opened = new Set<string>();
    geometry.visit(x, y, x, y, radius, obstacle => {
      if (segmentObstacleDistanceSq(x, y, x, y, obstacle) < radius ** 2) opened.add(obstacle.id);
      return false;
    });
    const initial = geometry.penetration(x, y, radius), distance = Math.min(4, request.speed * dt);
    let best = initial, vx = 0, vy = 0;
    for (let i = 0; i < 16; i++) {
      const dx = Math.cos(i * Math.PI / 8) * distance, dy = Math.sin(i * Math.PI / 8) * distance;
      if (!geometry.canRecover(x, y, x + dx, y + dy, radius, opened)) continue;
      const depth = geometry.penetration(x + dx, y + dy, radius);
      if (depth < best - 1e-5 && geometry.penetration(x + dx / 2, y + dy / 2, radius) < initial) {
        best = depth; vx = dx / dt; vy = dy / dt;
      }
    }
    return { vx, vy, waitReason: 'recovery', progress, neighborsVisited: 0 };
  }

  getWorkCounters() {
    return { localNeighborsExamined: this.neighborsExamined, waitingNeighborsObserved: this.waitingNeighborsObserved,
      farSolves: this.farSolves, farSteeringReuses: this.farSteeringReuses };
  }
  clear(): void {
    this.previous.clear(); this.buckets.clear(); this.neighborsById.clear(); this.pool.length = 0; this.geometry = null;
    this.activeBuckets.length = 0; this.rowPool.length = 0;
    this.frame = 0; this.elapsedMs = 0; this.neighborsExamined = 0; this.waitingNeighborsObserved = 0;
    this.farSolves = 0; this.farSteeringReuses = 0;
    this.sliced = false; this.slicePhases.clear();
    this.nearby.length = 0; this.farCrowd.length = 0; this.conflicts.length = 0; this.movementObstacles.length = 0;
    this.neighborObstacles.length = 0;
  }
}

/** Squared cosine of the half-angle (about 39 degrees) in which a body counts as ahead of a far step. */
const AHEAD_COS_SQ = 0.6;
/** Extra following distance behind a queued leader (slower than a third of the follower's speed). */
const FAR_QUEUE_GAP_PX = 6;

/**
 * Whether a body is in front of this velocity: inside the forward cone, and not itself coming
 * head-on (two bodies meeting head-on would otherwise wait for each other forever).
 */
function isAhead(dx: number, dy: number, vx: number, vy: number, body: Neighbor): boolean {
  const along = dx * vx + dy * vy;
  if (along <= 0) return false;
  const distanceSq = dx * dx + dy * dy;
  if (along * along < AHEAD_COS_SQ * distanceSq * (vx * vx + vy * vy)) return false;
  const back = -(body.vx * dx + body.vy * dy);
  return !(back > 0 && back * back > 0.25 * distanceSq * (body.vx * body.vx + body.vy * body.vy));
}

/**
 * Far crowd rule: within the horizon, would this velocity close in on a body ahead that it
 * already touches or would touch? Bodies beside or behind do not count; they yield themselves.
 */
function closesInAhead(x: number, y: number, vx: number, vy: number, radius: number, speed: number, horizon: number,
  crowd: readonly Neighbor[]): boolean {
  for (const body of crowd) {
    const dx = body.x - x, dy = body.y - y;
    if (!isAhead(dx, dy, vx, vy, body)) continue;
    const queued = body.vx * body.vx + body.vy * body.vy < (speed / 3) ** 2;
    const separation = radius + body.radius + 2 + (queued ? FAR_QUEUE_GAP_PX : 0);
    const px = dx + (body.vx - vx) * horizon, py = dy + (body.vy - vy) * horizon;
    const predicted = px * px + py * py;
    if (predicted < separation * separation && predicted < dx * dx + dy * dy) return true;
  }
  return false;
}

/** A far course may be kept only if no body ahead is within reach of it until the reuse window ends. */
function clearAhead(x: number, y: number, vx: number, vy: number, radius: number, crowd: readonly Neighbor[]): boolean {
  const travel = Math.hypot(vx, vy) * (FAR_REUSE_WINDOW_MS / 1000 + 0.12);
  for (const body of crowd) {
    const dx = body.x - x, dy = body.y - y;
    if (!isAhead(dx, dy, vx, vy, body)) continue;
    const reach = radius + body.radius + 2 + travel;
    if (dx * dx + dy * dy < reach * reach) return false;
  }
  return true;
}
