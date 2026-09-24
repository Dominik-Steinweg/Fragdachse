import { ATTACK_DRONE_RULES as R } from '../config/attackDrone';

export interface DronePoint { readonly x: number; readonly y: number }
export interface DroneRect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface AttackDroneTarget extends DronePoint {
  readonly key: string;
  readonly radius: number;
  readonly weight: number;
  readonly rectangles?: readonly DroneRect[];
}
export interface DroneBombCorridor {
  readonly start: DronePoint;
  readonly end: DronePoint;
  readonly drops: readonly DronePoint[];
  readonly targetKeys: readonly string[];
  readonly score: number;
}
export interface DroneGunTarget {
  readonly targetKeys: readonly string[];
  readonly point: DronePoint;
}

export const droneDistance = (a: DronePoint, b: DronePoint): number => Math.hypot(a.x - b.x, a.y - b.y);
export function nearestDroneTargetPoint(target: AttackDroneTarget, from: DronePoint): DronePoint {
  if (!target.rectangles?.length) return target;
  let best: DronePoint = target, distance = Infinity;
  for (const rect of target.rectangles) {
    const point = { x: Math.max(rect.left, Math.min(rect.right, from.x)), y: Math.max(rect.top, Math.min(rect.bottom, from.y)) };
    const d = droneDistance(point, from);
    if (d < distance) { best = point; distance = d; }
  }
  return best;
}
export function droneExplosionTouches(target: AttackDroneTarget, point: DronePoint, radius: number): boolean {
  return droneDistance(nearestDroneTargetPoint(target, point), point) <= radius + (target.rectangles?.length ? 0 : target.radius);
}

/** One bounded spatial projection shared by every station, refreshed only at decision cadence. */
export class AttackDroneTargetIndex {
  private readonly cells = new Map<string, AttackDroneTarget[]>();
  private readonly byKey = new Map<string, AttackDroneTarget>();
  private readonly cellSize = R.range;
  replace(targets: readonly AttackDroneTarget[]): void {
    this.cells.clear(); this.byKey.clear();
    for (const target of targets) {
      this.byKey.set(target.key, target);
      const rects = target.rectangles?.length ? target.rectangles : [{ left: target.x - target.radius,
        right: target.x + target.radius, top: target.y - target.radius, bottom: target.y + target.radius }];
      const inserted = new Set<string>();
      for (const rect of rects) for (let x = Math.floor(rect.left / this.cellSize); x <= Math.floor(rect.right / this.cellSize); x++) {
        for (let y = Math.floor(rect.top / this.cellSize); y <= Math.floor(rect.bottom / this.cellSize); y++) {
          const key = `${x}:${y}`;
          if (inserted.has(key)) continue;
          inserted.add(key);
          let cell = this.cells.get(key);
          if (!cell) this.cells.set(key, cell = []);
          cell.push(target);
        }
      }
    }
  }
  query(point: DronePoint, radius: number): AttackDroneTarget[] {
    const found = new Map<string, AttackDroneTarget>();
    for (let x = Math.floor((point.x - radius) / this.cellSize); x <= Math.floor((point.x + radius) / this.cellSize); x++) {
      for (let y = Math.floor((point.y - radius) / this.cellSize); y <= Math.floor((point.y + radius) / this.cellSize); y++) {
        for (const target of this.cells.get(`${x}:${y}`) ?? []) {
          if (!found.has(target.key) && droneExplosionTouches(target, point, radius)) found.set(target.key, target);
        }
      }
    }
    return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
  get(key: string): AttackDroneTarget | undefined { return this.byKey.get(key); }
  clear(): void { this.cells.clear(); this.byKey.clear(); }
}

export function selectDroneGunTarget(position: DronePoint, targets: readonly AttackDroneTarget[]): DroneGunTarget | null {
  const reachable = targets.filter(t => droneExplosionTouches(t, position, R.range + R.muzzleOffset));
  const candidates = [...reachable].sort((a, b) => droneDistance(nearestDroneTargetPoint(a, position), position)
    - droneDistance(nearestDroneTargetPoint(b, position), position) || a.key.localeCompare(b.key)).slice(0, 24);
  let best: DroneGunTarget | null = null, bestScore = -Infinity;
  for (const target of candidates) {
    const point = nearestDroneTargetPoint(target, position);
    const angle = Math.atan2(point.y - position.y, point.x - position.x);
    const group = reachable.filter(t => {
      const p = nearestDroneTargetPoint(t, position), distance = droneDistance(p, position);
      const diff = Math.atan2(Math.sin(Math.atan2(p.y - position.y, p.x - position.x) - angle),
        Math.cos(Math.atan2(p.y - position.y, p.x - position.x) - angle));
      return Math.abs(diff) <= R.groupSweepDegrees * Math.PI / 360 + Math.atan2(t.radius, Math.max(1, distance));
    });
    const score = group.length * 1000 + group.reduce((n, t) => n + t.weight, 0) - droneDistance(point, position) / R.range;
    if (score > bestScore) { bestScore = score; best = { point, targetKeys: [target.key, ...group.filter(t => t.key !== target.key).map(t => t.key)] }; }
  }
  return best;
}

/** Candidate work is bounded; the actual blast circles, including base cells, decide coverage. */
export function selectDroneBombCorridor(position: DronePoint, owner: DronePoint, targets: readonly AttackDroneTarget[],
  count: number, bounds: DroneRect): DroneBombCorridor | null {
  const anchors = [...targets].sort((a, b) => droneDistance(nearestDroneTargetPoint(a, owner), owner)
    - droneDistance(nearestDroneTargetPoint(b, owner), owner) || a.key.localeCompare(b.key)).slice(0, 24);
  let best: DroneBombCorridor | null = null, bestApproach = Infinity;
  for (const target of anchors) {
    const p = nearestDroneTargetPoint(target, owner), dist = droneDistance(p, owner);
    const factor = dist > R.ownerRadius ? R.ownerRadius / dist : 1;
    const center = { x: owner.x + (p.x - owner.x) * factor, y: owner.y + (p.y - owner.y) * factor };
    for (let direction = 0; direction < 8; direction++) {
      const angle = direction * Math.PI / 8, dx = Math.cos(angle), dy = Math.sin(angle);
      const a = { x: center.x - dx * R.bombLength / 2, y: center.y - dy * R.bombLength / 2 };
      const b = { x: center.x + dx * R.bombLength / 2, y: center.y + dy * R.bombLength / 2 };
      const forward = droneDistance(position, a) <= droneDistance(position, b), start = forward ? a : b, end = forward ? b : a;
      const drops = Array.from({ length: count }, (_, i) => {
        const lateral = (i % 2 ? 1 : -1) * R.bombWidth / 2;
        return { x: start.x + (end.x - start.x) * i / (count - 1) - dy * lateral,
          y: start.y + (end.y - start.y) * i / (count - 1) + dx * lateral };
      });
      if (drops.some(d => d.x < bounds.left || d.x > bounds.right || d.y < bounds.top || d.y > bounds.bottom)
        || droneDistance(start, owner) > R.attackRadius || droneDistance(end, owner) > R.attackRadius) continue;
      const covered = targets.filter(t => drops.some(drop => droneExplosionTouches(t, drop, R.bombRadius)));
      if (!covered.length) continue;
      const score = covered.reduce((n, t) => n + t.weight, 0), approach = droneDistance(position, start);
      const qualifies = covered.length >= R.bombGroupThreshold;
      const bestQualifies = !!best && best.targetKeys.length >= R.bombGroupThreshold;
      if (!best || (qualifies && !bestQualifies) || (qualifies === bestQualifies
        && (score > best.score || (score === best.score && approach < bestApproach)))) {
        best = { start, end, drops, targetKeys: covered.map(t => t.key), score }; bestApproach = approach;
      }
    }
  }
  return best;
}
