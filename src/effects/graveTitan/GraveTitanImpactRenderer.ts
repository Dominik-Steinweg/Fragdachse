import { GpuVfxFrameId } from '../gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from '../gpu/GpuVfxEffects';
import { GpuVfxEase } from '../gpu/GpuVfxEase';
import type { GpuVfxSpawnSpec } from '../gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from '../gpu/GpuVfxSystem';
import { GRAVE_TITAN_IMPACT, graveHazeHalfLength, graveHazeSpan, graveTitanImpact, type GraveTitanImpact } from './graveTitanImpactGeometry';

const TAU = Math.PI * 2;
const MAX_EVENTS = 8;
const MAX_INHALES = 4;

interface Burst { x: number; y: number; angle: number; arc: number; inner: number; outer: number }
interface Inhale { x: number; y: number; strength: number }

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
  private readonly inhales = Array.from({ length: MAX_INHALES }, (): Inhale => ({ x: 0, y: 0, strength: 0 }));
  private inhaleCount = 0;
  private readonly unregister: () => void;
  private destroyed = false;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.haze = gpu.createSpec(GpuVfxEffectId.GraveTitanHaze);
    this.source = gpu.createSource(GpuVfxEffectId.GraveTitanHaze);
    this.unregister = gpu.registerEmission(deltaMs => this.emitFrame(deltaMs));
  }

  /** Per frame while a salvo gathers: grave haze drawn in to the crown at (x, y); `strength` 0..1. */
  inhale(x: number, y: number, strength: number): void {
    if (this.destroyed || this.inhaleCount >= this.inhales.length || !Number.isFinite(x + y + strength)) return;
    const inhale = this.inhales[this.inhaleCount++];
    inhale.x = x; inhale.y = y; inhale.strength = Math.max(0, Math.min(1, strength));
  }

  /** Throws the haze of one confirmed swing and returns where it struck. */
  play(x: number, y: number, angle: number, arcDegrees: number, range: number): GraveTitanImpact | null {
    if (this.destroyed || !Number.isFinite(x + y + angle + range) || range <= 0) return null;
    const impact = graveTitanImpact(x, y, angle, arcDegrees, range);
    if (this.burstCount < this.bursts.length) {
      const fx = GRAVE_TITAN_IMPACT, burst = this.bursts[this.burstCount++];
      burst.x = x; burst.y = y; burst.angle = angle; burst.arc = impact.stomp ? TAU : Math.min(TAU, arcDegrees * Math.PI / 180);
      burst.inner = impact.stomp ? fx.bodyEdgePx : Math.min(fx.pawReachPx * 0.85, range * 0.6);
      burst.outer = Math.max(burst.inner + 24, range);
    }
    return impact;
  }

  clear(): void {
    this.burstCount = 0;
    this.inhaleCount = 0;
    this.gpu.clearSource(this.source);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.unregister();
    this.gpu.releaseSource(this.source);
  }

  private emitFrame(deltaMs: number): void {
    if (this.destroyed || (!this.burstCount && !this.inhaleCount)) return;
    const bursts = this.burstCount, inhales = this.inhaleCount;
    this.burstCount = 0;
    this.inhaleCount = 0;
    if (this.gpu.isSuppressed()) return;
    for (let i = 0; i < bursts; i++) this.spawnBurst(this.bursts[i]);
    if (deltaMs > 0) for (let i = 0; i < inhales; i++) this.spawnInhale(this.inhales[i], Math.min(deltaMs, 50));
  }

  /** Haze drawn in from around the body; it shrinks and fades as it reaches the crown. */
  private spawnInhale(inhale: Inhale, dtMs: number): void {
    const tuning = GRAVE_TITAN_IMPACT.inhale, spec = this.haze, now = this.gpu.now();
    const puffs = this.scaled(Math.floor((tuning.rateBase + tuning.rateGain * inhale.strength) * dtMs / 1000 + Math.random()));
    for (let i = 0; i < puffs; i++) {
      const direction = between(0, TAU), start = between(tuning.startMin, tuning.startMax);
      this.spawn(spec, now, inhale.x, inhale.y, direction, start, between(tuning.endMin, tuning.endMax) - start,
        between(tuning.lifeMinMs, tuning.lifeMaxMs), between(tuning.diameterMin, tuning.diameterMax), tuning.growth,
        tuning.stretch, direction, tuning.alphaBase + tuning.alphaGain * inhale.strength);
    }
  }

  private scaled(count: number): number {
    const result = this.gpu.quality.scaleDiscreteBurst(GpuVfxEffectId.GraveTitanHaze, count);
    if (result < count) this.gpu.recordQualityDrop(GpuVfxEffectId.GraveTitanHaze, count - result);
    return result;
  }

  private spawnBurst(burst: Burst): void {
    if (burst.arc >= TAU - 1e-3) this.spawnStomp(burst);
    else this.spawnSlam(burst);
  }

  /** A pressure wave from the body edge out to the rim of the struck circle, then thinning haze. */
  private spawnStomp(burst: Burst): void {
    const fx = GRAVE_TITAN_IMPACT, spec = this.haze, now = this.gpu.now();
    const density = burst.outer / fx.referencePx, phase = between(0, TAU);
    const frontCount = this.scaled(Math.ceil(fx.front.perRadian * TAU * density));
    for (let i = 0; i < frontCount; i++) {
      const direction = phase + TAU * (i + 0.5) / frontCount + between(-0.03, 0.03);
      // A front stretched along the wave, not along its travel: it reads as one ring rushing outwards.
      this.spawn(spec, now, burst.x, burst.y, direction, burst.inner, burst.outer * fx.front.overshoot - burst.inner,
        between(fx.front.lifeMinMs, fx.front.lifeMaxMs), between(fx.front.diameterMin, fx.front.diameterMax), fx.front.growth,
        fx.front.stretch, direction + Math.PI / 2, fx.front.alpha);
    }
    const trailCount = this.scaled(Math.ceil(fx.trail.perRadian * TAU * density));
    for (let i = 0; i < trailCount; i++) {
      const direction = between(0, TAU);
      const travel = (burst.outer - burst.inner) * between(fx.trail.travelMin, fx.trail.travelMax);
      this.spawn(spec, now, burst.x, burst.y, direction, burst.inner * between(0.9, 1.05), travel,
        between(fx.trail.lifeMinMs, fx.trail.lifeMaxMs), between(fx.trail.diameterMin, fx.trail.diameterMax), fx.trail.growth,
        fx.trail.stretch, direction, fx.trail.alpha);
    }
  }

  /**
   * A thick billow where the paws come down, a dense front rolling out to the sector's rim and
   * haze filling the sector behind it; every puff stays inside the announced fan.
   */
  private spawnSlam(burst: Burst): void {
    const fx = GRAVE_TITAN_IMPACT, spec = this.haze, now = this.gpu.now();
    const pawX = burst.x + Math.cos(burst.angle) * fx.pawReachPx, pawY = burst.y + Math.sin(burst.angle) * fx.pawReachPx;
    const billow = fx.slamBillow, billowCount = this.scaled(billow.count);
    for (let i = 0; i < billowCount; i++) {
      // Most of the billow rolls forward into the struck sector, a little spills back under the paws.
      const direction = burst.angle + (Math.random() < 0.8 ? between(-0.6, 0.6) * burst.arc : between(-Math.PI, Math.PI));
      this.spawn(spec, now, pawX, pawY, direction, between(0, 12), between(billow.travelMin, billow.travelMax),
        between(billow.lifeMinMs, billow.lifeMaxMs), between(billow.diameterMin, billow.diameterMax), billow.growth,
        billow.stretch, direction, billow.alpha);
    }
    const front = fx.slamFront, density = burst.outer / fx.referencePx;
    const edge = graveHazeSpan(burst.angle, burst.arc, burst.outer,
      graveHazeHalfLength(front.diameterMax, front.growth, front.stretch));
    const frontCount = this.scaled(Math.ceil(front.perRadian * edge.span * density));
    for (let i = 0; i < frontCount; i++) {
      const direction = edge.from + edge.span * (i + between(0.2, 0.8)) / frontCount;
      this.spawn(spec, now, burst.x, burst.y, direction, burst.inner, burst.outer - burst.inner,
        between(front.lifeMinMs, front.lifeMaxMs), between(front.diameterMin, front.diameterMax), front.growth,
        front.stretch, direction + Math.PI / 2, front.alpha);
    }
    const fill = fx.slamFill;
    const fillCount = this.scaled(Math.ceil(fill.perRadian * burst.arc * density));
    for (let i = 0; i < fillCount; i++) {
      const travel = (burst.outer - burst.inner) * between(fill.travelMin, fill.travelMax);
      const diameter = between(fill.diameterMin, fill.diameterMax);
      const span = graveHazeSpan(burst.angle, burst.arc, burst.inner + travel, graveHazeHalfLength(diameter, fill.growth, 1));
      const direction = span.from + span.span * Math.random();
      this.spawn(spec, now, burst.x, burst.y, direction, burst.inner, travel, between(fill.lifeMinMs, fill.lifeMaxMs), diameter,
        fill.growth, fill.stretch, direction, fill.alpha);
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
