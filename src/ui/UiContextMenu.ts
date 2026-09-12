import * as Phaser from 'phaser';
import { FOREST, skinTextColor, type UiSkin } from './UiSkin';
import { ensureForestPanel } from './forestTextures';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { ensureFlatPanelTexture } from './uiTextures';
import { BORDER, RADIUS, SPACE, SURFACE, TEXT, textStyle } from './uiTheme';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';

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
  /** Optional explanatory text above the actions, e.g. room connection diagnostics. */
  readonly description?: string;
  readonly entries: readonly UiContextMenuEntry[];
  readonly onClose?: () => void;
}

const PADDING = SPACE.md;
const TITLE_H = 22;
const ROW_W = 210;
const ROW_H = 32;
const ROW_GAP = SPACE.xs;

export class UiContextMenu {
  private container: Phaser.GameObjects.Container | null = null;
  private onClose: (() => void) | null = null;
  private readonly parentDestroyed = (): void => this.closeSilently();
  private readonly escape = (event: KeyboardEvent): void => {
    event.stopImmediatePropagation();
    this.close();
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly parent: Phaser.GameObjects.Container,
    private readonly standaloneDepth?: number,
    private readonly skin: UiSkin = 'default',
  ) {}

  isOpen(): boolean {
    return this.container !== null;
  }

  open(options: UiContextMenuOptions): void {
    this.closeSilently();
    if (options.entries.length === 0) return;
    this.onClose = options.onClose ?? null;

    const width = ROW_W + PADDING * 2;
    const description = options.description
      ? this.scene.add.text(PADDING, PADDING + TITLE_H, options.description,
        textStyle('caption', { color: skinTextColor(this.skin, TEXT.primary), wordWrapWidth: ROW_W })).setOrigin(0, 0).setScrollFactor(0)
      : null;
    const descriptionH = description ? description.height + SPACE.md : 0;
    const height = PADDING * 2 + TITLE_H + descriptionH + options.entries.length * (ROW_H + ROW_GAP) - ROW_GAP;
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

    const background = this.scene.add.image(0, 0, this.skin === 'forest' ? ensureForestPanel(this.scene, width, height) : ensureFlatPanelTexture(
      this.scene, `_uicm_panel_${width}x${height}`, width, height, SURFACE.modal, BORDER.subtle,
      { radius: RADIUS.md, fillAlpha: 0.98, strokeAlpha: 0.9 },
    )).setOrigin(0, 0).setScrollFactor(0).setInteractive();
    background.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
    });

    const children: Phaser.GameObjects.GameObject[] = [
      backdrop,
      background,
      this.scene.add.text(PADDING, PADDING, options.title, textStyle('section', {
        color: skinTextColor(this.skin, options.titleColor ?? TEXT.primary),
      })).setOrigin(0, 0).setScrollFactor(0),
    ];

    if (description) children.push(description);
    options.entries.forEach((entry, index) => {
      const rowY = PADDING + TITLE_H + descriptionH + index * (ROW_H + ROW_GAP);
      const enabled = entry.enabled !== false;
      const entryColor = skinTextColor(this.skin, enabled ? entry.color : COLORS.GREY_5);
      const fill = this.skin === 'forest' ? FOREST.sunken : SURFACE.raised;
      const row = this.scene.add.rectangle(PADDING, rowY, ROW_W, ROW_H, fill, enabled ? 0.9 : 0.55)
        .setOrigin(0, 0)
        .setStrokeStyle(1, entryColor, enabled ? 0.75 : 0.35)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: enabled });
      row.on('pointerover', () => {
        if (enabled) row.setFillStyle(this.skin === 'forest' ? FOREST.raised : COLORS.GREY_6, 1);
      });
      row.on('pointerout', () => row.setFillStyle(fill, enabled ? 0.9 : 0.55));
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
        this.scene.add.text(PADDING + SPACE.md, rowY + ROW_H / 2, entry.label, textStyle('labelSm', {
          color: entryColor,
        })).setOrigin(0, 0.5).setScrollFactor(0),
      );
    });

    this.container = this.scene.add.container(x, y, children).setScrollFactor(0);
    if (this.standaloneDepth !== undefined) {
      this.container.setDepth(this.standaloneDepth);
      promoteToClarityCamera(this.scene, this.container);
      this.parent.once('destroy', this.parentDestroyed);
    } else {
      this.parent.add(this.container);
    }
    this.scene.input.keyboard?.on('keydown-ESC', this.escape);
  }

  /** Schliesst das Menue und meldet das dem Aufrufer (z.B. um eine Hervorhebung zuruecknehmen). */
  close(): void {
    const notify = this.onClose;
    this.closeSilently();
    notify?.();
  }

  private closeSilently(): void {
    this.scene.input.keyboard?.off('keydown-ESC', this.escape);
    this.parent.off('destroy', this.parentDestroyed);
    this.container?.destroy(true);
    this.container = null;
    this.onClose = null;
  }

  destroy(): void {
    this.closeSilently();
  }
}
