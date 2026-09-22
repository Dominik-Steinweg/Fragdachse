import * as Phaser from 'phaser';
import { CELL_SIZE, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { getStoredGraphicsQuality } from '../utils/localPreferences';
import { getRenderScale } from '../graphics/RenderResolution';
import { ClarityCameraRegistry } from './arena/ClarityCameraRegistry';
import { PersistentBaseEditorWorld, getPersistentBaseEditorSize } from '../persistentBase/PersistentBaseEditorWorld';
import { getMissedBaseRewards, type BaseEditorObject, type PersistentBaseEditorModel } from '../persistentBase/PersistentBaseEditorModel';
import { baseEditorObjectKey, getBaseEditorAppearance } from '../persistentBase/PersistentBaseEditorAppearance';
import { getPersistentConstructionFootprint } from '../persistentBase/PersistentBasePlacementRules';
import { getPersistentBaseRewardDefinition } from '../persistentBase/PersistentBaseRewardCatalog';
import { getPersistentBaseBuildAreaExtentCells, isCellInsidePersistentBaseBuildArea } from '../persistentBase/PersistentBaseCore';
import { resolvePersistentBaseMaxHp } from '../persistentBase/PersistentBaseHealth';
import type { PersistentBaseRewardId } from '../persistentBase/PersistentBaseRewardTypes';
import { MATCH_RESULTS_BACKGROUND } from '../ui/MatchResultsAssets';
import { PERSISTENT_BASE_HEADER } from '../ui/PersistentBaseAssets';
import { UPGRADE_MENU } from '../ui/UpgradeMenuLayout';
import { ensureModalFrame, ensureModalPanelTexture, ensureGlossyButtonTexture, textStyle, TEXT } from '../ui/ForestModal';
import { ensureUpgradeFrame, ensureUpgradeApply } from '../ui/upgradeForestTextures';
import { createPersistentBaseDragPreview } from '../ui/PersistentBaseDragPreview';
import { UiButton } from '../ui/UiButton';
import { INTENT } from '../ui/uiTheme';
import { BUTTON_CURSOR } from '../ui/gameCursor';
import { activateUi } from '../ui/UiAudio';
import { attachHoverEffect } from '../ui/uiHover';
import { t } from '../i18n';

const WORLD_PANEL = { x: 88, y: 236, width: 648, height: 680 };
const TABLE = { x: 800, y: 248, width: 1038, height: 608 };
const ROW_HEIGHT = 38;
const ROWS = TABLE.height / ROW_HEIGHT;
const NAME_X = TABLE.x + 48, STATUS_X = 1432, PERSONAL_X = 1696;
type RowStatus = 'unplaced' | 'placed' | 'missed';
interface EditorRow { label: string; status: RowStatus; personal: boolean; icon?: string; object?: BaseEditorObject }
interface DragState { pointerId: number; x: number; y: number; offsetX: number; offsetY: number; started: boolean }
export interface PersistentBaseEditorOptions {
  readonly model: PersistentBaseEditorModel;
  readonly guest: boolean;
  readonly color: number;
  readonly newRewardIds: readonly PersistentBaseRewardId[];
  readonly save: () => Promise<boolean>;
  readonly close: () => void;
}

/** Menu-only input over a small regular World. No avatar, movement bindings or rotation. */
export class PersistentBaseEditorScene extends Phaser.Scene {
  static readonly KEY = 'PersistentBaseEditor';
  private quality!: GraphicsQualityController;
  private world!: PersistentBaseEditorWorld;
  private cameraRegistry!: ClarityCameraRegistry;
  private clarity!: Phaser.Cameras.Scene2D.Camera;
  private ui!: Phaser.GameObjects.Container;
  private list!: Phaser.GameObjects.Container;
  private grid!: Phaser.GameObjects.Graphics;
  private preview!: Phaser.GameObjects.Graphics;
  private selection!: Phaser.GameObjects.Graphics;
  private dragPreview: Phaser.GameObjects.Container | null = null;
  private tableOutline!: Phaser.GameObjects.Rectangle;
  private error!: Phaser.GameObjects.Text;
  private pageText!: Phaser.GameObjects.Text;
  private previous!: UiButton;
  private next!: UiButton;
  private buttons: UiButton[] = [];
  private rowBackgrounds = new Map<string, Phaser.GameObjects.Rectangle>();
  private selected: BaseEditorObject | null = null;
  private drag: DragState | null = null;
  private saving = false;
  private closed = false;
  private disposed = false;
  private page = 0;
  private readonly view: { x: number; y: number; width: number; height: number };
  constructor(private readonly options: PersistentBaseEditorOptions) {
    super(PersistentBaseEditorScene.KEY);
    const size = getPersistentBaseEditorSize(options.model.area);
    this.view = { x: WORLD_PANEL.x + (WORLD_PANEL.width - size) / 2,
      y: WORLD_PANEL.y + (WORLD_PANEL.height - size) / 2, width: size, height: size };
  }

  create(): void {
    this.quality = new GraphicsQualityController(getStoredGraphicsQuality());
    this.quality.attach(this);
    this.clarity = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'base-ui');
    this.cameraRegistry = new ClarityCameraRegistry(this, this.cameras.main, this.clarity);
    this.cameraRegistry.install();
    this.ui = this.add.container(0, 0);
    this.cameraRegistry.promote(this.ui);
    const chrome = UPGRADE_MENU;
    // Match Upgrades: the existing lobby remains visible outside the timber frame.
    for (const crop of this.outsideWorld(0, 0, GAME_WIDTH, GAME_HEIGHT)) {
      this.ui.add(this.add.rectangle(crop.x, crop.y, crop.width, crop.height, chrome.dimColor, chrome.dimAlpha).setOrigin(0));
    }
    const panel = ensureModalPanelTexture(this, '_base_panel', chrome.width, chrome.height);
    this.addBackdrop(panel, chrome.width - 80, chrome.height - 80);
    this.addBackdrop(MATCH_RESULTS_BACKGROUND.key, chrome.width - chrome.forestInsetX,
      chrome.height - chrome.forestInsetY, chrome.forestTint);
    this.ui.add(this.add.image(chrome.centerX, chrome.centerY, ensureModalFrame(this, chrome.width, chrome.height))
      .setDisplaySize(chrome.width, chrome.height));
    const headerArt = PERSISTENT_BASE_HEADER;
    const headerReady = this.textures.exists(headerArt.key);
    const header = this.add.image(chrome.centerX, chrome.headerY, headerReady ? headerArt.key
      : ensureGlossyButtonTexture(this, 'base-header', headerArt.width, headerArt.height, INTENT.neutral.fill))
      .setDisplaySize(headerArt.width, headerArt.height);
    this.ui.add(header);
    if (!headerReady) {
      // The lobby owns deferred loading; opening this menu early must not enqueue a second load.
      const event = Phaser.Textures.Events.ADD_KEY + headerArt.key;
      const refresh = () => header.setTexture(headerArt.key).setDisplaySize(headerArt.width, headerArt.height);
      this.textures.once(event, refresh);
      header.once('destroy', () => this.textures.off(event, refresh));
    }
    this.label(chrome.centerX, chrome.headerY + 4, t('ui.base.title').toLocaleUpperCase(), 'display', .5)
      .setFontSize(44).setColor('#efe4bd').setStroke('#1e160f', 3);
    this.label(chrome.centerX, 170, t(this.options.guest ? 'ui.base.guest' : 'ui.base.subtitle'), 'body', .5, 1700);
    const model = this.options.model;
    this.label(WORLD_PANEL.x + WORLD_PANEL.width / 2, 216,
      t(model.area.kind === 'radius' ? 'ui.base.statsRadius' : 'ui.base.stats', {
        stage: model.baseline.persistentBaseAreaStage, hp: resolvePersistentBaseMaxHp(model.baseline.persistentBaseHealthRewards),
        radius: model.area.kind === 'radius' ? model.area.radiusCells : 0,
      }), 'section', .5, WORLD_PANEL.width);
    const frameSize = this.view.width + 40;
    this.ui.add(this.add.image(this.view.x + this.view.width / 2, this.view.y + this.view.height / 2,
      ensureUpgradeFrame(this, frameSize, frameSize)).setDisplaySize(frameSize, frameSize));
    this.label(TABLE.x + 16, 216, t('ui.base.rewards'), 'section');
    this.label(STATUS_X, 216, t('ui.base.status'), 'section', .5);
    this.label(PERSONAL_X, 216, t('ui.base.personal'), 'section', .5);
    this.tableOutline = this.add.rectangle(TABLE.x, TABLE.y, TABLE.width, TABLE.height, 0x101b14, .25)
      .setOrigin(0).setStrokeStyle(1, 0x718160, .5);
    this.ui.add(this.tableOutline);
    this.list = this.add.container(0, 0); this.ui.add(this.list);
    this.previous = this.button(TABLE.x + 58, 895, 108, 36, '‹', () => this.changePage(-1));
    this.next = this.button(TABLE.x + TABLE.width - 58, 895, 108, 36, '›', () => this.changePage(1));
    this.pageText = this.label(TABLE.x + TABLE.width / 2, 895, '', 'body', .5);
    this.error = this.label(chrome.centerX, 192, '', 'caption', .5, 1600).setColor('#ffc2a9').setVisible(false);
    this.actionButton('cancel', chrome.centerX - (chrome.buttonGap + chrome.buttonWidth) / 2, () => this.finish());
    this.actionButton('apply', chrome.centerX + (chrome.buttonGap + chrome.buttonWidth) / 2, () => { void this.save(); });
    this.world = new PersistentBaseEditorWorld(this, model, this.options.color);
    this.grid = this.add.graphics().setDepth(10000);
    this.selection = this.add.graphics().setDepth(10001);
    this.preview = this.add.graphics().setDepth(10002);
    const extent = getPersistentBaseBuildAreaExtentCells(model.area);
    this.grid.lineStyle(1, 0xbdc99c, .18);
    for (let y = -extent; y <= extent; y++) for (let x = -extent; x <= extent; x++) {
      if (isCellInsidePersistentBaseBuildArea(x, y, model.area))
        this.grid.strokeRect((this.world.anchor + x) * CELL_SIZE, (this.world.anchor + y) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
    this.resize(); this.refreshList();
    this.scale.on('resize', this.resize, this);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.saving || this.closed || pointer.button !== 0) return;
      const cell = this.cellAt(pointer);
      if (!cell) return;
      const reward = model.rewards.find(p => p.relativeGridX === cell.x && p.relativeGridY === cell.y);
      const construction = model.constructions.find(p => (getPersistentConstructionFootprint(p) ?? []).some(c =>
        p.relativeGridX + c.dx === cell.x && p.relativeGridY + c.dy === cell.y));
      const object: BaseEditorObject | null = reward ? { kind: 'reward', id: reward.rewardId }
        : construction ? { kind: 'construction', id: construction.persistentId } : null;
      if (object) {
        const position = model.getPosition(object)!;
        this.beginDrag(object, pointer, cell.x - position.relativeGridX, cell.y - position.relativeGridY);
        const index = this.rows().findIndex(row => row.object && baseEditorObjectKey(row.object) === baseEditorObjectKey(object));
        if (index >= 0 && Math.floor(index / ROWS) !== this.page) { this.page = Math.floor(index / ROWS); this.refreshList(); }
      } else { this.selected = null; this.endDrag(); this.refreshSelection(); }
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.updateDrag(pointer));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.drop(pointer));
    this.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => this.drop(pointer));
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (!this.drag && this.isOverTable(pointer) && dy !== 0) this.changePage(Math.sign(dy));
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.saving) return;
      if (this.drag) this.endDrag(); else this.finish();
    });
    this.input.keyboard?.on('keydown-DELETE', () => {
      if (!this.saving && this.selected && model.getPosition(this.selected)) {
        model.remove(this.selected); this.endDrag(); this.syncDraft();
      }
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.closed = true;
    this.input.enabled = false;
    this.scale.off('resize', this.resize, this);
    this.dragPreview?.destroy(true);
    this.world?.destroy(); this.cameraRegistry?.destroy(); this.quality?.destroy();
    for (const button of this.buttons) button.destroy();
    this.buttons = [];
  }
  private label(x: number, y: number, value: string, role: Parameters<typeof textStyle>[0], origin = 0, width?: number) {
    const label = this.add.text(x, y, value, textStyle(role, { color: TEXT.primary })).setOrigin(origin, .5);
    if (width) label.setWordWrapWidth(width);
    this.ui.add(label); return label;
  }
  private outsideWorld(x: number, y: number, width: number, height: number) {
    const bottom = this.view.y + this.view.height, right = this.view.x + this.view.width;
    return [
      { x, y, width, height: this.view.y - y },
      { x, y: bottom, width, height: y + height - bottom },
      { x, y: this.view.y, width: this.view.x - x, height: this.view.height },
      { x: right, y: this.view.y, width: x + width - right, height: this.view.height },
    ];
  }
  private addBackdrop(key: string, width: number, height: number, tint = 0xffffff): void {
    const x = (GAME_WIDTH - width) / 2, y = (GAME_HEIGHT - height) / 2;
    for (const crop of this.outsideWorld(x, y, width, height)) {
      const image = this.add.image(x, y, key).setOrigin(0).setDisplaySize(width, height).setTint(tint);
      image.setCrop((crop.x - x) * image.width / width, (crop.y - y) * image.height / height,
        crop.width * image.width / width, crop.height * image.height / height);
      this.ui.add(image);
    }
  }
  private button(x: number, y: number, w: number, h: number, label: string, onClick: () => void) {
    const button = new UiButton(this, { x, y, w, h, label, skin: 'forest', onClick, isEnabled: () => !this.saving });
    this.buttons.push(button); this.ui.add(button.getRoot()); return button;
  }
  private actionButton(kind: 'cancel' | 'apply', x: number, onClick: () => void): void {
    const { buttonWidth: w, buttonHeight: h, buttonY: y } = UPGRADE_MENU;
    const texture = kind === 'apply' ? ensureUpgradeApply(this, w, h) : ensureGlossyButtonTexture(this, kind, w, h, INTENT.neutral.fill);
    const image = this.add.image(x, y, texture).setInteractive({ cursor: BUTTON_CURSOR });
    const label = this.label(x, y, t(`ui.upgrades.${kind}`), 'label', .5).setFontSize(22);
    if (kind === 'apply') label.setColor('#f3ffca');
    image.on('pointerdown', () => { if (!this.saving && !this.drag) activateUi(this, onClick); });
    attachHoverEffect(this, image, label);
    this.ui.add(image); this.ui.bringToTop(label);
  }
  private resize(): void {
    const scale = getRenderScale(this.scale);
    this.clarity.setViewport(0, 0, this.scale.width, this.scale.height).setOrigin(0, 0).setZoom(scale);
    this.cameras.main.setViewport(this.view.x * scale, this.view.y * scale, this.view.width * scale, this.view.height * scale)
      .setOrigin(0, 0).setZoom(scale).setScroll(0, 0);
  }
  private cellAt(pointer: Phaser.Input.Pointer): { x: number; y: number } | null {
    const scale = getRenderScale(this.scale), x = pointer.x / scale, y = pointer.y / scale;
    if (x < this.view.x || y < this.view.y || x >= this.view.x + this.view.width || y >= this.view.y + this.view.height) return null;
    return { x: Math.floor((x - this.view.x) / CELL_SIZE) - this.world.anchor,
      y: Math.floor((y - this.view.y) / CELL_SIZE) - this.world.anchor };
  }
  private isOverTable(pointer: Phaser.Input.Pointer): boolean {
    const scale = getRenderScale(this.scale), x = pointer.x / scale, y = pointer.y / scale;
    return x >= TABLE.x && y >= TABLE.y && x < TABLE.x + TABLE.width && y < TABLE.y + TABLE.height;
  }
  private beginDrag(object: BaseEditorObject, pointer: Phaser.Input.Pointer, offsetX = 0, offsetY = 0): void {
    if (this.saving || this.closed || pointer.button !== 0) return;
    this.endDrag(); this.selected = object;
    this.drag = { pointerId: pointer.id, x: pointer.x, y: pointer.y, offsetX, offsetY, started: false };
    this.error.setVisible(false); this.refreshSelection();
  }
  private updateDrag(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== pointer.id || !this.selected || this.saving) return;
    const scale = getRenderScale(this.scale);
    if (!drag.started && Math.hypot(pointer.x - drag.x, pointer.y - drag.y) / scale < 4) return;
    if (!drag.started) {
      drag.started = true;
      const appearance = getBaseEditorAppearance(this.options.model, this.selected);
      if (appearance) { this.dragPreview = createPersistentBaseDragPreview(this, appearance, this.options.color); this.ui.add(this.dragPreview); }
    }
    const cell = this.cellAt(pointer);
    this.preview.clear();
    if (cell) {
      cell.x -= drag.offsetX; cell.y -= drag.offsetY;
      const valid = !this.options.model.validate(this.selected, cell.x, cell.y);
      this.drawFootprint(this.preview, cell.x, cell.y, valid ? 0xb1ed94 : 0xff9991, .2);
      this.dragPreview?.setPosition(this.view.x + (this.world.anchor + cell.x + .5) * CELL_SIZE,
        this.view.y + (this.world.anchor + cell.y + .5) * CELL_SIZE);
    } else this.dragPreview?.setPosition(pointer.x / scale - drag.offsetX * CELL_SIZE, pointer.y / scale - drag.offsetY * CELL_SIZE);
    const removing = this.isOverTable(pointer) && !!this.options.model.getPosition(this.selected);
    this.tableOutline.setStrokeStyle(removing ? 2 : 1, removing ? 0xb1ed94 : 0x718160, removing ? 1 : .5);
  }
  private drop(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== pointer.id) return;
    let changed = false;
    if (drag.started && this.selected && !this.saving) {
      const model = this.options.model;
      const cell = this.cellAt(pointer);
      if (cell) changed = model.move(this.selected, cell.x - drag.offsetX, cell.y - drag.offsetY);
      else if (this.isOverTable(pointer) && model.getPosition(this.selected)) { model.remove(this.selected); changed = true; }
    }
    this.endDrag();
    if (changed) this.syncDraft();
    else this.refreshSelection();
  }
  private endDrag(): void {
    this.drag = null; this.dragPreview?.destroy(true); this.dragPreview = null;
    this.preview?.clear(); this.tableOutline?.setStrokeStyle(1, 0x718160, .5);
  }
  private syncDraft(): void { this.world.syncObjects(); this.refreshList(); }
  private drawFootprint(graphics: Phaser.GameObjects.Graphics, x: number, y: number, color: number, alpha: number): void {
    if (!this.selected) return;
    const cells = getBaseEditorAppearance(this.options.model, this.selected)?.footprint ?? [{ dx: 0, dy: 0 }];
    graphics.fillStyle(color, alpha).lineStyle(2, color, 1);
    for (const offset of cells) {
      const wx = (this.world.anchor + x + offset.dx) * CELL_SIZE, wy = (this.world.anchor + y + offset.dy) * CELL_SIZE;
      graphics.fillRect(wx, wy, CELL_SIZE, CELL_SIZE).strokeRect(wx + 1, wy + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    }
  }
  private objectLabel(object: BaseEditorObject): string {
    if (object.kind === 'reward') return t(getPersistentBaseRewardDefinition(object.id).presentation.labelKey);
    const construction = this.options.model.getConstruction(object.id);
    return t(construction?.tool.kind === 'utility' ? `loadout.${construction.tool.id}.name` : `construction.${construction?.tool.id}.name`);
  }
  private rows(): EditorRow[] {
    const model = this.options.model;
    const objects: BaseEditorObject[] = [
      ...model.baseline.persistentBaseRewardUnlocks.map(id => ({ kind: 'reward' as const, id })),
      ...model.availableConstructions.map(p => ({ kind: 'construction' as const, id: p.persistentId })),
    ];
    const rows: EditorRow[] = objects.map(object => ({ object, label: this.objectLabel(object),
      icon: object.kind === 'reward' ? getPersistentBaseRewardDefinition(object.id).presentation.iconKey : undefined,
      personal: object.kind === 'construction', status: model.getPosition(object) ? 'placed' : 'unplaced' }));
    const missed = new Set<PersistentBaseRewardId>();
    for (const entry of getMissedBaseRewards(model.baseline)) if (!missed.has(entry.rewardId)) {
      missed.add(entry.rewardId);
      const definition = getPersistentBaseRewardDefinition(entry.rewardId);
      rows.push({ label: t(definition.presentation.labelKey), icon: definition.presentation.iconKey, personal: false, status: 'missed' });
    }
    return rows;
  }
  private changePage(delta: number): void {
    if (this.drag || this.saving) return;
    const pages = Math.max(1, Math.ceil(this.rows().length / ROWS));
    this.page = Math.max(0, Math.min(pages - 1, this.page + delta)); this.refreshList();
  }
  private refreshList(): void {
    this.list.removeAll(true); this.rowBackgrounds.clear();
    const rows = this.rows(), pages = Math.max(1, Math.ceil(rows.length / ROWS));
    this.page = Math.min(this.page, pages - 1);
    rows.slice(this.page * ROWS, (this.page + 1) * ROWS).forEach((row, index) => {
      const y = TABLE.y + ROW_HEIGHT * (index + .5);
      const background = this.add.rectangle(TABLE.x + TABLE.width / 2, y, TABLE.width - 2, ROW_HEIGHT - 2, 0x18291f, .6);
      this.list.add(background);
      if (row.object) {
        this.rowBackgrounds.set(baseEditorObjectKey(row.object), background);
        background.setInteractive({ useHandCursor: true }).on('pointerdown', (pointer: Phaser.Input.Pointer) => this.beginDrag(row.object!, pointer));
      }
      if (row.icon && this.textures.exists(row.icon)) this.list.add(this.add.image(TABLE.x + 23, y, row.icon).setDisplaySize(24, 24));
      const name = this.add.text(NAME_X, y, row.label, textStyle('label', { color: TEXT.primary })).setOrigin(0, .5);
      if (name.width > STATUS_X - NAME_X - 90) name.setScale((STATUS_X - NAME_X - 90) / name.width);
      this.list.add(name);
      this.list.add(this.add.text(STATUS_X, y, t(`ui.base.${row.status}`), textStyle('body', {
        color: row.status === 'placed' ? 0xb8d59f : row.status === 'missed' ? 0xc9a485 : 0xe8d9a5,
      })).setOrigin(.5));
      if (row.personal) this.list.add(this.add.text(PERSONAL_X, y, '✓', textStyle('body', { color: 0xc2dda3 })).setOrigin(.5));
    });
    if (!rows.length) this.list.add(this.add.text(TABLE.x + 24, TABLE.y + 26, t('ui.base.empty.all'), textStyle('body', { color: TEXT.muted })));
    this.previous.getRoot().setVisible(pages > 1); this.previous.setEnabled(this.page > 0);
    this.next.getRoot().setVisible(pages > 1); this.next.setEnabled(this.page < pages - 1);
    this.pageText.setText(`${this.page + 1} / ${pages}`).setVisible(pages > 1);
    this.refreshSelection();
  }
  private refreshSelection(): void {
    const selectedKey = this.selected ? baseEditorObjectKey(this.selected) : null;
    for (const [key, background] of this.rowBackgrounds) background
      .setFillStyle(key === selectedKey ? 0x435735 : 0x18291f, key === selectedKey ? .92 : .6)
      .setStrokeStyle(key === selectedKey ? 2 : 0, 0xd6e9a2, 1);
    this.selection.clear();
    const position = this.selected && this.options.model.getPosition(this.selected);
    if (position) this.drawFootprint(this.selection, position.relativeGridX, position.relativeGridY, 0xe4d499, .1);
    this.grid.setVisible(this.selected !== null);
  }
  private async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true; this.endDrag(); this.error.setVisible(false);
    let saved = false;
    try { saved = !this.options.model.dirty || await this.options.save(); } catch { saved = false; }
    if (this.closed) return;
    this.saving = false;
    if (saved) this.finish();
    else this.error.setText(t('ui.base.saveFailed')).setVisible(true);
  }
  private finish(): void { if (!this.closed) { this.closed = true; this.options.close(); } }
  update(now: number, delta: number): void {
    if (!this.world || this.closed) return;
    this.world.update(now, delta, { x: 0, y: 0, width: this.view.width, height: this.view.height });
  }
}
