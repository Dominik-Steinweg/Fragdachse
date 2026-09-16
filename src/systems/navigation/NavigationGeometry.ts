/** Serializable projection of physical World shapes. No renderer or collision rules are owned here. */
export type NavigationObstacle = ({ readonly shape: 'rect'; readonly left: number; readonly top: number;
  readonly right: number; readonly bottom: number } | { readonly shape: 'circle'; readonly x: number;
  readonly y: number; readonly radius: number }) & {
  readonly id: string;
  readonly kind: 'rock' | 'base' | 'barrier' | 'trunk' | 'water';
};
export interface NavigationGeometrySnapshot {
  readonly left: number; readonly top: number; readonly right: number; readonly bottom: number;
  readonly obstacles: readonly NavigationObstacle[];
}
export interface NavigationPoint { readonly x: number; readonly y: number }

const EPSILON = 1e-6;
const BUCKET = 64;

function pointSegmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
}

/** Exact distance to a closed rectangle, including rounded capsule corners (not an expanded AABB). */
export function segmentObstacleDistanceSq(ax: number, ay: number, bx: number, by: number,
  obstacle: NavigationObstacle): number {
  if (obstacle.shape === 'circle') {
    const distance = Math.sqrt(pointSegmentDistanceSq(obstacle.x, obstacle.y, ax, ay, bx, by));
    return Math.max(0, distance - obstacle.radius) ** 2;
  }
  const { left, top, right, bottom } = obstacle;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) {
    return (ax - Math.max(left, Math.min(right, ax))) ** 2
      + (ay - Math.max(top, Math.min(bottom, ay))) ** 2;
  }
  let enter = 0, exit = 1;
  if (dx === 0) { if (ax < left || ax > right) enter = 2; }
  else { const a = (left - ax) / dx, b = (right - ax) / dx;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); }
  if (dy === 0) { if (ay < top || ay > bottom) enter = 2; }
  else { const a = (top - ay) / dy, b = (bottom - ay) / dy;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); }
  if (enter <= exit) return 0;
  const aSq = (ax - Math.max(left, Math.min(right, ax))) ** 2 + (ay - Math.max(top, Math.min(bottom, ay))) ** 2;
  const bSq = (bx - Math.max(left, Math.min(right, bx))) ** 2 + (by - Math.max(top, Math.min(bottom, by))) ** 2;
  return Math.min(aSq, bSq,
    pointSegmentDistanceSq(left, top, ax, ay, bx, by), pointSegmentDistanceSq(right, top, ax, ay, bx, by),
    pointSegmentDistanceSq(left, bottom, ax, ay, bx, by), pointSegmentDistanceSq(right, bottom, ax, ay, bx, by));
}

/** Shared by worker graph construction, start/goal connections, locomotion and simulated openings. */
export class NavigationGeometry {
  private readonly buckets = new Map<number, number[]>();
  private readonly stamps: Uint32Array;
  private stamp = 0;
  private readonly columns: number;
  constructor(readonly snapshot: NavigationGeometrySnapshot) {
    this.columns = Math.ceil((snapshot.right - snapshot.left) / BUCKET) + 2;
    this.stamps = new Uint32Array(snapshot.obstacles.length);
    snapshot.obstacles.forEach((obstacle, index) => {
      const l = obstacle.shape === 'rect' ? obstacle.left : obstacle.x - obstacle.radius;
      const r = obstacle.shape === 'rect' ? obstacle.right : obstacle.x + obstacle.radius;
      const t = obstacle.shape === 'rect' ? obstacle.top : obstacle.y - obstacle.radius;
      const b = obstacle.shape === 'rect' ? obstacle.bottom : obstacle.y + obstacle.radius;
      for (let y = this.row(t); y <= this.row(b); y++) for (let x = this.col(l); x <= this.col(r); x++) {
        const key = y * this.columns + x;
        const bucket = this.buckets.get(key);
        if (bucket) bucket.push(index); else this.buckets.set(key, [index]);
      }
    });
  }
  private col(x: number): number { return Math.floor((x - this.snapshot.left) / BUCKET) + 1; }
  private row(y: number): number { return Math.floor((y - this.snapshot.top) / BUCKET) + 1; }
  contains(x: number, y: number, radius: number): boolean {
    const b = this.snapshot;
    return Number.isFinite(x + y + radius) && radius >= 0 && x - radius >= b.left - EPSILON
      && y - radius >= b.top - EPSILON && x + radius <= b.right + EPSILON && y + radius <= b.bottom + EPSILON;
  }
  isFree(x: number, y: number, radius: number, opened?: ReadonlySet<string>): boolean {
    return this.canMove(x, y, x, y, radius, opened);
  }
  canMove(ax: number, ay: number, bx: number, by: number, radius: number, opened?: ReadonlySet<string>): boolean {
    if (!this.contains(ax, ay, radius) || !this.contains(bx, by, radius)) return false;
    const threshold = Math.max(EPSILON, radius - EPSILON) ** 2;
    let blocked = false;
    this.visit(ax, ay, bx, by, radius, obstacle => {
      if (opened?.has(obstacle.id)) return false;
      if (segmentObstacleDistanceSq(ax, ay, bx, by, obstacle) < threshold) {
        blocked = true; return true;
      }
      return false;
    });
    return !blocked;
  }
  visit(ax: number, ay: number, bx: number, by: number, radius: number,
    visitor: (obstacle: NavigationObstacle) => boolean): void {
    if (++this.stamp >= 0xffffffff) { this.stamps.fill(0); this.stamp = 1; }
    const left = Math.min(ax, bx) - radius, right = Math.max(ax, bx) + radius;
    const top = Math.min(ay, by) - radius, bottom = Math.max(ay, by) + radius;
    const minRow = this.row(top), maxRow = this.row(bottom), minCol = this.col(left), maxCol = this.col(right);
    for (let y = minRow; y <= maxRow; y++) {
      for (let x = minCol; x <= maxCol; x++) {
        const bucket = this.buckets.get(y * this.columns + x);
        if (!bucket) continue;
        for (const index of bucket) {
          if (this.stamps[index] === this.stamp) continue;
          this.stamps[index] = this.stamp;
          const obstacle = this.snapshot.obstacles[index];
          if (obstacle.shape === 'rect') {
            if (obstacle.right < left || obstacle.left > right || obstacle.bottom < top || obstacle.top > bottom) continue;
          } else if (obstacle.x + obstacle.radius < left || obstacle.x - obstacle.radius > right
            || obstacle.y + obstacle.radius < top || obstacle.y - obstacle.radius > bottom) continue;
          if (visitor(obstacle)) return;
        }
      }
    }
  }
  /** Recovery may leave an initial overlap, but may not enter another obstacle or worsen a world edge overlap. */
  canRecover(ax: number, ay: number, bx: number, by: number, radius: number, initialOverlaps: ReadonlySet<string>): boolean {
    const b = this.snapshot;
    const depths = (x: number, y: number) => [Math.max(0, b.left + radius - x), Math.max(0, x + radius - b.right),
      Math.max(0, b.top + radius - y), Math.max(0, y + radius - b.bottom)];
    const before = depths(ax, ay), after = depths(bx, by);
    if (after.some((depth, i) => depth > before[i] + EPSILON)) return false;
    let blocked = false;
    this.visit(ax, ay, bx, by, radius, obstacle => {
      if (!initialOverlaps.has(obstacle.id) && segmentObstacleDistanceSq(ax, ay, bx, by, obstacle) < (radius - EPSILON) ** 2) {
        blocked = true; return true;
      }
      return false;
    });
    const initial = this.penetration(ax, ay, radius);
    return !blocked && this.penetration(bx, by, radius) < initial - EPSILON
      && this.penetration((ax + bx) / 2, (ay + by) / 2, radius) < initial;
  }
  /** Sum of penetration depths. Recovery may decrease this continuously; it never teleports. */
  penetration(x: number, y: number, radius: number): number {
    const b = this.snapshot;
    let depth = Math.max(0, b.left + radius - x, x + radius - b.right)
      + Math.max(0, b.top + radius - y, y + radius - b.bottom);
    this.visit(x, y, x, y, radius, obstacle => {
      if (obstacle.shape === 'rect' && x >= obstacle.left && x <= obstacle.right && y >= obstacle.top && y <= obstacle.bottom) {
        depth += radius + Math.min(x - obstacle.left, obstacle.right - x, y - obstacle.top, obstacle.bottom - y);
      } else if (obstacle.shape === 'circle') depth += Math.max(0, radius + obstacle.radius - Math.hypot(x - obstacle.x, y - obstacle.y));
      else depth += Math.max(0, radius - Math.sqrt(segmentObstacleDistanceSq(x, y, x, y, obstacle)));
      return false;
    });
    return depth;
  }
}
