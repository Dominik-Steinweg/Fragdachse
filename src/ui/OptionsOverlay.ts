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
import type { LivingBarPalette } from './LivingBarEffect';
import { LivingBarEffect } from './LivingBarEffect';
import { setStoredEffectsVolume, setStoredMasterVolume, setStoredMusicVolume } from '../utils/localPreferences';

const PANEL_W = 680;
const PANEL_H = 460;
const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

const TITLE_Y = CY - PANEL_H / 2 + 38;
const SUBTITLE_Y = TITLE_Y + 36;
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

type VolumeSliderKey = 'master' | 'effects' | 'music';

interface SliderDefinition {
  key: VolumeSliderKey;
  label: string;
  labelY: number;
  trackY: number;
  palette: LivingBarPalette;
  playPreviewOnChange: boolean;
}

interface SliderState {
  definition: SliderDefinition;
  fill: Phaser.GameObjects.Image;
  gloss: Phaser.GameObjects.Image;
  knob: Phaser.GameObjects.Rectangle;
  hitArea: Phaser.GameObjects.Rectangle;
  valueText: Phaser.GameObjects.Text;
  fillEffect: LivingBarEffect;
  value: number;
}

const SLIDER_DEFINITIONS: readonly SliderDefinition[] = [
  {
    key: 'master',
    label: 'Gesamt-Lautstärke',
    labelY: CY - 84,
    trackY: CY - 34,
    palette: { dark: COLORS.GREEN_4, mid: COLORS.GOLD_2, light: COLORS.RED_1 },
    playPreviewOnChange: true,
  },
  {
    key: 'effects',
    label: 'Effects',
    labelY: CY + 12,
    trackY: CY + 62,
    palette: { dark: COLORS.BLUE_5, mid: COLORS.BLUE_3, light: COLORS.BLUE_1 },
    playPreviewOnChange: true,
  },
  {
    key: 'music',
    label: 'Music',
    labelY: CY + 108,
    trackY: CY + 158,
    palette: { dark: COLORS.PURPLE_5, mid: COLORS.PURPLE_3, light: COLORS.PURPLE_1 },
    playPreviewOnChange: false,
  },
] as const;

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
  private readonly sliders = new Map<VolumeSliderKey, SliderState>();
  private visible = false;
  private draggingSliderKey: VolumeSliderKey | null = null;
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
    for (const slider of this.sliders.values()) {
      slider.fillEffect.destroy();
    }
    this.sliders.clear();
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;

    ensureOptionsTextures(this.scene);

    this.container = this.scene.add.container(0, 0)
      .setDepth(DEPTH.OVERLAY + 1);
    this.container.setVisible(false);

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

    for (const definition of SLIDER_DEFINITIONS) {
      this.buildSlider(definition, objects);
    }

    objects.push(
      this.scene.add.text(CX, FOOTER_Y, '[ O / ESC / Klick zum Schließen ]', {
        fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    this.container.add(objects);

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
      if (!this.draggingSliderKey) return;
      this.applyPointerValue(this.draggingSliderKey, pointer.x, true);
    };
    this.pointerUpHandler = () => {
      this.draggingSliderKey = null;
    };

    this.scene.input.keyboard?.on('keydown', this.keyHandler);
    this.scene.input.on('pointermove', this.pointerMoveHandler);
    this.scene.input.on('pointerup', this.pointerUpHandler);
  }

  hide(): void {
    if (!this.visible || !this.container) return;
    this.visible = false;
    this.draggingSliderKey = null;
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
    for (const slider of this.sliders.values()) {
      slider.fillEffect.destroy();
    }
    this.sliders.clear();
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
  }

  private syncFromAudioSystem(): void {
    this.setSliderValue('master', this.audioSystem.getMasterVolume(), false, false);
    this.setSliderValue('effects', this.audioSystem.getEffectsVolume(), false, false);
    this.setSliderValue('music', this.audioSystem.getMusicVolume(), false, false);
  }

  private buildSlider(definition: SliderDefinition, objects: Phaser.GameObjects.GameObject[]): void {
    const container = this.container;
    if (!container) return;

    objects.push(
      this.scene.add.text(TRACK_X, definition.labelY, definition.label, {
        fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
      }).setOrigin(0, 0.5).setScrollFactor(0),
    );

    const valueText = this.scene.add.text(PERCENT_X, definition.labelY, '0%', {
      fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(ACCENT),
    }).setOrigin(1, 0.5).setScrollFactor(0);
    objects.push(valueText);

    const trackShadow = this.scene.add.rectangle(CX, definition.trackY + 2, TRACK_W + 20, TRACK_H + 24, 0x000000, 0.2)
      .setScrollFactor(0);
    objects.push(trackShadow);

    const trackBg = this.scene.add.rectangle(CX, definition.trackY, TRACK_W, TRACK_H, TRACK_BG, 0.92)
      .setStrokeStyle(1, TRACK_BORDER)
      .setScrollFactor(0);
    objects.push(trackBg);

    const fill = this.scene.add.image(TRACK_X, definition.trackY, TEX_VOLUME_FILL)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    fill.setCrop(0, 0, 0, TRACK_H);
    objects.push(fill);

    const gloss = this.scene.add.image(TRACK_X, definition.trackY, TEX_VOLUME_GLOSS)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setAlpha(0.85);
    gloss.setCrop(0, 0, 0, TRACK_H);
    objects.push(gloss);

    const knob = this.scene.add.rectangle(TRACK_X, definition.trackY, 18, 28, KNOB_FILL, 0.95)
      .setStrokeStyle(2, KNOB_BORDER)
      .setScrollFactor(0);
    objects.push(knob);

    const hitArea = this.scene.add.rectangle(CX, definition.trackY, TRACK_W + 30, 44, 0x000000, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.draggingSliderKey = definition.key;
        this.applyPointerValue(definition.key, pointer.x, true);
      });
    objects.push(hitArea);

    const fillEffect = new LivingBarEffect(
      this.scene,
      container,
      TRACK_X,
      definition.trackY - TRACK_H / 2,
      TRACK_W,
      TRACK_H,
      definition.palette,
      { glowTarget: fill, scrollFactor: 0, intensity: 0.45 },
    );

    this.sliders.set(definition.key, {
      definition,
      fill,
      gloss,
      knob,
      hitArea,
      valueText,
      fillEffect,
      value: 0,
    });
  }

  private applyPointerValue(key: VolumeSliderKey, pointerX: number, playPreview: boolean): void {
    const normalized = Phaser.Math.Clamp((pointerX - TRACK_X) / TRACK_W, 0, 1);
    this.setSliderValue(key, normalized, true, playPreview);
  }

  private setSliderValue(key: VolumeSliderKey, value: number, persist: boolean, playPreview: boolean): void {
    const slider = this.sliders.get(key);
    if (!slider) return;

    const nextValue = Phaser.Math.Clamp(value, 0, 1);
    const changed = Math.abs(nextValue - slider.value) >= 0.001;
    slider.value = nextValue;

    const width = Math.round(TRACK_W * nextValue);
    slider.fill.setCrop(0, 0, width, TRACK_H);
    slider.gloss.setCrop(0, 0, width, TRACK_H);
    slider.knob.setX(TRACK_X + width);
    slider.valueText.setText(`${Math.round(nextValue * 100)}%`);
    slider.fillEffect.setFilledWidth(width);

    switch (key) {
      case 'master':
        this.audioSystem.setMasterVolume(nextValue);
        if (persist) setStoredMasterVolume(nextValue);
        break;
      case 'effects':
        this.audioSystem.setEffectsVolume(nextValue);
        if (persist) setStoredEffectsVolume(nextValue);
        break;
      case 'music':
        this.audioSystem.setMusicVolume(nextValue);
        if (persist) setStoredMusicVolume(nextValue);
        break;
    }

    if (changed && playPreview && slider.definition.playPreviewOnChange) this.playPreviewSound();
  }

  private playPreviewSound(): void {
    const now = this.scene.time.now;
    if (now - this.lastPreviewAt < PREVIEW_COOLDOWN_MS) return;
    this.lastPreviewAt = now;
    this.audioSystem.playLocalSound(PREVIEW_SOUND_KEY);
  }
}