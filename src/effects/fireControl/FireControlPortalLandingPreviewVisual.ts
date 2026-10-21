import type * as Phaser from 'phaser';
import { PORTAL_PREVIEW_PASS_DEPTHS } from '../gpu/PortalGpuLayer';
import { PortalPresentation } from '../portal/PortalPresentation';

/** Same radius as the live exit, so the preview reads as "the exit opens here". */
const EXIT_RADIUS = 23;
/** Dimmed: a preview, not an open portal, but bright enough to read at night (G2 review). */
const PREVIEW_INTENSITY = 0.55;
const FADE_IN_MS = 150;
const OWNER = 'fire-control-landing';

/**
 * Landing-point preview of a charged portal throw (D43): a dimmed, breathing exit in the shared
 * portal look at the predicted exit, above the world like other aiming aids. Local presentation
 * only; the host corrects the actual landing authoritatively (D39).
 */
export class FireControlPortalLandingPreviewVisual {
  private readonly portals: PortalPresentation;
  private shownAt: number | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.portals = new PortalPresentation(scene, null, PORTAL_PREVIEW_PASS_DEPTHS);
  }

  update(point: { readonly x: number; readonly y: number } | undefined, now: number): void {
    if (this.destroyed) return;
    if (!point) { this.hide(); return; }
    this.shownAt ??= now;
    this.portals.submit(OWNER, [{ key: 'landing', x: point.x, y: point.y, radius: EXIT_RADIUS, style: 'fire-control',
      open: Math.min(1, (now - this.shownAt) / FADE_IN_MS), intensity: PREVIEW_INTENSITY, pulse: true, particles: 0.35 }]);
  }

  hide(): void {
    if (this.destroyed || this.shownAt === null) return;
    this.shownAt = null;
    this.portals.clear(OWNER);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.portals.destroy();
  }
}
