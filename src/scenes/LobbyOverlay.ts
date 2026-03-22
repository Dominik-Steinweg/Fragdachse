/**
 * LobbyOverlay – kein Phaser-Scene, sondern eine Helferklasse.
 * Verwaltet das semi-transparente Lobby-UI innerhalb der ArenaScene.
 * Sichtbar wenn gamePhase === 'LOBBY' ODER lokaler Spieler isReady === false.
 */
import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { PlayerProfile, RoomQualitySnapshot } from '../types';
import {
  GAME_WIDTH, GAME_HEIGHT, ARENA_WIDTH, ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  DEPTH, COLORS, toCssColor,
} from '../config';

// ── Layout-Konstanten ─────────────────────────────────────────────────────────
const BG_COLOR      = COLORS.GREY_9;
const PANEL_COLOR   = COLORS.GREY_6;
const READY_COLOR   = COLORS.GREEN_3;
const UNREADY_COLOR = COLORS.RED_3;
const TEXT_COLOR    = toCssColor(COLORS.GREY_2);

const PANEL_W  = 800;
const PANEL_H  = 600;
const PANEL_X  = GAME_WIDTH  / 2 - PANEL_W / 2;
const PANEL_Y  = GAME_HEIGHT / 2 - PANEL_H / 2;
const LOGO_Y   = 120;
const ACTION_BTN_W = 160;
const ACTION_BTN_H = 44;
const ACTION_BTN_Y = PANEL_Y + PANEL_H - 52;
const ACTION_BTN_OFFSET_X = 220;
const READY_BTN_W = 220;
const ROW_H    = 48;
const LIST_X   = PANEL_X + 32;
const LIST_Y   = PANEL_Y + 60;
const ROW_PING_X = PANEL_X + PANEL_W - 28; // 1332 – Ping rechts-bündig in Spielerzeile

function pingColor(ms: number): string {
  if (ms <= 50)  return toCssColor(COLORS.GREEN_2);
  if (ms <= 100) return toCssColor(COLORS.GOLD_1);
  if (ms <= 200) return toCssColor(COLORS.RED_1);
  return toCssColor(COLORS.RED_3);
}

type PlayerRow = {
  bg:    Phaser.GameObjects.Rectangle;
  name:  Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  ping:  Phaser.GameObjects.Text;
};

export class LobbyOverlay {
  private container:      Phaser.GameObjects.Container | null = null;
  private playerRows:     Map<string, PlayerRow> = new Map();
  private statusText!:    Phaser.GameObjects.Text;
  private readyBtn!:      Phaser.GameObjects.Rectangle;
  private readyBtnLabel!: Phaser.GameObjects.Text;
  private copyBtn!:       Phaser.GameObjects.Rectangle;
  private copyBtnLabel!:  Phaser.GameObjects.Text;
  private retryBtn!:      Phaser.GameObjects.Rectangle;
  private retryBtnLabel!: Phaser.GameObjects.Text;
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
  ) {}

  /** Erstellt alle GameObjects. Sicher mehrfach aufrufbar. */
  build(): void {
    if (this.container) {
      this.container.destroy(true);
      this.container = null;
      this.playerRows.clear();
    }

    const objects: Phaser.GameObjects.GameObject[] = [];

    // ── Halbtransparenter Hintergrund ─────────────────────────────────────
    objects.push(
      this.scene.add.rectangle(
        ARENA_OFFSET_X + ARENA_WIDTH / 2,
        ARENA_OFFSET_Y + ARENA_HEIGHT / 2,
        ARENA_WIDTH,
        ARENA_HEIGHT,
        BG_COLOR,
        0.10,
      ).setScrollFactor(0),
    );

    // ── Panel ─────────────────────────────────────────────────────────────
    objects.push(
      this.scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, PANEL_W, PANEL_H, PANEL_COLOR, 0.8)
        .setStrokeStyle(2, COLORS.GOLD_1).setScrollFactor(0),
    );

    // ── Titel ─────────────────────────────────────────────────────────────
    objects.push(
      this.scene.add.image(GAME_WIDTH / 2, LOGO_Y, 'lobby_logo')
        .setOrigin(0.5)
        .setScrollFactor(0),
    );

    // ── Status-Text ───────────────────────────────────────────────────────
    this.statusText = this.scene.add.text(GAME_WIDTH / 2, PANEL_Y + 30, 'Warte auf Mitspieler…', {
      fontSize: '20px', fontFamily: 'monospace', color: TEXT_COLOR,
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.statusText);

    // ── Trennlinie oben ───────────────────────────────────────────────────
    objects.push(
      this.scene.add.rectangle(GAME_WIDTH / 2, PANEL_Y + 48, PANEL_W - 40, 2, COLORS.GOLD_1)
        .setScrollFactor(0),
    );

    // ── Bereit-Button ─────────────────────────────────────────────────────
    this.copyBtn = this.scene.add.rectangle(GAME_WIDTH / 2 - ACTION_BTN_OFFSET_X, ACTION_BTN_Y, ACTION_BTN_W, ACTION_BTN_H, COLORS.BLUE_4)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.btnLocked) this.onCopyRoomLink(); })
      .on('pointerover',  () => { if (!this.btnLocked) this.copyBtn.setAlpha(0.8); })
      .on('pointerout',   () => this.copyBtn.setAlpha(1))
      .setScrollFactor(0);
    objects.push(this.copyBtn);

    this.copyBtnLabel = this.scene.add.text(GAME_WIDTH / 2 - ACTION_BTN_OFFSET_X, ACTION_BTN_Y, 'LINK', {
      fontSize: '20px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.copyBtnLabel);

    this.readyBtn = this.scene.add.rectangle(GAME_WIDTH / 2, ACTION_BTN_Y, READY_BTN_W, 52, UNREADY_COLOR)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.btnLocked) this.onReadyToggled(); })
      .on('pointerover',  () => { if (!this.btnLocked) this.readyBtn.setAlpha(0.8); })
      .on('pointerout',   () => this.readyBtn.setAlpha(1))
      .setScrollFactor(0);
    objects.push(this.readyBtn);

    this.readyBtnLabel = this.scene.add.text(GAME_WIDTH / 2, ACTION_BTN_Y, 'BEREIT', {
      fontSize: '26px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.readyBtnLabel);

    this.retryBtn = this.scene.add.rectangle(GAME_WIDTH / 2 + ACTION_BTN_OFFSET_X, ACTION_BTN_Y, ACTION_BTN_W, ACTION_BTN_H, COLORS.GOLD_4)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.btnLocked) this.onRetryRoom(); })
      .on('pointerover',  () => { if (!this.btnLocked) this.retryBtn.setAlpha(0.8); })
      .on('pointerout',   () => this.retryBtn.setAlpha(1))
      .setScrollFactor(0);
    objects.push(this.retryBtn);

    this.retryBtnLabel = this.scene.add.text(GAME_WIDTH / 2 + ACTION_BTN_OFFSET_X, ACTION_BTN_Y, 'NEUER RAUM', {
      fontSize: '18px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1), fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.retryBtnLabel);

    // ── Container mit korrektem Depth erstellen ───────────────────────────
    this.container = this.scene.add.container(0, 0, objects).setDepth(DEPTH.OVERLAY);
    this.container.setVisible(this.visible);
    this.updateRoomActionButtons();
  }

  show(): void {
    this.visible = true;
    this.container?.setVisible(true);
  }

  hide(): void {
    this.visible = false;
    this.container?.setVisible(false);
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
        row.bg.destroy(); row.name.destroy(); row.badge.destroy(); row.label.destroy(); row.ping.destroy();
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

    this.repositionRows();
    this.refreshBadges();
    this.refreshPings();
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
      this.copyBtnLabel.setText('LINK');
    });
  }

  /** Button-Zustand nach isReady-Toggle anpassen. */
  setReadyButtonState(isReady: boolean): void {
    this.btnLocked = false;
    this.readyBtn.setFillStyle(isReady ? READY_COLOR : UNREADY_COLOR).setAlpha(1);
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
      .setStyle({ color: '#ff4444' });
    this.btnLocked = true;
    this.readyBtn.disableInteractive().setAlpha(0.4);
    this.readyBtnLabel.setText('BEENDET');
    this.updateRoomActionButtons();
  }

  // ── Interne Hilfsmethoden ─────────────────────────────────────────────────

  private addPlayerRow(profile: PlayerProfile): void {
    const idx = this.playerRows.size;
    const y   = LIST_Y + idx * ROW_H;

    const bg = this.scene.add.rectangle(GAME_WIDTH / 2, y, PANEL_W - 40, ROW_H - 6, COLORS.GREY_7)
      .setOrigin(0.5, 0).setScrollFactor(0);
    const name = this.scene.add.text(LIST_X + 40, y + 10, profile.name, {
      fontSize: '22px', fontFamily: 'monospace',
      color: `#${profile.colorHex.toString(16).padStart(6, '0')}`,
    }).setScrollFactor(0);
    const badge = this.scene.add.rectangle(LIST_X + 8, y + (ROW_H - 6) / 2, 20, 20, UNREADY_COLOR)
      .setOrigin(0.5).setScrollFactor(0);
    const label = this.scene.add.text(LIST_X + 8, y + (ROW_H - 6) / 2, '✗', {
      fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1),  fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);

    const ping = this.scene.add.text(ROW_PING_X, y + (ROW_H - 6) / 2, '', {
      fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
    }).setOrigin(1, 0.5).setScrollFactor(0);

    this.container!.add([bg, name, badge, label, ping]);
    this.playerRows.set(profile.id, { bg, name, badge, label, ping });
  }

  private repositionRows(): void {
    let idx = 0;
    for (const row of this.playerRows.values()) {
      const y = LIST_Y + idx * ROW_H;
      row.bg.setPosition(GAME_WIDTH / 2, y).setOrigin(0.5, 0);
      row.name.setPosition(LIST_X + 40, y + 10);
      row.badge.setPosition(LIST_X + 8, y + (ROW_H - 6) / 2);
      row.label.setPosition(LIST_X + 8, y + (ROW_H - 6) / 2);
      row.ping.setPosition(ROW_PING_X, y + (ROW_H - 6) / 2);
      idx++;
    }
  }

  private refreshBadges(): void {
    for (const [id, row] of this.playerRows) {
      const ready = this.bridge.getPlayerReady(id);
      row.badge.setFillStyle(ready ? READY_COLOR : UNREADY_COLOR);
      row.label.setText(ready ? '✓' : '✗');
    }
  }
  private refreshPings(): void {
    for (const [id, row] of this.playerRows) {
      const ms = this.bridge.getPlayerPing(id);
      row.ping.setText(`${ms}ms`).setColor(pingColor(ms));
    }
  }

  private updateStatus(playerCount: number): void {
    const roomSummary = this.roomQuality?.summary ? `  |  ${this.roomQuality.summary}` : '';
    const color = this.roomQuality ? this.getRoomQualityColor(this.roomQuality.status) : TEXT_COLOR;
    if (playerCount < 2) {
      this.statusText.setText(`Warte auf Mitspieler…${roomSummary}`).setStyle({ color });
    } else {
      const readyCount = [...this.playerRows.keys()]
        .filter(id => this.bridge.getPlayerReady(id)).length;
      this.statusText.setText(`${readyCount} / ${playerCount} bereit${roomSummary}`).setStyle({ color });
    }
  }

  private updateRoomActionButtons(): void {
    const canShowActions = this.localIsHost;
    const retryDisabled = this.btnLocked || this.roomQuality?.status === 'retrying';
    const copyDisabled = this.btnLocked;

    this.copyBtn.setVisible(canShowActions).setAlpha(canShowActions && !copyDisabled ? 1 : 0.4);
    this.copyBtnLabel.setVisible(canShowActions);
    this.retryBtn.setVisible(canShowActions).setAlpha(canShowActions && !retryDisabled ? 1 : 0.4);
    this.retryBtnLabel.setVisible(canShowActions);

    if (canShowActions && !copyDisabled) this.copyBtn.setInteractive({ useHandCursor: true });
    else this.copyBtn.disableInteractive();

    if (canShowActions && !retryDisabled) this.retryBtn.setInteractive({ useHandCursor: true });
    else this.retryBtn.disableInteractive();
  }

  private getRoomQualityColor(status: RoomQualitySnapshot['status']): string {
    if (status === 'good') return toCssColor(COLORS.GREEN_2);
    if (status === 'bad') return toCssColor(COLORS.RED_2);
    if (status === 'retrying') return toCssColor(COLORS.GOLD_1);
    return TEXT_COLOR;
  }
}
