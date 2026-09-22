import type { LocomotionRequest, MovementFeedback } from './NavigationContracts';
import { NavigationGeometry, segmentObstacleDistanceSq, type NavigationObstacle } from './NavigationGeometry';

interface Neighbor { readonly id: string; readonly x: number; readonly y: number; readonly radius: number; readonly vx: number; readonly vy: number; readonly routeCost?: number }
const ANGLES = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2];
const RECOVERY_ANGLES = [...ANGLES, Math.PI * 0.75, -Math.PI * 0.75, Math.PI];
const SPEED_SCALES = [1, 0.45];
const CELL = 96;
interface Conflict { dx: number; dy: number; vx: number; vy: number; separation: number;
  separationSq: number; existingOverlap: number; weight: number }

/** One consistent position/velocity snapshot for both hostile and allied ordinary movement. */
export class EnemyLocomotion {
  private readonly buckets = new Map<number, Map<number, Neighbor[]>>();
  private readonly rowPool: Map<number, Neighbor[]>[] = [];
  private readonly activeBuckets: Neighbor[][] = [];
  private readonly neighborsById = new Map<string, Neighbor>();
  private readonly pool: Neighbor[][] = [];
  private readonly previous = new Map<string, { x: number; y: number; targetX: number; targetY: number; stalled: number;
    retryAt: number; geometry: NavigationGeometry; crowdNeighbors?: readonly Neighbor[] }>();
  private elapsedMs = 0;
  private neighborsExamined = 0;
  private waitingNeighborsObserved = 0;
  private maxRadius = 0;
  private maxNeighborSpeed = 0;
  private geometry: NavigationGeometry | null = null;
  private deltaSeconds = 0;
  private readonly nearby: Neighbor[] = [];
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
  }

  solve(request: LocomotionRequest): MovementFeedback {
    const { x, y, radius, speed, waypoint } = request, geometry = this.geometry;
    const result = (vx: number, vy: number, waitReason: MovementFeedback['waitReason'], progress = 0, neighborsVisited = 0): MovementFeedback =>
      ({ vx, vy, waitReason, progress, neighborsVisited });
    if (!geometry || request.priority === 'exclusive') return result(0, 0, 'exclusive');
    if (request.priority === 'attack') return result(0, 0, 'attack');
    if (!waypoint) return result(0, 0, 'route-pending');
    const targetDx = waypoint.x - x, targetDy = waypoint.y - y;
    const distance = Math.hypot(targetDx, targetDy);
    const prior = this.previous.get(request.id);
    const progress = prior ? Math.hypot(x - prior.x, y - prior.y) : 0;
    const sameTarget = prior && Math.hypot(waypoint.x - prior.targetX, waypoint.y - prior.targetY) < 16;
    const stalled = sameTarget && progress < Math.max(0.1, speed * this.deltaSeconds * 0.08) ? prior.stalled + this.deltaSeconds : 0;
    const history = { x, y, targetX: waypoint.x, targetY: waypoint.y, stalled,
      retryAt: prior?.retryAt ?? 0, geometry, crowdNeighbors: prior?.crowdNeighbors };
    this.previous.set(request.id, history);
    // A waypoint may be the precise attachment needed to turn around a rock corner.
    // Stopping a pixel short can leave the following body sweep permanently blocked.
    if (distance < 1e-3) return result(0, 0, 'arrival', progress);
    const dt = this.deltaSeconds;
    if (dt <= 0 || speed <= 0) return result(0, 0, 'arrival', progress);
    const horizon = Math.max(dt, 0.12);
    const blend = Math.min(1, dt * 14);
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
    const range = radius + this.maxRadius + (speed + this.maxNeighborSpeed) * 0.16 + 8;
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
    const maxVelocity = distance / dt, improvementScale = Math.max(1, speed * horizon);
    let bestScore = -0.05, bestVx = 0, bestVy = 0, safeCandidate = false;
    const angles = stalled > 0.8 ? RECOVERY_ANGLES : ANGLES;
    for (const angle of angles) {
      const cos = Math.cos(heading + angle), sin = Math.sin(heading + angle);
      const anglePenalty = Math.abs(angle) * 0.035;
      candidate: for (const scale of SPEED_SCALES) {
        const velocity = Math.min(speed * scale, maxVelocity);
        const desiredX = cos * velocity, desiredY = sin * velocity;
        // Smoothing is included in the safety check, rather than applied after collision avoidance.
        const vx = request.previousVx + (desiredX - request.previousVx) * blend;
        const vy = request.previousVy + (desiredY - request.previousVy) * blend;
        if (!geometry.canMoveAgainst(x, y, x + vx * horizon, y + vy * horizon, radius, this.movementObstacles)) continue;
        safeCandidate = true;
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
          // Keep the straight candidate's separate acceptance rule and all tie ordering.
          if (!straight && index >= lastOverlap && improvement - penalty - anglePenalty <= bestScore) continue candidate;
        }
        if (straight && penalty <= .005) return result(vx, vy, 'none', progress, neighbors.length);
        if (straight) improvement = (distance - Math.hypot(targetDx - vx * horizon, targetDy - vy * horizon)) / improvementScale;
        const score = improvement - penalty - anglePenalty;
        if (score > bestScore) { bestScore = score; bestVx = vx; bestVy = vy; }
      }
    }
    if (!bestVx && !bestVy && safeCandidate) {
      history.retryAt = this.elapsedMs + 250;
      history.crowdNeighbors = neighbors.slice();
    }
    return result(bestVx, bestVy, bestVx || bestVy ? 'none' : safeCandidate ? 'crowd' : 'geometry', progress, neighbors.length);
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

  getWorkCounters() { return { localNeighborsExamined: this.neighborsExamined, waitingNeighborsObserved: this.waitingNeighborsObserved }; }
  clear(): void {
    this.previous.clear(); this.buckets.clear(); this.neighborsById.clear(); this.pool.length = 0; this.geometry = null;
    this.activeBuckets.length = 0; this.rowPool.length = 0;
    this.elapsedMs = 0; this.neighborsExamined = 0; this.waitingNeighborsObserved = 0;
    this.nearby.length = 0; this.conflicts.length = 0; this.movementObstacles.length = 0;
    this.neighborObstacles.length = 0;
  }
}
