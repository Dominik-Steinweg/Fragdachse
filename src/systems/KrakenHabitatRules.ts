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

  reserveLanes(boss: BossTargetRef, habitatId: string, targets: readonly Point[], maxCount: number): readonly KrakenLaneReservation[] {
    if (!this.matches(boss, habitatId)) return [];
    const t = this.config.tentacles;
    const ranked = this.habitat.shores.map((s, index) => {
      const waterEntry = this.cell(s.waterCell), land = this.cell(s.landCell);
      const angle = Math.atan2(land.y - waterEntry.y, land.x - waterEntry.x);
      const origin = { x: land.x + Math.cos(angle) * t.safetyMarginPx, y: land.y + Math.sin(angle) * t.safetyMarginPx };
      const score = Math.min(...targets.map(p => Math.hypot(p.x - origin.x - Math.cos(angle) * t.length / 2,
        p.y - origin.y - Math.sin(angle) * t.length / 2)), Infinity);
      return { index, score, reservationId: '', topologyRevision: this.queries.revisions().topologyRevision,
        shoreId: s.id, waterEntry, pose: { originX: origin.x, originY: origin.y, angle,
          geometry: { kind: 'lane' as const, length: t.length, width: t.width } } };
    }).sort((a, b) => a.score - b.score || a.index - b.index);
    const active = [...this.reservations.values()].flatMap(r => 'shoreId' in r.value && this.current(r.value) ? [r.value] : []);
    const result: KrakenLaneReservation[] = [];
    for (const { index: _index, score: _score, ...candidate } of ranked) {
      if (result.length >= Math.min(maxCount, t.maxConcurrent)) break;
      const occupied = [...active, ...result];
      // Leave an open half-plane, and keep warnings disjoint rather than closing a ring.
      if (occupied.some(l => l.shoreId === candidate.shoreId
        || Math.cos(l.pose.angle - candidate.pose.angle) < 0
        || Math.hypot(l.pose.originX - candidate.pose.originX, l.pose.originY - candidate.pose.originY) < t.width + 2 * t.safetyMarginPx)) continue;
      if (!this.laneFree(candidate)) continue;
      result.push(this.remember({ ...candidate, reservationId: this.id() }));
    }
    return result;
  }

  revalidateLane(r: KrakenLaneReservation): boolean { return this.current(r) && this.laneFree(r); }
  reserveExit(boss: BossTargetRef, habitatId: string): KrakenHabitatResult<KrakenExitReservation> {
    if (!this.matches(boss, habitatId)) return this.invalid('Stale boss/habitat');
    const result = this.findExit();
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
        if (!this.wet(p, this.config.bodyRadiusPx) || !this.queries.segmentFree(from, p, this.config.bodyRadiusPx)) break;
        last = p;
      }
      if (last) return last;
    }
    return null;
  }

  /** One point per radial sector. Full clearance from water prevents shoreline egg piles. */
  eggLandings(from: Point, rotation: number, count: number, minShoreDistancePx: number): readonly (Point | null)[] {
    const points: (Point | null)[] = [];
    const step = CELL_SIZE / 2, max = Math.hypot(this.metrics.widthPx, this.metrics.heightPx);
    for (let i = 0; i < count; i++) {
      const angle = rotation + i * Math.PI * 2 / count;
      let point: Point | null = null;
      for (let d = this.config.bodyRadiusPx + step; d < max; d += step) {
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
  canMove(from: Point, to: Point, mode: 'water-approach' | 'ashore'): boolean {
    const radius = this.config.bodyRadiusPx;
    if (!this.inside(from, radius) || !this.inside(to, radius)
      || !this.queries.segmentFree(from, to, radius) || !this.queries.circleFree(to.x, to.y, radius)) return false;
    if (mode === 'ashore') return [...this.reservations.values()].some(r => 'corridorId' in r.value && this.current(r.value));
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (CELL_SIZE / 4)));
    for (let i = 0; i <= steps; i++) if (!this.wet({ x: from.x + (to.x - from.x) * i / steps,
      y: from.y + (to.y - from.y) * i / steps }, radius)) return false;
    return true;
  }

  private findExit(): KrakenHabitatResult<KrakenExitReservation> {
    let pending = false;
    for (const e of this.habitat.exits) {
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
      if (!this.isDryBodyFree(q, radius)) return false;
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
