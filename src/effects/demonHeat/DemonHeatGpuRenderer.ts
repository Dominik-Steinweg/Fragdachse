import { GpuVfxFrameId } from '../gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from '../gpu/GpuVfxEffects';
import { GpuVfxEase } from '../gpu/GpuVfxEase';
import type { GpuVfxSpawnSpec } from '../gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from '../gpu/GpuVfxSystem';

const TAU = Math.PI * 2;
const MAX_BODIES = 48;
const MAX_EVENTS = 24;

/**
 * Body-local anchors of the heat zones, front to back (shares of the drawn frame; `f` along the facing,
 * `s` to the right). They match the zone order of the emission sheet: head, shoulders, spine, flanks, tail.
 */
const ZONE_ANCHORS: readonly (readonly { f: number; s: number }[])[] = [
  [{ f: 0.13, s: 0 }, { f: 0.1, s: 0.1 }, { f: 0.1, s: -0.1 }],
  [{ f: 0.05, s: 0.17 }, { f: 0.05, s: -0.17 }],
  [{ f: 0.0, s: 0 }, { f: -0.06, s: 0 }],
  [{ f: -0.06, s: 0.11 }, { f: -0.06, s: -0.11 }],
  [{ f: -0.15, s: 0 }],
];

/** Tuning of the Demon Badger's heat particles (sizes in world px, rates per second). */
export const DEMON_HEAT_FX = {
  /** A step: embers burst from the zone that just lit, a puff of haze swells around it. */
  step: { embers: 7, speedMin: 34, speedMax: 84, lifeMinMs: 260, lifeMaxMs: 460, emberMin: 0.35, emberMax: 0.6,
    haze: 3, hazeMin: 9, hazeMax: 14, hazeLifeMs: 420, hazeAlpha: 0.16 },
  /**
   * Lit zones shed a few embers that drift off the body (never a veil over the zones); each stage adds
   * to the rate, a hot runner leaves a trail.
   */
  glow: { emberRatePerStage: 0.4, trailFromStage: 3, trailRate: 7, lifeMinMs: 500, lifeMaxMs: 900, drift: 22,
    emberMin: 0.22, emberMax: 0.4 },
  /** The meltdown warning draws void haze and embers in from around the body. */
  inhale: { rateBase: 26, rateGain: 70, startMin: 0.35, startMax: 0.7, lifeMinMs: 420, lifeMaxMs: 640,
    diameterMin: 12, diameterMax: 22, alphaBase: 0.08, alphaGain: 0.18, emberRate: 30 },
  /**
   * The burst: a soft front of haze rushing out to the rim, haze filling the circle behind it, a billow
   * born around (not on) the centre so it never stacks into a pale core, and dark void smoke that gives
   * the burst body by day and lingers after it.
   */
  meltdown: { referencePx: 220, frontPerRadian: 9, frontLifeMinMs: 460, frontLifeMaxMs: 680, frontMin: 40, frontMax: 60,
    frontStretch: 1.8, frontAlpha: 0.16, overshoot: 1.06, trailPerRadian: 8, trailLifeMinMs: 800, trailLifeMaxMs: 1300,
    trailMin: 30, trailMax: 56, trailAlpha: 0.12, billow: 6, billowRingMin: 12, billowRingMax: 40, billowMin: 40,
    billowMax: 64, billowLifeMs: 900, billowAlpha: 0.12, smoke: 16, smokeRingMin: 0.15, smokeRingMax: 0.7,
    smokeLifeMinMs: 1600, smokeLifeMaxMs: 2600, smokeMin: 54, smokeMax: 96, smokeAlpha: 0.5, embers: 20 },
  /** A killed hot body: dying embers settle, a little dark smoke rises. */
  fizzle: { embers: 10, smoke: 4, lifeMinMs: 500, lifeMaxMs: 900 },
} as const;

/** Dark void smoke of the aftermath (lit, not emissive): violet enough to read on daylit grass. */
const SMOKE_TINT = 0x3a1652;

interface Glow { x: number; y: number; rotation: number; frame: number; stage: number; color: number; ember: number; running: boolean }
interface Step { x: number; y: number; rotation: number; frame: number; zone: number; color: number; ember: number }
interface Inhale { x: number; y: number; radius: number; strength: number; color: number; ember: number }
interface Burst { x: number; y: number; radius: number; color: number; ember: number; fizzle: boolean }

function between(min: number, max: number): number { return min + Math.random() * (max - min); }

/**
 * Heat particles of the Demon Badger, all GPU: embers burst from the zone a salvo just lit, lit
 * zones keep shedding embers (a hot runner trails them), the meltdown warning draws void haze in,
 * and the burst throws a pressure wave of void haze to the rim of its circle with a billow in the
 * middle and dark smoke after it. Haze is emissive violet with low red and green, so dense haze
 * never saturates towards white. Events are queued per render frame and emitted on the next GPU
 * emission tick.
 */
export class DemonHeatGpuRenderer {
  private readonly emberSpec: GpuVfxSpawnSpec;
  private readonly hazeSpec: GpuVfxSpawnSpec;
  private readonly smokeSpec: GpuVfxSpawnSpec;
  private readonly emberSource: number;
  private readonly hazeSource: number;
  private readonly smokeSource: number;
  private readonly glows = Array.from({ length: MAX_BODIES },
    (): Glow => ({ x: 0, y: 0, rotation: 0, frame: 0, stage: 0, color: 0, ember: 0, running: false }));
  private glowCount = 0;
  private readonly steps = Array.from({ length: MAX_EVENTS }, (): Step => ({ x: 0, y: 0, rotation: 0, frame: 0, zone: 0, color: 0, ember: 0 }));
  private stepCount = 0;
  private readonly inhales = Array.from({ length: MAX_BODIES }, (): Inhale => ({ x: 0, y: 0, radius: 0, strength: 0, color: 0, ember: 0 }));
  private inhaleCount = 0;
  private readonly bursts = Array.from({ length: MAX_EVENTS }, (): Burst => ({ x: 0, y: 0, radius: 0, color: 0, ember: 0, fizzle: false }));
  private burstCount = 0;
  private readonly unregister: () => void;
  private destroyed = false;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.emberSpec = gpu.createSpec(GpuVfxEffectId.DemonHeatEmber);
    this.hazeSpec = gpu.createSpec(GpuVfxEffectId.DemonHeatHaze);
    this.smokeSpec = gpu.createSpec(GpuVfxEffectId.DemonHeatSmoke);
    this.emberSource = gpu.createSource(GpuVfxEffectId.DemonHeatEmber);
    this.hazeSource = gpu.createSource(GpuVfxEffectId.DemonHeatHaze);
    this.smokeSource = gpu.createSource(GpuVfxEffectId.DemonHeatSmoke);
    this.unregister = gpu.registerEmission(deltaMs => this.emitFrame(deltaMs));
  }

  /** Per render frame of a heated body: `frame` is its drawn frame size, `stage` its lit stages. */
  glow(x: number, y: number, rotation: number, frame: number, stage: number, color: number, ember: number, running: boolean): void {
    if (this.destroyed || stage <= 0 || this.glowCount >= this.glows.length || !Number.isFinite(x + y + rotation)) return;
    const glow = this.glows[this.glowCount++];
    glow.x = x; glow.y = y; glow.rotation = rotation; glow.frame = frame; glow.stage = stage; glow.color = color;
    glow.ember = ember; glow.running = running;
  }

  /** The step to `zone` (1-based) of a body: embers burst from that zone. */
  step(x: number, y: number, rotation: number, frame: number, zone: number, color: number, ember: number): void {
    if (this.destroyed || this.stepCount >= this.steps.length || !Number.isFinite(x + y + rotation)) return;
    const step = this.steps[this.stepCount++];
    step.x = x; step.y = y; step.rotation = rotation; step.frame = frame; step.zone = zone; step.color = color; step.ember = ember;
  }

  /** Per render frame of a melting body: haze drawn in from the burst circle; `strength` 0..1. */
  inhale(x: number, y: number, radius: number, strength: number, color: number, ember: number): void {
    if (this.destroyed || this.inhaleCount >= this.inhales.length || !Number.isFinite(x + y + radius + strength)) return;
    const inhale = this.inhales[this.inhaleCount++];
    inhale.x = x; inhale.y = y; inhale.radius = radius; inhale.strength = Math.max(0, Math.min(1, strength));
    inhale.color = color; inhale.ember = ember;
  }

  /** The meltdown burst of `radius` (or a harmless fizzle of a killed hot body). */
  burst(x: number, y: number, radius: number, color: number, ember: number, fizzle = false): void {
    if (this.destroyed || this.burstCount >= this.bursts.length || !Number.isFinite(x + y + radius) || radius <= 0) return;
    const burst = this.bursts[this.burstCount++];
    burst.x = x; burst.y = y; burst.radius = radius; burst.color = color; burst.ember = ember; burst.fizzle = fizzle;
  }

  clear(): void {
    this.glowCount = 0; this.stepCount = 0; this.inhaleCount = 0; this.burstCount = 0;
    this.gpu.clearSource(this.emberSource);
    this.gpu.clearSource(this.hazeSource);
    this.gpu.clearSource(this.smokeSource);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.unregister();
    this.gpu.releaseSource(this.emberSource);
    this.gpu.releaseSource(this.hazeSource);
    this.gpu.releaseSource(this.smokeSource);
  }

  private emitFrame(deltaMs: number): void {
    if (this.destroyed) return;
    const glows = this.glowCount, steps = this.stepCount, inhales = this.inhaleCount, bursts = this.burstCount;
    this.glowCount = 0; this.stepCount = 0; this.inhaleCount = 0; this.burstCount = 0;
    if (this.gpu.isSuppressed()) return;
    for (let i = 0; i < bursts; i++) {
      const burst = this.bursts[i];
      if (burst.fizzle) this.spawnFizzle(burst); else this.spawnMeltdown(burst);
    }
    for (let i = 0; i < steps; i++) this.spawnStep(this.steps[i]);
    if (!(deltaMs > 0)) return;
    const dt = Math.min(deltaMs, 50);
    for (let i = 0; i < glows; i++) this.spawnGlow(this.glows[i], dt);
    for (let i = 0; i < inhales; i++) this.spawnInhale(this.inhales[i], dt);
  }

  private scaled(effect: GpuVfxEffectId, count: number): number {
    const result = this.gpu.quality.scaleDiscreteBurst(effect, count);
    if (result < count) this.gpu.recordQualityDrop(effect, count - result);
    return result;
  }

  /** World point of a zone anchor of a body (the frame faces north at rotation 0). */
  private anchor(x: number, y: number, rotation: number, frame: number, zone: number, out: { x: number; y: number }): void {
    const anchors = ZONE_ANCHORS[Math.max(0, Math.min(ZONE_ANCHORS.length - 1, zone - 1))];
    const a = anchors[Math.floor(Math.random() * anchors.length)];
    const sin = Math.sin(rotation), cos = Math.cos(rotation);
    // Forward is the frame's up (0, -1), right its +x, both turned by the sprite rotation.
    out.x = x + (sin * a.f + cos * a.s) * frame;
    out.y = y + (-cos * a.f + sin * a.s) * frame;
  }

  private readonly point = { x: 0, y: 0 };

  private spawnStep(step: Step): void {
    const fx = DEMON_HEAT_FX.step, now = this.gpu.now(), p = this.point;
    const embers = this.scaled(GpuVfxEffectId.DemonHeatEmber, fx.embers);
    for (let i = 0; i < embers; i++) {
      this.anchor(step.x, step.y, step.rotation, step.frame, step.zone, p);
      const angle = between(0, TAU), speed = between(fx.speedMin, fx.speedMax);
      this.ember(now, p.x, p.y, Math.cos(angle) * speed, Math.sin(angle) * speed, between(fx.lifeMinMs, fx.lifeMaxMs),
        between(fx.emberMin, fx.emberMax), Math.random() < 0.5 ? step.ember : step.color, 1);
    }
    const haze = this.scaled(GpuVfxEffectId.DemonHeatHaze, fx.haze);
    for (let i = 0; i < haze; i++) {
      this.anchor(step.x, step.y, step.rotation, step.frame, step.zone, p);
      const angle = between(0, TAU);
      this.haze(now, p.x, p.y, angle, 0, between(4, 10), fx.hazeLifeMs * between(0.8, 1.2), between(fx.hazeMin, fx.hazeMax), 2,
        1.2, angle, fx.hazeAlpha, step.color);
    }
  }

  private spawnGlow(glow: Glow, dtMs: number): void {
    const fx = DEMON_HEAT_FX.glow, now = this.gpu.now(), p = this.point;
    const rate = fx.emberRatePerStage * glow.stage + (glow.running && glow.stage >= fx.trailFromStage ? fx.trailRate : 0);
    const embers = this.scaled(GpuVfxEffectId.DemonHeatEmber, Math.floor(rate * dtMs / 1000 + Math.random()));
    for (let i = 0; i < embers; i++) {
      this.anchor(glow.x, glow.y, glow.rotation, glow.frame, 1 + Math.floor(Math.random() * glow.stage), p);
      // Away from the body centre with some scatter; slow enough that a runner leaves them behind.
      const angle = Math.atan2(p.y - glow.y, p.x - glow.x) + between(-0.9, 0.9), drift = between(0.5, 1) * fx.drift;
      this.ember(now, p.x, p.y, Math.cos(angle) * drift, Math.sin(angle) * drift, between(fx.lifeMinMs, fx.lifeMaxMs),
        between(fx.emberMin, fx.emberMax), Math.random() < 0.65 ? glow.ember : glow.color, 0.9);
    }
  }

  private spawnInhale(inhale: Inhale, dtMs: number): void {
    const fx = DEMON_HEAT_FX.inhale, now = this.gpu.now();
    const puffs = this.scaled(GpuVfxEffectId.DemonHeatHaze,
      Math.floor((fx.rateBase + fx.rateGain * inhale.strength) * dtMs / 1000 + Math.random()));
    for (let i = 0; i < puffs; i++) {
      const direction = between(0, TAU), start = inhale.radius * between(fx.startMin, fx.startMax);
      // Travels inwards: from `start` back to a few px off the body.
      this.haze(now, inhale.x, inhale.y, direction, start, -(start - between(4, 10)), between(fx.lifeMinMs, fx.lifeMaxMs),
        between(fx.diameterMin, fx.diameterMax), 0.45, 1.8, direction, fx.alphaBase + fx.alphaGain * inhale.strength, inhale.color);
    }
    const embers = this.scaled(GpuVfxEffectId.DemonHeatEmber, Math.floor(fx.emberRate * inhale.strength * dtMs / 1000 + Math.random()));
    for (let i = 0; i < embers; i++) {
      const direction = between(0, TAU), start = inhale.radius * between(0.25, 0.55), life = between(300, 520);
      const speed = (start - 6) * 1000 / life;
      this.ember(now, inhale.x + Math.cos(direction) * start, inhale.y + Math.sin(direction) * start,
        -Math.cos(direction) * speed, -Math.sin(direction) * speed, life, between(0.4, 0.7), inhale.ember, 1, GpuVfxEase.CubicIn);
    }
  }

  /** Pressure wave from the body out to the rim, haze filling the circle, a billow and dark smoke after it. */
  private spawnMeltdown(burst: Burst): void {
    const fx = DEMON_HEAT_FX.meltdown, now = this.gpu.now(), density = burst.radius / fx.referencePx;
    const inner = 12, phase = between(0, TAU);
    const front = this.scaled(GpuVfxEffectId.DemonHeatHaze, Math.ceil(fx.frontPerRadian * TAU * density));
    for (let i = 0; i < front; i++) {
      const direction = phase + TAU * (i + 0.5) / front + between(-0.04, 0.04);
      // Stretched along the wave, not its travel: one ring of haze rushing outwards.
      this.haze(now, burst.x, burst.y, direction, inner, burst.radius * fx.overshoot - inner,
        between(fx.frontLifeMinMs, fx.frontLifeMaxMs), between(fx.frontMin, fx.frontMax), 1.5, fx.frontStretch,
        direction + Math.PI / 2, fx.frontAlpha, burst.color);
    }
    const trail = this.scaled(GpuVfxEffectId.DemonHeatHaze, Math.ceil(fx.trailPerRadian * TAU * density));
    for (let i = 0; i < trail; i++) {
      const direction = between(0, TAU);
      this.haze(now, burst.x, burst.y, direction, inner, (burst.radius - inner) * between(0.25, 0.9),
        between(fx.trailLifeMinMs, fx.trailLifeMaxMs), between(fx.trailMin, fx.trailMax), 1.8, 1.1, direction, fx.trailAlpha, burst.color);
    }
    const billow = this.scaled(GpuVfxEffectId.DemonHeatHaze, fx.billow);
    for (let i = 0; i < billow; i++) {
      const direction = phase + TAU * (i + between(0.2, 0.8)) / billow;
      this.haze(now, burst.x, burst.y, direction, between(fx.billowRingMin, fx.billowRingMax), between(10, 40),
        fx.billowLifeMs * between(0.8, 1.2), between(fx.billowMin, fx.billowMax), 1.6, 1, direction, fx.billowAlpha, burst.color);
    }
    const smoke = this.scaled(GpuVfxEffectId.DemonHeatSmoke, Math.ceil(fx.smoke * density));
    for (let i = 0; i < smoke; i++) {
      const direction = between(0, TAU), ring = burst.radius * between(fx.smokeRingMin, fx.smokeRingMax);
      this.smoke(now, burst.x + Math.cos(direction) * ring, burst.y + Math.sin(direction) * ring, direction,
        between(20, 60), between(fx.smokeLifeMinMs, fx.smokeLifeMaxMs), between(fx.smokeMin, fx.smokeMax), fx.smokeAlpha);
    }
    const embers = this.scaled(GpuVfxEffectId.DemonHeatEmber, Math.round(fx.embers * density));
    for (let i = 0; i < embers; i++) {
      const direction = between(0, TAU), speed = burst.radius * between(0.6, 1.4);
      this.ember(now, burst.x, burst.y, Math.cos(direction) * speed, Math.sin(direction) * speed, between(500, 1000),
        between(0.6, 1), Math.random() < 0.7 ? burst.ember : burst.color, 1, GpuVfxEase.QuadOut);
    }
  }

  /** A killed hot body: its embers settle and die, a little dark smoke rises. */
  private spawnFizzle(burst: Burst): void {
    const fx = DEMON_HEAT_FX.fizzle, now = this.gpu.now();
    const embers = this.scaled(GpuVfxEffectId.DemonHeatEmber, fx.embers);
    for (let i = 0; i < embers; i++) {
      const direction = between(0, TAU), speed = burst.radius * between(0.5, 1.4);
      this.ember(now, burst.x, burst.y, Math.cos(direction) * speed, Math.sin(direction) * speed,
        between(fx.lifeMinMs, fx.lifeMaxMs), between(0.35, 0.6), burst.ember, 0.8, GpuVfxEase.QuadOut);
    }
    const smoke = this.scaled(GpuVfxEffectId.DemonHeatSmoke, fx.smoke);
    for (let i = 0; i < smoke; i++) {
      const direction = between(0, TAU);
      this.smoke(now, burst.x, burst.y, direction, between(6, 18), between(700, 1100), burst.radius * between(0.6, 1), 0.4);
    }
  }

  private ember(now: number, x: number, y: number, vx: number, vy: number, lifeMs: number, scale: number, tint: number,
    alpha: number, ease: GpuVfxEase = GpuVfxEase.QuadOut): void {
    const spec = this.emberSpec;
    spec.frame = GpuVfxFrameId.ExplosionSpark;
    spec.lifeMs = lifeMs;
    spec.x = x; spec.y = y;
    spec.vx = vx; spec.vy = vy; spec.positionEase = ease;
    spec.rotation = 0; spec.angularVelocity = 0; spec.rotationEase = GpuVfxEase.Linear;
    spec.scaleStart = scale; spec.scaleEnd = 0; spec.scaleEase = GpuVfxEase.CubicIn;
    spec.stretchStart = 1; spec.stretchEnd = 1;
    spec.alphaStart = alpha; spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.CubicIn;
    spec.tint = tint;
    this.gpu.spawn(spec, this.emberSource, now);
  }

  private haze(now: number, x: number, y: number, direction: number, start: number, travel: number, lifeMs: number,
    diameter: number, growth: number, stretch: number, rotation: number, alpha: number, tint: number): void {
    const spec = this.hazeSpec, cos = Math.cos(direction), sin = Math.sin(direction);
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
    spec.tint = tint;
    this.gpu.spawn(spec, this.hazeSource, now);
  }

  private smoke(now: number, x: number, y: number, direction: number, travel: number, lifeMs: number, diameter: number, alpha: number): void {
    const spec = this.smokeSpec;
    spec.frame = GpuVfxFrameId.ExplosionSmoke;
    spec.lifeMs = lifeMs;
    spec.x = x; spec.y = y;
    spec.vx = Math.cos(direction) * travel * 1000 / lifeMs; spec.vy = Math.sin(direction) * travel * 1000 / lifeMs;
    spec.positionEase = GpuVfxEase.QuadOut;
    spec.rotation = direction; spec.angularVelocity = between(-0.3, 0.3); spec.rotationEase = GpuVfxEase.QuadOut;
    spec.scaleStart = diameter / 56 * 0.6; spec.scaleEnd = diameter / 56; spec.scaleEase = GpuVfxEase.QuadOut;
    spec.stretchStart = 1; spec.stretchEnd = 1;
    spec.alphaStart = alpha; spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.CubicIn;
    spec.tint = SMOKE_TINT;
    this.gpu.spawn(spec, this.smokeSource, now);
  }
}
