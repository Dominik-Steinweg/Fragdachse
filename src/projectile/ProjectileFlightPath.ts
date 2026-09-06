/** Presentation-only samples. No renderer or gameplay owner may derive collisions from these. */
export interface ProjectilePathPoint {
  readonly sequence: number;
  readonly timeMs: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Never connect this point to its predecessor (teleport, appearance change, missing history). */
  readonly breakBefore?: boolean;
  readonly bounceSequence?: number;
}

export interface ProjectileFlightPath {
  readonly timeMs: number;
  readonly points: readonly ProjectilePathPoint[];
  readonly ended?: boolean;
}

export const PROJECTILE_PATH_HISTORY_MS = 1000;
export const PROJECTILE_PATH_MAX_POINTS = 128;

/** Small world-owned projection; independent of whether the host has a local renderer. */
export class ProjectilePathRecorder {
  private readonly paths = new Map<number, { sequence: number; points: ProjectilePathPoint[] }>();
  private readonly pending = new Map<number, Array<{ x: number; y: number; vx: number; vy: number; timeMs: number; breakBefore?: boolean }>>();
  private readonly bounceOrigins = new Map<number, { x: number; y: number; timeMs: number }>();

  /** Contact FX use the surface impact; flight turns where the incoming and outgoing
   * center trajectories meet. The separated center is an origin, never extra travel. */
  bounce(id: number, centerX: number, centerY: number, vx: number, vy: number,
    timeMs: number, bounceSequence: number): void {
    const points = this.paths.get(id)?.points;
    const last = points?.[points.length - 1];
    if (!last) return;
    this.discardPending(id);
    const speed = Math.hypot(last.vx, last.vy);
    const nx = speed > 0 ? last.vx / speed : 0, ny = speed > 0 ? last.vy / speed : 0;
    const dx = centerX - last.x, dy = centerY - last.y;
    const cross = nx * vy - ny * vx;
    // Head-on reflection is collinear; projection also handles a stopped projectile.
    const distance = Math.abs(cross) > Math.hypot(vx, vy) * 1e-6
      ? (dx * vy - dy * vx) / cross : dx * nx + dy * ny;
    const x = speed > 0 ? last.x + nx * Math.max(0, distance) : centerX;
    const y = speed > 0 ? last.y + ny * Math.max(0, distance) : centerY;
    this.append(id, x, y, vx, vy, timeMs, false, bounceSequence);
    this.bounceOrigins.set(id, { x: centerX, y: centerY, timeMs: Math.max(timeMs, last.timeMs) });
  }

  /** Physics observations stay tentative until the runtime has resolved swept contacts. */
  observe(id: number, x: number, y: number, vx: number, vy: number, timeMs: number): void {
    if (!this.paths.has(id)) return;
    let samples = this.pending.get(id);
    if (!samples) { samples = []; this.pending.set(id, samples); }
    if (samples.length === PROJECTILE_PATH_MAX_POINTS) {
      samples.shift();
      if (samples[0]) samples[0].breakBefore = true;
    }
    samples.push({ x, y, vx, vy, timeMs });
  }

  /** Arcade moves bodies before sprite postUpdate. Only publish the runtime-confirmed prefix. */
  commitThrough(id: number, x: number, y: number): boolean {
    const samples = this.pending.get(id);
    if (!samples?.length) return true;
    let confirmed = -1;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i].x - x) < 1e-6 && Math.abs(samples[i].y - y) < 1e-6) confirmed = i;
    }
    if (confirmed < 0) return false;
    for (const p of samples.splice(0, confirmed + 1)) this.append(id, p.x, p.y, p.vx, p.vy, p.timeMs, p.breakBefore);
    if (!samples.length) this.pending.delete(id);
    return true;
  }

  discardPending(id: number): void { this.pending.delete(id); }

  begin(id: number, x: number, y: number, vx: number, vy: number, timeMs: number): void {
    this.pending.delete(id);
    this.bounceOrigins.delete(id);
    this.paths.set(id, { sequence: 0, points: [] });
    this.append(id, x, y, vx, vy, timeMs, true);
  }

  append(id: number, x: number, y: number, vx: number, vy: number, timeMs: number,
    breakBefore = false, bounceSequence?: number): void {
    const path = this.paths.get(id);
    if (!path || ![x, y, vx, vy, timeMs].every(Number.isFinite)) return;
    const origin = this.bounceOrigins.get(id);
    if (breakBefore) this.bounceOrigins.delete(id);
    else if (origin && bounceSequence === undefined) {
      if (timeMs <= origin.timeMs + 1e-6
        || Math.hypot(x - origin.x, y - origin.y) < 1e-6) return;
      this.bounceOrigins.delete(id);
    }
    const last = path.points[path.points.length - 1];
    timeMs = Math.max(timeMs, last?.timeMs ?? timeMs);
    if (last && last.x === x && last.y === y && last.vx === vx && last.vy === vy
      && !breakBefore && bounceSequence === undefined) return;
    const before = path.points[path.points.length - 2];
    if (before && last && !last.breakBefore && last.bounceSequence === undefined && !breakBefore
      && bounceSequence === undefined && last.vx === vx && last.vy === vy) {
      const dt1 = last.timeMs - before.timeMs, dt2 = timeMs - last.timeMs;
      if (dt1 > 0 && dt2 > 0
        && Math.abs((last.x - before.x) / dt1 - (x - last.x) / dt2) < 1e-8
        && Math.abs((last.y - before.y) / dt1 - (y - last.y) / dt2) < 1e-8) path.points.pop();
    }
    path.points.push({ sequence: ++path.sequence, timeMs, x, y, vx, vy,
      ...(breakBefore ? { breakBefore: true } : {}),
      ...(bounceSequence === undefined ? {} : { bounceSequence }) });
    this.trim(path, timeMs);
  }

  private trim(path: { points: ProjectilePathPoint[] }, timeMs: number): void {
    while (path.points.length > PROJECTILE_PATH_MAX_POINTS
      || (path.points.length > 1 && path.points[1].timeMs <= timeMs - PROJECTILE_PATH_HISTORY_MS)) {
      path.points.shift();
    }
    const first = path.points[0], next = path.points[1];
    const cutoff = timeMs - PROJECTILE_PATH_HISTORY_MS;
    if (first?.timeMs < cutoff && (!next || next.breakBefore)) {
      if (next) path.points.shift();
      else path.points[0] = { ...first, timeMs: cutoff, breakBefore: true, bounceSequence: undefined };
    }
    if (next && first.timeMs < cutoff && next.timeMs > cutoff && !next.breakBefore) {
      const t = (cutoff - first.timeMs) / (next.timeMs - first.timeMs);
      path.points[0] = { ...first, timeMs: cutoff, x: first.x + (next.x - first.x) * t,
        y: first.y + (next.y - first.y) * t, breakBefore: true, bounceSequence: undefined };
    }
  }

  read(id: number, timeMs: number, ended = false): ProjectileFlightPath | undefined {
    const path = this.paths.get(id);
    if (path) this.trim(path, timeMs);
    return path ? { timeMs, points: path.points.slice(), ...(ended ? { ended: true } : {}) } : undefined;
  }

  remove(id: number): void { this.paths.delete(id); this.pending.delete(id); this.bounceOrigins.delete(id); }
  clear(): void { this.paths.clear(); this.pending.clear(); this.bounceOrigins.clear(); }
}

export interface ProjectileTrailSegment {
  readonly from: ProjectilePathPoint;
  readonly to: ProjectilePathPoint;
  /** Age at the end of the segment in the consuming presentation clock. */
  readonly ageMs: number;
}

/** Incremental path consumption, including partial segments during client interpolation. */
export class ProjectilePathCursor {
  private sequence = 0;
  private timeMs = -Infinity;
  consume(path: ProjectileFlightPath, presentationTime: number,
    sink: (segment: ProjectileTrailSegment) => void): void {
    const points = path.points;
    const first = points[0];
    if (first && this.sequence > 0 && first.sequence > this.sequence && first.timeMs <= presentationTime) {
      // A bounded history may have lost the bridge to the last consumed point.
      // Reset material carry; never invent geometry across that missing interval.
      const start = { ...first, breakBefore: true };
      sink({ from: start, to: start, ageMs: Math.max(0, presentationTime - first.timeMs) });
      this.sequence = first.sequence; this.timeMs = first.timeMs;
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (b.timeMs < this.timeMs) continue;
      if (b.sequence < this.sequence || (b.sequence === this.sequence && this.timeMs >= b.timeMs)) continue;
      if (a.timeMs > presentationTime) break;
      const endTime = Math.min(presentationTime, b.timeMs);
      const startTime = Math.max(a.timeMs, this.timeMs);
      if (b.breakBefore && b.timeMs <= presentationTime) sink({ from: b, to: b, ageMs: Math.max(0, presentationTime - b.timeMs) });
      if (!b.breakBefore && (endTime > startTime || b.timeMs === a.timeMs)) {
        const duration = b.timeMs - a.timeMs;
        const pointAt = (timeMs: number): ProjectilePathPoint => {
          const t = duration > 0 ? Math.max(0, Math.min(1, (timeMs - a.timeMs) / duration)) : 1;
          return { ...a, timeMs, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
            breakBefore: undefined, bounceSequence: undefined };
        };
        sink({ from: startTime === a.timeMs ? a : pointAt(startTime),
          to: endTime === b.timeMs ? b : pointAt(endTime), ageMs: Math.max(0, presentationTime - endTime) });
      }
      this.sequence = b.sequence;
      this.timeMs = endTime;
      if (endTime < b.timeMs) break;
    }
  }
}

/** Distance carry is per visual consumer, never shared between smoke, fire and light. */
export class ProjectileTrailSampler {
  private carry = 0;
  reset(): void { this.carry = 0; }
  sample(segment: ProjectileTrailSegment, spacing: number, budget: number,
    sink: (x: number, y: number, nx: number, ny: number, ageMs: number) => void): void {
    const { from, to } = segment;
    if (to.breakBefore) { this.reset(); return; }
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    if (length < 0.001 || budget <= 0) return;
    spacing = Math.max(0.5, spacing);
    const available = Math.floor((this.carry + length) / spacing);
    const count = Math.min(available, Math.floor(budget));
    const first = spacing - this.carry;
    for (let i = 0; i < count; i++) {
      // Overload spreads the reduced material over the whole actual segment.
      const distance = available > count ? length * (i + 0.5) / count : first + i * spacing;
      const t = Math.min(1, distance / length);
      sink(from.x + dx * t, from.y + dy * t, dx / length, dy / length,
        segment.ageMs + (to.timeMs - from.timeMs) * (1 - t));
    }
    this.carry = (this.carry + length) % spacing;
  }
}

export function sampleProjectilePath(path: ProjectileFlightPath, timeMs: number): ProjectilePathPoint | undefined {
  const points = path.points;
  if (!points.length) return undefined;
  let previous = points[0];
  for (let i = 1; i < points.length; i++) {
    const next = points[i];
    if (next.timeMs > timeMs) {
      if (next.breakBefore || previous.timeMs >= timeMs) return previous;
      const t = (timeMs - previous.timeMs) / (next.timeMs - previous.timeMs);
      const dx = next.x - previous.x, dy = next.y - previous.y;
      const duration = (next.timeMs - previous.timeMs) / 1000;
      return { ...previous, timeMs, x: previous.x + dx * t, y: previous.y + dy * t,
        vx: dx / duration, vy: dy / duration };
    }
    previous = next;
  }
  return previous;
}
