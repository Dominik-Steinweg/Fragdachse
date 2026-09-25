import * as Phaser from 'phaser';
import { DEPTH_FX } from '../config';
import { makeAdditive, mixColors, registerGraphicsObject } from './EffectUtils';
import type { LightingSystem } from './LightingSystem';
import type { PortalPair } from '../systems/PortalTraversal';
import { GpuVfxFrameId, getGpuVfxFrame } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';

const BLUE = 0x55bbff, ORANGE = 0xff9b45;
const EFFECT = GpuVfxEffectId.TranslocatorPortal;
interface PortalVisual {
  pair: PortalPair;
  graphics: Phaser.GameObjects.Graphics;
  source: number;
  nextEmission: number;
  age: number;
}
interface PortalBurst { x: number; y: number; color: number; radius: number; inward: boolean }

/** World-scoped orthographic apertures and their short-lived transfer feedback. */
export class TranslocatorTeleportRenderer {
  private lighting: LightingSystem | null = null;
  private readonly portals = new Map<string, PortalVisual>();
  private readonly transient = new Set<Phaser.GameObjects.Graphics>();
  private readonly animations = new Map<Phaser.GameObjects.Graphics, Phaser.Tweens.Tween>();
  private readonly spec: GpuVfxSpawnSpec;
  private readonly burstSource: number;
  private readonly stopEmission: () => void;
  private readonly bursts: PortalBurst[] = [];
  private generation: number;
  private captured = false;
  private destroyed = false;
  constructor(private readonly scene: Phaser.Scene, private readonly gpu: GpuVfxSystem) {
    this.spec = gpu.createSpec(EFFECT);
    this.burstSource = gpu.createSource(EFFECT);
    this.generation = gpu.emissionGeneration;
    this.stopEmission = gpu.registerEmission((_delta, now) => this.emitParticles(now));
  }
  setLightingSystem(lighting: LightingSystem | null): void { this.lighting = lighting; }

  syncPortals(pairs: readonly PortalPair[], now: number): void {
    this.captured = true;
    const present = new Set<string>();
    for (const pair of pairs) {
      present.add(pair.id);
      let visual = this.portals.get(pair.id);
      if (!visual) {
        const graphics = this.scene.add.graphics().setDepth(DEPTH_FX - 0.2);
        registerGraphicsObject(this.scene, 'teleportEffects', graphics);
        visual = { pair, graphics, source: this.gpu.createSource(EFFECT), nextEmission: 0, age: 0 };
        this.portals.set(pair.id, visual);
        if (now - pair.createdAt < 250) {
          this.queueBurst(pair.a.x, pair.a.y, BLUE, pair.radius, false);
          this.queueBurst(pair.b.x, pair.b.y, ORANGE, pair.radius, false);
        }
      }
      visual.pair = pair;
      const g = visual.graphics;
      g.clear();
      const age = Math.max(0, now - pair.createdAt);
      visual.age = age;
      const remaining = Math.max(0, pair.expiresAt - now);
      const fraction = Math.min(1, remaining / Math.max(1, pair.expiresAt - pair.createdAt));
      const opening = Math.min(1, age / 150);
      const pulse = (1 + Math.sin(age * (remaining <= 500 ? 0.045 : 0.008))) / 2;
      for (const [end, color] of [[pair.a, BLUE], [pair.b, ORANGE]] as const) {
        const { x, y } = end, r = pair.radius;
        // Dark center holds contrast against terrain; the bright outer edge is the exact trigger radius.
        g.fillStyle(0x030916, 0.94 * opening).fillCircle(x, y, r);
        g.fillStyle(color, 0.14 * opening).fillCircle(x, y, r * 0.82);
        g.fillStyle(0x030916, 0.78 * opening).fillCircle(x, y, r * 0.6);
        // Nested soft bands keep the aperture legible even when decorative particles are reduced.
        g.lineStyle(8, color, 0.045 * opening).strokeCircle(x, y, r);
        g.lineStyle(4, color, 0.15 * opening).strokeCircle(x, y, r);
        g.lineStyle(1.7, color, (0.78 + pulse * 0.22) * opening).strokeCircle(x, y, r);
        g.lineStyle(0.7, mixColors(color, 0xffffff, 0.75), 0.85 * opening).strokeCircle(x, y, r - 0.6);
        const phase = age * 0.002;
        for (let i = 0; i < 3; i++) {
          const angle = phase + i * Math.PI * 2 / 3;
          // Tapered spiral filaments draw the eye into the dark throat, in the ground plane.
          for (let segment = 0; segment < 8; segment++) {
            const t = segment / 8, next = (segment + 1) / 8;
            const a = angle + t * 1.7, b = angle + next * 1.7;
            const ra = r * (0.82 - t * 0.5), rb = r * (0.82 - next * 0.5);
            g.lineStyle(1.4 * (1 - t), color, (0.5 - t * 0.38) * opening);
            g.lineBetween(x + Math.cos(a) * ra, y + Math.sin(a) * ra,
              x + Math.cos(b) * rb, y + Math.sin(b) * rb);
          }
        }
        // Both endpoints use the same host timestamps, pulse and clockwise lifetime meter.
        if (fraction > 0) {
          g.lineStyle(1.2, remaining <= 500 ? 0xfff1d0 : mixColors(color, 0xffffff, 0.55), 0.65 * opening);
          g.beginPath().arc(x, y, r + 4.5, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2).strokePath();
        }
        if (age < 150) {
          g.lineStyle(2, 0xffffff, (1 - opening) * 0.8).strokeCircle(x, y, r * opening);
        }
      }
    }
    for (const [id, visual] of this.portals) if (!present.has(id)) {
      visual.graphics.destroy();
      this.gpu.releaseSource(visual.source);
      this.portals.delete(id);
    }
  }

  playFlash(x: number, y: number, color: number, type: 'start' | 'end'): void {
    const start = type === 'start';
    this.queueBurst(x, y, color, start ? 24 : 18, start);
    this.lighting?.pulse('teleportFlash', x, y, {
      color: mixColors(color, 0xffffff, 0.55), radiusPx: start ? 110 : 150,
    });
    this.animate(start ? 200 : 300, (g, t) => {
      const radius = start ? 22 * (1 - t) + 3 : 6 + 32 * t;
      g.lineStyle(2 * (1 - t) + 0.5, color, 0.85 * (1 - t)).strokeCircle(x, y, radius);
      g.fillStyle(0xffffff, (1 - t) ** 3 * 0.9).fillCircle(x, y, 10 * (1 - t));
      g.lineStyle(1.2, mixColors(color, 0xffffff, 0.45), 0.75 * (1 - t));
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + 0.2;
        const inner = radius + 3, outer = radius + 6 * (1 - t);
        g.lineBetween(x + Math.cos(a) * inner, y + Math.sin(a) * inner,
          x + Math.cos(a) * outer, y + Math.sin(a) * outer);
      }
    });
  }

  playCollapse(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): void {
    this.queueBurst(a.x, a.y, BLUE, radius, true);
    this.queueBurst(b.x, b.y, ORANGE, radius, true);
    this.animate(250, (g, t) => {
      for (const [point, color] of [[a, BLUE], [b, ORANGE]] as const) {
        const r = Math.max(1, radius * (1 - t) ** 2);
        g.lineStyle(1.4, color, Math.sin(t * Math.PI) * 0.55).strokeCircle(point.x, point.y, r);
        g.fillStyle(color, (1 - t) * 0.1).fillCircle(point.x, point.y, Math.min(16, r));
        g.lineStyle(1, color, (1 - t) * 0.45);
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4;
          g.lineBetween(point.x + Math.cos(angle) * r, point.y + Math.sin(angle) * r,
            point.x + Math.cos(angle) * r * 0.8, point.y + Math.sin(angle) * r * 0.8);
        }
      }
    });
  }

  private queueBurst(x: number, y: number, color: number, radius: number, inward: boolean): void {
    if (this.generation !== this.gpu.emissionGeneration) {
      this.bursts.length = 0;
      this.generation = this.gpu.emissionGeneration;
    }
    if (this.bursts.length < 32 && !this.gpu.isSuppressed()) this.bursts.push({ x, y, color, radius, inward });
  }

  /** Runs after the shared pool's retire sweep; motion, rotation and fading then run on the GPU. */
  private emitParticles(now: number): void {
    if (this.generation !== this.gpu.emissionGeneration || this.gpu.isSuppressed()) {
      this.bursts.length = 0;
      this.generation = this.gpu.emissionGeneration;
      this.captured = false;
      return;
    }
    const view = this.scene.cameras.main.worldView;
    const visible = (x: number, y: number, r: number) => x + r >= view.x && y + r >= view.y
      && x - r <= view.right && y - r <= view.bottom;
    for (const burst of this.bursts) {
      if (this.burstSource < 0 || !visible(burst.x, burst.y, burst.radius + 32)) continue;
      const count = this.gpu.quality.scaleDiscreteBurst(EFFECT, 24);
      for (let i = 0; i < count; i++) {
        const angle = i * Math.PI * 2 / count + Math.random() * 0.15;
        const from = burst.inward ? burst.radius : burst.radius * 0.35;
        const to = burst.inward ? 1 : burst.radius + 18 + Math.random() * 14;
        this.particle(burst.x + Math.cos(angle) * from, burst.y + Math.sin(angle) * from,
          burst.x + Math.cos(angle + 0.35) * to, burst.y + Math.sin(angle + 0.35) * to,
          burst.color, 2 + Math.random() * 2, 300 + Math.random() * 180, this.burstSource, now, false);
      }
      const s = this.spec;
      s.frame = GpuVfxFrameId.ExplosionRing;
      s.x = burst.x; s.y = burst.y; s.vx = 0; s.vy = 0;
      s.rotation = 0; s.angularVelocity = 0; s.lifeMs = 320;
      s.scaleStart = (burst.inward ? burst.radius * 2 : 4) / getGpuVfxFrame(s.frame).width;
      s.scaleEnd = (burst.inward ? 2 : burst.radius * 3) / getGpuVfxFrame(s.frame).width;
      s.stretchStart = 1; s.stretchEnd = 1; s.alphaStart = 0.65; s.tint = burst.color;
      this.gpu.spawn(s, this.burstSource, now);
    }
    this.bursts.length = 0;
    if (!this.captured) return;
    this.captured = false;
    const interval = this.gpu.quality.scaleFrequency(32, EFFECT);
    for (const visual of this.portals.values()) {
      if (!interval || visual.source < 0 || now < visual.nextEmission) continue;
      visual.nextEmission = now + interval; // No backlog after pauses, offscreen time or admission drops.
      for (const [end, color] of [[visual.pair.a, BLUE], [visual.pair.b, ORANGE]] as const) {
        const r = visual.pair.radius;
        if (!visible(end.x, end.y, r + 24)) continue;
        for (let i = 0; i < 3; i++) {
          const angle = visual.age * 0.002 + i * Math.PI * 2 / 3 + Math.random() * 0.5;
          const from = r * (0.92 + Math.random() * 0.12);
          const to = r * (i === 0 ? 0.35 : 1.06);
          const x = end.x + Math.cos(angle) * from, y = end.y + Math.sin(angle) * from;
          const tx = end.x + Math.cos(angle + 0.65) * to, ty = end.y + Math.sin(angle + 0.65) * to;
          this.particle(x, y, tx, ty, color, 2 + Math.random() * 1.4, 260 + Math.random() * 180, visual.source, now, false);
          if (i === 0) this.particle(x, y, tx, ty, color, 12, 360, visual.source, now, true);
        }
      }
    }
  }

  private particle(x: number, y: number, tx: number, ty: number, color: number, size: number,
    lifeMs: number, source: number, now: number, glow: boolean): void {
    const s = this.spec;
    s.frame = glow ? GpuVfxFrameId.DeathGlow : GpuVfxFrameId.ExplosionSpark;
    s.x = x; s.y = y; s.lifeMs = lifeMs;
    s.vx = (tx - x) * 1000 / lifeMs; s.vy = (ty - y) * 1000 / lifeMs;
    s.positionEase = GpuVfxEase.QuadOut;
    s.rotation = Math.atan2(ty - y, tx - x); s.angularVelocity = 2.5;
    s.scaleStart = size / getGpuVfxFrame(s.frame).width; s.scaleEnd = s.scaleStart * 0.12;
    s.stretchStart = glow ? 1 : 2.8; s.stretchEnd = 1;
    s.alphaStart = glow ? 0.3 : 0.9; s.alphaEnd = 0; s.alphaEase = GpuVfxEase.Linear;
    s.tint = color; s.tintBlendStart = glow ? 1 : 0.35; s.tintBlendEnd = 1;
    this.gpu.spawn(s, source, now);
  }

  private animate(duration: number, draw: (g: Phaser.GameObjects.Graphics, t: number) => void): void {
    const g = this.scene.add.graphics().setDepth(DEPTH_FX);
    registerGraphicsObject(this.scene, 'teleportEffects', g);
    makeAdditive(g);
    this.transient.add(g);
    draw(g, 0);
    const animation = this.scene.tweens.addCounter({ from: 0, to: 1, duration,
      onUpdate: tween => { g.clear(); draw(g, tween.getValue() ?? 0); },
      onComplete: () => { this.animations.delete(g); this.transient.delete(g); g.destroy(); },
    });
    this.animations.set(g, animation);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopEmission();
    this.bursts.length = 0;
    this.gpu.releaseSource(this.burstSource);
    for (const visual of this.portals.values()) {
      visual.graphics.destroy();
      this.gpu.releaseSource(visual.source);
    }
    this.portals.clear();
    for (const tween of this.animations.values()) tween.remove();
    this.animations.clear();
    for (const g of this.transient) g.destroy();
    this.transient.clear();
    this.lighting = null;
  }
}
