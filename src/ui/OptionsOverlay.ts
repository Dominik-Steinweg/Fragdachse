import * as Phaser from 'phaser';
import {
  COLORS,
  DEPTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  toCssColor,
} from '../config';
import type { AudioAssetKey } from '../audio/AudioCatalog';
import { GameAudioSystem } from '../audio/GameAudioSystem';
import { LivingBarEffect } from './LivingBarEffect';
import { setStoredMasterVolume } from '../utils/localPreferences';

const PANEL_W = 680;
const PANEL_H = 340;
const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

const TITLE_Y = CY - PANEL_H / 2 + 38;
const SUBTITLE_Y = TITLE_Y + 36;
const TRACK_LABEL_Y = CY - 6;
const TRACK_Y = CY + 44;
const TRACK_W = 430;
const TRACK_H = 18;
const TRACK_X = CX - TRACK_W / 2;
const PERCENT_X = TRACK_X + TRACK_W;
const FOOTER_Y = CY + PANEL_H / 2 - 28;

const DIM_COLOR = COLORS.GREY_10;
const DIM_ALPHA = 0.78;
const PANEL_BG = COLORS.GREY_7;
const PANEL_ALPHA = 0.95;
const ACCENT = COLORS.GOLD_1;
const TRACK_BG = COLORS.GREY_9;
const TRACK_BORDER = COLORS.GREY_4;
const KNOB_FILL = COLORS.GREY_1;
const KNOB_BORDER = COLORS.GOLD_1;

const TEX_VOLUME_FILL = '__options_volume_fill';
const TEX_VOLUME_GLOSS = '__options_volume_gloss';
const PREVIEW_SOUND_KEY: AudioAssetKey = 'sfx_options_preview';
const PREVIEW_COOLDOWN_MS = 120;

function ensureOptionsTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_VOLUME_FILL)) scene.textures.remove(TEX_VOLUME_FILL);
  if (scene.textures.exists(TEX_VOLUME_GLOSS)) scene.textures.remove(TEX_VOLUME_GLOSS);

  const fillTexture = scene.textures.createCanvas(TEX_VOLUME_FILL, TRACK_W, TRACK_H);
  if (fillTexture) {
    const ctx = fillTexture.context;
    const gradient = ctx.createLinearGradient(0, 0, TRACK_W, 0);
    gradient.addColorStop(0, '#7ccf5b');
    gradient.addColorStop(0.5, '#e8c170');
    gradient.addColorStop(1, '#cf573c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, TRACK_W, TRACK_H);
    fillTexture.refresh();
  }

  const glossTexture = scene.textures.createCanvas(TEX_VOLUME_GLOSS, TRACK_W, TRACK_H);
  if (glossTexture) {
    const ctx = glossTexture.context;
    const gloss = ctx.createLinearGradient(0, 0, 0, TRACK_H);
    gloss.addColorStop(0, 'rgba(255,255,255,0.38)');
    gloss.addColorStop(0.4, 'rgba(255,255,255,0.08)');
    gloss.addColorStop(0.65, 'rgba(0,0,0,0)');
    gloss.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, TRACK_W, TRACK_H);
    glossTexture.refresh();
  }
}

export class OptionsOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private dimRect: Phaser.GameObjects.Rectangle | null = null;
  private sliderFill: Phaser.GameObjects.Image | null = null;
  private sliderGloss: Phaser.GameObjects.Image | null = null;
  private sliderKnob: Phaser.GameObjects.Rectangle | null = null;
  private sliderHitArea: Phaser.GameObjects.Rectangle | null = null;
  private valueText: Phaser.GameObjects.Text | null = null;
  private fillEffect: LivingBarEffect | null = null;
  private visible = false;
  private dragging = false;
  private sliderValue = 0;
  private dismissDelay: Phaser.Time.TimerEvent | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private pointerMoveHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
  private pointerUpHandler: (() => void) | null = null;
  private lastPreviewAt = -PREVIEW_COOLDOWN_MS;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audioSystem: GameAudioSystem,
  ) {}

  build(): void {
    this.fillEffect?.destroy();
    this.fillEffect = null;
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.sliderFill = null;
    this.sliderGloss = null;
    this.sliderKnob = null;
    this.sliderHitArea = null;
    this.valueText = null;

    ensureOptionsTextures(this.scene);

    const objects: Phaser.GameObjects.GameObject[] = [];
    this.dimRect = this.scene.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, DIM_COLOR, DIM_ALPHA)
      .setScrollFactor(0);
    objects.push(this.dimRect);

    const panel = this.scene.add.rectangle(CX, CY, PANEL_W, PANEL_H, PANEL_BG, PANEL_ALPHA)
      .setStrokeStyle(2, ACCENT)
      .setScrollFactor(0);
    objects.push(panel);

    objects.push(
      this.scene.add.text(CX, TITLE_Y, 'OPTIONEN', {
        fontSize: '28px', fontFamily: 'monospace', fontStyle: 'bold',
        color: toCssColor(ACCENT),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    objects.push(
      this.scene.add.text(CX, SUBTITLE_Y, 'Audio', {
        fontSize: '16px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    objects.push(
      this.scene.add.rectangle(CX, SUBTITLE_Y + 26, PANEL_W - 60, 2, ACCENT)
        .setScrollFactor(0),
    );

    objects.push(
      this.scene.add.text(TRACK_X, TRACK_LABEL_Y, 'Lautstärke', {
        fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
      }).setOrigin(0, 0.5).setScrollFactor(0),
    );

    this.valueText = this.scene.add.text(PERCENT_X, TRACK_LABEL_Y, '25%', {
      fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(ACCENT),
    }).setOrigin(1, 0.5).setScrollFactor(0);
    objects.push(this.valueText);

    const trackShadow = this.scene.add.rectangle(CX, TRACK_Y + 2, TRACK_W + 20, TRACK_H + 24, 0x000000, 0.2)
      .setScrollFactor(0);
    objects.push(trackShadow);

    const trackBg = this.scene.add.rectangle(CX, TRACK_Y, TRACK_W, TRACK_H, TRACK_BG, 0.92)
      .setStrokeStyle(1, TRACK_BORDER)
      .setScrollFactor(0);
    objects.push(trackBg);

    this.sliderFill = this.scene.add.image(TRACK_X, TRACK_Y, TEX_VOLUME_FILL)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    this.sliderFill.setCrop(0, 0, 0, TRACK_H);
    objects.push(this.sliderFill);

    this.sliderGloss = this.scene.add.image(TRACK_X, TRACK_Y, TEX_VOLUME_GLOSS)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setAlpha(0.85);
    this.sliderGloss.setCrop(0, 0, 0, TRACK_H);
    objects.push(this.sliderGloss);

    this.sliderKnob = this.scene.add.rectangle(TRACK_X, TRACK_Y, 18, 28, KNOB_FILL, 0.95)
      .setStrokeStyle(2, KNOB_BORDER)
      .setScrollFactor(0);
    objects.push(this.sliderKnob);

    this.sliderHitArea = this.scene.add.rectangle(CX, TRACK_Y, TRACK_W + 30, 44, 0x000000, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.dragging = true;
        this.applyPointerValue(pointer.x, true);
      });
    objects.push(this.sliderHitArea);

    objects.push(
      this.scene.add.text(CX, FOOTER_Y, '[ O / ESC / Klick zum Schließen ]', {
        fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    this.container = this.scene.add.container(0, 0, objects)
      .setDepth(DEPTH.OVERLAY + 1);
    this.container.setVisible(false);

    this.fillEffect = new LivingBarEffect(
      this.scene,
      this.container,
      TRACK_X,
      TRACK_Y - TRACK_H / 2,
      TRACK_W,
      TRACK_H,
      { dark: COLORS.GREEN_4, mid: COLORS.GOLD_2, light: COLORS.RED_1 },
      { glowTarget: this.sliderFill, scrollFactor: 0, intensity: 0.45 },
    );

    this.syncFromAudioSystem();
  }

  show(): void {
    if (this.visible || !this.container) return;
    this.visible = true;
    this.syncFromAudioSystem();

    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 150,
      ease: 'Sine.easeOut',
    });

    this.dismissDelay = this.scene.time.delayedCall(120, () => {
      this.dismissDelay = null;
      if (!this.visible) return;
      this.dimRect?.setInteractive().once('pointerdown', () => this.hide());
    });

    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.hide();
    };
    this.pointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      this.applyPointerValue(pointer.x, true);
    };
    this.pointerUpHandler = () => {
      this.dragging = false;
    };

    this.scene.input.keyboard?.on('keydown', this.keyHandler);
    this.scene.input.on('pointermove', this.pointerMoveHandler);
    this.scene.input.on('pointerup', this.pointerUpHandler);
  }

  hide(): void {
    if (!this.visible || !this.container) return;
    this.visible = false;
    this.dragging = false;
    this.dismissDelay?.destroy();
    this.dismissDelay = null;
    this.dimRect?.disableInteractive().removeAllListeners();
    if (this.keyHandler) {
      this.scene.input.keyboard?.off('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    if (this.pointerMoveHandler) {
      this.scene.input.off('pointermove', this.pointerMoveHandler);
      this.pointerMoveHandler = null;
    }
    if (this.pointerUpHandler) {
      this.scene.input.off('pointerup', this.pointerUpHandler);
      this.pointerUpHandler = null;
    }

    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 100,
      ease: 'Sine.easeIn',
      onComplete: () => this.container?.setVisible(false),
    });
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isOpen(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.hide();
    this.fillEffect?.destroy();
    this.fillEffect = null;
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.sliderFill = null;
    this.sliderGloss = null;
    this.sliderKnob = null;
    this.sliderHitArea = null;
    this.valueText = null;
  }

  private syncFromAudioSystem(): void {
    this.setVolume(this.audioSystem.getMasterVolume(), false, false);
  }

  private applyPointerValue(pointerX: number, playPreview: boolean): void {
    const normalized = Phaser.Math.Clamp((pointerX - TRACK_X) / TRACK_W, 0, 1);
    this.setVolume(normalized, true, playPreview);
  }

  private setVolume(value: number, persist: boolean, playPreview: boolean): void {
    const nextValue = Phaser.Math.Clamp(value, 0, 1);
    const changed = Math.abs(nextValue - this.sliderValue) >= 0.001;
    this.sliderValue = nextValue;

    const width = Math.round(TRACK_W * nextValue);
    this.sliderFill?.setCrop(0, 0, width, TRACK_H);
    this.sliderGloss?.setCrop(0, 0, width, TRACK_H);
    this.sliderKnob?.setX(TRACK_X + width);
    this.valueText?.setText(`${Math.round(nextValue * 100)}%`);
    this.fillEffect?.setFilledWidth(width);

    this.audioSystem.setMasterVolume(nextValue);
    if (persist) setStoredMasterVolume(nextValue);
    if (changed && playPreview) this.playPreviewSound();
  }

  private playPreviewSound(): void {
    const now = this.scene.time.now;
    if (now - this.lastPreviewAt < PREVIEW_COOLDOWN_MS) return;
    this.lastPreviewAt = now;
    this.audioSystem.playLocalSound(PREVIEW_SOUND_KEY);
  }
}