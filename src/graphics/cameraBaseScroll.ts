import type * as Phaser from 'phaser';

/**
 * Kameraposition **ohne** den visuellen Versatz des Kamera-Feedbacks.
 *
 * Der Versatz aus {@link CameraFeedbackController} liegt in `camera.scrollX/scrollY` und wird
 * bewusst erst am Ende des Frames aufgetragen, damit Schatten, Licht und Rendering ihn sehen.
 * Alles, was daraus eine **Spielrichtung** ableitet, muss dagegen gegen den unversetzten Wert
 * rechnen – sonst verschiebt jedes Rumpeln die Zielerfassung, und aus einem reinen Bildeffekt
 * würde eine Gameplay-Änderung.
 *
 * Bewusst ein Modul mit WeakMap statt eines Feldes auf `ArenaScene`: `AimSystem` und
 * `InputSystem` sollen dafür keine Abhängigkeit auf die Scene-Klasse bekommen. Es liegt neben
 * `RenderResolution`, weil beide dieselbe Frage beantworten – wie aus Zeigerkoordinaten ein
 * verlässlicher Weltpunkt wird.
 */
const baseScrollByScene = new WeakMap<Phaser.Scene, { x: number; y: number }>();

export function setCameraBaseScroll(scene: Phaser.Scene, x: number, y: number): void {
  const entry = baseScrollByScene.get(scene);
  if (entry) {
    entry.x = x;
    entry.y = y;
    return;
  }
  baseScrollByScene.set(scene, { x, y });
}

export function getCameraBaseScroll(scene: Phaser.Scene): { x: number; y: number } | null {
  return baseScrollByScene.get(scene) ?? null;
}

/**
 * Weltpunkt unter dem Zeiger, unabhängig vom laufenden Kamera-Feedback.
 *
 * Baut auf `camera.getWorldPoint()` auf und rechnet nur den Feedback-Anteil heraus. Damit
 * bleiben Zoom, Ursprung und eine eventuelle Kamerarotation exakt so behandelt wie von Phaser
 * selbst – die Umrechnung ist in `scroll` affin, die Differenz also exakt.
 */
export function getUnshakenPointerWorldPoint(
  scene: Phaser.Scene,
  pointer: Phaser.Input.Pointer,
): Phaser.Math.Vector2 {
  const camera = scene.cameras.main;
  const point = camera.getWorldPoint(pointer.x, pointer.y);
  const base = baseScrollByScene.get(scene);
  if (!base) return point;
  point.x -= camera.scrollX - base.x;
  point.y -= camera.scrollY - base.y;
  return point;
}
