import { GpuVfxFrameId } from '../../effects/gpu/GpuVfxAtlas';
import { GpuVfxEase } from '../../effects/gpu/GpuVfxEase';
import { GpuVfxEffectId } from '../../effects/gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from '../../effects/gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from '../../effects/gpu/GpuVfxSystem';
import { createVisibleWorldView, getVisibleWorldView, type CameraWorldViewSource } from '../../graphics/CameraWorldView';

/** Socket kinds of the fort asset that carry particles; positions are world pixels. */
export type BaseFortEmitterKind = 'torch' | 'bowl' | 'hearth';
export interface BaseFortEmitter { readonly kind: BaseFortEmitterKind; readonly x: number; readonly y: number }

/**
 * A light breeze towards world +X, the way the asset's pennants hang. Seen from straight above a flame
 * rises towards the camera, so the breeze barely moves it; only the smoke drifts off with it.
 */
const BREEZE = { x: 1, y: -.2 };
/**
 * Three fires of one fort. Torches burn pitch: a yellow-orange flame with a pale core. The fire bowls
 * burn wood on coal: a wider, redder flame with more smoke and sparks. The hearth in the courtyard is
 * a log fire: the largest, a bed of glowing coals under a ring of orange tongues round a tall hot
 * heart, with a steady smoke column. All are seen from above, where a flame rises towards the camera:
 * its tongues lick out a little on every side round a steady glow and sway slowly. Daylight washes
 * them out a little.
 */
const FIRE = {
  torch: { core: 0xffd8a0, flame: 0xffe0b8, dayAlpha: .75 },
  bowl: { core: 0xff7a34, flame: 0xff8a48, dayAlpha: .9 },
  hearth: { bed: 0xd8481c, core: 0xffc060, flame: 0xff9a4c, heart: 0xffe6b0, dayAlpha: .95 },
} as const;
const SPARKS = [0xffc070, 0xff8a40] as const;
const COALS = [0xff5a1e, 0xff8a34, 0xd83a14] as const;
const SMOKE = 0x9c958c;
/** The flame motif's head sits this far behind the frame centre (px of the 32 px frame). */
const FLAME_HEAD_OFFSET = 8;
/**
 * Fires outside the camera view (plus this margin, so smoke drifting in and fires at the edge are
 * already burning) do not emit: the forts of a whole map share the fire lanes, and off-screen fires
 * would take the slots of the ones in view.
 */
const VIEW_MARGIN_PX = 160;

/** An emitter with its own slow sway, so neighbouring fires never move in step. */
interface Fire extends BaseFortEmitter { readonly phase: number }

/**
 * One particle stream at an emitter: mean interval by day and at night, scaled by the shared GPU
 * quality. Night is the World's artificial-light factor (0 noon … 1 night).
 */
interface Channel {
  readonly emitter: Fire;
  readonly dayMs: number;
  readonly nightMs: number;
  readonly effect: GpuVfxEffectId;
  readonly spawn: (emitter: Fire, night: number, nowMs: number) => void;
  carry: number;
}

/**
 * GPU particles of the persistent base fort on the scene's shared VFX backend: large torches, fire
 * bowls and the hearth, each a calm, slowly swaying flame over a steady glow, with sparks and smoke.
 * The night's atmosphere comes from these fires and their light. Allocation-free per frame; release
 * kills the live members with their sources.
 */
export class BaseFortFx {
  private readonly flame: GpuVfxSpawnSpec;
  private readonly ember: GpuVfxSpawnSpec;
  private readonly smoke: GpuVfxSpawnSpec;
  private readonly flameSource: number;
  private readonly emberSource: number;
  private readonly smokeSource: number;
  private readonly channels: Channel[] = [];
  private readonly unregister: () => void;
  private active = true;
  private night = 0;
  private readonly view = createVisibleWorldView();

  constructor(private readonly system: GpuVfxSystem, emitters: readonly BaseFortEmitter[],
    private readonly camera: CameraWorldViewSource | null = null) {
    this.flame = system.createSpec(GpuVfxEffectId.BaseFortFlame);
    this.ember = system.createSpec(GpuVfxEffectId.BaseFortEmber);
    this.smoke = system.createSpec(GpuVfxEffectId.BaseFortSmoke);
    this.flameSource = system.createSource(GpuVfxEffectId.BaseFortFlame);
    this.emberSource = system.createSource(GpuVfxEffectId.BaseFortEmber);
    this.smokeSource = system.createSource(GpuVfxEffectId.BaseFortSmoke);
    const flame = GpuVfxEffectId.BaseFortFlame, ember = GpuVfxEffectId.BaseFortEmber, smoke = GpuVfxEffectId.BaseFortSmoke;
    for (const source of emitters) {
      const emitter: Fire = { ...source, phase: Math.random() * Math.PI * 2 };
      const add = (dayMs: number, nightMs: number, effect: GpuVfxEffectId, spawn: Channel['spawn']) =>
        this.channels.push({ emitter, dayMs, nightMs, effect, spawn, carry: Math.random() });
      if (emitter.kind === 'torch') {
        add(160, 160, flame, (e, n, t) => this.glow(e, .24, .5 * BaseFortFx.dayFade(FIRE.torch.dayAlpha, n), FIRE.torch.core, t));
        add(85, 85, flame, (e, n, t) => this.emitTorchFlame(e, n, t));
        add(900, 520, ember, (e, n, t) => this.emitSpark(e, .8, 1.5, SPARKS[0], t));
        add(420, 480, smoke, (e, n, t) => this.emitSmoke(e, n, .8, 1, t));
      } else if (emitter.kind === 'hearth') {
        add(160, 160, flame, (e, n, t) => this.glow(e, .7, .48 * BaseFortFx.dayFade(FIRE.hearth.dayAlpha, n), FIRE.hearth.bed, t));
        add(120, 120, flame, (e, n, t) => this.glow(e, .36, .5 * BaseFortFx.dayFade(FIRE.hearth.dayAlpha, n), FIRE.hearth.core, t));
        add(30, 30, flame, (e, n, t) => this.emitHearthFlame(e, n, t));
        add(95, 95, flame, (e, n, t) => this.emitHearthHeart(e, n, t));
        add(130, 110, ember, (e, n, t) => this.emitCoal(e, 5.5, t));
        add(110, 80, ember, (e, n, t) => this.emitSpark(e, 1.2, 4, SPARKS[Math.random() < .5 ? 0 : 1], t));
        add(120, 140, smoke, (e, n, t) => this.emitSmoke(e, n, 2.1, 4, t));
      } else {
        add(150, 150, flame, (e, n, t) => this.glow(e, .32, .5 * BaseFortFx.dayFade(FIRE.bowl.dayAlpha, n), FIRE.bowl.core, t));
        add(75, 75, flame, (e, n, t) => this.emitBowlFlame(e, n, t));
        add(420, 420, ember, (e, n, t) => this.emitCoal(e, 2.4, t));
        add(300, 220, ember, (e, n, t) => this.emitSpark(e, 1, 2, SPARKS[Math.random() < .4 ? 0 : 1], t));
        add(260, 300, smoke, (e, n, t) => this.emitSmoke(e, n, 1.3, 2, t));
      }
    }
    this.unregister = system.registerEmission((deltaMs, nowMs) => this.emit(deltaMs, nowMs));
  }

  /** A fallen fort and a World without lighting stop emitting; live members fade out normally. */
  setActive(active: boolean): void { this.active = active; }

  setNight(night: number): void { this.night = Math.min(1, Math.max(0, night)); }

  private emit(deltaMs: number, nowMs: number): void {
    if (!this.active) return;
    const night = this.night, view = this.camera ? getVisibleWorldView(this.camera, this.view, VIEW_MARGIN_PX) : null;
    for (const channel of this.channels) {
      const { x, y } = channel.emitter;
      if (view && (x < view.x || x > view.right || y < view.y || y > view.bottom)) continue;
      const base = channel.dayMs + (channel.nightMs - channel.dayMs) * night;
      const interval = this.system.quality.scaleFrequency(base, channel.effect);
      if (interval <= 0) continue;
      channel.carry += deltaMs / interval;
      while (channel.carry >= 1) {
        channel.carry -= 1;
        channel.spawn(channel.emitter, night, nowMs);
      }
    }
  }

  /** Daylight washes a flame out; at night it burns at full strength. */
  private static dayFade(dayAlpha: number, night: number): number {
    return dayAlpha + (1 - dayAlpha) * night;
  }

  /**
   * The direction a fire's tongues favour just now: it wanders slowly round, two incommensurate
   * sways per fire, so the flame breathes instead of streaming one way.
   */
  private static sway(emitter: Fire, nowMs: number): number {
    const s = nowMs / 1000;
    return emitter.phase + 1.5 * Math.sin(s * .29 + emitter.phase) + .9 * Math.sin(s * .71 + emitter.phase * 2.3);
  }

  /** A tongue's direction: most lick out on every side, some lean the way the flame sways just now. */
  private static tongue(emitter: Fire, nowMs: number, spread: number): number {
    return Math.random() < .6 ? Math.random() * Math.PI * 2 : BaseFortFx.sway(emitter, nowMs) + (Math.random() - .5) * spread;
  }

  /** A steady glow under a flame: long, overlapping lives and next to no motion keep it from strobing. */
  private glow(emitter: Fire, scale: number, alpha: number, tint: number, nowMs: number): void {
    const spec = this.flame;
    spec.frame = GpuVfxFrameId.FlameCore;
    spec.lifeMs = 760 + Math.random() * 180;
    spec.x = emitter.x + (Math.random() - .5); spec.y = emitter.y + (Math.random() - .5);
    spec.vx = (Math.random() - .5) * .8; spec.vy = (Math.random() - .5) * .8;
    spec.positionEase = GpuVfxEase.Linear;
    spec.scaleStart = scale * .94; spec.scaleEnd = scale; spec.scaleEase = GpuVfxEase.Linear;
    spec.stretchStart = 1; spec.stretchEnd = 1;
    spec.alphaStart = alpha; spec.alphaEnd = alpha * .25;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.rotation = Math.random() * Math.PI * 2; spec.angularVelocity = 0;
    spec.tint = tint; spec.tintBlendStart = 1; spec.tintBlendEnd = 1;
    this.system.spawn(spec, this.flameSource, nowMs);
  }

  /**
   * One soft tongue with its head over the fire, pointing `angle`. Rising towards the camera it grows
   * and lengthens a little and fades; it drifts out only slowly. Many overlapping tongues on every side
   * make one round flame whose outline changes slowly.
   */
  private lick(x: number, y: number, angle: number, scale: number, lifeMs: number, alpha: number,
    tint: number, cooling: number, nowMs: number): void {
    const spec = this.flame;
    spec.frame = GpuVfxFrameId.TorchFlame;
    spec.lifeMs = lifeMs;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    spec.x = x + cos * FLAME_HEAD_OFFSET * scale * .6; spec.y = y + sin * FLAME_HEAD_OFFSET * scale * .6;
    const speed = .8 + Math.random() * 1.6;
    spec.vx = cos * speed + BREEZE.x * .6; spec.vy = sin * speed + BREEZE.y * .6;
    spec.positionEase = GpuVfxEase.Linear;
    spec.scaleStart = scale * .7; spec.scaleEnd = scale * 1.05; spec.scaleEase = GpuVfxEase.QuadOut;
    spec.stretchStart = .55; spec.stretchEnd = .85;
    spec.alphaStart = alpha; spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.rotation = angle; spec.angularVelocity = (Math.random() - .5) * .3;
    spec.tint = tint; spec.tintBlendStart = cooling; spec.tintBlendEnd = 1;
    this.system.spawn(spec, this.flameSource, nowMs);
  }

  /** The torch flame: short tongues round the pitch head, slow and long-lived. */
  private emitTorchFlame(emitter: Fire, night: number, nowMs: number): void {
    this.lick(emitter.x + (Math.random() - .5) * 1.4, emitter.y + (Math.random() - .5) * 1.4,
      BaseFortFx.tongue(emitter, nowMs, 1.4), .36 + Math.random() * .1, 760 + Math.random() * 240,
      (.24 + .06 * night) * BaseFortFx.dayFade(FIRE.torch.dayAlpha, night), FIRE.torch.flame, 1, nowMs);
  }

  /** The bowl fire: tongues rise from all over the coal bed, wider and redder than a torch's. */
  private emitBowlFlame(emitter: Fire, night: number, nowMs: number): void {
    const a = Math.random() * Math.PI * 2, d = 2.6 * Math.sqrt(Math.random());
    this.lick(emitter.x + Math.cos(a) * d, emitter.y + Math.sin(a) * d,
      BaseFortFx.tongue(emitter, nowMs, 1.6), .34 + Math.random() * .1, 820 + Math.random() * 280,
      (.22 + .06 * night) * BaseFortFx.dayFade(FIRE.bowl.dayAlpha, night), FIRE.bowl.flame, .45, nowMs);
  }

  /** The log fire: orange tongues rise from the whole bed between the logs and lick outwards. */
  private emitHearthFlame(emitter: Fire, night: number, nowMs: number): void {
    const a = Math.random() * Math.PI * 2, d = 5.5 * Math.sqrt(Math.random());
    const angle = Math.random() < .5 ? a + (Math.random() - .5) * 1.2 : BaseFortFx.tongue(emitter, nowMs, 1.6);
    this.lick(emitter.x + Math.cos(a) * d, emitter.y + Math.sin(a) * d,
      angle, .52 + Math.random() * .2, 840 + Math.random() * 360,
      (.25 + .08 * night) * BaseFortFx.dayFade(FIRE.hearth.dayAlpha, night), FIRE.hearth.flame, .5, nowMs);
  }

  /** The hearth's heart: larger, pale-yellow tongues from the middle of the logs, swaying together. */
  private emitHearthHeart(emitter: Fire, night: number, nowMs: number): void {
    this.lick(emitter.x + (Math.random() - .5) * 3, emitter.y + (Math.random() - .5) * 3,
      BaseFortFx.sway(emitter, nowMs) + (Math.random() - .5) * 2.4, .74 + Math.random() * .18, 900 + Math.random() * 300,
      (.22 + .08 * night) * BaseFortFx.dayFade(FIRE.hearth.dayAlpha, night), FIRE.hearth.heart, .2, nowMs);
  }

  /** A coal glowing up on the bed and dying down again; many of them make the bed shimmer. */
  private emitCoal(emitter: Fire, radius: number, nowMs: number): void {
    const spec = this.ember;
    const a = Math.random() * Math.PI * 2, d = radius * Math.sqrt(Math.random());
    spec.frame = GpuVfxFrameId.DeathGlow;
    spec.lifeMs = 1300 + Math.random() * 900;
    spec.x = emitter.x + Math.cos(a) * d; spec.y = emitter.y + Math.sin(a) * d;
    spec.vx = 0; spec.vy = 0;
    spec.scaleStart = .05 + Math.random() * .04; spec.scaleEnd = .035;
    spec.alphaStart = .85; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = COALS[Math.floor(Math.random() * COALS.length)];
    this.system.spawn(spec, this.emberSource, nowMs);
  }

  /** Sparks rise towards the camera: they drift out a little on every side, grow slightly and burn out. */
  private emitSpark(emitter: Fire, size: number, spread: number, tint: number, nowMs: number): void {
    const spec = this.ember;
    spec.frame = GpuVfxFrameId.DeathGlow;
    spec.lifeMs = 900 + Math.random() * 700;
    spec.x = emitter.x + (Math.random() - .5) * spread; spec.y = emitter.y + (Math.random() - .5) * spread;
    const a = Math.random() * Math.PI * 2, speed = 3 + Math.random() * 7;
    spec.vx = Math.cos(a) * speed + BREEZE.x * 2; spec.vy = Math.sin(a) * speed + BREEZE.y * 2;
    const scale = (.04 + Math.random() * .025) * size;
    spec.scaleStart = scale; spec.scaleEnd = scale * 1.25;
    spec.alphaStart = 1; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = tint;
    this.system.spawn(spec, this.emberSource, nowMs);
  }

  /**
   * Smoke rising towards the camera: born small over the flame, it swells, wanders and drifts off
   * slowly with the breeze. Visible by day; at night it is lit by the light map and thinner.
   */
  private emitSmoke(emitter: Fire, night: number, size: number, spread: number, nowMs: number): void {
    const spec = this.smoke;
    spec.lifeMs = 2400 + Math.random() * 750;
    spec.x = emitter.x + (Math.random() - .5) * spread; spec.y = emitter.y + (Math.random() - .5) * spread;
    const a = Math.random() * Math.PI * 2, wander = 1 + Math.random() * 2.5, drift = 2.5 + Math.random() * 2.5;
    spec.vx = BREEZE.x * drift + Math.cos(a) * wander; spec.vy = BREEZE.y * drift + Math.sin(a) * wander;
    spec.scaleStart = (.16 + Math.random() * .05) * size; spec.scaleEnd = (.7 + Math.random() * .2) * size;
    spec.alphaStart = .38 - .14 * night; spec.alphaEnd = 0;
    spec.rotation = Math.random() * Math.PI * 2; spec.angularVelocity = (Math.random() - .5) * .25;
    spec.tint = SMOKE;
    this.system.spawn(spec, this.smokeSource, nowMs);
  }

  destroy(): void {
    this.unregister();
    this.system.releaseSource(this.flameSource);
    this.system.releaseSource(this.emberSource);
    this.system.releaseSource(this.smokeSource);
    for (const effect of [GpuVfxEffectId.BaseFortFlame, GpuVfxEffectId.BaseFortEmber, GpuVfxEffectId.BaseFortSmoke]) {
      this.system.quality.resetCarry(effect);
    }
  }
}
