import * as Phaser from 'phaser';
import { createPersistentBaseEditorMinimap, PERSISTENT_BASE_EDITOR_MINIMAP_COLORS, type PersistentBaseEditorMinimap } from '../ui/PersistentBaseEditorMinimap';
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
import { formatTimeOfDay } from '../effects/TimeOfDay';
import type { ArenaBuildPause } from '../arena/ArenaBuilder';
import { DEPLOYMENT_ROUTE_START, type DeploymentRouteScenario, type DeploymentRouteScenarioOptions } from '../activity/DeploymentRoutes';
import type { UiIconName } from '../ui/uiTextures';
import { getChunkBakeScheduler } from '../arena/chunks/ChunkBakeScheduler';
import { loadingTimeline } from '../diagnostics/LoadingTimeline';

const WORLD_PANEL = { x: 88, y: 262, width: 1000, height: 660 };
/** Header row above both columns: stage and tools on the left, the situation map's title on the right. */
const HEADER_Y = 222;
/** Overview of the whole map (Lagekarte); empty without map terrain. */
export const PERSISTENT_BASE_EDITOR_MINIMAP_PANEL = { x: 1130, y: 242, width: 708, height: 300 };
const TABLE = { x: 1130, y: 582, width: 708, height: 266 };
/** What-if switches below the overview; each appears only where it changes the routes. */
const SCENARIO_SWITCHES = [
  { key: 'outpostsDestroyed', option: 'outposts', label: 'ui.base.scenario.outposts' },
  { key: 'bridgesDestroyed', option: 'bridges', label: 'ui.base.scenario.bridges' },
  { key: 'teleportersOpen', option: 'teleporters', label: 'ui.base.scenario.teleporters' },
] as const satisfies readonly { key: keyof DeploymentRouteScenario; option: keyof DeploymentRouteScenarioOptions; label: string }[];
const ROW_HEIGHT = 38;
const ROWS = TABLE.height / ROW_HEIGHT;
const NAME_X = TABLE.x + 48, STATUS_X = TABLE.x + 460, PERSONAL_X = TABLE.x + 618;
type RowStatus = 'unplaced' | 'placed' | 'missed';
interface EditorRow { label: string; status: RowStatus; personal: boolean; icon?: string; object?: BaseEditorObject;
  conflict?: PersistentCompositeConflictReason }
interface DragState { pointerId: number; x: number; y: number; offsetX: number; offsetY: number; started: boolean }
/** Why Apply did not save. `stale` means the draft was reloaded from the newer confirmed state. */
export type PersistentBaseEditorSaveResult = { readonly ok: true }
  | { readonly ok: false; readonly reason: 'stale' | 'blocked' | 'placement' | 'invalid' };
/** What a stage is built for: the next round's terrain around the base, or the personal draft alone. */
export interface PersistentBaseEditorStageOptions {
  /** Terrain of the host's next map around the base (Lagekarte); `null` shows the base alone. */
  readonly terrain: PersistentBaseEditorTerrain | null;
  /** The draft the World is first built with; a stage prepared ahead uses the confirmed one. */
  readonly model: PersistentBaseEditorModel;
  readonly color: number;
}
/** One editing session on a ready stage. */
export interface PersistentBaseEditorOptions {
  readonly model: PersistentBaseEditorModel;
  readonly color: number;
  readonly newRewardIds: readonly PersistentBaseRewardId[];
  readonly save: () => Promise<PersistentBaseEditorSaveResult>;
  /** Teammates and ownership in the room, for teammates' buildings and conflicts on the map. */
  readonly room?: PersistentBaseEditorRoom | null;
  /** Range of the local player's turret as built in a round (personal upgrades included). */
  readonly resolveTurretRange?: (constructionId: string) => number | null;
  readonly close: () => void;
  readonly presented?: (view: AfterRoundView) => void;
  /** Once, when the session shows (the loading panel can go). */
  readonly revealed?: () => void;
  readonly retire?: () => void;
}
/** Bake budget per frame while the hidden stage prepares in the lobby, and while a player waits for it. */
export const PERSISTENT_BASE_EDITOR_BAKE_BUDGET_MS = { background: 1.5, urgent: 24 } as const;
/** Build steps per lobby frame while the stage prepares in the background (at least one step). */
export const PERSISTENT_BASE_EDITOR_BUILD_SLICE_MS = 4;
/**
 * Hidden cameras never draw, so a stage's first visible frame would link its shaders and allocate
 * its buffers. Before it counts as ready it draws this many frames at an invisible alpha.
 */
export const PERSISTENT_BASE_EDITOR_WARM_FRAMES = 2;
const WARM_ALPHA = .001;

/**
 * Menu-only input over a small regular World. No avatar or movement bindings. The draft is
 * canonical; the World shows it turned by the base orientation, and input is turned back.
 *
 * The scene is a stage that outlives its sessions: World, cameras, chrome and overview are built
 * once (ahead, hidden, in the lobby) and rest between sessions; `open` lays a session's draft,
 * list and tools over it and `closeSession` takes them away again.
 */
export class PersistentBaseEditorScene extends Phaser.Scene {
  static readonly KEY = 'PersistentBaseEditor';
  /** Fade-in of a session on a ready stage. */
  static readonly REVEAL_MS = 150;
  private quality!: GraphicsQualityController;
  private world!: PersistentBaseEditorWorld;
  private cameraRegistry!: ClarityCameraRegistry;
  private clarity!: Phaser.Cameras.Scene2D.Camera;
  /** Long-lived chrome: frame, titles, overview, table, pager and actions. */
  private chrome!: Phaser.GameObjects.Container;
  /** The open session's own objects (boundary, expansion ring); rebuilt for every session. */
  private ui: Phaser.GameObjects.Container | null = null;
  private list!: Phaser.GameObjects.Container;
  private grid!: Phaser.GameObjects.Graphics;
  private preview!: Phaser.GameObjects.Graphics;
  private selection!: Phaser.GameObjects.Graphics;
  private expansionPreview: Phaser.GameObjects.Container | null = null;
  private dragPreview: Phaser.GameObjects.Container | null = null;
  private tableOutline!: Phaser.GameObjects.Rectangle;
  private stats!: Phaser.GameObjects.Text;
  private error!: Phaser.GameObjects.Text;
  private pageText!: Phaser.GameObjects.Text;
  private previous!: UiButton;
  private next!: UiButton;
  private rotate!: UiButton;
  private rangesButton!: UiButton;
  private hostRoomBase!: Phaser.GameObjects.Text;
  private buttons: UiButton[] = [];
  private rowBackgrounds = new Map<string, Phaser.GameObjects.Rectangle>();
  private selected: BaseEditorObject | null = null;
  private drag: DragState | null = null;
  private saving = false;
  /** No session is open. A stage starts closed and returns to it after every session. */
  private closed = true;
  private disposed = false;
  /** The stage's World is ready to show; until then it prepares hidden. */
  private ready = false;
  private readyWaiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  private urgent = false;
  /** The open session shows. */
  private presentationReady = false;
  private revealTween: Phaser.Tweens.Tween | null = null;
  private framesShown = 0;
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
  /** The routes' what-if; every session starts with the round as it starts. */
  private scenario: DeploymentRouteScenario = DEPLOYMENT_ROUTE_START;
  private readonly scenarioButtons = new Map<keyof DeploymentRouteScenario, UiButton>();
  private options: PersistentBaseEditorOptions | null = null;
  /** The stage's remaining build steps; `null` once built. */
  private building: Generator<ArenaBuildPause, void> | null = null;
  /** The next build step is heavy; in the background it waits for a calm lobby. */
  private heavyNext = false;
  private calm = false;
  private warmFrames = 0;
  /** Most bake jobs seen pending: the base of `progress`, which never moves back. */
  private mostPendingBakes = 0;
  private shownProgress = 0;
  constructor(private readonly stage: PersistentBaseEditorStageOptions) {
    super(PersistentBaseEditorScene.KEY);
    this.expansion = expansionFor(stage.model);
    const terrainSite = stage.terrain?.definition.persistentBaseSite;
    if (stage.terrain && terrainSite) {
      const { widthCells, heightCells } = stage.terrain.definition.metrics;
      const detail = getPersistentBaseEditorDetailWindow({ widthCells, heightCells }, terrainSite.anchor, PERSISTENT_BASE_EDITOR_DETAIL_RADIUS);
      this.framing = getPersistentBaseEditorWorldFraming(WORLD_PANEL, { x: detail.minX * CELL_SIZE, y: detail.minY * CELL_SIZE,
        width: (detail.maxX - detail.minX + 1) * CELL_SIZE, height: (detail.maxY - detail.minY + 1) * CELL_SIZE }, terrainSite.anchor);
    } else {
      this.framing = getPersistentBaseEditorFraming(WORLD_PANEL, stage.model.area, this.expansion?.area);
    }
  }
  /** The terrain this stage shows; `null` for the personal draft alone. */
  get terrain(): PersistentBaseEditorTerrain | null { return this.stage.terrain; }
  private get view() { return this.framing.view; }
  /** Overview of the whole map beside the table; without map terrain a short note. */
  private *createSituationMap(): Generator<ArenaBuildPause, void> {
    const panel = PERSISTENT_BASE_EDITOR_MINIMAP_PANEL, terrain = this.stage.terrain, chrome = this.chrome;
    chrome.add(this.add.rectangle(panel.x, panel.y, panel.width, panel.height, 0x101b14, .55)
      .setOrigin(0).setStrokeStyle(1, 0x718160, .5));
    const title = terrain ? `${t('ui.base.situationMap')} · ${getMapName(terrain.mapId, getLocale())}` : t('ui.base.situationMap');
    this.label(panel.x + 4, HEADER_Y, title.toLocaleUpperCase(), 'section', 0, undefined, chrome);
    // The World shows the map at the time the round starts.
    if (terrain) this.label(panel.x + panel.width - 4, HEADER_Y, t('ui.base.missionTime', { time: formatTimeOfDay(this.world.timeOfDay) }),
      'caption', 1, undefined, chrome).setColor('#d9cfa8');
    if (!terrain) {
      this.label(panel.x + panel.width / 2, panel.y + panel.height / 2, t('ui.base.noSituationMap'), 'body', .5, panel.width - 40, chrome)
        .setColor('#d9cfa8');
      return;
    }
    const view = this.world.view;
    // Where routes cannot be shown on the base, the reason gets its own strip below the overview.
    const plan = this.world.planRoutes();
    const hint = this.routeHintText(plan);
    const hintHeight = hint ? 30 : 0;
    const options = this.world.scenarioOptions;
    const switches = SCENARIO_SWITCHES.filter((entry) => options?.[entry.option]);
    const switchHeight = switches.length ? 44 : 0;
    const legendHeight = 26;
    yield;
    this.minimap = createPersistentBaseEditorMinimap(this, {
      layout: terrain.layout, widthCells: terrain.definition.metrics.widthCells, heightCells: terrain.definition.metrics.heightCells,
      bases: this.world.world.bases, persistentBaseId: this.world.world.persistentBaseSite?.baseId ?? null,
      spawnZones: terrain.definition.spawnZones ?? [],
      detail: { minX: view.x / CELL_SIZE, minY: view.y / CELL_SIZE,
        maxX: (view.x + view.width) / CELL_SIZE - 1, maxY: (view.y + view.height) / CELL_SIZE - 1 },
    }, { x: panel.x + 8, y: panel.y + 8, width: panel.width - 16, height: panel.height - 16 - legendHeight - hintHeight - switchHeight });
    chrome.add(this.minimap.image);
    yield;
    const origin = this.minimap.cellToScreen(0, 0);
    this.world.attachRouteMinimap(chrome, { originX: origin.x - this.minimap.scale / 2, originY: origin.y - this.minimap.scale / 2,
      unit: this.minimap.scale / CELL_SIZE });
    // The strip exists only where the prepared plan needed it; a session's plans update its text.
    this.createLegend(panel.y + panel.height - switchHeight - hintHeight - legendHeight / 2 - 6, {
      routes: (plan?.routes.length ?? 0) > 0, spawn: (terrain.definition.spawnZones ?? []).length > 0,
      hostile: this.world.world.bases.some((base) => base.faction === 'hostile' && base.surface !== 'none') });
    if (hint !== null) this.routeHint = this.label(panel.x + panel.width / 2, panel.y + panel.height - switchHeight - hintHeight / 2 - 6, hint, 'caption', .5,
      panel.width - 40, chrome).setColor('#e3d2ff');
    // The what-if switches replan the routes on the spot: a fallen outpost, a blown bridge, an open teleporter.
    if (switches.length) {
      const rowY = panel.y + panel.height - 26;
      const caption = this.label(panel.x + 16, rowY, t('ui.base.scenario.title'), 'caption', 0, undefined, chrome).setColor('#d9cfa8');
      const left = panel.x + 16 + caption.width + 14, gap = 10;
      const width = Math.min(200, (panel.x + panel.width - 12 - left - gap * (switches.length - 1)) / switches.length);
      switches.forEach((entry, index) => {
        const button = this.button(left + width / 2 + index * (width + gap), rowY, width, 32, t(entry.label),
          () => this.toggleScenario(entry.key), 'box');
        this.scenarioButtons.set(entry.key, button);
      });
      this.syncScenarioButtons();
    }
    // No free path: the warning sits on the World view, where the breach glows.
    const warning = this.add.container(WORLD_PANEL.x + WORLD_PANEL.width / 2, this.view.y + this.view.height - 30).setVisible(false);
    const text = this.add.text(0, 0, t('ui.base.routes.breach').toLocaleUpperCase(), textStyle('label', { color: 0xffd0da }))
      .setOrigin(.5).setStroke('#2a0610', 4);
    warning.add([this.add.rectangle(0, 0, text.width + 48, 36, 0x3a0a18, .82).setStrokeStyle(2, 0xff5a7a, .9), text]);
    this.tweens.add({ targets: warning, alpha: { from: 1, to: .6 }, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    chrome.add(warning);
    this.breachWarning = warning;
  }
  private get worldZoom(): number { return this.framing.zoom; }

  /** Starts the stage: hidden, without a session; `update` builds it in steps until `open` can show it. */
  create(): void {
    this.quality = new GraphicsQualityController(getStoredGraphicsQuality());
    this.quality.attach(this);
    this.clarity = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'base-ui');
    // Hidden until a session shows: the previous menu or the lobby stays visible meanwhile.
    this.getTransitionView().setAlpha(0);
    this.cameraRegistry = new ClarityCameraRegistry(this, this.cameras.main, this.clarity);
    this.cameraRegistry.install();
    this.chrome = this.add.container(0, 0);
    this.cameraRegistry.promote(this.chrome);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    this.setTransitionInputBlocked(true);
    this.building = this.buildStage();
  }

  /** Chrome, World, overview and handlers, in steps short enough for a lobby frame. */
  private *buildStage(): Generator<ArenaBuildPause, void> {
    const chrome = this.chrome;
    const menu = UPGRADE_MENU;
    // Match Upgrades: the existing lobby remains visible outside the timber frame.
    for (const crop of this.outsideWorld(0, 0, GAME_WIDTH, GAME_HEIGHT)) {
      chrome.add(this.add.rectangle(crop.x, crop.y, crop.width, crop.height, menu.dimColor, menu.dimAlpha).setOrigin(0));
    }
    const panel = ensureModalPanelTexture(this, '_base_panel', menu.width, menu.height);
    this.addBackdrop(panel, menu.width - 80, menu.height - 80);
    this.addBackdrop(MATCH_RESULTS_BACKGROUND.key, menu.width - menu.forestInsetX,
      menu.height - menu.forestInsetY, menu.forestTint);
    chrome.add(this.add.image(menu.centerX, menu.centerY, ensureModalFrame(this, menu.width, menu.height))
      .setDisplaySize(menu.width, menu.height));
    const headerArt = PERSISTENT_BASE_HEADER;
    const headerReady = this.textures.exists(headerArt.key);
    const header = this.add.image(menu.centerX, menu.headerY, headerReady ? headerArt.key
      : ensureGlossyButtonTexture(this, 'base-header', headerArt.width, headerArt.height, INTENT.neutral.fill))
      .setDisplaySize(headerArt.width, headerArt.height);
    chrome.add(header);
    if (!headerReady) {
      // The lobby owns deferred loading; opening this menu early must not enqueue a second load.
      const event = Phaser.Textures.Events.ADD_KEY + headerArt.key;
      const refresh = () => header.setTexture(headerArt.key).setDisplaySize(headerArt.width, headerArt.height);
      this.textures.once(event, refresh);
      header.once('destroy', () => this.textures.off(event, refresh));
    }
    this.label(menu.centerX, menu.headerY + 4, t('ui.base.title').toLocaleUpperCase(), 'display', .5, undefined, chrome)
      .setFontSize(44).setColor('#efe4bd').setStroke('#1e160f', 3);
    this.label(menu.centerX, 170, t('ui.base.subtitle'), 'body', .5, 1700, chrome);
    yield;
    this.stats = this.label(WORLD_PANEL.x + 4, HEADER_Y, '', 'section', 0, undefined, chrome);
    // One frame for every map: the World sits in its middle, the rest of the panel is a dark mat.
    for (const mat of this.outsideWorld(WORLD_PANEL.x, WORLD_PANEL.y, WORLD_PANEL.width, WORLD_PANEL.height)) {
      if (mat.width > 0 && mat.height > 0) chrome.add(this.add.rectangle(mat.x, mat.y, mat.width, mat.height, 0x0b120d, .94).setOrigin(0));
    }
    chrome.add(this.add.rectangle(this.view.x, this.view.y, this.view.width, this.view.height).setOrigin(0)
      .setStrokeStyle(1, 0x718160, .55));
    const frameWidth = WORLD_PANEL.width + 40, frameHeight = WORLD_PANEL.height + 40;
    chrome.add(this.add.image(WORLD_PANEL.x + WORLD_PANEL.width / 2, WORLD_PANEL.y + WORLD_PANEL.height / 2,
      ensureUpgradeFrame(this, frameWidth, frameHeight)).setDisplaySize(frameWidth, frameHeight));
    const columnsY = TABLE.y - 20;
    this.label(TABLE.x + 16, columnsY, t('ui.base.rewards'), 'section', 0, undefined, chrome);
    this.label(STATUS_X, columnsY, t('ui.base.status'), 'section', .5, undefined, chrome);
    this.label(PERSONAL_X, columnsY, t('ui.base.personal'), 'section', .5, undefined, chrome);
    this.tableOutline = this.add.rectangle(TABLE.x, TABLE.y, TABLE.width, TABLE.height, 0x101b14, .25)
      .setOrigin(0).setStrokeStyle(1, 0x718160, .5);
    chrome.add(this.tableOutline);
    this.list = this.add.container(0, 0); chrome.add(this.list);
    const pagerY = TABLE.y + TABLE.height + 28;
    this.previous = this.button(TABLE.x + 58, pagerY, 108, 36, '‹', () => this.changePage(-1));
    this.next = this.button(TABLE.x + TABLE.width - 58, pagerY, 108, 36, '›', () => this.changePage(1));
    this.pageText = this.label(TABLE.x + TABLE.width / 2, pagerY, '', 'body', .5, undefined, chrome);
    this.error = this.label(menu.centerX, 192, '', 'caption', .5, 1600, chrome).setColor('#ffc2a9').setVisible(false);
    this.actionButton('cancel', menu.centerX - (menu.buttonGap + menu.buttonWidth) / 2, () => this.finish());
    this.actionButton('apply', menu.centerX + (menu.buttonGap + menu.buttonWidth) / 2, () => { void this.save(); });
    // Tools sit in the header row, right of the stage; the bottom keeps only Cancel and Apply.
    const right = WORLD_PANEL.x + WORLD_PANEL.width;
    this.rangesButton = this.button(right - 95, HEADER_Y, 190, 32, t('ui.base.ranges'), () => {
      this.showRanges = !this.showRanges;
      this.rangesButton.setIcon(this.showRanges ? 'box-checked' : 'box');
      this.refreshRanges();
    }, 'box');
    // Rewards and the orientation belong to the room host: a session shows either the tool or the note.
    this.rotate = this.button(right - 190 - 10 - 85, HEADER_Y, 170, 32, t('ui.base.rotate'), () => {
      if (this.drag || this.saving || !this.options?.model.rotate()) return;
      this.syncDraft();
    });
    this.hostRoomBase = this.label(right - 200 - 8, HEADER_Y, t('ui.base.hostRoomBase'), 'caption', 1, 420, chrome).setColor('#d9cfa8');
    yield;
    this.world = new PersistentBaseEditorWorld(this, this.stage.model, this.stage.color,
      { previewArea: this.expansion?.area, terrain: this.stage.terrain });
    yield* this.world.build();
    yield;
    const situationMap = loadingTimeline.start();
    yield* this.createSituationMap();
    loadingTimeline.end('editor/situation-map', situationMap);
    this.grid = this.add.graphics().setDepth(10000).setVisible(false);
    this.selection = this.add.graphics().setDepth(10001);
    this.preview = this.add.graphics().setDepth(10002);
    this.conflictHalo = this.add.graphics().setDepth(10003);
    this.tweens.add({ targets: this.conflictHalo, alpha: { from: 1, to: .35 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.resize();
    this.scale.on('resize', this.resize, this);
    // Handlers stay for the stage's lifetime and act on the session that is open.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const model = this.options?.model;
      if (!model || this.saving || this.closed || pointer.button !== 0) return;
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
      if (!this.closed && !this.drag && this.isOverTable(pointer) && dy !== 0) this.changePage(Math.sign(dy));
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.saving || this.closed) return;
      if (this.drag) this.endDrag(); else this.finish();
    });
    this.input.keyboard?.on('keydown-DELETE', () => {
      const model = this.options?.model;
      if (model && !this.saving && !this.closed && this.selected && model.getPosition(this.selected)) {
        model.remove(this.selected); this.endDrag(); this.syncDraft();
      }
    });
  }

  /**
   * Runs build steps: a slice of the lobby frame in the background, all of them while a player waits.
   * A heavy step gets a frame of its own and, in the background, waits for a calm lobby.
   */
  private stepBuild(): void {
    const building = this.building!;
    const deadline = this.urgent ? Infinity : performance.now() + PERSISTENT_BASE_EDITOR_BUILD_SLICE_MS;
    do {
      if (this.heavyNext && !this.urgent && !this.calm) return;
      const step = building.next();
      if (step.done) { this.building = null; return; }
      this.heavyNext = step.value === 'heavy';
      if (this.heavyNext && !this.urgent) return;
    } while (!this.disposed && performance.now() < deadline);
  }

  /** Invisible frames before the stage counts as ready; the first one is heavy and waits for calm. */
  private warm(): void {
    const view = this.getTransitionView();
    if (this.warmFrames < PERSISTENT_BASE_EDITOR_WARM_FRAMES) {
      if (this.warmFrames === 0 && !this.urgent && !this.calm) return;
      this.warmFrames++;
      view.setAlpha(WARM_ALPHA);
      return;
    }
    view.setAlpha(0);
    this.ready = true;
    for (const waiter of this.readyWaiters.splice(0)) waiter.resolve();
  }

  /**
   * Share of the preparation done, counted in bake jobs; the build itself runs in one go once a
   * player waits. It never moves back.
   */
  progress(): number {
    if (this.ready) return 1;
    if (this.building || !this.world) return this.shownProgress;
    const pending = getChunkBakeScheduler(this).pendingJobs;
    this.mostPendingBakes = Math.max(this.mostPendingBakes, pending);
    const baked = this.mostPendingBakes > 0 ? 1 - pending / this.mostPendingBakes : 1;
    // The invisible warm frames finish the last few percent.
    this.shownProgress = Math.max(this.shownProgress, .95 * baked);
    return this.shownProgress;
  }

  /** The stage's World is ready: a session opens at once. */
  isReady(): boolean { return this.ready; }
  /** Settles once the World is ready; rejects when the stage goes first. */
  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.disposed) return Promise.reject(new Error('Base editor stage disposed'));
    return new Promise((resolve, reject) => { this.readyWaiters.push({ resolve, reject }); });
  }
  /** A player waits for this stage: its bakes may take most of the frame. */
  setUrgent(urgent: boolean): void { this.urgent = urgent; }
  /** The lobby is calm (the player stands still or a menu is open): a heavy build step may run now. */
  setCalm(calm: boolean): void { this.calm = calm; }

  /** Lays a session over the ready stage and shows it. */
  open(options: PersistentBaseEditorOptions): void {
    if (this.disposed || !this.ready || !this.closed) throw new Error('[PersistentBaseEditorScene] The stage cannot open a session now');
    this.options = options;
    this.closed = false; this.saving = false; this.selected = null; this.drag = null; this.page = 0;
    this.showRanges = false; this.conflicts = new Map(); this.framesShown = 0;
    this.rangesButton.setIcon('box');
    const model = options.model;
    this.scenario = DEPLOYMENT_ROUTE_START;
    this.world.setScenario(this.scenario);
    this.syncScenarioButtons();
    this.world.setModel(model, options.color);
    this.stats.setText(t(model.area.kind === 'radius' ? 'ui.base.statsRadius' : 'ui.base.stats', {
      stage: model.areaStage, hp: resolvePersistentBaseMaxHp(model.baseline.persistentBaseHealthRewards),
      radius: model.area.kind === 'radius' ? model.area.radiusCells : 0,
    }));
    this.rotate.getRoot().setVisible(model.rewardsEditable);
    this.hostRoomBase.setVisible(!model.rewardsEditable);
    const ui = this.ui = this.add.container(0, 0);
    this.cameraRegistry.promote(ui);
    ui.add(createPersistentBaseEditorBoundary(this, model.area, this.framing));
    const expansion = expansionFor(model);
    if (expansion?.edges.length) {
      this.expansionPreview = createDawnMerchantExpansionPreview(this, this.framing, expansion.edges,
        t(expansion.dawnOnly ? 'ui.base.expansionRingLabelDawnOnly' : 'ui.base.expansionRingLabel',
          { radius: expansion.radius, cost: expansion.cost }));
      ui.add(this.expansionPreview);
    } else if (expansion?.reward?.kind === 'core') {
      this.expansionPreview = createDawnExpansionRewardNote(this, this.framing,
        t('ui.base.expansionCoreReward', { hp: expansion.reward.coreHpBonus, cost: expansion.cost }));
      ui.add(this.expansionPreview);
    }
    const extent = getPersistentBaseBuildAreaExtentCells(model.area);
    const anchor = this.world.anchor;
    this.grid.clear().lineStyle(1, 0xbdc99c, .18);
    for (let y = -extent; y <= extent; y++) for (let x = -extent; x <= extent; x++) {
      if (isCellInsidePersistentBaseBuildArea(x, y, model.area))
        this.grid.strokeRect((anchor.gridX + x) * CELL_SIZE, (anchor.gridY + y) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
    this.refreshPreview(); this.refreshList();
    this.present();
  }

  /** Ends the session; the stage stays, hidden and resting, for the next one. */
  closeSession(): void {
    if (this.disposed) return;
    this.closed = true; this.presentationReady = false; this.saving = false;
    this.revealTween?.remove(); this.revealTween = null;
    this.getTransitionView().setAlpha(0);
    this.setTransitionInputBlocked(true);
    this.endDrag(); this.selected = null;
    this.ui?.destroy(true); this.ui = null; this.expansionPreview = null;
    for (const ring of this.rangeRings.values()) ring.destroy();
    this.rangeRings.clear();
    this.list.removeAll(true); this.rowBackgrounds.clear();
    this.grid.clear().setVisible(false); this.selection.clear(); this.conflictHalo.clear();
    this.error.setVisible(false); this.breachWarning?.setVisible(false);
    this.options = null;
  }

  getTransitionView(): AfterRoundView {
    const options = this.options;
    return {
      depth: 0,
      // This Scene is rendered above ArenaScene, including both of its cameras.
      setDepth: () => {},
      setAlpha: alpha => { for (const camera of this.cameras.cameras) camera.setAlpha(alpha); },
      retire: () => options?.retire?.(),
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
    this.revealTween?.remove(); this.revealTween = null;
    this.building = null;
    this.dragPreview?.destroy(true);
    this.expansionPreview?.destroy(true); this.expansionPreview = null;
    for (const ring of this.rangeRings.values()) ring.destroy();
    this.rangeRings.clear();
    this.minimap?.destroy(); this.minimap = null;
    const run = loadingTimeline.get('editor');
    if (run?.endedAt === null) run.finish('cancelled');
    for (const waiter of this.readyWaiters.splice(0)) waiter.reject(new Error('Base editor stage disposed'));
    this.world?.destroy(); this.cameraRegistry?.destroy(); this.quality?.destroy();
    for (const button of this.buttons) button.destroy();
    this.buttons = [];
  }
  private label(x: number, y: number, value: string, role: Parameters<typeof textStyle>[0], origin = 0, width?: number,
    into: Phaser.GameObjects.Container | null = this.ui) {
    const label = this.add.text(x, y, value, textStyle(role, { color: TEXT.primary })).setOrigin(origin, .5);
    if (width) label.setWordWrapWidth(width);
    into?.add(label); return label;
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
      this.chrome.add(image);
    }
  }
  private button(x: number, y: number, w: number, h: number, label: string, onClick: () => void, icon?: UiIconName) {
    const button = new UiButton(this, { x, y, w, h, label, skin: 'forest', onClick, isEnabled: () => !this.saving,
      ...(icon ? { icon, iconSize: 14 } : {}) });
    this.buttons.push(button); this.chrome.add(button.getRoot()); return button;
  }
  private actionButton(kind: 'cancel' | 'apply', x: number, onClick: () => void): void {
    const { buttonWidth: w, buttonHeight: h, buttonY: y } = UPGRADE_MENU;
    const texture = kind === 'apply' ? ensureUpgradeApply(this, w, h) : ensureGlossyButtonTexture(this, kind, w, h, INTENT.neutral.fill);
    const image = this.add.image(x, y, texture).setInteractive({ cursor: BUTTON_CURSOR });
    const label = this.label(x, y, t(`ui.upgrades.${kind}`), 'label', .5, undefined, this.chrome).setFontSize(22);
    if (kind === 'apply') label.setColor('#f3ffca');
    image.on('pointerdown', () => { if (!this.saving && !this.drag) activateUi(this, onClick); });
    attachHoverEffect(this, image, label);
    this.chrome.add(image); this.chrome.bringToTop(label);
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
    const cells = this.selected ? getBaseEditorAppearance(this.session.model, this.selected)?.footprint ?? [] : [];
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
      const appearance = getBaseEditorAppearance(this.session.model, this.selected);
      if (appearance) { this.dragPreview = createPersistentBaseDragPreview(this, appearance, this.session.color); this.ui?.add(this.dragPreview); }
    }
    const cell = this.cellAt(pointer);
    this.preview.clear();
    if (cell) {
      cell.x -= drag.offsetX; cell.y -= drag.offsetY;
      const valid = !this.session.model.validate(this.selected, cell.x, cell.y);
      this.drawFootprint(this.preview, cell.x, cell.y, valid ? 0xb1ed94 : 0xff9991, .2);
      const origin = this.worldOrigin(cell.x, cell.y);
      this.dragPreview?.setScale(this.worldZoom).setPosition(
        this.view.x + ((origin.gridX + .5) * CELL_SIZE - this.framing.world.x) * this.worldZoom,
        this.view.y + ((origin.gridY + .5) * CELL_SIZE - this.framing.world.y) * this.worldZoom);
    } else {
      const offset = rotatePersistentBaseOffset(drag.offsetX, drag.offsetY, this.world.frame.quarterTurns);
      this.dragPreview?.setScale(1).setPosition(pointer.x / scale - offset.dx * CELL_SIZE, pointer.y / scale - offset.dy * CELL_SIZE);
    }
    const removing = this.isOverTable(pointer) && !!this.session.model.getPosition(this.selected);
    this.tableOutline.setStrokeStyle(removing ? 2 : 1, removing ? 0xb1ed94 : 0x718160, removing ? 1 : .5);
  }
  private drop(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== pointer.id) return;
    let changed = false;
    if (drag.started && this.selected && !this.saving) {
      const model = this.session.model;
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
    const room = this.session.room;
    const preview = room ? resolvePersistentBaseEditorPreview({ model: this.session.model, frame: this.world.frame,
      siteArea: this.world.siteArea, room, isCellBlocked: (x, y) => this.world.isCellBlocked(x, y) }) : null;
    this.conflicts = preview?.conflicts ?? new Map();
    this.world.setMates(preview?.mates ?? []);
    this.conflictHalo.clear().lineStyle(3, 0xff5a4a, 1);
    for (const persistentId of this.conflicts.keys()) {
      const entry = this.session.model.constructions.find(p => p.persistentId === persistentId);
      const appearance = entry && getBaseEditorAppearance(this.session.model, { kind: 'construction', id: persistentId });
      if (!entry || !appearance) continue;
      const placed = toWorldFootprint(this.world.frame, entry.relativeGridX, entry.relativeGridY, appearance.footprint);
      for (const cell of placed.footprint) {
        this.conflictHalo.strokeRect((placed.gridX + cell.dx) * CELL_SIZE + 2, (placed.gridY + cell.dy) * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      }
    }
    this.refreshRanges();
    this.refreshRoutes();
  }
  /** What the overview's colours mean, for what this map has: routes, spawn zones, enemy bases, the own base, the view. */
  private createLegend(y: number, has: { readonly routes: boolean; readonly spawn: boolean; readonly hostile: boolean }): void {
    const panel = PERSISTENT_BASE_EDITOR_MINIMAP_PANEL, colors = PERSISTENT_BASE_EDITOR_MINIMAP_COLORS;
    const color = (css: string) => Number.parseInt(css.slice(1), 16);
    const all: { show: boolean; label: string; draw: (g: Phaser.GameObjects.Graphics, x: number) => void }[] = [
      { show: has.routes, label: t('ui.base.legend.routes'), draw: (g, x) => g.lineStyle(3, 0xb347ff, 1).lineBetween(x, y + 2, x + 14, y - 2) },
      { show: has.spawn, label: t('ui.base.legend.spawn'), draw: (g, x) => g.fillStyle(color(colors.spawnZone), .7).fillRect(x + 1, y - 6, 12, 12) },
      { show: has.hostile, label: t('ui.base.legend.hostile'), draw: (g, x) => g.fillStyle(color(colors.hostileBase), 1).fillRect(x + 1, y - 6, 12, 12) },
      { show: true, label: t('ui.base.legend.base'), draw: (g, x) => g.fillStyle(color(colors.persistentBase), 1).fillRect(x + 1, y - 6, 12, 12) },
      { show: true, label: t('ui.base.legend.view'), draw: (g, x) => g.lineStyle(2, color(colors.frame), 1).strokeRect(x + 1, y - 6, 12, 12) },
    ];
    const entries = all.filter((entry) => entry.show);
    const graphics = this.add.graphics();
    this.chrome.add(graphics);
    const texts = entries.map((entry) => this.label(0, y, entry.label, 'caption', 0, undefined, this.chrome).setColor('#d9cfa8'));
    const gap = 22, swatch = 20;
    const total = texts.reduce((sum, text) => sum + swatch + text.width, 0) + gap * (texts.length - 1);
    let x = panel.x + (panel.width - total) / 2;
    entries.forEach((entry, index) => {
      entry.draw(graphics, x);
      texts[index]!.setX(x + swatch);
      x += swatch + texts[index]!.width + gap;
    });
  }
  private toggleScenario(key: keyof DeploymentRouteScenario): void {
    if (this.closed || this.saving || this.drag) return;
    this.scenario = { ...this.scenario, [key]: !this.scenario[key] };
    this.syncScenarioButtons();
    this.world.setScenario(this.scenario);
    this.refreshRoutes();
  }
  private syncScenarioButtons(): void {
    for (const [key, button] of this.scenarioButtons) {
      const on = this.scenario[key];
      button.setIcon(on ? 'box-checked' : 'box').setIntent(on ? 'accent' : 'neutral');
    }
  }
  /** The next round's enemy routes with the draft as it stands, and what the view cannot show. */
  private refreshRoutes(): void {
    const plan = this.world.planRoutes();
    this.breachWarning?.setVisible(!!plan?.routes.some((route) => route.relevant && route.breach));
    const hint = this.routeHintText(plan);
    this.routeHint?.setText(hint ?? '').setVisible(hint !== null);
  }
  private routeHintText(plan: DeploymentRoutePlan | null): string | null {
    return plan?.hint === 'front-base' ? t('ui.base.routes.frontBase')
      : plan?.hint === 'players-away' ? t('ui.base.routes.playersAway') : null;
  }
  /** Rings of every own turret while toggled on; the selected turret always shows its ring. */
  private refreshRanges(): void {
    const model = this.session.model, frame = this.world.frame;
    const wanted = new Map<string, { x: number; y: number; radius: number }>();
    const consider = (object: BaseEditorObject, position: { relativeGridX: number; relativeGridY: number } | undefined, constructionId: string | undefined) => {
      const key = baseEditorObjectKey(object);
      const selected = this.selected !== null && baseEditorObjectKey(this.selected) === key;
      if (!position || !constructionId || (!this.showRanges && !selected)) return;
      // Personal turrets carry the builder's upgrades; base-owned reward turrets their authored range.
      const id = normalizeConstructionId(constructionId);
      const definition = id ? getCoopDefenseConstructionDefinition(id) : null;
      const radius = object.kind === 'construction' ? this.session.resolveTurretRange?.(constructionId) ?? null
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
      visual.show(ring.x, ring.y, ring.radius, this.session.color, true, 0);
    }
  }
  private drawFootprint(graphics: Phaser.GameObjects.Graphics, x: number, y: number, color: number, alpha: number): void {
    if (!this.selected) return;
    const cells = getBaseEditorAppearance(this.session.model, this.selected)?.footprint ?? [{ dx: 0, dy: 0 }];
    const placed = toWorldFootprint(this.world.frame, x, y, cells);
    graphics.fillStyle(color, alpha).lineStyle(2, color, 1);
    for (const offset of placed.footprint) {
      const wx = (placed.gridX + offset.dx) * CELL_SIZE, wy = (placed.gridY + offset.dy) * CELL_SIZE;
      graphics.fillRect(wx, wy, CELL_SIZE, CELL_SIZE).strokeRect(wx + 1, wy + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    }
  }
  private objectLabel(object: BaseEditorObject): string {
    if (object.kind === 'reward') return t(getPersistentBaseRewardDefinition(object.id).presentation.labelKey);
    const construction = this.session.model.getConstruction(object.id);
    return t(construction?.tool.kind === 'utility' ? `loadout.${construction.tool.id}.name` : `construction.${construction?.tool.id}.name`);
  }
  private rows(): EditorRow[] {
    const model = this.session.model;
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
    if (!rows.length) this.list.add(this.add.text(TABLE.x + TABLE.width / 2, TABLE.y + TABLE.height / 2, t('ui.base.empty.all'),
      textStyle('body', { color: TEXT.muted })).setOrigin(.5).setWordWrapWidth(TABLE.width - 80).setAlign('center'));
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
    const position = this.selected && this.session.model.getPosition(this.selected);
    if (position) this.drawFootprint(this.selection, position.relativeGridX, position.relativeGridY, 0xe4d499, .1);
    this.grid.setVisible(this.selected !== null);
    if (this.world) this.refreshRanges();
  }
  private async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true; this.endDrag(); this.error.setVisible(false);
    let result: PersistentBaseEditorSaveResult = { ok: true };
    try {
      if (this.session.model.dirty) result = await this.session.save();
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
  private finish(): void {
    if (this.closed) return;
    const session = this.session;
    this.closed = true; session.close();
  }
  /** The open session; editing paths run only while one is open. */
  private get session(): PersistentBaseEditorOptions {
    if (!this.options) throw new Error('[PersistentBaseEditorScene] No session is open');
    return this.options;
  }
  /** Shows the open session: the after-round transition fades it in, otherwise a short fade of its own. */
  private present(): void {
    const session = this.session;
    this.presentationReady = true;
    session.revealed?.();
    const transition = this.getTransitionView();
    if (session.presented) { session.presented(transition); return; }
    this.setTransitionInputBlocked(false);
    const fade = { alpha: 0 };
    transition.setAlpha(0);
    this.revealTween = this.tweens.add({ targets: fade, alpha: 1, duration: PersistentBaseEditorScene.REVEAL_MS, ease: 'Sine.easeOut',
      onUpdate: () => transition.setAlpha(fade.alpha),
      onComplete: () => { this.revealTween = null; transition.setAlpha(1); } });
  }
  /** The Bauhof's loading run: reveal barriers until shown, then a few frames for first-render work. */
  private measureLoading(view: { x: number; y: number; width: number; height: number }): void {
    const run = loadingTimeline.get('editor');
    if (!run || run.endedAt !== null) return;
    for (const [gate, ready] of Object.entries(this.world.getRevealGates(view))) run.gate(gate, ready);
    if (this.presentationReady && ++this.framesShown >= 3) run.finish('ready');
  }
  update(now: number, delta: number): void {
    if (this.disposed) return;
    if (this.building) { this.stepBuild(); return; }
    if (!this.world) return;
    // A ready stage without a session rests until the next one.
    if (this.ready && this.closed) return;
    const view = this.world.view;
    const budget = this.ready ? undefined
      : this.urgent ? PERSISTENT_BASE_EDITOR_BAKE_BUDGET_MS.urgent : PERSISTENT_BASE_EDITOR_BAKE_BUDGET_MS.background;
    this.world.update(now, delta, view, budget);
    this.measureLoading(view);
    if (!this.ready && this.world.isReadyForView(view)) this.warm();
  }
}

/** The next ring the merchant can sell for this draft's base. */
function expansionFor(model: PersistentBaseEditorModel): ReturnType<typeof buildPersistentBaseExpansionPreview> {
  // The local menu uses the lobby ceiling but can edit a personal area larger than that site.
  const site = resolveWorldDefinition({ definitionId: LOBBY_WORLD_DEFINITION_ID }, null)?.persistentBaseSite;
  const baseline = model.baseline;
  return site ? buildPersistentBaseExpansionPreview(baseline.dawn,
    baseline.persistentBaseAreaStage, isDawnUnlocked(baseline), site.maxAreaStage) : null;
}
