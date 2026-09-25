import type { ProjectileTrailSegment } from '../../projectile/ProjectileFlightPath';
import type { FogImpulse } from './FogImpulses';
import { FOG, type FogFrame, type FogRect } from './FogConfig';

export interface FogTrailProfile { radius: number; strength: number; lifeMs: number; decayMs: number; arcDegrees?: number }
interface Trace {
  input: FogImpulse; at: number; endAt: number; startRadius: number; endRadius: number;
  startCap: boolean; endCap: boolean;
  lifeMs: number; decayMs: number; source?: number | string; sourceStart?: number; sourceEnd?: number;
}
const pack = (data: Uint8Array, offset: number, n: number): void => {
  n = Math.max(0, Math.min(65535, Math.round(n))); data[offset] = n >> 8; data[offset + 1] = n & 255;
};
const DEFAULT_PROFILE: FogTrailProfile = { radius: FOG.trailRadius, strength: FOG.smallProjectileStrength, lifeMs: FOG.trailMs, decayMs: FOG.trailDecayMs };
const CORNERS = [0, 1, 2, 2, 1, 3];

/** Bounded confirmed paths. GPU rasterization has no per-tile truncation or per-pixel search. */
export class FogTrailSegments {
  readonly commands = new Uint8Array(FOG.trailCapacity * 5 * 4);
  private readonly slots: (Trace | undefined)[] = Array(FOG.trailCapacity);
  private readonly tails = new Map<number | string, number>();
  private cursor = 0;
  version = 0;
  dropped = 0;
  size = 0;
  constructor(private readonly frame: FogFrame) {}
  add(input: FogImpulse, now: number, profile: FogTrailProfile = { ...DEFAULT_PROFILE, radius: input.radius, strength: input.strength }): void {
    this.insert({ input: { ...input }, at: now, endAt: now, startRadius: profile.radius, endRadius: profile.radius,
      startCap: true, endCap: true, lifeMs: profile.lifeMs, decayMs: profile.decayMs }, now);
  }
  addPath(segment: ProjectileTrailSegment, source: number | string, now: number, profile: FogTrailProfile = DEFAULT_PROFILE): void {
    const { from, to } = segment;
    if (to.breakBefore || from === to) { this.tails.delete(source); return; }
    const dx = to.x - from.x, dy = to.y - from.y;
    if (!Number.isFinite(dx + dy + from.timeMs + to.timeMs + segment.ageMs + profile.radius)) return;
    const index = this.tails.get(source), before = index === undefined ? undefined : this.slots[index];
    const connected = before && !from.breakBefore
      && Math.abs(from.timeMs - before.sourceEnd!) < .01
      && Math.hypot(from.x - before.input.endX, from.y - before.input.endY) < .1
      && before.lifeMs === profile.lifeMs && before.decayMs === profile.decayMs;
    if (Math.hypot(dx, dy) < .001) {
      // Time without travel still continues the path. Host paths can alternate time-only and
      // zero-duration samples; dropping the former would split every step into feathered beads.
      if (connected) before.sourceEnd = Math.max(before.sourceEnd!, to.timeMs);
      return;
    }
    const startRadius = connected ? before.endRadius : profile.radius;
    if (connected && from.bounceSequence === undefined && to.timeMs - before.sourceStart! <= 1000) {
      const ax = before.input.endX - before.input.x, ay = before.input.endY - before.input.y;
      const duration = to.timeMs - before.sourceStart!;
      const radiusAtJoin = before.startRadius + (profile.radius - before.startRadius) * (from.timeMs - before.sourceStart!) / Math.max(1, duration);
      if (ax * dx + ay * dy > 0 && Math.abs(ax * dy - ay * dx) <= Math.hypot(ax, ay) * Math.hypot(dx, dy) * .001
        && Math.abs(radiusAtJoin - before.endRadius) < .5) {
        before.input.endX = to.x; before.input.endY = to.y; before.endRadius = profile.radius;
        // Source presentation time can outrun our capped 30Hz clock after a long frame.
        // Anchor the newly observed tip to fog time so it never wraps into a future age.
        before.endAt = Math.max(before.at, now - segment.ageMs); before.sourceEnd = to.timeMs;
        this.encode(index!, before); return;
      }
    }
    // End feathers belong to the continuous path, never to a batch boundary or bounce pivot.
    if (connected && before.endCap) { before.endCap = false; this.version++; }
    const endAt = now - segment.ageMs, at = endAt - Math.max(0, to.timeMs - from.timeMs);
    this.insert({ input: { x: from.x, y: from.y, endX: to.x, endY: to.y, radius: profile.radius,
      strength: profile.strength, kind: profile.arcDegrees ? 'melee' : 'projectile', arcDegrees: profile.arcDegrees, priority: 10 }, at, endAt, startRadius, endRadius: profile.radius,
      startCap: !connected, endCap: true,
      lifeMs: profile.lifeMs, decayMs: profile.decayMs, source, sourceStart: from.timeMs, sourceEnd: to.timeMs }, now);
  }
  private remove(index: number): void {
    const slot = this.slots[index]; if (!slot) return;
    if (slot.source !== undefined && this.tails.get(slot.source) === index) this.tails.delete(slot.source);
    this.slots[index] = undefined; this.size--; this.version++;
  }
  private insert(trace: Trace, now: number): void {
    // Reuse expired holes before ever replacing a still-visible path (e.g. a longer train wake).
    let index = this.cursor;
    for (let i = 0; i < FOG.trailCapacity; i++) {
      const candidate = (this.cursor + i) % FOG.trailCapacity, old = this.slots[candidate];
      if (!old || now - old.endAt >= old.lifeMs) { index = candidate; break; }
    }
    const old = this.slots[index]; if (old && now - old.endAt < old.lifeMs) this.dropped++;
    this.remove(index); this.slots[index] = trace; this.size++;
    if (trace.source !== undefined) this.tails.set(trace.source, index);
    this.cursor = (index + 1) % FOG.trailCapacity; this.encode(index, trace);
  }
  private encode(index: number, trace: Trace): void {
    const stride = FOG.trailTextureWidth * 4;
    const base = Math.floor(index / FOG.trailTextureWidth) * stride * 5 + index % FOG.trailTextureWidth * 4;
    const p = trace.input, f = this.frame;
    pack(this.commands, base, (p.x - f.offsetX) / f.width * 65535); pack(this.commands, base + 2, (p.y - f.offsetY) / f.height * 65535);
    pack(this.commands, base + stride, (p.endX - f.offsetX) / f.width * 65535); pack(this.commands, base + stride + 2, (p.endY - f.offsetY) / f.height * 65535);
    // Never round a birth timestamp into the future: modulo age would turn it into 60s.
    pack(this.commands, base + stride * 2, Math.floor(((trace.at % 60000) + 60000) % 60000));
    pack(this.commands, base + stride * 2 + 2, Math.floor(((trace.endAt % 60000) + 60000) % 60000));
    this.commands[base + stride * 3] = Math.round(p.strength * 255);
    pack(this.commands, base + stride * 3 + 1, trace.lifeMs);
    this.commands[base + stride * 3 + 3] = Math.round(trace.decayMs / trace.lifeMs * 255);
    pack(this.commands, base + stride * 4, trace.startRadius * 16); pack(this.commands, base + stride * 4 + 2, trace.endRadius * 16);
    this.version++;
  }
  prepare(now: number): void {
    for (let i = 0; i < FOG.trailCapacity; i++) {
      const trace = this.slots[i]; if (trace && now - trace.endAt >= trace.lifeMs) this.remove(i);
    }
  }
  /** Six vertices per visible capsule, world anchored and tightly aligned to its direction.
   * `blur` is the shader's resolution footprint in world px, which widens every capsule. */
  writeVertices(data: Float32Array, view: FogRect, includeProjectiles = true, blur = 0): number {
    let offset = 0;
    for (let index = 0; index < FOG.trailCapacity; index++) {
      const trace = this.slots[index]; if (!trace || (!includeProjectiles && trace.input.kind !== 'melee')) continue;
      const p = trace.input, radius = Math.hypot(Math.max(trace.startRadius, trace.endRadius), blur) * FOG.trailEdgeExtent + 1;
      if (Math.max(p.x, p.endX) + radius < view.x || Math.min(p.x, p.endX) - radius > view.x + view.width
        || Math.max(p.y, p.endY) + radius < view.y || Math.min(p.y, p.endY) - radius > view.y + view.height) continue;
      const length = Math.hypot(p.endX - p.x, p.endY - p.y);
      const dx = length > .001 ? (p.endX - p.x) / length : 1, dy = length > .001 ? (p.endY - p.y) / length : 0;
      for (const corner of CORNERS) {
        const end = corner >= 2, side = corner % 2 ? 1 : -1, along = end ? radius : -radius;
        data[offset++] = (end ? p.endX : p.x) + dx * along - dy * radius * side - this.frame.offsetX;
        data[offset++] = (end ? p.endY : p.y) + dy * along + dx * radius * side - this.frame.offsetY;
        data[offset++] = index;
        // Arc occupies 0..360; the upper two bits mark the true path ends for the shader.
        data[offset++] = (p.arcDegrees ?? 0) + (Number(trace.startCap) + Number(trace.endCap) * 2) * 512;
      }
    }
    return offset / 4;
  }
  clear(): void { this.slots.fill(undefined); this.tails.clear(); this.size = 0; this.version++; }
}
