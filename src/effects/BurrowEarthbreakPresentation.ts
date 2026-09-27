import { BURROW_EARTHBREAK } from '../config/burrowEarthbreak';
import { BURROW_FX } from '../config/burrowEffects';
import type { SyncedBurrowEarthbreak } from '../systems/BurrowEarthbreakRuntime';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { createGpuVfxMemberHandle, type GpuVfxMemberHandle, type GpuVfxSystem } from './gpu/GpuVfxSystem';

interface TraceView { snapshot: SyncedBurrowEarthbreak; played: number; }
interface CrackView { handles: GpuVfxMemberHandle[]; renewAt: number; }

/** Replica-only timeline and bounded GPU geometry. A missing particle never changes a hit. */
export class BurrowEarthbreakPresentation {
  private readonly traces = new Map<number, TraceView>();
  private readonly cracks = new Map<string, CrackView>();
  private readonly spec;
  private readonly source: number;
  private initial = true;
  private clockOffset = 0;

  constructor(private readonly gpu: GpuVfxSystem,
    private readonly burst: (x: number, y: number, emergence: boolean, ageMs: number) => void) {
    this.spec = gpu.createSpec(GpuVfxEffectId.BurrowCrack);
    this.source = gpu.createSource(GpuVfxEffectId.BurrowCrack);
  }

  sync(snapshots: readonly SyncedBurrowEarthbreak[], hostNow: number, host = false): void {
    this.clockOffset = hostNow - this.gpu.now();
    const seen = new Set<number>();
    for (const snapshot of snapshots) {
      seen.add(snapshot.id);
      const old = this.traces.get(snapshot.id);
      if (old) old.snapshot = snapshot;
      else this.traces.set(snapshot.id, { snapshot,
        played: this.initial && !host ? this.dueCount(snapshot, hostNow) : 0 });
    }
    for (const id of this.traces.keys()) if (!seen.has(id)) this.traces.delete(id);
    this.initial = false;
  }

  private dueCount(s: SyncedBurrowEarthbreak, now: number): number {
    return s.detonatedAt === null || now < s.detonatedAt ? 0
      : Math.min(s.points.length + 1, 1 + Math.floor((now - s.detonatedAt) / BURROW_EARTHBREAK.intervalMs));
  }

  update(gpuNow: number, isVisible: (x: number, y: number) => boolean): void {
    const hostNow = gpuNow + this.clockOffset;
    const wanted = new Set<string>();
    for (const { snapshot: s } of this.traces.values()) {
      for (let i = s.points.length - 1; i >= 0 && wanted.size < BURROW_FX.earthbreak.maxVisibleCracks; i--) {
        const p = s.points[i];
        const due = s.detonatedAt === null ? Infinity : s.detonatedAt + (s.points.length - i) * BURROW_EARTHBREAK.intervalMs;
        if (hostNow >= due || !isVisible(p.x, p.y)) continue;
        const key = `${s.id}:${i}`;
        wanted.add(key);
        const existing = this.cracks.get(key);
        if (existing && gpuNow < existing.renewAt) continue;
        if (existing) this.release(existing);
        const previous = s.points[Math.max(0, i - 1)] ?? p;
        const heading = Math.atan2(p.y - previous.y, p.x - previous.x);
        this.cracks.set(key, this.drawCrack(p.x, p.y, heading, s.id * 31 + i, gpuNow));
      }
    }
    for (const [key, crack] of this.cracks) if (!wanted.has(key)) { this.release(crack); this.cracks.delete(key); }
    for (const view of this.traces.values()) {
      const s = view.snapshot, due = this.dueCount(s, hostNow);
      while (view.played < due) {
        const index = view.played++;
        const point = index === 0 ? s.exit : s.points[s.points.length - index];
        const age = hostNow - (s.detonatedAt! + index * BURROW_EARTHBREAK.intervalMs);
        if (point && age <= BURROW_FX.earthbreak.maxReplayAgeMs && isVisible(point.x, point.y))
          this.burst(point.x, point.y, index === 0, Math.max(0, age));
      }
    }
  }

  private drawCrack(x: number, y: number, heading: number, seed: number, now: number): CrackView {
    const handles: GpuVfxMemberHandle[] = [];
    const spec = this.spec;
    const bend = Math.sin(seed * 2.399) * 4;
    const vertices = [[-12, 0], [-4, bend], [4, -bend], [12, 0]];
    const segments = [[...vertices[0], ...vertices[1]], [...vertices[1], ...vertices[2]],
      [...vertices[2], ...vertices[3]], [-4, bend, -8, bend + 8], [4, -bend, 8, -bend - 7]];
    const cos = Math.cos(heading), sin = Math.sin(heading);
    spec.lifeMs = BURROW_FX.earthbreak.crackLifeMs;
    spec.alphaStart = spec.alphaEnd = 0.95;
    spec.frame = GpuVfxFrameId.FlightCoreStrip;
    for (const [ax, ay, bx, by] of segments) {
      spec.x = x + (ax + bx) / 2 * cos - (ay + by) / 2 * sin;
      spec.y = y + (ax + bx) / 2 * sin + (ay + by) / 2 * cos;
      spec.rotation = heading + Math.atan2(by - ay, bx - ax);
      const length = Math.hypot(bx - ax, by - ay);
      for (const rim of [true, false]) {
        spec.scaleStart = spec.scaleEnd = rim ? 0.65 : 0.3;
        spec.stretchStart = spec.stretchEnd = (length + 1) / spec.scaleStart;
        spec.tint = rim ? BURROW_FX.earthbreak.rimTint : BURROW_FX.earthbreak.coreTint;
        const handle = createGpuVfxMemberHandle();
        if (this.gpu.spawn(spec, this.source, now, 0, handle)) handles.push(handle);
      }
    }
    spec.frame = GpuVfxFrameId.LeafBlowerClod;
    spec.scaleStart = spec.scaleEnd = 0.22;
    spec.stretchStart = spec.stretchEnd = 1.3;
    spec.tint = BURROW_FX.earthTint;
    for (const side of [-1, 1]) {
      spec.x = x - sin * side * 5; spec.y = y + cos * side * 5;
      spec.rotation = seed + side;
      const handle = createGpuVfxMemberHandle();
      if (this.gpu.spawn(spec, this.source, now, 0, handle)) handles.push(handle);
    }
    return { handles, renewAt: now + spec.lifeMs };
  }

  private release(crack: CrackView): void { for (const handle of crack.handles) this.gpu.releaseMember(handle); }
  /** Rendering pauses consume the timeline without replaying hidden hits when visibility returns. */
  hide(gpuNow: number): void {
    for (const crack of this.cracks.values()) this.release(crack);
    this.cracks.clear();
    for (const view of this.traces.values()) view.played = this.dueCount(view.snapshot, gpuNow + this.clockOffset);
  }
  clear(): void {
    for (const crack of this.cracks.values()) this.release(crack);
    this.cracks.clear(); this.traces.clear(); this.initial = true;
    this.gpu.clearSource(this.source);
  }
  destroy(): void { this.clear(); this.gpu.releaseSource(this.source); }
}
