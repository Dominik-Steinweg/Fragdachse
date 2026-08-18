import * as Phaser from 'phaser';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_VIEWPORT_WIDTH,
  DEPTH,
  COLORS,
  toCssColor,
} from '../config';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import type { CameraPostFxController } from '../effects/postfx/CameraPostFxController';
import { t } from '../i18n';
import {
  RADIAL_FOCUS_SOFTNESS_PX,
  resolveRadialFocusFrame,
  type RadialFocusFrame,
} from '../effects/postfx/radialFocusState';

const VEIL_RADIUS_PX = 176;
const CLOSED_VEIL_RADIUS_PX = -(RADIAL_FOCUS_SOFTNESS_PX + 8);
const VEIL_ALPHA = 1.00;
const REVEAL_DURATION_MS = 1800;
const DEATH_VEIL_HOLD_MS = 500;
const DEATH_VEIL_CLOSE_DURATION_MS = 180;
const FLOAT_DISTANCE_PX = 72;
const TWEEN_DURATION_MS = 1100;
const GO_FLOAT_DISTANCE_PX = 40;
const GO_TEXT_DURATION_MS = 420;
const GO_FONT_SIZE_PX = 184;
const FOCUS_FALLBACK_TEXTURE_KEY = '__arena_countdown_radial_focus';
const FOCUS_FALLBACK_SCALE = 0.25;
const FOCUS_FALLBACK_WIDTH = Math.ceil(GAME_WIDTH * FOCUS_FALLBACK_SCALE);
const FOCUS_FALLBACK_HEIGHT = Math.ceil(GAME_HEIGHT * FOCUS_FALLBACK_SCALE);
const FOCUS_FALLBACK_TINT = '54,54,54';
const FOCUS_FALLBACK_MID_ALPHA = 0.14;
const FOCUS_FALLBACK_OUTER_ALPHA = 0.30;

type OverlayMode = 'hidden' | 'loading' | 'countdown' | 'death' | 'respawn-reveal';

export class ArenaCountdownOverlay {
  private readonly focusFallbackTexture: Phaser.Textures.CanvasTexture;
  private readonly focusFallback: Phaser.GameObjects.Image;
  private readonly text: Phaser.GameObjects.Text;
  private readonly getFocusSprite: () => Phaser.GameObjects.Image | undefined;
  private readonly postFx: CameraPostFxController | null;
  private mode: OverlayMode = 'hidden';
  private unlockAtMs = 0;
  private lastShownNumber = 0;
  private lastFocusWorldX = GAME_WIDTH / 2;
  private lastFocusWorldY = ARENA_OFFSET_Y + ARENA_HEIGHT / 2;
  private revealRadius = VEIL_RADIUS_PX;
  private veilAlpha = VEIL_ALPHA;
  private goTriggeredForUnlock = false;
  private deathVeilHoldUntilMs = 0;
  private deathVeilClosing = false;
  private audioSystem: GameAudioSystem | null = null;
  private readonly baseX = GAME_WIDTH / 2;
  private readonly baseY = GAME_HEIGHT / 2;
  private lastFallbackFrameKey: string | null = null;
  private destroyed = false;

  constructor(
    private scene: Phaser.Scene,
    getFocusSprite: () => Phaser.GameObjects.Image | undefined,
    postFx: CameraPostFxController | null = null,
  ) {
    this.getFocusSprite = getFocusSprite;
    this.postFx = postFx;

    if (scene.textures.exists(FOCUS_FALLBACK_TEXTURE_KEY)) {
      scene.textures.remove(FOCUS_FALLBACK_TEXTURE_KEY);
    }
    this.focusFallbackTexture = scene.textures.createCanvas(
      FOCUS_FALLBACK_TEXTURE_KEY,
      FOCUS_FALLBACK_WIDTH,
      FOCUS_FALLBACK_HEIGHT,
    ) as Phaser.Textures.CanvasTexture;
    this.focusFallbackTexture.setSmoothPixelArt(false);
    this.focusFallbackTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.focusFallback = scene.add.image(this.baseX, this.baseY, FOCUS_FALLBACK_TEXTURE_KEY)
      .setDepth(DEPTH.OVERLAY - 2)
      .setScrollFactor(0)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
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

    promoteToClarityCamera(scene, this.text);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  setAudioSystem(system: GameAudioSystem | null): void {
    this.audioSystem = system;
  }

  syncTo(unlockAtMs: number): void {
    if (unlockAtMs <= 0) {
      if (this.mode === 'countdown') this.clear();
      this.unlockAtMs = 0;
      return;
    }

    if (
      unlockAtMs !== this.unlockAtMs
      || this.mode !== 'countdown'
    ) {
      this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
      this.mode = 'countdown';
    }
    this.unlockAtMs = unlockAtMs;
  }

  /** Full-screen loading veil used while local chunks and round systems are being prepared. */
  showLoading(): void {
    if (this.mode === 'loading') return;
    this.resetOverlayState(CLOSED_VEIL_RADIUS_PX, VEIL_ALPHA);
    this.mode = 'loading';
    this.unlockAtMs = 0;
    this.text.setStyle({
      fontFamily: 'monospace',
      fontSize: '56px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GOLD_1),
      stroke: toCssColor(COLORS.GREY_8),
      strokeThickness: 10,
    });
    this.text
      .setText(t('ui.common.loading'))
      .setPosition(this.baseX, this.baseY)
      .setAlpha(1)
      .setScale(1)
      .setVisible(true);
  }

  isLoading(): boolean {
    return this.mode === 'loading';
  }

  showDeathVeil(): void {
    if (this.mode === 'death') return;

    this.captureFocusPoint();
    this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
    this.mode = 'death';
    this.deathVeilHoldUntilMs = this.scene.time.now + DEATH_VEIL_HOLD_MS;
    this.deathVeilClosing = false;
  }

  playRespawnReveal(): void {
    this.captureFocusPoint();
    this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
    this.mode = 'respawn-reveal';
    this.playReveal(false);
  }

  update(now = Date.now()): void {
    if (this.mode === 'hidden') {
      this.clear();
      return;
    }

    if (this.mode === 'loading') {
      this.captureFocusPoint();
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
        });
      }
      return;
    }

    this.captureFocusPoint();

    if (this.mode === 'respawn-reveal') {
      if (this.veilAlpha > 0.01) {
        return;
      }

      this.mode = 'hidden';
      return;
    }

    if (this.unlockAtMs <= 0) {
      this.clear();
      return;
    }

    const secondsLeft = Math.max(0, Math.ceil((this.unlockAtMs - now) / 1000));
    if (secondsLeft > 0) {
      if (secondsLeft === this.lastShownNumber) return;
      this.lastShownNumber = secondsLeft;

      const countdownKey = secondsLeft <= 3 ? `sfx_countdown_${secondsLeft}` : undefined;
      if (countdownKey) this.audioSystem?.playLocalSound(countdownKey);

      this.showCountText(String(secondsLeft), '220px', COLORS.GOLD_1, COLORS.GREY_8, 24, 0.92);
      return;
    }

    if (!this.goTriggeredForUnlock) {
      this.goTriggeredForUnlock = true;
      this.lastShownNumber = 0;
      this.audioSystem?.playLocalSound('sfx_countdown_go');
      this.playReveal(true);
    }

    if (this.veilAlpha > 0.01) {
      return;
    }
  }

  /**
   * Applies the current logical focus after the Scene has written the final camera feedback.
   * The overlay stores a world point so both dynamic camera scroll and screen shake remain in
   * the same coordinate space as the rendered world.
   */
  syncAfterCameraFeedback(): void {
    if (this.mode === 'hidden' || this.veilAlpha <= 0.01) {
      this.postFx?.setRadialFocus(null);
      this.focusFallback.setVisible(false);
      return;
    }

    const camera = this.scene.cameras.main;
    const frame: RadialFocusFrame = resolveRadialFocusFrame(
      this.lastFocusWorldX,
      this.lastFocusWorldY,
      camera.scrollX,
      camera.scrollY,
      this.revealRadius,
      this.veilAlpha,
    );

    this.postFx?.setRadialFocus(frame);
    const filterActive = this.postFx?.isRadialFocusFilterActive() ?? false;
    this.focusFallback.setVisible(!filterActive);
    if (!filterActive) this.updateFallbackTexture(frame);
  }

  clear(): void {
    this.mode = 'hidden';
    this.unlockAtMs = 0;
    this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
    this.lastFallbackFrameKey = null;
    this.postFx?.setRadialFocus(null);
    this.focusFallback.setVisible(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopTextTweens();
    this.postFx?.setRadialFocus(null);
    this.focusFallback.destroy();
    this.text.destroy();
    if (this.scene.textures.exists(FOCUS_FALLBACK_TEXTURE_KEY)) {
      this.scene.textures.remove(FOCUS_FALLBACK_TEXTURE_KEY);
    }
  }

  private captureFocusPoint(): void {
    const sprite = this.getFocusSprite();
    if (sprite?.active) {
      this.lastFocusWorldX = sprite.x;
      this.lastFocusWorldY = sprite.y;
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
        .setText(t('ui.match.go'))
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
      revealRadius: Math.max(ARENA_VIEWPORT_WIDTH, ARENA_HEIGHT) * 1.2,
      veilAlpha: 0,
      duration: REVEAL_DURATION_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.lastFallbackFrameKey = null;
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
    this.lastFallbackFrameKey = null;
    this.text
      .setVisible(false)
      .setText('')
      .setAlpha(1)
      .setScale(1)
      .setPosition(this.baseX, this.baseY);
  }

  private updateFallbackTexture(frame: RadialFocusFrame): void {
    const key = [
      frame.focusX,
      frame.focusY,
      frame.radiusPx,
      frame.alpha,
    ].map((value) => Math.round(value * 100) / 100).join('|');
    if (key === this.lastFallbackFrameKey) return;
    this.lastFallbackFrameKey = key;

    const texture = this.focusFallbackTexture;
    const context = texture.context;
    const scaleX = texture.width / GAME_WIDTH;
    const scaleY = texture.height / GAME_HEIGHT;
    const veilWidth = texture.width;
    const veilHeight = texture.height;
    const focusX = frame.focusX * scaleX;
    const focusY = frame.focusY * scaleY;
    const radius = frame.radiusPx * scaleX;
    const softness = RADIAL_FOCUS_SOFTNESS_PX * scaleX;
    const alpha = Phaser.Math.Clamp(frame.alpha, 0, 1);

    // Das Bild deckt den gesamten Designraum ab (`setDisplaySize(GAME_WIDTH, GAME_HEIGHT)`),
    // deshalb füllt der Schleier die Textur vollständig. Sonst bliebe der Rand außerhalb der
    // Arena als heller Streifen ohne Schleier stehen.
    context.clearRect(0, 0, veilWidth, veilHeight);

    if (frame.radiusPx <= 0) {
      const loadingAlpha = this.mode === 'loading' ? alpha : alpha * FOCUS_FALLBACK_OUTER_ALPHA;
      context.fillStyle = `rgba(${FOCUS_FALLBACK_TINT},${loadingAlpha})`;
      context.fillRect(0, 0, veilWidth, veilHeight);
    } else {
      const outerRadius = Math.max(1, radius + softness);
      const gradient = context.createRadialGradient(
        focusX,
        focusY,
        Math.max(0, radius),
        focusX,
        focusY,
        outerRadius,
      );
      gradient.addColorStop(0, `rgba(${FOCUS_FALLBACK_TINT},0)`);
      gradient.addColorStop(0.55, `rgba(${FOCUS_FALLBACK_TINT},${alpha * FOCUS_FALLBACK_MID_ALPHA})`);
      gradient.addColorStop(1, `rgba(${FOCUS_FALLBACK_TINT},${alpha * FOCUS_FALLBACK_OUTER_ALPHA})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, veilWidth, veilHeight);
    }

    texture.refresh();
  }

  private stopTextTweens(): void {
    this.scene.tweens.killTweensOf(this.text);
    this.scene.tweens.killTweensOf(this);
  }
}
