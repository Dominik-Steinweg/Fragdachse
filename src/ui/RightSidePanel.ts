/**
 * RightSidePanel – verwaltet den rechten Seitenbereich (x=1680..1920) für beide Spielphasen.
 *
 * Zwei Phaser-Container werden überlagert und via Y-Tween animiert:
 *  - lobbyContainer: Endstand der letzten Runde (Lobby-Phase), startet bei y=0
 *  - gameContainer:  Timer + Killfeed + Leaderboard (Arena-Phase), startet bei y=-GAME_HEIGHT
 *
 * Gleiche Public API wie LeftSidePanel: build(), transitionToGame(), transitionToLobby().
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, ARENA_OFFSET_X, DEPTH, toCssColor } from '../config';
import type { RoundResult } from '../network/NetworkBridge';

// ── Layout-Konstanten ─────────────────────────────────────────────────────────
const SIDEBAR_CENTER_X = GAME_WIDTH - ARENA_OFFSET_X / 2;  // 1800
const SIDEBAR_LEFT_X   = GAME_WIDTH - ARENA_OFFSET_X + 8;  // 1688
const SIDEBAR_RIGHT_X  = GAME_WIDTH - 8;                   // 1912
const PANEL_WIDTH      = 200;

// Timer
const TIMER_Y             = 28;
const TIMER_BG_H          = 44;
const TIMER_COLOR_NORMAL  = '#e0e0e0';
const TIMER_COLOR_WARNING = '#ff4444';

// Zug-Widget (zwischen Timer und Killfeed)
const TRAIN_WIDGET_SEP_Y  = 56;   // Trennlinie unter Timer
const TRAIN_WIDGET_TEXT_Y = 72;   // Ankunfts-/Status-Text
const TRAIN_BAR_Y         = 90;   // HP-Balken Mittellinie
const TRAIN_BAR_H         = 12;   // Balkenhöhe
const TRAIN_WIDGET_BOT_Y  = 104;  // Unterkante des Widgets

// Killfeed: Namen links/rechts, Waffe zentriert
const KILLFEED_MAX     = 5;
const KILLFEED_TOP_Y   = 116;   // Y des ersten (neuesten) Eintrags (nach Train-Widget verschoben)
const KILLFEED_ENTRY_H = 22;
const KILLFEED_FONT    = '13px';
const KILLFEED_NAME_MAXLEN = 8; // Zeichen – wird mit … abgeschnitten

// Leaderboard (Arena)
const LB_SEP_Y      = KILLFEED_TOP_Y + KILLFEED_MAX * KILLFEED_ENTRY_H + 10; // 186
const LB_HEADER_Y   = LB_SEP_Y + 14;    // 200
const LB_START_Y    = LB_HEADER_Y + 26; // 226
const LB_ENTRY_H    = 22;
const LB_FONT       = '14px';
const LB_HEADER_FONT = '13px';

// Lobby-Endstand
const RESULTS_HEADER_Y   = 28;
const RESULTS_SEP_Y      = 50;
const RESULTS_START_Y    = 68;
const RESULTS_ENTRY_H    = 24;
const RESULTS_FONT       = '14px';
const RESULTS_HEADER_FONT = '13px';

const COLOR_DIM       = '#607080';
const COLOR_HEADER    = '#8fa8b8';
const COLOR_SEPARATOR = 0x334455;

export class RightSidePanel {
  private lobbyContainer!: Phaser.GameObjects.Container;
  private gameContainer!:  Phaser.GameObjects.Container;
  private timerText!:      Phaser.GameObjects.Text;
  private pendingDelay:    Phaser.Time.TimerEvent | null = null;

  // ── Killfeed ──────────────────────────────────────────────────────────────
  private killFeedData: {
    killerName: string; killerColor: number;
    weapon:     string;
    victimName: string; victimColor: number;
  }[] = [];

  /** 3 Text-Objekte pro Zeile: killer (links), weapon (mitte), victim (rechts) */
  private killFeedRows: {
    killer: Phaser.GameObjects.Text;
    weapon: Phaser.GameObjects.Text;
    victim: Phaser.GameObjects.Text;
  }[] = [];

  // ── Leaderboard (Arena) ───────────────────────────────────────────────────
  private lbRows: {
    name:  Phaser.GameObjects.Text;
    frags: Phaser.GameObjects.Text;
  }[] = [];

  // ── Zug-Widget ────────────────────────────────────────────────────────────
  private trainText!:      Phaser.GameObjects.Text;
  private trainBarBg!:     Phaser.GameObjects.Rectangle;
  private trainBarFill!:   Phaser.GameObjects.Rectangle;
  private trainWidgetVisible = false;

  // ── Ergebnisse (Lobby) ────────────────────────────────────────────────────
  private resultsHeader!: Phaser.GameObjects.Text;
  private resultsSep!:    Phaser.GameObjects.Rectangle;
  private resultsRows: {
    name:  Phaser.GameObjects.Text;
    frags: Phaser.GameObjects.Text;
  }[] = [];

  constructor(private scene: Phaser.Scene) {}

  // ── Einmalig aufzurufen ───────────────────────────────────────────────────

  build(): void {
    this.buildGameContainer();
    this.buildLobbyContainer();
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  transitionToGame(): void {
    this.scene.tweens.killTweensOf(this.lobbyContainer);
    this.scene.tweens.killTweensOf(this.gameContainer);
    this.pendingDelay?.remove();

    this.scene.tweens.add({
      targets:  this.lobbyContainer,
      y:        GAME_HEIGHT,
      duration: 350,
      ease:     'Power2.easeIn',
    });

    this.pendingDelay = this.scene.time.delayedCall(100, () => {
      this.scene.tweens.add({
        targets:  this.gameContainer,
        y:        0,
        duration: 500,
        ease:     'Back.easeOut',
      });
      this.pendingDelay = null;
    });
  }

  transitionToLobby(): void {
    this.scene.tweens.killTweensOf(this.lobbyContainer);
    this.scene.tweens.killTweensOf(this.gameContainer);
    this.pendingDelay?.remove();

    this.scene.tweens.add({
      targets:  this.gameContainer,
      y:        -GAME_HEIGHT,
      duration: 350,
      ease:     'Power2.easeIn',
    });

    this.pendingDelay = this.scene.time.delayedCall(100, () => {
      this.scene.tweens.add({
        targets:    this.lobbyContainer,
        y:          0,
        duration:   500,
        ease:       'Back.easeOut',
        onComplete: () => { this.pendingDelay = null; },
      });
    });
  }

  // ── Daten-Updates ──────────────────────────────────────────────────────────

  /** Aktualisiert die Timer-Anzeige. secs = verbleibende Sekunden. */
  updateTimer(secs: number): void {
    const mm = Math.floor(secs / 60);
    const ss = secs % 60;
    this.timerText.setText(`${mm}:${ss.toString().padStart(2, '0')}`);
    this.timerText.setColor(secs <= 10 ? TIMER_COLOR_WARNING : TIMER_COLOR_NORMAL);
  }

  /**
   * Fügt einen Kill oben in den Killfeed ein.
   * Ältere Einträge rutschen nach unten; überschüssige fallen weg.
   */
  addKillFeedEntry(
    killerName: string, killerColor: number,
    weapon:     string,
    victimName: string, victimColor: number,
  ): void {
    this.killFeedData.unshift({ killerName, killerColor, weapon, victimName, victimColor });
    if (this.killFeedData.length > KILLFEED_MAX) this.killFeedData.length = KILLFEED_MAX;
    this.renderKillFeed();
  }

  /**
   * Aktualisiert das Arena-Leaderboard.
   * entries muss bereits absteigend nach Frags sortiert sein.
   */
  updateLeaderboard(entries: { name: string; colorHex: number; frags: number }[]): void {
    for (let i = 0; i < this.lbRows.length; i++) {
      const row   = this.lbRows[i];
      const entry = entries[i];
      if (entry) {
        row.name.setText(`${i + 1}. ${entry.name}`).setColor(toCssColor(entry.colorHex)).setVisible(true);
        row.frags.setText(String(entry.frags)).setVisible(true);
      } else {
        row.name.setVisible(false);
        row.frags.setVisible(false);
      }
    }
  }

  /**
   * Zeigt den Endstand der letzten Runde im Lobby-Panel.
   * null oder alle Frags = 0 → Bereich bleibt leer.
   */
  showRoundResults(results: RoundResult[] | null): void {
    const sorted  = results ? [...results].sort((a, b) => b.frags - a.frags) : null;
    const hasData = !!sorted && sorted.some(r => r.frags > 0);

    this.resultsHeader.setVisible(hasData);
    this.resultsSep.setVisible(hasData);

    for (let i = 0; i < this.resultsRows.length; i++) {
      const row   = this.resultsRows[i];
      const entry = hasData ? sorted![i] : undefined;
      if (entry) {
        row.name.setText(`${i + 1}. ${entry.name}`).setColor(toCssColor(entry.colorHex)).setVisible(true);
        row.frags.setText(String(entry.frags)).setVisible(true);
      } else {
        row.name.setVisible(false);
        row.frags.setVisible(false);
      }
    }
  }

  // ── Zug-Widget-Updates ────────────────────────────────────────────────────

  /**
   * Zeigt feste Ankunftszeit des Zugs (vor Spawn).
   * arrivalTimerSecs = der Rundenzeit-Wert (Sekunden), bei dem der Zug einfährt.
   * Wird einmal gesetzt und bleibt statisch – kein Countdown.
   */
  setTrainArrival(arrivalTimerSecs: number): void {
    const mm = Math.floor(arrivalTimerSecs / 60);
    const ss = arrivalTimerSecs % 60;
    const timeStr = `${mm}:${ss.toString().padStart(2, '0')}`;
    this.trainText.setText(`RB 54 um ${timeStr}`).setVisible(true);
    this.trainBarBg.setVisible(false);
    this.trainBarFill.setVisible(false);
    this.trainWidgetVisible = true;
  }

  /** Aktualisiert den HP-Balken des Zugs während er aktiv ist. */
  updateTrainHP(hp: number, maxHp: number): void {
    const ratio = Math.max(0, hp / maxHp);
    const barMaxW = PANEL_WIDTH - 16;
    this.trainText.setText('RB 54').setVisible(true);
    this.trainBarBg.setVisible(true);
    this.trainBarFill.setSize(barMaxW * ratio, TRAIN_BAR_H).setVisible(true);
    this.trainWidgetVisible = true;
  }

  /** Zeigt "Zug fällt aus"-Meldung nach Zerstörung. */
  showTrainDestroyed(): void {
    this.trainText.setText('RB 54 fällt\nheute leider aus').setVisible(true);
    this.trainBarBg.setVisible(false);
    this.trainBarFill.setVisible(false);
    this.trainWidgetVisible = true;
  }

  /** Blendet das Zug-Widget vollständig aus (z.B. nach Match-Ende). */
  hideTrainWidget(): void {
    this.trainText.setVisible(false);
    this.trainBarBg.setVisible(false);
    this.trainBarFill.setVisible(false);
    this.trainWidgetVisible = false;
  }

  destroy(): void {
    this.lobbyContainer.destroy(true);
    this.gameContainer.destroy(true);
  }

  // ── Interne Build-Helfer ──────────────────────────────────────────────────

  private buildGameContainer(): void {
    this.gameContainer = this.scene.add.container(0, -GAME_HEIGHT);
    this.gameContainer.setDepth(DEPTH.OVERLAY - 1);

    // ── Timer ─────────────────────────────────────────────────────────────────
    const timerBg = this.scene.add.rectangle(
      SIDEBAR_CENTER_X, TIMER_Y, PANEL_WIDTH, TIMER_BG_H, 0x000000, 0.2,
    ).setScrollFactor(0);

    this.timerText = this.scene.add.text(SIDEBAR_CENTER_X, TIMER_Y, '2:00', {
      fontSize:   '32px',
      fontFamily: 'monospace',
      color:      TIMER_COLOR_NORMAL,
      fontStyle:  'bold',
    }).setOrigin(0.5).setScrollFactor(0);

    this.gameContainer.add([timerBg, this.timerText]);

    // ── Zug-Widget ────────────────────────────────────────────────────────────
    this.gameContainer.add(
      this.scene.add.rectangle(SIDEBAR_CENTER_X, TRAIN_WIDGET_SEP_Y, PANEL_WIDTH, 1, COLOR_SEPARATOR, 0.7)
        .setScrollFactor(0),
    );

    this.trainText = this.scene.add.text(SIDEBAR_CENTER_X, TRAIN_WIDGET_TEXT_Y, '', {
      fontSize:   '11px',
      fontFamily: 'monospace',
      color:      '#c0a060',
      align:      'center',
      wordWrap:   { width: PANEL_WIDTH - 8 },
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setVisible(false);

    // HP-Balken Hintergrund
    this.trainBarBg = this.scene.add.rectangle(
      SIDEBAR_CENTER_X, TRAIN_BAR_Y, PANEL_WIDTH - 16, TRAIN_BAR_H, 0x331a00,
    ).setScrollFactor(0).setVisible(false) as Phaser.GameObjects.Rectangle;

    // HP-Balken Füllung (Breite wird dynamisch angepasst)
    // Origin (0, 0.5) → X muss die linke Kante des Hintergrund-Balkens sein:
    //   SIDEBAR_CENTER_X - (PANEL_WIDTH - 16) / 2
    const barLeftX = SIDEBAR_CENTER_X - (PANEL_WIDTH - 16) / 2;
    this.trainBarFill = this.scene.add.rectangle(
      barLeftX, TRAIN_BAR_Y, PANEL_WIDTH - 16, TRAIN_BAR_H, 0xcf573c,
    ).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false) as Phaser.GameObjects.Rectangle;

    this.gameContainer.add([this.trainText, this.trainBarBg, this.trainBarFill]);

    // ── Trennlinie vor Killfeed ───────────────────────────────────────────────
    this.gameContainer.add(
      this.scene.add.rectangle(SIDEBAR_CENTER_X, KILLFEED_TOP_Y - 10, PANEL_WIDTH, 1, COLOR_SEPARATOR, 0.7)
        .setScrollFactor(0),
    );

    // ── Killfeed-Einträge ─────────────────────────────────────────────────────
    // Layout: [KillerName (links)] [→ weapon → (mitte)] [VictimName (rechts)]
    // Killer und Victim nutzen die vollen Seitenbreiten; Waffe ist dazwischen.
    for (let i = 0; i < KILLFEED_MAX; i++) {
      const y = KILLFEED_TOP_Y + i * KILLFEED_ENTRY_H;

      // Spielername links-bündig
      const killer = this.scene.add.text(SIDEBAR_LEFT_X, y, '', {
        fontSize:   KILLFEED_FONT,
        fontFamily: 'monospace',
        color:      '#ffffff',
      }).setOrigin(0, 0.5).setScrollFactor(0);

      // Waffe mittig (zwischen den Spielernamen)
      const weapon = this.scene.add.text(SIDEBAR_CENTER_X, y, '', {
        fontSize:   KILLFEED_FONT,
        fontFamily: 'monospace',
        color:      COLOR_DIM,
      }).setOrigin(0.5, 0.5).setScrollFactor(0);

      // Spielername rechts-bündig
      const victim = this.scene.add.text(SIDEBAR_RIGHT_X, y, '', {
        fontSize:   KILLFEED_FONT,
        fontFamily: 'monospace',
        color:      '#ffffff',
      }).setOrigin(1, 0.5).setScrollFactor(0);

      this.gameContainer.add([killer, weapon, victim]);
      this.killFeedRows.push({ killer, weapon, victim });
    }

    // ── Trennlinie vor Leaderboard ────────────────────────────────────────────
    this.gameContainer.add(
      this.scene.add.rectangle(SIDEBAR_CENTER_X, LB_SEP_Y, PANEL_WIDTH, 1, COLOR_SEPARATOR, 0.7)
        .setScrollFactor(0),
    );

    // ── Leaderboard-Header ────────────────────────────────────────────────────
    this.gameContainer.add(
      this.scene.add.text(SIDEBAR_CENTER_X, LB_HEADER_Y, 'F R A G S', {
        fontSize:   LB_HEADER_FONT,
        fontFamily: 'monospace',
        color:      COLOR_HEADER,
        fontStyle:  'bold',
      }).setOrigin(0.5, 0.5).setScrollFactor(0),
    );

    // ── Leaderboard-Einträge (Max. 12 Spieler) ────────────────────────────────
    for (let i = 0; i < 12; i++) {
      const y = LB_START_Y + i * LB_ENTRY_H;

      const nameText = this.scene.add.text(SIDEBAR_LEFT_X, y, '', {
        fontSize:   LB_FONT,
        fontFamily: 'monospace',
        color:      '#ffffff',
      }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);

      const fragsText = this.scene.add.text(SIDEBAR_RIGHT_X, y, '', {
        fontSize:   LB_FONT,
        fontFamily: 'monospace',
        color:      COLOR_DIM,
      }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);

      this.gameContainer.add([nameText, fragsText]);
      this.lbRows.push({ name: nameText, frags: fragsText });
    }
  }

  private buildLobbyContainer(): void {
    this.lobbyContainer = this.scene.add.container(0, 0);
    this.lobbyContainer.setDepth(DEPTH.OVERLAY - 1);

    // ── Endstand-Header ───────────────────────────────────────────────────────
    this.resultsHeader = this.scene.add.text(SIDEBAR_CENTER_X, RESULTS_HEADER_Y, 'LETZTE RUNDE', {
      fontSize:   RESULTS_HEADER_FONT,
      fontFamily: 'monospace',
      color:      COLOR_HEADER,
      fontStyle:  'bold',
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setVisible(false);

    this.resultsSep = this.scene.add.rectangle(
      SIDEBAR_CENTER_X, RESULTS_SEP_Y, PANEL_WIDTH, 1, COLOR_SEPARATOR, 0.8,
    ).setScrollFactor(0).setVisible(false) as Phaser.GameObjects.Rectangle;

    this.lobbyContainer.add([this.resultsHeader, this.resultsSep]);

    // ── Endstand-Einträge (Max. 12 Spieler) ──────────────────────────────────
    for (let i = 0; i < 12; i++) {
      const y = RESULTS_START_Y + i * RESULTS_ENTRY_H;

      const nameText = this.scene.add.text(SIDEBAR_LEFT_X, y, '', {
        fontSize:   RESULTS_FONT,
        fontFamily: 'monospace',
        color:      '#ffffff',
      }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);

      const fragsText = this.scene.add.text(SIDEBAR_RIGHT_X, y, '', {
        fontSize:   RESULTS_FONT,
        fontFamily: 'monospace',
        color:      COLOR_DIM,
      }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);

      this.lobbyContainer.add([nameText, fragsText]);
      this.resultsRows.push({ name: nameText, frags: fragsText });
    }
  }

  // ── Killfeed-Render ───────────────────────────────────────────────────────

  private renderKillFeed(): void {
    for (let i = 0; i < KILLFEED_MAX; i++) {
      const row   = this.killFeedRows[i];
      const entry = this.killFeedData[i];

      if (entry) {
        // Neuere Einträge sind opaker als ältere
        const alpha = 1 - i * 0.14;

        row.killer
          .setText(this.truncate(entry.killerName, KILLFEED_NAME_MAXLEN))
          .setColor(toCssColor(entry.killerColor))
          .setAlpha(alpha);

        row.weapon
          .setText(`→ ${this.truncate(entry.weapon, 10)} →`)
          .setAlpha(alpha * 0.55);

        row.victim
          .setText(this.truncate(entry.victimName, KILLFEED_NAME_MAXLEN))
          .setColor(toCssColor(entry.victimColor))
          .setAlpha(alpha);
      } else {
        row.killer.setText('');
        row.weapon.setText('');
        row.victim.setText('');
      }
    }
  }

  /** Kürzt einen String auf maxLen Zeichen (hängt … an wenn nötig). */
  private truncate(s: string, maxLen: number): string {
    return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
  }
}
