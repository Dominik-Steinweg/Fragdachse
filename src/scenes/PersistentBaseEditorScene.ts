import * as Phaser from 'phaser';
import { createPersistentBaseEditorMinimap, type PersistentBaseEditorMinimap } from '../ui/PersistentBaseEditorMinimap';
import { getMapName } from '../i18n/contentPresentation';
import { getCoopDefenseConstructionDefinition, normalizeConstructionId } from '../config/coopDefenseConstructions';
import type { AfterRoundView } from '../ui/AfterRoundTransition';
import { CELL_SIZE, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { getStoredGraphicsQuality } from '../utils/localPreferences';
import { getRenderScale } from '../graphics/RenderResolution';
import { ClarityCameraRegistry } from './arena/ClarityCameraRegistry';
import { PERSISTENT_BASE_EDITOR_DETAIL_RADIUS, PersistentBaseEditorWorld, type PersistentBaseEditorTerrain } from '../persistentBase/PersistentBaseEditorWorld';
import { resolvePersistentBaseEditorPreview, type PersistentBaseEditorRoom } from '../persistentBase/PersistentBaseEditorPreview';
import type { DeploymentRoutePlan } from '../activity/DeploymentRoutes';
import type { PersistentCompositeConflictReason } from '../persistentBase/PersistentBaseComposite';
import { TurretRangePreviewVisual } from './arena/TurretRangePreviewVisual';
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
import { getLocale, t } from '../i18n';
import { isDawnUnlocked } from '../dawn/rules/DawnUnlock';
import { buildPersistentBaseExpansionPreview, getPersistentBaseEditorDetailWindow, getPersistentBaseEditorFraming,
  getPersistentBaseEditorWorldFraming, type PersistentBaseEditorFraming } from '../persistentBase/PersistentBaseExpansionPreview';
import { createDawnExpansionRewardNote } from '../ui/DawnMerchantExpansionPreview';
import { createDawnMerchantExpansionPreview, createPersistentBaseEditorBoundary } from '../ui/DawnMerchantExpansionPreview';
import { resolveWorldDefinition } from '../world/WorldDefinitionResolution';
import { LOBBY_WORLD_DEFINITION_ID } from '../config/authoring/lobbyWorld';

const WORLD_PANEL = { x: 88, y: 236, width: 1000, height: 680 };
/** Overview of the whole map (Lagekarte); empty without map terrain. */
export const PERSISTENT_BASE_EDITOR_MINIMAP_PANEL = { x: 1130, y: 236, width: 708, height: 200 };
const TABLE = { x: 1130, y: 486, width: 708, height: 380 };
const ROW_HEIGHT = 38;
const ROWS = TABLE.height / ROW_HEIGHT;
const NAME_X = TABLE.x + 48, STATUS_X = TABLE.x + 470, PERSONAL_X = TABLE.x + 640;
type RowStatus = 'unplaced' | 'placed' | 'missed';
interface EditorRow { label: string; status: RowStatus; personal: boolean; icon?: string; object?: BaseEditorObject;
  conflict?: PersistentCompositeConflictReason }
interface DragState { pointerId: number; x: number; y: number; offsetX: number; offsetY: number; started: boolean }
/** Why Apply did not save. `stale` means the draft was reloaded from the newer confirmed state. */
export type PersistentBaseEditorSaveResult = { readonly ok: true }
  | { readonly ok: false; readonly reason: 'stale' | 'blocked' | 'placement' | 'invalid' };
export interface PersistentBaseEditorOptions {
  readonly model: PersistentBaseEditorModel;
  readonly color: number;
  readonly newRewardIds: readonly PersistentBaseRewardId[];
  readonly save: () => Promise<PersistentBaseEditorSaveResult>;
  /** Terrain of the host's next map around the base (Lagekarte); `null` shows the base alone. */
  readonly terrain?: PersistentBaseEditorTerrain | null;
  /** Teammates and ownership in the room, for teammates' buildings and conflicts on the map. */
  readonly room?: PersistentBaseEditorRoom | null;
  /** Range of the local player's turret as built in a round (personal upgrades included). */
  readonly resolveTurretRange?: (constructionId: string) => number | null;
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
  private readonly framing: PersistentBaseEditorFraming;
  private readonly expansion: ReturnType<typeof buildPersistentBaseExpansionPreview>;
  private conflicts: ReadonlyMap<string, PersistentCompositeConflictReason> = new Map();
  private conflictHalo!: Phaser.GameObjects.Graphics;
  private readonly rangeRings = new Map<string, TurretRangePreviewVisual>();
  private showRanges = false;
  private minimap: PersistentBaseEditorMinimap | null = null;
  /** Why the World view shows no routes (forward base, players hunted away); below the minimap. */
  private routeHint: Phaser.GameObjects.Text | null = null;
  private breachWarning: Phaser.GameObjects.Container | null = null;
  constructor(private readonly options: PersistentBaseEditorOptions) {
    super(PersistentBaseEditorScene.KEY);
    // The local menu uses the lobby ceiling but can edit a personal area larger than that site.
    const site = resolveWorldDefinition({ definitionId: LOBBY_WORLD_DEFINITION_ID }, null)?.persistentBaseSite;
    const baseline = options.model.baseline;
    this.expansion = site ? buildPersistentBaseExpansionPreview(baseline.dawn,
      baseline.persistentBaseAreaStage, isDawnUnlocked(baseline), site.maxAreaStage) : null;
    const terrainSite = options.terrain?.definition.persistentBaseSite;
    if (options.terrain && terrainSite) {
      const { widthCells, heightCells } = options.terrain.definition.metrics;
      const detail = getPersistentBaseEditorDetailWindow({ widthCells, heightCells }, terrainSite.anchor, PERSISTENT_BASE_EDITOR_DETAIL_RADIUS);
      this.framing = getPersistentBaseEditorWorldFraming(WORLD_PANEL, { x: detail.minX * CELL_SIZE, y: detail.minY * CELL_SIZE,
        width: (detail.maxX - detail.minX + 1) * CELL_SIZE, height: (detail.maxY - detail.minY + 1) * CELL_SIZE }, terrainSite.anchor);
    } else {
      this.framing = getPersistentBaseEditorFraming(WORLD_PANEL, options.model.area, this.expansion?.area);
    }
  }
  private get view() { return this.framing.view; }
  /** Overview of the whole map beside the table; without map terrain a short note. */
  private createSituationMap(): void {
    const panel = PERSISTENT_BASE_EDITOR_MINIMAP_PANEL, terrain = this.options.terrain;
    this.ui.add(this.add.rectangle(panel.x, panel.y, panel.width, panel.height, 0x101b14, .55)
      .setOrigin(0).setStrokeStyle(1, 0x718160, .5));
    const title = terrain ? `${t('ui.base.situationMap')} · ${getMapName(terrain.mapId, getLocale())}` : t('ui.base.situationMap');
    this.label(panel.x + 16, 216, title.toLocaleUpperCase(), 'section');
    if (!terrain) {
      this.label(panel.x + panel.width / 2, panel.y + panel.height / 2, t('ui.base.noSituationMap'), 'body', .5, panel.width - 40)
        .setColor('#d9cfa8');
      return;
    }
    const view = this.world.view;
    // Where routes cannot be shown on the base, the reason gets its own strip below the overview.
    const hint = this.routeHintText(this.world.planRoutes());
    const hintHeight = hint ? 40 : 0;
    this.minimap = createPersistentBaseEditorMinimap(this, {
      layout: terrain.layout, widthCells: terrain.definition.metrics.widthCells, heightCells: terrain.definition.metrics.heightCells,
      bases: this.world.world.bases, persistentBaseId: this.world.world.persistentBaseSite?.baseId ?? null,
      spawnZones: terrain.definition.spawnZones ?? [],
      detail: { minX: view.x / CELL_SIZE, minY: view.y / CELL_SIZE,
        maxX: (view.x + view.width) / CELL_SIZE - 1, maxY: (view.y + view.height) / CELL_SIZE - 1 },
    }, { x: panel.x + 8, y: panel.y + 8, width: panel.width - 16, height: panel.height - 16 - hintHeight });
    this.ui.add(this.minimap.image);
    const origin = this.minimap.cellToScreen(0, 0);
    this.world.attachRouteMinimap(this.ui, { originX: origin.x - this.minimap.scale / 2, originY: origin.y - this.minimap.scale / 2,
      unit: this.minimap.scale / CELL_SIZE });
    this.routeHint = this.label(panel.x + panel.width / 2, panel.y + panel.height - 26, hint ?? '', 'caption', .5, panel.width - 40)
      .setColor('#e3d2ff').setVisible(hint !== null);
    // No free path: the warning sits on the World view, where the breach glows.
    const warning = this.add.container(WORLD_PANEL.x + WORLD_PANEL.width / 2, this.view.y + this.view.height - 30).setVisible(false);
    const text = this.add.text(0, 0, t('ui.base.routes.breach').toLocaleUpperCase(), textStyle('label', { color: 0xffd0da }))
      .setOrigin(.5).setStroke('#2a0610', 4);
    warning.add([this.add.rectangle(0, 0, text.width + 48, 36, 0x3a0a18, .82).setStrokeStyle(2, 0xff5a7a, .9), text]);
    this.tweens.add({ targets: warning, alpha: { from: 1, to: .6 }, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.ui.add(warning);
    this.breachWarning = warning;
  }
  private get worldZoom(): number { return this.framing.zoom; }

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
    const frameWidth = Math.round(this.view.width + 40), frameHeight = Math.round(this.view.height + 40);
    this.ui.add(this.add.image(this.view.x + this.view.width / 2, this.view.y + this.view.height / 2,
      ensureUpgradeFrame(this, frameWidth, frameHeight)).setDisplaySize(frameWidth, frameHeight));
    const columnsY = TABLE.y - 20;
    this.label(TABLE.x + 16, columnsY, t('ui.base.rewards'), 'section');
    this.label(STATUS_X, columnsY, t('ui.base.status'), 'section', .5);
    this.label(PERSONAL_X, columnsY, t('ui.base.personal'), 'section', .5);
    this.tableOutline = this.add.rectangle(TABLE.x, TABLE.y, TABLE.width, TABLE.height, 0x101b14, .25)
      .setOrigin(0).setStrokeStyle(1, 0x718160, .5);
    this.ui.add(this.tableOutline);
    this.list = this.add.container(0, 0); this.ui.add(this.list);
    const pagerY = TABLE.y + TABLE.height + 28;
    this.previous = this.button(TABLE.x + 58, pagerY, 108, 36, '‹', () => this.changePage(-1));
    this.next = this.button(TABLE.x + TABLE.width - 58, pagerY, 108, 36, '›', () => this.changePage(1));
    this.pageText = this.label(TABLE.x + TABLE.width / 2, pagerY, '', 'body', .5);
    this.error = this.label(chrome.centerX, 192, '', 'caption', .5, 1600).setColor('#ffc2a9').setVisible(false);
    this.actionButton('cancel', chrome.centerX - (chrome.buttonGap + chrome.buttonWidth) / 2, () => this.finish());
    this.actionButton('apply', chrome.centerX + (chrome.buttonGap + chrome.buttonWidth) / 2, () => { void this.save(); });
    const toolsY = 942, toolsX = WORLD_PANEL.x + WORLD_PANEL.width / 2;
    if (model.rewardsEditable) {
      this.button(toolsX - 130, toolsY, 220, 40, t('ui.base.rotate'), () => {
        if (this.drag || this.saving || !model.rotate()) return;
        this.syncDraft();
      });
    } else {
      this.label(toolsX - 130, toolsY, t('ui.base.hostRoomBase'), 'caption', .5, 360).setColor('#d9cfa8');
    }
    this.button(toolsX + 130, toolsY, 220, 40, t('ui.base.ranges'), () => {
      this.showRanges = !this.showRanges;
      this.refreshRanges();
    });
    const expansion = this.expansion;
    this.world = new PersistentBaseEditorWorld(this, model, this.options.color,
      { previewArea: expansion?.area, terrain: this.options.terrain ?? null });
    this.createSituationMap();
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
    this.conflictHalo = this.add.graphics().setDepth(10003);
    this.tweens.add({ targets: this.conflictHalo, alpha: { from: 1, to: .35 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const extent = getPersistentBaseBuildAreaExtentCells(model.area);
    const anchor = this.world.anchor;
    this.grid.lineStyle(1, 0xbdc99c, .18);
    for (let y = -extent; y <= extent; y++) for (let x = -extent; x <= extent; x++) {
      if (isCellInsidePersistentBaseBuildArea(x, y, model.area))
        this.grid.strokeRect((anchor.gridX + x) * CELL_SIZE, (anchor.gridY + y) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
    this.resize(); this.refreshPreview(); this.refreshList();
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
    for (const ring of this.rangeRings.values()) ring.destroy();
    this.rangeRings.clear();
    this.minimap?.destroy(); this.minimap = null;
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
      .setOrigin(0, 0).setZoom(scale * this.worldZoom).setScroll(this.framing.world.x, this.framing.world.y);
  }
  /** Canonical draft cell under the pointer: the World cell turned back by the base orientation. */
  private cellAt(pointer: Phaser.Input.Pointer): { x: number; y: number } | null {
    const scale = getRenderScale(this.scale), x = pointer.x / scale, y = pointer.y / scale;
    if (x < this.view.x || y < this.view.y || x >= this.view.x + this.view.width || y >= this.view.y + this.view.height) return null;
    const canonical = toCanonicalCell(this.world.frame,
      Math.floor((this.framing.world.x + (x - this.view.x) / this.worldZoom) / CELL_SIZE),
      Math.floor((this.framing.world.y + (y - this.view.y) / this.worldZoom) / CELL_SIZE));
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
        this.view.x + ((origin.gridX + .5) * CELL_SIZE - this.framing.world.x) * this.worldZoom,
        this.view.y + ((origin.gridY + .5) * CELL_SIZE - this.framing.world.y) * this.worldZoom);
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
  private syncDraft(): void { this.world.syncObjects(); this.refreshPreview(); this.refreshList(); }
  /** Teammates' buildings and own conflicts as the host would merge them on the shown map. */
  private refreshPreview(): void {
    const room = this.options.room;
    const preview = room ? resolvePersistentBaseEditorPreview({ model: this.options.model, frame: this.world.frame,
      siteArea: this.world.siteArea, room, isCellBlocked: (x, y) => this.world.isCellBlocked(x, y) }) : null;
    this.conflicts = preview?.conflicts ?? new Map();
    this.world.setMates(preview?.mates ?? []);
    this.conflictHalo.clear().lineStyle(3, 0xff5a4a, 1);
    for (const persistentId of this.conflicts.keys()) {
      const entry = this.options.model.constructions.find(p => p.persistentId === persistentId);
      const appearance = entry && getBaseEditorAppearance(this.options.model, { kind: 'construction', id: persistentId });
      if (!entry || !appearance) continue;
      const placed = toWorldFootprint(this.world.frame, entry.relativeGridX, entry.relativeGridY, appearance.footprint);
      for (const cell of placed.footprint) {
        this.conflictHalo.strokeRect((placed.gridX + cell.dx) * CELL_SIZE + 2, (placed.gridY + cell.dy) * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      }
    }
    this.refreshRanges();
    this.refreshRoutes();
  }
  /** The next round's enemy routes with the draft as it stands, and what the view cannot show. */
  private refreshRoutes(): void {
    const plan = this.world.planRoutes();
    this.breachWarning?.setVisible(!!plan?.routes.some((route) => route.relevant && route.breach));
  }
  private routeHintText(plan: DeploymentRoutePlan | null): string | null {
    return plan?.hint === 'front-base' ? t('ui.base.routes.frontBase')
      : plan?.hint === 'players-away' ? t('ui.base.routes.playersAway') : null;
  }
  /** Rings of every own turret while toggled on; the selected turret always shows its ring. */
  private refreshRanges(): void {
    const model = this.options.model, frame = this.world.frame;
    const wanted = new Map<string, { x: number; y: number; radius: number }>();
    const consider = (object: BaseEditorObject, position: { relativeGridX: number; relativeGridY: number } | undefined, constructionId: string | undefined) => {
      const key = baseEditorObjectKey(object);
      const selected = this.selected !== null && baseEditorObjectKey(this.selected) === key;
      if (!position || !constructionId || (!this.showRanges && !selected)) return;
      // Personal turrets carry the builder's upgrades; base-owned reward turrets their authored range.
      const id = normalizeConstructionId(constructionId);
      const definition = id ? getCoopDefenseConstructionDefinition(id) : null;
      const radius = object.kind === 'construction' ? this.options.resolveTurretRange?.(constructionId) ?? null
        : definition?.kind === 'turret' ? definition.targetRange : null;
      const appearance = getBaseEditorAppearance(model, object);
      if (!radius || !appearance) return;
      const placed = toWorldFootprint(frame, position.relativeGridX, position.relativeGridY, appearance.footprint);
      wanted.set(key, { x: (placed.gridX + .5) * CELL_SIZE, y: (placed.gridY + .5) * CELL_SIZE, radius });
    };
    for (const entry of model.constructions) consider({ kind: 'construction', id: entry.persistentId }, entry, entry.tool.id);
    for (const reward of model.rewards) {
      const source = getPersistentBaseRewardDefinition(reward.rewardId).gameplaySource;
      consider({ kind: 'reward', id: reward.rewardId }, reward, source.kind === 'construction-definition' ? source.constructionId : undefined);
    }
    for (const [key, ring] of this.rangeRings) if (!wanted.has(key)) { ring.destroy(); this.rangeRings.delete(key); }
    for (const [key, ring] of wanted) {
      let visual = this.rangeRings.get(key);
      if (!visual) { visual = new TurretRangePreviewVisual(this, 9990); this.rangeRings.set(key, visual); }
      visual.show(ring.x, ring.y, ring.radius, this.options.color, true, 0);
    }
  }
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
      conflict: object.kind === 'construction' && model.getPosition(object) ? this.conflicts.get(object.id) : undefined,
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
      const status = this.add.text(STATUS_X, y, row.conflict ? t(`ui.base.conflict.${row.conflict}`) : t(`ui.base.${row.status}`),
        textStyle('body', { color: row.conflict ? 0xff9a8a : row.status === 'placed' ? 0xb8d59f : row.status === 'missed' ? 0xc9a485 : 0xe8d9a5 }))
        .setOrigin(.5);
      if (status.width > PERSONAL_X - NAME_X - 160) status.setScale((PERSONAL_X - NAME_X - 160) / status.width);
      this.list.add(status);
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
    if (this.world) this.refreshRanges();
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
    const view = this.world.view;
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
