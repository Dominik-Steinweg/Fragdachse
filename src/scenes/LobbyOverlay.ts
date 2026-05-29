/**
 * LobbyOverlay – kein Phaser-Scene, sondern eine Helferklasse.
 * Verwaltet das semi-transparente Lobby-UI innerhalb der ArenaScene.
 * Sichtbar wenn gamePhase === 'LOBBY' ODER lokaler Spieler isReady === false.
 */
import * as Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { PlayerProfile, RoomQualitySnapshot, TeamId } from '../types';
import {
  GAME_WIDTH, GAME_HEIGHT,
  DEPTH, COLORS, TEAM_BLUE_COLOR, TEAM_RED_COLOR, toCssColor,
} from '../config';
import { getMinPlayersForMode, hasTeamSelection, isCoopDefenseMode } from '../gameModes';
import type { CoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';
import {
  ensureModalPanelTexture,
  ensureGlossyButtonTexture,
  ensureFlatPanelTexture,
  ensureTintedSectionTexture,
} from '../ui/uiTextures';
import {
  LivingBarEffect,
  createGradientTexture,
  ensureLivingBarTextures,
  type LivingBarPalette,
} from '../ui/LivingBarEffect';
import { attachHoverEffect } from '../ui/uiHover';

// ── Layout-Konstanten ─────────────────────────────────────────────────────────
const ACCENT = COLORS.GOLD_1;
const PANEL_COLOR   = COLORS.GREY_8;
const READY_COLOR   = COLORS.GREEN_4;
const UNREADY_COLOR = COLORS.RED_4;
const TEXT_COLOR    = toCssColor(COLORS.GREY_2);
const ACCENT_COLOR  = toCssColor(COLORS.BROWN_1);
const BTN_COPY_COLOR  = COLORS.BLUE_4;
const BTN_RETRY_COLOR = COLORS.BROWN_4;
const BTN_AUTO_COLOR  = COLORS.GREEN_4;
const BTN_UPGRADES_COLOR = COLORS.GOLD_4;

const PANEL_W  = 800;
const PANEL_H  = 600;
const PANEL_X  = GAME_WIDTH  / 2 - PANEL_W / 2;
const PANEL_Y  = GAME_HEIGHT / 2 - PANEL_H / 2;
const READY_BTN_W = 180;
const READY_BTN_H = 52;
const READY_BTN_Y = PANEL_Y + PANEL_H - 116;
const HOST_LABEL_Y = PANEL_Y + PANEL_H - 70;
const ACTION_BTN_W = 160;
const ACTION_BTN_H = 46;
const ACTION_BTN_Y = PANEL_Y + PANEL_H - 34;
const ACTION_BTN_GAP = 18;
const COOP_PROGRESS_PANEL_W = 520;
const COOP_PROGRESS_PANEL_H = 184;
const COOP_PROGRESS_PANEL_Y = PANEL_Y + PANEL_H + 114;
const COOP_UPGRADE_BTN_W = READY_BTN_W*0.8;
const COOP_UPGRADE_BTN_H = READY_BTN_H*0.8;
const COOP_UPGRADE_BTN_DY = 30;
const COOP_BAR_W = 160;
const COOP_BAR_H = 10;
const COOP_BAR_TEX_KEY = '_lobby_coop_xpbar';
const ROW_H    = 48;
const LIST_X   = PANEL_X + 32;
const LIST_Y   = PANEL_Y + 76;
const ROW_LEVEL_X = PANEL_X + PANEL_W - 150;
const ROW_PING_X = PANEL_X + PANEL_W - 28; // 1332 – Ping rechts-bündig in Spielerzeile
const TEAM_HEADER_ROW_H = 20;
const TEAM_SECTION_GAP = 10;

const READY_BTN_X = GAME_WIDTH / 2;
const COPY_BTN_X = GAME_WIDTH / 2 - (ACTION_BTN_W + ACTION_BTN_GAP);
const RETRY_BTN_X = GAME_WIDTH / 2;
const AUTO_BTN_X = GAME_WIDTH / 2 + (ACTION_BTN_W + ACTION_BTN_GAP);

function btnTexKey(color: number, w: number, h: number): string {
  return `_lobby_btn_${color.toString(16)}_${Math.round(w)}x${Math.round(h)}`;
}

function pingColor(ms: number): string {
  if (ms <= 50)  return toCssColor(COLORS.GREEN_2);
  if (ms <= 100) return toCssColor(COLORS.GOLD_1);
  if (ms <= 200) return toCssColor(COLORS.RED_1);
  return toCssColor(COLORS.RED_3);
}

type PlayerRow = {
  bg:    Phaser.GameObjects.Image;
  name:  Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  level: Phaser.GameObjects.Text;
  ping:  Phaser.GameObjects.Text;
};

export class LobbyOverlay {
  private container:      Phaser.GameObjects.Container | null = null;
  private playerRows:     Map<string, PlayerRow> = new Map();
  private teamHeaders:     Record<TeamId, Phaser.GameObjects.Text> | null = null;
  private statusText!:    Phaser.GameObjects.Text;
  private roomQualityText!: Phaser.GameObjects.Text;
  private hostActionsLabel!: Phaser.GameObjects.Text;
  private readyBtn!:      Phaser.GameObjects.Image;
  private readyBtnLabel!: Phaser.GameObjects.Text;
  private copyBtn!:       Phaser.GameObjects.Image;
  private copyBtnLabel!:  Phaser.GameObjects.Text;
  private retryBtn!:      Phaser.GameObjects.Image;
  private retryBtnLabel!: Phaser.GameObjects.Text;
  private autoBtn!:       Phaser.GameObjects.Image;
  private autoBtnLabel!:  Phaser.GameObjects.Text;
  private coopProgressContainer: Phaser.GameObjects.Container | null = null;
  private coopProgressLevelText: Phaser.GameObjects.Text | null = null;
  private coopProgressBarFill: Phaser.GameObjects.Image | null = null;
  private coopBarEffect: LivingBarEffect | null = null;
  private coopProgressUpgradesBtn: Phaser.GameObjects.Image | null = null;
  private coopProgressUpgradesBtnLabel: Phaser.GameObjects.Text | null = null;
  private coopProgressPointsText: Phaser.GameObjects.Text | null = null;
  private upgradeBtnEffect: LivingBarEffect | null = null;
  private visible         = false;
  private btnLocked       = false;
  private roomQuality: RoomQualitySnapshot | null = null;
  private localIsHost = false;

  constructor(
    private scene:          Phaser.Scene,
    private bridge:         NetworkBridge,
    private onReadyToggled: () => void,
    private onCopyRoomLink: () => void,
    private onRetryRoom: () => void,
    private onStartAutomaticRoomSearch: () => void,
    private onOpenCoopDefenseUpgrades: () => void,
  ) {}

  /** Erstellt alle GameObjects. Sicher mehrfach aufrufbar. */
  build(): void {
    if (this.container) {
      this.container.destroy(true);
      this.container = null;
      this.playerRows.clear();
    }
    this.upgradeBtnEffect?.destroy();
    this.upgradeBtnEffect = null;
    this.coopBarEffect?.destroy();
    this.coopBarEffect = null;
    this.coopProgressContainer?.destroy(true);
    this.coopProgressContainer = null;
    this.coopProgressLevelText = null;
    this.coopProgressBarFill = null;
    this.coopBarEffect = null;
    this.coopProgressUpgradesBtn = null;
    this.coopProgressUpgradesBtnLabel = null;
    this.coopProgressPointsText = null;

    const objects: Phaser.GameObjects.GameObject[] = [];

    // ── Panel ─────────────────────────────────────────────────────────────
    objects.push(
      this.scene.add.image(
        GAME_WIDTH / 2, GAME_HEIGHT / 2,
        ensureModalPanelTexture(this.scene, '_lobby_panel', PANEL_W, PANEL_H, PANEL_COLOR, ACCENT),
      ).setScrollFactor(0),
    );

    // ── Status-Text ───────────────────────────────────────────────────────
    this.statusText = this.scene.add.text(GAME_WIDTH / 2, PANEL_Y + 20, this.getWaitingStatusText(0), {
      fontSize: '20px', fontFamily: 'monospace', color: ACCENT_COLOR, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.statusText);

    this.roomQualityText = this.scene.add.text(GAME_WIDTH / 2, PANEL_Y + 46, 'Ping-Check wird vorbereitet…', {
      fontSize: '15px', fontFamily: 'monospace', color: TEXT_COLOR,
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.roomQualityText);

    const blueHeader = this.scene.add.text(LIST_X + 40, LIST_Y, 'Team Blau', {
      fontSize: '18px', fontFamily: 'monospace', color: toCssColor(TEAM_BLUE_COLOR), fontStyle: 'bold',
    }).setScrollFactor(0).setVisible(false);
    const redHeader = this.scene.add.text(LIST_X + 40, LIST_Y, 'Team Rot', {
      fontSize: '18px', fontFamily: 'monospace', color: toCssColor(TEAM_RED_COLOR), fontStyle: 'bold',
    }).setScrollFactor(0).setVisible(false);
    this.teamHeaders = { blue: blueHeader, red: redHeader };
    objects.push(blueHeader, redHeader);

    // ── Trennlinie oben ───────────────────────────────────────────────────
    objects.push(
      this.scene.add.rectangle(GAME_WIDTH / 2, PANEL_Y + 72, PANEL_W - 40, 1, COLORS.GREY_5, 0.6)
        .setScrollFactor(0),
    );

    // ── Bereit-Button ─────────────────────────────────────────────────────
    this.readyBtn = this.scene.add.image(
      READY_BTN_X, READY_BTN_Y,
      ensureGlossyButtonTexture(this.scene, btnTexKey(UNREADY_COLOR, READY_BTN_W, READY_BTN_H), READY_BTN_W, READY_BTN_H, UNREADY_COLOR, COLORS.RED_2),
    )
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.btnLocked) this.onReadyToggled(); })
      .setScrollFactor(0);
    objects.push(this.readyBtn);

    this.readyBtnLabel = this.scene.add.text(READY_BTN_X, READY_BTN_Y, 'BEREIT', {
      fontSize: '22px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.readyBtnLabel);
    this.attachHoverEffect(this.readyBtn, this.readyBtnLabel);

    this.hostActionsLabel = this.scene.add.text(GAME_WIDTH / 2, HOST_LABEL_Y, '— Host-Funktionen —', {
      fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.hostActionsLabel);

    this.copyBtn = this.scene.add.image(
      COPY_BTN_X, ACTION_BTN_Y,
      ensureGlossyButtonTexture(this.scene, btnTexKey(BTN_COPY_COLOR, ACTION_BTN_W, ACTION_BTN_H), ACTION_BTN_W, ACTION_BTN_H, BTN_COPY_COLOR),
    )
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.btnLocked) this.onCopyRoomLink(); })
      .setScrollFactor(0);
    objects.push(this.copyBtn);

    this.copyBtnLabel = this.scene.add.text(COPY_BTN_X, ACTION_BTN_Y, 'LINK KOPIEREN', {
      fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_2), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.copyBtnLabel);
    this.attachHoverEffect(this.copyBtn, this.copyBtnLabel);

    this.retryBtn = this.scene.add.image(
      RETRY_BTN_X, ACTION_BTN_Y,
      ensureGlossyButtonTexture(this.scene, btnTexKey(BTN_RETRY_COLOR, ACTION_BTN_W, ACTION_BTN_H), ACTION_BTN_W, ACTION_BTN_H, BTN_RETRY_COLOR),
    )
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.btnLocked) this.onRetryRoom(); })
      .setScrollFactor(0);
    objects.push(this.retryBtn);

    this.retryBtnLabel = this.scene.add.text(RETRY_BTN_X, ACTION_BTN_Y, 'NEUER RAUM', {
      fontSize: '16px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_2), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.retryBtnLabel);
    this.attachHoverEffect(this.retryBtn, this.retryBtnLabel);

    this.autoBtn = this.scene.add.image(
      AUTO_BTN_X, ACTION_BTN_Y,
      ensureGlossyButtonTexture(this.scene, btnTexKey(BTN_AUTO_COLOR, ACTION_BTN_W, ACTION_BTN_H), ACTION_BTN_W, ACTION_BTN_H, BTN_AUTO_COLOR),
    )
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.btnLocked) this.onStartAutomaticRoomSearch(); })
      .setScrollFactor(0);
    objects.push(this.autoBtn);

    this.autoBtnLabel = this.scene.add.text(AUTO_BTN_X, ACTION_BTN_Y, 'AUTO-SUCHE', {
      fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_2), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.autoBtnLabel);
    this.attachHoverEffect(this.autoBtn, this.autoBtnLabel);

    const coopProgressBg = this.scene.add.image(
      READY_BTN_X, COOP_PROGRESS_PANEL_Y,
      ensureTintedSectionTexture(this.scene, '_lobby_coop_panel', COOP_PROGRESS_PANEL_W, COOP_PROGRESS_PANEL_H, COLORS.GOLD_3, COLORS.GREY_8),
    ).setScrollFactor(0);
    const coopProgressTitle = this.scene.add.text(READY_BTN_X, COOP_PROGRESS_PANEL_Y - 68, 'Dachs vs. Zombies Fortschritt', {
      fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GOLD_1), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    this.coopProgressLevelText = this.scene.add.text(READY_BTN_X, COOP_PROGRESS_PANEL_Y - 40, 'Level 1', {
      fontSize: '24px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);

    // Kleiner Fortschrittsbalken zum naechsten Level (Pendant zur grossen XP-Leiste im Upgrade-Panel).
    const coopBarY = COOP_PROGRESS_PANEL_Y - 8;
    const coopBarX = READY_BTN_X - COOP_BAR_W / 2;
    const coopBarBg = this.scene.add.rectangle(READY_BTN_X, coopBarY, COOP_BAR_W, COOP_BAR_H, COLORS.GREY_9, 0.95)
      .setStrokeStyle(1, COLORS.GREY_5)
      .setScrollFactor(0);
    ensureLivingBarTextures(this.scene);
    const coopBarPalette: LivingBarPalette = { dark: COLORS.GREEN_4, mid: COLORS.GREEN_2, light: COLORS.GREEN_1 };
    createGradientTexture(this.scene, COOP_BAR_TEX_KEY, coopBarPalette, COOP_BAR_W, COOP_BAR_H);
    this.coopProgressBarFill = this.scene.add.image(coopBarX, coopBarY, COOP_BAR_TEX_KEY)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    this.coopProgressBarFill.setCrop(0, 0, COOP_BAR_W, COOP_BAR_H);

    const upgradeBtnY = COOP_PROGRESS_PANEL_Y + COOP_UPGRADE_BTN_DY;
    this.coopProgressUpgradesBtn = this.scene.add.image(
      READY_BTN_X, upgradeBtnY,
      ensureGlossyButtonTexture(this.scene, btnTexKey(BTN_UPGRADES_COLOR, COOP_UPGRADE_BTN_W, COOP_UPGRADE_BTN_H), COOP_UPGRADE_BTN_W, COOP_UPGRADE_BTN_H, BTN_UPGRADES_COLOR),
    )
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onOpenCoopDefenseUpgrades())
      .setScrollFactor(0);
    this.coopProgressUpgradesBtnLabel = this.scene.add.text(READY_BTN_X, upgradeBtnY, 'UPGRADES', {
      fontSize: '22px', fontFamily: 'monospace', color: toCssColor(COLORS.GOLD_3), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    this.attachHoverEffect(this.coopProgressUpgradesBtn, this.coopProgressUpgradesBtnLabel);
    this.coopProgressPointsText = this.scene.add.text(READY_BTN_X, upgradeBtnY + COOP_UPGRADE_BTN_H / 2 + 18, '', {
      fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GOLD_1), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    this.coopProgressContainer = this.scene.add.container(0, 0, [
      coopProgressBg,
      coopProgressTitle,
      this.coopProgressLevelText,
      coopBarBg,
      this.coopProgressBarFill,
      this.coopProgressUpgradesBtn,
      this.coopProgressUpgradesBtnLabel,
      this.coopProgressPointsText,
    ]).setDepth(DEPTH.OVERLAY + 0.5).setVisible(false);

    // Living-Bar-Effekt auf dem Upgrade-Button: macht auf freie Punkte aufmerksam.
    const upgradePalette: LivingBarPalette = {
      dark: COLORS.GOLD_3,
      mid: COLORS.GOLD_1,
      light: COLORS.GOLD_1,
    };
    this.upgradeBtnEffect = new LivingBarEffect(
      this.scene,
      this.coopProgressContainer,
      READY_BTN_X - COOP_UPGRADE_BTN_W / 2,
      upgradeBtnY - COOP_UPGRADE_BTN_H / 2,
      COOP_UPGRADE_BTN_W,
      COOP_UPGRADE_BTN_H,
      upgradePalette,
      { glowTarget: this.coopProgressUpgradesBtn, scrollFactor: 0, intensity: 0.8 },
    );
    // Effekt-Partikel ueber dem Button, aber unter dem Label halten.
    this.coopProgressContainer.bringToTop(this.coopProgressUpgradesBtnLabel);
    this.upgradeBtnEffect.stop();

    // Living-Bar-Effekt auf dem LVL-Fortschrittsbalken (wie die grosse XP-Leiste).
    this.coopBarEffect = new LivingBarEffect(
      this.scene,
      this.coopProgressContainer,
      coopBarX,
      coopBarY - COOP_BAR_H / 2,
      COOP_BAR_W,
      COOP_BAR_H,
      coopBarPalette,
      { glowTarget: this.coopProgressBarFill, scrollFactor: 0, intensity: 1.2 },
    );
    this.coopBarEffect.stop();

    // ── Container mit korrektem Depth erstellen ───────────────────────────
    this.container = this.scene.add.container(0, 0, objects).setDepth(DEPTH.OVERLAY);
    this.container.setVisible(this.visible);
    this.coopProgressContainer.setVisible(this.visible && false);
    this.updateRoomActionButtons();
  }

  show(): void {
    this.visible = true;
    this.container?.setVisible(true);
    this.coopProgressContainer?.setVisible(this.coopProgressContainer.visible);
  }

  hide(): void {
    this.visible = false;
    this.container?.setVisible(false);
    this.coopProgressContainer?.setVisible(false);
    this.upgradeBtnEffect?.stop();
    this.coopBarEffect?.stop();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Aktualisiert die Spielerliste, Badges und den eigenen Namen. Jeden Frame aufrufen. */
  refreshPlayerList(connectedPlayers: PlayerProfile[]): void {
    if (!this.container) return;

    const currentIds = new Set(connectedPlayers.map(p => p.id));

    // Reihen für abgemeldete Spieler entfernen
    for (const [id, row] of this.playerRows) {
      if (!currentIds.has(id)) {
        row.bg.destroy(); row.name.destroy(); row.badge.destroy(); row.label.destroy(); row.level.destroy(); row.ping.destroy();
        this.playerRows.delete(id);
      }
    }

    // Neue Spieler hinzufügen, bestehende Namen aktualisieren
    for (const profile of connectedPlayers) {
      if (!this.playerRows.has(profile.id)) {
        this.addPlayerRow(profile);
      } else {
        // Name und Farbe könnten sich geändert haben
        const row = this.playerRows.get(profile.id)!;
        row.name.setText(profile.name);
        row.name.setStyle({ color: `#${profile.colorHex.toString(16).padStart(6, '0')}` });
      }
    }

    this.repositionRows(connectedPlayers);
    this.refreshBadges();
    this.refreshCoopDefenseLevels();
    this.refreshPings();
    this.updateCoopDefenseLevelVisibility();
    this.updateStatus(connectedPlayers.length);
  }

  setRoomQuality(snapshot: RoomQualitySnapshot | null, localIsHost: boolean): void {
    this.roomQuality = snapshot;
    this.localIsHost = localIsHost;
    this.updateStatus(this.playerRows.size);
    this.updateRoomActionButtons();
  }

  showCopySuccess(): void {
    this.copyBtnLabel.setText('KOPIERT');
    this.scene.time.delayedCall(1200, () => {
      if (!this.copyBtnLabel.scene) return;
      this.copyBtnLabel.setText('LINK KOPIEREN');
    });
  }

  setCoopDefenseProgress(progress: CoopDefenseProgressSnapshot | null): void {
    if (!this.coopProgressContainer || !this.coopProgressLevelText) return;

    if (!progress) {
      this.coopProgressContainer.setVisible(false);
      this.upgradeBtnEffect?.stop();
      return;
    }

    this.coopProgressContainer.setVisible(this.visible);
    this.coopProgressLevelText.setText(`Level ${progress.level}`);

    const fillW = Math.max(0.001, COOP_BAR_W * progress.levelProgressFraction);
    this.coopProgressBarFill?.setCrop(0, 0, fillW, COOP_BAR_H);
    this.coopBarEffect?.setFilledWidth(fillW);
    if (this.visible) this.coopBarEffect?.start();
    else this.coopBarEffect?.stop();

    const freePoints = progress.availableUpgradePoints;
    if (this.coopProgressPointsText) {
      this.coopProgressPointsText.setText(
        freePoints > 0 ? `${freePoints} Upgrade-Punkte verfuegbar` : 'Alle Punkte verteilt',
      );
      this.coopProgressPointsText.setColor(toCssColor(freePoints > 0 ? COLORS.GOLD_1 : COLORS.GREY_4));
    }

    // Aktiver Living-Bar-Effekt nur, wenn der Spieler noch freie Punkte hat.
    if (freePoints > 0 && this.visible) {
      this.upgradeBtnEffect?.setFilledWidth(COOP_UPGRADE_BTN_W);
      this.upgradeBtnEffect?.start();
    } else {
      this.upgradeBtnEffect?.stop();
    }
  }

  /** Button-Zustand nach isReady-Toggle anpassen. */
  setReadyButtonState(isReady: boolean): void {
    this.btnLocked = false;
    const readyTex = isReady
      ? ensureGlossyButtonTexture(this.scene, btnTexKey(READY_COLOR, READY_BTN_W, READY_BTN_H), READY_BTN_W, READY_BTN_H, READY_COLOR, COLORS.GREEN_2)
      : ensureGlossyButtonTexture(this.scene, btnTexKey(UNREADY_COLOR, READY_BTN_W, READY_BTN_H), READY_BTN_W, READY_BTN_H, UNREADY_COLOR, COLORS.RED_2);
    this.readyBtn.setTexture(readyTex).setAlpha(1);
    this.readyBtnLabel.setText(isReady ? 'NICHT BEREIT' : 'BEREIT');
    this.readyBtn.setInteractive({ useHandCursor: true });
    this.updateRoomActionButtons();
  }

  /** Button deaktivieren wenn Runde startet. */
  lockButton(): void {
    this.btnLocked = true;
    this.readyBtn.disableInteractive().setAlpha(0.4);
    this.updateRoomActionButtons();
  }

  /**
   * Zeigt eine permanente Fehlermeldung wenn der Host das Spiel verlassen hat.
   * Deaktiviert den BEREIT-Button, bis das Overlay neu gebaut wird (build()).
   */
  showHostDisconnectedMessage(): void {
    this.statusText
      .setText('Host hat das Spiel verlassen.')
      .setStyle({ color: toCssColor(COLORS.RED_2) });
    this.roomQualityText
      .setText('Ping-Check nicht verfuegbar.')
      .setStyle({ color: toCssColor(COLORS.RED_2) });
    this.btnLocked = true;
    this.readyBtn.disableInteractive().setAlpha(0.4);
    this.readyBtnLabel.setText('BEENDET');
    this.updateRoomActionButtons();
  }

  // ── Interne Hilfsmethoden ─────────────────────────────────────────────────

  private attachHoverEffect(btn: Phaser.GameObjects.Image, label: Phaser.GameObjects.Text): void {
    attachHoverEffect(this.scene, btn, label);
  }

  private addPlayerRow(profile: PlayerProfile): void {
    const idx = this.playerRows.size;
    const y   = LIST_Y + idx * ROW_H;

    const bg = this.scene.add.image(
      GAME_WIDTH / 2, y,
      ensureFlatPanelTexture(this.scene, '_lobby_row', PANEL_W - 40, ROW_H - 6, COLORS.GREY_7, COLORS.GREY_5, { radius: 8, fillAlpha: 0.85 }),
    ).setOrigin(0.5, 0).setScrollFactor(0);
    const name = this.scene.add.text(LIST_X + 40, y + 10, profile.name, {
      fontSize: '22px', fontFamily: 'monospace',
      color: `#${profile.colorHex.toString(16).padStart(6, '0')}`,
    }).setScrollFactor(0);
    const badge = this.scene.add.rectangle(LIST_X + 8, y + (ROW_H - 6) / 2, 20, 20, UNREADY_COLOR)
      .setOrigin(0.5).setScrollFactor(0);
    const label = this.scene.add.text(LIST_X + 8, y + (ROW_H - 6) / 2, '✗', {
      fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1),  fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    const level = this.scene.add.text(ROW_LEVEL_X, y + (ROW_H - 6) / 2, '-', {
      fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GOLD_1), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);

    const ping = this.scene.add.text(ROW_PING_X, y + (ROW_H - 6) / 2, '', {
      fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
    }).setOrigin(1, 0.5).setScrollFactor(0);

    this.container!.add([bg, name, badge, label, level, ping]);
    this.playerRows.set(profile.id, { bg, name, badge, label, level, ping });
  }

  private repositionRows(connectedPlayers: PlayerProfile[]): void {
    const mode = this.bridge.getGameMode();
    if (!hasTeamSelection(mode)) {
      this.teamHeaders?.blue.setVisible(false);
      this.teamHeaders?.red.setVisible(false);
      let idx = 0;
      for (const profile of connectedPlayers) {
        const row = this.playerRows.get(profile.id);
        if (!row) continue;
        const y = LIST_Y + idx * ROW_H;
        this.positionRow(row, y);
        idx++;
      }
      return;
    }

    const bluePlayers = connectedPlayers.filter((profile) => profile.teamId === 'blue');
    const redPlayers = connectedPlayers.filter((profile) => profile.teamId === 'red');
    let currentY = LIST_Y;

    this.teamHeaders?.blue.setVisible(true).setPosition(LIST_X + 40, currentY);
    currentY += TEAM_HEADER_ROW_H;
    for (const profile of bluePlayers) {
      const row = this.playerRows.get(profile.id);
      if (!row) continue;
      this.positionRow(row, currentY);
      currentY += ROW_H;
    }

    currentY += TEAM_SECTION_GAP;
    this.teamHeaders?.red.setVisible(true).setPosition(LIST_X + 40, currentY);
    currentY += TEAM_HEADER_ROW_H;
    for (const profile of redPlayers) {
      const row = this.playerRows.get(profile.id);
      if (!row) continue;
      this.positionRow(row, currentY);
      currentY += ROW_H;
    }
  }

  private positionRow(row: PlayerRow, y: number): void {
    row.bg.setPosition(GAME_WIDTH / 2, y).setOrigin(0.5, 0);
    row.name.setPosition(LIST_X + 40, y + 10);
    row.badge.setPosition(LIST_X + 8, y + (ROW_H - 6) / 2);
    row.label.setPosition(LIST_X + 8, y + (ROW_H - 6) / 2);
    row.level.setPosition(ROW_LEVEL_X, y + (ROW_H - 6) / 2);
    row.ping.setPosition(ROW_PING_X, y + (ROW_H - 6) / 2);
  }

  private refreshBadges(): void {
    for (const [id, row] of this.playerRows) {
      const ready = this.bridge.getPlayerReady(id);
      row.badge.setFillStyle(ready ? READY_COLOR : UNREADY_COLOR);
      row.label.setText(ready ? '✓' : '✗');
    }
  }

  private refreshCoopDefenseLevels(): void {
    const showLevels = isCoopDefenseMode(this.bridge.getGameMode());
    for (const [id, row] of this.playerRows) {
      row.level.setText(showLevels ? `LVL ${this.bridge.getPlayerCoopDefenseLevel(id)}` : '-');
    }
  }

  private updateCoopDefenseLevelVisibility(): void {
    const showLevels = isCoopDefenseMode(this.bridge.getGameMode());
    for (const row of this.playerRows.values()) {
      row.level.setVisible(showLevels);
    }
  }

  private refreshPings(): void {
    for (const [id, row] of this.playerRows) {
      const ms = this.bridge.getPlayerPing(id);
      row.ping.setText(`${ms}ms`).setColor(pingColor(ms));
    }
  }

  private getWaitingStatusText(playerCount: number): string {
    const minPlayers = getMinPlayersForMode(this.bridge.getGameMode());
    if (minPlayers <= 1) return `${playerCount} / ${minPlayers} Spieler bereit zum Start`;
    return `Warte auf Mitspieler… (${playerCount} / ${minPlayers})`;
  }

  private updateStatus(playerCount: number): void {
    const minPlayers = getMinPlayersForMode(this.bridge.getGameMode());
    if (playerCount < minPlayers) {
      this.statusText.setText(this.getWaitingStatusText(playerCount)).setStyle({ color: ACCENT_COLOR });
    } else {
      const readyCount = [...this.playerRows.keys()]
        .filter(id => this.bridge.getPlayerReady(id)).length;
      this.statusText.setText(`${readyCount} / ${playerCount} bereit`).setStyle({ color: ACCENT_COLOR });
    }

    const roomSummary = this.formatRoomQualityText();
    const color = this.roomQuality ? this.getRoomQualityColor(this.roomQuality.status) : TEXT_COLOR;
    this.roomQualityText.setText(roomSummary).setStyle({ color });
  }

  private updateRoomActionButtons(): void {
    const canShowActions = this.localIsHost;
    const autoSearchActive = this.roomQuality?.autoSearchActive === true;
    const readyDisabled = this.btnLocked || (canShowActions && autoSearchActive);
    const retryDisabled = this.btnLocked || autoSearchActive || this.roomQuality?.status === 'retrying';
    const copyDisabled = this.btnLocked || autoSearchActive;
    const autoDisabled = this.btnLocked;

    this.readyBtn.setAlpha(!readyDisabled ? 1 : 0.4);
    if (!readyDisabled) this.readyBtn.setInteractive({ useHandCursor: true });
    else this.readyBtn.disableInteractive();

    this.hostActionsLabel.setVisible(canShowActions);
    this.copyBtn.setVisible(canShowActions).setAlpha(canShowActions && !copyDisabled ? 1 : 0.4);
    this.copyBtnLabel.setVisible(canShowActions);
    this.retryBtn.setVisible(canShowActions).setAlpha(canShowActions && !retryDisabled ? 1 : 0.4);
    this.retryBtnLabel.setVisible(canShowActions);
    this.autoBtn.setVisible(canShowActions).setAlpha(canShowActions && !autoDisabled ? 1 : 0.4);
    this.autoBtnLabel.setVisible(canShowActions);
    this.autoBtnLabel.setText(this.getAutoButtonLabel());

    if (canShowActions && !copyDisabled) this.copyBtn.setInteractive({ useHandCursor: true });
    else this.copyBtn.disableInteractive();

    if (canShowActions && !retryDisabled) this.retryBtn.setInteractive({ useHandCursor: true });
    else this.retryBtn.disableInteractive();

    if (canShowActions && !autoDisabled) this.autoBtn.setInteractive({ useHandCursor: true });
    else this.autoBtn.disableInteractive();
  }

  private formatRoomQualityText(): string {
    if (!this.roomQuality) return 'Ping-Check wird vorbereitet…';

    if (this.roomQuality.autoSearchActive) {
      const attemptText = this.getAutoSearchAttemptText();
      if (this.roomQuality.status === 'sampling' || this.roomQuality.status === 'waiting') {
        return `Auto-Suche ${attemptText}: Raum wird geprueft. Klick auf STOPP beendet die Suche.`;
      }
      if (this.roomQuality.status === 'retrying') {
        return `Auto-Suche ${attemptText}: Raum ungeeignet, neuer Raum folgt. Klick auf STOPP beendet die Suche.`;
      }
    }

    if (this.roomQuality.autoSearchExhausted) {
      return `Auto-Suche beendet: Kein guter Raum nach ${this.roomQuality.autoSearchMaxAttempts} Versuchen.`;
    }

    if (this.roomQuality.status === 'sampling') {
      return this.roomQuality.source === 'host-proxy'
        ? 'Host-Probe prueft die Raumqualitaet…'
        : `Raumtest sammelt Ping-Daten (${this.roomQuality.minSamplesCollected}/${this.roomQuality.requiredSamples}).`;
    }

    if (this.roomQuality.status === 'waiting') {
      return 'Host-Probe ohne Ergebnis. Link kann trotzdem geteilt werden.';
    }

    if (this.roomQuality.status === 'good' && this.roomQuality.worstPingMs !== null) {
      if (!this.localIsHost) return '';
      return `Raumtest ok: ${this.roomQuality.worstPingMs}ms bei Ziel ${this.roomQuality.thresholdMs}ms.`;
    }

    if (this.roomQuality.status === 'bad' && this.roomQuality.worstPingMs !== null) {
      return `Raumtest zu hoch: ${this.roomQuality.worstPingMs}ms bei Ziel ${this.roomQuality.thresholdMs}ms. Neuer Raum empfohlen.`;
    }

    if (this.roomQuality.status === 'retrying' && this.roomQuality.worstPingMs !== null) {
      return `Raumtest zu hoch: ${this.roomQuality.worstPingMs}ms. Neuer Raum folgt.`;
    }

    return this.roomQuality.summary;
  }

  private getAutoButtonLabel(): string {
    if (!this.roomQuality?.autoSearchActive) return 'AUTO-SUCHE';
    return `STOPP ${this.getAutoSearchAttemptText()}`;
  }

  private getAutoSearchAttemptText(): string {
    if (!this.roomQuality) return '1/1';
    const currentAttempt = Math.max(1, this.roomQuality.autoSearchAttempt || 1);
    const maxAttempts = Math.max(currentAttempt, this.roomQuality.autoSearchMaxAttempts || currentAttempt);
    return `${currentAttempt}/${maxAttempts}`;
  }

  private getRoomQualityColor(status: RoomQualitySnapshot['status']): string {
    if (status === 'good') return toCssColor(COLORS.GREEN_2);
    if (status === 'bad') return toCssColor(COLORS.RED_2);
    if (status === 'retrying') return toCssColor(COLORS.GOLD_1);
    return TEXT_COLOR;
  }
}
