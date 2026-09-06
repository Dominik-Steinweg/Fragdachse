import type * as Phaser from 'phaser';
import type { TracerConfig } from '../types';
import { resolveFlightSignature, type FlightSignatureTuning } from '../projectile/FlightSignature';
import { ProjectileTrailSampler, type ProjectileTrailSegment } from '../projectile/ProjectileFlightPath';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GPU_VFX_NO_SOURCE_HANDLE, type GpuVfxSystem } from './gpu/GpuVfxSystem';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import { flightRibbonResponse, type FlightRibbonHandle } from './gpu/GpuFlightRibbon';
import { emissiveAlpha } from './EmissiveScale';

interface FlightVisual {
  tuning: FlightSignatureTuning; color: number; energy: boolean;
  pressureSampler: ProjectileTrailSampler; moteSampler: ProjectileTrailSampler;
  ribbon: FlightRibbonHandle | null; generation: number; closed: boolean; pending: number;
}
interface PendingSegment { visual: FlightVisual; segment: ProjectileTrailSegment; queuedAt: number; generation: number; pressure: boolean }
interface PendingMote { x: number; y: number; nx: number; ny: number; color: number;
  tuning: FlightSignatureTuning; releaseAt: number; energy: boolean; generation: number }
const MAX_PENDING_SEGMENTS = 8192;

/** Confirmed path consumer; ribbons and particles share the GPU backend's ownership. */
export class TracerRenderer {
  private readonly visuals = new Map<number, FlightVisual>();
  private readonly pending: PendingSegment[] = [];
  private readonly pendingMotes: PendingMote[] = [];
  private pendingCursor = 0;
  private system: GpuVfxSystem | null = null;
  private mote: GpuVfxSpawnSpec | null = null;
  private pressure: GpuVfxSpawnSpec | null = null;
  private source = GPU_VFX_NO_SOURCE_HANDLE;

  constructor(_scene: Phaser.Scene) {}
  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.system) return;
    this.system = system;
    this.mote = system.createSpec(GpuVfxEffectId.FlightMote);
    this.pressure = system.createSpec(GpuVfxEffectId.FlightPressure);
    this.source = system.createSource(GpuVfxEffectId.FlightCore);
    system.registerEmission((_delta, now) => this.emitPending(now));
  }
  createTracer(id: number, _x: number, _y: number, config: TracerConfig, color: number): void {
    if (this.visuals.has(id)) return;
    this.visuals.set(id, { tuning: resolveFlightSignature(config), color: config.color ?? color,
      energy: config.profile === 'highEnergy', pressureSampler: new ProjectileTrailSampler(),
      moteSampler: new ProjectileTrailSampler(), ribbon: null, generation: -1, closed: false, pending: 0 });
  }
  addSegment(id: number, segment: ProjectileTrailSegment, pressure = false): void {
    const visual = this.visuals.get(id), system = this.system;
    if (!visual || !system || system.isSuppressed()) return;
    if (!segment.to.breakBefore && Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) < 0.01) return;
    const pending = { visual, segment, queuedAt: system.now(), generation: system.emissionGeneration, pressure };
    visual.pending++;
    if (this.pending.length < MAX_PENDING_SEGMENTS) this.pending.push(pending);
    else {
      const removed = this.pending[this.pendingCursor].visual;
      removed.pending--;
      if (removed.closed && removed.pending === 0 && removed.ribbon) system.endFlightRibbon(removed.ribbon);
      this.pending[this.pendingCursor] = pending;
      this.pendingCursor = (this.pendingCursor + 1) % MAX_PENDING_SEGMENTS;
    }
  }
  private emitPending(now: number): void {
    const system = this.system!;
    // Restore insertion order after the bounded queue wraps. Missing spans remain gaps.
    const at = (i: number) => this.pending[(i + this.pendingCursor) % this.pending.length];
    for (let i = 0; i < this.pending.length; i++) this.emitRibbon(at(i), now, false);
    for (let i = 0; i < this.pending.length; i++) this.emitRibbon(at(i), now, true);
    for (let i = 0; i < this.pending.length; i++) {
      const pending = at(i), v = pending.visual;
      if (pending.generation === system.emissionGeneration) {
        if (pending.segment.to.breakBefore) { v.pressureSampler.reset(); v.moteSampler.reset(); }
        else { this.emitPressure(pending, now); this.queueMotes(pending, now); }
      }
      v.pending--;
      if (v.closed && v.pending === 0 && v.ribbon) system.endFlightRibbon(v.ribbon);
    }
    this.pending.length = 0; this.pendingCursor = 0;
    let retained = 0;
    for (const mote of this.pendingMotes) {
      if (mote.generation !== system.emissionGeneration) continue;
      if (now < mote.releaseAt) this.pendingMotes[retained++] = mote;
      else this.emitMote(mote, now);
    }
    this.pendingMotes.length = retained;
  }
  private emitRibbon(pending: PendingSegment, now: number, wake: boolean): void {
    const system = this.system!, v = pending.visual;
    if (pending.generation !== system.emissionGeneration) return;
    if (v.generation !== system.emissionGeneration) {
      v.ribbon = null; v.generation = system.emissionGeneration;
      v.pressureSampler.reset(); v.moteSampler.reset();
    }
    if (!v.ribbon) v.ribbon = system.createFlightRibbon(this.source, {
      tuning: v.tuning, color: v.color, emissive: emissiveAlpha(1),
    });
    if (!v.ribbon) return;
    system.appendFlightRibbon(v.ribbon, { ...pending.segment,
      ageMs: pending.segment.ageMs + Math.max(0, now - pending.queuedAt) }, wake);
  }
  private queueMotes(pending: PendingSegment, now: number): void {
    const { visual: v, segment, queuedAt, generation } = pending, system = this.system!;
    if (system.quality.getFactor('decorative') <= 0) return;
    const { hotMs } = flightRibbonResponse(v.tuning, segment.from, Math.hypot(segment.to.vx, segment.to.vy));
    // Reference density is independent of ribbon topology.
    v.moteSampler.sample(segment, 14, 16, (x, y, nx, ny, age) => {
      if (this.pendingMotes.length >= 256 || !system.quality.scaleBurst(GpuVfxEffectId.FlightMote, v.tuning.moteAmount)) return;
      const releaseAt = now - age - Math.max(0, now - queuedAt) + hotMs;
      if (now - releaseAt >= Math.min(180, v.tuning.wakePersistence)) return;
      this.pendingMotes.push({ x, y, nx, ny, color: v.color, tuning: v.tuning, releaseAt, energy: v.energy, generation });
    });
  }
  private emitPressure(pending: PendingSegment, now: number): void {
    const { visual, segment, queuedAt, generation, pressure } = pending;
    const system = this.system!, spec = this.pressure!;
    if (generation !== system.emissionGeneration || (!pressure && !visual.energy)) return;
    visual.pressureSampler.sample(segment, visual.energy ? 100 : 55, 8, (x, y, nx, ny, age) => {
      if (!system.quality.scaleBurst(GpuVfxEffectId.FlightPressure, 1)) {
        system.recordQualityDrop(GpuVfxEffectId.FlightPressure, 2); return;
      }
      for (const side of [-1, 1]) {
        spec.lifeMs = visual.energy ? 140 : 260;
        spec.x = x; spec.y = y;
        spec.vx = -ny * side * (visual.energy ? 90 : 220);
        spec.vy = nx * side * (visual.energy ? 90 : 220);
        spec.positionEase = GpuVfxEase.CubicIn;
        spec.rotation = Math.atan2(ny, nx) + side * 0.25;
        spec.scaleStart = 0.4; spec.scaleEnd = 0.06;
        spec.stretchStart = 3; spec.stretchEnd = 24;
        spec.scaleEase = GpuVfxEase.QuadOut;
        spec.alphaStart = emissiveAlpha(visual.tuning.coreIntensity * 0.16);
        spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.QuadOut;
        spec.tint = visual.color;
        system.spawn(spec, this.source, now, age + Math.max(0, now - queuedAt));
      }
    });
  }
  private emitMote(mote: PendingMote, now: number): void {
    const { x, y, nx, ny, color, tuning: t, energy } = mote;
    const system = this.system!, spec = this.mote!;
    if (system.quality.getFactor('decorative') <= 0) return;
    spec.lifeMs = Math.min(180, t.wakePersistence); spec.x = x; spec.y = y;
    const side = Math.random() < 0.5 ? -1 : 1;
    spec.vx = -ny * side * (energy ? 25 : 12); spec.vy = nx * side * (energy ? 25 : 12);
    spec.positionEase = GpuVfxEase.CubicIn;
    spec.scaleStart = 0.25; spec.scaleEnd = 0.02;
    spec.alphaStart = emissiveAlpha(t.coreIntensity * 0.12); spec.alphaEnd = 0; spec.tint = color;
    system.spawn(spec, this.source, now, Math.max(0, now - mote.releaseAt));
  }
  destroyTracer(id: number): void {
    const visual = this.visuals.get(id);
    if (visual) {
      visual.closed = true;
      // Terminal segments queued in the despawn frame must be appended before closing.
      if (visual.pending === 0 && visual.ribbon) this.system?.endFlightRibbon(visual.ribbon);
    }
    this.visuals.delete(id);
  }
  destroyAll(): void {
    this.visuals.clear(); this.pending.length = 0; this.pendingMotes.length = 0;
    this.pendingCursor = 0;
    this.system?.clearSource(this.source);
    this.system?.quality.resetCarry(GpuVfxEffectId.FlightMote);
    this.system?.quality.resetCarry(GpuVfxEffectId.FlightPressure);
  }
  has(id: number): boolean { return this.visuals.has(id); }
  getActiveIds(): Iterable<number> { return this.visuals.keys(); }
}
