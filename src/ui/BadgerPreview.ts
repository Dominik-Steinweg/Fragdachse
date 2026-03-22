/**
 * BadgerPreview — reusable badger sprite with colored glow aura.
 *
 * Used in the lobby panel (color indicator) and potentially elsewhere.
 * Shows the 'badger' texture with a pulsing preFX glow in the given color.
 * Optionally tracks the mouse pointer for rotation.
 */
import Phaser from 'phaser';
import { PLAYER_SIZE } from '../config';

const ROTATION_OFFSET = Math.PI / 2;

export class BadgerPreview {
  readonly sprite: Phaser.GameObjects.Image;

  private glowFx: Phaser.FX.Glow | null = null;
  private glowTween: Phaser.Tweens.Tween | null = null;
  private colorHex: number;

  constructor(
    private scene: Phaser.Scene,
    x: number,
    y: number,
    color: number,
    private displaySize = PLAYER_SIZE,
  ) {
    this.colorHex = color;

    this.sprite = scene.add.image(x, y, 'badger');
    this.sprite.setDisplaySize(displaySize, displaySize);

    this.glowFx = this.sprite.preFX?.addGlow(color, 4, 0, false, 0.1, 16) ?? null;
    if (this.glowFx) {
      this.glowTween = scene.tweens.add({
        targets:       this.glowFx,
        outerStrength: { from: 3, to: 7 },
        duration:      1000,
        yoyo:          true,
        repeat:        -1,
        ease:          'Sine.easeInOut',
      });
    }
  }

  /** Change the glow color. */
  setColor(color: number): void {
    if (color === this.colorHex) return;
    this.colorHex = color;
    if (this.glowFx) this.glowFx.color = color;
  }

  /** Set rotation directly (radians, with offset applied). */
  setRotation(aimAngle: number): void {
    this.sprite.rotation = aimAngle + ROTATION_OFFSET;
  }

  setScrollFactor(factor: number): void {
    this.sprite.setScrollFactor(factor);
  }

  setDepth(depth: number): void {
    this.sprite.setDepth(depth);
  }

  setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y);
  }

  destroy(): void {
    this.glowTween?.stop();
    this.sprite.destroy();
  }
}
