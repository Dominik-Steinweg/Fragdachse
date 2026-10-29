import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';

const MAX_BODIES = 16;

/** Tuning of the lock windup: emissive void haze streaming from the body in the jump direction. */
export const POUNCE_WINDUP_FX = {
  /** Puffs per second at the start of the lock and on top of that at the take-off. */
  rateBase: 40, rateGain: 64,
  /** Narrow cone around the jump direction, so the stream points rather than blooms. */
  spread: 0.2,
  /** Puffs start just in front of the body (it stays readable) and travel 65–160 px ahead. */
  startAheadPx: 9, speedMin: 140, speedMax: 250, lifeMinMs: 460, lifeMaxMs: 640,
  /** Diameters in px (the smoke frame is 56 px); haze grows and is stretched along its travel. */
  diameterMin: 7, diameterMax: 12, growth: 2.4, stretch: 2.1,
  alphaBase: 0.16, alphaGain: 0.22,
} as const;

interface WindupBody { x: number; y: number; angle: number; strength: number; color: number }

function between(min: number, max: number): number { return min + Math.random() * (max - min); }

/**
 * Lock windup of a pouncing body as GPU particles: violet void haze that streams from the body
 * in a narrow cone along the jump direction and thickens towards the take-off. Bodies are queued
 * per render frame and emitted on the next GPU emission tick at a rate over the elapsed time.
 */
export class PounceWindupGpuRenderer {
  private readonly haze: GpuVfxSpawnSpec;
  private readonly source: number;
  private readonly bodies = Array.from({ length: MAX_BODIES }, (): WindupBody => ({ x: 0, y: 0, angle: 0, strength: 0, color: 0 }));
  private bodyCount = 0;
  private destroyed = false;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.haze = gpu.createSpec(GpuVfxEffectId.PounceWindup);
    this.source = gpu.createSource(GpuVfxEffectId.PounceWindup);
    gpu.registerEmission(deltaMs => this.emitFrame(deltaMs));
  }

  /** Queues one windup frame of a body at (x, y) jumping along `angle`; `strength` 0..1. */
  emit(x: number, y: number, angle: number, strength: number, color: number): void {
    if (this.destroyed || !Number.isFinite(x + y + angle + strength) || this.bodyCount >= this.bodies.length) return;
    const body = this.bodies[this.bodyCount++];
    body.x = x; body.y = y; body.angle = angle; body.strength = Math.max(0, Math.min(1, strength)); body.color = color;
  }

  clear(): void {
    this.bodyCount = 0;
    this.gpu.clearSource(this.source);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.gpu.releaseSource(this.source);
  }

  private emitFrame(deltaMs: number): void {
    if (this.destroyed || !this.bodyCount) return;
    const count = this.bodyCount;
    this.bodyCount = 0;
    if (this.gpu.isSuppressed() || !(deltaMs > 0)) return;
    const dt = Math.min(deltaMs, 50);
    for (let i = 0; i < count; i++) this.spawnHaze(this.bodies[i], dt);
  }

  private spawnHaze(body: WindupBody, dtMs: number): void {
    const tuning = POUNCE_WINDUP_FX, spec = this.haze, now = this.gpu.now();
    const wanted = Math.floor((tuning.rateBase + tuning.rateGain * body.strength) * dtMs / 1000 + Math.random());
    const puffs = this.gpu.quality.scaleDiscreteBurst(GpuVfxEffectId.PounceWindup, wanted);
    if (puffs < wanted) this.gpu.recordQualityDrop(GpuVfxEffectId.PounceWindup, wanted - puffs);
    for (let i = 0; i < puffs; i++) {
      const direction = body.angle + between(-tuning.spread, tuning.spread);
      const speed = between(tuning.speedMin, tuning.speedMax);
      spec.frame = GpuVfxFrameId.ExplosionSmoke;
      spec.lifeMs = between(tuning.lifeMinMs, tuning.lifeMaxMs);
      spec.x = body.x + Math.cos(body.angle) * tuning.startAheadPx + between(-2, 2);
      spec.y = body.y + Math.sin(body.angle) * tuning.startAheadPx + between(-2, 2);
      spec.vx = Math.cos(direction) * speed; spec.vy = Math.sin(direction) * speed;
      spec.positionEase = GpuVfxEase.QuadOut;
      spec.rotation = direction; spec.angularVelocity = between(-0.6, 0.6); spec.rotationEase = GpuVfxEase.QuadOut;
      spec.scaleStart = between(tuning.diameterMin, tuning.diameterMax) / 56;
      spec.scaleEnd = spec.scaleStart * tuning.growth;
      spec.scaleEase = GpuVfxEase.QuadOut;
      spec.stretchStart = tuning.stretch; spec.stretchEnd = 1.2;
      spec.alphaStart = tuning.alphaBase + tuning.alphaGain * body.strength; spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.CubicIn;
      spec.tint = body.color;
      this.gpu.spawn(spec, this.source, now);
    }
  }
}
