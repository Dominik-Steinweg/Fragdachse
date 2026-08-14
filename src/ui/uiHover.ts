/**
 * Einheitlicher Hover-Effekt fuer alle Buttons im Spiel.
 * Button (+ optional zugehoerige Beschriftung) wachsen beim Ueberfahren leicht
 * und werden minimal aufgehellt; beim Verlassen zurueck auf den Ausgangszustand.
 * Wird nur ausgeloest, wenn der Button interaktiv ist (deaktivierte Buttons
 * feuern keine Pointer-Events).
 */
import * as Phaser from 'phaser';
import { BUTTON_SCALE, MOTION } from './uiTheme';

export function attachHoverEffect(
  scene: Phaser.Scene,
  button: Phaser.GameObjects.Image,
  label?: Phaser.GameObjects.GameObject | null,
  opts?: { isEnabled?: () => boolean },
): void {
  const targets: Phaser.GameObjects.GameObject[] = label ? [button, label] : [button];
  const restScales = new WeakMap<Phaser.GameObjects.GameObject, { x: number; y: number }>();
  let hovered = false;
  let hoverTween: Phaser.Tweens.Tween | null = null;

  const snapshotRestScales = (): void => {
    for (const target of targets) {
      const scalable = target as Phaser.GameObjects.GameObject & { scaleX: number; scaleY: number };
      restScales.set(target, { x: scalable.scaleX, y: scalable.scaleY });
    }
  };

  const tweenScale = (factor: number): void => {
    hoverTween?.remove();
    hoverTween = scene.tweens.add({
      targets,
      // Die Restskalierung kann je Ziel unterschiedlich sein: Im Reward-Menue wird nur
      // der Button per setDisplaySize verbreitert, waehrend das Label bei 1 bleibt.
      scaleX: {
        getEnd: (target: Phaser.GameObjects.GameObject) => (restScales.get(target)?.x ?? 1) * factor,
      },
      scaleY: {
        getEnd: (target: Phaser.GameObjects.GameObject) => (restScales.get(target)?.y ?? 1) * factor,
      },
      duration: MOTION.fast, ease: MOTION.ease.hover,
    });
  };

  // Ausgangs-Transparenz beim Anhaengen merken (z.B. gedimmte, inaktive Tabs),
  // damit pointerout den korrekten Ruhezustand wiederherstellt.
  const restAlpha = button.alpha;
  button.on('pointerover', () => {
    if (opts?.isEnabled && !opts.isEnabled()) return;
    if (!hovered) {
      hoverTween?.remove();
      snapshotRestScales();
      hovered = true;
    }
    tweenScale(BUTTON_SCALE.hover);
    button.setAlpha(Math.min(1, Math.max(restAlpha, 0.92)));
  });
  button.on('pointerout', () => {
    if (opts?.isEnabled && !opts.isEnabled()) return;
    if (!hovered) return;
    hovered = false;
    tweenScale(1);
    button.setAlpha(restAlpha);
  });
}
