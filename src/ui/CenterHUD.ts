/**
 * CenterHUD – feste UI-Elemente in der Bildschirmmitte.
 *
 * Enthält Timer (oben mittig), RB54-Widget (direkt darunter) und
 * den unteren Stack für Power-Ups, Utility und Ultimate.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, DEPTH, COLORS, RAGE_MAX, toCssColor } from '../config';
import type { ArenaHUDData } from './ArenaHUD';
import {
  rgbStr,
  type LivingBarPalette,
  ensureLivingBarTextures, createGradientTexture, LivingBarEffect,
} from './LivingBarEffect';

const CENTER_X       = GAME_WIDTH / 2;
const PANEL_WIDTH    = 200;
const PANEL_BG_COL   = 0x000000;
const PANEL_BG_ALPHA = 0.25;

const TIMER_Y             = 28;
const TIMER_BG_H          = 44;
const TIMER_COLOR_NORMAL  = '#e0e0e0';
const TIMER_COLOR_WARNING = '#ff4444';

const ANNOUNCEMENT_Y          = GAME_HEIGHT / 2;
const ANNOUNCEMENT_MAX_TEXT_W = 560;
const ANNOUNCEMENT_MIN_W      = 240;
const ANNOUNCEMENT_MIN_H      = 48;
const ANNOUNCEMENT_PAD_X      = 20;
const ANNOUNCEMENT_PAD_Y      = 14;
const ANNOUNCEMENT_HOLD_MS    = 800;
const ANNOUNCEMENT_FADE_MS    = 200;
const ANNOUNCEMENT_DEBOUNCE_MS = 600;
const ANNOUNCEMENT_TEXT_COLOR = '#e0e0e0';
const ANNOUNCEMENT_WARN_COLOR = TIMER_COLOR_WARNING;

const TRAIN_SEP_Y      = 56;
const TRAIN_TEXT_Y     = 72;
const TRAIN_BAR_Y      = 90;
const TRAIN_BAR_H      = 12;
const TRAIN_BAR_W      = PANEL_WIDTH - 16;
const TRAIN_BAR_LEFT   = CENTER_X - TRAIN_BAR_W / 2;
const TRAIN_BAR_TOP    = TRAIN_BAR_Y - TRAIN_BAR_H / 2;
const TRAIN_BAR_ALPHA  = 1;
const TRAIN_BAR_TEX    = '_center_train_fg';
const TRAIN_BAR_BG_TEX = '_center_train_bg';
const TRAIN_PAL: LivingBarPalette = { dark: 0x3d1812, mid: 0xcf573c, light: 0xff8060 };
const TRAIN_PANEL_Y    = 78;
const TRAIN_PANEL_H    = 54;

const STACK_BAR_W      = 212;
const STACK_BAR_H      = 14;
const STACK_LABEL_H    = 20;
const STACK_TOTAL_H    = STACK_LABEL_H + STACK_BAR_H;
const STACK_PANEL_W    = STACK_BAR_W + 20;
const STACK_PANEL_H    = STACK_TOTAL_H + 4;
const STACK_MARGIN     = 20;
const STACK_GAP        = 8;
const STACK_REVEAL_MS  = 500;
const STACK_BAR_LEFT   = -STACK_BAR_W / 2;
const STACK_FADE_MS    = 100;
const STACK_CORE_TEX   = '_center_core';

const UTIL_BAR_TEX     = '_center_util_fg';
const ULT_BAR_TEX      = '_center_ult_fg';
const STACK_BAR_BG_TEX = '_center_stack_bg';
const UTIL_PAL: LivingBarPalette = { dark: 0x8a4018, mid: 0xd97030, light: 0xf0a048 };
const ULT_PAL: LivingBarPalette = { dark: COLORS.RED_3, mid: COLORS.RED_2, light: COLORS.RED_1 };

const COLOR_SEPARATOR = 0x334455;
const COL_BAR_BG      = COLORS.GREY_9;
const COL_BAR_BG2     = COLORS.GREY_8;
const COL_BORDER      = COLORS.GREY_6;

const LABEL_FONT = {
  fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3),
};
const ANNOUNCEMENT_FONT = {
  fontSize: '22px', fontFamily: 'monospace', fontStyle: 'bold', color: ANNOUNCEMENT_TEXT_COLOR,
  align: 'center' as const,
  wordWrap: { width: ANNOUNCEMENT_MAX_TEXT_W },
};

function ensureBarBgTexture(scene: Phaser.Scene, key: string, width: number, height: number): void {
  if (scene.textures.exists(key)) return;
  const ct = scene.textures.createCanvas(key, width, height)!;
  const ctx = ct.context;
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, rgbStr(COL_BAR_BG2));
  grad.addColorStop(1, rgbStr(COL_BAR_BG));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, width, 1);
  ct.refresh();
}

interface LowerBarSection {
  container: Phaser.GameObjects.Container;
  panelBg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.Image;
  fg: Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Rectangle;
  effect: LivingBarEffect;
  energyZone: Phaser.Geom.Rectangle;
  coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  outerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  energized: boolean;
  glow: Phaser.FX.Glow | null;
  glowTween: Phaser.Tweens.Tween | null;
  labelTween: Phaser.Tweens.Tween | null;
  hideTween: Phaser.Tweens.Tween | null;
  lastWidth: number;
  lastLabel: string | null;
}

function ensureRadialTexture(
  scene: Phaser.Scene,
  key: string,
  size: number,
  colorStops: [number, string][],
): void {
  if (scene.textures.exists(key)) return;
  const ct = scene.textures.createCanvas(key, size, size)!;
  const ctx = ct.context;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [stop, color] of colorStops) grad.addColorStop(stop, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ct.refresh();
}

export class CenterHUD {
  private container!: Phaser.GameObjects.Container;

  private timerText!: Phaser.GameObjects.Text;
  private announcementContainer!: Phaser.GameObjects.Container;
  private announcementBg!: Phaser.GameObjects.Rectangle;
  private announcementText!: Phaser.GameObjects.Text;
  private announcementTween: Phaser.Tweens.Tween | null = null;
  private lastAdrenalineAnnouncementAt = -Number.MAX_VALUE;

  private trainText!: Phaser.GameObjects.Text;
  private trainPanelBg!: Phaser.GameObjects.Rectangle;
  private trainBarBg!: Phaser.GameObjects.Image;
  private trainBarFgImg!: Phaser.GameObjects.Image;
  private trainBarEffect!: LivingBarEffect;
  private trainBarBorder!: Phaser.GameObjects.Rectangle;

  private utilitySection!: LowerBarSection;
  private ultimateSection!: LowerBarSection;
  private puContainerRef: Phaser.GameObjects.Container | null = null;

  private lastTimerText: string | null = null;
  private lastTimerColor: string | null = null;
  private lastTrainText: string | null = null;
  private lastTrainBarWidth = -1;
  private lastTrainMode: 'hidden' | 'arrival' | 'hp' | 'destroyed' = 'hidden';
  private utilityRevealUntil = 0;
  private utilityHeldLastFrame = false;
  private utilityAttentionActive = false;
  private ultimateReadyActive = false;

  constructor(private scene: Phaser.Scene) {}

  build(): void {
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(DEPTH.OVERLAY - 1);
    this.container.setVisible(false);

    ensureLivingBarTextures(this.scene);
    ensureBarBgTexture(this.scene, TRAIN_BAR_BG_TEX, TRAIN_BAR_W, TRAIN_BAR_H);
    ensureBarBgTexture(this.scene, STACK_BAR_BG_TEX, STACK_BAR_W, STACK_BAR_H);
    ensureRadialTexture(this.scene, STACK_CORE_TEX, 14, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.3, 'rgba(255,255,255,0.7)'],
      [0.6, 'rgba(255,255,255,0.2)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    if (!this.scene.textures.exists(TRAIN_BAR_TEX)) {
      createGradientTexture(this.scene, TRAIN_BAR_TEX, TRAIN_PAL, TRAIN_BAR_W, TRAIN_BAR_H);
    }
    if (!this.scene.textures.exists(UTIL_BAR_TEX)) {
      createGradientTexture(this.scene, UTIL_BAR_TEX, UTIL_PAL, STACK_BAR_W, STACK_BAR_H);
    }
    if (!this.scene.textures.exists(ULT_BAR_TEX)) {
      createGradientTexture(this.scene, ULT_BAR_TEX, ULT_PAL, STACK_BAR_W, STACK_BAR_H);
    }

    this.buildTimer();
    this.buildAnnouncementOverlay();
    this.buildTrainWidget();
    this.buildBottomStack();
  }

  private buildTimer(): void {
    const timerBg = this.scene.add.rectangle(CENTER_X, TIMER_Y, PANEL_WIDTH, TIMER_BG_H, 0x000000, 0.35)
      .setScrollFactor(0);
    this.timerText = this.scene.add.text(CENTER_X, TIMER_Y, '2:00', {
      fontSize: '32px', fontFamily: 'monospace', color: TIMER_COLOR_NORMAL, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    this.container.add([timerBg, this.timerText]);
  }

  private buildAnnouncementOverlay(): void {
    this.announcementBg = this.scene.add.rectangle(CENTER_X, ANNOUNCEMENT_Y, ANNOUNCEMENT_MIN_W, ANNOUNCEMENT_MIN_H, PANEL_BG_COL, PANEL_BG_ALPHA)
      .setScrollFactor(0)
      .setVisible(false);
    this.announcementText = this.scene.add.text(CENTER_X, ANNOUNCEMENT_Y, '', ANNOUNCEMENT_FONT)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);
    this.announcementContainer = this.scene.add.container(0, 0, [this.announcementBg, this.announcementText]);
    this.announcementContainer.setScrollFactor(0).setVisible(false).setAlpha(1);
    this.container.add(this.announcementContainer);
  }

  private buildTrainWidget(): void {
    this.trainPanelBg = this.scene.add.rectangle(CENTER_X, TRAIN_PANEL_Y, PANEL_WIDTH, TRAIN_PANEL_H, PANEL_BG_COL, PANEL_BG_ALPHA)
      .setScrollFactor(0)
      .setVisible(false);
    this.container.add(this.trainPanelBg);


    this.trainText = this.scene.add.text(CENTER_X, TRAIN_TEXT_Y, '', {
      fontSize: '16px', fontFamily: 'monospace', color: '#c0a060', align: 'center',
      wordWrap: { width: PANEL_WIDTH - 8 },
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setVisible(false);
    this.container.add(this.trainText);

    this.trainBarBg = this.scene.add.image(TRAIN_BAR_LEFT, TRAIN_BAR_TOP, TRAIN_BAR_BG_TEX)
      .setOrigin(0, 0).setScrollFactor(0).setAlpha(TRAIN_BAR_ALPHA).setVisible(false);
    this.container.add(this.trainBarBg);

    this.trainBarFgImg = this.scene.add.image(TRAIN_BAR_LEFT, TRAIN_BAR_TOP, TRAIN_BAR_TEX)
      .setOrigin(0, 0).setScrollFactor(0).setAlpha(TRAIN_BAR_ALPHA).setVisible(false);
    this.trainBarFgImg.setCrop(0, 0, 0, TRAIN_BAR_H);
    this.container.add(this.trainBarFgImg);

    this.trainBarEffect = new LivingBarEffect(
      this.scene,
      this.container,
      TRAIN_BAR_LEFT,
      TRAIN_BAR_TOP,
      TRAIN_BAR_W,
      TRAIN_BAR_H,
      TRAIN_PAL,
      { glowTarget: this.trainBarFgImg, scrollFactor: 0, intensity: TRAIN_BAR_ALPHA },
    );

    this.trainBarBorder = this.scene.add.rectangle(TRAIN_BAR_LEFT, TRAIN_BAR_TOP, TRAIN_BAR_W, TRAIN_BAR_H)
      .setOrigin(0, 0).setScrollFactor(0)
      .setStrokeStyle(1, 0x5a2010, 0.6)
      .setFillStyle(0, 0)
      .setAlpha(TRAIN_BAR_ALPHA)
      .setVisible(false);
    this.container.add(this.trainBarBorder);
  }

  private buildBottomStack(): void {
    this.utilitySection = this.createLowerSection(UTIL_BAR_TEX, UTIL_PAL);
    this.ultimateSection = this.createLowerSection(ULT_BAR_TEX, ULT_PAL);
  }

  private createLowerSection(textureKey: string, palette: LivingBarPalette): LowerBarSection {
    const section = this.scene.add.container(CENTER_X, 0);
    section.setVisible(false).setAlpha(1);

    const panelBg = this.scene.add.rectangle(0, STACK_TOTAL_H / 2, STACK_PANEL_W, STACK_PANEL_H, PANEL_BG_COL, PANEL_BG_ALPHA)
      .setScrollFactor(0);
    const label = this.scene.add.text(0, 0, '', LABEL_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    const bg = this.scene.add.image(STACK_BAR_LEFT, STACK_LABEL_H, STACK_BAR_BG_TEX)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    const fg = this.scene.add.image(STACK_BAR_LEFT, STACK_LABEL_H, textureKey)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    fg.setCrop(0, 0, 0, STACK_BAR_H);
    const border = this.scene.add.rectangle(STACK_BAR_LEFT, STACK_LABEL_H, STACK_BAR_W, STACK_BAR_H)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(1, COL_BORDER, 1)
      .setFillStyle(0, 0);

    const energyZone = new Phaser.Geom.Rectangle(STACK_BAR_LEFT + 2, STACK_LABEL_H + 1, STACK_BAR_W - 4, STACK_BAR_H - 2);
    const zoneData = { type: 'random', source: energyZone } as Phaser.Types.GameObjects.Particles.EmitZoneData;
    const coreEmitter = this.scene.add.particles(0, 0, STACK_CORE_TEX, {
      lifespan:  { min: 200, max: 500 },
      frequency: 30,
      quantity:  2,
      speedX:    { min: -8, max: 8 },
      speedY:    { min: -3, max: 3 },
      scale:     { start: 0.6, end: 0.1 },
      alpha:     { start: 0.9, end: 0 },
      tint:      [palette.light, 0xffffff, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    }).setScrollFactor(0);
    coreEmitter.addEmitZone(zoneData);

    const outerEmitter = this.scene.add.particles(0, 0, '_living_blob', {
      lifespan:  { min: 400, max: 800 },
      frequency: 50,
      quantity:  1,
      speedX:    { min: -5, max: 5 },
      speedY:    { min: -2, max: 2 },
      scale:     { start: 0.7, end: 0.15 },
      alpha:     { start: 0.5, end: 0 },
      tint:      [palette.mid, palette.light, palette.dark],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    }).setScrollFactor(0);
    outerEmitter.addEmitZone(zoneData);

    section.add([panelBg, label, bg, fg]);
    const effect = new LivingBarEffect(
      this.scene,
      section,
      STACK_BAR_LEFT,
      STACK_LABEL_H,
      STACK_BAR_W,
      STACK_BAR_H,
      palette,
      { glowTarget: fg, scrollFactor: 0 },
    );
    section.add([coreEmitter, outerEmitter, border]);
    this.container.add(section);

    return {
      container: section,
      panelBg,
      label,
      bg,
      fg,
      border,
      effect,
      energyZone,
      coreEmitter,
      outerEmitter,
      energized: false,
      glow: null,
      glowTween: null,
      labelTween: null,
      hideTween: null,
      lastWidth: -1,
      lastLabel: null,
    };
  }

  transitionToGame(): void {
    this.container.setVisible(true);
  }

  transitionToLobby(): void {
    this.container.setVisible(false);
    this.hideAnnouncement();
    this.hideTrainWidget();
    this.hideLowerSection(this.utilitySection);
    this.hideLowerSection(this.ultimateSection);
    this.stopSectionAttention(this.utilitySection);
    this.stopSectionAttention(this.ultimateSection);
    this.utilityRevealUntil = 0;
    this.utilityHeldLastFrame = false;
    this.utilityAttentionActive = false;
    this.ultimateReadyActive = false;
    this.lastTimerText = null;
    this.lastTimerColor = null;
  }

  setPuContainer(c: Phaser.GameObjects.Container): void {
    this.puContainerRef = c;
  }

  updateTimer(secs: number): void {
    const mm = Math.floor(secs / 60);
    const ss = secs % 60;
    const nextText = `${mm}:${ss.toString().padStart(2, '0')}`;
    const nextColor = secs <= 10 ? TIMER_COLOR_WARNING : TIMER_COLOR_NORMAL;
    if (nextText !== this.lastTimerText) {
      this.timerText.setText(nextText);
      this.lastTimerText = nextText;
    }
    if (nextColor !== this.lastTimerColor) {
      this.timerText.setColor(nextColor);
      this.lastTimerColor = nextColor;
    }
  }

  setTrainArrival(arrivalTimerSecs: number): void {
    const mm = Math.floor(arrivalTimerSecs / 60);
    const ss = arrivalTimerSecs % 60;
    const nextText = `RB 54 um ${mm}:${ss.toString().padStart(2, '0')}`;
    if (this.lastTrainText !== nextText) {
      this.trainText.setText(nextText);
      this.lastTrainText = nextText;
    }
    if (this.lastTrainMode !== 'arrival') {
      this.trainPanelBg.setVisible(true);
      this.trainText.setVisible(true);
      this.hideTrainBar();
      this.lastTrainMode = 'arrival';
      this.lastTrainBarWidth = -1;
    }
  }

  updateTrainHP(hp: number, maxHp: number): void {
    const ratio = maxHp > 0 ? Math.max(0, hp / maxHp) : 0;
    const nextText = 'RB 54';
    if (this.lastTrainText !== nextText) {
      this.trainText.setText(nextText);
      this.lastTrainText = nextText;
    }
    if (this.lastTrainMode !== 'hp') {
      this.trainPanelBg.setVisible(true);
      this.trainText.setVisible(true);
      this.trainBarBg.setVisible(true);
      this.trainBarFgImg.setVisible(true);
      this.trainBarBorder.setVisible(true);
      this.trainBarEffect.start();
      this.lastTrainMode = 'hp';
    }
    const fillW = Math.max(0, Math.round(TRAIN_BAR_W * ratio));
    if (this.lastTrainBarWidth !== fillW) {
      this.trainBarFgImg.setCrop(0, 0, fillW, TRAIN_BAR_H);
      this.trainBarEffect.setFilledWidth(fillW);
      this.lastTrainBarWidth = fillW;
    }
  }

  showTrainDestroyed(): void {
    const nextText = 'RB 54 fällt\nheute leider aus';
    if (this.lastTrainText !== nextText) {
      this.trainText.setText(nextText);
      this.lastTrainText = nextText;
    }
    if (this.lastTrainMode !== 'destroyed') {
      this.trainPanelBg.setVisible(true);
      this.trainText.setVisible(true);
      this.hideTrainBar();
      this.lastTrainMode = 'destroyed';
      this.lastTrainBarWidth = -1;
    }
  }

  hideTrainWidget(): void {
    if (this.lastTrainMode !== 'hidden') {
      this.trainPanelBg.setVisible(false);
      this.trainText.setVisible(false);
      this.hideTrainBar();
      this.lastTrainMode = 'hidden';
      this.lastTrainBarWidth = -1;
    }
    this.lastTrainText = null;
  }

  updateBottomStatus(data: ArenaHUDData, utilityHeld: boolean): void {
    const now = this.scene.time.now;
    if (utilityHeld) {
      this.utilityHeldLastFrame = true;
    } else if (this.utilityHeldLastFrame) {
      this.utilityHeldLastFrame = false;
      this.utilityRevealUntil = now + STACK_REVEAL_MS;
    }

    const showUtility = utilityHeld
      || data.utilityCooldownFrac > 0.001
      || now < this.utilityRevealUntil
      || (data.isUtilityOverridden ?? false);
    const isUltimateReady = data.isUltimateActive || data.rage >= data.ultimateRequiredRage;
    const showUltimate = isUltimateReady;

    let nextBottom = GAME_HEIGHT - STACK_MARGIN;

    if (showUltimate) {
      this.showLowerSection(
        this.ultimateSection,
        `Ultimate: ${data.ultimateDisplayName ?? 'Ultimate'}`,
        Phaser.Math.Clamp(data.rage / RAGE_MAX, 0, 1),
        CENTER_X,
        nextBottom - STACK_TOTAL_H,
      );
      this.setUltimateReadyVisual(true);
      nextBottom = this.ultimateSection.container.y - STACK_GAP;
    } else {
      this.setUltimateReadyVisual(false);
      this.hideLowerSection(this.ultimateSection);
    }

    if (showUtility) {
      this.showLowerSection(
        this.utilitySection,
        `Utility: ${data.utilityDisplayName ?? 'Utility'}`,
        Phaser.Math.Clamp(1 - data.utilityCooldownFrac, 0, 1),
        CENTER_X,
        nextBottom - STACK_TOTAL_H,
      );
      this.setUtilityAttention(data.isUtilityOverridden ?? false);
      nextBottom = this.utilitySection.container.y - STACK_GAP;
    } else {
      this.setUtilityAttention(false);
      this.hideLowerSection(this.utilitySection);
    }

    this.layoutPowerUps(nextBottom);
  }

  flashUtilityCooldown(_frac: number, _displayName: string): void {
    this.utilityRevealUntil = Math.max(this.utilityRevealUntil, this.scene.time.now + STACK_REVEAL_MS);
  }

  showAnnouncement(text: string, color: string | number = ANNOUNCEMENT_TEXT_COLOR): void {
    this.announcementTween?.destroy();
    this.announcementTween = null;
    this.announcementText.setText(text);
    this.announcementText.setColor(typeof color === 'number' ? toCssColor(color) : color);

    const width = Math.max(
      ANNOUNCEMENT_MIN_W,
      Math.min(ANNOUNCEMENT_MAX_TEXT_W + ANNOUNCEMENT_PAD_X * 2, this.announcementText.width + ANNOUNCEMENT_PAD_X * 2),
    );
    const height = Math.max(ANNOUNCEMENT_MIN_H, this.announcementText.height + ANNOUNCEMENT_PAD_Y * 2);
    this.announcementBg.setSize(width, height);

    this.announcementContainer.setAlpha(1).setVisible(true);
    this.announcementBg.setVisible(true);
    this.announcementText.setVisible(true);

    this.announcementTween = this.scene.tweens.add({
      targets: this.announcementContainer,
      alpha: 0,
      delay: ANNOUNCEMENT_HOLD_MS,
      duration: ANNOUNCEMENT_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => this.hideAnnouncement(),
    });
  }

  showAdrenalineLow(): void {
    const now = this.scene.time.now;
    if (now - this.lastAdrenalineAnnouncementAt < ANNOUNCEMENT_DEBOUNCE_MS) return;
    this.lastAdrenalineAnnouncementAt = now;
    this.showAnnouncement('Adrenalin niedrig', ANNOUNCEMENT_WARN_COLOR);
  }

  showFraggedBy(killerName: string, weapon: string, color: number): void {
    this.showAnnouncement(`Fragged by ${killerName} (${weapon})`, color);
  }

  showYouFragged(victimName: string, color: number): void {
    this.showAnnouncement(`You Fragged ${victimName}`, color);
  }

  showBeerCaptured(playerName: string, color: number): void {
    this.showAnnouncement(`${playerName} captured the Beer!`, color);
  }

  destroy(): void {
    this.hideAnnouncement();
    this.trainBarEffect.destroy();
    this.stopSectionAttention(this.utilitySection);
    this.stopSectionAttention(this.ultimateSection);
    this.utilitySection.effect.destroy();
    this.ultimateSection.effect.destroy();
    this.utilitySection.coreEmitter.destroy();
    this.utilitySection.outerEmitter.destroy();
    this.ultimateSection.coreEmitter.destroy();
    this.ultimateSection.outerEmitter.destroy();
    this.container.destroy(true);
  }

  private showLowerSection(section: LowerBarSection, label: string, frac: number, x: number, y: number): void {
    const fillW = Math.max(0, Math.round(STACK_BAR_W * Phaser.Math.Clamp(frac, 0, 1)));
    if (section.hideTween) {
      section.hideTween.destroy();
      section.hideTween = null;
    }
    section.container.setPosition(x, y).setVisible(true).setAlpha(1);
    section.panelBg.setVisible(true);
    section.bg.setVisible(true);
    section.fg.setVisible(true);
    section.border.setVisible(true);
    if (section.lastLabel !== label) {
      section.label.setText(label);
      section.lastLabel = label;
    }
    section.label.setVisible(true);
    if (section.lastWidth !== fillW) {
      section.fg.setCrop(0, 0, fillW, STACK_BAR_H);
      section.effect.setFilledWidth(fillW);
      section.energyZone.width = fillW > 6 ? fillW - 4 : 0;
      section.lastWidth = fillW;
    }
    if (fillW <= 6) {
      section.coreEmitter.stop();
      section.outerEmitter.stop();
      if (!section.energized) section.effect.stop();
    } else {
      if (section.energized) {
        if (!section.coreEmitter.emitting) section.coreEmitter.start();
        if (!section.outerEmitter.emitting) section.outerEmitter.start();
      } else {
        section.effect.start();
      }
    }
  }

  private hideLowerSection(section: LowerBarSection): void {
    if (!section.container.visible || section.hideTween) return;
    section.hideTween = this.scene.tweens.add({
      targets: section.container,
      alpha: 0,
      duration: STACK_FADE_MS,
      ease: 'Linear',
      onComplete: () => {
        section.hideTween = null;
        section.container.setVisible(false).setAlpha(1);
        section.effect.stop();
        section.coreEmitter.stop();
        section.outerEmitter.stop();
        section.lastWidth = -1;
      },
    });
  }

  private layoutPowerUps(nextBottom: number): void {
    if (!this.puContainerRef?.visible) return;
    const stackHeight = Number(this.puContainerRef.getData('stackHeight') ?? 0);
    this.puContainerRef.setY(nextBottom - stackHeight);
  }

  private setUtilityAttention(enabled: boolean): void {
    if (enabled === this.utilityAttentionActive) return;
    this.utilityAttentionActive = enabled;
    this.setSectionEnergized(this.utilitySection, enabled);
    if (enabled) {
      this.utilitySection.glow = this.utilitySection.fg.postFX.addGlow(UTIL_PAL.light, 3, 0, false, 0.4, 8);
      this.utilitySection.glowTween = this.scene.tweens.add({
        targets: this.utilitySection.glow,
        outerStrength: 8,
        duration: 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.utilitySection.labelTween = this.scene.tweens.add({
        targets: this.utilitySection.label,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      return;
    }
    this.stopSectionAttention(this.utilitySection);
  }

  private setUltimateReadyVisual(enabled: boolean): void {
    if (enabled === this.ultimateReadyActive) return;
    this.ultimateReadyActive = enabled;
    this.setSectionEnergized(this.ultimateSection, enabled);
    if (enabled) {
      this.ultimateSection.glow = this.ultimateSection.fg.postFX.addGlow(0xff3300, 4, 0, false, 0.3, 10);
      this.ultimateSection.glowTween = this.scene.tweens.add({
        targets: this.ultimateSection.glow,
        outerStrength: 8,
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      return;
    }
    this.stopSectionAttention(this.ultimateSection);
  }

  private stopSectionAttention(section: LowerBarSection): void {
    if (section.labelTween) {
      section.labelTween.destroy();
      section.labelTween = null;
      section.label.setScale(1);
    }
    if (section.glowTween) {
      section.glowTween.destroy();
      section.glowTween = null;
    }
    if (section.glow) {
      section.fg.postFX.remove(section.glow);
      section.glow = null;
    }
  }

  private setSectionEnergized(section: LowerBarSection, energized: boolean): void {
    if (section.energized === energized) return;
    section.energized = energized;
    const hasFill = section.lastWidth > 6;
    if (energized) {
      section.effect.stop();
      if (hasFill) {
        section.coreEmitter.start();
        section.outerEmitter.start();
      }
      return;
    }

    section.coreEmitter.stop();
    section.outerEmitter.stop();
    if (section.container.visible && hasFill) section.effect.start();
  }

  private hideTrainBar(): void {
    this.trainBarBg.setVisible(false);
    this.trainBarFgImg.setVisible(false);
    this.trainBarBorder.setVisible(false);
    this.trainBarEffect.stop();
  }

  private hideAnnouncement(): void {
    this.announcementTween?.destroy();
    this.announcementTween = null;
    this.announcementContainer.setVisible(false).setAlpha(1);
    this.announcementBg.setVisible(false);
    this.announcementText.setVisible(false);
  }
}
