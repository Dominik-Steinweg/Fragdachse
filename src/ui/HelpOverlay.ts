/**
 * HelpOverlay – Steuerungsübersicht als modales Overlay.
 * Wird über den „?"-Button in der Lobby geöffnet.
 * Schließt sich automatisch bei Klick oder Tastendruck.
 */
import * as Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT,
  DEPTH, COLORS, toCssColor,
} from '../config';

// ── Layout ────────────────────────────────────────────────────────────────────
const PANEL_W = 660;
const PANEL_H = 520;
const CX      = GAME_WIDTH  / 2;
const CY      = GAME_HEIGHT / 2;

const TITLE_Y     = CY - PANEL_H / 2 + 36;
const SEP_Y       = TITLE_Y + 24;
const LIST_START_Y = SEP_Y + 28;
const ROW_H       = 44;
const KEY_X       = CX - PANEL_W / 2 + 48;
const DESC_X      = CX - PANEL_W / 2 + 230;
const FOOTER_Y    = CY + PANEL_H / 2 - 28;

// ── Farben ────────────────────────────────────────────────────────────────────
const DIM_COLOR   = COLORS.GREY_10;
const DIM_ALPHA   = 0.75;
const PANEL_BG    = COLORS.GREY_7;
const PANEL_ALPHA = 0.95;
const ACCENT      = COLORS.GOLD_1;

const KEY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontSize:   '18px',
  fontFamily: 'monospace',
  fontStyle:  'bold',
  color:      toCssColor(ACCENT),
};

const DESC_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontSize:   '16px',
  fontFamily: 'monospace',
  color:      toCssColor(COLORS.GREY_2),
};

const CONTROLS: [string, string][] = [
  ['W A S D',        'Bewegen'],
  ['LEERTASTE',      'Dash'],
  ['LINKE MAUST.',     'Weapon 1  (Treffer → Adrenalin)'],
  ['RECHTE MAUST.',    'Weapon 2  (kostet Adrenalin)'],
  ['E  (halten)',    'Utility'],
  ['Q',              'Ultimate  (füllt sich durch Schaden)'],
  ['SHIFT',          'Einbuddeln  (kostet Adrenalin)'],
];

export class HelpOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private dimRect:   Phaser.GameObjects.Rectangle | null = null;
  private visible = false;

  private dismissDelay: Phaser.Time.TimerEvent | null = null;
  private keyHandler:   ((e: KeyboardEvent) => void) | null = null;

  constructor(private scene: Phaser.Scene) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  build(): void {
    if (this.container) {
      this.container.destroy(true);
      this.container = null;
    }

    const objects: Phaser.GameObjects.GameObject[] = [];

    // ── Dunkler Fullscreen-Layer ──────────────────────────────────────────
    this.dimRect = this.scene.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, DIM_COLOR, DIM_ALPHA)
      .setScrollFactor(0);
    objects.push(this.dimRect);

    // ── Panel ─────────────────────────────────────────────────────────────
    const panel = this.scene.add.rectangle(CX, CY, PANEL_W, PANEL_H, PANEL_BG, PANEL_ALPHA)
      .setStrokeStyle(2, ACCENT)
      .setScrollFactor(0);
    objects.push(panel);

    // ── Titel ─────────────────────────────────────────────────────────────
    objects.push(
      this.scene.add.text(CX, TITLE_Y, 'STEUERUNG', {
        fontSize: '28px', fontFamily: 'monospace', fontStyle: 'bold',
        color: toCssColor(ACCENT),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    // ── Trennlinie ────────────────────────────────────────────────────────
    objects.push(
      this.scene.add.rectangle(CX, SEP_Y, PANEL_W - 60, 2, ACCENT)
        .setScrollFactor(0),
    );

    // ── Steuerungs-Einträge ───────────────────────────────────────────────
    CONTROLS.forEach(([key, desc], i) => {
      const y = LIST_START_Y + i * ROW_H;

      // Dezente Zeilen-Hintergrund-Alternierung
      if (i % 2 === 0) {
        objects.push(
          this.scene.add.rectangle(CX, y, PANEL_W - 48, ROW_H - 4, COLORS.GREY_8, 0.35)
            .setScrollFactor(0),
        );
      }

      objects.push(
        this.scene.add.text(KEY_X, y, key, KEY_STYLE)
          .setOrigin(0, 0.5).setScrollFactor(0),
      );
      objects.push(
        this.scene.add.text(DESC_X, y, desc, DESC_STYLE)
          .setOrigin(0, 0.5).setScrollFactor(0),
      );
    });

    // ── Footer-Hinweis ────────────────────────────────────────────────────
    objects.push(
      this.scene.add.text(CX, FOOTER_Y, '[ Klick oder Taste zum Schließen ]', {
        fontSize: '13px', fontFamily: 'monospace',
        color: toCssColor(COLORS.GREY_4),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    // ── Container ─────────────────────────────────────────────────────────
    this.container = this.scene.add.container(0, 0, objects)
      .setDepth(DEPTH.OVERLAY + 1);
    this.container.setVisible(false);
  }

  show(): void {
    if (this.visible || !this.container) return;
    this.visible = true;

    // Sofort sichtbar mit Eingangsanimation
    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 150,
      ease: 'Sine.easeOut',
    });

    // Dismiss-Listener verzögert registrieren, damit der öffnende Klick
    // das Overlay nicht sofort wieder schließt.
    this.dismissDelay = this.scene.time.delayedCall(120, () => {
      this.dismissDelay = null;
      if (!this.visible) return;

      // Klick irgendwo → schließen
      this.dimRect?.setInteractive().once('pointerdown', () => this.hide());

      // Beliebige Taste → schließen
      this.keyHandler = () => this.hide();
      this.scene.input.keyboard?.on('keydown', this.keyHandler);
    });
  }

  hide(): void {
    if (!this.visible || !this.container) return;
    this.visible = false;

    // Aufräumen
    this.dismissDelay?.destroy();
    this.dismissDelay = null;
    this.dimRect?.disableInteractive().removeAllListeners();
    if (this.keyHandler) {
      this.scene.input.keyboard?.off('keydown', this.keyHandler);
      this.keyHandler = null;
    }

    // Ausgangsanimation
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 100,
      ease: 'Sine.easeIn',
      onComplete: () => { this.container?.setVisible(false); },
    });
  }

  isOpen(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.dismissDelay?.destroy();
    if (this.keyHandler) {
      this.scene.input.keyboard?.off('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
  }
}
