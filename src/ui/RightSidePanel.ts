/** Right-side arena leaderboard and kill feed. Lobby cards have their own presentation. */
import * as Phaser from 'phaser';
import {
  ARENA_OFFSET_X,
  COLORS,
  DEFAULT_ARENA_OFFSET_X,
  DEPTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  toCssColor,
} from '../config';
import { isCoopDefenseMode } from '../gameModes';
import { getLocale, t } from '../i18n';
import { getSourceName } from '../i18n/contentPresentation';
import { getLocalizedTeamLabel } from '../i18n/gameModePresentation';
import { bridge } from '../network/bridge';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import type { TeamId } from '../types';
import { COOP_DEFENSE_SECONDARY_OBJECTIVE_STACK_BOTTOM_Y } from './CoopDefenseSecondaryObjectiveLayout';
import { getPingColor, TEXT } from './uiTheme';

// ── Layout-Konstanten ─────────────────────────────────────────────────────────
const ARENA_SIDEBAR_WIDTH    = Math.round(ARENA_OFFSET_X * 1.5);
const ARENA_SIDEBAR_CENTER_X = GAME_WIDTH - ARENA_SIDEBAR_WIDTH / 2;
const ARENA_SIDEBAR_LEFT_X   = GAME_WIDTH - ARENA_SIDEBAR_WIDTH + 8;
const ARENA_SIDEBAR_RIGHT_X = GAME_WIDTH - 8;

/**
 * Linke Kante der Arena-Seitenspalte. Exportiert, damit weitere HUD-Elemente davor enden
 * können, statt die Seitenspalte horizontal zu überdecken.
 */
export const ARENA_SIDEBAR_CONTENT_LEFT_X = ARENA_SIDEBAR_LEFT_X;
const ARENA_PANEL_WIDTH      = Math.round((DEFAULT_ARENA_OFFSET_X - 40) * 1.5);

// Killfeed: Namen links/rechts, Waffe zentriert
const KILLFEED_MAX     = 5;
// Unterhalb des maximalen Nebenpanel-Stacks, mit einem kleinen visuellen Abstand.
const KILLFEED_TOP_Y   = COOP_DEFENSE_SECONDARY_OBJECTIVE_STACK_BOTTOM_Y + 18;
const KILLFEED_ENTRY_H = 28;
const KILLFEED_FONT    = '17px';
const KILLFEED_NAME_MAXLEN = 8; // Zeichen – wird mit … abgeschnitten

// Leaderboard (Arena)
const LB_SEP_Y      = KILLFEED_TOP_Y + KILLFEED_MAX * KILLFEED_ENTRY_H + 10;
const LB_HEADER_Y   = LB_SEP_Y + 18;
const LB_START_Y    = LB_HEADER_Y + 30;
const LB_ENTRY_H    = 28;
const LB_FONT        = '18px';
const LB_HEADER_FONT = '16px';
const LB_PING_FONT   = '14px';
const LB_TEAM_ROWS_OFFSET = 24;
const LB_TEAM_SECTION_GAP = 16;
const LB_FRAGS_X     = ARENA_SIDEBAR_RIGHT_X - 116;
const LB_XP_X        = ARENA_SIDEBAR_RIGHT_X - 58;
const LB_PING_X      = ARENA_SIDEBAR_RIGHT_X;

// Farbrollen statt eigener Blaugrau-Werte: die frueheren '#607080'/'#8fa8b8'/0x334455 lagen
// dicht neben der Grau-Rampe, ohne zu ihr zu gehoeren.
const COLOR_DIM       = toCssColor(TEXT.muted);
const COLOR_KILLFEED_WEAPON = toCssColor(COLORS.GOLD_1);
const COLOR_ARENA_FRAGS = toCssColor(COLORS.GREY_2);
const COLOR_HEADER    = toCssColor(COLORS.GREY_3);
const COLOR_SEPARATOR = COLORS.GREY_6;

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
  sharedXp?: number;
}

interface TeamHeaderRow {
  label: Phaser.GameObjects.Text;
  score: Phaser.GameObjects.Text;
}

export class RightSidePanel {
  private gameContainer!:  Phaser.GameObjects.Container;

  private arenaOverlayVisible = false;


  private killFeedData: {
    killerName: string; killerColor: number;
    sourceId:   string;
    victimName: string; victimColor: number;
  }[] = [];

  private killFeedRows: {
    killer: Phaser.GameObjects.Text;
    weapon: Phaser.GameObjects.Text;
    victim: Phaser.GameObjects.Text;
  }[] = [];

  private lbRows: {
    name:  Phaser.GameObjects.Text;
    frags: Phaser.GameObjects.Text;
  }[] = [];

  private lbPingRows: Phaser.GameObjects.Text[] = [];

  private lbTeamHeaders: Record<TeamId, TeamHeaderRow> | null = null;

  private leaderboardScoreLabel!: Phaser.GameObjects.Text;

  private leaderboardXpLabel!: Phaser.GameObjects.Text;

  private leaderboardSharedXpValue!: Phaser.GameObjects.Text;

  private leaderboardCache: (LeaderboardEntryView | null)[] = Array.from({ length: 12 }, () => null);

  private leaderboardInputCache: LeaderboardEntry[] = [];

  private leaderboardInputMode: string | null = null;

  private killFeedCache: (KillFeedEntryView | null)[] = Array.from({ length: KILLFEED_MAX }, () => null);

  private readonly cssColorCache = new Map<number, string>();

  constructor(private scene: Phaser.Scene) {}

  build(): void { this.buildGameContainer(); }

  refreshLocale(): void {
    this.leaderboardScoreLabel.setText(t('ui.score.frags'));
    this.leaderboardXpLabel.setText(t('ui.score.xp'));
    this.lbTeamHeaders?.blue.label.setText(t('ui.score.teamBlue'));
    this.lbTeamHeaders?.red.label.setText(t('ui.score.teamRed'));
    this.renderKillFeed();
    this.syncArenaLabels(this.leaderboardInputCache);
  }

  transitionToGame(): void {
    this.scene.tweens.killTweensOf(this.gameContainer);
    this.arenaOverlayVisible = false;
    this.gameContainer.setY(-GAME_HEIGHT).setVisible(false).setActive(false);
  }

  transitionToLobby(): void { this.setArenaOverlayVisible(false); }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.gameContainer);
    this.gameContainer.destroy(true);
  }

  setArenaOverlayVisible(visible: boolean, immediate = false): void {
    const targetY = visible ? 0 : -GAME_HEIGHT;
    if (!immediate && this.arenaOverlayVisible === visible) {
      return;
    }

    this.scene.tweens.killTweensOf(this.gameContainer);
    this.arenaOverlayVisible = visible;

    if (visible) {
      this.gameContainer.setVisible(true).setActive(true);
      this.renderKillFeed();
    }

    if (immediate) {
      this.gameContainer.y = targetY;
      this.gameContainer.setVisible(visible).setActive(visible);
      return;
    }

    this.scene.tweens.add({
      targets: this.gameContainer,
      y: targetY,
      duration: visible ? 220 : 180,
      ease: visible ? 'Back.easeOut' : 'Power2.easeIn',
      onComplete: () => {
        if (!visible && !this.arenaOverlayVisible) {
          this.gameContainer.setVisible(false).setActive(false);
        }
      },
    });
  }

  isArenaOverlayVisible(): boolean {
    return this.arenaOverlayVisible;
  }

  updateTimer(_secs: number): void { /* no-op */ }

  addKillFeedEntry(
    killerName: string, killerColor: number,
    sourceId:   string,
    victimName: string, victimColor: number,
  ): void {
    this.killFeedData.unshift({ killerName, killerColor, sourceId, victimName, victimColor });
    if (this.killFeedData.length > KILLFEED_MAX) this.killFeedData.length = KILLFEED_MAX;
    if (this.arenaOverlayVisible) this.renderKillFeed();
  }

  updateLeaderboard(entries: LeaderboardEntry[]): void {
    if (!this.arenaOverlayVisible) return;
    if (this.isLeaderboardInputUnchanged(entries)) return;
    this.syncArenaLabels(entries);
    if (entries.some((entry) => entry.teamId === 'blue' || entry.teamId === 'red')) {
      this.renderGroupedLeaderboard(entries);
      return;
    }

    const displayEntries = this.sortLeaderboardEntriesForDisplay(entries);
    this.lbTeamHeaders?.blue.label.setVisible(false);
    this.lbTeamHeaders?.blue.score.setVisible(false);
    this.lbTeamHeaders?.red.label.setVisible(false);
    this.lbTeamHeaders?.red.score.setVisible(false);
    for (let i = 0; i < this.lbRows.length; i++) {
      const row      = this.lbRows[i];
      const pingText = this.lbPingRows[i];
      const entry    = displayEntries[i];
      if (entry) {
        const nextView: LeaderboardEntryView = {
          visible: true,
          nameText: `${i + 1}. ${entry.name}`,
          nameColor: this.toCachedCssColor(entry.colorHex),
          fragsText: String(this.resolveLeaderboardEntryFrags(entry)),
          pingText: `${entry.ping}ms`,
          pingColor: getPingColor(entry.ping),
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

  setTrainArrival(_arrivalTimerSecs: number): void { /* no-op */ }

  updateTrainHP(_hp: number, _maxHp: number): void { /* no-op */ }

  showTrainDestroyed(): void { /* no-op */ }

  hideTrainWidget(): void { /* no-op */ }

  private buildGameContainer(): void {
    this.gameContainer = this.scene.add.container(0, -GAME_HEIGHT);
    this.gameContainer.setDepth(DEPTH.OVERLAY - 1).setVisible(false).setActive(false);
    promoteToClarityCamera(this.scene, this.gameContainer);
    this.gameContainer.add(
      this.scene.add.rectangle(ARENA_SIDEBAR_CENTER_X, GAME_HEIGHT / 2, ARENA_SIDEBAR_WIDTH, GAME_HEIGHT, 0x000000, 0.18)
        .setScrollFactor(0),
    );

    // ── Trennlinie vor Killfeed ───────────────────────────────────────────────
    this.gameContainer.add(
      this.scene.add.rectangle(ARENA_SIDEBAR_CENTER_X, KILLFEED_TOP_Y - 10, ARENA_PANEL_WIDTH, 1, COLOR_SEPARATOR, 0.7)
        .setScrollFactor(0),
    );

    // ── Killfeed-Einträge ─────────────────────────────────────────────────────
    // Layout: [KillerName (links)] [→ weapon → (mitte)] [VictimName (rechts)]
    // Killer und Victim nutzen die vollen Seitenbreiten; Waffe ist dazwischen.
    for (let i = 0; i < KILLFEED_MAX; i++) {
      const y = KILLFEED_TOP_Y + i * KILLFEED_ENTRY_H;

      // Spielername links-bündig
      const killer = this.scene.add.text(ARENA_SIDEBAR_LEFT_X, y, '', {
        fontSize:   KILLFEED_FONT,
        fontFamily: 'monospace',
        color:      '#ffffff',
      }).setOrigin(0, 0.5).setScrollFactor(0);

      // Waffe mittig (zwischen den Spielernamen)
      const weapon = this.scene.add.text(ARENA_SIDEBAR_CENTER_X, y, '', {
        fontSize:   KILLFEED_FONT,
        fontFamily: 'monospace',
        color:      COLOR_KILLFEED_WEAPON,
      }).setOrigin(0.5, 0.5).setScrollFactor(0);

      // Spielername rechts-bündig
      const victim = this.scene.add.text(ARENA_SIDEBAR_RIGHT_X, y, '', {
        fontSize:   KILLFEED_FONT,
        fontFamily: 'monospace',
        color:      '#ffffff',
      }).setOrigin(1, 0.5).setScrollFactor(0);

      this.gameContainer.add([killer, weapon, victim]);
      this.killFeedRows.push({ killer, weapon, victim });
    }

    // ── Trennlinie vor Leaderboard ────────────────────────────────────────────
    this.gameContainer.add(
      this.scene.add.rectangle(ARENA_SIDEBAR_CENTER_X, LB_SEP_Y, ARENA_PANEL_WIDTH, 1, COLOR_SEPARATOR, 0.7)
        .setScrollFactor(0),
    );

    // ── Leaderboard-Header ────────────────────────────────────────────────────
    this.leaderboardScoreLabel = this.scene.add.text(LB_FRAGS_X, LB_HEADER_Y, t('ui.score.frags'), {
      fontSize:   LB_HEADER_FONT,
      fontFamily: 'monospace',
      color:      COLOR_HEADER,
      fontStyle:  'bold',
    }).setOrigin(1, 0.5).setScrollFactor(0);
    this.gameContainer.add(this.leaderboardScoreLabel);
    this.leaderboardXpLabel = this.scene.add.text(LB_XP_X, LB_HEADER_Y, t('ui.score.xp'), {
      fontSize:   LB_HEADER_FONT,
      fontFamily: 'monospace',
      color:      COLOR_HEADER,
      fontStyle:  'bold',
    }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);
    this.gameContainer.add(this.leaderboardXpLabel);
    this.gameContainer.add(
      this.scene.add.text(LB_PING_X, LB_HEADER_Y, 'ms', {
        fontSize:   LB_HEADER_FONT,
        fontFamily: 'monospace',
        color:      COLOR_HEADER,
        fontStyle:  'bold',
      }).setOrigin(1, 0.5).setScrollFactor(0),
    );
    this.leaderboardSharedXpValue = this.scene.add.text(LB_XP_X, LB_START_Y, '', {
      fontSize: LB_HEADER_FONT,
      fontFamily: 'monospace',
      color: toCssColor(COLORS.GOLD_1),
      fontStyle: 'bold',
    }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);
    this.gameContainer.add(this.leaderboardSharedXpValue);

    const blueLabel = this.scene.add.text(ARENA_SIDEBAR_LEFT_X, LB_START_Y, t('ui.score.teamBlue'), {
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
    const redLabel = this.scene.add.text(ARENA_SIDEBAR_LEFT_X, LB_START_Y, t('ui.score.teamRed'), {
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

      const nameText = this.scene.add.text(ARENA_SIDEBAR_LEFT_X, y, '', {
        fontSize:   LB_FONT,
        fontFamily: 'monospace',
        color:      '#ffffff',
      }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);

      const fragsText = this.scene.add.text(LB_FRAGS_X, y, '', {
        fontSize:   LB_FONT,
        fontFamily: 'monospace',
        color:      COLOR_ARENA_FRAGS,
      }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);

      const pingText = this.scene.add.text(LB_PING_X, y, '', {
        fontSize:   LB_PING_FONT,
        fontFamily: 'monospace',
        color:      toCssColor(COLORS.GREEN_2),
      }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);

      this.gameContainer.add([nameText, fragsText, pingText]);
      this.lbRows.push({ name: nameText, frags: fragsText });
      this.lbPingRows.push(pingText);
    }
  }

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
          weaponText: `→ ${this.truncate(getSourceName(entry.sourceId, getLocale()), 10)} →`,
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

  private truncate(s: string, maxLen: number): string {
    return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
  }

  private renderGroupedLeaderboard(entries: LeaderboardEntry[]): void {
    const blueEntries = this.sortLeaderboardEntriesForDisplay(entries.filter((entry) => entry.teamId === 'blue'));
    const redEntries = this.sortLeaderboardEntriesForDisplay(entries.filter((entry) => entry.teamId === 'red'));
    const blueScore = this.resolveGroupedTeamScore(blueEntries);
    const redScore = this.resolveGroupedTeamScore(redEntries);
    const sharedXp = this.resolveSharedXp(entries);
    const blueRowsStartY = LB_START_Y + LB_TEAM_ROWS_OFFSET;
    const redHeaderY = blueRowsStartY + blueEntries.length * LB_ENTRY_H + LB_TEAM_SECTION_GAP;
    const redRowsStartY = redHeaderY + LB_TEAM_ROWS_OFFSET;
    const mode = bridge.getGameMode();
    const showBlueHeader = blueEntries.length > 0;
    const showRedHeader = redEntries.length > 0;

    this.lbTeamHeaders?.blue.label
      .setVisible(showBlueHeader)
      .setText(getLocalizedTeamLabel('blue', mode).toUpperCase())
      .setPosition(ARENA_SIDEBAR_LEFT_X, LB_START_Y);
    this.lbTeamHeaders?.blue.score.setVisible(showBlueHeader).setText(String(blueScore)).setPosition(LB_FRAGS_X, LB_START_Y);
    this.leaderboardSharedXpValue
      .setVisible(this.isDefenseXpMode() && this.hasSharedXpData(entries) && (showBlueHeader || showRedHeader))
      .setText(String(sharedXp))
      .setPosition(LB_XP_X, LB_START_Y);

    let rowIndex = 0;
    rowIndex = this.renderGroupedLeaderboardTeamRows(blueEntries, rowIndex, blueRowsStartY);

    this.lbTeamHeaders?.red.label
      .setVisible(showRedHeader)
      .setText(getLocalizedTeamLabel('red', mode).toUpperCase())
      .setPosition(ARENA_SIDEBAR_LEFT_X, redHeaderY);
    this.lbTeamHeaders?.red.score.setVisible(showRedHeader).setText(String(redScore)).setPosition(LB_FRAGS_X, redHeaderY);
    rowIndex = this.renderGroupedLeaderboardTeamRows(redEntries, rowIndex, redRowsStartY);

    for (let i = rowIndex; i < this.lbRows.length; i++) {
      this.lbRows[i].name.setVisible(false);
      this.lbRows[i].frags.setVisible(false);
      this.lbPingRows[i].setVisible(false);
      this.leaderboardCache[i] = { visible: false, nameText: '', nameColor: '', fragsText: '', pingText: '', pingColor: '' };
    }
  }

  private isLeaderboardInputUnchanged(entries: LeaderboardEntry[]): boolean {
    const mode = bridge.getGameMode();
    const previous = this.leaderboardInputCache;
    let unchanged = this.leaderboardInputMode === mode && previous.length === entries.length;
    if (unchanged) {
      for (let index = 0; index < entries.length; index += 1) {
        const left = previous[index];
        const right = entries[index];
        if (
          left.name !== right.name
          || left.colorHex !== right.colorHex
          || left.frags !== right.frags
          || left.ping !== right.ping
          || left.teamId !== right.teamId
          || left.teamScore !== right.teamScore
          || left.sharedXp !== right.sharedXp
        ) {
          unchanged = false;
          break;
        }
      }
    }
    if (unchanged) return true;

    this.leaderboardInputMode = mode;
    this.leaderboardInputCache = entries.map((entry) => ({ ...entry }));
    return false;
  }

  private renderGroupedLeaderboardTeamRows(entries: LeaderboardEntry[], startRowIndex: number, startY: number): number {
    let rowIndex = startRowIndex;
    for (let i = 0; i < entries.length && rowIndex < this.lbRows.length; i++, rowIndex++) {
      const row = this.lbRows[rowIndex];
      const pingText = this.lbPingRows[rowIndex];
      const entry = entries[i];
      const y = startY + i * LB_ENTRY_H;
      row.name.setPosition(ARENA_SIDEBAR_LEFT_X, y).setText(entry.name).setColor(this.toCachedCssColor(entry.colorHex)).setVisible(true);
      row.frags.setPosition(LB_FRAGS_X, y).setText(String(this.resolveLeaderboardEntryFrags(entry))).setVisible(true);
      pingText.setPosition(LB_PING_X, y).setText(`${entry.ping}ms`).setColor(getPingColor(entry.ping)).setVisible(true);
      this.leaderboardCache[rowIndex] = {
        visible: true,
        nameText: entry.name,
        nameColor: this.toCachedCssColor(entry.colorHex),
        fragsText: String(this.resolveLeaderboardEntryFrags(entry)),
        pingText: `${entry.ping}ms`,
        pingColor: getPingColor(entry.ping),
      };
    }
    return rowIndex;
  }

  private resolveGroupedTeamScore(entries: Array<{ frags: number; teamScore?: number; sharedXp?: number }>): number {
    const scoredEntry = entries.find((entry) => entry.teamScore !== undefined);
    if (scoredEntry?.teamScore !== undefined) return scoredEntry.teamScore;
    return entries.reduce((sum, entry) => sum + entry.frags, 0);
  }

  private isDefenseXpMode(): boolean {
    return isCoopDefenseMode(bridge.getGameMode());
  }

  private syncArenaLabels(entries: LeaderboardEntry[]): void {
    const sharedXp = this.resolveSharedXp(entries);
    const showDefenseXp = this.isDefenseXpMode() && this.hasSharedXpData(entries);
    this.leaderboardScoreLabel.setText(t('ui.score.frags')).setPosition(LB_FRAGS_X, LB_HEADER_Y);
    this.leaderboardXpLabel.setText(t('ui.score.xp'));
    this.leaderboardXpLabel.setVisible(showDefenseXp);
    this.leaderboardSharedXpValue
      .setVisible(showDefenseXp && entries.length > 0)
      .setText(String(sharedXp))
      .setPosition(LB_XP_X, LB_START_Y);
  }

  private resolveLeaderboardEntryFrags(entry: LeaderboardEntry): number {
    return Math.max(0, Math.floor(entry.frags));
  }

  private resolveSharedXp(entries: Array<{ sharedXp?: number }>): number {
    return Math.max(0, Math.floor(entries.find((entry) => typeof entry.sharedXp === 'number')?.sharedXp ?? 0));
  }

  private hasSharedXpData(entries: Array<{ sharedXp?: number }>): boolean {
    return entries.some((entry) => typeof entry.sharedXp === 'number');
  }

  private sortLeaderboardEntriesForDisplay(entries: LeaderboardEntry[]): LeaderboardEntry[] {
    return [...entries].sort((a, b) => b.frags - a.frags);
  }
}
