import * as Phaser from 'phaser';
import { DEPTH_FX, VOID_PALETTE } from '../../config';
import type { ResolvedCoopDefensePortalLinkConfig } from '../../config/coopDefensePortalLinks';
import type { PortalLinkEndpoints, PortalLinkStateEntry } from '../../systems/portal/PortalLinkSystem';
import { makeAdditive, registerGraphicsObject } from '../EffectUtils';
import { resolveVoidPortalViews, VoidPortalTransitionTracker, type VoidPortalLinkView } from './VoidPortalModel';

export interface VoidPortalScenario {
  readonly links: readonly ResolvedCoopDefensePortalLinkConfig[];
  readonly endpoints: ReadonlyMap<string, PortalLinkEndpoints>;
}

/**
 * Draft look of generator portals (M3 placeholder): violet apertures that charge, hold open and
 * implode. It only reads the replicated lifecycle; the production look follows in M5.
 */
export class VoidPortalRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly transitions = new VoidPortalTransitionTracker();
  private readonly transient = new Map<Phaser.GameObjects.Graphics, Phaser.Tweens.Tween>();
  private lastViews: VoidPortalLinkView[] = [];
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(DEPTH_FX - 0.2);
    registerGraphicsObject(scene, 'teleportEffects', this.graphics);
  }

  sync(scenario: VoidPortalScenario | null, entries: readonly PortalLinkStateEntry[] | null, elapsedMs: number): void {
    if (this.destroyed) return;
    const views = scenario ? resolveVoidPortalViews(scenario.links, scenario.endpoints, entries, elapsedMs) : [];
    for (const event of this.transitions.observe(scenario ? entries : null)) {
      const last = this.lastViews.find((view) => view.id === event.id);
      const ends = scenario?.endpoints.get(event.id);
      const radius = scenario?.links.find((link) => link.id === event.id)?.collapse.radiusPx ?? 96;
      if (ends) this.playCollapse(ends, event.wasOpen ? radius : (last?.radius ?? 28) * 1.5);
    }
    this.lastViews = views;
    const g = this.graphics;
    g.clear();
    for (const view of views) for (const [end, exit] of [[view.a, false], [view.b, true]] as const) {
      if (view.phase === 'charging') this.drawCharging(g, end.x, end.y, view, exit, elapsedMs);
      else this.drawOpen(g, end.x, end.y, view, elapsedMs);
    }
  }

  hide(): void {
    if (this.destroyed) return;
    this.graphics.clear();
    this.transitions.reset();
    this.lastViews = [];
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [g, tween] of this.transient) { tween.remove(); g.destroy(); }
    this.transient.clear();
    this.graphics.destroy();
  }

  private drawCharging(g: Phaser.GameObjects.Graphics, x: number, y: number, view: VoidPortalLinkView,
    exit: boolean, elapsedMs: number): void {
    const r = view.radius, f = view.chargeFraction;
    const flicker = exit ? 0.55 + 0.45 * Math.abs(Math.sin(elapsedMs * 0.011) * Math.sin(elapsedMs * 0.0047)) : 1;
    g.fillStyle(VOID_PALETTE.shadow, 0.55 * f * flicker).fillCircle(x, y, r * (0.35 + 0.55 * f));
    g.lineStyle(1.2, VOID_PALETTE.deep, (0.35 + 0.4 * f) * flicker).strokeCircle(x, y, r);
    g.lineStyle(2, VOID_PALETTE.bright, 0.85 * flicker);
    g.beginPath().arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2).strokePath();
    if (exit) {
      // The tear at the exit telegraphs where the flank will open.
      g.lineStyle(1.4, VOID_PALETTE.primary, 0.7 * flicker * f);
      g.lineBetween(x - r * 0.6, y - r * 0.2, x + r * 0.55, y + r * 0.25);
      g.lineBetween(x - r * 0.15, y - r * 0.55, x + r * 0.1, y + r * 0.5);
    }
  }

  private drawOpen(g: Phaser.GameObjects.Graphics, x: number, y: number, view: VoidPortalLinkView, elapsedMs: number): void {
    const r = view.radius, opening = Math.min(1, view.openAgeMs / 400);
    const pulse = (1 + Math.sin(elapsedMs * 0.006)) / 2;
    g.fillStyle(VOID_PALETTE.shadow, 0.95 * opening).fillCircle(x, y, r);
    g.fillStyle(VOID_PALETTE.deep, 0.22 * opening).fillCircle(x, y, r * 0.82);
    g.fillStyle(0x050008, 0.85 * opening).fillCircle(x, y, r * 0.58);
    g.lineStyle(8, VOID_PALETTE.primary, 0.06 * opening).strokeCircle(x, y, r);
    g.lineStyle(3, VOID_PALETTE.primary, 0.22 * opening).strokeCircle(x, y, r);
    g.lineStyle(1.6, VOID_PALETTE.bright, (0.7 + 0.3 * pulse) * opening).strokeCircle(x, y, r);
    const phase = -elapsedMs * 0.0018;
    for (let i = 0; i < 4; i++) {
      const angle = phase + i * Math.PI / 2;
      for (let segment = 0; segment < 8; segment++) {
        const t = segment / 8, next = (segment + 1) / 8;
        const a = angle - t * 1.9, b = angle - next * 1.9;
        const ra = r * (0.86 - t * 0.55), rb = r * (0.86 - next * 0.55);
        g.lineStyle(1.5 * (1 - t), VOID_PALETTE.bright, (0.55 - t * 0.4) * opening);
        g.lineBetween(x + Math.cos(a) * ra, y + Math.sin(a) * ra, x + Math.cos(b) * rb, y + Math.sin(b) * rb);
      }
    }
  }

  private playCollapse(ends: PortalLinkEndpoints, radius: number): void {
    const g = this.scene.add.graphics().setDepth(DEPTH_FX);
    registerGraphicsObject(this.scene, 'teleportEffects', g);
    makeAdditive(g);
    const draw = (t: number) => {
      g.clear();
      for (const point of [ends.a, ends.b]) {
        const r = Math.max(1, radius * (1 - t) ** 1.6);
        g.lineStyle(2.2, VOID_PALETTE.bright, Math.sin(t * Math.PI) * 0.75).strokeCircle(point.x, point.y, r);
        g.fillStyle(VOID_PALETTE.primary, (1 - t) * 0.16).fillCircle(point.x, point.y, Math.min(24, r));
        g.lineStyle(1.2, VOID_PALETTE.core, (1 - t) * 0.5);
        for (let i = 0; i < 10; i++) {
          const angle = i * Math.PI / 5 + t * 1.2;
          g.lineBetween(point.x + Math.cos(angle) * r, point.y + Math.sin(angle) * r,
            point.x + Math.cos(angle) * r * 0.75, point.y + Math.sin(angle) * r * 0.75);
        }
      }
    };
    draw(0);
    const tween = this.scene.tweens.addCounter({ from: 0, to: 1, duration: 420,
      onUpdate: (counter) => draw(counter.getValue() ?? 0),
      onComplete: () => { this.transient.delete(g); g.destroy(); },
    });
    this.transient.set(g, tween);
  }
}
