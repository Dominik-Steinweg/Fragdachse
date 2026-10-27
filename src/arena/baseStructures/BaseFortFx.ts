import { GpuVfxFrameId } from '../../effects/gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from '../../effects/gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from '../../effects/gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from '../../effects/gpu/GpuVfxSystem';

/** Socket kinds of the fort asset that carry particles; positions are world pixels. */
export type BaseFortEmitterKind = 'torch' | 'torchlet' | 'lamp' | 'glade';
export interface BaseFortEmitter { readonly kind: BaseFortEmitterKind; readonly x: number; readonly y: number }

/** The breeze the asset's pennants show: towards world +X, a little north. */
const WIND = { x: 1, y: -.2 };
const WIND_ANGLE = Math.atan2(WIND.y, WIND.x);
const FLAME_TINTS = [0xffe4a8, 0xffbd5c, 0xff9a3c, 0xff7c2a] as const;

/**
 * One particle stream at an emitter: mean interval by day and at night (0 = silent), scaled by the
 * shared GPU quality. Night is the World's artificial-light factor (0 noon … 1 night).
 */
interface Channel {
  readonly emitter: BaseFortEmitter;
  readonly dayMs: number;
  readonly nightMs: number;
  readonly effect: GpuVfxEffectId;
  readonly spawn: (emitter: BaseFortEmitter, night: number, nowMs: number) => void;
  carry: number;
}

/**
 * GPU particles of the persistent base fort on the scene's shared VFX backend: licking flames,
 * embers and thin smoke at the torches, a breathing glow and moths at the lanterns, fireflies over
 * the moss at dusk. Allocation-free per frame; release kills the live members with their sources.
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

  constructor(private readonly system: GpuVfxSystem, emitters: readonly BaseFortEmitter[]) {
    this.flame = system.createSpec(GpuVfxEffectId.BaseFortFlame);
    this.ember = system.createSpec(GpuVfxEffectId.BaseFortEmber);
    this.smoke = system.createSpec(GpuVfxEffectId.BaseFortSmoke);
    this.flameSource = system.createSource(GpuVfxEffectId.BaseFortFlame);
    this.emberSource = system.createSource(GpuVfxEffectId.BaseFortEmber);
    this.smokeSource = system.createSource(GpuVfxEffectId.BaseFortSmoke);
    const flame = GpuVfxEffectId.BaseFortFlame, ember = GpuVfxEffectId.BaseFortEmber, smoke = GpuVfxEffectId.BaseFortSmoke;
    for (const emitter of emitters) {
      const add = (dayMs: number, nightMs: number, effect: GpuVfxEffectId, spawn: Channel['spawn']) =>
        this.channels.push({ emitter, dayMs, nightMs, effect, spawn, carry: Math.random() });
      switch (emitter.kind) {
        case 'torch':
          add(55, 45, flame, (e, n, t) => this.emitFlame(e, 1, n, t));
          add(120, 95, flame, (e, n, t) => this.emitTongue(e, 1, t));
          add(900, 380, ember, (e, n, t) => this.emitEmber(e, 1, t));
          add(700, 900, smoke, (e, n, t) => this.emitSmoke(e, n, t));
          break;
        case 'torchlet':
          add(80, 65, flame, (e, n, t) => this.emitFlame(e, .7, n, t));
          add(200, 160, flame, (e, n, t) => this.emitTongue(e, .7, t));
          add(1800, 900, ember, (e, n, t) => this.emitEmber(e, .7, t));
          break;
        case 'lamp':
          add(0, 700, ember, (e, n, t) => this.emitHalo(e, n, t));
          add(0, 1300, ember, (e, n, t) => this.emitMoth(e, t));
          break;
        case 'glade':
          add(0, 1100, ember, (e, n, t) => this.emitFirefly(e, t));
          break;
      }
    }
    this.unregister = system.registerEmission((deltaMs, nowMs) => this.emit(deltaMs, nowMs));
  }

  /** A fallen fort and a World without lighting stop emitting; live members fade out normally. */
  setActive(active: boolean): void { this.active = active; }

  setNight(night: number): void { this.night = Math.min(1, Math.max(0, night)); }

  private emit(deltaMs: number, nowMs: number): void {
    if (!this.active) return;
    const night = this.night;
    for (const channel of this.channels) {
      // Night-only streams fade in with the dusk instead of switching on at a threshold.
      const base = channel.dayMs > 0 ? channel.dayMs + (channel.nightMs - channel.dayMs) * night
        : night > .15 ? channel.nightMs / night : 0;
      const interval = base > 0 ? this.system.quality.scaleFrequency(base, channel.effect) : 0;
      if (interval <= 0) continue;
      channel.carry += deltaMs / interval;
      while (channel.carry >= 1) {
        channel.carry -= 1;
        channel.spawn(channel.emitter, night, nowMs);
      }
    }
  }

  /** The body of the flame: short round licks that lean and drift downwind. */
  private emitFlame(emitter: BaseFortEmitter, size: number, night: number, nowMs: number): void {
    const spec = this.flame;
    spec.frame = GpuVfxFrameId.FlameCore;
    spec.lifeMs = 200 + Math.random() * 180;
    spec.x = emitter.x + (Math.random() - .5) * 2.4 * size; spec.y = emitter.y + (Math.random() - .5) * 2.4 * size;
    const speed = 7 + Math.random() * 9;
    spec.vx = WIND.x * speed + (Math.random() - .5) * 5; spec.vy = WIND.y * speed + (Math.random() - .5) * 5;
    spec.scaleStart = (.26 + Math.random() * .1) * size; spec.scaleEnd = .06 * size;
    spec.alphaStart = .82 + .14 * night; spec.alphaEnd = 0;
    spec.rotation = Math.random() * Math.PI * 2; spec.angularVelocity = (Math.random() - .5) * 3;
    spec.tint = FLAME_TINTS[Math.floor(Math.random() * FLAME_TINTS.length)];
    this.system.spawn(spec, this.flameSource, nowMs);
  }

  /** Thin tongues licking off the flame's tip with the breeze. */
  private emitTongue(emitter: BaseFortEmitter, size: number, nowMs: number): void {
    const spec = this.flame;
    spec.frame = GpuVfxFrameId.FlameTongue;
    spec.lifeMs = 220 + Math.random() * 200;
    spec.x = emitter.x + WIND.x * 2 * size; spec.y = emitter.y + WIND.y * 2 * size;
    const lean = WIND_ANGLE + (Math.random() - .5) * .9, speed = 10 + Math.random() * 10;
    spec.vx = Math.cos(lean) * speed; spec.vy = Math.sin(lean) * speed;
    spec.scaleStart = (.2 + Math.random() * .08) * size; spec.scaleEnd = .05 * size;
    spec.alphaStart = .7; spec.alphaEnd = 0;
    spec.rotation = lean; spec.angularVelocity = (Math.random() - .5) * 1.5;
    spec.tint = Math.random() < .5 ? 0xff9a3c : 0xffb24e;
    this.system.spawn(spec, this.flameSource, nowMs);
  }

  /** Embers break off, ride the breeze and burn out. */
  private emitEmber(emitter: BaseFortEmitter, size: number, nowMs: number): void {
    const spec = this.ember;
    spec.frame = GpuVfxFrameId.DeathGlow;
    spec.lifeMs = 700 + Math.random() * 900;
    spec.x = emitter.x + (Math.random() - .5) * 3; spec.y = emitter.y + (Math.random() - .5) * 3;
    const speed = 12 + Math.random() * 18;
    spec.vx = WIND.x * speed + (Math.random() - .5) * 12; spec.vy = WIND.y * speed + (Math.random() - .5) * 12;
    spec.scaleStart = (.11 + Math.random() * .05) * size; spec.scaleEnd = .03;
    spec.alphaStart = 1; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = Math.random() < .35 ? 0xffd27a : 0xff7a2a;
    this.system.spawn(spec, this.emberSource, nowMs);
  }

  /** Thin pitch smoke, visible by day; at night it is lit by the light map and mostly gone. */
  private emitSmoke(emitter: BaseFortEmitter, night: number, nowMs: number): void {
    const spec = this.smoke;
    spec.lifeMs = 2000 + Math.random() * 1200;
    spec.x = emitter.x + WIND.x * 3; spec.y = emitter.y + WIND.y * 3;
    const speed = 7 + Math.random() * 6;
    spec.vx = WIND.x * speed + (Math.random() - .5) * 3; spec.vy = WIND.y * speed + (Math.random() - .5) * 3;
    spec.scaleStart = .1 + Math.random() * .04; spec.scaleEnd = .42 + Math.random() * .16;
    spec.alphaStart = .26 - .1 * night; spec.alphaEnd = 0;
    spec.rotation = Math.random() * Math.PI * 2; spec.angularVelocity = (Math.random() - .5) * .6;
    spec.tint = 0x5f5850;
    this.system.spawn(spec, this.smokeSource, nowMs);
  }

  /** A slow, soft breathing of the lantern glass at dusk and night. */
  private emitHalo(emitter: BaseFortEmitter, night: number, nowMs: number): void {
    const spec = this.ember;
    spec.frame = GpuVfxFrameId.DeathGlow;
    spec.lifeMs = 1300 + Math.random() * 400;
    spec.x = emitter.x; spec.y = emitter.y; spec.vx = 0; spec.vy = 0;
    spec.scaleStart = .75 + Math.random() * .15; spec.scaleEnd = 1.15;
    spec.alphaStart = .14 * night; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = 0xffc070;
    this.system.spawn(spec, this.emberSource, nowMs);
  }

  /** Moths flitting through the lantern light: pale specks on short crossing arcs. */
  private emitMoth(emitter: BaseFortEmitter, nowMs: number): void {
    const spec = this.ember;
    spec.frame = GpuVfxFrameId.DeathGlow;
    const angle = Math.random() * Math.PI * 2, radius = 5 + Math.random() * 8;
    spec.lifeMs = 450 + Math.random() * 400;
    spec.x = emitter.x + Math.cos(angle) * radius; spec.y = emitter.y + Math.sin(angle) * radius;
    const turn = angle + (Math.random() < .5 ? 1 : -1) * Math.PI / 2, speed = 18 + Math.random() * 16;
    spec.vx = Math.cos(turn) * speed; spec.vy = Math.sin(turn) * speed;
    spec.scaleStart = .1; spec.scaleEnd = .08;
    spec.alphaStart = .75; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = 0xfff0d6;
    this.system.spawn(spec, this.emberSource, nowMs);
  }

  /** Fireflies over the moss: a slow drift and a single fading blink each. */
  private emitFirefly(emitter: BaseFortEmitter, nowMs: number): void {
    const spec = this.ember;
    spec.frame = GpuVfxFrameId.DeathGlow;
    const angle = Math.random() * Math.PI * 2, speed = 3 + Math.random() * 6;
    spec.lifeMs = 1500 + Math.random() * 1100;
    spec.x = emitter.x + (Math.random() - .5) * 44; spec.y = emitter.y + (Math.random() - .5) * 44;
    spec.vx = Math.cos(angle) * speed; spec.vy = Math.sin(angle) * speed;
    spec.scaleStart = .22; spec.scaleEnd = .14;
    spec.alphaStart = .85; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = 0xd8f27a;
    this.system.spawn(spec, this.emberSource, nowMs);
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
