import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { getGpuVfxFrame, GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

const EFFECTS = [GpuVfxEffectId.VoidMeteorPlasma, GpuVfxEffectId.VoidMeteorSpark,
  GpuVfxEffectId.VoidMeteorSmoke, GpuVfxEffectId.VoidMeteorFragment] as const;
const BASE_RATES = [260, 190, 48, 22];

/** One bounded source per material, scheduled by the shared GPU tick after retirement.
 * Impact only stops emission; clear/teardown kills all surviving members with their sources. */
export class VoidMeteorParticleTrail {
  private readonly specs: GpuVfxSpawnSpec[];
  private readonly glow: GpuVfxSpawnSpec;
  private readonly sources = new Int32Array(4).fill(-1);
  private readonly flows = EFFECTS.map(() => new ParticleFlowScheduler(0));
  private readonly widths: number[];
  private readonly glowWidth: number;
  private readonly stopEmission: () => void;
  private generation: number;
  private active = false;
  private destroyed = false;
  private randomState = 1;
  private x = 0; private y = 0;
  private previousX = 0; private previousY = 0;
  private dx = 0; private dy = 0; private angle = 0; private speed = 0;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.specs = EFFECTS.map(effect => gpu.createSpec(effect));
    this.glow = gpu.createSpec(GpuVfxEffectId.VoidMeteorPlasma);
    this.glow.frame = GpuVfxFrameId.DeathGlow;
    this.glowWidth = getGpuVfxFrame(this.glow.frame).width;
    this.widths = this.specs.map(spec => getGpuVfxFrame(spec.frame).width);
    this.generation = gpu.emissionGeneration;
    this.stopEmission = gpu.registerEmission((delta, now) => this.emit(delta, now));
  }

  start(seed: number): void { this.clear(); this.randomState = seed || 1; }

  sync(x: number, y: number, angle: number, speed: number, active: boolean): void {
    if (this.destroyed) return;
    if (!this.active) { this.previousX = x; this.previousY = y; }
    this.x = x; this.y = y; this.angle = angle;
    this.dx = Math.cos(angle); this.dy = Math.sin(angle);
    this.speed = speed; this.active = active;
  }

  clear(): void {
    this.active = false;
    for (let i = 0; i < 4; i++) {
      // releaseAll invalidates handles; never release a newly recycled source owned elsewhere.
      if (this.generation === this.gpu.emissionGeneration && this.sources[i] >= 0) this.gpu.releaseSource(this.sources[i]);
      this.sources[i] = -1;
      this.flows[i].resetCountdown();
    }
    this.generation = this.gpu.emissionGeneration;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.stopEmission(); this.destroyed = true;
  }

  private random(): number {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  private emit(delta: number, now: number): void {
    if (this.generation !== this.gpu.emissionGeneration || this.gpu.isSuppressed()) { this.clear(); return; }
    if (!this.active || delta <= 0) return;
    const dt = Math.min(100, delta);
    const rateFactor = Math.min(1.55, 0.7 + this.speed / 200);
    for (let layer = 0; layer < 4; layer++) {
      const frequency = this.gpu.quality.scaleFrequency(1000 / (BASE_RATES[layer] * rateFactor), EFFECTS[layer]);
      if (frequency <= 0) continue;
      if (this.sources[layer] < 0) this.sources[layer] = this.gpu.createSource(EFFECTS[layer]);
      if (this.sources[layer] < 0) continue;
      const flow = this.flows[layer];
      flow.setFrequency(frequency);
      const count = Math.min(50, flow.tick(dt));
      for (let i = 0; i < count; i++) this.spawn(layer, now, (i + 0.5) / count);
    }
    this.previousX = this.x; this.previousY = this.y;
  }

  private spawn(layer: number, now: number, fraction: number): void {
    const spec = this.specs[layer];
    const dx = this.dx, dy = this.dy;
    const side = (this.random() - 0.5) * (layer === 1 ? 150 : 90);
    const along = layer === 1 || layer === 3 ? 45 + this.random() * 35 : -30 - this.random() * 80;
    const spread = (this.random() - 0.5) * (layer === 1 ? 320 : layer === 3 ? 180 : 65);
    const retreat = layer === 0 ? 210 + this.random() * 210 : layer === 1 ? 190 + this.random() * 440 : 80 + this.random() * 125;
    spec.x = this.previousX + (this.x - this.previousX) * fraction + dx * along - dy * side;
    spec.y = this.previousY + (this.y - this.previousY) * fraction + dy * along + dx * side;
    spec.vx = -dx * retreat - dy * spread; spec.vy = -dy * retreat + dx * spread;
    spec.rotation = layer === 1 ? Math.atan2(spec.vy, spec.vx) : this.angle + (this.random() - 0.5) * 1.6;
    spec.angularVelocity = layer >= 2 ? (this.random() - 0.5) * 3 : 0;
    spec.tintBlendStart = layer === 0 ? 0.8 : layer === 1 ? 0.2 : 1;
    spec.tintBlendEnd = 1;
    if (layer === 0) {
      spec.lifeMs = 320 + this.random() * 230;
      spec.scaleStart = (30 + this.random() * 40) / this.widths[layer];
      spec.scaleEnd = spec.scaleStart * 0.55;
      spec.stretchStart = 1.6; spec.stretchEnd = 2.6;
      spec.alphaStart = 0.07 + this.random() * 0.06; spec.tint = 0x8031d9;
    } else if (layer === 1) {
      spec.lifeMs = 500 + this.random() * 700;
      spec.scaleStart = (2 + this.random() * 2) / this.widths[layer];
      spec.scaleEnd = spec.scaleStart * 0.2;
      spec.stretchStart = 5 + this.random() * 5; spec.stretchEnd = 2;
      spec.alphaStart = 0.8; spec.tint = 0xb75fff;
    } else if (layer === 2) {
      spec.lifeMs = 1100 + this.random() * 700;
      spec.scaleStart = (48 + this.random() * 30) / this.widths[layer];
      spec.scaleEnd = spec.scaleStart * 2.3;
      spec.alphaStart = 0.34; spec.tint = 0x241735;
    } else {
      spec.lifeMs = 650 + this.random() * 550;
      spec.scaleStart = (4 + this.random() * 6) / this.widths[layer];
      spec.scaleEnd = spec.scaleStart * 0.45;
      spec.alphaStart = 0.85; spec.tint = 0x241a32;
    }
    this.gpu.spawn(spec, this.sources[layer], now);
    if (layer >= 2 && this.sources[0] >= 0) {
      // Same trajectory: small emission around a dark fragment, sparse purple light inside smoke.
      const glow = this.glow;
      glow.x = spec.x; glow.y = spec.y; glow.vx = spec.vx; glow.vy = spec.vy;
      glow.lifeMs = layer === 2 ? 900 : spec.lifeMs;
      glow.scaleStart = spec.scaleStart * this.widths[layer] * (layer === 2 ? 1.2 : 2) / this.glowWidth;
      glow.scaleEnd = glow.scaleStart * (layer === 2 ? 1.8 : 0.2);
      glow.alphaStart = layer === 2 ? 0.065 : 0.48;
      glow.tint = layer === 2 ? 0x692499 : 0xb672f4;
      this.gpu.spawn(glow, this.sources[0], now);
    }
  }
}
