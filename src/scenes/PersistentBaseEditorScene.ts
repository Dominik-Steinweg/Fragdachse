import * as Phaser from 'phaser';
import { createPersistentBaseEditorMinimap, PERSISTENT_BASE_EDITOR_MINIMAP_COLORS, type PersistentBaseEditorMinimap } from '../ui/PersistentBaseEditorMinimap';
import { getMapName } from '../i18n/contentPresentation';
import { getCoopDefenseConstructionDefinition, normalizeConstructionId } from '../config/coopDefenseConstructions';
import type { AfterRoundView } from '../ui/AfterRoundTransition';
import { CELL_SIZE, DEPTH, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { getStoredGraphicsQuality } from '../utils/localPreferences';
import { getRenderScale } from '../graphics/RenderResolution';
import { ClarityCameraRegistry } from './arena/ClarityCameraRegistry';
import { PersistentBaseEditorWorld, type PersistentBaseEditorTerrain } from '../persistentBase/PersistentBaseEditorWorld';
import { resolvePersistentBaseEditorPreview, type PersistentBaseEditorRoom } from '../persistentBase/PersistentBaseEditorPreview';
import type { DeploymentRoutePlan } from '../activity/DeploymentRoutes';
import type { PersistentCompositeConflictReason } from '../persistentBase/PersistentBaseComposite';
import { getMissedBaseRewards, type BaseEditorObject, type BaseEditorPlacementFailure, type PersistentBaseEditorDraftState,
  type PersistentBaseEditorModel } from '../persistentBase/PersistentBaseEditorModel';
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
import { UiButton } from '../ui/UiButton';
import { INTENT } from '../ui/uiTheme';
import { BUTTON_CURSOR } from '../ui/gameCursor';
import { activateUi } from '../ui/UiAudio';
import { attachHoverEffect } from '../ui/uiHover';
import { getLocale, t } from '../i18n';
import { isDawnUnlocked } from '../dawn/rules/DawnUnlock';
import { buildPersistentBaseExpansionPreview, getPersistentBaseEditorDetailRect, getPersistentBaseEditorFraming,
  getPersistentBaseEditorWorldFraming, PERSISTENT_BASE_EDITOR_VIEW_SIZE, type PersistentBaseEditorFraming } from '../persistentBase/PersistentBaseExpansionPreview';
import { createDawnExpansionRewardNote } from '../ui/DawnMerchantExpansionPreview';
import { createDawnMerchantExpansionPreview } from '../ui/DawnMerchantExpansionPreview';
import { PersistentBaseInventory, type PersistentBaseInventoryCard } from '../ui/PersistentBaseInventory';
import { PersistentBaseRangeField, type PersistentBaseRangeRing } from '../ui/PersistentBaseRangeField';
import { createPersistentBaseAreaHalo } from '../ui/PersistentBaseAreaHalo';
import { resolveWorldDefinition } from '../world/WorldDefinitionResolution';
import { LOBBY_WORLD_DEFINITION_ID } from '../config/authoring/lobbyWorld';
import { formatTimeOfDay } from '../effects/TimeOfDay';
import type { ArenaBuildPause } from '../arena/ArenaBuilder';
import { DEPLOYMENT_ROUTE_START, type DeploymentRouteScenario, type DeploymentRouteScenarioOptions } from '../activity/DeploymentRoutes';
import type { UiIconName } from '../ui/uiTextures';
import { getChunkBakeScheduler } from '../arena/chunks/ChunkBakeScheduler';
import { loadingTimeline } from '../diagnostics/LoadingTimeline';

const WORLD_PANEL = { x: 88, y: 262, ...PERSISTENT_BASE_EDITOR_VIEW_SIZE };
/** Header row above both columns: stage and tools on the left, the situation map's title on the right. */
const HEADER_Y = 222;
/** Overview of the whole map (Lagekarte); empty without map terrain. */
export const PERSISTENT_BASE_EDITOR_MINIMAP_PANEL = { x: 1130, y: 242, width: 708, height: 300 };
/** The inventory's cards below the overview: four columns; rows scroll. */
const INVENTORY = { x: 1130, y: 584, width: 708, height: 334 };
/** How far the World view zooms in beyond filling its panel, and the step per wheel notch. */
const ZOOM = { max: 2.2, step: 1.18 } as const;
/** Pointer travel (UI px) before a press becomes a drag or a pan. */
const DRAG_START_PX = 4;
/** Undo steps a session keeps. */
const HISTORY = 60;
/** The base's warm light for its own marks; pale green and red for whether a place fits. */
const MARK = { base: 0xf0d48a, valid: 0xb1ed94, invalid: 0xff8a7a, reward: 0xdcebf2 } as const;
/** What-if switches below the overview; each appears only where it changes the routes. */
const SCENARIO_SWITCHES = [
  { key: 'outpostsDestroyed', option: 'outposts', label: 'ui.base.scenario.outposts' },
  { key: 'bridgesDestroyed', option: 'bridges', label: 'ui.base.scenario.bridges' },
  { key: 'teleportersOpen', option: 'teleporters', label: 'ui.base.scenario.teleporters' },
] as const satisfies readonly { key: keyof DeploymentRouteScenario; option: keyof DeploymentRouteScenarioOptions; label: string }[];
type RowStatus = 'unplaced' | 'placed' | 'missed';
interface EditorRow { label: string; status: RowStatus; personal: boolean; object?: BaseEditorObject; rewardId?: PersistentBaseRewardId;
  conflict?: PersistentCompositeConflictReason; missed?: { readonly mapId: string; readonly objectiveId: string | null } }
/**
 * An item in hand. `pending` until the press moves (a drag) or is released in place (then it is
 * carried until a click puts it down). The offset keeps the grabbed cell under the pointer.
 */
interface DragState { pointerId: number; x: number; y: number; offsetX: number; offsetY: number; mode: 'pending' | 'drag' | 'carry' }
/** A right or middle press over the World: a pan once it moves; a right click otherwise puts back. */
interface PanState { pointerId: number; x: number; y: number; scrollX: number; scrollY: number; moved: boolean; button: number }
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
  private inventory!: PersistentBaseInventory;
  private grid!: Phaser.GameObjects.Graphics;
  private preview!: Phaser.GameObjects.Graphics;
  private selection!: Phaser.GameObjects.Graphics;
  private expansionPreview: Phaser.GameObjects.Container | null = null;
  /** The held item beside the pointer while it is off the World view. */
  private dragPreview: Phaser.GameObjects.Container | null = null;
  /** The held item at full World size where it would stand. */
  private worldGhost: Phaser.GameObjects.Container | null = null;
  /** Why the held item cannot stand where the pointer is. */
  private reasonTip!: Phaser.GameObjects.Text;
  private badges!: Phaser.GameObjects.Container;
  private hints!: Phaser.GameObjects.Text;
  private error!: Phaser.GameObjects.Text;
  private rotate!: UiButton;
  private rangesButton!: UiButton;
  private buttons: UiButton[] = [];
  private selected: BaseEditorObject | null = null;
  private drag: DragState | null = null;
  private pan: PanState | null = null;
  /** The build area's edge on the ground, in World space. */
  private halo: Phaser.GameObjects.Image | null = null;
  private rangeField: PersistentBaseRangeField | null = null;
  /** Zoom beyond filling the panel (1) and the World point at the view's top-left corner. */
  private zoomFactor = 1;
  private scrollX: number;
  private scrollY: number;
  private readonly undoStack: PersistentBaseEditorDraftState[] = [];
  private readonly redoStack: PersistentBaseEditorDraftState[] = [];
  private lastEmptyClickAt = -Infinity;
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
  private readonly framing: PersistentBaseEditorFraming;
  private readonly expansion: ReturnType<typeof buildPersistentBaseExpansionPreview>;
  private conflicts: ReadonlyMap<string, PersistentCompositeConflictReason> = new Map();
  private conflictHalo!: Phaser.GameObjects.Graphics;
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
      // The detail view fills the whole panel: the panel's aspect and no inset.
      const { widthCells, heightCells } = stage.terrain.definition.metrics;
      this.framing = getPersistentBaseEditorWorldFraming(WORLD_PANEL,
        getPersistentBaseEditorDetailRect({ widthCells, heightCells }, terrainSite.anchor), terrainSite.anchor, 0);
    } else {
      this.framing = getPersistentBaseEditorFraming(WORLD_PANEL, stage.model.area, this.expansion?.area);
    }
    this.scrollX = this.framing.world.x; this.scrollY = this.framing.world.y;
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
      portals: this.world.situationPortals ?? undefined,
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
      hostile: this.world.world.bases.some((base) => base.faction === 'hostile' && base.surface !== 'none')
        || (this.world.situationPortals?.generatorIds.size ?? 0) > 0,
      portals: this.world.situationPortals !== null });
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
  /** Zoom of the World view: filling the panel times the player's zoom. */
  private get worldZoom(): number { return this.framing.zoom * this.zoomFactor; }

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
    this.hints = this.label(menu.centerX, 170, t('ui.base.hints'), 'body', .5, 1700, chrome).setColor('#d9cfa8');
    yield;
    this.badges = this.add.container(0, 0); chrome.add(this.badges);
    // One frame for every map: the World sits in its middle, the rest of the panel is a dark mat.
    for (const mat of this.outsideWorld(WORLD_PANEL.x, WORLD_PANEL.y, WORLD_PANEL.width, WORLD_PANEL.height)) {
      if (mat.width > 0 && mat.height > 0) chrome.add(this.add.rectangle(mat.x, mat.y, mat.width, mat.height, 0x0b120d, .94).setOrigin(0));
    }
    chrome.add(this.add.rectangle(this.view.x, this.view.y, this.view.width, this.view.height).setOrigin(0)
      .setStrokeStyle(1, 0x718160, .55));
    const frameWidth = WORLD_PANEL.width + 40, frameHeight = WORLD_PANEL.height + 40;
    chrome.add(this.add.image(WORLD_PANEL.x + WORLD_PANEL.width / 2, WORLD_PANEL.y + WORLD_PANEL.height / 2,
      ensureUpgradeFrame(this, frameWidth, frameHeight)).setDisplaySize(frameWidth, frameHeight));
    // The items as cards below the overview; their details show on hover.
    this.label(INVENTORY.x + 4, INVENTORY.y - 22, t('ui.base.inventory').toLocaleUpperCase(), 'section', 0, undefined, chrome);
    this.inventory = new PersistentBaseInventory(this, chrome, INVENTORY, {
      press: (key, pointer) => this.pressCard(key, pointer),
      canShowInfo: () => !this.drag,
    }, t('ui.base.empty.all'));
    this.error = this.label(menu.centerX, 192, '', 'caption', .5, 1600, chrome).setColor('#ffc2a9').setVisible(false);
    this.reasonTip = this.label(0, 0, '', 'caption', 0, 320, chrome).setColor('#ffd9cf').setBackgroundColor('#2a1410')
      .setPadding(8, 5, 8, 5).setVisible(false);
    this.actionButton('cancel', menu.centerX - (menu.buttonGap + menu.buttonWidth) / 2, () => this.finish());
    this.actionButton('apply', menu.centerX + (menu.buttonGap + menu.buttonWidth) / 2, () => { void this.save(); });
    // Tools sit in the header row, right of the stage; the bottom keeps only Cancel and Apply.
    const right = WORLD_PANEL.x + WORLD_PANEL.width;
    this.button(right - 90, HEADER_Y, 180, 32, t('ui.base.clearAll'), () => this.clearAll(), 'tray');
    this.rangesButton = this.button(right - 190 - 80, HEADER_Y, 160, 32, t('ui.base.ranges'), () => {
      this.showRanges = !this.showRanges;
      this.rangesButton.setIcon(this.showRanges ? 'box-checked' : 'box');
      this.refreshRanges();
    }, 'box');
    // The orientation belongs to the room host: a guest's session hides the tool and says so in the hints.
    this.rotate = this.button(right - 190 - 170 - 80, HEADER_Y, 160, 32, t('ui.base.rotate'), () => this.rotateBase(), 'rotate');
    yield;
    this.world = new PersistentBaseEditorWorld(this, this.stage.model, this.stage.color,
      { previewArea: this.expansion?.area, terrain: this.stage.terrain });
    yield* this.world.build();
    yield;
    const situationMap = loadingTimeline.start();
    yield* this.createSituationMap();
    loadingTimeline.end('editor/situation-map', situationMap);
    this.rangeField = new PersistentBaseRangeField(this, this.framing.world, DEPTH.DECALS + .25);
    this.grid = this.add.graphics().setDepth(10000).setVisible(false);
    this.selection = this.add.graphics().setDepth(10001);
    this.preview = this.add.graphics().setDepth(10002);
    this.conflictHalo = this.add.graphics().setDepth(10003);
    this.tweens.add({ targets: this.conflictHalo, alpha: { from: 1, to: .35 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.resize();
    this.scale.on('resize', this.resize, this);
    // Handlers stay for the stage's lifetime and act on the session that is open.
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.pointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => { this.updatePan(pointer); this.updateDrag(pointer); });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => { if (!this.endPan(pointer)) this.drop(pointer); });
    this.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => { if (!this.endPan(pointer)) this.drop(pointer); });
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => this.wheel(pointer, dy));
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => this.keyDown(event));
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
    this.closed = false; this.saving = false; this.selected = null; this.drag = null; this.pan = null;
    this.showRanges = false; this.conflicts = new Map(); this.framesShown = 0;
    this.undoStack.length = 0; this.redoStack.length = 0;
    this.zoomFactor = 1; this.scrollX = this.framing.world.x; this.scrollY = this.framing.world.y;
    this.rangesButton.setIcon('box');
    const model = options.model;
    this.scenario = DEPLOYMENT_ROUTE_START;
    this.world.setScenario(this.scenario, true);
    this.minimap?.setFallen(this.world.fallenBaseIds, this.world.blownBridgeIds);
    this.syncScenarioButtons();
    this.world.setModel(model, options.color);
    this.rotate.getRoot().setVisible(model.rewardsEditable);
    this.hints.setText(model.rewardsEditable ? t('ui.base.hints') : `${t('ui.base.hostRoomBase')} · ${t('ui.base.hints')}`);
    const ui = this.ui = this.add.container(0, 0);
    this.cameraRegistry.promote(ui);
    this.halo = createPersistentBaseAreaHalo(this, model.area, this.world.anchor).setDepth(DEPTH.DECALS + .2);
    this.applyCamera(); this.refreshFramedOverlays();
    const extent = getPersistentBaseBuildAreaExtentCells(model.area);
    const anchor = this.world.anchor;
    // The cells show only while an item is in hand: faint, in the base's warm light.
    this.grid.clear().lineStyle(1, 0xf0dca8, .12);
    for (let y = -extent; y <= extent; y++) for (let x = -extent; x <= extent; x++) {
      if (isCellInsidePersistentBaseBuildArea(x, y, model.area))
        this.grid.strokeRect((anchor.gridX + x) * CELL_SIZE, (anchor.gridY + y) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
    this.refreshPreview(); this.refreshList(); this.refreshBadges();
    this.present();
  }

  /** The Dawn merchant's next ring or reward note, framed by the view as it is zoomed now. */
  private refreshFramedOverlays(): void {
    if (!this.ui || !this.options) return;
    this.expansionPreview?.destroy(true); this.expansionPreview = null;
    const expansion = expansionFor(this.options.model), framing = this.currentFraming();
    if (expansion?.edges.length) {
      this.expansionPreview = createDawnMerchantExpansionPreview(this, framing, expansion.edges,
        t(expansion.dawnOnly ? 'ui.base.expansionRingLabelDawnOnly' : 'ui.base.expansionRingLabel',
          { radius: expansion.radius, cost: expansion.cost }));
    } else if (expansion?.reward?.kind === 'core') {
      this.expansionPreview = createDawnExpansionRewardNote(this, framing,
        t('ui.base.expansionCoreReward', { hp: expansion.reward.coreHpBonus, cost: expansion.cost }));
    }
    if (this.expansionPreview) this.ui.add(this.expansionPreview);
  }
  private currentFraming(): PersistentBaseEditorFraming {
    const zoom = this.worldZoom, anchor = this.world.anchor;
    return { zoom, view: this.view,
      world: { x: this.scrollX, y: this.scrollY, width: this.view.width / zoom, height: this.view.height / zoom },
      anchor: { x: this.view.x + ((anchor.gridX + .5) * CELL_SIZE - this.scrollX) * zoom,
        y: this.view.y + ((anchor.gridY + .5) * CELL_SIZE - this.scrollY) * zoom } };
  }
  /** Values of the base as small badges in the header row. */
  private refreshBadges(): void {
    const model = this.session.model, rows = this.rows().filter((row) => row.object);
    const values = [t('ui.base.badge.stage', { stage: model.areaStage }),
      ...(model.area.kind === 'radius' ? [t('ui.base.badge.radius', { radius: model.area.radiusCells })] : []),
      t('ui.base.badge.hp', { hp: resolvePersistentBaseMaxHp(model.baseline.persistentBaseHealthRewards) }),
      t('ui.base.badge.placed', { placed: rows.filter((row) => row.status === 'placed').length, total: rows.length })];
    this.badges.removeAll(true);
    let x = WORLD_PANEL.x;
    for (const value of values) {
      const text = this.add.text(x + 11, HEADER_Y, value, textStyle('caption', { color: 0xe6dcb4 })).setOrigin(0, .5);
      const width = text.width + 22;
      const background = this.add.graphics().fillStyle(0x16261b, .92).fillRoundedRect(x, HEADER_Y - 13, width, 26, 13)
        .lineStyle(1, 0x6f8158, .8).strokeRoundedRect(x, HEADER_Y - 13, width, 26, 13);
      this.badges.add([background, text]);
      x += width + 8;
    }
  }

  /** Ends the session; the stage stays, hidden and resting, for the next one. */
  closeSession(): void {
    if (this.disposed) return;
    this.closed = true; this.presentationReady = false; this.saving = false;
    this.revealTween?.remove(); this.revealTween = null;
    this.getTransitionView().setAlpha(0);
    this.setTransitionInputBlocked(true);
    this.endDrag(); this.selected = null; this.pan = null;
    this.ui?.destroy(true); this.ui = null; this.expansionPreview = null;
    this.halo?.destroy(); this.halo = null;
    this.rangeField?.set([]);
    this.inventory.setCards([]);
    this.undoStack.length = 0; this.redoStack.length = 0;
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
    this.dragPreview?.destroy(true); this.worldGhost?.destroy(true);
    this.expansionPreview?.destroy(true); this.expansionPreview = null;
    this.halo?.destroy(); this.halo = null;
    this.rangeField?.destroy(); this.rangeField = null;
    this.inventory?.destroy();
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
    this.applyCamera();
  }
  /** The World view at the player's zoom, kept inside the prepared terrain. */
  private applyCamera(): void {
    const scale = getRenderScale(this.scale), zoom = this.worldZoom, world = this.framing.world;
    const clamp = (value: number, min: number, span: number, shown: number) => shown >= span ? min + (span - shown) / 2
      : Math.max(min, Math.min(min + span - shown, value));
    this.scrollX = clamp(this.scrollX, world.x, world.width, this.view.width / zoom);
    this.scrollY = clamp(this.scrollY, world.y, world.height, this.view.height / zoom);
    this.cameras.main.setViewport(this.view.x * scale, this.view.y * scale, this.view.width * scale, this.view.height * scale)
      .setOrigin(0, 0).setZoom(scale * zoom).setScroll(this.scrollX, this.scrollY);
  }
  /** Zooms the World view by `factor` around a UI point. */
  private zoomAt(x: number, y: number, factor: number): void {
    const next = Math.max(1, Math.min(ZOOM.max, this.zoomFactor * factor));
    if (next === this.zoomFactor) return;
    const before = this.worldZoom, worldX = this.scrollX + (x - this.view.x) / before, worldY = this.scrollY + (y - this.view.y) / before;
    this.zoomFactor = next;
    this.scrollX = worldX - (x - this.view.x) / this.worldZoom; this.scrollY = worldY - (y - this.view.y) / this.worldZoom;
    this.applyCamera(); this.refreshFramedOverlays();
  }
  private resetView(): void {
    this.zoomFactor = 1; this.scrollX = this.framing.world.x; this.scrollY = this.framing.world.y;
    this.applyCamera(); this.refreshFramedOverlays();
  }
  /** UI point of a pointer. */
  private uiPoint(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const scale = getRenderScale(this.scale);
    return { x: pointer.x / scale, y: pointer.y / scale };
  }
  private isOverView(x: number, y: number): boolean {
    return x >= this.view.x && y >= this.view.y && x < this.view.x + this.view.width && y < this.view.y + this.view.height;
  }
  /** Canonical draft cell under the pointer: the World cell turned back by the base orientation. */
  private cellAt(pointer: Phaser.Input.Pointer): { x: number; y: number } | null {
    const { x, y } = this.uiPoint(pointer);
    if (!this.isOverView(x, y)) return null;
    const canonical = toCanonicalCell(this.world.frame,
      Math.floor((this.scrollX + (x - this.view.x) / this.worldZoom) / CELL_SIZE),
      Math.floor((this.scrollY + (y - this.view.y) / this.worldZoom) / CELL_SIZE));
    return { x: canonical.relativeGridX, y: canonical.relativeGridY };
  }
  /** World top-left cell of the selected object at a canonical origin. */
  private worldOrigin(x: number, y: number): { gridX: number; gridY: number } {
    const cells = this.selected ? getBaseEditorAppearance(this.session.model, this.selected)?.footprint ?? [] : [];
    return toWorldFootprint(this.world.frame, x, y, cells);
  }
  private isOverTable(pointer: Phaser.Input.Pointer): boolean {
    const { x, y } = this.uiPoint(pointer);
    return this.inventory.contains(x, y);
  }
  /** A draft object under a canonical cell, if this player may take it. */
  private objectAt(cell: { x: number; y: number }): BaseEditorObject | null {
    const model = this.session.model;
    const reward = model.rewardsEditable ? model.rewards.find(p => getPersistentBaseRewardCells(p).some(c =>
      c.gridX === cell.x && c.gridY === cell.y)) : undefined;
    const construction = model.constructions.find(p => (getPersistentConstructionFootprint(p) ?? []).some(c =>
      p.relativeGridX + c.dx === cell.x && p.relativeGridY + c.dy === cell.y));
    return reward ? { kind: 'reward', id: reward.rewardId } : construction ? { kind: 'construction', id: construction.persistentId } : null;
  }
  private pointerDown(pointer: Phaser.Input.Pointer): void {
    const model = this.options?.model;
    if (!model || this.saving || this.closed) return;
    const point = this.uiPoint(pointer);
    // Right and middle presses over the World pan it; a right click without moving puts back.
    if ((pointer.button === 1 || pointer.button === 2) && (this.isOverView(point.x, point.y) || this.drag)) {
      this.pan = { pointerId: pointer.id, x: pointer.x, y: pointer.y, scrollX: this.scrollX, scrollY: this.scrollY, moved: false, button: pointer.button };
      return;
    }
    if (pointer.button !== 0) return;
    // An item in hand goes down where the click is (or back, over the inventory).
    if (this.drag?.mode === 'carry') { this.placeHeld(pointer); return; }
    const cell = this.cellAt(pointer);
    if (!cell) return;
    const object = this.objectAt(cell);
    if (object) {
      const position = model.getPosition(object)!;
      this.beginDrag(object, pointer, cell.x - position.relativeGridX, cell.y - position.relativeGridY);
      return;
    }
    this.selected = null; this.endDrag(); this.refreshSelection();
    // A double click on open ground returns to the whole view.
    const now = performance.now();
    if (now - this.lastEmptyClickAt < 320) { this.resetView(); this.lastEmptyClickAt = -Infinity; } else this.lastEmptyClickAt = now;
  }
  private pressCard(key: string, pointer: Phaser.Input.Pointer): void {
    if (this.saving || this.closed) return;
    if (this.drag?.mode === 'carry') { this.placeHeld(pointer); return; }
    const row = this.rows().find((entry) => entry.object && baseEditorObjectKey(entry.object) === key);
    if (row?.object) this.beginDrag(row.object, pointer);
  }
  private beginDrag(object: BaseEditorObject, pointer: Phaser.Input.Pointer, offsetX = 0, offsetY = 0): void {
    if (this.saving || this.closed || pointer.button !== 0) return;
    this.endDrag(); this.selected = object;
    this.drag = { pointerId: pointer.id, x: pointer.x, y: pointer.y, offsetX, offsetY, mode: 'pending' };
    this.error.setVisible(false); this.inventory?.hideInfo(); this.refreshSelection();
  }
  private updateDrag(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag || !this.selected || this.saving) return;
    if (drag.mode === 'pending') {
      if (drag.pointerId !== pointer.id) return;
      if (Math.hypot(pointer.x - drag.x, pointer.y - drag.y) / getRenderScale(this.scale) < DRAG_START_PX) return;
      drag.mode = 'drag';
    }
    this.showHeld(pointer);
  }
  /** The held item where it would go: full size on the World, beside the pointer elsewhere. */
  private showHeld(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag!, object = this.selected!, model = this.session.model;
    const appearance = getBaseEditorAppearance(model, object);
    const point = this.uiPoint(pointer), cell = this.cellAt(pointer);
    this.preview.clear();
    let failure: BaseEditorPlacementFailure | null = null;
    if (cell) {
      cell.x -= drag.offsetX; cell.y -= drag.offsetY;
      failure = model.validate(object, cell.x, cell.y);
      this.drawFootprint(this.preview, cell.x, cell.y, failure ? MARK.invalid : MARK.valid, 1);
      if (!this.worldGhost && appearance) this.worldGhost = createPersistentBaseDragPreview(this, appearance, this.session.color).setDepth(9995);
      const origin = this.worldOrigin(cell.x, cell.y);
      this.worldGhost?.setVisible(true).setAlpha(failure ? .4 : .82).setPosition((origin.gridX + .5) * CELL_SIZE, (origin.gridY + .5) * CELL_SIZE);
      this.dragPreview?.setVisible(false);
      this.held = { x: cell.x, y: cell.y };
    } else {
      this.worldGhost?.setVisible(false);
      if (!this.dragPreview && appearance) { this.dragPreview = createPersistentBaseDragPreview(this, appearance, this.session.color); this.ui?.add(this.dragPreview); }
      const offset = rotatePersistentBaseOffset(drag.offsetX, drag.offsetY, this.world.frame.quarterTurns);
      this.dragPreview?.setVisible(true).setScale(this.worldZoom)
        .setPosition(point.x - offset.dx * CELL_SIZE * this.worldZoom, point.y - offset.dy * CELL_SIZE * this.worldZoom);
      this.held = null;
    }
    this.reasonTip.setText(failure ? t(`ui.base.invalid.${failure}`) : '').setVisible(failure !== null)
      .setPosition(point.x + 20, point.y + 18);
    this.inventory.setDropTarget(this.inventory.contains(point.x, point.y) && !!model.getPosition(object));
    this.refreshRanges();
  }
  /** Where the held item would stand, canonical; null while it is off the World view. */
  private held: { x: number; y: number } | null = null;
  private drop(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== pointer.id) return;
    // A click without moving takes the item into hand; the next click puts it down.
    if (drag.mode === 'pending') { drag.mode = 'carry'; this.showHeld(pointer); return; }
    if (drag.mode === 'drag') this.placeHeld(pointer);
  }
  /** Puts the held item down at the pointer, or back over the inventory. A carried item stays in hand on a bad spot. */
  private placeHeld(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag, object = this.selected;
    if (!drag || !object || this.saving) return;
    const model = this.session.model, cell = this.cellAt(pointer), point = this.uiPoint(pointer);
    if (cell) {
      const x = cell.x - drag.offsetX, y = cell.y - drag.offsetY, before = model.getPosition(object);
      if (model.validate(object, x, y)) { if (drag.mode !== 'carry') { this.endDrag(); this.refreshSelection(); } return; }
      this.endDrag();
      if (before?.relativeGridX === x && before.relativeGridY === y) this.refreshSelection();
      else this.commit(() => model.move(object, x, y));
      return;
    }
    if (this.inventory.contains(point.x, point.y)) {
      this.endDrag();
      if (model.getPosition(object)) this.commit(() => { model.remove(object); return true; }); else this.refreshSelection();
      return;
    }
    if (drag.mode !== 'carry') { this.endDrag(); this.refreshSelection(); }
  }
  private endDrag(): void {
    this.drag = null; this.held = null;
    this.dragPreview?.destroy(true); this.dragPreview = null;
    this.worldGhost?.destroy(true); this.worldGhost = null;
    this.preview?.clear(); this.reasonTip?.setVisible(false); this.inventory?.setDropTarget(false);
  }
  private updatePan(pointer: Phaser.Input.Pointer): void {
    const pan = this.pan;
    if (!pan || pan.pointerId !== pointer.id) return;
    const scale = getRenderScale(this.scale), dx = (pointer.x - pan.x) / scale, dy = (pointer.y - pan.y) / scale;
    if (!pan.moved && Math.hypot(dx, dy) < DRAG_START_PX) return;
    pan.moved = true;
    this.scrollX = pan.scrollX - dx / this.worldZoom; this.scrollY = pan.scrollY - dy / this.worldZoom;
    this.applyCamera(); this.refreshFramedOverlays();
  }
  /** Ends a pan; a right click without moving puts the held or clicked item back. */
  private endPan(pointer: Phaser.Input.Pointer): boolean {
    const pan = this.pan;
    if (!pan || pan.pointerId !== pointer.id) return false;
    this.pan = null;
    if (!pan.moved && pan.button === 2) this.putBack(pointer);
    return true;
  }
  private putBack(pointer: Phaser.Input.Pointer): void {
    if (this.saving || this.closed) return;
    const model = this.session.model;
    const object = this.drag ? this.selected : (() => { const cell = this.cellAt(pointer); return cell ? this.objectAt(cell) : null; })();
    this.endDrag();
    if (!object || !model.getPosition(object)) { this.refreshSelection(); return; }
    this.commit(() => { model.remove(object); return true; });
  }
  private wheel(pointer: Phaser.Input.Pointer, dy: number): void {
    if (this.closed || dy === 0) return;
    const point = this.uiPoint(pointer);
    if (this.inventory.contains(point.x, point.y)) { if (!this.drag) this.inventory.scroll(Math.sign(dy)); return; }
    if (!this.isOverView(point.x, point.y)) return;
    this.zoomAt(point.x, point.y, dy < 0 ? ZOOM.step : 1 / ZOOM.step);
    if (this.drag && this.drag.mode !== 'pending') this.showHeld(pointer);
  }
  private keyDown(event: KeyboardEvent): void {
    if (this.saving || this.closed) return;
    const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey;
    if (key === 'escape') { if (this.drag) { this.endDrag(); this.refreshSelection(); } else this.finish(); return; }
    if (command && key === 'z') { if (event.shiftKey) this.redo(); else this.undo(); event.preventDefault(); return; }
    if (command && key === 'y') { this.redo(); event.preventDefault(); return; }
    if (key === 'delete' || key === 'backspace') {
      const model = this.session.model, object = this.selected;
      if (object && model.getPosition(object)) { this.endDrag(); this.commit(() => { model.remove(object); return true; }); }
    }
  }
  /** One undoable change of the draft; false when nothing changed. */
  private commit(change: () => boolean): boolean {
    const model = this.session.model, before = model.snapshot();
    if (!change()) { this.refreshSelection(); return false; }
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    this.syncDraft();
    return true;
  }
  private undo(): void { this.travel(this.undoStack, this.redoStack); }
  private redo(): void { this.travel(this.redoStack, this.undoStack); }
  private travel(from: PersistentBaseEditorDraftState[], to: PersistentBaseEditorDraftState[]): void {
    const state = from.pop();
    if (!state) return;
    const model = this.session.model;
    to.push(model.snapshot());
    this.endDrag(); model.restore(state);
    this.syncDraft();
  }
  private rotateBase(): void {
    if (this.drag || this.saving || !this.options) return;
    const model = this.options.model;
    this.commit(() => model.rotate());
  }
  private clearAll(): void {
    if (this.drag || this.saving || !this.options) return;
    const model = this.options.model;
    this.selected = null;
    this.commit(() => model.clear());
  }
  private syncDraft(): void { this.world.syncObjects(); this.refreshPreview(); this.refreshList(); this.refreshBadges(); }
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
  private createLegend(y: number, has: { readonly routes: boolean; readonly spawn: boolean; readonly hostile: boolean; readonly portals: boolean }): void {
    const panel = PERSISTENT_BASE_EDITOR_MINIMAP_PANEL, colors = PERSISTENT_BASE_EDITOR_MINIMAP_COLORS;
    const color = (css: string) => Number.parseInt(css.slice(1), 16);
    const all: { show: boolean; label: string; draw: (g: Phaser.GameObjects.Graphics, x: number) => void }[] = [
      { show: has.routes, label: t('ui.base.legend.routes'), draw: (g, x) => g.lineStyle(3, 0xb347ff, 1).lineBetween(x, y + 2, x + 14, y - 2) },
      { show: has.spawn, label: t('ui.base.legend.spawn'), draw: (g, x) => g.fillStyle(color(colors.spawnZone), .7).fillEllipse(x + 7, y, 14, 11) },
      { show: has.hostile, label: t('ui.base.legend.hostile'), draw: (g, x) => g.fillStyle(color(colors.hostileBase), 1).fillRect(x + 1, y - 6, 12, 12) },
      { show: has.portals, label: t('ui.base.legend.portal'), draw: (g, x) => g.fillStyle(color(colors.portalThroat), 1).fillCircle(x + 7, y, 6)
        .lineStyle(2, color(colors.portal), 1).strokeCircle(x + 7, y, 6) },
      { show: true, label: t('ui.base.legend.base'), draw: (g, x) => g.fillStyle(color(colors.persistentBase), 1).fillRect(x + 1, y - 6, 12, 12) },
      { show: true, label: t('ui.base.legend.view'), draw: (g, x) => g.lineStyle(2, color(colors.frame), 1).strokeRect(x + 1, y - 6, 12, 12) },
    ];
    const entries = all.filter((entry) => entry.show);
    const graphics = this.add.graphics();
    this.chrome.add(graphics);
    const texts = entries.map((entry) => this.label(0, y, entry.label, 'caption', 0, undefined, this.chrome).setColor('#d9cfa8'));
    const gap = entries.length > 5 ? 16 : 22, swatch = 20;
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
    this.minimap?.setFallen(this.world.fallenBaseIds, this.world.blownBridgeIds);
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
  /**
   * Reaches as a soft light on the ground: every turret's while toggled on, the selected one always
   * and brighter, and the held turret's where it would stand.
   */
  private refreshRanges(): void {
    if (!this.options || !this.rangeField) return;
    const model = this.session.model, frame = this.world.frame;
    const selectedKey = this.selected ? baseEditorObjectKey(this.selected) : null;
    const rings: PersistentBaseRangeRing[] = [];
    const reach = (object: BaseEditorObject, constructionId: string | undefined): number | null => {
      if (!constructionId) return null;
      // Personal turrets carry the builder's upgrades; base-owned reward turrets their authored range.
      const id = normalizeConstructionId(constructionId);
      const definition = id ? getCoopDefenseConstructionDefinition(id) : null;
      return object.kind === 'construction' ? this.session.resolveTurretRange?.(constructionId) ?? null
        : definition?.kind === 'turret' ? definition.targetRange : null;
    };
    const constructionOf = (object: BaseEditorObject): string | undefined => {
      if (object.kind === 'construction') return model.getConstruction(object.id)?.tool.id;
      const source = getPersistentBaseRewardDefinition(object.id).gameplaySource;
      return source.kind === 'construction-definition' ? source.constructionId : undefined;
    };
    const consider = (object: BaseEditorObject, position: { relativeGridX: number; relativeGridY: number } | null | undefined, held = false) => {
      const key = baseEditorObjectKey(object), selected = key === selectedKey;
      if (!position || (!held && !this.showRanges && !selected)) return;
      const radius = reach(object, constructionOf(object)), appearance = getBaseEditorAppearance(model, object);
      if (!radius || !appearance) return;
      const placed = toWorldFootprint(frame, position.relativeGridX, position.relativeGridY, appearance.footprint);
      rings.push({ x: (placed.gridX + .5) * CELL_SIZE, y: (placed.gridY + .5) * CELL_SIZE, radius,
        color: object.kind === 'construction' ? this.session.color : MARK.reward, emphasis: selected ? 1 : 0 });
    };
    const holding = this.drag && this.drag.mode !== 'pending' && this.selected ? this.selected : null;
    for (const entry of model.constructions) {
      const object = { kind: 'construction' as const, id: entry.persistentId };
      if (!holding || baseEditorObjectKey(holding) !== baseEditorObjectKey(object)) consider(object, entry);
    }
    for (const reward of model.rewards) {
      const object = { kind: 'reward' as const, id: reward.rewardId };
      if (!holding || baseEditorObjectKey(holding) !== baseEditorObjectKey(object)) consider(object, reward);
    }
    if (holding && this.held) consider(holding, { relativeGridX: this.held.x, relativeGridY: this.held.y }, true);
    this.rangeField.set(rings);
  }
  /** A soft glow over the cells an object takes: layered, rounded, no hard frame. */
  private drawFootprint(graphics: Phaser.GameObjects.Graphics, x: number, y: number, color: number, strength: number): void {
    if (!this.selected) return;
    const cells = getBaseEditorAppearance(this.session.model, this.selected)?.footprint ?? [{ dx: 0, dy: 0 }];
    const placed = toWorldFootprint(this.world.frame, x, y, cells);
    for (const offset of placed.footprint) {
      const wx = (placed.gridX + offset.dx) * CELL_SIZE, wy = (placed.gridY + offset.dy) * CELL_SIZE;
      for (const [inset, alpha] of [[-5, .07], [-2, .1], [2, .16]] as const) {
        graphics.fillStyle(color, alpha * strength).fillRoundedRect(wx + inset, wy + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2, 8);
      }
      graphics.lineStyle(1.5, color, .6 * strength).strokeRoundedRect(wx + 3, wy + 3, CELL_SIZE - 6, CELL_SIZE - 6, 6);
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
      label: this.objectLabel(object), ...(object.kind === 'reward' ? { rewardId: object.id } : {}),
      personal: object.kind === 'construction', status: model.getPosition(object) ? 'placed' : 'unplaced' }));
    if (!model.rewardsEditable) return rows;
    const missed = new Set<PersistentBaseRewardId>();
    for (const entry of getMissedBaseRewards(model.baseline)) if (!missed.has(entry.rewardId)) {
      missed.add(entry.rewardId);
      const definition = getPersistentBaseRewardDefinition(entry.rewardId);
      rows.push({ label: t(definition.presentation.labelKey), rewardId: entry.rewardId, personal: false, status: 'missed',
        missed: { mapId: entry.mapId, objectiveId: entry.objectiveId } });
    }
    return rows;
  }
  /** The inventory's cards: the rows with their artwork, numbered where names repeat, and their details. */
  private refreshList(): void {
    const rows = this.rows(), model = this.session.model;
    const counts = new Map<string, number>(), seen = new Map<string, number>();
    for (const row of rows) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
    const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    const cards = rows.map((row): PersistentBaseInventoryCard => {
      const index = (seen.get(row.label) ?? 0) + 1;
      seen.set(row.label, index);
      const label = (counts.get(row.label) ?? 0) > 1 ? `${row.label} ${numerals[index - 1] ?? index}` : row.label;
      const object: BaseEditorObject | null = row.object ?? (row.rewardId ? { kind: 'reward', id: row.rewardId } : null);
      const appearance = object ? getBaseEditorAppearance(model, object) : null;
      return {
        key: row.object ? baseEditorObjectKey(row.object) : `${row.status}:${row.rewardId ?? row.label}:${index}`,
        label, state: row.status, takeable: !!row.object, ownerColor: row.personal ? this.session.color : null,
        fresh: !!row.rewardId && this.session.newRewardIds.includes(row.rewardId), conflict: !!row.conflict,
        art: () => appearance ? createPersistentBaseDragPreview(this, appearance, row.personal ? this.session.color : 0xd8c69a, { aura: false }) : null,
        info: this.cardInfo(row, label, object),
      };
    });
    this.inventory.setCards(cards);
    this.refreshSelection();
  }
  /** Hover details: what it is, its size and reach, where it may stand, how it stands now. */
  private cardInfo(row: EditorRow, title: string, object: BaseEditorObject | null): PersistentBaseInventoryCard['info'] {
    const model = this.session.model, lines: string[] = [];
    lines.push(t(row.personal ? 'ui.base.info.personal' : 'ui.base.info.reward'));
    const appearance = object ? getBaseEditorAppearance(model, object) : null;
    if (appearance) {
      const xs = appearance.footprint.map((cell) => cell.dx), ys = appearance.footprint.map((cell) => cell.dy);
      const width = Math.max(...xs) - Math.min(...xs) + 1, height = Math.max(...ys) - Math.min(...ys) + 1;
      lines.push(width * height === 1 ? t('ui.base.info.sizeOne') : t('ui.base.info.size', { width, height }));
    }
    if (object) {
      const source = object.kind === 'reward' ? getPersistentBaseRewardDefinition(object.id).gameplaySource : null;
      const constructionId = object.kind === 'construction' ? model.getConstruction(object.id)?.tool.id
        : source?.kind === 'construction-definition' ? source.constructionId : undefined;
      const id = constructionId ? normalizeConstructionId(constructionId) : null;
      const definition = id ? getCoopDefenseConstructionDefinition(id) : null;
      const radius = object.kind === 'construction' && constructionId ? this.session.resolveTurretRange?.(constructionId) ?? null
        : definition?.kind === 'turret' ? definition.targetRange : null;
      if (radius) lines.push(t('ui.base.info.range', { cells: (Math.round(radius / CELL_SIZE * 10) / 10).toLocaleString(getLocale()) }));
      lines.push(t(object.kind === 'reward' && getPersistentBaseRewardDefinition(object.id).placementRule === 'base-surface'
        ? 'ui.base.surface' : 'ui.base.courtyard'));
    }
    if (row.conflict) lines.push(t(`ui.base.conflict.${row.conflict}`));
    else if (row.missed) lines.push(`${t(row.missed.objectiveId ? 'ui.base.optionalObjective' : 'ui.base.victoryReward')} · ${getMapName(row.missed.mapId, getLocale())}`);
    else lines.push(t(row.status === 'placed' ? 'ui.base.placed' : 'ui.base.unplaced'));
    const note = row.status === 'missed' ? undefined : !row.object ? t('ui.base.hostRoomBase')
      : t(row.status === 'placed' ? 'ui.base.info.placedHint' : 'ui.base.info.take');
    return { title, lines, ...(note ? { note } : {}) };
  }
  private refreshSelection(): void {
    this.inventory?.setSelected(this.selected ? baseEditorObjectKey(this.selected) : null);
    this.selection.clear();
    const position = this.selected && this.session.model.getPosition(this.selected);
    if (position) this.drawFootprint(this.selection, position.relativeGridX, position.relativeGridY, MARK.base, 1);
    this.grid.setVisible(this.drag !== null);
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
