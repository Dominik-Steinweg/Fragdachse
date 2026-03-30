import Phaser from 'phaser';
import { COLORS, DEPTH, PLAYER_SIZE, toCssColor } from '../config';
import { sanitizePlayerName } from '../utils/playerName';

const HOVER_NAME_FADE_IN_MS = 30;
const HOVER_NAME_FADE_OUT_MS = 500;
const HOVER_NAME_OFFSET_Y = PLAYER_SIZE / 2 + 6;
const HOVER_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontSize: '18px',
  fontFamily: 'monospace',
  fontStyle: 'bold',
  color: toCssColor(COLORS.GREY_1),
  stroke: toCssColor(COLORS.GREY_10),
  strokeThickness: 3,
};

export interface EnemyHoverNameTarget {
  name: string;
  x: number;
  y: number;
}

export class EnemyHoverNameLabel {
  private readonly text: Phaser.GameObjects.Text;
  private fadeTween: Phaser.Tweens.Tween | null = null;
  private fadeGoal = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.text = scene.add.text(0, 0, '', HOVER_NAME_STYLE);
    this.text.setDepth(DEPTH.LOCAL_UI);
    this.text.setOrigin(0.5, 1);
    this.text.setAlpha(0);
    this.text.setVisible(false);
    this.text.setShadow(0, 1, toCssColor(COLORS.GREY_10), 4, false, true);
  }

  sync(target: EnemyHoverNameTarget | null): void {
    if (!target) {
      this.clear();
      return;
    }

    const nextName = sanitizePlayerName(target.name) || 'Player';
    if (this.text.text !== nextName) this.text.setText(nextName);
    this.text.setPosition(target.x, target.y - HOVER_NAME_OFFSET_Y);
    this.startFade(0.85);
  }

  clear(immediate = false): void {
    if (immediate) {
      this.fadeTween?.stop();
      this.fadeTween = null;
      this.fadeGoal = 0;
      this.text.setAlpha(0);
      this.text.setVisible(false);
      return;
    }
    this.startFade(0);
  }

  destroy(): void {
    this.fadeTween?.stop();
    this.text.destroy();
  }

  private startFade(goal: number): void {
    if (this.fadeGoal === goal) return;

    this.fadeTween?.stop();
    this.fadeGoal = goal;
    if (goal > 0) this.text.setVisible(true);

    this.fadeTween = this.scene.tweens.add({
      targets: this.text,
      alpha: goal,
      duration: goal > 0 ? HOVER_NAME_FADE_IN_MS : HOVER_NAME_FADE_OUT_MS,
      ease: goal > 0 ? 'Quad.easeOut' : 'Quad.easeIn',
      onComplete: () => {
        this.fadeTween = null;
        if (this.fadeGoal <= 0) this.text.setVisible(false);
      },
    });
  }
}