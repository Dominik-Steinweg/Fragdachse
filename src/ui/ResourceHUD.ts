import Phaser from 'phaser';
import { ADRENALINE_MAX, RAGE_MAX, COLORS } from '../config';

// ── Layout-Konstanten (linker Sidebar, x=0..240) ─────────────────────────────
const BAR_X       = 20;    // Linke Kante der Balken
const BAR_W       = 200;   // Breite der Balken
const BAR_H       = 18;    // Höhe der Balken
const BAR_ADR_Y   = 460;   // Adrenalin-Leiste
const BAR_RAGE_Y  = 490;   // Wut-Leiste
const BAR_DASH_Y  = 520;   // Dash-Cooldown-Leiste
const LABEL_FONT  = { fontSize: '12px', color: '#cccccc', fontFamily: 'monospace' };

// Farben
const COLOR_ADR_BG   = COLORS.GREY_8;
const COLOR_ADR_FG   = COLORS.BLUE_4;  // blau
const COLOR_RAGE_BG  = COLORS.GREY_8;
const COLOR_RAGE_FG  = COLORS.RED_2;  // rot
const COLOR_DASH_BG  = COLORS.GREY_8;
const COLOR_DASH_RDY = COLORS.GREEN_4;  // grün = bereit
const COLOR_DASH_CD  = COLORS.GREEN_3;  // grau = Cooldown

/**
 * Client-seitiges HUD für Adrenalin, Wut und Dash-Cooldown.
 * Zeichnet drei gestapelte Leisten im linken Sidebar-Bereich.
 * Die GameObjects werden in den übergebenen Container eingefügt.
 */
export class ResourceHUD {
  // Hintergründe (Gesamtbreite)
  private adrBg:  Phaser.GameObjects.Rectangle;
  private rageBg: Phaser.GameObjects.Rectangle;
  private dashBg: Phaser.GameObjects.Rectangle;

  // Vordergründe (dynamische Breite)
  private adrFg:  Phaser.GameObjects.Rectangle;
  private rageFg: Phaser.GameObjects.Rectangle;
  private dashFg: Phaser.GameObjects.Rectangle;

  // Labels
  private adrLabel:  Phaser.GameObjects.Text;
  private rageLabel: Phaser.GameObjects.Text;
  private dashLabel: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene, container: Phaser.GameObjects.Container) {
    // ── Adrenalin ──
    this.adrBg = scene.add.rectangle(BAR_X + BAR_W / 2, BAR_ADR_Y, BAR_W, BAR_H, COLOR_ADR_BG);
    this.adrFg = scene.add.rectangle(BAR_X, BAR_ADR_Y, BAR_W, BAR_H, COLOR_ADR_FG);
    this.adrFg.setOrigin(0, 0.5);
    this.adrLabel = scene.add.text(BAR_X, BAR_ADR_Y - 14, 'ADRENALIN', LABEL_FONT);

    // ── Wut ──
    this.rageBg = scene.add.rectangle(BAR_X + BAR_W / 2, BAR_RAGE_Y, BAR_W, BAR_H, COLOR_RAGE_BG);
    this.rageFg = scene.add.rectangle(BAR_X, BAR_RAGE_Y, BAR_W, BAR_H, COLOR_RAGE_FG);
    this.rageFg.setOrigin(0, 0.5);
    this.rageLabel = scene.add.text(BAR_X, BAR_RAGE_Y - 14, 'WUT', LABEL_FONT);

    // ── Dash-Cooldown ──
    this.dashBg = scene.add.rectangle(BAR_X + BAR_W / 2, BAR_DASH_Y, BAR_W, BAR_H, COLOR_DASH_BG);
    this.dashFg = scene.add.rectangle(BAR_X, BAR_DASH_Y, BAR_W, BAR_H, COLOR_DASH_RDY);
    this.dashFg.setOrigin(0, 0.5);
    this.dashLabel = scene.add.text(BAR_X, BAR_DASH_Y - 14, 'DASH [SPACE]', LABEL_FONT);

    // Alle Hintergrund-Rechtecke linksausgerichtet
    this.adrBg.setOrigin(0, 0.5);
    this.adrBg.setPosition(BAR_X, BAR_ADR_Y);
    this.rageBg.setOrigin(0, 0.5);
    this.rageBg.setPosition(BAR_X, BAR_RAGE_Y);
    this.dashBg.setOrigin(0, 0.5);
    this.dashBg.setPosition(BAR_X, BAR_DASH_Y);

    // Alle Objects in den Container einfügen (Depth wird am Container gesetzt)
    container.add([
      this.adrBg, this.adrFg, this.adrLabel,
      this.rageBg, this.rageFg, this.rageLabel,
      this.dashBg, this.dashFg, this.dashLabel,
    ]);
  }

  /**
   * Aktualisiert alle Balken.
   * @param adrenaline    Aktueller Adrenalin-Wert (0–ADRENALINE_MAX)
   * @param rage          Aktuelle Wut (0–RAGE_MAX)
   * @param dashCooldownFrac  0 = bereit, 1 = gerade benutzt (vom InputSystem)
   */
  update(adrenaline: number, rage: number, dashCooldownFrac: number): void {
    // Adrenalin-Balken
    const adrFrac = Math.max(0, Math.min(1, adrenaline / ADRENALINE_MAX));
    this.adrFg.width = BAR_W * adrFrac;

    // Wut-Balken
    const rageFrac = Math.max(0, Math.min(1, rage / RAGE_MAX));
    this.rageFg.width = BAR_W * rageFrac;

    // Dash-Cooldown-Balken
    // dashCooldownFrac: 0=bereit (volle grüne Leiste), 1=gerade benutzt (leere graue Leiste)
    const dashReadyFrac = 1 - dashCooldownFrac;
    this.dashFg.width = BAR_W * dashReadyFrac;
    const dashColor = dashCooldownFrac <= 0 ? COLOR_DASH_RDY : COLOR_DASH_CD;
    this.dashFg.setFillStyle(dashColor);
  }

  destroy(): void {
    this.adrBg.destroy();
    this.adrFg.destroy();
    this.adrLabel.destroy();
    this.rageBg.destroy();
    this.rageFg.destroy();
    this.rageLabel.destroy();
    this.dashBg.destroy();
    this.dashFg.destroy();
    this.dashLabel.destroy();
  }
}
