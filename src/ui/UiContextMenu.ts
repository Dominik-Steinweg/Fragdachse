import * as Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import { ensureFlatPanelTexture } from './uiTextures';

/**
 * Kleines Aktionsmenue am Klickpunkt (Ausruesten, Ablegen, Zerlegen ...).
 *
 * Aufbau wie beim `LoadoutSlotPicker`: eigener Vollbild-Fangschirm im Container, Clamping an den
 * Bildschirmrand und Zeilen-Hover als Aufhellung statt Skalierung – linksbuendige Zeilen wuerden
 * sich sonst unter der Maus verschieben. Der Aufrufer haengt das Menue in seinen eigenen
 * Root-Container, damit es dessen Schichtung erbt.
 */

export interface UiContextMenuEntry {
  readonly label: string;
  readonly color: number;
  /** Deaktivierte Eintraege bleiben sichtbar, reagieren aber nicht auf Klicks. */
  readonly enabled?: boolean;
  readonly onPick: () => void;
  /** Haelt das Menue offen, z.B. wenn ein Eintrag erst noch eine Bestaetigung verlangt. */
  readonly keepOpen?: boolean;
}

export interface UiContextMenuOptions {
  /** Klickpunkt im Designraum; das Menue klappt von hier nach unten rechts auf. */
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly titleColor: number;
  readonly entries: readonly UiContextMenuEntry[];
  readonly onClose?: () => void;
}

const PADDING = 10;
const TITLE_H = 22;
const ROW_W = 210;
const ROW_H = 32;
const ROW_GAP = 4;

export class UiContextMenu {
  private container: Phaser.GameObjects.Container | null = null;
  private onClose: (() => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly parent: Phaser.GameObjects.Container,
  ) {}

  isOpen(): boolean {
    return this.container !== null;
  }

  open(options: UiContextMenuOptions): void {
    this.closeSilently();
    if (options.entries.length === 0) return;
    this.onClose = options.onClose ?? null;

    const width = ROW_W + PADDING * 2;
    const height = PADDING * 2 + TITLE_H + options.entries.length * (ROW_H + ROW_GAP) - ROW_GAP;
    const x = Phaser.Math.Clamp(options.x, 12, GAME_WIDTH - width - 12);
    const y = Phaser.Math.Clamp(options.y, 12, GAME_HEIGHT - height - 12);

    // Vollflaechiger Fangschirm: ein Klick daneben schliesst das Menue.
    // Das Menue und der Fangschirm handeln beim Druecken. So kann ein neu geoeffneter Fangschirm
    // nicht das Loslassen desselben Klicks als Schliessklick interpretieren.
    const backdrop = this.scene.add.rectangle(
      GAME_WIDTH / 2 - x, GAME_HEIGHT / 2 - y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.25,
    ).setScrollFactor(0).setInteractive();
    backdrop.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      this.close();
    });

    const background = this.scene.add.image(0, 0, ensureFlatPanelTexture(
      this.scene, `_uicm_panel_${width}x${height}`, width, height, COLORS.GREY_9, COLORS.GOLD_1,
      { radius: 10, fillAlpha: 0.98, strokeAlpha: 0.9 },
    )).setOrigin(0, 0).setScrollFactor(0).setInteractive();
    background.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
    });

    const children: Phaser.GameObjects.GameObject[] = [
      backdrop,
      background,
      this.scene.add.text(PADDING, PADDING, options.title, {
        fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: toCssColor(options.titleColor),
      }).setOrigin(0, 0).setScrollFactor(0),
    ];

    options.entries.forEach((entry, index) => {
      const rowY = PADDING + TITLE_H + index * (ROW_H + ROW_GAP);
      const enabled = entry.enabled !== false;
      const entryColor = enabled ? entry.color : COLORS.GREY_5;
      const row = this.scene.add.rectangle(PADDING, rowY, ROW_W, ROW_H, COLORS.GREY_8, enabled ? 0.9 : 0.55)
        .setOrigin(0, 0)
        .setStrokeStyle(1, entryColor, enabled ? 0.75 : 0.35)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: enabled });
      row.on('pointerover', () => {
        if (enabled) row.setFillStyle(COLORS.GREY_6, 1);
      });
      row.on('pointerout', () => row.setFillStyle(COLORS.GREY_8, enabled ? 0.9 : 0.55));
      row.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event?.stopPropagation();
        if (!enabled) return;
        // Erst schliessen, dann handeln: die Aktion darf das Menue mit neuen Eintraegen
        // sofort wieder oeffnen (Bestaetigungsschritt beim Zerlegen).
        if (!entry.keepOpen) this.close();
        entry.onPick();
      });
      children.push(
        row,
        this.scene.add.text(PADDING + 12, rowY + ROW_H / 2, entry.label, {
          fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: toCssColor(entryColor),
        }).setOrigin(0, 0.5).setScrollFactor(0),
      );
    });

    this.container = this.scene.add.container(x, y, children).setScrollFactor(0);
    this.parent.add(this.container);
  }

  /** Schliesst das Menue und meldet das dem Aufrufer (z.B. um eine Hervorhebung zuruecknehmen). */
  close(): void {
    const notify = this.onClose;
    this.closeSilently();
    notify?.();
  }

  private closeSilently(): void {
    this.container?.destroy(true);
    this.container = null;
    this.onClose = null;
  }

  destroy(): void {
    this.closeSilently();
  }
}
