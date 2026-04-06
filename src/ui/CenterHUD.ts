/**
 * CenterHUD – feste UI-Elemente in der Bildschirmmitte.
 *
 * Enthält Timer (oben mittig), RB54-Widget (direkt darunter) und
 * temporäre Utility-Cooldown-Anzeige (unten mittig).
 * Wird nicht animiert – erscheint/verschwindet via setVisible().
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, DEPTH, COLORS, toCssColor } from '../config';
import {
  type LivingBarPalette,
  ensureLivingBarTextures, createGradientTexture, LivingBarEffect,
} from './LivingBarEffect';

// ── Layout-Konstanten ─────────────────────────────────────────────────────────
const CENTER_X     = GAME_WIDTH / 2;   // 960
const PANEL_WIDTH  = 200;

// Timer
const TIMER_Y             = 28;
const TIMER_BG_H          = 44;
const TIMER_COLOR_NORMAL  = '#e0e0e0';
const TIMER_COLOR_WARNING = '#ff4444';

// Zug-Widget (direkt unter Timer)
const TRAIN_SEP_Y     = 56;
const TRAIN_TEXT_Y    = 72;
const TRAIN_BAR_Y     = 90;   // Mittellinie (center-y) des Balkens
const TRAIN_BAR_H     = 12;
const TRAIN_BAR_W     = PANEL_WIDTH - 16;                   // 184
const TRAIN_BAR_LEFT  = CENTER_X - TRAIN_BAR_W / 2;        // 868
const TRAIN_BAR_TOP   = TRAIN_BAR_Y - TRAIN_BAR_H / 2;     // 84
const TRAIN_BAR_ALPHA = 0.7;
const TRAIN_BAR_TEX   = '_center_train_fg';
const TRAIN_PAL: LivingBarPalette = { dark: 0x3d1812, mid: 0xcf573c, light: 0xff8060 };

// Utility-Cooldown-Flash (unten mittig, temporär 500ms)
const FLASH_BAR_W   = 212;                               // identisch zu ArenaHUD BAR_W
const FLASH_LEFT_X  = CENTER_X - FLASH_BAR_W / 2;       // 854
const FLASH_BAR_H   = 14;
const FLASH_LABEL_H = 20;
const FLASH_TOTAL_H = FLASH_LABEL_H + FLASH_BAR_H;      // 34
const FLASH_GAP     = 8;   // Abstand über dem PU-Container
const FLASH_MARGIN  = 20;  // Abstand vom unteren Bildschirmrand
const FLASH_MS      = 500;
const FLASH_COLOR   = 0xd97030;   // Utility-Orange
const FLASH_BG_COL  = 0x1a0d00;

const COLOR_SEPARATOR = 0x334455;

const LABEL_FONT = {
  fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3),
};

export class CenterHUD {
  private container!: Phaser.GameObjects.Container;

  // Timer
  private timerText!: Phaser.GameObjects.Text;

  // Zug-Widget – Text
  private trainText!: Phaser.GameObjects.Text;

  // Zug-Widget – LivingBar
  private trainBarBg!:     Phaser.GameObjects.Rectangle;
  private trainBarFgImg!:  Phaser.GameObjects.Image;
  private trainBarEffect!: LivingBarEffect;
  private trainBarBorder!: Phaser.GameObjects.Rectangle;

  // Utility-Flash
  private utilFlashLabel!:  Phaser.GameObjects.Text;
  private utilFlashBg!:     Phaser.GameObjects.Rectangle;
  private utilFlashFg!:     Phaser.GameObjects.Rectangle;
  private utilFlashBorder!: Phaser.GameObjects.Rectangle;
  private utilFlashTimer:   Phaser.Time.TimerEvent | null = null;
  private puContainerRef:   Phaser.GameObjects.Container | null = null;

  // Zustand
  private lastTimerText:     string | null = null;
  private lastTimerColor:    string | null = null;
  private lastTrainText:     string | null = null;
  private lastTrainBarWidth  = -1;
  private lastTrainMode: 'hidden' | 'arrival' | 'hp' | 'destroyed' = 'hidden';

  constructor(private scene: Phaser.Scene) {}

  // ── Aufbau ────────────────────────────────────────────────────────────────

  build(): void {
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(DEPTH.OVERLAY - 1);
    this.container.setVisible(false);

    ensureLivingBarTextures(this.scene);
    if (!this.scene.textures.exists(TRAIN_BAR_TEX)) {
      createGradientTexture(this.scene, TRAIN_BAR_TEX, TRAIN_PAL, TRAIN_BAR_W, TRAIN_BAR_H);
    }

    this.buildTimer();
    this.buildTrainWidget();
    this.buildUtilFlash();
  }

  private buildTimer(): void {
    const timerBg = this.scene.add.rectangle(CENTER_X, TIMER_Y, PANEL_WIDTH, TIMER_BG_H, 0x000000, 0.35)
      .setScrollFactor(0);
    this.timerText = this.scene.add.text(CENTER_X, TIMER_Y, '2:00', {
      fontSize: '32px', fontFamily: 'monospace',
      color: TIMER_COLOR_NORMAL, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    this.container.add([timerBg, this.timerText]);
  }

  private buildTrainWidget(): void {
    // Trennlinie
    this.container.add(
      this.scene.add.rectangle(CENTER_X, TRAIN_SEP_Y, PANEL_WIDTH, 1, COLOR_SEPARATOR, 0.7)
        .setScrollFactor(0),
    );

    // Status-Text ("RB 54 um MM:SS" / "RB 54" / "fällt aus")
    this.trainText = this.scene.add.text(CENTER_X, TRAIN_TEXT_Y, '', {
      fontSize: '11px', fontFamily: 'monospace',
      color: '#c0a060', align: 'center',
      wordWrap: { width: PANEL_WIDTH - 8 },
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setVisible(false);
    this.container.add(this.trainText);

    // LivingBar: Hintergrund → FG-Gradient → Effekt → Rahmen
    this.trainBarBg = this.scene.add.rectangle(TRAIN_BAR_LEFT, TRAIN_BAR_TOP, TRAIN_BAR_W, TRAIN_BAR_H, 0x1a0a06)
      .setOrigin(0, 0).setScrollFactor(0).setAlpha(TRAIN_BAR_ALPHA).setVisible(false);
    this.container.add(this.trainBarBg);

    this.trainBarFgImg = this.scene.add.image(TRAIN_BAR_LEFT, TRAIN_BAR_TOP, TRAIN_BAR_TEX)
      .setOrigin(0, 0).setScrollFactor(0).setAlpha(TRAIN_BAR_ALPHA).setVisible(false);
    this.trainBarFgImg.setCrop(0, 0, 0, TRAIN_BAR_H);
    this.container.add(this.trainBarFgImg);

    // LivingBarEffect fügt Emitter selbst zum Container hinzu
    this.trainBarEffect = new LivingBarEffect(
      this.scene, this.container,
      TRAIN_BAR_LEFT, TRAIN_BAR_TOP, TRAIN_BAR_W, TRAIN_BAR_H,
      TRAIN_PAL,
      { glowTarget: this.trainBarFgImg, scrollFactor: 0, intensity: TRAIN_BAR_ALPHA },
    );

    this.trainBarBorder = this.scene.add.rectangle(TRAIN_BAR_LEFT, TRAIN_BAR_TOP, TRAIN_BAR_W, TRAIN_BAR_H)
      .setOrigin(0, 0).setScrollFactor(0)
      .setStrokeStyle(1, 0x5a2010, 0.6)
      .setFillStyle(0, 0)
      .setAlpha(TRAIN_BAR_ALPHA).setVisible(false);
    this.container.add(this.trainBarBorder);
  }

  private buildUtilFlash(): void {
    // Elemente für die temporäre Utility-Cooldown-Anzeige (initial hidden)
    this.utilFlashLabel = this.scene.add.text(CENTER_X, 0, '', LABEL_FONT)
      .setOrigin(0.5, 0).setScrollFactor(0).setVisible(false);
    this.utilFlashBg = this.scene.add.rectangle(FLASH_LEFT_X, 0, FLASH_BAR_W, FLASH_BAR_H, FLASH_BG_COL)
      .setOrigin(0, 0).setScrollFactor(0).setVisible(false);
    this.utilFlashFg = this.scene.add.rectangle(FLASH_LEFT_X, 0, FLASH_BAR_W, FLASH_BAR_H, FLASH_COLOR)
      .setOrigin(0, 0).setScrollFactor(0).setVisible(false);
    this.utilFlashBorder = this.scene.add.rectangle(FLASH_LEFT_X, 0, FLASH_BAR_W, FLASH_BAR_H)
      .setOrigin(0, 0).setScrollFactor(0)
      .setStrokeStyle(1, 0x705020, 0.8).setFillStyle(0, 0)
      .setVisible(false);
    this.container.add([this.utilFlashLabel, this.utilFlashBg, this.utilFlashFg, this.utilFlashBorder]);
  }

  // ── Transitions ───────────────────────────────────────────────────────────

  transitionToGame(): void {
    this.container.setVisible(true);
  }

  transitionToLobby(): void {
    this.container.setVisible(false);
    this.hideTrainWidget();
    this.cancelUtilFlash();
    this.lastTimerText  = null;
    this.lastTimerColor = null;
  }

  // ── Konfiguration ─────────────────────────────────────────────────────────

  /** Referenz auf den Power-Up-Container für dynamische Positionierung des Flash-Balkens. */
  setPuContainer(c: Phaser.GameObjects.Container): void {
    this.puContainerRef = c;
  }

  // ── Timer ─────────────────────────────────────────────────────────────────

  updateTimer(secs: number): void {
    const mm = Math.floor(secs / 60);
    const ss = secs % 60;
    const nextText  = `${mm}:${ss.toString().padStart(2, '0')}`;
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

  // ── Zug-Widget ────────────────────────────────────────────────────────────

  setTrainArrival(arrivalTimerSecs: number): void {
    const mm = Math.floor(arrivalTimerSecs / 60);
    const ss = arrivalTimerSecs % 60;
    const nextText = `RB 54 um ${mm}:${ss.toString().padStart(2, '0')}`;
    if (this.lastTrainText !== nextText) {
      this.trainText.setText(nextText);
      this.lastTrainText = nextText;
    }
    if (this.lastTrainMode !== 'arrival') {
      this.trainText.setVisible(true);
      this.hideTrainBar();
      this.lastTrainMode     = 'arrival';
      this.lastTrainBarWidth = -1;
    }
  }

  updateTrainHP(hp: number, maxHp: number): void {
    const ratio    = Math.max(0, hp / maxHp);
    const nextText = 'RB 54';
    if (this.lastTrainText !== nextText) {
      this.trainText.setText(nextText);
      this.lastTrainText = nextText;
    }
    if (this.lastTrainMode !== 'hp') {
      this.trainText.setVisible(true);
      this.trainBarBg.setVisible(true);
      this.trainBarFgImg.setVisible(true);
      this.trainBarBorder.setVisible(true);
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
      this.trainText.setVisible(true);
      this.hideTrainBar();
      this.lastTrainMode     = 'destroyed';
      this.lastTrainBarWidth = -1;
    }
  }

  hideTrainWidget(): void {
    if (this.lastTrainMode !== 'hidden') {
      this.trainText.setVisible(false);
      this.hideTrainBar();
      this.lastTrainMode     = 'hidden';
      this.lastTrainBarWidth = -1;
    }
    this.lastTrainText = null;
  }

  // ── Utility-Flash ─────────────────────────────────────────────────────────

  /**
   * Blendet die Utility-Cooldown-Anzeige für FLASH_MS ein.
   * frac: Anteil verbleibender Cooldown (0 = bereit, 1 = gerade genutzt).
   */
  flashUtilityCooldown(frac: number, displayName: string): void {
    // Laufenden Timer abbrechen (re-trigger verlängert die Anzeige nicht, sie wird neu gestartet)
    this.cancelUtilFlash();

    const topY = this.computeFlashTopY();
    const fillW = Math.max(0, Math.round(FLASH_BAR_W * frac));
    const barY  = topY + FLASH_LABEL_H;

    this.utilFlashLabel.setText(`Utility: ${displayName}`).setY(topY).setVisible(true);
    this.utilFlashBg.setPosition(FLASH_LEFT_X, barY).setVisible(true);
    this.utilFlashFg.setPosition(FLASH_LEFT_X, barY).setSize(fillW, FLASH_BAR_H).setVisible(true);
    this.utilFlashBorder.setPosition(FLASH_LEFT_X, barY).setVisible(true);

    this.utilFlashTimer = this.scene.time.delayedCall(FLASH_MS, () => {
      this.cancelUtilFlash();
    });
  }

  // ── Destroy ───────────────────────────────────────────────────────────────

  destroy(): void {
    this.trainBarEffect.destroy();
    this.container.destroy(true);
  }

  // ── Interne Helfer ────────────────────────────────────────────────────────

  private hideTrainBar(): void {
    this.trainBarBg.setVisible(false);
    this.trainBarFgImg.setVisible(false);
    this.trainBarBorder.setVisible(false);
    this.trainBarEffect.stop();
  }

  private cancelUtilFlash(): void {
    this.utilFlashTimer?.remove();
    this.utilFlashTimer = null;
    this.utilFlashLabel.setVisible(false);
    this.utilFlashBg.setVisible(false);
    this.utilFlashFg.setVisible(false);
    this.utilFlashBorder.setVisible(false);
  }

  /** Berechnet die obere Y-Koordinate des Flash-Balkens (absolut, im CenterHUD-Container). */
  private computeFlashTopY(): number {
    if (this.puContainerRef?.visible) {
      // Über dem Power-Up-Container
      return this.puContainerRef.y - FLASH_GAP - FLASH_TOTAL_H;
    }
    // Unterer Bildschirmrand
    return GAME_HEIGHT - FLASH_MARGIN - FLASH_TOTAL_H;
  }
}
