import * as Phaser from 'phaser';
import type { AfterRoundView } from '../ui/AfterRoundTransition';
import { CELL_SIZE, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { getStoredGraphicsQuality } from '../utils/localPreferences';
import { getRenderScale } from '../graphics/RenderResolution';
import { ClarityCameraRegistry } from './arena/ClarityCameraRegistry';
import { PersistentBaseEditorWorld } from '../persistentBase/PersistentBaseEditorWorld';
import { getMissedBaseRewards, type BaseEditorObject, type PersistentBaseEditorModel } from '../persistentBase/PersistentBaseEditorModel';
import { baseEditorObjectKey, getBaseEditorAppearance } from '../persistentBase/PersistentBaseEditorAppearance';
import { getPersistentBaseRewardCells, getPersistentConstructionFootprint } from '../persistentBase/PersistentBasePlacementRules';
import { rotatePersistentBaseOffset, toCanonicalCell, toWorldFootprint } from '../persistentBase/PersistentBaseFrame';
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
import { createPowerUpSymbolPreview } from '../powerups/PowerUpItemArt';
import { UiButton } from '../ui/UiButton';
import { INTENT } from '../ui/uiTheme';
import { BUTTON_CURSOR } from '../ui/gameCursor';
import { activateUi } from '../ui/UiAudio';
import { attachHoverEffect } from '../ui/uiHover';
import { t } from '../i18n';
import { isDawnUnlocked } from '../dawn/rules/DawnUnlock';
import { buildPersistentBaseExpansionPreview, getPersistentBaseEditorFraming } from '../persistentBase/PersistentBaseExpansionPreview';
import { createDawnExpansionRewardNote } from '../ui/DawnMerchantExpansionPreview';
import { createDawnMerchantExpansionPreview, createPersistentBaseEditorBoundary } from '../ui/DawnMerchantExpansionPreview';
import { resolveWorldDefinition } from '../world/WorldDefinitionResolution';
import { LOBBY_WORLD_DEFINITION_ID } from '../config/authoring/lobbyWorld';

const WORLD_PANEL = { x: 88, y: 236, width: 648, height: 680 };
const TABLE = { x: 800, y: 248, width: 1038, height: 608 };
const ROW_HEIGHT = 38;
const ROWS = TABLE.height / ROW_HEIGHT;
const NAME_X = TABLE.x + 48, STATUS_X = 1432, PERSONAL_X = 1696;
type RowStatus = 'unplaced' | 'placed' | 'missed';
interface EditorRow { label: string; status: RowStatus; personal: boolean; icon?: string; object?: BaseEditorObject }
interface DragState { pointerId: number; x: number; y: number; offsetX: number; offsetY: number; started: boolean }
/** Why Apply did not save. `stale` means the draft was reloaded from the newer confirmed state. */
export type PersistentBaseEditorSaveResult = { readonly ok: true }
  | { readonly ok: false; readonly reason: 'stale' | 'blocked' | 'placement' | 'invalid' };
export interface PersistentBaseEditorOptions {
  readonly model: PersistentBaseEditorModel;
  readonly color: number;
  readonly newRewardIds: readonly PersistentBaseRewardId[];
  readonly save: () => Promise<PersistentBaseEditorSaveResult>;
  readonly close: () => void;
  readonly presented?: (view: AfterRoundView) => void;
  readonly retire?: () => void;
}

/**
 * Menu-only input over a small regular World. No avatar or movement bindings. The draft is
 * canonical; the World shows it turned by the base orientation, and input is turned back.
 */
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
  private expansionPreview: Phaser.GameObjects.Container | null = null;
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
  private presentationReady = false;
  private page = 0;
  private readonly worldZoom: number;
  private readonly framing: ReturnType<typeof getPersistentBaseEditorFraming>;
  private readonly expansion: ReturnType<typeof buildPersistentBaseExpansionPreview>;
  private readonly view: { x: number; y: number; width: number; height: number };
  constructor(private readonly options: PersistentBaseEditorOptions) {
    super(PersistentBaseEditorScene.KEY);
    // The local menu uses the lobby ceiling but can edit a personal area larger than that site.
    const site = resolveWorldDefinition({ definitionId: LOBBY_WORLD_DEFINITION_ID }, null)?.persistentBaseSite;
    const baseline = options.model.baseline;
    this.expansion = site ? buildPersistentBaseExpansionPreview(baseline.dawn,
      baseline.persistentBaseAreaStage, isDawnUnlocked(baseline), site.maxAreaStage) : null;
    this.framing = getPersistentBaseEditorFraming(WORLD_PANEL, options.model.area, this.expansion?.area);
    this.worldZoom = this.framing.zoom;
    this.view = this.framing.view;
  }

  create(): void {
    this.quality = new GraphicsQualityController(getStoredGraphicsQuality());
    this.quality.attach(this);
    this.clarity = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'base-ui');
    // Keep the previous menu visible while this standalone World's worker/chunk queue warms up.
    this.getTransitionView().setAlpha(0);
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
    this.label(chrome.centerX, 170, t('ui.base.subtitle'), 'body', .5, 1700);
    const model = this.options.model;
    this.label(WORLD_PANEL.x + WORLD_PANEL.width / 2, 216,
      t(model.area.kind === 'radius' ? 'ui.base.statsRadius' : 'ui.base.stats', {
        stage: model.areaStage, hp: resolvePersistentBaseMaxHp(model.baseline.persistentBaseHealthRewards),
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
    if (model.rewardsEditable) {
      this.button(WORLD_PANEL.x + WORLD_PANEL.width / 2, 942, 220, 40, t('ui.base.rotate'), () => {
        if (this.drag || this.saving || !model.rotate()) return;
        this.syncDraft();
      });
    } else {
      this.label(WORLD_PANEL.x + WORLD_PANEL.width / 2, 942, t('ui.base.hostRoomBase'), 'caption', .5, WORLD_PANEL.width)
        .setColor('#d9cfa8');
    }
    const expansion = this.expansion;
    this.world = new PersistentBaseEditorWorld(this, model, this.options.color, expansion?.area);
    this.ui.add(createPersistentBaseEditorBoundary(this, model.area, this.framing));
    if (expansion?.edges.length) {
      this.expansionPreview = createDawnMerchantExpansionPreview(this, this.framing, expansion.edges,
        t(expansion.dawnOnly ? 'ui.base.expansionRingLabelDawnOnly' : 'ui.base.expansionRingLabel',
          { radius: expansion.radius, cost: expansion.cost }));
      this.ui.add(this.expansionPreview);
    } else if (expansion?.reward?.kind === 'core') {
      this.expansionPreview = createDawnExpansionRewardNote(this, this.framing,
        t('ui.base.expansionCoreReward', { hp: expansion.reward.coreHpBonus, cost: expansion.cost }));
      this.ui.add(this.expansionPreview);
    }
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
      const reward = model.rewardsEditable ? model.rewards.find(p => getPersistentBaseRewardCells(p).some(c =>
        c.gridX === cell.x && c.gridY === cell.y)) : undefined;
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
    this.setTransitionInputBlocked(true);
  }

  getTransitionView(): AfterRoundView {
    return {
      depth: 0,
      // This Scene is rendered above ArenaScene, including both of its cameras.
      setDepth: () => {},
      setAlpha: alpha => { for (const camera of this.cameras.cameras) camera.setAlpha(alpha); },
      retire: () => this.options.retire?.(),
    };
  }

  setTransitionInputBlocked(blocked: boolean): void {
    const enabled = !blocked && this.presentationReady;
    this.input.enabled = enabled;
    if (this.input.keyboard) { this.input.keyboard.resetKeys(); this.input.keyboard.enabled = enabled; }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.closed = true;
    this.input.enabled = false;
    this.scale.off('resize', this.resize, this);
    this.dragPreview?.destroy(true);
    this.expansionPreview?.destroy(true); this.expansionPreview = null;
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
      .setOrigin(0, 0).setZoom(scale * this.worldZoom).setScroll(0, 0);
  }
  /** Canonical draft cell under the pointer: the World cell turned back by the base orientation. */
  private cellAt(pointer: Phaser.Input.Pointer): { x: number; y: number } | null {
    const scale = getRenderScale(this.scale), x = pointer.x / scale, y = pointer.y / scale;
    if (x < this.view.x || y < this.view.y || x >= this.view.x + this.view.width || y >= this.view.y + this.view.height) return null;
    const canonical = toCanonicalCell(this.world.frame,
      Math.floor((x - this.view.x) / (CELL_SIZE * this.worldZoom)),
      Math.floor((y - this.view.y) / (CELL_SIZE * this.worldZoom)));
    return { x: canonical.relativeGridX, y: canonical.relativeGridY };
  }
  /** World top-left cell of the selected object at a canonical origin. */
  private worldOrigin(x: number, y: number): { gridX: number; gridY: number } {
    const cells = this.selected ? getBaseEditorAppearance(this.options.model, this.selected)?.footprint ?? [] : [];
    return toWorldFootprint(this.world.frame, x, y, cells);
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
      const origin = this.worldOrigin(cell.x, cell.y);
      this.dragPreview?.setScale(this.worldZoom).setPosition(
        this.view.x + (origin.gridX + .5) * CELL_SIZE * this.worldZoom,
        this.view.y + (origin.gridY + .5) * CELL_SIZE * this.worldZoom);
    } else {
      const offset = rotatePersistentBaseOffset(drag.offsetX, drag.offsetY, this.world.frame.quarterTurns);
      this.dragPreview?.setScale(1).setPosition(pointer.x / scale - offset.dx * CELL_SIZE, pointer.y / scale - offset.dy * CELL_SIZE);
    }
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
    const placed = toWorldFootprint(this.world.frame, x, y, cells);
    graphics.fillStyle(color, alpha).lineStyle(2, color, 1);
    for (const offset of placed.footprint) {
      const wx = (placed.gridX + offset.dx) * CELL_SIZE, wy = (placed.gridY + offset.dy) * CELL_SIZE;
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
    const rewardIds = model.rewardsEditable ? model.baseline.persistentBaseRewardUnlocks : model.rewards.map(p => p.rewardId);
    const objects: BaseEditorObject[] = [
      ...rewardIds.map(id => ({ kind: 'reward' as const, id })),
      ...model.availableConstructions.map(p => ({ kind: 'construction' as const, id: p.persistentId })),
    ];
    const rows: EditorRow[] = objects.map(object => ({
      // The room's rewards belong to the host: a guest sees them, but cannot drag them.
      object: object.kind === 'reward' && !model.rewardsEditable ? undefined : object,
      label: this.objectLabel(object),
      icon: object.kind === 'reward' ? getPersistentBaseRewardDefinition(object.id).presentation.iconKey : undefined,
      personal: object.kind === 'construction', status: model.getPosition(object) ? 'placed' : 'unplaced' }));
    if (!model.rewardsEditable) return rows;
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
      const powerUpIcon = row.icon ? createPowerUpSymbolPreview(this, row.icon, 24, true) : null;
      if (powerUpIcon) this.list.add(powerUpIcon.setPosition(TABLE.x + 23, y));
      else if (row.icon && this.textures.exists(row.icon)) this.list.add(this.add.image(TABLE.x + 23, y, row.icon).setDisplaySize(24, 24));
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
    let result: PersistentBaseEditorSaveResult = { ok: true };
    try {
      if (this.options.model.dirty) result = await this.options.save();
    } catch { result = { ok: false, reason: 'invalid' }; }
    if (this.closed) return;
    this.saving = false;
    if (result.ok) { this.finish(); return; }
    // A stale draft was already replaced by the newer confirmed state.
    if (result.reason === 'stale') { this.selected = null; this.syncDraft(); }
    this.error.setText(t(result.reason === 'stale' ? 'ui.base.saveStale'
      : result.reason === 'blocked' ? 'ui.base.saveBlocked'
        : result.reason === 'placement' ? 'ui.base.savePlacement' : 'ui.base.saveFailed')).setVisible(true);
  }
  private finish(): void { if (!this.closed) { this.closed = true; this.options.close(); } }
  update(now: number, delta: number): void {
    if (!this.world || this.closed) return;
    const view = { x: 0, y: 0, width: this.world.size, height: this.world.size };
    this.world.update(now, delta, view);
    if (!this.presentationReady && this.world.isReadyForView(view)) {
      this.presentationReady = true;
      const transition = this.getTransitionView();
      if (this.options.presented) this.options.presented(transition);
      else {
        transition.setAlpha(1);
        this.setTransitionInputBlocked(false);
      }
    }
  }
}
