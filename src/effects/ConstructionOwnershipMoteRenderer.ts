import type { WorldViewRect } from '../ui/HostileBaseIndicator';
import type { ConstructionOwnershipTarget } from './ConstructionOwnershipGpuSystem';
import { mixColors } from './EffectUtils';
import { getGpuVfxFrame } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';

interface Track { target: ConstructionOwnershipTarget; nextAt: number; seen: number; }
const EFFECT = GpuVfxEffectId.ConstructionOwnershipMote;

/** One scene registration; captured state and particles belong to the current World scope. */
export class ConstructionOwnershipMoteRenderer {
  private world: object | null = null;
  private readonly retiredWorlds = new WeakSet<object>();
  private readonly tracks = new Map<number, Track>();
  private readonly pending: ConstructionOwnershipTarget[] = [];
  private readonly spec: GpuVfxSpawnSpec;
  private readonly source: number;
  private generation: number;
  private active = false;
  private captured = false;
  private frame = 0;
  private destroyed = false;
  private hasParticles = false;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.spec = gpu.createSpec(EFFECT);
    this.source = gpu.createSource(EFFECT);
    this.generation = gpu.emissionGeneration;
    gpu.registerEmission((_delta, now) => this.emitFrame(now));
  }

  openWorld(scope: object): void {
    if (this.destroyed || this.retiredWorlds.has(scope) || this.world === scope) return;
    if (this.world) this.closeWorld(this.world);
    this.clear(); this.active = false; this.world = scope;
  }

  closeWorld(scope: object): void {
    if (this.world !== scope) return;
    this.clear(); this.active = false; this.world = null;
    this.retiredWorlds.add(scope);
  }

  captureFrame(scope: object, active: boolean, targets: readonly ConstructionOwnershipTarget[], view: WorldViewRect): void {
    if (this.destroyed || this.world !== scope) return;
    const activate = active && !this.active;
    this.active = active;
    const invalidated = this.generation !== this.gpu.emissionGeneration;
    if (invalidated) this.clear();
    if (!active || this.gpu.isSuppressed() || this.source < 0) { this.clear(); return; }
    this.pending.length = 0;
    this.frame++;
    const now = this.gpu.now();
    for (const target of targets) {
      if (target.x < view.x || target.y < view.y || target.x > view.x + view.width || target.y > view.y + view.height) continue;
      const track = this.tracks.get(target.id);
      if (track) { track.target = { ...target }; track.seen = this.frame; }
      else this.tracks.set(target.id, { target: { ...target }, nextAt: now + 1000 + (target.id * 389 % 2000), seen: this.frame });
      if (activate && !invalidated) this.pending.push({ ...target });
    }
    for (const [id, track] of this.tracks) if (track.seen !== this.frame) this.tracks.delete(id);
    this.captured = true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.world = null; this.active = false; this.destroyed = true;
    this.gpu.releaseSource(this.source);
  }

  private emitFrame(now: number): void {
    if (this.destroyed || !this.world || !this.captured) return;
    this.captured = false;
    if (this.generation !== this.gpu.emissionGeneration) { this.clear(); return; }
    for (const target of this.pending) {
      const count = this.gpu.quality.scaleDiscreteBurst(EFFECT, 2);
      for (let i = 0; i < count; i++) this.spawn(target, now);
    }
    this.pending.length = 0;
    const interval = this.gpu.quality.scaleFrequency(2000, EFFECT);
    for (const track of this.tracks.values()) {
      if (now < track.nextAt) continue;
      if (interval > 0) this.spawn(track.target, now);
      // Never replay missed time or failed admission after a pause or overload.
      track.nextAt = now + (interval || 2000);
    }
  }

  private spawn(target: ConstructionOwnershipTarget, now: number): void {
    const spec = this.spec;
    const angle = Math.random() * Math.PI * 2;
    spec.x = target.x + Math.cos(angle) * target.width * 0.38;
    spec.y = target.y + Math.sin(angle) * target.height * 0.38;
    spec.vx = Math.cos(angle) * 4; spec.vy = Math.sin(angle) * 4 - 3;
    spec.lifeMs = 300 + Math.random() * 180;
    spec.rotation = angle; spec.angularVelocity = 0.3;
    spec.scaleStart = (2 + Math.random() * 3) / getGpuVfxFrame(spec.frame).width;
    spec.scaleEnd = spec.scaleStart * 0.35;
    spec.stretchStart = 1.3; spec.stretchEnd = 1;
    spec.alphaStart = 0.65; spec.alphaEnd = 0;
    spec.tint = mixColors(target.color, 0xffffff, 0.35);
    this.hasParticles = this.gpu.spawn(spec, this.source, now) || this.hasParticles;
  }

  private clear(): void {
    if (this.hasParticles) this.gpu.clearSource(this.source);
    this.hasParticles = false;
    this.tracks.clear(); this.pending.length = 0; this.captured = false;
    this.generation = this.gpu.emissionGeneration;
  }
}
