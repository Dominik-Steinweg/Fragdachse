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
  private readonly buckets = new Map<string, Neighbor[]>();
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
  private readonly collectMovementObstacle = (obstacle: NavigationObstacle): boolean => {
    this.movementObstacles.push(obstacle); return false;
  };

  begin(neighbors: readonly Neighbor[], geometry: NavigationGeometry, deltaMs: number): void {
    for (const bucket of this.buckets.values()) { bucket.length = 0; this.pool.push(bucket); }
    this.buckets.clear(); this.maxRadius = 0; this.maxNeighborSpeed = 0;
    this.geometry = geometry; this.deltaSeconds = Math.min(0.1, Math.max(0, deltaMs / 1000));
    this.elapsedMs += Math.max(0, deltaMs);
    this.neighborsById.clear();
    for (const neighbor of neighbors) {
      this.neighborsById.set(neighbor.id, neighbor); this.maxRadius = Math.max(this.maxRadius, neighbor.radius);
      this.maxNeighborSpeed = Math.max(this.maxNeighborSpeed, Math.hypot(neighbor.vx, neighbor.vy));
      const key = `${Math.floor(neighbor.x / CELL)},${Math.floor(neighbor.y / CELL)}`;
      let bucket = this.buckets.get(key);
      if (!bucket) { bucket = this.pool.pop() ?? []; this.buckets.set(key, bucket); }
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
    const distance = Math.hypot(waypoint.x - x, waypoint.y - y);
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
    for (let row = Math.floor((y - range) / CELL); row <= Math.floor((y + range) / CELL); row++) {
      for (let col = Math.floor((x - range) / CELL); col <= Math.floor((x + range) / CELL); col++) {
        const bucket = this.buckets.get(`${col},${row}`);
        if (!bucket) continue;
        for (const neighbor of bucket) {
          if (neighbor.id === request.id) continue;
          this.neighborsExamined++;
          const dx = neighbor.x - x, dy = neighbor.y - y;
          if (dx * dx + dy * dy > rangeSq) continue;
          // Bodies separated by geometry exert no social force through the wall.
          if (!geometry.canMove(x, y, neighbor.x, neighbor.y, 0)) continue;
          neighbors.push(neighbor);
        }
      }
    }
    const conflicts = this.conflicts;
    for (let index = 0; index < neighbors.length; index++) {
      const neighbor = neighbors[index];
      const dx = x - neighbor.x, dy = y - neighbor.y, separation = radius + neighbor.radius + 2;
      const precedes = request.routeCost !== undefined && neighbor.routeCost !== undefined
        && (request.routeCost < neighbor.routeCost - 2 || (Math.abs(request.routeCost - neighbor.routeCost) <= 2 && request.id < neighbor.id));
      const conflict = conflicts[index] ?? (conflicts[index] = {} as Conflict);
      conflict.dx = dx; conflict.dy = dy; conflict.vx = neighbor.vx; conflict.vy = neighbor.vy;
      conflict.separation = separation; conflict.separationSq = separation * separation;
      conflict.existingOverlap = Math.max(0, separation - Math.sqrt(dx * dx + dy * dy));
      conflict.weight = neighbor.radius ** 2 / (radius ** 2 + neighbor.radius ** 2) * (precedes ? .06 : 1) / 5;
    }
    const heading = Math.atan2(waypoint.y - y, waypoint.x - x);
    let bestScore = -0.05, bestVx = 0, bestVy = 0, safeCandidate = false;
    const angles = stalled > 0.8 ? RECOVERY_ANGLES : ANGLES;
    for (const angle of angles) for (const scale of SPEED_SCALES) {
      const velocity = Math.min(speed * scale, distance / dt);
      const desiredX = Math.cos(heading + angle) * velocity, desiredY = Math.sin(heading + angle) * velocity;
      // Smoothing is included in the safety check, rather than applied after collision avoidance.
      const vx = request.previousVx + (desiredX - request.previousVx) * blend;
      const vy = request.previousVy + (desiredY - request.previousVy) * blend;
      if (!geometry.canMoveAgainst(x, y, x + vx * horizon, y + vy * horizon, radius, this.movementObstacles)) continue;
      safeCandidate = true;
      let penalty = 0;
      for (let index = 0; index < neighbors.length; index++) {
        const neighbor = conflicts[index];
        const dx = neighbor.dx + (vx - neighbor.vx) * horizon, dy = neighbor.dy + (vy - neighbor.vy) * horizon;
        const lengthSq = dx * dx + dy * dy;
        const overlap = lengthSq < neighbor.separationSq ? neighbor.separation - Math.sqrt(lengthSq) : 0;
        const difference = overlap - neighbor.existingOverlap;
        penalty += difference * (difference > 0 ? 1 : .25) * neighbor.weight;
      }
      const improvement = (distance - Math.hypot(waypoint.x - x - vx * horizon, waypoint.y - y - vy * horizon)) / Math.max(1, speed * horizon);
      const score = improvement - penalty - Math.abs(angle) * 0.035;
      if (angle === 0 && scale === 1 && penalty <= .005) return result(vx, vy, 'none', progress, neighbors.length);
      if (score > bestScore) { bestScore = score; bestVx = vx; bestVy = vy; }
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
    this.elapsedMs = 0; this.neighborsExamined = 0; this.waitingNeighborsObserved = 0;
    this.nearby.length = 0; this.conflicts.length = 0; this.movementObstacles.length = 0;
  }
}
