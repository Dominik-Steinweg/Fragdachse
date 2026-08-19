import * as Phaser from 'phaser';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { attachHoverEffect } from './uiHover';
import { ensureFlatPanelTexture, ensureModalPanelTexture, roundRectPath } from './uiTextures';
import { rgbStr } from './LivingBarEffect';
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

const CLOSE_W = 250;
const CLOSE_H = 52;
const CLOSE_Y = PANEL_TOP + PANEL_H - 40;

const TEX_PANEL = '_rso_panel';
const TEX_TABLE = '_rso_table_unified';
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

/** Erzeugt eine geschlossene, einheitlich abgerundete Tabellen-Grundfläche mit Header-Bändern und Trennlinien. */
function ensureRoomTableTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(TEX_TABLE)) return TEX_TABLE;

  const w = TABLE_W;
  const h = TABLE_HEADER_TOTAL_H + MAX_VIEWPORT_H;
  const ct = scene.textures.createCanvas(TEX_TABLE, w, h);
  if (!ct) return TEX_TABLE;
  const ctx = ct.context;
  ctx.clearRect(0, 0, w, h);

  const radius = 10;
  const strokeWidth = 1.5;
  const inset = strokeWidth;
  const rectW = w - inset * 2;
  const rectH = h - inset * 2;

  // 1. Gesamte Fläche in abgerundetes Panel clippen (damit auch der Header oben sauber rund abschließt)
  ctx.save();
  roundRectPath(ctx, inset, inset, rectW, rectH, radius);
  ctx.clip();

  // 2. Grundfläche der Tabelle
  ctx.fillStyle = rgbStr(COLORS.GREY_9, 0.94);
  ctx.fillRect(0, 0, w, h);

  // 3. Gruppen-Header-Band (oben)
  ctx.fillStyle = rgbStr(COLORS.GREY_8, 0.95);
  ctx.fillRect(0, 0, w, TABLE_GROUP_H);

  // 4. Spalten-Header-Band (Mitte)
  ctx.fillStyle = rgbStr(COLORS.GREY_9, 0.98);
  ctx.fillRect(0, TABLE_GROUP_H, w, TABLE_HEADER_H);

  // 5. Horizontale Trennlinie zwischen Gruppen- und Spaltenheader
  ctx.fillStyle = rgbStr(COLORS.GREY_7, 0.6);
  ctx.fillRect(0, TABLE_GROUP_H - 1, w, 1);

  // 6. Horizontale Trennlinie unter dem Spaltenheader
  ctx.fillStyle = rgbStr(COLORS.GREY_6, 0.75);
  ctx.fillRect(0, TABLE_HEADER_TOTAL_H - 1, w, 1);

  // 7. Vertikale Gruppentrennlinien im Gruppenheader
  let groupLeft = 0;
  for (let i = 0; i < TABLE_GROUPS.length; i++) {
    const grp = TABLE_GROUPS[i];
    const grpWidth = TABLE_COLUMNS.slice(grp.start, grp.start + grp.count).reduce((sum, c) => sum + c.width, 0);
    if (i > 0) {
      ctx.fillStyle = rgbStr(COLORS.GREY_6, 0.5);
      ctx.fillRect(groupLeft, 0, 1, TABLE_GROUP_H);
    }
    groupLeft += grpWidth;
  }

  // 8. Vertikale Spaltentrennlinien im Spaltenheader
  let colLeft = 0;
  for (let i = 0; i < TABLE_COLUMNS.length; i++) {
    if (i > 0) {
      const isGroupStart = TABLE_GROUPS.some((g) => g.start === i);
      ctx.fillStyle = isGroupStart ? rgbStr(COLORS.GREY_6, 0.5) : rgbStr(COLORS.GREY_7, 0.35);
      ctx.fillRect(colLeft, TABLE_GROUP_H, 1, TABLE_HEADER_H);
    }
    colLeft += TABLE_COLUMNS[i].width;
  }

  ctx.restore();

  // 9. Einheitlicher, zusammenhängender Außenrahmen
  roundRectPath(ctx, inset, inset, rectW, rectH, radius);
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = rgbStr(COLORS.GREY_6, 0.82);
  ctx.stroke();

  ct.refresh();
  return TEX_TABLE;
}

/** Eigenständige, kumulierte Raumansicht; RoundResult bleibt ausschließlich Rundenmodell. */
export class RoomStatisticsOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private content: Phaser.GameObjects.Container | null = null;
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

    const tableBackground = this.scene.add.image(
      TABLE_LEFT + TABLE_W / 2,
      TABLE_TOP + (TABLE_HEADER_TOTAL_H + MAX_VIEWPORT_H) / 2,
      ensureRoomTableTexture(this.scene),
    ).setScrollFactor(0);
    const tableHeader = this.buildTableHeader();

    this.content = this.scene.add.container(0, 0).setScrollFactor(0);

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
      tableBackground,
      tableHeader,
      this.content,
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
    entries.forEach((entry, index) => this.content?.add(this.buildTableRow(entry, index)));
    if (entries.length === 0) {
      this.content.add(this.scene.add.text(
        TABLE_LEFT + TABLE_W / 2,
        VIEWPORT_TOP + MAX_VIEWPORT_H / 2,
        t('ui.roomStats.empty'),
        textStyle('caption', { color: COLORS.GREY_4, align: 'center' }),
      ).setOrigin(0.5).setScrollFactor(0));
    }
    this.visible = true;
    this.container.setVisible(true);
  }

  hide(): void {
    this.visible = false;
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
    this.container?.destroy(true);
    this.container = null;
    this.content = null;
  }

  private buildTableHeader(): Phaser.GameObjects.Container {
    const header = this.scene.add.container(0, 0).setScrollFactor(0);
    for (const group of TABLE_GROUPS) {
      const left = this.columnLeft(group.start);
      const width = this.columnWidth(group.start, group.count);
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
    const isEven = index % 2 === 0;

    // Durchgehendes Zeilenband für Zebra-Muster ohne zersplitterte Zellgrenzen
    if (isEven) {
      row.add(this.scene.add.rectangle(
        TABLE_LEFT + TABLE_W / 2,
        TABLE_ROW_H / 2,
        TABLE_W - 4,
        TABLE_ROW_H,
        COLORS.GREY_8,
        0.28,
      ).setOrigin(0.5).setScrollFactor(0));
    }

    // Dezente horizontale Zeilentrennlinie
    row.add(this.scene.add.rectangle(
      TABLE_LEFT + TABLE_W / 2,
      TABLE_ROW_H,
      TABLE_W - 4,
      1,
      COLORS.GREY_7,
      0.22,
    ).setOrigin(0.5).setScrollFactor(0));

    let left = TABLE_LEFT;
    for (let i = 0; i < TABLE_COLUMNS.length; i++) {
      const column = TABLE_COLUMNS[i];
      // Dezente vertikale Spaltentrennlinie
      if (i > 0) {
        const isGroupStart = TABLE_GROUPS.some((g) => g.start === i);
        row.add(this.scene.add.rectangle(
          left,
          TABLE_ROW_H / 2,
          1,
          TABLE_ROW_H,
          isGroupStart ? COLORS.GREY_7 : COLORS.GREY_8,
          isGroupStart ? 0.35 : 0.18,
        ).setOrigin(0.5).setScrollFactor(0));
      }

      const isName = column.key === 'name';
      const label = this.getColumnValue(entry, column.key);
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
}
