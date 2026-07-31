import * as Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';

/** Ein waehlbarer Eintrag im Auswahl-Popup. */
export interface LoadoutPickerEntry {
  readonly key: string;
  readonly displayName: string;
  readonly textureKey: string | null;
  readonly accentColor: number;
  /** Liegt bereits in genau diesem Slot. */
  readonly selected: boolean;
  /** Liegt in einem anderen Slot derselben Gruppe und ist deshalb hier nicht waehlbar. */
  readonly disabled: boolean;
  readonly onPick: () => void;
}

/** Benannter Abschnitt im Popup (z.B. "Utility 1" / "Utility 2" beim Inspector). */
export interface LoadoutPickerGroup {
  readonly label: string | null;
  readonly entries: readonly LoadoutPickerEntry[];
}

export interface LoadoutPickerOptions {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly title: string;
  readonly groups: readonly LoadoutPickerGroup[];
  /** Optionale "Slot leeren"-Aktion; nur fuer Slots, die leer bleiben duerfen. */
  readonly clearLabel?: string;
  readonly onClear?: () => void;
}

const PADDING = 12;
const TITLE_H = 22;
const GROUP_LABEL_H = 18;
const ENTRY_W = 190;
const ENTRY_H = 32;
const ENTRY_GAP = 4;
const MAX_COLUMNS = 3;
const ICON_SIZE = 22;

/**
 * Auswahl-Popup fuer einen Loadout-Slot. Zeigt ausschliesslich freigeschaltete Items;
 * die Freischaltungslogik bleibt beim Aufrufer.
 */
export class LoadoutSlotPicker {
  private container: Phaser.GameObjects.Container | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly parent: Phaser.GameObjects.Container,
    private readonly depth: number,
  ) {}

  isOpen(): boolean {
    return this.container !== null;
  }

  close(): void {
    this.container?.destroy(true);
    this.container = null;
  }

  open(options: LoadoutPickerOptions): void {
    this.close();

    const groups = options.groups.filter((group) => group.entries.length > 0);
    const totalEntries = groups.reduce((sum, group) => sum + group.entries.length, 0);
    if (totalEntries === 0) return;

    const columns = Math.min(MAX_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(totalEntries))));
    const bodyW = columns * ENTRY_W + (columns - 1) * ENTRY_GAP;
    const width = bodyW + PADDING * 2;

    let cursorY = PADDING + TITLE_H;
    const rows: Array<() => void> = [];
    const children: Phaser.GameObjects.GameObject[] = [];

    for (const group of groups) {
      if (group.label) {
        const labelY = cursorY;
        rows.push(() => children.push(this.scene.add.text(PADDING, labelY, group.label!, {
          fontSize: '12px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_3),
        }).setOrigin(0, 0).setScrollFactor(0)));
        cursorY += GROUP_LABEL_H;
      }
      const groupRows = Math.ceil(group.entries.length / columns);
      for (let index = 0; index < group.entries.length; index += 1) {
        const entry = group.entries[index];
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = PADDING + column * (ENTRY_W + ENTRY_GAP);
        const y = cursorY + row * (ENTRY_H + ENTRY_GAP);
        rows.push(() => this.buildEntry(children, entry, x, y));
      }
      cursorY += groupRows * (ENTRY_H + ENTRY_GAP) + 4;
    }

    if (options.clearLabel && options.onClear) {
      const y = cursorY;
      rows.push(() => this.buildClearRow(children, options.clearLabel!, options.onClear!, PADDING, y, bodyW));
      cursorY += ENTRY_H + ENTRY_GAP;
    }

    const height = cursorY - ENTRY_GAP + PADDING;
    const x = Phaser.Math.Clamp(options.anchorX - width / 2, 12, GAME_WIDTH - width - 12);
    const y = Phaser.Math.Clamp(options.anchorY, 12, GAME_HEIGHT - height - 12);

    // Vollflaechiger Fangschirm: ein Klick daneben schliesst das Popup.
    const backdrop = this.scene.add.rectangle(GAME_WIDTH / 2 - x, GAME_HEIGHT / 2 - y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.35)
      .setScrollFactor(0)
      .setInteractive();
    backdrop.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.close();
    });

    const background = this.scene.add.rectangle(0, 0, width, height, COLORS.GREY_9, 0.98)
      .setOrigin(0, 0)
      .setStrokeStyle(2, COLORS.GOLD_1, 0.9)
      .setScrollFactor(0)
      .setInteractive();
    background.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
    });

    const title = this.scene.add.text(PADDING, PADDING, options.title, {
      fontSize: '15px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_1),
    }).setOrigin(0, 0).setScrollFactor(0);

    for (const build of rows) build();

    this.container = this.scene.add.container(x, y, [backdrop, background, title, ...children])
      .setDepth(this.depth)
      .setScrollFactor(0);
    this.parent.add(this.container);
  }

  private buildEntry(
    children: Phaser.GameObjects.GameObject[],
    entry: LoadoutPickerEntry,
    x: number,
    y: number,
  ): void {
    const fill = entry.selected ? entry.accentColor : COLORS.GREY_8;
    const background = this.scene.add.rectangle(x, y, ENTRY_W, ENTRY_H, fill, entry.selected ? 0.35 : 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(entry.selected ? 2 : 1, entry.selected ? entry.accentColor : COLORS.GREY_5, entry.disabled ? 0.4 : 0.9)
      .setScrollFactor(0)
      .setAlpha(entry.disabled ? 0.45 : 1);
    children.push(background);

    if (entry.textureKey && this.scene.textures.exists(entry.textureKey)) {
      children.push(this.scene.add.image(x + 6 + ICON_SIZE / 2, y + ENTRY_H / 2, entry.textureKey)
        .setDisplaySize(ICON_SIZE, ICON_SIZE)
        .setScrollFactor(0)
        .setAlpha(entry.disabled ? 0.45 : 1));
    }

    const label = this.scene.add.text(x + 12 + ICON_SIZE, y + ENTRY_H / 2, entry.displayName, {
      fontSize: '12px',
      fontFamily: 'monospace',
      fontStyle: entry.selected ? 'bold' : 'normal',
      color: toCssColor(entry.disabled ? COLORS.GREY_4 : COLORS.GREY_1),
      wordWrap: { width: ENTRY_W - ICON_SIZE - 22 },
    }).setOrigin(0, 0.5).setScrollFactor(0);
    children.push(label);

    if (entry.disabled) return;

    background.setInteractive({ useHandCursor: true });
    this.attachRowHover(background, entry.selected ? 0.35 : 0.9);
    background.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      entry.onPick();
      this.close();
    });
  }

  private buildClearRow(
    children: Phaser.GameObjects.GameObject[],
    text: string,
    onClear: () => void,
    x: number,
    y: number,
    width: number,
  ): void {
    const background = this.scene.add.rectangle(x, y, width, ENTRY_H, COLORS.GREY_8, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, COLORS.RED_3, 0.85)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    const label = this.scene.add.text(x + width / 2, y + ENTRY_H / 2, text, {
      fontSize: '12px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.RED_2),
    }).setOrigin(0.5).setScrollFactor(0);
    this.attachRowHover(background, 0.9);
    background.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      onClear();
      this.close();
    });
    children.push(background, label);
  }

  /**
   * Zeilen sind links ausgerichtet; ein Scale-Hover wie bei Buttons wuerde sie verschieben.
   * Deshalb nur die Fuellung aufhellen.
   */
  private attachRowHover(background: Phaser.GameObjects.Rectangle, restFillAlpha: number): void {
    background.on('pointerover', () => background.setFillStyle(background.fillColor, Math.min(1, restFillAlpha + 0.25)));
    background.on('pointerout', () => background.setFillStyle(background.fillColor, restFillAlpha));
  }
}
