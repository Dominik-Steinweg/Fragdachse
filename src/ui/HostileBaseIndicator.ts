import { DEPTH, TEAM_RED_COLOR } from '../config';
import { getBaseWorldBounds } from '../arena/BaseRegistry';
import type { BaseManager } from '../entities/BaseManager';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';

const HOSTILE_BASE_EDGE_INSET_PX = 20;

export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorldViewRect extends WorldRect {
  readonly centerX: number;
  readonly centerY: number;
}

export interface CameraViewportTransform {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** Camera fields the visible-world-rect derivation needs. */
export interface CameraWorldViewSource {
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

/**
 * Tatsächlich sichtbarer Weltausschnitt der Kamera.
 *
 * Phasers `camera.worldView` zentriert das Sichtfeld um `scroll + camera.width / 2` und
 * unterstellt damit `origin = 0.5`. Die Arena-Kamera arbeitet mit `origin = (0, 0)`, dort gilt
 * `Screen = zoom * (Welt - scroll)` (siehe `graphics/RenderResolution`). `worldView` liegt
 * deshalb um `(camera.width - camera.width / zoom) / 2` Weltpixel daneben – bei Renderauflösung
 * 1 exakt null, bei höheren Auflösungen mehrere hundert Pixel.
 */
export function getVisibleWorldView(camera: CameraWorldViewSource): WorldViewRect {
  const zoom = Math.max(0.001, camera.zoom);
  const width = camera.width / zoom;
  const height = camera.height / zoom;
  const originPxX = camera.width * camera.originX;
  const originPxY = camera.height * camera.originY;
  const x = camera.scrollX + originPxX - originPxX / zoom;
  const y = camera.scrollY + originPxY - originPxY / zoom;
  return { x, y, width, height, centerX: x + width * 0.5, centerY: y + height * 0.5 };
}

/** True as soon as a world point enters the camera view. */
export function isWorldPointInsideView(x: number, y: number, view: WorldRect): boolean {
  return x >= view.x
    && x <= view.x + view.width
    && y >= view.y
    && y <= view.y + view.height;
}

/** Returns a point inset from the camera rectangle that lies on the target-facing edge. */
export function getArrowPointOnWorldViewEdge(
  targetX: number,
  targetY: number,
  view: WorldViewRect,
  inset = 10,
): { x: number; y: number } {
  const dx = targetX - view.centerX;
  const dy = targetY - view.centerY;
  const halfWidth = Math.max(1, view.width * 0.5 - inset);
  const halfHeight = Math.max(1, view.height * 0.5 - inset);
  const scaleX = Math.abs(dx) > 0.001 ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = Math.abs(dy) > 0.001 ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale)) return { x: view.centerX, y: view.centerY };
  return {
    x: view.centerX + dx * scale,
    y: view.centerY + dy * scale,
  };
}

/** Converts the target-facing world-view edge point into coordinates for a scroll-fixed overlay. */
export function getArrowPointOnScreenViewEdge(
  targetX: number,
  targetY: number,
  view: WorldViewRect,
  camera: CameraViewportTransform,
  inset = 10,
): { x: number; y: number } {
  const zoom = Math.max(0.001, camera.zoom);
  const edge = getArrowPointOnWorldViewEdge(targetX, targetY, view, inset / zoom);
  return {
    x: camera.x / zoom + edge.x - view.x,
    y: camera.y / zoom + edge.y - view.y,
  };
}

/** Points at the living hostile main base while keeping the arrow in the current camera view. */
export class HostileBaseIndicator {
  private readonly worldArrow: Phaser.GameObjects.Graphics;
  private readonly edgeArrow: Phaser.GameObjects.Graphics;
  private readonly bounceTween: Phaser.Tweens.Tween;
  private bounceOffset = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.worldArrow = scene.add.graphics()
      .setDepth(DEPTH.BASES + 8)
      .setVisible(false);
    this.edgeArrow = scene.add.graphics()
      .setDepth(DEPTH.OVERLAY)
      .setScrollFactor(0)
      .setVisible(false);
    // Nur der Randpfeil ist HUD. `worldArrow` steht in Weltkoordinaten und bleibt in der Welt.
    promoteToClarityCamera(scene, this.edgeArrow);
    this.drawArrow(this.worldArrow);
    this.drawArrow(this.edgeArrow);
    this.bounceTween = scene.tweens.add({
      targets: this,
      bounceOffset: 6,
      duration: 520,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      paused: true,
    });
  }

  sync(baseManager: BaseManager | null, active: boolean): void {
    const target = active ? baseManager?.getActiveMainBase('hostile') : undefined;
    if (!target) {
      this.worldArrow.setVisible(false);
      this.edgeArrow.setVisible(false);
      this.bounceTween.pause();
      return;
    }

    this.bounceTween.resume();
    const bounds = getBaseWorldBounds(target.spec.region);
    const targetX = bounds.x + bounds.width * 0.5;
    const targetY = bounds.y + bounds.height * 0.5;
    const camera = this.scene.cameras.main;
    const view = getVisibleWorldView(camera);
    // Der Weltpfeil sitzt über der Basismitte. Er darf deshalb erst übernehmen, wenn genau
    // dieser Punkt im Bild liegt – bei bloßer Überschneidung der Bounding-Box stünde er noch
    // außerhalb des Sichtfelds und es wäre für einen Moment gar kein Marker sichtbar.
    const targetVisible = isWorldPointInsideView(targetX, targetY, view);

    if (targetVisible) {
      const arrowX = targetX;
      const arrowY = bounds.y - 22 - this.bounceOffset;
      this.worldArrow
        .setPosition(arrowX, arrowY)
        .setRotation(Math.atan2(targetY - arrowY, targetX - arrowX) - Math.PI / 2)
        .setVisible(true);
      this.edgeArrow.setVisible(false);
      return;
    }

    // Der Sichtausschnitt ist in Weltkoordinaten ausgedrückt. Der Zoomausgleich hält den
    // Randabstand des Markers in Bildschirmnähe konstant.
    const edge = getArrowPointOnWorldViewEdge(
      targetX,
      targetY,
      view,
      HOSTILE_BASE_EDGE_INSET_PX / Math.max(0.001, camera.zoom),
    );
    const screenEdge = getArrowPointOnScreenViewEdge(
      targetX,
      targetY,
      view,
      camera,
      HOSTILE_BASE_EDGE_INSET_PX,
    );
    this.edgeArrow
      .setPosition(screenEdge.x, screenEdge.y)
      .setRotation(Math.atan2(targetY - edge.y, targetX - edge.x) - Math.PI / 2)
      .setVisible(true);
    this.worldArrow.setVisible(false);
  }

  /** Clears the round-owned marker state without destroying the scene-lifetime helper. */
  clear(): void {
    this.worldArrow.setVisible(false);
    this.edgeArrow.setVisible(false);
    this.bounceTween.pause();
  }

  destroy(): void {
    this.bounceTween.stop();
    this.worldArrow.destroy();
    this.edgeArrow.destroy();
  }

  private drawArrow(graphics: Phaser.GameObjects.Graphics): void {
    graphics.clear();
    graphics.fillStyle(TEAM_RED_COLOR, 0.95);
    graphics.fillTriangle(0, 13, -11, -8, 11, -8);
    graphics.lineStyle(2, 0xffe9df, 0.95);
    graphics.strokeTriangle(0, 13, -11, -8, 11, -8);
    graphics.fillStyle(0xffffff, 0.7);
    graphics.fillCircle(0, -2, 2);
  }
}
