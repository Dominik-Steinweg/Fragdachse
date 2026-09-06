import type * as Phaser from 'phaser';
import type { TracerConfig } from '../types';
import { resolveFlightSignature, type FlightSignatureTuning } from '../projectile/FlightSignature';
import { ProjectileTrailSampler, type ProjectileTrailSegment } from '../projectile/ProjectileFlightPath';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GPU_VFX_NO_SOURCE_HANDLE, type GpuVfxSystem } from './gpu/GpuVfxSystem';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import { emissiveAlpha } from './EmissiveScale';

interface FlightVisual { tuning: FlightSignatureTuning; color: number; energy: boolean; pressureSampler: ProjectileTrailSampler }
interface PendingSegment { visual: FlightVisual; segment: ProjectileTrailSegment; queuedAt: number; generation: number; pressure: boolean }
interface PendingMote { x: number; y: number; nx: number; ny: number; color: number;
  tuning: FlightSignatureTuning; releaseAt: number; energy: boolean; generation: number }
const MAX_PENDING_SEGMENTS = 8192;

/** Immutable historical segments; subsequent animation belongs to the shared GPU pool. */
export class TracerRenderer {
  private readonly visuals = new Map<number, FlightVisual>();
  private readonly pending: PendingSegment[] = [];
  private readonly pendingMotes: PendingMote[] = [];
  private pendingCursor = 0;
  private system: GpuVfxSystem | null = null;
  private core: GpuVfxSpawnSpec | null = null;
  private wake: GpuVfxSpawnSpec | null = null;
  private mote: GpuVfxSpawnSpec | null = null;
  private pressure: GpuVfxSpawnSpec | null = null;
  private source = GPU_VFX_NO_SOURCE_HANDLE;

  constructor(_scene: Phaser.Scene) {}
  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.system) return;
    this.system = system;
    this.core = system.createSpec(GpuVfxEffectId.FlightCore);
    this.wake = system.createSpec(GpuVfxEffectId.FlightWake);
    this.mote = system.createSpec(GpuVfxEffectId.FlightMote);
    this.pressure = system.createSpec(GpuVfxEffectId.FlightPressure);
    this.source = system.createSource(GpuVfxEffectId.FlightCore);
    system.registerEmission((_delta, now) => this.emitPending(now));
  }
  createTracer(id: number, _x: number, _y: number, config: TracerConfig, color: number): void {
    if (this.visuals.has(id)) return;
    this.visuals.set(id, { tuning: resolveFlightSignature(config), color: config.color ?? color,
      energy: config.profile === 'highEnergy', pressureSampler: new ProjectileTrailSampler() });
  }
  addSegment(id: number, segment: ProjectileTrailSegment, pressure = false): void {
    const visual = this.visuals.get(id), system = this.system;
    if (!visual || !system || system.isSuppressed()) return;
    if (segment.to.breakBefore) { visual.pressureSampler.reset(); return; }
    if (Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) < 0.01) return;
    const pending = { visual, segment, queuedAt: system.now(), generation: system.emissionGeneration, pressure };
    if (this.pending.length < MAX_PENDING_SEGMENTS) this.pending.push(pending);
    else { this.pending[this.pendingCursor] = pending; this.pendingCursor = (this.pendingCursor + 1) % MAX_PENDING_SEGMENTS; }
  }
  private emitPending(now: number): void {
    // Across all projectiles, essential geometry is admitted before decorative material.
    for (const pending of this.pending) this.emitSegment(pending, now, false);
    for (const pending of this.pending) this.emitSegment(pending, now, true);
    for (const pending of this.pending) this.emitPressure(pending, now);
    this.pending.length = 0;
    this.pendingCursor = 0;
    let retained = 0;
    for (const mote of this.pendingMotes) {
      if (mote.generation !== this.system!.emissionGeneration) continue;
      if (now < mote.releaseAt) this.pendingMotes[retained++] = mote;
      else this.emitMote(mote, now);
    }
    this.pendingMotes.length = retained;
  }
  private emitSegment(pending: PendingSegment, now: number, decoration: boolean): void {
    const system = this.system!;
    if (pending.generation !== system.emissionGeneration) return;
    const { visual, segment, queuedAt } = pending;
    const { tuning: t, color } = visual;
    const dx = segment.to.x - segment.from.x, dy = segment.to.y - segment.from.y;
    const length = Math.hypot(dx, dy), nx = dx / length, ny = dy / length;
    const duration = Math.max(0, segment.to.timeMs - segment.from.timeMs);
    const speed = duration > 0 ? length * 1000 / duration : Math.hypot(segment.to.vx, segment.to.vy);
    const response = Math.max(0.45, Math.min(2.5, 1 + (speed / 1000 - 1) * t.speedResponse));
    const hotMs = Math.max(18, Math.min(260, t.coreLength * response * 1000 / Math.max(100, speed)));
    const ageMs = segment.ageMs + Math.max(0, now - queuedAt);
    const factor = system.quality.getFactor('standard');
    const spec = decoration ? this.wake! : this.core!;
    if (decoration && factor <= 0) return;
    const lifetime = decoration ? hotMs + t.wakePersistence * factor : hotMs;
    if (ageMs >= lifetime) return;
    // A coalesced history can be much older than the effect. Keep its recent end even if
    // its original midpoint has expired (late join / packet-loss healing).
    const startFraction = duration > 0 ? Math.max(0, 1 - (lifetime - ageMs) / duration) : 0;
    const visibleLength = length * (1 - startFraction);
    const visibleDuration = duration * (1 - startFraction);
    // Subdivide only this physical segment. No chord can cross a corner.
    const count = decoration ? Math.max(1, Math.min(12, Math.ceil(visibleLength / 14)))
      : Math.max(1, Math.min(4, Math.ceil(visibleDuration / 32)));
    for (let i = 0; i < count; i++) {
      const u = startFraction + (1 - startFraction) * (i + 0.5) / count;
      const sampleAge = ageMs + duration * (1 - u);
      const width = t.coreWidth / Math.sqrt(response), piece = visibleLength / count;
      spec.lifeMs = lifetime;
      if (sampleAge >= spec.lifeMs) continue;
      spec.x = segment.from.x + dx * u; spec.y = segment.from.y + dy * u;
      spec.rotation = Math.atan2(dy, dx);
      spec.scaleStart = (decoration ? width * 1.3 : width) / 4;
      spec.scaleEnd = decoration ? (width * 1.3 + t.wakeSpread * factor) / 4 : spec.scaleStart;
      // Butt-ended core strips meet at the recorded vertices without extending past a bounce.
      const frameWidth = decoration ? 24 : 1;
      spec.stretchStart = piece / (frameWidth * spec.scaleStart);
      spec.stretchEnd = piece / (frameWidth * spec.scaleEnd);
      spec.scaleEase = decoration ? GpuVfxEase.CubicIn : GpuVfxEase.Linear;
      spec.alphaStart = emissiveAlpha(t.coreIntensity * (decoration ? 0.23 * factor : 0.95));
      spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.QuadOut;
      spec.tint = color; spec.tintBlendStart = decoration ? 0.65 : 1 - t.heatContrast; spec.tintBlendEnd = 1;
      const wave = Math.sin((segment.from.sequence + u) * 1.73) * t.wakeTurbulence;
      const spread = decoration ? wave * t.wakeSpread * factor : 0;
      spec.vx = -ny * spread * 1000 / spec.lifeMs; spec.vy = nx * spread * 1000 / spec.lifeMs;
      spec.positionEase = GpuVfxEase.CubicIn;
      system.spawn(spec, this.source, now, sampleAge);
      if (decoration && this.pendingMotes.length < 256
        && system.quality.scaleBurst(GpuVfxEffectId.FlightMote, t.moteAmount)) {
        this.pendingMotes.push({ x: spec.x, y: spec.y, nx, ny, color, tuning: t,
          releaseAt: now - sampleAge + hotMs, energy: visual.energy, generation: system.emissionGeneration });
      }
    }
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
  destroyTracer(id: number): void { this.visuals.delete(id); }
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
