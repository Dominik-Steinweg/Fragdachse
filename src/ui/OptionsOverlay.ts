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
import {
  setStoredEffectsVolume,
  setStoredGraphicsQuality,
  setStoredMasterVolume,
  setStoredMusicVolume,
} from '../utils/localPreferences';
import type { GraphicsQuality, GraphicsQualityController } from '../graphics/GraphicsQuality';

const PANEL_W = 680;
const PANEL_H = 680;
const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

const TITLE_Y = CY - PANEL_H / 2 + 38;
const SUBTITLE_Y = TITLE_Y + 36;
const TRACK_W = 430;
const TRACK_H = 18;
const TRACK_X = CX - TRACK_W / 2;
const PERCENT_X = TRACK_X + TRACK_W;
const FOOTER_Y = CY + PANEL_H / 2 - 28;
const QUALITY_BUTTON_Y = CY - 184;
const QUALITY_BUTTON_W = 150;
const QUALITY_BUTTON_H = 44;
const QUALITY_BUTTON_GAP = 12;

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
const MUSIC_LOAD_BAR_H = 8;
const MUSIC_LOAD_BAR_Y = CY + 192;
const MUSIC_LOAD_LABEL_Y = MUSIC_LOAD_BAR_Y + 17;

// Partie-Abbruch (nur Host, nur waehrend einer laufenden Runde sichtbar)
const ABORT_DIVIDER_Y = CY + 224;
const ABORT_BUTTON_Y = CY + 258;
const ABORT_BUTTON_W = 320;
const ABORT_BUTTON_H = 44;
const ABORT_HINT_Y = CY + 290;
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

/**
 * Host-Abbruch der laufenden Partie. Die Sichtbarkeit wird ueber {@link canAbort} bei jedem
 * Oeffnen neu erfragt, damit das Overlay selbst nichts ueber Phase oder Hostrolle wissen muss.
 */
export interface AbortMatchBinding {
  canAbort: () => boolean;
  abort: () => void;
}

const QUALITY_OPTIONS: readonly { level: GraphicsQuality; label: string }[] = [
  { level: 'low', label: 'NIEDRIG' },
  { level: 'medium', label: 'MITTEL' },
  { level: 'high', label: 'HOCH' },
] as const;

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
  private readonly qualityButtons = new Map<GraphicsQuality, QualityButtonState>();
  private visible = false;
  private draggingSliderKey: VolumeSliderKey | null = null;
  private dismissDelay: Phaser.Time.TimerEvent | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private pointerMoveHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
  private pointerUpHandler: (() => void) | null = null;
  private musicLoadTrack: Phaser.GameObjects.Rectangle | null = null;
  private musicLoadFill: Phaser.GameObjects.Rectangle | null = null;
  private musicLoadLabel: Phaser.GameObjects.Text | null = null;
  private musicLoadHideTimer: Phaser.Time.TimerEvent | null = null;
  private unsubscribeMusicLoadState: (() => void) | null = null;
  private lastPreviewAt = -PREVIEW_COOLDOWN_MS;
  private abortBinding: AbortMatchBinding | null = null;
  private abortDivider: Phaser.GameObjects.Rectangle | null = null;
  private abortButton: Phaser.GameObjects.Image | null = null;
  private abortLabel: Phaser.GameObjects.Text | null = null;
  private abortHint: Phaser.GameObjects.Text | null = null;
  private abortConfirmPending = false;
  private abortConfirmTimer: Phaser.Time.TimerEvent | null = null;

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

  build(): void {
    this.unsubscribeMusicLoadState?.();
    this.unsubscribeMusicLoadState = null;
    this.musicLoadHideTimer?.destroy();
    this.musicLoadHideTimer = null;
    this.abortConfirmTimer?.destroy();
    this.abortConfirmTimer = null;
    this.abortConfirmPending = false;
    for (const slider of this.sliders.values()) {
      slider.fillEffect.destroy();
    }
    this.sliders.clear();
    this.qualityButtons.clear();
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.musicLoadTrack = null;
    this.musicLoadFill = null;
    this.musicLoadLabel = null;
    this.abortDivider = null;
    this.abortButton = null;
    this.abortLabel = null;
    this.abortHint = null;

    ensureOptionsTextures(this.scene);

    this.container = this.scene.add.container(0, 0)
      .setDepth(DEPTH.OVERLAY + 1);
    this.container.setVisible(false);

    const objects: Phaser.GameObjects.GameObject[] = [];
    this.dimRect = this.scene.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, DIM_COLOR, DIM_ALPHA)
      .setScrollFactor(0);
    objects.push(this.dimRect);

    const panel = this.scene.add.image(
      CX, CY,
      ensureModalPanelTexture(this.scene, '_options_panel', PANEL_W, PANEL_H, PANEL_BG, ACCENT),
    ).setScrollFactor(0);
    objects.push(panel);

    objects.push(
      this.scene.add.text(CX, TITLE_Y, 'OPTIONEN', {
        fontSize: '28px', fontFamily: 'monospace', fontStyle: 'bold',
        color: toCssColor(ACCENT),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    objects.push(
      this.scene.add.text(CX, SUBTITLE_Y, 'Grafikqualit\u00e4t', {
        fontSize: '16px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    objects.push(
      this.scene.add.rectangle(CX, SUBTITLE_Y + 26, PANEL_W - 60, 2, ACCENT)
        .setScrollFactor(0),
    );

    this.buildQualitySelector(objects);

    objects.push(
      this.scene.add.text(CX, CY - 130, 'Audio', {
        fontSize: '16px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3),
      }).setOrigin(0.5).setScrollFactor(0),
      this.scene.add.rectangle(CX, CY - 104, PANEL_W - 60, 2, ACCENT).setScrollFactor(0),
    );

    for (const definition of SLIDER_DEFINITIONS) {
      this.buildSlider(definition, objects);
    }
    this.buildMusicLoadingIndicator(objects);
    this.buildAbortSection(objects);

    objects.push(
      this.scene.add.text(CX, FOOTER_Y, '[ O / ESC / Klick zum Schließen ]', {
        fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    this.container.add(objects);
    this.unsubscribeMusicLoadState = this.audioSystem.subscribeMusicLoadState((state) => {
      this.syncMusicLoadingIndicator(state);
    });

    this.syncFromAudioSystem();
    this.syncQualityButtons();
    this.syncAbortSection();
  }

  show(): void {
    if (this.visible || !this.container) return;
    this.visible = true;
    this.syncFromAudioSystem();
    this.syncQualityButtons();
    this.resetAbortConfirm();
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
    this.resetAbortConfirm();
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
    this.unsubscribeMusicLoadState?.();
    this.unsubscribeMusicLoadState = null;
    this.musicLoadHideTimer?.destroy();
    this.musicLoadHideTimer = null;
    this.abortConfirmTimer?.destroy();
    this.abortConfirmTimer = null;
    this.abortConfirmPending = false;
    this.abortBinding = null;
    this.abortDivider = null;
    this.abortButton = null;
    this.abortLabel = null;
    this.abortHint = null;
    for (const slider of this.sliders.values()) {
      slider.fillEffect.destroy();
    }
    this.sliders.clear();
    this.qualityButtons.clear();
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.musicLoadTrack = null;
    this.musicLoadFill = null;
    this.musicLoadLabel = null;
  }

  private syncFromAudioSystem(): void {
    this.setSliderValue('master', this.audioSystem.getMasterVolume(), false, false);
    this.setSliderValue('effects', this.audioSystem.getEffectsVolume(), false, false);
    this.setSliderValue('music', this.audioSystem.getMusicVolume(), false, false);
  }

  private buildQualitySelector(objects: Phaser.GameObjects.GameObject[]): void {
    const totalWidth = QUALITY_OPTIONS.length * QUALITY_BUTTON_W
      + (QUALITY_OPTIONS.length - 1) * QUALITY_BUTTON_GAP;
    const startX = CX - totalWidth / 2 + QUALITY_BUTTON_W / 2;

    QUALITY_OPTIONS.forEach((option, index) => {
      const x = startX + index * (QUALITY_BUTTON_W + QUALITY_BUTTON_GAP);
      const background = this.scene.add.rectangle(
        x, QUALITY_BUTTON_Y, QUALITY_BUTTON_W, QUALITY_BUTTON_H, TRACK_BG, 0.96,
      ).setStrokeStyle(2, TRACK_BORDER)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.graphicsQuality.setLevel(option.level);
          setStoredGraphicsQuality(option.level);
          this.syncQualityButtons();
        });
      const label = this.scene.add.text(x, QUALITY_BUTTON_Y, option.label, {
        fontSize: '17px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_2),
      }).setOrigin(0.5).setScrollFactor(0);
      this.qualityButtons.set(option.level, { background, label });
      objects.push(background, label);
    });

    objects.push(
      this.scene.add.text(CX, QUALITY_BUTTON_Y + 42, 'Nur Darstellung \u2013 Physik und Netzwerk bleiben unver\u00e4ndert.', {
        fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
      }).setOrigin(0.5).setScrollFactor(0),
    );
  }

  private syncQualityButtons(): void {
    const selected = this.graphicsQuality.getLevel();
    for (const [level, state] of this.qualityButtons) {
      const active = level === selected;
      state.background
        .setFillStyle(active ? COLORS.GREY_5 : TRACK_BG, active ? 1 : 0.96)
        .setStrokeStyle(active ? 3 : 2, active ? ACCENT : TRACK_BORDER);
      state.label.setColor(toCssColor(active ? ACCENT : COLORS.GREY_2));
    }
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

    this.musicLoadLabel = this.scene.add.text(CX, MUSIC_LOAD_LABEL_Y, '', {
      fontSize: '12px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: toCssColor(COLORS.PURPLE_1),
    }).setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    objects.push(this.musicLoadTrack, this.musicLoadFill, this.musicLoadLabel);
  }

  private buildAbortSection(objects: Phaser.GameObjects.GameObject[]): void {
    this.abortDivider = this.scene.add.rectangle(CX, ABORT_DIVIDER_Y, PANEL_W - 60, 2, ACCENT)
      .setScrollFactor(0)
      .setVisible(false);

    this.abortButton = this.scene.add.image(
      CX,
      ABORT_BUTTON_Y,
      ensureGlossyButtonTexture(
        this.scene,
        `_options_abort_btn_${ABORT_BUTTON_W}x${ABORT_BUTTON_H}`,
        ABORT_BUTTON_W,
        ABORT_BUTTON_H,
        COLORS.RED_4,
        COLORS.RED_1,
      ),
    ).setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onAbortButtonPressed());

    this.abortLabel = this.scene.add.text(CX, ABORT_BUTTON_Y, '', {
      fontSize: '17px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5).setScrollFactor(0).setVisible(false);

    this.abortHint = this.scene.add.text(CX, ABORT_HINT_Y, '', {
      fontSize: '12px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
    }).setOrigin(0.5).setScrollFactor(0).setVisible(false);

    attachHoverEffect(this.scene, this.abortButton, this.abortLabel);
    objects.push(this.abortDivider, this.abortButton, this.abortLabel, this.abortHint);
  }

  /**
   * Blendet den Abbruch-Abschnitt passend zur aktuellen Bindung ein oder aus. Ohne laufende
   * Partie (oder als Client) bleibt der komplette Abschnitt unsichtbar, damit sich das Layout
   * der uebrigen Optionen nicht veraendert.
   */
  private syncAbortSection(): void {
    const available = this.abortBinding?.canAbort() === true;
    // Der Hover-Effekt skaliert Button und Beschriftung; beim Aus-/Einblenden feuert kein
    // pointerout mehr, deshalb hier den Ruhezustand explizit wiederherstellen.
    this.scene.tweens.killTweensOf([this.abortButton, this.abortLabel].filter((o) => !!o));
    this.abortButton?.setScale(1);
    this.abortLabel?.setScale(1);
    this.abortDivider?.setVisible(available);
    this.abortButton?.setVisible(available);
    this.abortLabel?.setVisible(available);
    this.abortHint?.setVisible(available);
    if (!available) {
      this.abortButton?.disableInteractive();
      return;
    }

    this.abortButton?.setInteractive({ useHandCursor: true });
    this.abortLabel
      ?.setText(this.abortConfirmPending ? 'WIRKLICH BEENDEN?' : 'PARTIE BEENDEN')
      .setColor(toCssColor(this.abortConfirmPending ? COLORS.RED_1 : COLORS.GREY_1));
    this.abortHint
      ?.setText(this.abortConfirmPending
        ? 'Erneut klicken zum Bestätigen'
        : 'Beendet die laufende Runde für alle Spieler')
      .setColor(toCssColor(this.abortConfirmPending ? COLORS.RED_1 : COLORS.GREY_4));
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
        .setText(`LOBBY-MUSIK WIRD GELADEN · ${Math.round(progress * 100)}%`);
      return;
    }

    if (state.status === 'complete') {
      fill.setDisplaySize(TRACK_W, MUSIC_LOAD_BAR_H - 2);
      label
        .setColor(toCssColor(COLORS.PURPLE_1))
        .setText('LOBBY-MUSIK BEREIT');
      this.scheduleMusicLoadingIndicatorHide(550);
      return;
    }

    track.setStrokeStyle(1, COLORS.RED_3);
    fill.setFillStyle(COLORS.RED_2, 1);
    label
      .setColor(toCssColor(COLORS.RED_1))
      .setText('LOBBY-MUSIK KONNTE NICHT GELADEN WERDEN');
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
