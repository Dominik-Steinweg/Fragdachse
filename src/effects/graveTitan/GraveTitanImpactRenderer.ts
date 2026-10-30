import { GpuVfxFrameId } from '../gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from '../gpu/GpuVfxEffects';
import { GpuVfxEase } from '../gpu/GpuVfxEase';
import type { GpuVfxSpawnSpec } from '../gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from '../gpu/GpuVfxSystem';
import { GRAVE_TITAN_IMPACT, graveTitanImpact, type GraveTitanImpact } from './graveTitanImpactGeometry';

const TAU = Math.PI * 2;
const MAX_EVENTS = 8;

interface Burst { x: number; y: number; angle: number; arc: number; inner: number; outer: number }

function between(min: number, max: number): number { return min + Math.random() * (max - min); }

/**
 * Grave Titan slam and stomp as GPU haze; their windup is announced by the shared red danger zone
 * alone. A stomp throws a pressure wave of haze from its body edge out to the full reach; a slam
 * pushes a fan of haze from its landing paws through the struck sector. Pure presentation of
 * confirmed swings; bursts are deferred to the GPU emission tick so every member of one is born
 * on the same frame boundary.
 */
export class GraveTitanImpactRenderer {
  private readonly haze: GpuVfxSpawnSpec;
  private readonly source: number;
  private readonly bursts = Array.from({ length: MAX_EVENTS }, (): Burst => ({ x: 0, y: 0, angle: 0, arc: 0, inner: 0, outer: 0 }));
  private burstCount = 0;
  private readonly unregister: () => void;
  private destroyed = false;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.haze = gpu.createSpec(GpuVfxEffectId.GraveTitanHaze);
    this.source = gpu.createSource(GpuVfxEffectId.GraveTitanHaze);
    this.unregister = gpu.registerEmission(() => this.emitFrame());
  }

  /** Throws the haze of one confirmed swing and returns where it struck. */
  play(x: number, y: number, angle: number, arcDegrees: number, range: number): GraveTitanImpact | null {
    if (this.destroyed || !Number.isFinite(x + y + angle + range) || range <= 0) return null;
    const impact = graveTitanImpact(x, y, angle, arcDegrees, range);
    if (this.burstCount < this.bursts.length) {
      const fx = GRAVE_TITAN_IMPACT, burst = this.bursts[this.burstCount++];
      burst.x = x; burst.y = y; burst.angle = angle; burst.arc = impact.stomp ? TAU : Math.min(TAU, arcDegrees * Math.PI / 180);
      burst.inner = impact.stomp ? fx.bodyEdgePx : Math.min(fx.pawReachPx * 0.8, range * 0.6);
      burst.outer = Math.max(burst.inner + 24, range);
    }
    return impact;
  }

  clear(): void {
    this.burstCount = 0;
    this.gpu.clearSource(this.source);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.unregister();
    this.gpu.releaseSource(this.source);
  }

  private emitFrame(): void {
    if (this.destroyed || !this.burstCount) return;
    const bursts = this.burstCount;
    this.burstCount = 0;
    if (this.gpu.isSuppressed()) return;
    for (let i = 0; i < bursts; i++) this.spawnBurst(this.bursts[i]);
  }

  private scaled(count: number): number {
    const result = this.gpu.quality.scaleDiscreteBurst(GpuVfxEffectId.GraveTitanHaze, count);
    if (result < count) this.gpu.recordQualityDrop(GpuVfxEffectId.GraveTitanHaze, count - result);
    return result;
  }

  private spawnBurst(burst: Burst): void {
    const fx = GRAVE_TITAN_IMPACT, spec = this.haze, now = this.gpu.now();
    const full = burst.arc >= TAU - 1e-3, from = full ? between(0, TAU) : burst.angle - burst.arc / 2;
    const frontCount = this.scaled(Math.ceil(fx.front.perRadian * burst.arc));
    for (let i = 0; i < frontCount; i++) {
      const direction = from + burst.arc * (i + (full ? 0.5 : between(0.15, 0.85))) / frontCount + between(-0.04, 0.04);
      // A front stretched along the wave, not along its travel: it reads as one ring rushing outwards.
      this.spawn(spec, now, burst.x, burst.y, direction, burst.inner, burst.outer * fx.front.overshoot - burst.inner,
        between(fx.front.lifeMinMs, fx.front.lifeMaxMs), between(fx.front.diameterMin, fx.front.diameterMax), fx.front.growth,
        fx.front.stretch, direction + Math.PI / 2, fx.front.alpha);
    }
    const trailCount = this.scaled(Math.ceil(fx.trail.perRadian * burst.arc));
    for (let i = 0; i < trailCount; i++) {
      const direction = from + burst.arc * Math.random();
      const travel = (burst.outer - burst.inner) * between(fx.trail.travelMin, fx.trail.travelMax);
      this.spawn(spec, now, burst.x, burst.y, direction, burst.inner * between(0.9, 1.05), travel,
        between(fx.trail.lifeMinMs, fx.trail.lifeMaxMs), between(fx.trail.diameterMin, fx.trail.diameterMax), fx.trail.growth,
        fx.trail.stretch, direction, fx.trail.alpha);
    }
  }

  private spawn(spec: GpuVfxSpawnSpec, now: number, x: number, y: number, direction: number, start: number, travel: number,
    lifeMs: number, diameter: number, growth: number, stretch: number, rotation: number, alpha: number): void {
    const cos = Math.cos(direction), sin = Math.sin(direction);
    spec.frame = GpuVfxFrameId.ExplosionSmoke;
    spec.lifeMs = lifeMs;
    spec.x = x + cos * start; spec.y = y + sin * start;
    spec.vx = cos * travel * 1000 / lifeMs; spec.vy = sin * travel * 1000 / lifeMs;
    spec.positionEase = GpuVfxEase.QuadOut;
    spec.rotation = rotation; spec.angularVelocity = between(-0.4, 0.4); spec.rotationEase = GpuVfxEase.QuadOut;
    // The smoke frame is 56 px.
    spec.scaleStart = diameter / 56; spec.scaleEnd = spec.scaleStart * growth; spec.scaleEase = GpuVfxEase.QuadOut;
    spec.stretchStart = stretch; spec.stretchEnd = 1 + (stretch - 1) * 0.4;
    spec.alphaStart = alpha; spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.CubicIn;
    spec.tint = GRAVE_TITAN_IMPACT.color;
    this.gpu.spawn(spec, this.source, now);
  }
}
