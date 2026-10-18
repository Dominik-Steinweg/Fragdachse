import type { NavigationGeometry, NavigationPoint } from './NavigationGeometry';
import type { FlowFieldMetrics } from '../flowfield/FlowFieldKernel';
import type { FlowFieldSnapshot } from '../flowfield/FlowFieldCoordinator';
import { navigationPoint } from './NavigationGraph';

interface Reservation { id: string; target: string; point: NavigationPoint; radius: number; until: number; topology: number; goal: number; cell: number }

/** Lease buckets; a candidate only visits buckets within the largest possible separation. */
const CELL = 64;
const cellKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);

/** Soft leases spread close-range arrivals. They never remove graph edges or change reachability. */
export class AttackPositionReservations {
  private readonly leases = new Map<string, Reservation>();
  /** target -> cell -> leases of that target in that cell. Penalties are summed independent of order. */
  private readonly buckets = new Map<string, Map<number, Set<Reservation>>>();
  private maxLeaseRadius = 0;

  select(id: string, target: string, x: number, y: number, radius: number, region: number, now: number,
    snapshot: FlowFieldSnapshot, metrics: FlowFieldMetrics, geometry: NavigationGeometry): NavigationPoint | null {
    const previous = this.leases.get(id);
    if (previous && previous.target === target && previous.until > now && previous.topology === snapshot.topologyVersion
      && previous.goal === snapshot.goalVersion && geometry.canMove(x, y, previous.point.x, previous.point.y, radius)) return previous.point;
    const cells = this.buckets.get(target);
    const reach = Math.ceil((radius + this.maxLeaseRadius + 2) / CELL);
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
      if (cells) {
        const cx = Math.floor(point.x / CELL), cy = Math.floor(point.y / CELL);
        scan: for (let gy = cy - reach; gy <= cy + reach; gy++) for (let gx = cx - reach; gx <= cx + reach; gx++) {
          const bucket = cells.get(cellKey(gx, gy));
          if (!bucket) continue;
          for (const lease of bucket) {
            if (lease.id === id || lease.until <= now) continue;
            const separation = radius + lease.radius + 2;
            const dx = point.x - lease.point.x, dy = point.y - lease.point.y;
            if (Math.abs(dx) >= separation || Math.abs(dy) >= separation) continue;
            const overlap = Math.max(0, separation - Math.hypot(dx, dy));
            score += overlap * 5;
            if (score >= bestScore) break scan;
          }
        }
      }
      if (score < bestScore) { bestScore = score; best = point; }
    }
    if (best) this.setLease({ id, target, point: best, radius, until: now + 500,
      topology: snapshot.topologyVersion, goal: snapshot.goalVersion, cell: 0 });
    return best;
  }
  retain(active: ReadonlySet<string>, now: number): void {
    for (const [id, lease] of this.leases) if (!active.has(id) || lease.until < now - 500) this.removeLease(id);
    if (!this.leases.size) this.maxLeaseRadius = 0;
  }
  clear(): void { this.leases.clear(); this.buckets.clear(); this.maxLeaseRadius = 0; }

  private setLease(lease: Reservation): void {
    this.removeLease(lease.id);
    lease.cell = cellKey(Math.floor(lease.point.x / CELL), Math.floor(lease.point.y / CELL));
    let cells = this.buckets.get(lease.target);
    if (!cells) this.buckets.set(lease.target, cells = new Map());
    let bucket = cells.get(lease.cell);
    if (!bucket) cells.set(lease.cell, bucket = new Set());
    bucket.add(lease);
    this.leases.set(lease.id, lease);
    // Monotonic until the table empties: a stale maximum only widens the visited neighbourhood.
    this.maxLeaseRadius = Math.max(this.maxLeaseRadius, lease.radius);
  }

  private removeLease(id: string): void {
    const lease = this.leases.get(id);
    if (!lease) return;
    this.leases.delete(id);
    const cells = this.buckets.get(lease.target), bucket = cells?.get(lease.cell);
    if (!bucket) return;
    bucket.delete(lease);
    if (!bucket.size) cells!.delete(lease.cell);
    if (!cells!.size) this.buckets.delete(lease.target);
  }
}
