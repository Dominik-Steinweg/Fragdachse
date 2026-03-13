/**
 * LobbyOverlay – kein Phaser-Scene, sondern eine Helferklasse.
 * Verwaltet das semi-transparente Lobby-UI innerhalb der ArenaScene.
 * Sichtbar wenn gamePhase === 'LOBBY' ODER lokaler Spieler isReady === false.
 */
import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { PlayerProfile } from '../types';
import { GAME_WIDTH, GAME_HEIGHT, DEPTH } from '../config';

// ── Layout-Konstanten ─────────────────────────────────────────────────────────
const BG_COLOR      = 0x000000;
const PANEL_COLOR   = 0x1e2a38;
const READY_COLOR   = 0x27ae60;
const UNREADY_COLOR = 0xc0392b;
const TEXT_COLOR    = '#e0e0e0';
const TITLE_COLOR   = '#f0c040';

const PANEL_W  = 700;
const PANEL_H  = 600;   // etwas höher für Name-Zeile
const PANEL_X  = GAME_WIDTH  / 2 - PANEL_W / 2;
const PANEL_Y  = GAME_HEIGHT / 2 - PANEL_H / 2;
const ROW_H    = 48;
const LIST_X   = PANEL_X + 32;
const LIST_Y   = PANEL_Y + 120;
const NAME_Y   = PANEL_Y + PANEL_H - 110;  // Name-Zeile über dem BEREIT-Button
const BTN_Y    = PANEL_Y + PANEL_H - 52;

type PlayerRow = {
  bg:    Phaser.GameObjects.Rectangle;
  name:  Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
};

export class LobbyOverlay {
  private container:      Phaser.GameObjects.Container | null = null;
  private playerRows:     Map<string, PlayerRow> = new Map();
  private statusText!:    Phaser.GameObjects.Text;
  private localNameText!: Phaser.GameObjects.Text;
  private readyBtn!:      Phaser.GameObjects.Rectangle;
  private readyBtnLabel!: Phaser.GameObjects.Text;
  private visible         = false;
  private btnLocked       = false;

  constructor(
    private scene:          Phaser.Scene,
    private bridge:         NetworkBridge,
    private onReadyToggled: () => void,
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
        GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, BG_COLOR, 0.85,
      ).setScrollFactor(0),
    );

    // ── Panel ─────────────────────────────────────────────────────────────
    objects.push(
      this.scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, PANEL_W, PANEL_H, PANEL_COLOR)
        .setStrokeStyle(2, 0x3a4f6a).setScrollFactor(0),
    );

    // ── Titel ─────────────────────────────────────────────────────────────
    objects.push(
      this.scene.add.text(GAME_WIDTH / 2, PANEL_Y + 40, 'FRAGDACHSE', {
        fontSize: '52px', fontFamily: 'monospace', color: TITLE_COLOR, fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0),
    );

    // ── Status-Text ───────────────────────────────────────────────────────
    this.statusText = this.scene.add.text(GAME_WIDTH / 2, PANEL_Y + 90, 'Warte auf Mitspieler…', {
      fontSize: '20px', fontFamily: 'monospace', color: TEXT_COLOR,
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.statusText);

    // ── Trennlinie oben ───────────────────────────────────────────────────
    objects.push(
      this.scene.add.rectangle(GAME_WIDTH / 2, PANEL_Y + 108, PANEL_W - 40, 2, 0x3a4f6a)
        .setScrollFactor(0),
    );

    // ── Trennlinie unten (vor Name + Button) ──────────────────────────────
    objects.push(
      this.scene.add.rectangle(GAME_WIDTH / 2, NAME_Y - 16, PANEL_W - 40, 2, 0x3a4f6a)
        .setScrollFactor(0),
    );

    // ── Name-Zeile ────────────────────────────────────────────────────────
    objects.push(
      this.scene.add.text(PANEL_X + 20, NAME_Y + 2, 'Dein Name:', {
        fontSize: '18px', fontFamily: 'monospace', color: '#aaaaaa',
      }).setScrollFactor(0),
    );

    this.localNameText = this.scene.add.text(PANEL_X + 160, NAME_Y + 2, '', {
      fontSize: '18px', fontFamily: 'monospace', color: TEXT_COLOR, fontStyle: 'bold',
    }).setScrollFactor(0);
    objects.push(this.localNameText);

    // ── Edit-Button ───────────────────────────────────────────────────────
    const editBtn = this.scene.add.text(PANEL_X + PANEL_W - 120, NAME_Y + 2, '[ ÄNDERN ]', {
      fontSize: '16px', fontFamily: 'monospace', color: '#7ec8e3',
    }).setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.openNameEdit())
      .on('pointerover',  () => editBtn.setAlpha(0.7))
      .on('pointerout',   () => editBtn.setAlpha(1));
    objects.push(editBtn);

    // ── Bereit-Button ─────────────────────────────────────────────────────
    this.readyBtn = this.scene.add.rectangle(GAME_WIDTH / 2, BTN_Y, 280, 52, UNREADY_COLOR)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (!this.btnLocked) this.onReadyToggled(); })
      .on('pointerover',  () => { if (!this.btnLocked) this.readyBtn.setAlpha(0.8); })
      .on('pointerout',   () => this.readyBtn.setAlpha(1))
      .setScrollFactor(0);
    objects.push(this.readyBtn);

    this.readyBtnLabel = this.scene.add.text(GAME_WIDTH / 2, BTN_Y, 'BEREIT', {
      fontSize: '26px', fontFamily: 'monospace', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.readyBtnLabel);

    // ── Container mit korrektem Depth erstellen ───────────────────────────
    this.container = this.scene.add.container(0, 0, objects).setDepth(DEPTH.OVERLAY);
    this.container.setVisible(this.visible);
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
        row.bg.destroy(); row.name.destroy(); row.badge.destroy(); row.label.destroy();
        this.playerRows.delete(id);
      }
    }

    // Neue Spieler hinzufügen, bestehende Namen aktualisieren
    for (const profile of connectedPlayers) {
      if (!this.playerRows.has(profile.id)) {
        this.addPlayerRow(profile);
      } else {
        // Name könnte sich geändert haben (setLocalName)
        this.playerRows.get(profile.id)!.name.setText(profile.name);
      }
    }

    this.repositionRows();
    this.refreshBadges();
    this.updateStatus(connectedPlayers.length);

    // Eigenen Namen aktuell halten
    const localId      = this.bridge.getLocalPlayerId();
    const localProfile = connectedPlayers.find(p => p.id === localId);
    if (localProfile) this.localNameText.setText(localProfile.name);
  }

  /** Button-Zustand nach isReady-Toggle anpassen. */
  setReadyButtonState(isReady: boolean): void {
    this.btnLocked = false;
    this.readyBtn.setFillStyle(isReady ? READY_COLOR : UNREADY_COLOR).setAlpha(1);
    this.readyBtnLabel.setText(isReady ? 'NICHT BEREIT' : 'BEREIT');
    this.readyBtn.setInteractive({ useHandCursor: true });
  }

  /** Button deaktivieren wenn Runde startet. */
  lockButton(): void {
    this.btnLocked = true;
    this.readyBtn.disableInteractive().setAlpha(0.4);
  }

  // ── Interne Hilfsmethoden ─────────────────────────────────────────────────

  /** Öffnet einen nativen Dialog zum Namensändern. */
  private openNameEdit(): void {
    const localId      = this.bridge.getLocalPlayerId();
    const currentName  = this.bridge.getConnectedPlayers().find(p => p.id === localId)?.name ?? '';
    const input        = window.prompt('Dein Anzeigename:', currentName);
    if (input !== null && input.trim() !== '') {
      this.bridge.setLocalName(input.trim());
    }
  }

  private addPlayerRow(profile: PlayerProfile): void {
    const idx = this.playerRows.size;
    const y   = LIST_Y + idx * ROW_H;

    const bg = this.scene.add.rectangle(GAME_WIDTH / 2, y, PANEL_W - 40, ROW_H - 6, 0x253040)
      .setOrigin(0.5, 0).setScrollFactor(0);
    const name = this.scene.add.text(LIST_X + 40, y + 10, profile.name, {
      fontSize: '22px', fontFamily: 'monospace',
      color: `#${profile.colorHex.toString(16).padStart(6, '0')}`,
    }).setScrollFactor(0);
    const badge = this.scene.add.rectangle(LIST_X + 8, y + (ROW_H - 6) / 2, 20, 20, UNREADY_COLOR)
      .setOrigin(0.5).setScrollFactor(0);
    const label = this.scene.add.text(LIST_X + 8, y + (ROW_H - 6) / 2, '✗', {
      fontSize: '14px', fontFamily: 'monospace', color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0);

    this.container!.add([bg, name, badge, label]);
    this.playerRows.set(profile.id, { bg, name, badge, label });
  }

  private repositionRows(): void {
    let idx = 0;
    for (const row of this.playerRows.values()) {
      const y = LIST_Y + idx * ROW_H;
      row.bg.setPosition(GAME_WIDTH / 2, y).setOrigin(0.5, 0);
      row.name.setPosition(LIST_X + 40, y + 10);
      row.badge.setPosition(LIST_X + 8, y + (ROW_H - 6) / 2);
      row.label.setPosition(LIST_X + 8, y + (ROW_H - 6) / 2);
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

  private updateStatus(playerCount: number): void {
    if (playerCount < 2) {
      this.statusText.setText('Warte auf Mitspieler…').setStyle({ color: TEXT_COLOR });
    } else {
      const readyCount = [...this.playerRows.keys()]
        .filter(id => this.bridge.getPlayerReady(id)).length;
      this.statusText.setText(`${readyCount} / ${playerCount} bereit`).setStyle({ color: TEXT_COLOR });
    }
  }
}
