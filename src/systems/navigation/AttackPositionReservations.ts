import type { NavigationGeometry, NavigationPoint } from './NavigationGeometry';
import type { FlowFieldMetrics } from '../flowfield/FlowFieldKernel';
import type { FlowFieldSnapshot } from '../flowfield/FlowFieldCoordinator';
import { navigationPoint } from './NavigationGraph';

interface Reservation { target: string; point: NavigationPoint; radius: number; until: number; topology: number; goal: number }

/** Soft leases spread close-range arrivals. They never remove graph edges or change reachability. */
export class AttackPositionReservations {
  private readonly leases = new Map<string, Reservation>();
  select(id: string, target: string, x: number, y: number, radius: number, region: number, now: number,
    snapshot: FlowFieldSnapshot, metrics: FlowFieldMetrics, geometry: NavigationGeometry): NavigationPoint | null {
    const previous = this.leases.get(id);
    if (previous && previous.target === target && previous.until > now && previous.topology === snapshot.topologyVersion
      && previous.goal === snapshot.goalVersion && geometry.canMove(x, y, previous.point.x, previous.point.y, radius)) return previous.point;
    let best: NavigationPoint | null = null, bestScore = Infinity;
    // Bound local selection work even for very large ranged attack areas.
    const stride = Math.max(1, Math.ceil(snapshot.goalIndexes.length / 96));
    for (let i = 0; i < snapshot.goalIndexes.length; i += stride) {
      const index = snapshot.goalIndexes[i];
      if (snapshot.regions?.[index] !== region) continue;
      const point = navigationPoint(metrics, index), distance = Math.hypot(point.x - x, point.y - y);
      // Every lease adds a non-negative penalty. Distance alone can already rule out a
      // candidate; ties retain the first goal, exactly as the final strict comparison does.
      if (distance >= bestScore || distance > 144 || !geometry.canMove(x, y, point.x, point.y, radius)) continue;
      let score = distance;
      for (const [otherId, lease] of this.leases) {
        if (otherId === id || lease.target !== target || lease.until <= now) continue;
        const separation = radius + lease.radius + 2;
        const dx = point.x - lease.point.x, dy = point.y - lease.point.y;
        if (Math.abs(dx) >= separation || Math.abs(dy) >= separation) continue;
        const overlap = Math.max(0, separation - Math.hypot(dx, dy));
        score += overlap * 5;
        if (score >= bestScore) break;
      }
      if (score < bestScore) { bestScore = score; best = point; }
    }
    if (best) this.leases.set(id, { target, point: best, radius, until: now + 500,
      topology: snapshot.topologyVersion, goal: snapshot.goalVersion });
    return best;
  }
  retain(active: ReadonlySet<string>, now: number): void {
    for (const [id, lease] of this.leases) if (!active.has(id) || lease.until < now - 500) this.leases.delete(id);
  }
  clear(): void { this.leases.clear(); }
}
