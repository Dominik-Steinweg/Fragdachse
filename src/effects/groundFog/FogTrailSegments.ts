import type { ProjectileTrailSegment } from '../../projectile/ProjectileFlightPath';
import type { FogImpulse } from './FogImpulses';
import { FOG, type FogFrame } from './FogConfig';

const pack = (data: Uint8Array, offset: number, n: number): void => {
  n = Math.max(0, Math.min(65535, Math.round(n))); data[offset] = n >> 8; data[offset + 1] = n & 255;
};
interface Trace {
  input: FogImpulse; at: number; endAt: number;
  source?: number; sourceStart?: number; sourceEnd?: number;
}

/** Only bin tiles actually touched by the capsule, not its entire diagonal bounding box. */
function intersects(p: FogImpulse, left: number, top: number, right: number, bottom: number): boolean {
  let first = 0, last = 1;
  const dx = p.endX - p.x, dy = p.endY - p.y;
  if (Math.abs(dx) < 1e-8) { if (p.x < left || p.x > right) return false; }
  else {
    const a = (left - p.x) / dx, b = (right - p.x) / dx;
    first = Math.max(first, Math.min(a, b)); last = Math.min(last, Math.max(a, b));
  }
  if (Math.abs(dy) < 1e-8) { if (p.y < top || p.y > bottom) return false; }
  else {
    const a = (top - p.y) / dy, b = (bottom - p.y) / dy;
    first = Math.max(first, Math.min(a, b)); last = Math.min(last, Math.max(a, b));
  }
  return first <= last;
}

/** Bounded confirmed geometry. Distance, continuous along-path age and fading remain on the GPU. */
export class FogTrailSegments {
  readonly commands = new Uint8Array(FOG.trailCapacity * 4 * 4);
  readonly bins: Uint8Array;
  readonly columns: number;
  readonly binsHeight: number;
  private readonly slots: (Trace | undefined)[] = Array(FOG.trailCapacity);
  private readonly tails = new Map<number, number>();
  private cursor = 0;
  dropped = 0;
  tileOverflow = 0;
  size = 0;
  constructor(private readonly frame: FogFrame) {
    this.columns = Math.ceil(frame.width / FOG.trailTile);
    this.binsHeight = Math.ceil(this.columns * Math.ceil(frame.height / FOG.trailTile) * FOG.trailsPerTile / 1024);
    this.bins = new Uint8Array(1024 * this.binsHeight * 4);
  }
  add(input: FogImpulse, now: number): void { this.insert({ input: { ...input }, at: now, endAt: now }, now); }
  addPath(segment: ProjectileTrailSegment, source: number, now: number): void {
    const { from, to } = segment;
    if (to.breakBefore || from === to) { this.tails.delete(source); return; }
    const dx = to.x - from.x, dy = to.y - from.y;
    if (!Number.isFinite(dx + dy + from.timeMs + to.timeMs + segment.ageMs) || Math.hypot(dx, dy) < .001) return;
    const index = this.tails.get(source), before = index === undefined ? undefined : this.slots[index];
    if (before && !from.breakBefore && from.bounceSequence === undefined
      && Math.abs(from.timeMs - before.sourceEnd!) < .01
      && Math.hypot(from.x - before.input.endX, from.y - before.input.endY) < .1
      && to.timeMs - before.sourceStart! <= 1000) {
      const ax = before.input.endX - before.input.x, ay = before.input.endY - before.input.y;
      if (ax * dx + ay * dy > 0 && Math.abs(ax * dy - ay * dx) <= Math.hypot(ax, ay) * Math.hypot(dx, dy) * .001) {
        before.input.endX = to.x; before.input.endY = to.y;
        before.endAt = before.at + to.timeMs - before.sourceStart!; before.sourceEnd = to.timeMs;
        return;
      }
    }
    const endAt = now - segment.ageMs, at = endAt - Math.max(0, to.timeMs - from.timeMs);
    this.insert({ input: { x: from.x, y: from.y, endX: to.x, endY: to.y, radius: 4,
      strength: FOG.smallProjectileStrength, kind: 'projectile', priority: 10 },
      at, endAt, source, sourceStart: from.timeMs, sourceEnd: to.timeMs }, now);
  }
  private remove(index: number): void {
    const slot = this.slots[index];
    if (slot?.source !== undefined && this.tails.get(slot.source) === index) this.tails.delete(slot.source);
    this.slots[index] = undefined;
  }
  private insert(trace: Trace, now: number): void {
    if (this.slots[this.cursor] && now - this.slots[this.cursor]!.endAt < FOG.trailMs) this.dropped++;
    this.remove(this.cursor); this.slots[this.cursor] = trace;
    if (trace.source !== undefined) this.tails.set(trace.source, this.cursor);
    this.cursor = (this.cursor + 1) % FOG.trailCapacity;
  }
  prepare(now: number): void {
    this.bins.fill(0); this.size = 0; this.tileOverflow = 0;
    const rows = Math.ceil(this.frame.height / FOG.trailTile), counts = new Uint8Array(this.columns * rows);
    for (let order = 0; order < FOG.trailCapacity; order++) {
      const index = (this.cursor - 1 - order + FOG.trailCapacity) % FOG.trailCapacity;
      const slot = this.slots[index]; if (!slot) continue;
      if (now - slot.endAt >= FOG.trailMs) { this.remove(index); continue; }
      this.size++; const p = slot.input, f = this.frame, stride = FOG.trailCapacity * 4;
      pack(this.commands, index * 4, (p.x - f.offsetX) / f.width * 65535);
      pack(this.commands, index * 4 + 2, (p.y - f.offsetY) / f.height * 65535);
      pack(this.commands, stride + index * 4, (p.endX - f.offsetX) / f.width * 65535);
      pack(this.commands, stride + index * 4 + 2, (p.endY - f.offsetY) / f.height * 65535);
      pack(this.commands, stride * 2 + index * 4, ((slot.at % 60000) + 60000) % 60000);
      pack(this.commands, stride * 2 + index * 4 + 2, ((slot.endAt % 60000) + 60000) % 60000);
      this.commands[stride * 3 + index * 4] = Math.round(p.strength * 255);
      const r = FOG.trailRadius;
      const x0 = Math.max(0, Math.floor((Math.min(p.x, p.endX) - f.offsetX - r) / FOG.trailTile));
      const y0 = Math.max(0, Math.floor((Math.min(p.y, p.endY) - f.offsetY - r) / FOG.trailTile));
      const x1 = Math.min(this.columns - 1, Math.floor((Math.max(p.x, p.endX) - f.offsetX + r) / FOG.trailTile));
      const y1 = Math.min(rows - 1, Math.floor((Math.max(p.y, p.endY) - f.offsetY + r) / FOG.trailTile));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const left = f.offsetX + x * FOG.trailTile, top = f.offsetY + y * FOG.trailTile;
        if (!intersects(p, left - r, top - r, left + FOG.trailTile + r, top + FOG.trailTile + r)) continue;
        const tile = y * this.columns + x;
        if (counts[tile] >= FOG.trailsPerTile) { this.tileOverflow++; continue; }
        pack(this.bins, (tile * FOG.trailsPerTile + counts[tile]++) * 4, index + 1);
      }
    }
  }
  clear(): void { this.slots.fill(undefined); this.tails.clear(); this.size = this.tileOverflow = 0; this.bins.fill(0); }
}
