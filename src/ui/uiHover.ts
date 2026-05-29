/**
 * Einheitlicher Hover-Effekt fuer alle Buttons im Spiel.
 * Button (+ optional zugehoerige Beschriftung) wachsen beim Ueberfahren leicht
 * und werden minimal aufgehellt; beim Verlassen zurueck auf den Ausgangszustand.
 * Wird nur ausgeloest, wenn der Button interaktiv ist (deaktivierte Buttons
 * feuern keine Pointer-Events).
 */
import * as Phaser from 'phaser';

export function attachHoverEffect(
  scene: Phaser.Scene,
  button: Phaser.GameObjects.Image,
  label?: Phaser.GameObjects.GameObject | null,
  opts?: { isEnabled?: () => boolean },
): void {
  const targets: Phaser.GameObjects.GameObject[] = label ? [button, label] : [button];
  // Ausgangs-Transparenz beim Anhaengen merken (z.B. gedimmte, inaktive Tabs),
  // damit pointerout den korrekten Ruhezustand wiederherstellt.
  const restAlpha = button.alpha;
  button.on('pointerover', () => {
    if (opts?.isEnabled && !opts.isEnabled()) return;
    scene.tweens.add({
      targets, scaleX: 1.06, scaleY: 1.06, duration: 90, ease: 'Sine.easeOut',
    });
    button.setAlpha(Math.min(1, Math.max(restAlpha, 0.92)));
  });
  button.on('pointerout', () => {
    if (opts?.isEnabled && !opts.isEnabled()) return;
    scene.tweens.add({
      targets, scaleX: 1, scaleY: 1, duration: 120, ease: 'Sine.easeOut',
    });
    button.setAlpha(restAlpha);
  });
}
