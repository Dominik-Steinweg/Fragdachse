import * as Phaser from 'phaser';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';

export type ArenaExitOutcome = 'victory' | 'defeat';

const FADE_DURATION_MS = 1_000;
const FINAL_ALPHA = 0.9;

/**
 * Haelt die letzte Arenaansicht sichtbar und legt vor dem lokalen Lobby-Teardown einen
 * ruhigen semantischen Farbfade darueber. Der Netzwerkzustand bleibt davon unberuehrt.
 */
export class ArenaExitFadeOverlay {
  private wash: Phaser.GameObjects.Rectangle | null = null;
  private tween: Phaser.Tweens.Tween | null = null;
  private active = false;

  constructor(private readonly scene: Phaser.Scene) {}

  build(): void {
    this.destroy();
    this.wash = this.scene.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      COLORS.GREEN_6,
      1,
    )
      .setDepth(DEPTH.OVERLAY + 3)
      .setScrollFactor(0)
      .setAlpha(0)
      .setVisible(false)
      .setInteractive();
    // Der Host hat die Runde bereits beendet; der Layer blockiert nur lokale Eingaben,
    // waehrend die eingefrorene Abschlussansicht noch sichtbar bleibt.
    this.wash.on('pointerdown', () => undefined);
    promoteToClarityCamera(this.scene, this.wash);
  }

  play(outcome: ArenaExitOutcome, onComplete: () => void): void {
    if (!this.wash) this.build();
    this.tween?.stop();
    this.active = true;
    this.wash!
      .setFillStyle(outcome === 'victory' ? COLORS.GREEN_6 : COLORS.RED_6, 1)
      .setAlpha(0)
      .setVisible(true);
    this.tween = this.scene.tweens.add({
      targets: this.wash,
      alpha: FINAL_ALPHA,
      duration: FADE_DURATION_MS,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.tween = null;
        onComplete();
      },
    });
  }

  isActive(): boolean {
    return this.active;
  }

  hide(): void {
    this.tween?.stop();
    this.tween = null;
    this.active = false;
    this.wash?.setVisible(false).setAlpha(0);
  }

  destroy(): void {
    this.hide();
    this.wash?.destroy();
    this.wash = null;
  }
}
