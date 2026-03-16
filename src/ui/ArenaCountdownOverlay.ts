import Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_WIDTH,
  DEPTH,
  COLORS,
  toCssColor,
} from '../config';

const VEIL_CELL_SIZE = 8;
const VEIL_EDGE_BAND_PX = 96;
const VEIL_RADIUS_PX = 176;
const VEIL_ALPHA = 1.00;
const REVEAL_DURATION_MS = 1800;
const FLOAT_DISTANCE_PX = 72;
const TWEEN_DURATION_MS = 1100;
const GO_FLOAT_DISTANCE_PX = 40;
const GO_TEXT_DURATION_MS = 420;
const GO_FONT_SIZE_PX = 184;
const REVEAL_TARGET_RADIUS_PX = Math.max(ARENA_WIDTH, ARENA_HEIGHT) * 1.2;

export class ArenaCountdownOverlay {
  private readonly veil: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private readonly getFocusSprite: () => Phaser.GameObjects.Rectangle | undefined;
  private unlockAtMs = 0;
  private lastShownNumber = 0;
  private lastFocusX = ARENA_OFFSET_X + ARENA_WIDTH / 2;
  private lastFocusY = ARENA_OFFSET_Y + ARENA_HEIGHT / 2;
  private revealRadius = VEIL_RADIUS_PX;
  private veilAlpha = VEIL_ALPHA;
  private goTriggeredForUnlock = false;
  private readonly baseX = ARENA_OFFSET_X + ARENA_WIDTH / 2;
  private readonly baseY = ARENA_OFFSET_Y + ARENA_HEIGHT / 2;

  constructor(
    private scene: Phaser.Scene,
    getFocusSprite: () => Phaser.GameObjects.Rectangle | undefined,
  ) {
    this.getFocusSprite = getFocusSprite;

    this.veil = scene.add.graphics()
      .setDepth(DEPTH.OVERLAY - 2)
      .setScrollFactor(0)
      .setVisible(false);

    this.text = scene.add.text(this.baseX, this.baseY, '', {
      fontFamily: 'monospace',
      fontSize: '220px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GOLD_1),
      stroke: toCssColor(COLORS.GREY_8),
      strokeThickness: 16,
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY)
      .setScrollFactor(0)
      .setVisible(false);
  }

  syncTo(unlockAtMs: number): void {
    if (unlockAtMs !== this.unlockAtMs) {
      this.stopTextTweens();
      this.scene.tweens.killTweensOf(this.text);
      this.text.setVisible(false).setText('');
      this.lastShownNumber = 0;
      this.goTriggeredForUnlock = false;
      this.revealRadius = VEIL_RADIUS_PX;
      this.veilAlpha = VEIL_ALPHA;
      this.veil.setVisible(unlockAtMs > 0);
    }
    this.unlockAtMs = unlockAtMs;
  }

  update(now = Date.now()): void {
    if (this.unlockAtMs <= 0) {
      this.clear();
      return;
    }

    this.captureFocusPoint();

    const secondsLeft = Math.max(0, Math.ceil((this.unlockAtMs - now) / 1000));
    if (secondsLeft > 0) {
      this.renderVeil(this.revealRadius, this.veilAlpha);
      if (secondsLeft === this.lastShownNumber) return;
      this.lastShownNumber = secondsLeft;

      this.showCountText(String(secondsLeft), '220px', COLORS.GOLD_1, COLORS.GREY_8, 24, 0.92);
      return;
    }

    if (!this.goTriggeredForUnlock) {
      this.goTriggeredForUnlock = true;
      this.lastShownNumber = 0;
      this.playGoReveal();
    }

    if (this.veilAlpha > 0.01) {
      this.renderVeil(this.revealRadius, this.veilAlpha);
      return;
    }

    this.veil.clear();
    this.veil.setVisible(false);
  }

  clear(): void {
    this.stopTextTweens();
    this.unlockAtMs = 0;
    this.lastShownNumber = 0;
    this.goTriggeredForUnlock = false;
    this.revealRadius = VEIL_RADIUS_PX;
    this.veilAlpha = VEIL_ALPHA;
    this.veil.clear();
    this.veil.setVisible(false);
    this.text.setVisible(false).setAlpha(1).setScale(1).setPosition(this.baseX, this.baseY);
  }

  destroy(): void {
    this.stopTextTweens();
    this.veil.destroy();
    this.text.destroy();
  }

  private captureFocusPoint(): void {
    const sprite = this.getFocusSprite();
    if (sprite?.active) {
      this.lastFocusX = sprite.x;
      this.lastFocusY = sprite.y;
    }
  }

  private showCountText(
    value: string,
    fontSize: string,
    fillColor: number,
    strokeColor: number,
    startYOffset: number,
    startScale: number,
  ): void {
    this.stopTextTweens();
    this.text.setStyle({
      fontFamily: 'monospace',
      fontSize,
      fontStyle: 'bold',
      color: toCssColor(fillColor),
      stroke: toCssColor(strokeColor),
      strokeThickness: 16,
    });
    this.text
      .setText(value)
      .setPosition(this.baseX, this.baseY + startYOffset)
      .setAlpha(1)
      .setScale(startScale)
      .setVisible(true);

    this.scene.tweens.add({
      targets: this.text,
      y: this.baseY - FLOAT_DISTANCE_PX,
      alpha: 0,
      scale: 1.08,
      duration: TWEEN_DURATION_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        if (this.lastShownNumber > 0) {
          this.text.setVisible(false);
        }
      },
    });
  }

  private playGoReveal(): void {
    this.stopTextTweens();
    this.text.setStyle({
      fontFamily: 'monospace',
      fontSize: `${GO_FONT_SIZE_PX}px`,
      fontStyle: 'bold',
      color: toCssColor(COLORS.RED_1),
      stroke: toCssColor(COLORS.GREY_10),
      strokeThickness: 18,
    });
    this.text
      .setText('GO!')
      .setPosition(this.baseX, this.baseY + 8)
      .setAlpha(1)
      .setScale(0.82)
      .setVisible(true);

    this.scene.tweens.add({
      targets: this.text,
      y: this.baseY - GO_FLOAT_DISTANCE_PX,
      alpha: 0,
      scale: 1.14,
      duration: GO_TEXT_DURATION_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        if (this.goTriggeredForUnlock) {
          this.text.setVisible(false);
        }
      },
    });

    this.scene.tweens.add({
      targets: this,
      revealRadius: REVEAL_TARGET_RADIUS_PX,
      veilAlpha: 0,
      duration: REVEAL_DURATION_MS,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        this.renderVeil(this.revealRadius, this.veilAlpha);
      },
      onComplete: () => {
        this.veil.clear();
        this.veil.setVisible(false);
      },
    });
  }

  private renderVeil(radius: number, alpha: number): void {
    const clampedAlpha = Phaser.Math.Clamp(alpha, 0, 1);
    if (clampedAlpha <= 0.01) {
      this.veil.clear();
      this.veil.setVisible(false);
      return;
    }

    this.veil.setVisible(true);
    this.veil.clear();

    const arenaRight = ARENA_OFFSET_X + ARENA_WIDTH;
    const arenaBottom = ARENA_OFFSET_Y + ARENA_HEIGHT;

    for (let y = ARENA_OFFSET_Y; y < arenaBottom; y += VEIL_CELL_SIZE) {
      for (let x = ARENA_OFFSET_X; x < arenaRight; x += VEIL_CELL_SIZE) {
        const cellCenterX = x + VEIL_CELL_SIZE / 2;
        const cellCenterY = y + VEIL_CELL_SIZE / 2;
        const dist = Phaser.Math.Distance.Between(cellCenterX, cellCenterY, this.lastFocusX, this.lastFocusY);

        if (dist <= radius) continue;

        const inEdgeBand = dist <= radius + VEIL_EDGE_BAND_PX;
        const checker = ((x / VEIL_CELL_SIZE) + (y / VEIL_CELL_SIZE)) % 2;
        const color = inEdgeBand
          ? (checker === 0 ? COLORS.BROWN_6 : COLORS.RED_6)
          : (checker === 0 ? COLORS.GREY_10 : COLORS.GREY_9);
        const cellAlpha = inEdgeBand
          ? clampedAlpha * (checker === 0 ? 0.52 : 0.44)
          : clampedAlpha * (checker === 0 ? 0.90 : 0.96);

        this.veil.fillStyle(color, cellAlpha);
        this.veil.fillRect(x, y, VEIL_CELL_SIZE, VEIL_CELL_SIZE);
      }
    }

    this.veil.fillStyle(COLORS.GREY_10, clampedAlpha * 0.35);
    this.veil.fillRect(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, 8);
    this.veil.fillRect(ARENA_OFFSET_X, arenaBottom - 8, ARENA_WIDTH, 8);
    this.veil.fillRect(ARENA_OFFSET_X, ARENA_OFFSET_Y, 8, ARENA_HEIGHT);
    this.veil.fillRect(arenaRight - 8, ARENA_OFFSET_Y, 8, ARENA_HEIGHT);
  }

  private stopTextTweens(): void {
    this.scene.tweens.killTweensOf(this.text);
    this.scene.tweens.killTweensOf(this);
  }
}
