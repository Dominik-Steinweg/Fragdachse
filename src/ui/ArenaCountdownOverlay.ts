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
const CLOSED_VEIL_RADIUS_PX = -(VEIL_EDGE_BAND_PX + VEIL_CELL_SIZE);
const VEIL_ALPHA = 1.00;
const REVEAL_DURATION_MS = 1800;
const DEATH_VEIL_HOLD_MS = 500;
const DEATH_VEIL_CLOSE_DURATION_MS = 180;
const FLOAT_DISTANCE_PX = 72;
const TWEEN_DURATION_MS = 1100;
const GO_FLOAT_DISTANCE_PX = 40;
const GO_TEXT_DURATION_MS = 420;
const GO_FONT_SIZE_PX = 184;
const REVEAL_TARGET_RADIUS_PX = Math.max(ARENA_WIDTH, ARENA_HEIGHT) * 1.2;

type OverlayMode = 'hidden' | 'countdown' | 'death' | 'respawn-reveal';

export class ArenaCountdownOverlay {
  private readonly veil: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private readonly getFocusSprite: () => Phaser.GameObjects.Image | undefined;
  private mode: OverlayMode = 'hidden';
  private unlockAtMs = 0;
  private lastShownNumber = 0;
  private lastFocusX = ARENA_OFFSET_X + ARENA_WIDTH / 2;
  private lastFocusY = ARENA_OFFSET_Y + ARENA_HEIGHT / 2;
  private revealRadius = VEIL_RADIUS_PX;
  private veilAlpha = VEIL_ALPHA;
  private goTriggeredForUnlock = false;
  private deathVeilHoldUntilMs = 0;
  private deathVeilClosing = false;
  private readonly baseX = ARENA_OFFSET_X + ARENA_WIDTH / 2;
  private readonly baseY = ARENA_OFFSET_Y + ARENA_HEIGHT / 2;
  private lastRenderedRadius: number | null = null;
  private lastRenderedAlpha: number | null = null;
  private lastRenderedFocusX: number | null = null;
  private lastRenderedFocusY: number | null = null;

  constructor(
    private scene: Phaser.Scene,
    getFocusSprite: () => Phaser.GameObjects.Image | undefined,
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
    if (unlockAtMs <= 0) {
      if (this.mode === 'countdown') this.clear();
      this.unlockAtMs = 0;
      return;
    }

    if (unlockAtMs !== this.unlockAtMs || this.mode !== 'countdown') {
      this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
      this.mode = 'countdown';
      this.veil.setVisible(true);
    }
    this.unlockAtMs = unlockAtMs;
  }

  showDeathVeil(): void {
    if (this.mode === 'death') return;

    this.captureFocusPoint();
    this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
    this.mode = 'death';
    this.deathVeilHoldUntilMs = this.scene.time.now + DEATH_VEIL_HOLD_MS;
    this.deathVeilClosing = false;
    this.renderVeil(this.revealRadius, this.veilAlpha);
  }

  playRespawnReveal(): void {
    this.captureFocusPoint();
    this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
    this.mode = 'respawn-reveal';
    this.renderVeil(this.revealRadius, this.veilAlpha);
    this.playReveal(false);
  }

  update(now = Date.now()): void {
    if (this.mode === 'hidden') {
      this.clear();
      return;
    }

    if (this.mode === 'death') {
      if (!this.deathVeilClosing && this.scene.time.now >= this.deathVeilHoldUntilMs) {
        this.deathVeilClosing = true;
        this.scene.tweens.add({
          targets: this,
          revealRadius: CLOSED_VEIL_RADIUS_PX,
          duration: DEATH_VEIL_CLOSE_DURATION_MS,
          ease: 'Quad.easeIn',
          onUpdate: () => {
            this.renderVeil(this.revealRadius, this.veilAlpha);
          },
        });
      }
      this.renderVeil(this.revealRadius, this.veilAlpha);
      return;
    }

    this.captureFocusPoint();

    if (this.mode === 'respawn-reveal') {
      if (this.veilAlpha > 0.01) {
        this.renderVeil(this.revealRadius, this.veilAlpha);
        return;
      }

      this.veil.clear();
      this.veil.setVisible(false);
      this.mode = 'hidden';
      return;
    }

    if (this.unlockAtMs <= 0) {
      this.clear();
      return;
    }

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
      this.playReveal(true);
    }

    if (this.veilAlpha > 0.01) {
      this.renderVeil(this.revealRadius, this.veilAlpha);
      return;
    }

    this.veil.clear();
    this.veil.setVisible(false);
  }

  clear(): void {
    this.mode = 'hidden';
    this.unlockAtMs = 0;
    this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
    this.invalidateVeilCache();
    this.veil.clear();
    this.veil.setVisible(false);
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

  private playReveal(showGoText: boolean): void {
    this.stopTextTweens();

    if (showGoText) {
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
    } else {
      this.text.setVisible(false).setText('');
    }

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
        if (this.mode === 'respawn-reveal' || this.goTriggeredForUnlock) {
          this.mode = 'hidden';
        }
      },
    });
  }

  private resetOverlayState(radius: number, alpha: number): void {
    this.stopTextTweens();
    this.lastShownNumber = 0;
    this.goTriggeredForUnlock = false;
    this.deathVeilHoldUntilMs = 0;
    this.deathVeilClosing = false;
    this.revealRadius = radius;
    this.veilAlpha = alpha;
    this.invalidateVeilCache();
    this.text
      .setVisible(false)
      .setText('')
      .setAlpha(1)
      .setScale(1)
      .setPosition(this.baseX, this.baseY);
  }

  private renderVeil(radius: number, alpha: number): void {
    const clampedAlpha = Phaser.Math.Clamp(alpha, 0, 1);
    if (clampedAlpha <= 0.01) {
      this.invalidateVeilCache();
      this.veil.clear();
      this.veil.setVisible(false);
      return;
    }

    if (
      this.lastRenderedRadius === radius
      && this.lastRenderedAlpha === clampedAlpha
      && this.lastRenderedFocusX === this.lastFocusX
      && this.lastRenderedFocusY === this.lastFocusY
    ) {
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

    this.lastRenderedRadius = radius;
    this.lastRenderedAlpha = clampedAlpha;
    this.lastRenderedFocusX = this.lastFocusX;
    this.lastRenderedFocusY = this.lastFocusY;
  }

  private invalidateVeilCache(): void {
    this.lastRenderedRadius = null;
    this.lastRenderedAlpha = null;
    this.lastRenderedFocusX = null;
    this.lastRenderedFocusY = null;
  }

  private stopTextTweens(): void {
    this.scene.tweens.killTweensOf(this.text);
    this.scene.tweens.killTweensOf(this);
  }
}
