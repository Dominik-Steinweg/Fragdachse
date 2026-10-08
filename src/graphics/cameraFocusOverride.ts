import type * as Phaser from 'phaser';

/**
 * Zeitlich begrenzter, rein lokaler Kamerafokus für inszenierte Momente (z. B. ein Boss-Intro).
 *
 * Die Kameraverfolgung blendet ihr Spielerziel mit `weight` (0..1) zum Fokuspunkt über. Eine
 * Präsentationsquelle setzt den Wert pro Frame und nimmt ihn mit `weight = 0` bzw.
 * {@link clearCameraFocusOverride} wieder weg. Wie beim Basis-Scroll eine WeakMap pro Scene,
 * damit Renderer keine Abhängigkeit auf die Kameraverfolgung bekommen.
 */
interface CameraFocusOverride {
  x: number;
  y: number;
  weight: number;
  /** Zusaetzlicher Zoomfaktor (>= 1) bei voller Gewichtung; wird mit `weight` eingeblendet. */
  zoom: number;
}

const focusByScene = new WeakMap<Phaser.Scene, CameraFocusOverride>();

export function setCameraFocusOverride(scene: Phaser.Scene, x: number, y: number, weight: number, zoom = 1): void {
  const clamped = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
  if (clamped <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
    focusByScene.delete(scene);
    return;
  }
  const entry = focusByScene.get(scene);
  if (entry) {
    entry.x = x;
    entry.y = y;
    entry.weight = clamped;
    entry.zoom = Number.isFinite(zoom) ? Math.max(1, zoom) : 1;
    return;
  }
  focusByScene.set(scene, { x, y, weight: clamped, zoom: Number.isFinite(zoom) ? Math.max(1, zoom) : 1 });
}

export function clearCameraFocusOverride(scene: Phaser.Scene): void {
  focusByScene.delete(scene);
}

/** Effektiver Zoomfaktor des aktuellen Fokus (1 = kein Zoom). */
export function resolveCameraFocusZoom(focus: Readonly<CameraFocusOverride> | null): number {
  return focus ? 1 + (focus.zoom - 1) * focus.weight : 1;
}

export function getCameraFocusOverride(scene: Phaser.Scene): Readonly<CameraFocusOverride> | null {
  return focusByScene.get(scene) ?? null;
}
