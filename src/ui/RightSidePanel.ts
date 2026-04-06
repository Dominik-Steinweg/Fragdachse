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
import { GAME_WIDTH, GAME_HEIGHT, ARENA_OFFSET_X, DEPTH, COLORS, toCssColor } from '../config';
import type { TeamId } from '../types';
import type { RoundResult } from '../network/NetworkBridge';

// ── Layout-Konstanten ─────────────────────────────────────────────────────────
const SIDEBAR_CENTER_X = GAME_WIDTH - ARENA_OFFSET_X / 2;  // 1800
const SIDEBAR_LEFT_X   = GAME_WIDTH - ARENA_OFFSET_X + 8;  // 1688
const SIDEBAR_RIGHT_X  = GAME_WIDTH - 8;                   // 1912
const PANEL_WIDTH      = 200;

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
const LB_FONT        = '14px';
const LB_HEADER_FONT = '13px';
const LB_FRAGS_X     = SIDEBAR_LEFT_X + 152; // 1840 – Frags rechts-bündig
const LB_PING_X      = SIDEBAR_RIGHT_X;       // 1912 – Ping rechts-bündig

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

function pingColor(ms: number): string {
  if (ms <= 50)  return toCssColor(COLORS.GREEN_2);
  if (ms <= 100) return toCssColor(COLORS.GOLD_1);
  if (ms <= 200) return toCssColor(COLORS.RED_1);
  return toCssColor(COLORS.RED_3);
}

interface KillFeedEntryView {
  killerText: string;
  killerColor: string;
  killerAlpha: number;
  weaponText: string;
  weaponAlpha: number;
  victimText: string;
  victimColor: string;
  victimAlpha: number;
}

interface LeaderboardEntryView {
  visible: boolean;
  nameText: string;
  nameColor: string;
  fragsText: string;
  pingText: string;
  pingColor: string;
}

interface LeaderboardEntry {
  name: string;
  colorHex: number;
  frags: number;
  ping: number;
  teamId: TeamId | null;
  teamScore?: number;
}

interface TeamHeaderRow {
  label: Phaser.GameObjects.Text;
  score: Phaser.GameObjects.Text;
}

export class RightSidePanel {
  private lobbyContainer!: Phaser.GameObjects.Container;
  private gameContainer!:  Phaser.GameObjects.Container;
  private arenaOverlayVisible = false;
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
  }[] = [];  private lbPingRows: Phaser.GameObjects.Text[] = [];
  private lbTeamHeaders: Record<TeamId, TeamHeaderRow> | null = null;
  private leaderboardCache: (LeaderboardEntryView | null)[] = Array.from({ length: 12 }, () => null);
  private killFeedCache: (KillFeedEntryView | null)[] = Array.from({ length: KILLFEED_MAX }, () => null);
  private readonly cssColorCache = new Map<number, string>();

  // ── Ergebnisse (Lobby) ────────────────────────────────────────────────────
  private resultsHeader!: Phaser.GameObjects.Text;
  private resultsSep!:    Phaser.GameObjects.Rectangle;
  private resultsRows: {
    name:  Phaser.GameObjects.Text;
    frags: Phaser.GameObjects.Text;
  }[] = [];
  private resultsTeamHeaders: Record<TeamId, TeamHeaderRow> | null = null;

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
    this.arenaOverlayVisible = false;
    this.gameContainer.y = -GAME_HEIGHT;

    this.scene.tweens.add({
      targets:  this.lobbyContainer,
      y:        GAME_HEIGHT,
      duration: 350,
      ease:     'Power2.easeIn',
    });
    this.pendingDelay = null;
  }

  transitionToLobby(): void {
    this.scene.tweens.killTweensOf(this.lobbyContainer);
    this.scene.tweens.killTweensOf(this.gameContainer);
    this.pendingDelay?.remove();
    this.arenaOverlayVisible = false;

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

  setArenaOverlayVisible(visible: boolean, immediate = false): void {
    const targetY = visible ? 0 : -GAME_HEIGHT;
    if (!immediate && this.arenaOverlayVisible === visible) {
      return;
    }

    this.scene.tweens.killTweensOf(this.gameContainer);
    this.arenaOverlayVisible = visible;

    if (immediate) {
      this.gameContainer.y = targetY;
      return;
    }

    this.scene.tweens.add({
      targets: this.gameContainer,
      y: targetY,
      duration: visible ? 220 : 180,
      ease: visible ? 'Back.easeOut' : 'Power2.easeIn',
    });
  }

  isArenaOverlayVisible(): boolean {
    return this.arenaOverlayVisible;
  }

  // ── Daten-Updates ──────────────────────────────────────────────────────────

  /** @deprecated Timer wird jetzt vom CenterHUD verwaltet. */
  updateTimer(_secs: number): void { /* no-op */ }

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
  updateLeaderboard(entries: LeaderboardEntry[]): void {
    if (entries.some((entry) => entry.teamId === 'blue' || entry.teamId === 'red')) {
      this.renderGroupedLeaderboard(entries);
      return;
    }

    this.lbTeamHeaders?.blue.label.setVisible(false);
    this.lbTeamHeaders?.blue.score.setVisible(false);
    this.lbTeamHeaders?.red.label.setVisible(false);
    this.lbTeamHeaders?.red.score.setVisible(false);
    for (let i = 0; i < this.lbRows.length; i++) {
      const row      = this.lbRows[i];
      const pingText = this.lbPingRows[i];
      const entry    = entries[i];
      if (entry) {
        const nextView: LeaderboardEntryView = {
          visible: true,
          nameText: `${i + 1}. ${entry.name}`,
          nameColor: this.toCachedCssColor(entry.colorHex),
          fragsText: String(entry.frags),
          pingText: `${entry.ping}ms`,
          pingColor: pingColor(entry.ping),
        };
        const prevView = this.leaderboardCache[i];
        if (!prevView || !prevView.visible) {
          row.name.setVisible(true);
          row.frags.setVisible(true);
          pingText.setVisible(true);
        }
        if (!prevView || prevView.nameText !== nextView.nameText) row.name.setText(nextView.nameText);
        if (!prevView || prevView.nameColor !== nextView.nameColor) row.name.setColor(nextView.nameColor);
        if (!prevView || prevView.fragsText !== nextView.fragsText) row.frags.setText(nextView.fragsText);
        if (!prevView || prevView.pingText !== nextView.pingText) pingText.setText(nextView.pingText);
        if (!prevView || prevView.pingColor !== nextView.pingColor) pingText.setColor(nextView.pingColor);
        this.leaderboardCache[i] = nextView;
      } else {
        const prevView = this.leaderboardCache[i];
        if (prevView?.visible !== false) {
          row.name.setVisible(false);
          row.frags.setVisible(false);
          pingText.setVisible(false);
        }
        this.leaderboardCache[i] = { visible: false, nameText: '', nameColor: '', fragsText: '', pingText: '', pingColor: '' };
      }
    }
  }

  /**
   * Zeigt den Endstand der letzten Runde im Lobby-Panel.
   * null oder alle Frags = 0 → Bereich bleibt leer.
   */
  showRoundResults(results: RoundResult[] | null): void {
    if (results && results.some((result) => result.teamId === 'blue' || result.teamId === 'red')) {
      this.renderGroupedRoundResults(results);
      return;
    }

    const sorted  = results ? [...results].sort((a, b) => b.frags - a.frags) : null;
    const hasData = !!sorted && sorted.some(r => r.frags > 0);

    this.resultsTeamHeaders?.blue.label.setVisible(false);
    this.resultsTeamHeaders?.blue.score.setVisible(false);
    this.resultsTeamHeaders?.red.label.setVisible(false);
    this.resultsTeamHeaders?.red.score.setVisible(false);

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

  // ── Zug-Widget-Updates (no-op – jetzt im CenterHUD) ────────────────────────

  /** @deprecated Zug-Widget wird jetzt vom CenterHUD verwaltet. */
  setTrainArrival(_arrivalTimerSecs: number): void { /* no-op */ }
  /** @deprecated Zug-Widget wird jetzt vom CenterHUD verwaltet. */
  updateTrainHP(_hp: number, _maxHp: number): void { /* no-op */ }
  /** @deprecated Zug-Widget wird jetzt vom CenterHUD verwaltet. */
  showTrainDestroyed(): void { /* no-op */ }
  /** @deprecated Zug-Widget wird jetzt vom CenterHUD verwaltet. */
  hideTrainWidget(): void { /* no-op */ }

  destroy(): void {
    this.lobbyContainer.destroy(true);
    this.gameContainer.destroy(true);
  }

  // ── Interne Build-Helfer ──────────────────────────────────────────────────

  private buildGameContainer(): void {
    this.gameContainer = this.scene.add.container(0, -GAME_HEIGHT);
    this.gameContainer.setDepth(DEPTH.OVERLAY - 1);
    this.gameContainer.add(
      this.scene.add.rectangle(SIDEBAR_CENTER_X, GAME_HEIGHT / 2, ARENA_OFFSET_X, GAME_HEIGHT, 0x000000, 0.18)
        .setScrollFactor(0),
    );

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
      this.scene.add.text(LB_FRAGS_X, LB_HEADER_Y, 'F R A G S', {
        fontSize:   LB_HEADER_FONT,
        fontFamily: 'monospace',
        color:      COLOR_HEADER,
        fontStyle:  'bold',
      }).setOrigin(1, 0.5).setScrollFactor(0),
    );
    this.gameContainer.add(
      this.scene.add.text(LB_PING_X, LB_HEADER_Y, 'ms', {
        fontSize:   LB_HEADER_FONT,
        fontFamily: 'monospace',
        color:      COLOR_HEADER,
        fontStyle:  'bold',
      }).setOrigin(1, 0.5).setScrollFactor(0),
    );

    const blueLabel = this.scene.add.text(SIDEBAR_LEFT_X, LB_START_Y, 'TEAM BLAU', {
      fontSize: LB_HEADER_FONT,
      fontFamily: 'monospace',
      color: toCssColor(COLORS.BLUE_2),
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
    const blueScore = this.scene.add.text(LB_FRAGS_X, LB_START_Y, '', {
      fontSize: LB_HEADER_FONT,
      fontFamily: 'monospace',
      color: toCssColor(COLORS.BLUE_2),
      fontStyle: 'bold',
    }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);
    const redLabel = this.scene.add.text(SIDEBAR_LEFT_X, LB_START_Y, 'TEAM ROT', {
      fontSize: LB_HEADER_FONT,
      fontFamily: 'monospace',
      color: toCssColor(COLORS.RED_2),
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
    const redScore = this.scene.add.text(LB_FRAGS_X, LB_START_Y, '', {
      fontSize: LB_HEADER_FONT,
      fontFamily: 'monospace',
      color: toCssColor(COLORS.RED_2),
      fontStyle: 'bold',
    }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);
    this.lbTeamHeaders = {
      blue: { label: blueLabel, score: blueScore },
      red: { label: redLabel, score: redScore },
    };
    this.gameContainer.add([blueLabel, blueScore, redLabel, redScore]);

    // ── Leaderboard-Einträge (Max. 12 Spieler) ────────────────────────────────
    for (let i = 0; i < 12; i++) {
      const y = LB_START_Y + i * LB_ENTRY_H;

      const nameText = this.scene.add.text(SIDEBAR_LEFT_X, y, '', {
        fontSize:   LB_FONT,
        fontFamily: 'monospace',
        color:      '#ffffff',
      }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);

      const fragsText = this.scene.add.text(LB_FRAGS_X, y, '', {
        fontSize:   LB_FONT,
        fontFamily: 'monospace',
        color:      COLOR_DIM,
      }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);

      const pingText = this.scene.add.text(LB_PING_X, y, '', {
        fontSize:   '11px',
        fontFamily: 'monospace',
        color:      toCssColor(COLORS.GREEN_2),
      }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);

      this.gameContainer.add([nameText, fragsText, pingText]);
      this.lbRows.push({ name: nameText, frags: fragsText });
      this.lbPingRows.push(pingText);
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

    const blueLabel = this.scene.add.text(SIDEBAR_LEFT_X, RESULTS_START_Y, 'TEAM BLAU', {
      fontSize: RESULTS_HEADER_FONT,
      fontFamily: 'monospace',
      color: toCssColor(COLORS.BLUE_2),
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
    const blueScore = this.scene.add.text(SIDEBAR_RIGHT_X, RESULTS_START_Y, '', {
      fontSize: RESULTS_HEADER_FONT,
      fontFamily: 'monospace',
      color: toCssColor(COLORS.BLUE_2),
      fontStyle: 'bold',
    }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);
    const redLabel = this.scene.add.text(SIDEBAR_LEFT_X, RESULTS_START_Y, 'TEAM ROT', {
      fontSize: RESULTS_HEADER_FONT,
      fontFamily: 'monospace',
      color: toCssColor(COLORS.RED_2),
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
    const redScore = this.scene.add.text(SIDEBAR_RIGHT_X, RESULTS_START_Y, '', {
      fontSize: RESULTS_HEADER_FONT,
      fontFamily: 'monospace',
      color: toCssColor(COLORS.RED_2),
      fontStyle: 'bold',
    }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);
    this.resultsTeamHeaders = {
      blue: { label: blueLabel, score: blueScore },
      red: { label: redLabel, score: redScore },
    };
    this.lobbyContainer.add([blueLabel, blueScore, redLabel, redScore]);

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
        const nextView: KillFeedEntryView = {
          killerText: this.truncate(entry.killerName, KILLFEED_NAME_MAXLEN),
          killerColor: this.toCachedCssColor(entry.killerColor),
          killerAlpha: alpha,
          weaponText: `→ ${this.truncate(entry.weapon, 10)} →`,
          weaponAlpha: alpha * 0.55,
          victimText: this.truncate(entry.victimName, KILLFEED_NAME_MAXLEN),
          victimColor: this.toCachedCssColor(entry.victimColor),
          victimAlpha: alpha,
        };
        const prevView = this.killFeedCache[i];

        if (!prevView || prevView.killerText !== nextView.killerText) row.killer.setText(nextView.killerText);
        if (!prevView || prevView.killerColor !== nextView.killerColor) row.killer.setColor(nextView.killerColor);
        if (!prevView || prevView.killerAlpha !== nextView.killerAlpha) row.killer.setAlpha(nextView.killerAlpha);

        if (!prevView || prevView.weaponText !== nextView.weaponText) row.weapon.setText(nextView.weaponText);
        if (!prevView || prevView.weaponAlpha !== nextView.weaponAlpha) row.weapon.setAlpha(nextView.weaponAlpha);

        if (!prevView || prevView.victimText !== nextView.victimText) row.victim.setText(nextView.victimText);
        if (!prevView || prevView.victimColor !== nextView.victimColor) row.victim.setColor(nextView.victimColor);
        if (!prevView || prevView.victimAlpha !== nextView.victimAlpha) row.victim.setAlpha(nextView.victimAlpha);

        this.killFeedCache[i] = nextView;
      } else {
        const prevView = this.killFeedCache[i];
        if (!prevView || prevView.killerText !== '') row.killer.setText('');
        if (!prevView || prevView.weaponText !== '') row.weapon.setText('');
        if (!prevView || prevView.victimText !== '') row.victim.setText('');
        this.killFeedCache[i] = {
          killerText: '',
          killerColor: '',
          killerAlpha: row.killer.alpha,
          weaponText: '',
          weaponAlpha: row.weapon.alpha,
          victimText: '',
          victimColor: '',
          victimAlpha: row.victim.alpha,
        };
      }
    }
  }

  private toCachedCssColor(color: number): string {
    const cached = this.cssColorCache.get(color);
    if (cached) return cached;
    const cssColor = toCssColor(color);
    this.cssColorCache.set(color, cssColor);
    return cssColor;
  }

  /** Kürzt einen String auf maxLen Zeichen (hängt … an wenn nötig). */
  private truncate(s: string, maxLen: number): string {
    return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
  }

  private renderGroupedLeaderboard(entries: LeaderboardEntry[]): void {
    const blueEntries = entries.filter((entry) => entry.teamId === 'blue').sort((a, b) => b.frags - a.frags);
    const redEntries = entries.filter((entry) => entry.teamId === 'red').sort((a, b) => b.frags - a.frags);
    const blueScore = this.resolveGroupedTeamScore(blueEntries);
    const redScore = this.resolveGroupedTeamScore(redEntries);

    this.lbTeamHeaders?.blue.label.setVisible(true).setPosition(SIDEBAR_LEFT_X, LB_START_Y);
    this.lbTeamHeaders?.blue.score.setVisible(true).setText(String(blueScore)).setPosition(LB_FRAGS_X, LB_START_Y);

    let rowIndex = 0;
    rowIndex = this.renderGroupedLeaderboardTeamRows(blueEntries, rowIndex, LB_START_Y + 20);

    this.lbTeamHeaders?.red.label.setVisible(true).setPosition(SIDEBAR_LEFT_X, LB_START_Y + 20 + blueEntries.length * LB_ENTRY_H + 12);
    this.lbTeamHeaders?.red.score.setVisible(true).setText(String(redScore)).setPosition(LB_FRAGS_X, LB_START_Y + 20 + blueEntries.length * LB_ENTRY_H + 12);
    rowIndex = this.renderGroupedLeaderboardTeamRows(redEntries, rowIndex, LB_START_Y + 32 + blueEntries.length * LB_ENTRY_H + 12);

    for (let i = rowIndex; i < this.lbRows.length; i++) {
      this.lbRows[i].name.setVisible(false);
      this.lbRows[i].frags.setVisible(false);
      this.lbPingRows[i].setVisible(false);
      this.leaderboardCache[i] = { visible: false, nameText: '', nameColor: '', fragsText: '', pingText: '', pingColor: '' };
    }
  }

  private renderGroupedLeaderboardTeamRows(entries: LeaderboardEntry[], startRowIndex: number, startY: number): number {
    let rowIndex = startRowIndex;
    for (let i = 0; i < entries.length && rowIndex < this.lbRows.length; i++, rowIndex++) {
      const row = this.lbRows[rowIndex];
      const pingText = this.lbPingRows[rowIndex];
      const entry = entries[i];
      const y = startY + i * LB_ENTRY_H;
      row.name.setPosition(SIDEBAR_LEFT_X, y).setText(entry.name).setColor(this.toCachedCssColor(entry.colorHex)).setVisible(true);
      row.frags.setPosition(LB_FRAGS_X, y).setText(String(entry.frags)).setVisible(true);
      pingText.setPosition(LB_PING_X, y).setText(`${entry.ping}ms`).setColor(pingColor(entry.ping)).setVisible(true);
      this.leaderboardCache[rowIndex] = {
        visible: true,
        nameText: entry.name,
        nameColor: this.toCachedCssColor(entry.colorHex),
        fragsText: String(entry.frags),
        pingText: `${entry.ping}ms`,
        pingColor: pingColor(entry.ping),
      };
    }
    return rowIndex;
  }

  private renderGroupedRoundResults(results: RoundResult[]): void {
    const blueEntries = results.filter((result) => result.teamId === 'blue').sort((a, b) => b.frags - a.frags);
    const redEntries = results.filter((result) => result.teamId === 'red').sort((a, b) => b.frags - a.frags);
    const hasData = blueEntries.length > 0 || redEntries.length > 0;
    const blueScore = this.resolveGroupedTeamScore(blueEntries);
    const redScore = this.resolveGroupedTeamScore(redEntries);

    this.resultsHeader.setVisible(hasData);
    this.resultsSep.setVisible(hasData);
    this.resultsTeamHeaders?.blue.label.setVisible(hasData).setPosition(SIDEBAR_LEFT_X, RESULTS_START_Y);
    this.resultsTeamHeaders?.blue.score.setVisible(hasData).setText(String(blueScore)).setPosition(SIDEBAR_RIGHT_X, RESULTS_START_Y);
    this.resultsTeamHeaders?.red.label.setVisible(hasData).setPosition(SIDEBAR_LEFT_X, RESULTS_START_Y + 18 + blueEntries.length * RESULTS_ENTRY_H + 12);
    this.resultsTeamHeaders?.red.score.setVisible(hasData).setText(String(redScore)).setPosition(SIDEBAR_RIGHT_X, RESULTS_START_Y + 18 + blueEntries.length * RESULTS_ENTRY_H + 12);

    let rowIndex = 0;
    rowIndex = this.renderGroupedResultRows(blueEntries, rowIndex, RESULTS_START_Y + 18);
    rowIndex = this.renderGroupedResultRows(redEntries, rowIndex, RESULTS_START_Y + 30 + blueEntries.length * RESULTS_ENTRY_H + 12);
    for (let i = rowIndex; i < this.resultsRows.length; i++) {
      this.resultsRows[i].name.setVisible(false);
      this.resultsRows[i].frags.setVisible(false);
    }
  }

  private renderGroupedResultRows(entries: RoundResult[], startRowIndex: number, startY: number): number {
    let rowIndex = startRowIndex;
    for (let i = 0; i < entries.length && rowIndex < this.resultsRows.length; i++, rowIndex++) {
      const row = this.resultsRows[rowIndex];
      const entry = entries[i];
      const y = startY + i * RESULTS_ENTRY_H;
      row.name.setPosition(SIDEBAR_LEFT_X, y).setText(entry.name).setColor(this.toCachedCssColor(entry.colorHex)).setVisible(true);
      row.frags.setPosition(SIDEBAR_RIGHT_X, y).setText(String(entry.frags)).setVisible(true);
    }
    return rowIndex;
  }

  private resolveGroupedTeamScore(entries: Array<{ frags: number; teamScore?: number }>): number {
    const scoredEntry = entries.find((entry) => entry.teamScore !== undefined);
    if (scoredEntry?.teamScore !== undefined) return scoredEntry.teamScore;
    return entries.reduce((sum, entry) => sum + entry.frags, 0);
  }
}
