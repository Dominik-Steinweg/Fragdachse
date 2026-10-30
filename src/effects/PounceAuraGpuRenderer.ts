import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';

const TAU = Math.PI * 2;
const MAX_BODIES = 16;

/**
 * Tuning of the pounce aura: emissive void haze that rises around the body without any direction,
 * so it reads as the body charging up and never as an attack travelling across the ground.
 */
export const POUNCE_AURA_FX = {
  /** Puffs per second at the start of the aim and on top of that at full glow. */
  rateBase: 26, rateGain: 70,
  /** Puffs are born on a ring around the body centre (shares of the body size). */
  ringMin: 0.3, ringMax: 0.6,
  /** Slow outward drift plus a swirl in one turning sense per body: 14–34 px over a puff's life. */
  outwardMin: 10, outwardMax: 26, swirlMin: 18, swirlMax: 34, lifeMinMs: 560, lifeMaxMs: 860,
  /** Diameters in px (the smoke frame is 56 px); haze grows and is stretched along its swirl. */
  diameterMin: 8, diameterMax: 14, growth: 2.3, stretch: 1.6,
  alphaBase: 0.12, alphaGain: 0.26,
} as const;

interface AuraBody { x: number; y: number; size: number; strength: number; color: number; turn: number }

function between(min: number, max: number): number { return min + Math.random() * (max - min); }

/**
 * Charge aura of a pouncing body as GPU particles: violet void haze that rises on a ring around
 * the body, drifts slowly outwards and swirls, thickening with the glow. Bodies are queued per
 * render frame and emitted on the next GPU emission tick at a rate over the elapsed time.
 */
export class PounceAuraGpuRenderer {
  private readonly haze: GpuVfxSpawnSpec;
  private readonly source: number;
  private readonly bodies = Array.from({ length: MAX_BODIES },
    (): AuraBody => ({ x: 0, y: 0, size: 0, strength: 0, color: 0, turn: 1 }));
  private bodyCount = 0;
  private destroyed = false;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.haze = gpu.createSpec(GpuVfxEffectId.PounceAura);
    this.source = gpu.createSource(GpuVfxEffectId.PounceAura);
    gpu.registerEmission(deltaMs => this.emitFrame(deltaMs));
  }

  /** Queues one aura frame of a body of `size` px at (x, y); `strength` 0..1, `turn` ±1 its swirl sense. */
  emit(x: number, y: number, size: number, strength: number, color: number, turn: number): void {
    if (this.destroyed || !Number.isFinite(x + y + size + strength) || this.bodyCount >= this.bodies.length) return;
    const body = this.bodies[this.bodyCount++];
    body.x = x; body.y = y; body.size = size; body.strength = Math.max(0, Math.min(1, strength)); body.color = color;
    body.turn = turn < 0 ? -1 : 1;
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

  private spawnHaze(body: AuraBody, dtMs: number): void {
    const tuning = POUNCE_AURA_FX, spec = this.haze, now = this.gpu.now();
    const wanted = Math.floor((tuning.rateBase + tuning.rateGain * body.strength) * dtMs / 1000 + Math.random());
    const puffs = this.gpu.quality.scaleDiscreteBurst(GpuVfxEffectId.PounceAura, wanted);
    if (puffs < wanted) this.gpu.recordQualityDrop(GpuVfxEffectId.PounceAura, wanted - puffs);
    for (let i = 0; i < puffs; i++) {
      const around = between(0, TAU), ring = body.size * between(tuning.ringMin, tuning.ringMax);
      const outward = between(tuning.outwardMin, tuning.outwardMax), swirl = between(tuning.swirlMin, tuning.swirlMax) * body.turn;
      spec.frame = GpuVfxFrameId.ExplosionSmoke;
      spec.lifeMs = between(tuning.lifeMinMs, tuning.lifeMaxMs);
      spec.x = body.x + Math.cos(around) * ring; spec.y = body.y + Math.sin(around) * ring;
      // Outward plus tangential: the haze curls around the body instead of pointing anywhere.
      spec.vx = (Math.cos(around) * outward - Math.sin(around) * swirl) * 1000 / spec.lifeMs;
      spec.vy = (Math.sin(around) * outward + Math.cos(around) * swirl) * 1000 / spec.lifeMs;
      spec.positionEase = GpuVfxEase.QuadOut;
      spec.rotation = around + body.turn * Math.PI / 2; spec.angularVelocity = body.turn * between(0.4, 1.2);
      spec.rotationEase = GpuVfxEase.QuadOut;
      spec.scaleStart = between(tuning.diameterMin, tuning.diameterMax) / 56;
      spec.scaleEnd = spec.scaleStart * tuning.growth;
      spec.scaleEase = GpuVfxEase.QuadOut;
      spec.stretchStart = tuning.stretch; spec.stretchEnd = 1.1;
      spec.alphaStart = tuning.alphaBase + tuning.alphaGain * body.strength; spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.CubicIn;
      spec.tint = body.color;
      this.gpu.spawn(spec, this.source, now);
    }
  }
}
