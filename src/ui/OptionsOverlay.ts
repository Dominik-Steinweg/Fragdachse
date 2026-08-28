import * as Phaser from 'phaser';
import {
  COLORS,
  DEPTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  toCssColor,
} from '../config';
import type { AudioAssetKey } from '../audio/AudioCatalog';
import { GameAudioSystem, type MusicLoadState } from '../audio/GameAudioSystem';
import type { LivingBarPalette } from './LivingBarEffect';
import { LivingBarEffect } from './LivingBarEffect';
import { ensureGlossyButtonTexture, ensureModalPanelTexture } from './uiTextures';
import { attachHoverEffect } from './uiHover';
import { BORDER, INTENT, SURFACE, TEXT, textStyle } from './uiTheme';
import {
  setStoredEffectsVolume,
  setStoredGraphicsQuality,
  setStoredMasterVolume,
  setStoredMusicVolume,
} from '../utils/localPreferences';
import type { GraphicsQuality, GraphicsQualityController } from '../graphics/GraphicsQuality';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { toDesignSpace } from '../graphics/RenderResolution';
import { formatPercent, getLocale, setLocale, t } from '../i18n';
import type { Locale } from '../i18n/types';

const PANEL_W = 680;
const PANEL_H = 760;
const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

const TITLE_Y = CY - PANEL_H / 2 + 38;
const TRACK_W = 430;
const TRACK_H = 18;
const TRACK_X = CX - TRACK_W / 2;
const PERCENT_X = TRACK_X + TRACK_W;
const FOOTER_Y = CY + PANEL_H / 2 - 12;
const QUALITY_BUTTON_Y = CY - 184;
const QUALITY_BUTTON_W = 150;
const QUALITY_BUTTON_H = 44;
const QUALITY_BUTTON_GAP = 12;

const DIM_COLOR = COLORS.GREY_10;
const DIM_ALPHA = 0.78;
const PANEL_BG = SURFACE.modal;
const PANEL_BORDER = BORDER.default;
const TRACK_BG = SURFACE.sunken;
const TRACK_BORDER = BORDER.subtle;
const KNOB_FILL = TEXT.primary;
const KNOB_BORDER = BORDER.default;

const TEX_VOLUME_FILL = '__options_volume_fill';
const TEX_VOLUME_GLOSS = '__options_volume_gloss';
const PREVIEW_SOUND_KEY: AudioAssetKey = 'sfx_options_preview';
const PREVIEW_COOLDOWN_MS = 120;
const MUSIC_LOAD_BAR_H = 8;
const MUSIC_LOAD_BAR_Y = CY + 192;
const MUSIC_LOAD_LABEL_Y = MUSIC_LOAD_BAR_Y + 17;
const SECTION_BLOCK_W = PANEL_W - 60;
const GRAPHICS_HEADING_CONTENT_GAP = 44;
const AUDIO_HEADING_CONTENT_GAP = 18;
const GRAPHICS_HEADER_Y = QUALITY_BUTTON_Y - GRAPHICS_HEADING_CONTENT_GAP;
const AUDIO_HEADER_Y = CY - 84 - AUDIO_HEADING_CONTENT_GAP;
const GRAPHICS_BLOCK_TOP = GRAPHICS_HEADER_Y - 20;
const GRAPHICS_BLOCK_BOTTOM = QUALITY_BUTTON_Y + QUALITY_BUTTON_H + 10;
const AUDIO_BLOCK_TOP = GRAPHICS_BLOCK_BOTTOM + 8;
const AUDIO_BLOCK_BOTTOM = MUSIC_LOAD_BAR_Y + 16;
const LOCALE_HEADING_Y = CY - 312;
const LOCALE_BUTTON_Y = CY - 282;
const LOCALE_HINT_Y = CY - 252;
const LOCALE_BUTTON_W = 140;
const LOCALE_BUTTON_H = 38;
const LOCALE_BUTTON_GAP = 12;

// Partie-Abbruch (nur Host, nur waehrend einer laufenden Runde sichtbar)
const ABORT_DIVIDER_Y = CY + 224;
const SPECTATOR_BUTTON_Y = CY + 258;
const SPECTATOR_HINT_Y = CY + 286;
const ABORT_BUTTON_Y = CY + 318;
const ABORT_BUTTON_W = 320;
const ABORT_BUTTON_H = 44;
const ABORT_HINT_Y = CY + 346;
/** Fenster, in dem der zweite Klick als Bestaetigung zaehlt; danach faellt der Button zurueck. */
const ABORT_CONFIRM_TIMEOUT_MS = 5000;

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

interface QualityButtonState {
  readonly background: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
}

interface LocaleButtonState {
  readonly background: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
}

/**
 * Host-Abbruch der laufenden Partie. Die Sichtbarkeit wird ueber {@link canAbort} bei jedem
 * Oeffnen neu erfragt, damit das Overlay selbst nichts ueber Phase oder Hostrolle wissen muss.
 */
export interface AbortMatchBinding {
  canAbort: () => boolean;
  abort: () => void;
}

/** Spielerwechsel in den host-autoritativ gesperrten Spectator-Zustand. */
export interface SpectatorMatchBinding {
  canSpectate: () => boolean;
  spectate: () => void;
}

/** Kontextabhaengige Rueckkehr aus einer interaktiven World ohne eigene Admission-Logik. */
export interface WorldLeaveBinding {
  canLeave: () => boolean;
  leave: () => void;
}

export interface LocaleSelectionBinding {
  canChange: () => boolean;
  onChanged: (locale: Locale) => void;
}

const QUALITY_OPTIONS: readonly { level: GraphicsQuality; label: string }[] = [
  { level: 'low', label: 'ui.options.low' },
  { level: 'medium', label: 'ui.options.medium' },
  { level: 'high', label: 'ui.options.high' },
] as const;

const SLIDER_DEFINITIONS: readonly SliderDefinition[] = [
  {
    key: 'master',
    label: 'ui.options.masterVolume',
    labelY: CY - 84,
    trackY: CY - 34,
    palette: { dark: COLORS.GREEN_4, mid: COLORS.GOLD_2, light: COLORS.RED_1 },
    playPreviewOnChange: true,
  },
  {
    key: 'effects',
    label: 'ui.options.effectsVolume',
    labelY: CY + 12,
    trackY: CY + 62,
    palette: { dark: COLORS.BLUE_5, mid: COLORS.BLUE_3, light: COLORS.BLUE_1 },
    playPreviewOnChange: true,
  },
  {
    key: 'music',
    label: 'ui.options.musicVolume',
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
    // Leise nach laut: Gruen ueber Gold nach Rot, aus der Palette statt als Literal
    // ('#e8c170' war GOLD_1 abgetippt).
    const gradient = ctx.createLinearGradient(0, 0, TRACK_W, 0);
    gradient.addColorStop(0, toCssColor(COLORS.GREEN_3));
    gradient.addColorStop(0.5, toCssColor(COLORS.GOLD_1));
    gradient.addColorStop(1, toCssColor(COLORS.RED_2));
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
  private readonly qualityButtons = new Map<GraphicsQuality, QualityButtonState>();
  private readonly localeButtons = new Map<Locale, LocaleButtonState>();
  private visible = false;
  private draggingSliderKey: VolumeSliderKey | null = null;
  private dismissDelay: Phaser.Time.TimerEvent | null = null;
  private pointerMoveHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
  private pointerUpHandler: (() => void) | null = null;
  private musicLoadTrack: Phaser.GameObjects.Rectangle | null = null;
  private musicLoadFill: Phaser.GameObjects.Rectangle | null = null;
  private musicLoadLabel: Phaser.GameObjects.Text | null = null;
  private musicLoadHideTimer: Phaser.Time.TimerEvent | null = null;
  private unsubscribeMusicLoadState: (() => void) | null = null;
  private lastPreviewAt = -PREVIEW_COOLDOWN_MS;
  private spectatorBinding: SpectatorMatchBinding | null = null;
  private worldLeaveBinding: WorldLeaveBinding | null = null;
  private abortBinding: AbortMatchBinding | null = null;
  private abortDivider: Phaser.GameObjects.Rectangle | null = null;
  private spectatorButton: Phaser.GameObjects.Image | null = null;
  private spectatorLabel: Phaser.GameObjects.Text | null = null;
  private spectatorHint: Phaser.GameObjects.Text | null = null;
  private worldLeaveButton: Phaser.GameObjects.Image | null = null;
  private worldLeaveLabel: Phaser.GameObjects.Text | null = null;
  private worldLeaveHint: Phaser.GameObjects.Text | null = null;
  private spectatorConfirmPending = false;
  private spectatorConfirmTimer: Phaser.Time.TimerEvent | null = null;
  private abortButton: Phaser.GameObjects.Image | null = null;
  private abortLabel: Phaser.GameObjects.Text | null = null;
  private abortHint: Phaser.GameObjects.Text | null = null;
  private abortConfirmPending = false;
  private abortConfirmTimer: Phaser.Time.TimerEvent | null = null;
  private localeHint: Phaser.GameObjects.Text | null = null;
  private localeBinding: LocaleSelectionBinding | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly audioSystem: GameAudioSystem,
    private readonly graphicsQuality: GraphicsQualityController,
  ) {}

  /** Verbindet den Host-Abbruch; ohne Bindung bleibt der Abschnitt dauerhaft unsichtbar. */
  setAbortMatchBinding(binding: AbortMatchBinding | null): void {
    this.abortBinding = binding;
    this.syncAbortSection();
  }

  setSpectatorMatchBinding(binding: SpectatorMatchBinding | null): void {
    this.spectatorBinding = binding;
    this.syncAbortSection();
  }

  setWorldLeaveBinding(binding: WorldLeaveBinding | null): void {
    this.worldLeaveBinding = binding;
    this.syncAbortSection();
  }

  setLocaleSelectionBinding(binding: LocaleSelectionBinding | null): void {
    this.localeBinding = binding;
    this.syncLocaleButtons();
  }

  build(): void {
    this.unsubscribeMusicLoadState?.();
    this.unsubscribeMusicLoadState = null;
    this.musicLoadHideTimer?.destroy();
    this.musicLoadHideTimer = null;
    this.abortConfirmTimer?.destroy();
    this.abortConfirmTimer = null;
    this.abortConfirmPending = false;
    this.spectatorConfirmTimer?.destroy();
    this.spectatorConfirmTimer = null;
    this.spectatorConfirmPending = false;
    for (const slider of this.sliders.values()) {
      slider.fillEffect.destroy();
    }
    this.sliders.clear();
    this.qualityButtons.clear();
    this.localeButtons.clear();
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.musicLoadTrack = null;
    this.musicLoadFill = null;
    this.musicLoadLabel = null;
    this.abortDivider = null;
    this.spectatorButton = null;
    this.spectatorLabel = null;
    this.spectatorHint = null;
    this.worldLeaveButton = null;
    this.worldLeaveLabel = null;
    this.worldLeaveHint = null;
    this.abortButton = null;
    this.abortLabel = null;
    this.abortHint = null;
    this.localeHint = null;

    ensureOptionsTextures(this.scene);

    this.container = this.scene.add.container(0, 0)
      .setDepth(DEPTH.OVERLAY + 1);
    this.container.setVisible(false);
    promoteToClarityCamera(this.scene, this.container);

    const objects: Phaser.GameObjects.GameObject[] = [];
    this.dimRect = this.scene.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, DIM_COLOR, DIM_ALPHA)
      .setScrollFactor(0);
    objects.push(this.dimRect);

    const panel = this.scene.add.image(
      CX, CY,
      ensureModalPanelTexture(this.scene, '_options_panel', PANEL_W, PANEL_H, PANEL_BG, PANEL_BORDER),
    ).setScrollFactor(0);
    objects.push(panel);

    objects.push(
      this.scene.add.text(CX, TITLE_Y, t('ui.options.title'), textStyle('display'))
        .setOrigin(0.5).setScrollFactor(0),
    );

    this.buildLocaleSelector(objects);

    this.buildSectionBlock(
      t('ui.options.graphics'),
      GRAPHICS_BLOCK_TOP,
      GRAPHICS_BLOCK_BOTTOM,
      GRAPHICS_HEADER_Y,
      objects,
    );

    this.buildQualitySelector(objects);

    this.buildSectionBlock(t('ui.options.audio'), AUDIO_BLOCK_TOP, AUDIO_BLOCK_BOTTOM, AUDIO_HEADER_Y, objects);

    for (const definition of SLIDER_DEFINITIONS) {
      this.buildSlider(definition, objects);
    }
    this.buildMusicLoadingIndicator(objects);
    this.buildAbortSection(objects);

    objects.push(
      this.scene.add.text(CX, FOOTER_Y, t('ui.options.closeHint'), textStyle('caption'))
        .setOrigin(0.5).setScrollFactor(0),
    );

    this.container.add(objects);
    this.unsubscribeMusicLoadState = this.audioSystem.subscribeMusicLoadState((state) => {
      this.syncMusicLoadingIndicator(state);
    });

    this.syncFromAudioSystem();
    this.syncQualityButtons();
    this.syncLocaleButtons();
    this.syncAbortSection();
  }

  show(): void {
    if (this.visible || !this.container) return;
    this.visible = true;
    this.syncFromAudioSystem();
    this.syncQualityButtons();
    this.resetAbortConfirm();
    this.resetSpectatorConfirm();
    this.syncAbortSection();

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

    this.pointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
      if (!this.draggingSliderKey) return;
      this.applyPointerValue(this.draggingSliderKey, pointer.x, true);
    };
    this.pointerUpHandler = () => {
      this.draggingSliderKey = null;
    };

    this.scene.input.on('pointermove', this.pointerMoveHandler);
    this.scene.input.on('pointerup', this.pointerUpHandler);
  }

  hide(): void {
    if (!this.visible || !this.container) return;
    this.visible = false;
    this.draggingSliderKey = null;
    this.resetAbortConfirm();
    this.resetSpectatorConfirm();
    this.dismissDelay?.destroy();
    this.dismissDelay = null;
    this.dimRect?.disableInteractive().removeAllListeners();
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
    this.unsubscribeMusicLoadState?.();
    this.unsubscribeMusicLoadState = null;
    this.musicLoadHideTimer?.destroy();
    this.musicLoadHideTimer = null;
    this.abortConfirmTimer?.destroy();
    this.abortConfirmTimer = null;
    this.abortConfirmPending = false;
    this.spectatorConfirmTimer?.destroy();
    this.spectatorConfirmTimer = null;
    this.spectatorConfirmPending = false;
    this.spectatorBinding = null;
    this.worldLeaveBinding = null;
    this.abortBinding = null;
    this.abortDivider = null;
    this.spectatorButton = null;
    this.spectatorLabel = null;
    this.spectatorHint = null;
    this.worldLeaveButton = null;
    this.worldLeaveLabel = null;
    this.worldLeaveHint = null;
    this.abortButton = null;
    this.abortLabel = null;
    this.abortHint = null;
    for (const slider of this.sliders.values()) {
      slider.fillEffect.destroy();
    }
    this.sliders.clear();
    this.qualityButtons.clear();
    this.localeButtons.clear();
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.musicLoadTrack = null;
    this.musicLoadFill = null;
    this.musicLoadLabel = null;
    this.localeHint = null;
  }

  private syncFromAudioSystem(): void {
    this.setSliderValue('master', this.audioSystem.getMasterVolume(), false, false);
    this.setSliderValue('effects', this.audioSystem.getEffectsVolume(), false, false);
    this.setSliderValue('music', this.audioSystem.getMusicVolume(), false, false);
  }

  private buildSectionBlock(
    label: string,
    top: number,
    bottom: number,
    headingY: number,
    objects: Phaser.GameObjects.GameObject[],
  ): void {
    const background = this.scene.add.rectangle(
      CX,
      (top + bottom) / 2,
      SECTION_BLOCK_W,
      bottom - top,
      SURFACE.raised,
      0.34,
    ).setStrokeStyle(1, BORDER.subtle, 0.9).setScrollFactor(0);
    const heading = this.scene.add.text(
      CX,
      headingY,
      label,
      textStyle('section', { color: TEXT.secondary }),
    ).setOrigin(0.5).setScrollFactor(0);

    objects.push(background, heading);
  }

  private buildQualitySelector(objects: Phaser.GameObjects.GameObject[]): void {
    const totalWidth = QUALITY_OPTIONS.length * QUALITY_BUTTON_W
      + (QUALITY_OPTIONS.length - 1) * QUALITY_BUTTON_GAP;
    const startX = CX - totalWidth / 2 + QUALITY_BUTTON_W / 2;

    QUALITY_OPTIONS.forEach((option, index) => {
      const x = startX + index * (QUALITY_BUTTON_W + QUALITY_BUTTON_GAP);
      const background = this.scene.add.rectangle(
        x, QUALITY_BUTTON_Y, QUALITY_BUTTON_W, QUALITY_BUTTON_H, TRACK_BG, 0.96,
      ).setStrokeStyle(1, TRACK_BORDER)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.graphicsQuality.setLevel(option.level);
          setStoredGraphicsQuality(option.level);
          this.syncQualityButtons();
        });
      const label = this.scene.add.text(x, QUALITY_BUTTON_Y, t(option.label), textStyle('labelSm', {
        color: TEXT.secondary,
      })).setOrigin(0.5).setScrollFactor(0);
      this.qualityButtons.set(option.level, { background, label });
      objects.push(background, label);
    });

  }

  private syncQualityButtons(): void {
    const selected = this.graphicsQuality.getLevel();
    for (const [level, state] of this.qualityButtons) {
      const active = level === selected;
      state.background
        .setFillStyle(active ? SURFACE.raised : TRACK_BG, active ? 1 : 0.96)
        .setStrokeStyle(active ? 2 : 1, active ? BORDER.default : TRACK_BORDER);
      state.label.setColor(toCssColor(active ? TEXT.primary : TEXT.secondary));
    }
  }

  private buildLocaleSelector(objects: Phaser.GameObjects.GameObject[]): void {
    objects.push(
      this.scene.add.text(CX, LOCALE_HEADING_Y, t('ui.options.language'), textStyle('section', { color: TEXT.secondary }))
        .setOrigin(0.5).setScrollFactor(0),
    );
    const locales: readonly { locale: Locale; label: string }[] = [
      { locale: 'de', label: t('ui.options.german') },
      { locale: 'en', label: t('ui.options.english') },
    ];
    const totalWidth = locales.length * LOCALE_BUTTON_W + (locales.length - 1) * LOCALE_BUTTON_GAP;
    const startX = CX - totalWidth / 2 + LOCALE_BUTTON_W / 2;
    for (const [index, option] of locales.entries()) {
      const x = startX + index * (LOCALE_BUTTON_W + LOCALE_BUTTON_GAP);
      const background = this.scene.add.rectangle(
        x, LOCALE_BUTTON_Y, LOCALE_BUTTON_W, LOCALE_BUTTON_H, TRACK_BG, 0.96,
      ).setStrokeStyle(1, TRACK_BORDER).setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.onLocaleSelected(option.locale))
        .on('pointerover', () => {
          if (!this.localeBinding?.canChange()) this.localeHint?.setText(t('ui.options.languageLobbyOnly'));
        })
        .on('pointerout', () => this.syncLocaleButtons());
      const label = this.scene.add.text(x, LOCALE_BUTTON_Y, option.label, textStyle('labelSm', {
        color: TEXT.secondary,
      })).setOrigin(0.5).setScrollFactor(0);
      this.localeButtons.set(option.locale, { background, label });
      objects.push(background, label);
    }
    this.localeHint = this.scene.add.text(CX, LOCALE_HINT_Y, '', textStyle('caption', { color: TEXT.muted }))
      .setOrigin(0.5).setScrollFactor(0);
    objects.push(this.localeHint);
  }

  private onLocaleSelected(locale: Locale): void {
    if (!this.localeBinding?.canChange() || locale === getLocale()) {
      this.syncLocaleButtons();
      return;
    }
    const wasVisible = this.visible;
    this.visible = false;
    setLocale(locale);
    this.build();
    if (wasVisible) this.show();
    this.localeBinding?.onChanged(locale);
  }

  private syncLocaleButtons(): void {
    const canChange = this.localeBinding?.canChange() === true;
    const selected = getLocale();
    for (const [locale, state] of this.localeButtons) {
      const active = locale === selected;
      state.background
        .setFillStyle(active ? SURFACE.raised : TRACK_BG, canChange ? 1 : 0.55)
        .setStrokeStyle(active ? 2 : 1, active ? BORDER.default : TRACK_BORDER)
        .setAlpha(canChange ? 1 : 0.55)
        .setInteractive({ useHandCursor: canChange });
      state.label.setColor(toCssColor(canChange && active ? TEXT.primary : TEXT.secondary)).setAlpha(canChange ? 1 : 0.55);
    }
    this.localeHint?.setText(canChange ? '' : t('ui.options.languageLobbyOnly'));
  }

  private buildSlider(definition: SliderDefinition, objects: Phaser.GameObjects.GameObject[]): void {
    const container = this.container;
    if (!container) return;

    objects.push(
      this.scene.add.text(TRACK_X, definition.labelY, t(definition.label), textStyle('label', {
        color: TEXT.primary,
      })).setOrigin(0, 0.5).setScrollFactor(0),
    );

    const valueText = this.scene.add.text(PERCENT_X, definition.labelY, formatPercent(0, getLocale(), 0), textStyle('numM', {
      color: TEXT.secondary,
    })).setOrigin(1, 0.5).setScrollFactor(0);
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

  private buildMusicLoadingIndicator(objects: Phaser.GameObjects.GameObject[]): void {
    this.musicLoadTrack = this.scene.add.rectangle(
      CX,
      MUSIC_LOAD_BAR_Y,
      TRACK_W,
      MUSIC_LOAD_BAR_H,
      TRACK_BG,
      0.95,
    ).setStrokeStyle(1, COLORS.PURPLE_4)
      .setScrollFactor(0)
      .setVisible(false);

    this.musicLoadFill = this.scene.add.rectangle(
      TRACK_X,
      MUSIC_LOAD_BAR_Y,
      0.001,
      MUSIC_LOAD_BAR_H - 2,
      COLORS.PURPLE_2,
      1,
    ).setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setVisible(false);

    this.musicLoadLabel = this.scene.add.text(CX, MUSIC_LOAD_LABEL_Y, '', textStyle('micro', {
      color: COLORS.PURPLE_1,
    })).setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    objects.push(this.musicLoadTrack, this.musicLoadFill, this.musicLoadLabel);
  }

  private buildAbortSection(objects: Phaser.GameObjects.GameObject[]): void {
    this.abortDivider = this.scene.add.rectangle(CX, ABORT_DIVIDER_Y, PANEL_W - 60, 1, BORDER.subtle, 0.9)
      .setScrollFactor(0)
      .setVisible(false);

    this.spectatorButton = this.scene.add.image(
      CX,
      SPECTATOR_BUTTON_Y,
      ensureGlossyButtonTexture(
        this.scene,
        `_options_spectator_btn_${ABORT_BUTTON_W}x${ABORT_BUTTON_H}`,
        ABORT_BUTTON_W,
        ABORT_BUTTON_H,
        INTENT.secondary.fill,
        INTENT.secondary.stroke,
      ),
    ).setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onSpectatorButtonPressed());

    this.spectatorLabel = this.scene.add.text(CX, SPECTATOR_BUTTON_Y, '', textStyle('label', {
      color: INTENT.secondary.label,
    })).setOrigin(0.5).setScrollFactor(0).setVisible(false);

    this.spectatorHint = this.scene.add.text(CX, SPECTATOR_HINT_Y, '', textStyle('caption'))
      .setOrigin(0.5).setScrollFactor(0).setVisible(false);

    this.worldLeaveButton = this.scene.add.image(
      CX,
      SPECTATOR_BUTTON_Y,
      ensureGlossyButtonTexture(
        this.scene,
        `_options_world_leave_btn_${ABORT_BUTTON_W}x${ABORT_BUTTON_H}`,
        ABORT_BUTTON_W,
        ABORT_BUTTON_H,
        INTENT.secondary.fill,
        INTENT.secondary.stroke,
      ),
    ).setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onWorldLeaveButtonPressed());

    this.worldLeaveLabel = this.scene.add.text(CX, SPECTATOR_BUTTON_Y, '', textStyle('label', {
      color: INTENT.secondary.label,
    })).setOrigin(0.5).setScrollFactor(0).setVisible(false);

    this.worldLeaveHint = this.scene.add.text(CX, SPECTATOR_HINT_Y, '', textStyle('caption'))
      .setOrigin(0.5).setScrollFactor(0).setVisible(false);

    this.abortButton = this.scene.add.image(
      CX,
      ABORT_BUTTON_Y,
      ensureGlossyButtonTexture(
        this.scene,
        `_options_abort_btn_${ABORT_BUTTON_W}x${ABORT_BUTTON_H}`,
        ABORT_BUTTON_W,
        ABORT_BUTTON_H,
        INTENT.danger.fill,
        INTENT.danger.stroke,
      ),
    ).setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onAbortButtonPressed());

    this.abortLabel = this.scene.add.text(CX, ABORT_BUTTON_Y, '', textStyle('label', {
      color: INTENT.danger.label,
    })).setOrigin(0.5).setScrollFactor(0).setVisible(false);

    this.abortHint = this.scene.add.text(CX, ABORT_HINT_Y, '', textStyle('caption'))
      .setOrigin(0.5).setScrollFactor(0).setVisible(false);

    attachHoverEffect(this.scene, this.abortButton, this.abortLabel);
    attachHoverEffect(this.scene, this.spectatorButton, this.spectatorLabel);
    attachHoverEffect(this.scene, this.worldLeaveButton, this.worldLeaveLabel);
    objects.push(
      this.abortDivider,
      this.spectatorButton,
      this.spectatorLabel,
      this.spectatorHint,
      this.worldLeaveButton,
      this.worldLeaveLabel,
      this.worldLeaveHint,
      this.abortButton,
      this.abortLabel,
      this.abortHint,
    );
  }

  /**
   * Blendet den Abbruch-Abschnitt passend zur aktuellen Bindung ein oder aus. Ohne laufende
   * Partie (oder als Client) bleibt der komplette Abschnitt unsichtbar, damit sich das Layout
   * der uebrigen Optionen nicht veraendert.
   */
  private syncAbortSection(): void {
    const worldLeaveAvailable = this.worldLeaveBinding?.canLeave() === true;
    const spectatorAvailable = !worldLeaveAvailable && this.spectatorBinding?.canSpectate() === true;
    const abortAvailable = !worldLeaveAvailable && this.abortBinding?.canAbort() === true;
    // Der Hover-Effekt skaliert Button und Beschriftung; beim Aus-/Einblenden feuert kein
    // pointerout mehr, deshalb hier den Ruhezustand explizit wiederherstellen.
    this.scene.tweens.killTweensOf(
      [
        this.spectatorButton,
        this.spectatorLabel,
        this.worldLeaveButton,
        this.worldLeaveLabel,
        this.abortButton,
        this.abortLabel,
      ].filter((o) => !!o),
    );
    this.spectatorButton?.setScale(1);
    this.spectatorLabel?.setScale(1);
    this.worldLeaveButton?.setScale(1);
    this.worldLeaveLabel?.setScale(1);
    this.abortButton?.setScale(1);
    this.abortLabel?.setScale(1);
    this.abortDivider?.setVisible(worldLeaveAvailable || spectatorAvailable || abortAvailable);
    this.spectatorButton?.setVisible(spectatorAvailable);
    this.spectatorLabel?.setVisible(spectatorAvailable);
    this.spectatorHint?.setVisible(spectatorAvailable);
    this.worldLeaveButton?.setVisible(worldLeaveAvailable);
    this.worldLeaveLabel?.setVisible(worldLeaveAvailable);
    this.worldLeaveHint?.setVisible(worldLeaveAvailable);
    this.abortButton?.setVisible(abortAvailable);
    this.abortLabel?.setVisible(abortAvailable);
    this.abortHint?.setVisible(abortAvailable);
    if (!spectatorAvailable) {
      this.spectatorButton?.disableInteractive();
    } else {
      this.spectatorButton?.setInteractive({ useHandCursor: true });
      this.spectatorLabel
        ?.setText(this.spectatorConfirmPending ? t('ui.match.spectateConfirm') : t('ui.match.spectate'))
        .setColor(toCssColor(this.spectatorConfirmPending ? COLORS.BLUE_1 : COLORS.GREY_1));
      this.spectatorHint
        ?.setText(this.spectatorConfirmPending
          ? t('ui.match.confirmHint')
          : t('ui.match.spectateHint'))
        .setColor(toCssColor(this.spectatorConfirmPending ? COLORS.BLUE_1 : COLORS.GREY_4));
    }
    if (!worldLeaveAvailable) {
      this.worldLeaveButton?.disableInteractive();
    } else {
      this.worldLeaveButton?.setInteractive({ useHandCursor: true });
      this.worldLeaveLabel
        ?.setText(t('ui.lobby.returnToLobby'))
        .setColor(toCssColor(COLORS.GREY_1));
      this.worldLeaveHint
        ?.setText(t('ui.options.returnToLobbyHint'))
        .setColor(toCssColor(COLORS.GREY_4));
    }
    if (!abortAvailable) {
      this.abortButton?.disableInteractive();
    } else {
      this.abortButton?.setInteractive({ useHandCursor: true });
      this.abortLabel
        ?.setText(this.abortConfirmPending ? t('ui.match.abortConfirm') : t('ui.match.abort'))
        .setColor(toCssColor(this.abortConfirmPending ? COLORS.RED_1 : COLORS.GREY_1));
      this.abortHint
        ?.setText(this.abortConfirmPending
          ? t('ui.match.confirmHint')
          : t('ui.match.abortHint'))
        .setColor(toCssColor(this.abortConfirmPending ? COLORS.RED_1 : COLORS.GREY_4));
    }
  }

  private onWorldLeaveButtonPressed(): void {
    const binding = this.worldLeaveBinding;
    if (!binding?.canLeave()) {
      this.syncAbortSection();
      return;
    }
    this.hide();
    binding.leave();
  }

  private onSpectatorButtonPressed(): void {
    const binding = this.spectatorBinding;
    if (!binding?.canSpectate()) {
      this.resetSpectatorConfirm();
      this.syncAbortSection();
      return;
    }

    if (!this.spectatorConfirmPending) {
      this.spectatorConfirmPending = true;
      this.spectatorConfirmTimer?.destroy();
      this.spectatorConfirmTimer = this.scene.time.delayedCall(ABORT_CONFIRM_TIMEOUT_MS, () => {
        this.spectatorConfirmTimer = null;
        this.spectatorConfirmPending = false;
        this.syncAbortSection();
      });
      this.syncAbortSection();
      return;
    }

    this.resetSpectatorConfirm();
    this.hide();
    binding.spectate();
  }

  private onAbortButtonPressed(): void {
    const binding = this.abortBinding;
    if (!binding?.canAbort()) {
      this.resetAbortConfirm();
      this.syncAbortSection();
      return;
    }

    if (!this.abortConfirmPending) {
      this.abortConfirmPending = true;
      this.abortConfirmTimer?.destroy();
      this.abortConfirmTimer = this.scene.time.delayedCall(ABORT_CONFIRM_TIMEOUT_MS, () => {
        this.abortConfirmTimer = null;
        this.abortConfirmPending = false;
        this.syncAbortSection();
      });
      this.syncAbortSection();
      return;
    }

    this.resetAbortConfirm();
    this.hide();
    binding.abort();
  }

  private resetAbortConfirm(): void {
    this.abortConfirmTimer?.destroy();
    this.abortConfirmTimer = null;
    this.abortConfirmPending = false;
  }

  private resetSpectatorConfirm(): void {
    this.spectatorConfirmTimer?.destroy();
    this.spectatorConfirmTimer = null;
    this.spectatorConfirmPending = false;
  }

  private syncMusicLoadingIndicator(state: MusicLoadState | null): void {
    const track = this.musicLoadTrack;
    const fill = this.musicLoadFill;
    const label = this.musicLoadLabel;
    if (!track || !fill || !label) return;

    this.musicLoadHideTimer?.destroy();
    this.musicLoadHideTimer = null;

    if (!state) {
      track.setVisible(false);
      fill.setVisible(false);
      label.setVisible(false);
      return;
    }

    const progress = Phaser.Math.Clamp(state.progress, 0, 1);
    track.setVisible(true);
    fill.setVisible(true).setDisplaySize(Math.max(0.001, TRACK_W * progress), MUSIC_LOAD_BAR_H - 2);
    label.setVisible(true);

    if (state.status === 'loading') {
      track.setStrokeStyle(1, COLORS.PURPLE_4);
      fill.setFillStyle(COLORS.PURPLE_2, 1);
      label
        .setColor(toCssColor(COLORS.PURPLE_1))
        .setText(t('ui.options.musicLoading', { percent: Math.round(progress * 100) }));
      return;
    }

    if (state.status === 'complete') {
      fill.setDisplaySize(TRACK_W, MUSIC_LOAD_BAR_H - 2);
      label
        .setColor(toCssColor(COLORS.PURPLE_1))
        .setText(t('ui.options.musicReady'));
      this.scheduleMusicLoadingIndicatorHide(550);
      return;
    }

    track.setStrokeStyle(1, COLORS.RED_3);
    fill.setFillStyle(COLORS.RED_2, 1);
    label
      .setColor(toCssColor(COLORS.RED_1))
      .setText(t('ui.options.musicFailed'));
    this.scheduleMusicLoadingIndicatorHide(1800);
  }

  private scheduleMusicLoadingIndicatorHide(delayMs: number): void {
    this.musicLoadHideTimer = this.scene.time.delayedCall(delayMs, () => {
      this.musicLoadHideTimer = null;
      this.musicLoadTrack?.setVisible(false);
      this.musicLoadFill?.setVisible(false);
      this.musicLoadLabel?.setVisible(false);
    });
  }

  private applyPointerValue(key: VolumeSliderKey, pointerX: number, playPreview: boolean): void {
    const designPointerX = toDesignSpace(this.scene.scale, pointerX);
    const normalized = Phaser.Math.Clamp((designPointerX - TRACK_X) / TRACK_W, 0, 1);
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
    slider.valueText.setText(formatPercent(nextValue, getLocale(), 0));
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
