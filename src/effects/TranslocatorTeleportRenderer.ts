import * as Phaser from 'phaser';
import { DEPTH_FX } from '../config';
import { makeAdditive, mixColors, registerGraphicsObject } from './EffectUtils';
import type { LightingSystem } from './LightingSystem';
import type { PortalPair } from '../systems/PortalTraversal';

const BLUE = 0x55bbff, ORANGE = 0xff9b45;

/** World-scoped orthographic apertures and their short-lived transfer feedback. */
export class TranslocatorTeleportRenderer {
  private lighting: LightingSystem | null = null;
  private readonly portals = new Map<string, { pair: PortalPair; graphics: Phaser.GameObjects.Graphics }>();
  private readonly transient = new Set<Phaser.GameObjects.Graphics>();
  private readonly animations = new Map<Phaser.GameObjects.Graphics, Phaser.Tweens.Tween>();
  constructor(private readonly scene: Phaser.Scene) {}
  setLightingSystem(lighting: LightingSystem | null): void { this.lighting = lighting; }

  syncPortals(pairs: readonly PortalPair[], now: number): void {
    const present = new Set<string>();
    for (const pair of pairs) {
      present.add(pair.id);
      let visual = this.portals.get(pair.id);
      if (!visual) {
        const graphics = this.scene.add.graphics().setDepth(DEPTH_FX - 0.2);
        registerGraphicsObject(this.scene, 'teleportEffects', graphics);
        visual = { pair, graphics };
        this.portals.set(pair.id, visual);
      }
      const g = visual.graphics;
      g.clear();
      const age = Math.max(0, now - pair.createdAt);
      const remaining = Math.max(0, pair.expiresAt - now);
      const fraction = Math.min(1, remaining / Math.max(1, pair.expiresAt - pair.createdAt));
      const opening = Math.min(1, age / 150);
      const pulse = (1 + Math.sin(age * (remaining <= 500 ? 0.045 : 0.008))) / 2;
      for (const [end, color] of [[pair.a, BLUE], [pair.b, ORANGE]] as const) {
        const { x, y } = end, r = pair.radius;
        // Dark center holds contrast against terrain; the bright outer edge is the exact trigger radius.
        g.fillStyle(0x08101e, 0.86 * opening).fillCircle(x, y, r);
        g.fillStyle(color, (0.11 + pulse * 0.08) * opening).fillCircle(x, y, r - 1);
        g.lineStyle(1.8, color, 0.78 + pulse * 0.22).strokeCircle(x, y, r);
        g.lineStyle(1, mixColors(color, 0xffffff, 0.7), 0.25 + pulse * 0.25).strokeCircle(x, y, r - 1.5);
        const phase = age * 0.0015;
        g.lineStyle(1, color, 0.45 * opening);
        for (let i = 0; i < 3; i++) {
          const angle = phase + i * Math.PI * 2 / 3;
          g.beginPath().arc(x, y, (r - 7) * opening, angle, angle + 1.15).strokePath();
        }
        // Both endpoints use the same host timestamps, pulse and clockwise lifetime meter.
        if (fraction > 0) {
          g.lineStyle(2.1, remaining <= 500 ? 0xfff1d0 : mixColors(color, 0xffffff, 0.55), 0.95);
          g.beginPath().arc(x, y, r - 4, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2).strokePath();
        }
        if (age < 150) {
          g.lineStyle(2, 0xffffff, (1 - opening) * 0.8).strokeCircle(x, y, r * opening);
        }
      }
    }
    for (const [id, visual] of this.portals) if (!present.has(id)) {
      visual.graphics.destroy();
      this.portals.delete(id);
    }
  }

  playFlash(x: number, y: number, color: number, type: 'start' | 'end'): void {
    const start = type === 'start';
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
    for (const visual of this.portals.values()) visual.graphics.destroy();
    this.portals.clear();
    for (const tween of this.animations.values()) tween.remove();
    this.animations.clear();
    for (const g of this.transient) g.destroy();
    this.transient.clear();
    this.lighting = null;
  }
}
