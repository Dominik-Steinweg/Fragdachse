import * as Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import { ensureFlatPanelTexture, lerpColor } from './uiTextures';
import { BORDER, RADIUS, SPACE, SURFACE, TEXT, textStyle } from './uiTheme';

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

export interface LoadoutPickerSafeArea {
  /** Linke bzw. obere Kante im Designraum. */
  readonly left: number;
  readonly top: number;
  /** Rechte bzw. untere Aussenkante im Designraum. */
  readonly right: number;
  readonly bottom: number;
}

export interface LoadoutPickerOptions {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly title: string;
  readonly groups: readonly LoadoutPickerGroup[];
  /** Ueberschreibt die gemeinsame Spaltenobergrenze fuer spezielle Einbettungen. */
  readonly maxColumns?: number;
  /** Optionale sichere Overlay-Zone; das Popup bleibt mit seiner ganzen Flaeche darin. */
  readonly safeArea?: LoadoutPickerSafeArea;
  /** Optionale "Slot leeren"-Aktion; nur fuer Slots, die leer bleiben duerfen. */
  readonly clearLabel?: string;
  readonly onClear?: () => void;
}

const PADDING = SPACE.md;
const TITLE_H = 22;
const GROUP_LABEL_H = 18;
const ENTRY_W = 190;
const ENTRY_H = 32;
const ENTRY_GAP = SPACE.xs;
const DEFAULT_MAX_COLUMNS = 3;
const SCREEN_MARGIN = 12;
const ICON_SIZE = 22;

interface RowVisualState {
  readonly fillColor: number;
  readonly fillAlpha: number;
  readonly strokeColor: number;
  readonly strokeWidth: number;
  readonly strokeAlpha: number;
  readonly labelColor?: number;
}

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

    const maxColumns = Math.max(1, Math.floor(options.maxColumns ?? DEFAULT_MAX_COLUMNS));
    const columns = Math.min(maxColumns, Math.max(1, Math.ceil(Math.sqrt(totalEntries))));
    const bodyW = columns * ENTRY_W + (columns - 1) * ENTRY_GAP;
    const width = bodyW + PADDING * 2;

    let cursorY = PADDING + TITLE_H;
    const rows: Array<() => void> = [];
    const children: Phaser.GameObjects.GameObject[] = [];

    for (const group of groups) {
      if (group.label) {
        const labelY = cursorY;
        rows.push(() => children.push(this.scene.add.text(PADDING, labelY, group.label!, textStyle('section', {
          color: TEXT.muted,
        })).setOrigin(0, 0).setScrollFactor(0)));
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
    const safeArea = options.safeArea ?? {
      left: SCREEN_MARGIN,
      top: SCREEN_MARGIN,
      right: GAME_WIDTH - SCREEN_MARGIN,
      bottom: GAME_HEIGHT - SCREEN_MARGIN,
    };
    const x = Phaser.Math.Clamp(
      options.anchorX - width / 2,
      safeArea.left,
      Math.max(safeArea.left, safeArea.right - width),
    );
    const y = Phaser.Math.Clamp(
      options.anchorY,
      safeArea.top,
      Math.max(safeArea.top, safeArea.bottom - height),
    );

    // Vollflaechiger Fangschirm: ein Klick daneben schliesst das Popup.
    const backdrop = this.scene.add.rectangle(GAME_WIDTH / 2 - x, GAME_HEIGHT / 2 - y, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.35)
      .setScrollFactor(0)
      .setInteractive();
    backdrop.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.close();
    });

    const background = this.scene.add.image(0, 0, ensureFlatPanelTexture(
      this.scene, `_loadout_picker_${width}x${height}`, width, height, SURFACE.modal, BORDER.subtle,
      { radius: RADIUS.lg, fillAlpha: 0.98, strokeAlpha: 0.9 },
    ))
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setInteractive();
    background.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
    });

    const title = this.scene.add.text(PADDING, PADDING, options.title, textStyle('label', {
      color: TEXT.primary,
    })).setOrigin(0, 0).setScrollFactor(0);

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
    const restState: RowVisualState = {
      fillColor: entry.selected ? entry.accentColor : COLORS.GREY_8,
      fillAlpha: entry.selected ? 0.35 : 0.9,
      strokeColor: entry.selected ? entry.accentColor : COLORS.GREY_5,
      strokeWidth: entry.selected ? 2 : 1,
      strokeAlpha: entry.disabled ? 0.4 : 0.9,
      labelColor: entry.disabled ? COLORS.GREY_4 : COLORS.GREY_1,
    };
    const hoverState: RowVisualState = {
      // Selected rows keep their saturated fill; active, unselected rows only get
      // a restrained accent tint so hover stays visibly below selection.
      fillColor: entry.selected ? entry.accentColor : lerpColor(COLORS.GREY_8, entry.accentColor, 0.1),
      fillAlpha: entry.selected ? 0.6 : 0.92,
      strokeColor: entry.accentColor,
      strokeWidth: entry.selected ? 2 : 1,
      strokeAlpha: entry.selected ? 0.9 : 0.78,
      labelColor: entry.selected ? COLORS.GREY_1 : lerpColor(COLORS.GREY_1, 0xffffff, 0.08),
    };
    const background = this.scene.add.rectangle(x, y, ENTRY_W, ENTRY_H, restState.fillColor, restState.fillAlpha)
      .setOrigin(0, 0)
      .setStrokeStyle(restState.strokeWidth, restState.strokeColor, restState.strokeAlpha)
      .setScrollFactor(0)
      .setAlpha(entry.disabled ? 0.45 : 1);
    children.push(background);

    if (entry.textureKey && this.scene.textures.exists(entry.textureKey)) {
      children.push(this.scene.add.image(x + 6 + ICON_SIZE / 2, y + ENTRY_H / 2, entry.textureKey)
        .setDisplaySize(ICON_SIZE, ICON_SIZE)
        .setScrollFactor(0)
        .setAlpha(entry.disabled ? 0.45 : 1));
    }

    const label = this.scene.add.text(x + SPACE.md + ICON_SIZE, y + ENTRY_H / 2, entry.displayName, textStyle(
      entry.selected ? 'labelSm' : 'caption',
      { color: restState.labelColor!, wordWrapWidth: ENTRY_W - ICON_SIZE - SPACE.md - SPACE.sm },
    )).setOrigin(0, 0.5).setScrollFactor(0);
    children.push(label);

    if (entry.disabled) return;

    background.setInteractive({ useHandCursor: true });
    this.attachRowHover(background, restState, hoverState, label);
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
    const label = this.scene.add.text(x + width / 2, y + ENTRY_H / 2, text, textStyle('labelSm', {
      color: COLORS.RED_2,
    })).setOrigin(0.5).setScrollFactor(0);
    this.attachRowHover(background, {
      fillColor: COLORS.GREY_8,
      fillAlpha: 0.9,
      strokeColor: COLORS.RED_3,
      strokeWidth: 1,
      strokeAlpha: 0.85,
    }, {
      fillColor: COLORS.GREY_8,
      fillAlpha: 1,
      strokeColor: COLORS.RED_3,
      strokeWidth: 1,
      strokeAlpha: 0.85,
    });
    background.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      onClear();
      this.close();
    });
    children.push(background, label);
  }

  /** Zeilen bleiben layout-stabil; Hover aendert nur die visuellen Zustandswerte. */
  private attachRowHover(
    background: Phaser.GameObjects.Rectangle,
    restState: RowVisualState,
    hoverState: RowVisualState,
    label?: Phaser.GameObjects.Text,
  ): void {
    background.on('pointerover', () => {
      background
        .setFillStyle(hoverState.fillColor, hoverState.fillAlpha)
        .setStrokeStyle(hoverState.strokeWidth, hoverState.strokeColor, hoverState.strokeAlpha);
      if (label && hoverState.labelColor !== undefined) label.setColor(toCssColor(hoverState.labelColor));
    });
    background.on('pointerout', () => {
      background
        .setFillStyle(restState.fillColor, restState.fillAlpha)
        .setStrokeStyle(restState.strokeWidth, restState.strokeColor, restState.strokeAlpha);
      if (label && restState.labelColor !== undefined) label.setColor(toCssColor(restState.labelColor));
    });
  }
}
