import { CELL_SIZE } from '../config';
import type { WaterGeometry } from '../arena/WaterGeometry';
import type { BossTargetRef } from '../combat/CombatPartContact';
import type { KrakenHabitatConfig } from '../config/krakenHabitat';
import type { KrakenBossConfig } from '../config/krakenBoss';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import type { KrakenExitReservation, KrakenHabitatPort, KrakenHabitatReservation, KrakenHabitatResult, KrakenLaneReservation } from './KrakenState';

type Point = { readonly x: number; readonly y: number };
export interface KrakenHabitatQueries {
  revisions(): { worldRevision: number; activityRevision: number; topologyRevision: number };
  /** Excludes water; includes fixed/dynamic obstacles and current body occupancy. */
  circleFree(x: number, y: number, radius: number): boolean;
  segmentFree(from: Point, to: Point, radius: number): boolean;
  landConnection(point: Point, radius: number): 'ready' | 'pending' | 'blocked';
}

/** Uses World water/metrics and current navigation; reservations never survive scope/topology. */
export class KrakenHabitatRules implements KrakenHabitatPort {
  private sequence = 0;
  private readonly reservations = new Map<string, { scope: ReturnType<KrakenHabitatQueries['revisions']>;
    value: KrakenHabitatReservation | KrakenLaneReservation | KrakenExitReservation }>();

  constructor(private readonly habitat: KrakenHabitatConfig, private readonly water: WaterGeometry,
    private readonly metrics: WorldMetrics, private readonly config: KrakenBossConfig,
    private readonly queries: KrakenHabitatQueries) {}

  reserveWaterSpawn(habitatId: string, bodyRadiusPx: number): KrakenHabitatResult<KrakenHabitatReservation> {
    if (habitatId !== this.habitat.id || bodyRadiusPx !== this.config.bodyRadiusPx) return this.invalid('Unknown habitat/body profile');
    const anchor = this.habitat.waterAnchors.find(a => a.id === this.habitat.initialAnchorId);
    if (!anchor) return this.invalid('Missing initial water anchor');
    const point = this.cell(anchor.cell);
    if (!this.wet(point, bodyRadiusPx) || !this.queries.circleFree(point.x, point.y, bodyRadiusPx)) return this.blocked('Water anchor obstructed');
    const exit = this.findExit();
    if (exit.status !== 'valid') return exit;
    return { status: 'valid', value: this.remember({ ...this.queries.revisions(), reservationId: this.id(),
      habitatId, waterAnchorId: anchor.id, bodyRadiusPx, ...point }) };
  }

  revalidate(r: KrakenHabitatReservation): boolean {
    return this.current(r) && this.wet(r, r.bodyRadiusPx) && this.queries.circleFree(r.x, r.y, r.bodyRadiusPx)
      && this.findExit().status === 'valid';
  }

  /** Reserve emergence points, not attacks. A hovering arm owns no warning lane. */
  reserveTentacles(boss: BossTargetRef, habitatId: string, targets: readonly Point[], maxCount: number,
    avoid: readonly Point[] = []): readonly KrakenLaneReservation[] {
    if (!this.matches(boss, habitatId)) return [];
    const t = this.config.tentacles;
    const active = [...this.reservations.values()].flatMap(r => 'shoreId' in r.value && this.current(r.value) ? [r.value.waterEntry] : []);
    const ranked = this.pondPoints().filter(p => !this.wet(p, t.emergeShoreBandPx)
      && this.queries.circleFree(p.x, p.y, t.safetyMarginPx))
      .map((p, index) => ({ p, index, score: Math.min(...targets.map(q => Math.hypot(q.x - p.x, q.y - p.y)), Infinity) }))
      .sort((a, b) => a.score - b.score || a.index - b.index);
    const result: KrakenLaneReservation[] = [];
    for (const { p, index } of ranked) {
      if (result.length >= Math.min(maxCount, t.maxConcurrent - active.length)) break;
      if ([...active, ...avoid, ...result.map(r => r.waterEntry)].some(q => Math.hypot(p.x - q.x, p.y - q.y) < t.spawnSpacingPx)) continue;
      const target = targets.reduce<Point | null>((best, q) => !best || Math.hypot(q.x - p.x, q.y - p.y)
        < Math.hypot(best.x - p.x, best.y - p.y) ? q : best, null);
      result.push(this.remember({ reservationId: this.id(), topologyRevision: this.queries.revisions().topologyRevision,
        shoreId: 'water-' + index, waterEntry: p, pose: { originX: p.x, originY: p.y,
          angle: target ? Math.atan2(target.y - p.y, target.x - p.x) : 0,
          geometry: { kind: 'lane', length: t.length, width: t.width } } }));
    }
    return result;
  }

  aimTentacle(r: KrakenLaneReservation, target: Point): KrakenLaneReservation['pose'] | null {
    if (!this.current(r)) return null;
    const d = Math.hypot(target.x - r.waterEntry.x, target.y - r.waterEntry.y);
    if (d < 1 || d > this.config.tentacles.length - this.config.tentacles.safetyMarginPx) return null;
    const pose = { ...r.pose, angle: Math.atan2(target.y - r.waterEntry.y, target.x - r.waterEntry.x) };
    if (!this.laneFree({ ...r, pose })) return null;
    // Host permit owns the frozen impact geometry from this point onwards.
    Object.assign(r, { pose });
    return pose;
  }
  revalidateLane(r: KrakenLaneReservation): boolean { return this.current(r) && this.laneFree(r); }

  private pondCache: Point[] | null = null;
  private pondPoints(): Point[] {
    if (this.pondCache) return this.pondCache;
    const anchor = this.habitat.waterAnchors.find(a => a.id === this.habitat.initialAnchorId)!;
    const cells = [anchor.cell], seen = new Set<string>();
    const points: Point[] = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], key = c.gridX + ':' + c.gridY;
      if (seen.has(key) || !this.water.hasCell(c.gridX, c.gridY)) continue;
      seen.add(key); points.push(this.cell(c));
      for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) cells.push({ gridX: c.gridX + x, gridY: c.gridY + y });
    }
    return this.pondCache = points;
  }
  private pondInterior(): { x: number; y: number; radius: number } {
    const points = this.pondPoints();
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const left = Math.min(...xs) - CELL_SIZE / 2, right = Math.max(...xs) + CELL_SIZE / 2;
    const top = Math.min(...ys) - CELL_SIZE / 2, bottom = Math.max(...ys) + CELL_SIZE / 2;
    return { x: (left + right) / 2, y: (top + bottom) / 2, radius: Math.min(right - left, bottom - top) / 2 };
  }
  isDiveInterior(p: Point): boolean {
    const center = this.pondInterior();
    return Math.hypot(p.x - center.x, p.y - center.y) <= center.radius * this.config.waterWander.diveInteriorRatio
      && this.wet(p, this.config.bodyRadiusPx);
  }
  divePoint(from: Point): Point | null {
    const center = this.pondInterior();
    return [center, ...this.pondPoints()].filter(p => this.isDiveInterior(p))
      .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))
      .find(p => this.canMove(from, p, 'water-approach')) ?? null;
  }
  private wanderCandidates: Point[] | null = null;
  wanderPoint(from: Point, random: number): Point | null {
    const c = this.config.waterWander;
    this.wanderCandidates ??= this.pondPoints().filter(p => this.wet(p, this.config.bodyRadiusPx + c.shoreClearancePx));
    const candidates = this.wanderCandidates.filter(p => {
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      return d >= c.minLegPx && d <= c.maxLegPx;
    });
    const start = Math.min(candidates.length - 1, Math.floor(random * candidates.length));
    for (let i = 0; i < candidates.length; i++) {
      const point = candidates[(start + i) % candidates.length];
      if (this.canWander(from, point)) return point;
    }
    return null;
  }
  canWander(from: Point, to: Point): boolean {
    const radius = this.config.bodyRadiusPx + this.config.waterWander.shoreClearancePx;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 8));
    for (let i = 0; i <= steps; i++) if (!this.wet({ x: from.x + (to.x - from.x) * i / steps,
      y: from.y + (to.y - from.y) * i / steps }, radius)) return false;
    return this.queries.segmentFree(from, to, this.config.bodyRadiusPx);
  }

  /** Shortest body-valid route on the World grid; water is allowed only for this recovery.
   * Every returned displacement is speed bounded and revalidated against current solids. */
  recoverLand(from: Point, distance: number): Point | null {
    const radius = this.config.bodyRadiusPx;
    if (this.isDryBodyFree(from, radius)) return null;
    type Node = { p: Point; cost: number; first: Point };
    const open: Node[] = [{ p: from, cost: 0, first: from }], costs = new Map<string, number>();
    while (open.length) {
      open.sort((a, b) => b.cost - a.cost);
      const n = open.pop()!;
      const key = n.p.x + ':' + n.p.y;
      if ((costs.get(key) ?? Infinity) < n.cost) continue;
      if (this.isDryBodyFree(n.p, radius)) {
        // Prefer a direct connection when it is shorter and solid-free.
        const to = this.queries.segmentFree(from, n.p, radius) ? n.p : n.first;
        const d = Math.hypot(to.x - from.x, to.y - from.y), t = Math.min(1, distance / d);
        return d ? { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t } : null;
      }
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const p = { x: n.p.x + dx * CELL_SIZE, y: n.p.y + dy * CELL_SIZE };
        const cost = n.cost + Math.hypot(dx, dy) * CELL_SIZE, k = p.x + ':' + p.y;
        if ((costs.get(k) ?? Infinity) <= cost || !this.inside(p, radius)
          || !this.queries.circleFree(p.x, p.y, radius) || !this.queries.segmentFree(n.p, p, radius)) continue;
        costs.set(k, cost); open.push({ p, cost, first: n.cost === 0 ? p : n.first });
      }
    }
    return null;
  }
  reserveExit(boss: BossTargetRef, habitatId: string, target?: Point): KrakenHabitatResult<KrakenExitReservation> {
    if (!this.matches(boss, habitatId)) return this.invalid('Stale boss/habitat');
    const result = this.findExit(target);
    return result.status === 'valid' ? { status: 'valid', value: this.remember({ ...result.value, reservationId: this.id() }) } : result;
  }
  revalidateExit(r: KrakenExitReservation): KrakenHabitatResult<KrakenExitReservation> {
    if (!this.current(r)) return this.invalid('Stale corridor reservation');
    return this.exitFree(r);
  }
  release(id: string): void { this.reservations.delete(id); }
  clear(): void { this.reservations.clear(); }

  /** Safe straight swim towards the selected shore, stopping with the entire body in water. */
  waterApproach(from: Point, target: Point): Point | null {
    const ranked = this.habitat.shores.map(s => this.cell(s.waterCell))
      .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
    for (const shore of ranked) {
      const distance = Math.hypot(shore.x - from.x, shore.y - from.y), steps = Math.max(1, Math.ceil(distance / (CELL_SIZE / 4)));
      let last: Point | null = null;
      for (let i = 1; i <= steps; i++) {
        const p = { x: from.x + (shore.x - from.x) * i / steps, y: from.y + (shore.y - from.y) * i / steps };
        if (!this.wet(p, this.config.bodyRadiusPx + this.config.waterShoreDistancePx) || !this.queries.segmentFree(from, p, this.config.bodyRadiusPx)) break;
        last = p;
      }
      if (last) return last;
    }
    return null;
  }

  /** One point per sector inside the facing cone. Full clearance from water prevents shoreline egg piles. */
  eggLandings(from: Point, rotation: number, count: number, minShoreDistancePx: number): readonly (Point | null)[] {
    const points: (Point | null)[] = [];
    const step = CELL_SIZE / 2, max = Math.hypot(this.metrics.widthPx, this.metrics.heightPx);
    for (let i = 0; i < count; i++) {
      const angle = rotation + (count === 1 ? 0 : i / (count - 1) - 0.5) * this.config.eggs.throwConeDegrees * Math.PI / 180;
      let point: Point | null = null;
      for (let d = this.config.eggs.throwDistancePx; d < max; d += step) {
        const p = { x: from.x + Math.cos(angle) * d, y: from.y + Math.sin(angle) * d };
        if (this.dry(p, this.config.eggs.radiusPx + minShoreDistancePx)
          && this.queries.circleFree(p.x, p.y, this.config.eggs.radiusPx)
          && this.queries.segmentFree(from, p, this.config.eggs.radiusPx)
          && points.every(q => !q || Math.hypot(q.x - p.x, q.y - p.y) >= this.config.eggs.radiusPx * 2)) { point = p; break; }
      }
      points.push(point);
    }
    return points;
  }

  isDryBodyFree(point: Point, radius: number): boolean {
    return this.dry(point, radius) && this.queries.circleFree(point.x, point.y, radius);
  }

  /** Validate the actual next host segment, including any water approach to an exit anchor. */
  canMove(from: Point, to: Point, mode: 'water-approach' | 'ashore' | 'land'): boolean {
    const radius = this.config.bodyRadiusPx;
    if (!this.inside(from, radius) || !this.inside(to, radius)
      || !this.queries.segmentFree(from, to, radius) || !this.queries.circleFree(to.x, to.y, radius)) return false;
    if (mode === 'ashore') return [...this.reservations.values()].some(r => 'corridorId' in r.value && this.current(r.value));
    if (mode === 'land' && this.water.sweep(from.x, from.y, to.x, to.y, radius) < 1) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (CELL_SIZE / 4)));
    for (let i = 0; i <= steps; i++) {
      const point = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps };
      if (!(mode === 'land' ? this.dry(point, radius) : this.wet(point, radius))) return false;
    }
    return true;
  }

  private findExit(target?: Point): KrakenHabitatResult<KrakenExitReservation> {
    let pending = false;
    const ranked = this.habitat.exits.map((exit, index) => {
      const end = this.cell(exit.path[exit.path.length - 1]);
      return { exit, index, score: target ? Math.hypot(end.x - target.x, end.y - target.y) : 0 };
    }).sort((a, b) => a.score - b.score || a.index - b.index);
    for (const { exit: e } of ranked) {
      const r: KrakenExitReservation = { reservationId: '', topologyRevision: this.queries.revisions().topologyRevision,
        corridorId: e.id, widthPx: e.widthCells * CELL_SIZE, path: e.path.map(p => this.cell(p)) };
      const result = this.exitFree(r);
      if (result.status === 'valid') return result;
      pending ||= result.status === 'pending';
    }
    return { status: pending ? 'pending' : 'blocked', reason: 'No current body-sized land connection' };
  }
  private exitFree(r: KrakenExitReservation): KrakenHabitatResult<KrakenExitReservation> {
    const radius = this.config.bodyRadiusPx, end = r.path[r.path.length - 1];
    if (r.widthPx < radius * 2 || !end || !this.dry(end, radius)
      || r.path.some((p, i) => !this.inside(p, r.widthPx / 2)
        || !this.queries.circleFree(p.x, p.y, radius)
        || i > 0 && !this.queries.segmentFree(r.path[i - 1], p, radius))) return this.blocked('Exit corridor obstructed');
    const nav = this.queries.landConnection(end, radius);
    return nav === 'ready' ? { status: 'valid', value: r }
      : { status: nav === 'pending' ? 'pending' : 'blocked', reason: 'Land navigation unavailable' };
  }
  private laneFree(r: KrakenLaneReservation): boolean {
    const { pose: p } = r, margin = this.config.tentacles.safetyMarginPx;
    // Conservative circumscribed squares cover the entire lane, including both end caps.
    const step = CELL_SIZE / 4, half = step / 2, radius = Math.SQRT2 * half;
    const width = p.geometry.width + margin * 2, length = p.geometry.length + margin * 2;
    for (let u = -margin; u <= length - margin; u += step) for (let v = -width / 2; v <= width / 2; v += step) {
      const q = { x: p.originX + Math.cos(p.angle) * u - Math.sin(p.angle) * v,
        y: p.originY + Math.sin(p.angle) * u + Math.cos(p.angle) * v };
      if (!this.inside(q, radius) || !this.queries.circleFree(q.x, q.y, radius)) return false;
    }
    return true;
  }
  private wet(p: Point, radius: number): boolean {
    if (!this.inside(p, radius)) return false;
    const m = this.metrics;
    for (let y = Math.floor((p.y - radius - m.offsetY) / CELL_SIZE); y <= Math.floor((p.y + radius - m.offsetY) / CELL_SIZE); y++) {
      for (let x = Math.floor((p.x - radius - m.offsetX) / CELL_SIZE); x <= Math.floor((p.x + radius - m.offsetX) / CELL_SIZE); x++) {
        const left = m.offsetX + x * CELL_SIZE, top = m.offsetY + y * CELL_SIZE;
        const dx = p.x - Math.max(left, Math.min(p.x, left + CELL_SIZE)), dy = p.y - Math.max(top, Math.min(p.y, top + CELL_SIZE));
        if (dx * dx + dy * dy < radius * radius && !this.water.hasCell(x, y)) return false;
      }
    }
    return true;
  }
  private dry(p: Point, radius: number): boolean { return this.inside(p, radius) && !this.water.isCircleBlocked(p.x, p.y, radius); }
  private inside(p: Point, r: number): boolean { return p.x - r >= this.metrics.offsetX && p.y - r >= this.metrics.offsetY && p.x + r <= this.metrics.maxX && p.y + r <= this.metrics.maxY; }
  private cell(c: { gridX: number; gridY: number }): Point { return worldCellCenter(this.metrics, c.gridX, c.gridY); }
  private matches(boss: BossTargetRef, habitatId: string): boolean { const s = this.queries.revisions(); return habitatId === this.habitat.id && boss.scope.worldRevision === s.worldRevision && boss.instance.activityRevision === s.activityRevision; }
  private current(r: { reservationId: string; topologyRevision: number }): boolean {
    const stored = this.reservations.get(r.reservationId), s = this.queries.revisions();
    return !!stored && stored.value === r && stored.scope.worldRevision === s.worldRevision
      && stored.scope.activityRevision === s.activityRevision && r.topologyRevision === s.topologyRevision;
  }
  private remember<T extends KrakenHabitatReservation | KrakenLaneReservation | KrakenExitReservation>(value: T): T {
    this.reservations.set(value.reservationId, { scope: this.queries.revisions(), value }); return value;
  }
  private id(): string { return `kraken-habitat:${++this.sequence}`; }
  private invalid(reason: string): { status: 'invalid'; reason: string } { return { status: 'invalid', reason }; }
  private blocked(reason: string): { status: 'blocked'; reason: string } { return { status: 'blocked', reason }; }
}
