import * as Phaser from 'phaser';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { WebGLRectMaskTexture } from '../utils/webglRectMask';
import { attachHoverEffect } from './uiHover';
import { ensureFlatPanelTexture, ensureModalPanelTexture } from './uiTextures';
import { BORDER, FONT_MONO, SURFACE, textStyle } from './uiTheme';
import type { RoomPlayerStatistics } from '../network/RoomStatistics';
import { formatRoomStatValue, formatRoomWinRate, sortRoomStatistics } from './RoomStatisticsModel';
import { getLocale, t } from '../i18n';

const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;
const PANEL_W = 1820;
const PANEL_H = 1000;
const PANEL_TOP = CY - PANEL_H / 2;
const PANEL_LEFT = CX - PANEL_W / 2;
const CONTENT_LEFT = PANEL_LEFT + 30;

const TABLE_TOP = PANEL_TOP + 148;
const TABLE_GROUP_H = 30;
const TABLE_HEADER_H = 50;
const TABLE_HEADER_TOTAL_H = TABLE_GROUP_H + TABLE_HEADER_H;
const TABLE_LEFT = CONTENT_LEFT;
const TABLE_BOTTOM = PANEL_TOP + PANEL_H - 102;
const VIEWPORT_TOP = TABLE_TOP + TABLE_HEADER_TOTAL_H;
const MAX_VIEWPORT_H = TABLE_BOTTOM - VIEWPORT_TOP;
const TABLE_ROW_H = 48;
const TABLE_W = 1694;
const SCROLLBAR_X = TABLE_LEFT + TABLE_W + 16;
const SCROLLBAR_W = 10;

const CLOSE_W = 250;
const CLOSE_H = 52;
const CLOSE_Y = PANEL_TOP + PANEL_H - 40;

const TEX_PANEL = '_rso_panel';
const TEX_TABLE = '_rso_table';
const TEX_CLOSE = '_rso_close';

type RoomTableColumnKey =
  | 'name'
  | 'damageDealt'
  | 'damageTaken'
  | 'pvpKills'
  | 'pveKills'
  | 'pvpDeaths'
  | 'pveDeaths'
  | 'pvpWins'
  | 'pvpMatchesPlayed'
  | 'winRate'
  | 'healingReceived'
  | 'armorReceived'
  | 'powerUpsCollected'
  | 'utilitiesUsed'
  | 'constructionsBuilt'
  | 'ultimatesUsed';

interface RoomTableColumn {
  readonly key: RoomTableColumnKey;
  readonly labelKey: string;
  readonly width: number;
}

interface RoomTableGroup {
  readonly labelKey: string;
  readonly start: number;
  readonly count: number;
}

const TABLE_COLUMNS: readonly RoomTableColumn[] = [
  { key: 'name', labelKey: 'ui.roomStats.player', width: 245 },
  { key: 'damageDealt', labelKey: 'ui.roomStats.damage', width: 105 },
  { key: 'damageTaken', labelKey: 'ui.roomStats.taken', width: 105 },
  { key: 'pvpKills', labelKey: 'ui.roomStats.pvpKills', width: 92 },
  { key: 'pvpDeaths', labelKey: 'ui.roomStats.pvpDeaths', width: 92 },
  { key: 'pvpMatchesPlayed', labelKey: 'ui.roomStats.matches', width: 92 },
  { key: 'pvpWins', labelKey: 'ui.roomStats.wins', width: 80 },
  { key: 'winRate', labelKey: 'ui.roomStats.winRate', width: 98 },
  { key: 'pveKills', labelKey: 'ui.roomStats.pveKills', width: 92 },
  { key: 'pveDeaths', labelKey: 'ui.roomStats.pveDeaths', width: 92 },
  { key: 'healingReceived', labelKey: 'ui.roomStats.healing', width: 100 },
  { key: 'armorReceived', labelKey: 'ui.roomStats.armor', width: 100 },
  { key: 'powerUpsCollected', labelKey: 'ui.roomStats.powerUps', width: 108 },
  { key: 'utilitiesUsed', labelKey: 'ui.roomStats.utilities', width: 100 },
  { key: 'constructionsBuilt', labelKey: 'ui.roomStats.builds', width: 88 },
  { key: 'ultimatesUsed', labelKey: 'ui.roomStats.ultimates', width: 105 },
];

const TABLE_GROUPS: readonly RoomTableGroup[] = [
  { labelKey: 'ui.roomStats.player', start: 0, count: 1 },
  { labelKey: 'ui.roomStats.combat', start: 1, count: 2 },
  { labelKey: 'ui.roomStats.pvp', start: 3, count: 5 },
  { labelKey: 'ui.roomStats.pve', start: 8, count: 2 },
  { labelKey: 'ui.roomStats.other', start: 10, count: 6 },
];

/** Eigenständige, kumulierte Raumansicht; RoundResult bleibt ausschließlich Rundenmodell. */
export class RoomStatisticsOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private content: Phaser.GameObjects.Container | null = null;
  private tableBackground: Phaser.GameObjects.Image | null = null;
  private tableMask: WebGLRectMaskTexture | null = null;
  private scrollInput: Phaser.GameObjects.Rectangle | null = null;
  private scrollTrack: Phaser.GameObjects.Rectangle | null = null;
  private scrollThumb: Phaser.GameObjects.Rectangle | null = null;
  private maxScrollOffset = 0;
  private scrollOffset = 0;
  private draggingThumb = false;
  private dragPointerStartY = 0;
  private dragScrollStart = 0;
  private viewportHeight = MAX_VIEWPORT_H;
  private pointerMoveHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
  private pointerUpHandler: (() => void) | null = null;
  private visible = false;
  private lastStatistics: readonly RoomPlayerStatistics[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  build(): void {
    this.destroy();

    const backdrop = this.scene.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, COLORS.GREY_10, 0.9)
      .setScrollFactor(0)
      .setInteractive();
    const panel = this.scene.add.image(
      CX,
      CY,
      ensureModalPanelTexture(this.scene, TEX_PANEL, PANEL_W, PANEL_H, SURFACE.modal, BORDER.default),
    ).setScrollFactor(0).setInteractive();
    const title = this.scene.add.text(CX, PANEL_TOP + 43, t('ui.results.roomStats'), textStyle('title', {
      color: COLORS.GREY_1,
      align: 'center',
    })).setOrigin(0.5).setScrollFactor(0);
    const subtitle = this.scene.add.text(CX, PANEL_TOP + 83, t('ui.roomStats.subtitle'), textStyle('caption', {
      color: COLORS.GREY_4,
      align: 'center',
    })).setOrigin(0.5).setScrollFactor(0);

    this.tableBackground = this.scene.add.image(
      TABLE_LEFT + TABLE_W / 2,
      TABLE_TOP + (TABLE_HEADER_TOTAL_H + MAX_VIEWPORT_H) / 2,
      ensureFlatPanelTexture(this.scene, TEX_TABLE, TABLE_W, TABLE_HEADER_TOTAL_H + MAX_VIEWPORT_H, COLORS.GREY_9, COLORS.GREY_6, {
        radius: 10,
        fillAlpha: 0.94,
        strokeAlpha: 0.82,
      }),
    ).setScrollFactor(0);
    const tableHeader = this.buildTableHeader();

    this.content = this.scene.add.container(0, 0).setScrollFactor(0);
    this.tableMask = new WebGLRectMaskTexture(this.scene, '__room_statistics_table_mask', GAME_WIDTH, GAME_HEIGHT);
    this.tableMask.update({ x: TABLE_LEFT, y: VIEWPORT_TOP, width: TABLE_W, height: MAX_VIEWPORT_H });
    this.tableMask.attachToGameObject(this.content);

    this.scrollTrack = this.scene.add.rectangle(SCROLLBAR_X, VIEWPORT_TOP + MAX_VIEWPORT_H / 2, SCROLLBAR_W, MAX_VIEWPORT_H, COLORS.GREY_8, 0.9)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(1, COLORS.GREY_6, 0.8);
    this.scrollThumb = this.scene.add.rectangle(SCROLLBAR_X, VIEWPORT_TOP, SCROLLBAR_W + 2, MAX_VIEWPORT_H, COLORS.GREY_4, 0.95)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);
    this.scrollInput = this.scene.add.rectangle(
      TABLE_LEFT + TABLE_W / 2,
      VIEWPORT_TOP + MAX_VIEWPORT_H / 2,
      TABLE_W,
      MAX_VIEWPORT_H,
      COLORS.GREY_1,
      0.001,
    ).setScrollFactor(0).setInteractive();
    this.scrollInput.on('pointerdown', (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => event.stopPropagation());

    this.scrollTrack.on('pointerdown', (
      pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => {
      event.stopPropagation();
      this.setScrollOffsetFromPointer(pointer.y);
    });
    this.scrollThumb.on('pointerdown', (
      pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => {
      event.stopPropagation();
      this.draggingThumb = true;
      this.dragPointerStartY = pointer.y;
      this.dragScrollStart = this.scrollOffset;
    });
    this.scrollInput.on('wheel', (
      _pointer: Phaser.Input.Pointer,
      _deltaX: number,
      deltaY: number,
    ) => this.setScrollOffset(this.scrollOffset + deltaY));
    this.pointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
      if (!this.draggingThumb) return;
      const thumbTravel = Math.max(1, this.viewportHeight - (this.scrollThumb?.height ?? this.viewportHeight));
      const ratio = (pointer.y - this.dragPointerStartY) / thumbTravel;
      this.setScrollOffset(this.dragScrollStart + ratio * this.maxScrollOffset);
    };
    this.pointerUpHandler = () => {
      this.draggingThumb = false;
    };
    this.scene.input.on('pointermove', this.pointerMoveHandler);
    this.scene.input.on('pointerup', this.pointerUpHandler);

    const closeButton = this.scene.add.image(
      CX,
      CLOSE_Y,
      ensureFlatPanelTexture(this.scene, TEX_CLOSE, CLOSE_W, CLOSE_H, COLORS.GREY_7, COLORS.GREY_4, {
        radius: 8,
        fillAlpha: 0.95,
        strokeAlpha: 0.8,
      }),
    ).setScrollFactor(0).setInteractive({ useHandCursor: true });
    const closeLabel = this.scene.add.text(CX, CLOSE_Y, t('ui.common.close').toUpperCase(), textStyle('label', {
      color: COLORS.GREY_1,
      align: 'center',
    })).setOrigin(0.5).setScrollFactor(0);
    closeButton.on('pointerdown', () => this.hide());
    attachHoverEffect(this.scene, closeButton, closeLabel);

    backdrop.on('pointerdown', () => this.hide());
    panel.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
    });

    this.container = this.scene.add.container(0, 0, [
      backdrop,
      panel,
      title,
      subtitle,
      this.tableBackground,
      tableHeader,
      this.content,
      this.scrollInput,
      this.scrollTrack,
      this.scrollThumb,
      closeButton,
      closeLabel,
    ])
      .setDepth(DEPTH.OVERLAY + 5)
      .setVisible(false);
    promoteToClarityCamera(this.scene, this.container);
  }

  show(statistics: readonly RoomPlayerStatistics[]): void {
    this.lastStatistics = statistics;
    if (!this.container || !this.content) this.build();
    if (!this.container || !this.content) return;

    this.content.removeAll(true);
    const entries = sortRoomStatistics(statistics);
    this.maxScrollOffset = 0;
    this.setScrollOffset(0);
    this.setViewportHeight(entries.length * TABLE_ROW_H);
    entries.forEach((entry, index) => this.content?.add(this.buildTableRow(entry, index)));
    if (entries.length === 0) {
      this.content.add(this.scene.add.text(
        TABLE_LEFT + TABLE_W / 2,
        VIEWPORT_TOP + this.viewportHeight / 2,
        t('ui.roomStats.empty'),
        textStyle('caption', { color: COLORS.GREY_4, align: 'center' }),
      ).setOrigin(0.5).setScrollFactor(0));
    }
    this.updateScrollbar(entries.length * TABLE_ROW_H);
    this.visible = true;
    this.container.setVisible(true);
  }

  hide(): void {
    this.visible = false;
    this.draggingThumb = false;
    this.container?.setVisible(false);
  }

  isVisible(): boolean {
    return this.visible;
  }

  refreshLocale(): void {
    const wasVisible = this.visible;
    this.build();
    if (wasVisible) this.show(this.lastStatistics);
  }

  destroy(): void {
    this.visible = false;
    this.draggingThumb = false;
    if (this.pointerMoveHandler) {
      this.scene.input.off('pointermove', this.pointerMoveHandler);
      this.pointerMoveHandler = null;
    }
    if (this.pointerUpHandler) {
      this.scene.input.off('pointerup', this.pointerUpHandler);
      this.pointerUpHandler = null;
    }
    this.tableMask?.destroy();
    this.tableMask = null;
    this.container?.destroy(true);
    this.container = null;
    this.content = null;
    this.tableBackground = null;
    this.scrollInput = null;
    this.scrollTrack = null;
    this.scrollThumb = null;
    this.maxScrollOffset = 0;
    this.scrollOffset = 0;
    this.viewportHeight = MAX_VIEWPORT_H;
  }

  private buildTableHeader(): Phaser.GameObjects.Container {
    const header = this.scene.add.container(0, 0).setScrollFactor(0);
    for (const group of TABLE_GROUPS) {
      const left = this.columnLeft(group.start);
      const width = this.columnWidth(group.start, group.count);
      header.add(this.scene.add.rectangle(
        left + width / 2,
        TABLE_TOP + TABLE_GROUP_H / 2,
        width,
        TABLE_GROUP_H,
        COLORS.GREY_8,
        0.95,
      ).setOrigin(0.5).setStrokeStyle(1, COLORS.GREY_6, 0.72).setScrollFactor(0));
      header.add(this.scene.add.text(
        left + width / 2,
        TABLE_TOP + TABLE_GROUP_H / 2,
        t(group.labelKey),
        textStyle('caption', {
          color: group.labelKey === 'ui.roomStats.pvp' ? COLORS.GOLD_1 : COLORS.GREY_3,
          align: 'center',
        }),
      ).setOrigin(0.5).setScrollFactor(0));
    }

    let left = TABLE_LEFT;
    for (const column of TABLE_COLUMNS) {
      header.add(this.scene.add.rectangle(
        left + column.width / 2,
        TABLE_TOP + TABLE_GROUP_H + TABLE_HEADER_H / 2,
        column.width,
        TABLE_HEADER_H,
        COLORS.GREY_9,
        0.98,
      ).setOrigin(0.5).setStrokeStyle(1, COLORS.GREY_7, 0.65).setScrollFactor(0));
      header.add(this.scene.add.text(
        left + column.width / 2,
        TABLE_TOP + TABLE_GROUP_H + TABLE_HEADER_H / 2,
        t(column.labelKey),
        {
          fontFamily: FONT_MONO,
          fontSize: '11px',
          fontStyle: 'bold',
          color: toCssColor(COLORS.GREY_3),
          align: 'center',
        },
      ).setOrigin(0.5).setScrollFactor(0));
      left += column.width;
    }
    return header;
  }

  private buildTableRow(entry: RoomPlayerStatistics, index: number): Phaser.GameObjects.Container {
    const row = this.scene.add.container(0, VIEWPORT_TOP + index * TABLE_ROW_H).setScrollFactor(0);
    const rowColor = index % 2 === 0 ? COLORS.GREY_8 : COLORS.GREY_9;

    let left = TABLE_LEFT;
    for (const column of TABLE_COLUMNS) {
      const isName = column.key === 'name';
      const label = this.getColumnValue(entry, column.key);
      row.add(this.scene.add.rectangle(
        left + column.width / 2,
        TABLE_ROW_H / 2,
        column.width - 1,
        TABLE_ROW_H - 1,
        rowColor,
        0.82,
      ).setOrigin(0.5).setStrokeStyle(1, COLORS.GREY_7, 0.42).setScrollFactor(0));
      const cell = this.scene.add.text(
        isName ? left + 16 : left + column.width / 2,
        TABLE_ROW_H / 2,
        label,
        {
          fontFamily: FONT_MONO,
          fontSize: isName ? '14px' : '13px',
          fontStyle: isName ? 'bold' : 'normal',
          color: isName ? toCssColor(entry.colorHex) : toCssColor(COLORS.GREY_2),
          align: isName ? 'left' : 'center',
          fixedWidth: isName ? column.width - 26 : 0,
        },
      ).setOrigin(isName ? 0 : 0.5, 0.5).setScrollFactor(0);
      row.add(cell);
      left += column.width;
    }
    return row;
  }

  private getColumnValue(entry: RoomPlayerStatistics, key: RoomTableColumnKey): string {
    switch (key) {
      case 'name': return entry.name;
      case 'damageDealt': return formatRoomStatValue(entry.damageDealt, getLocale());
      case 'damageTaken': return formatRoomStatValue(entry.damageTaken, getLocale());
      case 'pvpKills': return String(entry.pvpKills);
      case 'pveKills': return String(entry.pveKills);
      case 'pvpDeaths': return String(entry.pvpDeaths);
      case 'pveDeaths': return String(entry.pveDeaths);
      case 'pvpWins': return String(entry.pvpWins);
      case 'pvpMatchesPlayed': return String(entry.pvpMatchesPlayed);
      case 'winRate': return formatRoomWinRate(entry, getLocale());
      case 'healingReceived': return formatRoomStatValue(entry.healingReceived, getLocale());
      case 'armorReceived': return formatRoomStatValue(entry.armorReceived, getLocale());
      case 'powerUpsCollected': return String(entry.powerUpsCollected);
      case 'utilitiesUsed': return String(entry.utilitiesUsed);
      case 'constructionsBuilt': return String(entry.constructionsBuilt);
      case 'ultimatesUsed': return String(entry.ultimatesUsed);
    }
  }

  private columnLeft(start: number): number {
    return TABLE_LEFT + TABLE_COLUMNS.slice(0, start).reduce((sum, column) => sum + column.width, 0);
  }

  private columnWidth(start: number, count: number): number {
    return TABLE_COLUMNS.slice(start, start + count).reduce((sum, column) => sum + column.width, 0);
  }

  private setViewportHeight(contentHeight: number): void {
    this.viewportHeight = Math.min(MAX_VIEWPORT_H, Math.max(TABLE_ROW_H, contentHeight));
    const tableHeight = TABLE_HEADER_TOTAL_H + this.viewportHeight;
    this.tableBackground
      ?.setDisplaySize(TABLE_W, tableHeight)
      .setPosition(TABLE_LEFT + TABLE_W / 2, TABLE_TOP + tableHeight / 2);
    this.tableMask?.update({ x: TABLE_LEFT, y: VIEWPORT_TOP, width: TABLE_W, height: this.viewportHeight });
    this.scrollTrack
      ?.setPosition(SCROLLBAR_X, VIEWPORT_TOP + this.viewportHeight / 2)
      .setSize(SCROLLBAR_W, this.viewportHeight);
    this.scrollInput
      ?.setPosition(TABLE_LEFT + TABLE_W / 2, VIEWPORT_TOP + this.viewportHeight / 2)
      .setSize(TABLE_W, this.viewportHeight);
  }

  private updateScrollbar(contentHeight: number): void {
    this.maxScrollOffset = Math.max(0, contentHeight - this.viewportHeight);
    this.setScrollOffset(this.scrollOffset);
    if (!this.scrollTrack || !this.scrollThumb) return;
    const overflowing = this.maxScrollOffset > 0;
    this.scrollTrack.setVisible(overflowing);
    this.scrollThumb.setVisible(overflowing);
    if (!overflowing) return;

    const thumbHeight = Math.max(44, this.viewportHeight * this.viewportHeight / contentHeight);
    this.scrollThumb.setSize(SCROLLBAR_W + 2, thumbHeight);
    this.updateScrollbarThumb();
  }

  private setScrollOffset(value: number): void {
    this.scrollOffset = Phaser.Math.Clamp(value, 0, this.maxScrollOffset);
    if (this.content) this.content.y = -this.scrollOffset;
    this.updateScrollbarThumb();
  }

  private setScrollOffsetFromPointer(pointerY: number): void {
    if (this.maxScrollOffset <= 0) return;
    const ratio = Phaser.Math.Clamp((pointerY - VIEWPORT_TOP) / this.viewportHeight, 0, 1);
    this.setScrollOffset(ratio * this.maxScrollOffset);
  }

  private updateScrollbarThumb(): void {
    if (!this.scrollThumb || this.maxScrollOffset <= 0) return;
    const thumbTravel = Math.max(0, this.viewportHeight - this.scrollThumb.height);
    const ratio = this.maxScrollOffset > 0 ? this.scrollOffset / this.maxScrollOffset : 0;
    this.scrollThumb.y = VIEWPORT_TOP + this.scrollThumb.height / 2 + thumbTravel * ratio;
  }
}
