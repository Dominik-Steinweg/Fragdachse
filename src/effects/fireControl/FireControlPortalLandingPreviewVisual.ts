import type * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { createFireControlPortalGpuLayer, type FireControlPortalGpuLayer } from './FireControlPortalGpuLayer';
import { FireControlGpuKind as Kind, FireControlPortalGpuStore } from './FireControlPortalGpuStore';

/** Same radius as the live exit, so the preview reads as "the exit opens here". */
const EXIT_RADIUS = 23;
/** Dimmed: a preview, not an open portal, but bright enough to read at night (G2 review). */
const PREVIEW_OPEN = 0.55;
const FADE_IN_MS = 150;

/**
 * Landing-point preview of a charged portal throw (D43): one dimmed GPU exit ring at the predicted
 * exit. Local presentation only; the host corrects the actual landing authoritatively (D39).
 */
export class FireControlPortalLandingPreviewVisual {
  private readonly store = new FireControlPortalGpuStore();
  private readonly layer: FireControlPortalGpuLayer | null;
  private shownAt: number | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.layer = createFireControlPortalGpuLayer(scene, this.store);
    this.layer?.image.setDepth(DEPTH.OVERLAY - 1.02);
  }

  update(point: { readonly x: number; readonly y: number } | undefined, now: number): void {
    if (this.destroyed) return;
    if (!point) { this.hide(); return; }
    this.shownAt ??= now;
    this.store.begin(now);
    this.store.add({ x: point.x, y: point.y, radius: EXIT_RADIUS, angle: 0, kind: Kind.Exit,
      open: PREVIEW_OPEN * Math.min(1, (now - this.shownAt) / FADE_IN_MS), remaining: 1, flash: 0 });
  }

  hide(): void {
    if (this.destroyed || this.shownAt === null) return;
    this.shownAt = null;
    this.store.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.store.clear();
    this.layer?.destroy();
  }
}
