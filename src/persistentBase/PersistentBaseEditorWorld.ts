import { WatchtowerVisual, ensureWatchtowerTexture } from '../effects/watchtower/WatchtowerVisual';
import { WorldSunlightPresentation } from '../effects/sunlight/WorldSunlightPresentation';
import * as Phaser from 'phaser';
import { CELL_SIZE, getAuthoredWorldMetricsProfile, type ArenaMetricsProfile } from '../config';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import { createWorldRuntimeContext, type WorldRuntimeContext } from '../world/WorldRuntimeContext';
import { ArenaBuilder, type ArenaBuilderResult, type ArenaBuildPause } from '../arena/ArenaBuilder';
import { ARENA_GENERATOR_VERSION } from '../arena/ArenaGenerator';
import { cropArenaLayout, type ArenaGridWindow } from '../arena/ArenaLayoutWindow';
import { resolveSpawnStructureVegetationClearings } from '../arena/BaseRegistry';
import { createArenaBackground } from '../arena/ArenaBackgroundRenderer';
import { ChunkedRenderSurface } from '../arena/chunks/ChunkedRenderSurface';
import { BaseManager } from '../entities/BaseManager';
import { createWorldTurretVisual, destroyWorldTurretVisual, syncWorldTurretFoundation, syncWorldTurretVisualPose, type WorldTurretVisual } from '../entities/WorldTurretVisual';
import { TurretAnimationController } from '../effects/TurretAnimationController';
import { LightingSystem } from '../effects/LightingSystem';
import { LightOccluderIndex } from '../effects/LightOccluderIndex';
import { ShadowSystem } from '../effects/ShadowSystem';
import { BridgeRenderer } from '../effects/bridge/BridgeRenderer';
import { CameraPostFxController } from '../effects/postfx/CameraPostFxController';
import { resolveBaseGrade, resolveMapWorldGrade, type WorldGradeInputs } from '../effects/postfx/worldGrade';
import { DEFAULT_LOBBY_TIME_OF_DAY_MINUTES, parseTimeOfDay, resolveSkyState } from '../effects/TimeOfDay';
import { GpuVfxSystem } from '../effects/gpu/GpuVfxSystem';
import { loadingTimeline } from '../diagnostics/LoadingTimeline';
import { PowerUpRenderer } from '../powerups/PowerUpRenderer';
import { bindBaseFortPresentation } from '../world/BaseFortPresentationBinding';
import { resolveCoopDefenseMapConfig } from '../world/WorldDefinitionResolution';
import { DEPLOYMENT_ROUTE_START, DeploymentRoutePlanner, type DeploymentRoutePlan, type DeploymentRouteScenario,
  type DeploymentRouteScenarioOptions } from '../activity/DeploymentRoutes';
import { RouteFlowPresentation } from '../effects/routeFlow/RouteFlowPresentation';
import type { RouteFlowRoute } from '../effects/routeFlow/RouteFlowStore';
import type { ArenaLayout, SyncedPlaceableRock, SyncedPowerUpPedestal, TurretWeaponId } from '../types';
import { buildPersistentBaseCoreBaseConfig, isCellInsidePersistentBaseBuildArea, type PersistentBaseAreaStage,
  type PersistentBaseBuildArea } from './PersistentBaseCore';
import type { BaseEditorObject, PersistentBaseEditorModel } from './PersistentBaseEditorModel';
import { baseEditorObjectKey, getBaseEditorAppearance } from './PersistentBaseEditorAppearance';
import { getPersistentBaseEditorDetailWindow, getPersistentBaseEditorSize, PERSISTENT_BASE_EDITOR_DETAIL_RADIUS } from './PersistentBaseExpansionPreview';
import { toWorldAngle, toWorldFootprint, type PersistentBaseFrame } from './PersistentBaseFrame';
import type { PersistentBaseAnchor } from './PersistentBaseTypes';
export { getPersistentBaseEditorSize, PERSISTENT_BASE_EDITOR_DETAIL_RADIUS } from './PersistentBaseExpansionPreview';
/** Terrain built beyond the view, so rock autotiling and canopies do not end at its edge. */
const CROP_MARGIN_CELLS = 3;

/** Terrain of the next round around the base (Lagekarte): the host's map at its deployment seed. */
export interface PersistentBaseEditorTerrain {
  readonly mapId: string;
  readonly definition: WorldDefinition;
  readonly seed: number;
  readonly fingerprint: string;
  /** The complete round layout; the World builds only the window around the anchor. */
  readonly layout: ArenaLayout;
  /** Build-area stage the round would freeze on this map (host stage, capped by the site). */
  readonly areaStage: PersistentBaseAreaStage;
}

/** A teammate's construction as the round would materialize it, already in World cells. */
export interface PersistentBaseEditorMateObject {
  readonly key: string;
  readonly color: number;
  readonly weapon?: TurretWeaponId;
  readonly powerUpDefId?: string;
  readonly wall: boolean;
  readonly tint: number;
  readonly gridX: number;
  readonly gridY: number;
  readonly footprint: readonly { readonly dx: number; readonly dy: number }[];
  readonly angle: number;
}

interface WorldRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** A local, non-participating World. It never creates an Activity, player or network identity. */
export class PersistentBaseEditorWorld {
  readonly world: WorldRuntimeContext;
  readonly anchor: PersistentBaseAnchor;
  /** World-pixel rectangle the editor camera frames. */
  readonly view: WorldRect;
  /** The build area this World shows: the map's frozen site area, or the personal draft area. */
  readonly siteArea: PersistentBaseBuildArea;
  readonly terrain: PersistentBaseEditorTerrain | null;
  private readonly bounds: WorldRect;
  /** The window of the round's terrain this World builds: the view plus a margin. */
  private readonly window: ArenaGridWindow;
  // Presentation, built in steps by `build`.
  private arena!: ArenaBuilderResult;
  private bases!: BaseManager;
  private bridges: BridgeRenderer | null = null;
  private background!: ReturnType<typeof createArenaBackground>;
  private lighting!: LightingSystem;
  private shadows!: ShadowSystem;
  private presentationTimeMs=0;
  private sunlight!: WorldSunlightPresentation;
  private fx!: CameraPostFxController;
  private powerUps!: PowerUpRenderer;
  private gpu!: GpuVfxSystem;
  private readonly animations = new TurretAnimationController();
  private readonly watchtowers = new Map<string, WatchtowerVisual>();
  private readonly turrets = new Map<string, { visual: WorldTurretVisual; raised: boolean }>();
  private readonly pedestalIds = new Map<string, number>();
  private readonly wallIds = new Map<string, number>();
  private readonly layout: ArenaLayout;
  private occluders!: LightOccluderIndex;
  private readonly blocked = new Set<string>();
  private mates: readonly PersistentBaseEditorMateObject[] = [];
  /** Cells the draft, the rewards and the teammates block in the round, as the routes see them. */
  private constructionCells: readonly { gridX: number; gridY: number }[] = [];
  private routePlanner: DeploymentRoutePlanner | null = null;
  private routes: RouteFlowPresentation | null = null;
  private shadowsInitialized = false;
  /** The last plan and the cells and what-if it was planned with; an unchanged draft reuses it. */
  private lastPlan: { readonly cells: string; readonly plan: DeploymentRoutePlan } | null = null;
  /** The situation map's what-if: fallen outposts, blown bridges, open teleporters. */
  private scenario: DeploymentRouteScenario = DEPLOYMENT_ROUTE_START;
  /** Minutes: the map's time when the round starts; the personal draft keeps the lobby's. */
  readonly timeOfDay: number;

  constructor(private readonly scene: Phaser.Scene, private model: PersistentBaseEditorModel, private color: number,
    options: { readonly previewArea?: PersistentBaseBuildArea; readonly terrain?: PersistentBaseEditorTerrain | null } = {}) {
    ensureWatchtowerTexture(scene);
    this.terrain = options.terrain ?? null;
    this.timeOfDay = (this.terrain && parseTimeOfDay(this.terrain.definition.initialTimeOfDay)) ?? DEFAULT_LOBBY_TIME_OF_DAY_MINUTES;
    const healthRewards = model.baseline.persistentBaseHealthRewards;
    let window: ArenaGridWindow;
    if (this.terrain) {
      const { definition } = this.terrain;
      const profile = getAuthoredWorldMetricsProfile(definition.metrics.widthCells, definition.metrics.heightCells);
      const metricsProfile: ArenaMetricsProfile = { ...profile, arenaOffsetX: 0, arenaOffsetY: 0 };
      this.world = createWorldRuntimeContext({ definition, metricsProfile, descriptor: {
        worldRevision: 1, definitionId: definition.id, seed: this.terrain.seed, generatorVersion: ARENA_GENERATOR_VERSION,
        layoutFingerprint: this.terrain.fingerprint,
        parameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: this.terrain.areaStage, persistentBaseHealthRewards: healthRewards } } });
      const site = this.world.persistentBaseSite;
      if (!site) throw new Error(`[PersistentBaseEditorWorld] Map ${this.terrain.mapId} has no persistent base site`);
      this.anchor = site.anchor;
      this.siteArea = site.buildArea;
      const cells = { widthCells: this.world.metrics.gridCols, heightCells: this.world.metrics.gridRows };
      this.view = cellRect(getPersistentBaseEditorDetailWindow(cells, this.anchor, PERSISTENT_BASE_EDITOR_DETAIL_RADIUS));
      window = getPersistentBaseEditorDetailWindow(cells, this.anchor, { x: PERSISTENT_BASE_EDITOR_DETAIL_RADIUS.x + CROP_MARGIN_CELLS,
        y: PERSISTENT_BASE_EDITOR_DETAIL_RADIUS.y + CROP_MARGIN_CELLS });
      this.layout = cropArenaLayout(this.terrain.layout, window);
      this.collectBlockedCells();
    } else {
      const size = getPersistentBaseEditorSize(model.area, options.previewArea);
      const anchor = (size / CELL_SIZE - 1) / 2;
      const cells = anchor * 2 + 1;
      const site = { baseId: 'personal-base', anchor: { gridX: anchor, gridY: anchor }, maxAreaStage: model.areaStage };
      const definition: WorldDefinition = { id: 'world:base-editor', metrics: { widthCells: cells, heightCells: cells },
        bases: [buildPersistentBaseCoreBaseConfig(site)], persistentBaseSite: site, terrain: {}, initialTimeOfDay: '08:00',
        actionPolicy: { combat: false }, participationPolicy: { selfAdmit: false }, presentationPolicy: { previewWithoutParticipation: true } };
      this.world = createWorldRuntimeContext({ definition, descriptor: {
        worldRevision: 1, definitionId: definition.id, seed: 20260524, generatorVersion: 1, layoutFingerprint: 'personal-editor',
        parameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: model.areaStage, persistentBaseHealthRewards: healthRewards } },
        metricsProfile: { arenaWidth: size, arenaHeight: size, arenaOffsetX: 0, arenaOffsetY: 0,
          arenaViewportWidth: size, arenaViewportHeight: size, usesDynamicCamera: true, showStaticArenaFrames: false } });
      this.anchor = site.anchor;
      this.siteArea = model.area;
      window = { minX: 0, minY: 0, maxX: cells - 1, maxY: cells - 1 };
      this.view = cellRect(window);
      this.layout = { seed: this.world.descriptor.seed, rocks: [], trees: [], tracks: [], dirt: [], water: [], decals: [], powerUpPedestals: [] };
    }
    this.window = window;
    this.bounds = cellRect(window);
  }
  /**
   * Builds the presentation in steps: a stage prepared in the lobby spreads them over frames, a
   * player waiting for it runs them at once. Nothing but `destroy` may be used before it finishes.
   */
  *build(): Generator<ArenaBuildPause, void> {
    // Measured sections of the Bauhof's loading run ('editor'); free without an open run.
    let mark = loadingTimeline.start();
    const section = (name: string): void => { loadingTimeline.end(`editor/${name}`, mark); mark = loadingTimeline.start(); };
    const scene = this.scene, window = this.window;
    const viewport = { width: this.bounds.width, height: this.bounds.height };
    this.background = createArenaBackground(scene, this.bounds.x + this.bounds.width / 2, this.bounds.y + this.bounds.height / 2,
      viewport.width, viewport.height);
    section('background');
    yield;
    // Only bases that stand when the round starts; dormant objectives appear later in a mission.
    const bases = this.world.bases.filter((base) => !base.dormant
      && base.cells.some((cell) => cell.gridX >= window.minX && cell.gridX <= window.maxX && cell.gridY >= window.minY && cell.gridY <= window.maxY));
    const gravel = { anchor: this.anchor, buildArea: this.siteArea, seed: this.world.descriptor.seed };
    // Terrain is built once. Personal buildings enter through the normal runtime wall path.
    this.arena = yield* new ArenaBuilder(scene).buildDynamicStages(this.layout, { worldMetrics: this.world.metrics, presentation: true,
      enablePersistentBaseGravel: true, persistentBaseGravel: gravel, vegetationClearings: resolveSpawnStructureVegetationClearings(bases) });
    section('arena');
    yield;
    this.bridges = this.layout.bridges?.length ? new BridgeRenderer(scene, this.layout.bridges, this.world.metrics) : null;
    section('bridges');
    this.lighting = new LightingSystem(scene, viewport);
    this.lighting.setTimeOfDay(this.timeOfDay);
    this.lighting.setActive(true);
    this.bases = new BaseManager(scene, bases, this.world.metrics);
    this.bases.setPersistentBaseGravel(gravel);
    section('lighting+bases');
    this.occluders = new LightOccluderIndex({ rocks: () => this.arena.rockPhysicsProxies,
      trunks: () => [], baseCells: () => this.bases.getObstacleRectangles(), baseGeneration: () => this.bases.getObstacleGeneration() });
    this.lighting.setOccluderIndex(this.occluders);
    yield 'heavy';
    this.gpu = new GpuVfxSystem(scene);
    section('gpu');
    yield;
    this.powerUps = new PowerUpRenderer(scene);
    this.powerUps.setLightingSystem(this.lighting);
    this.powerUps.registerGpuVfx(this.gpu);
    section('powerups');
    yield;
    this.shadows = new ShadowSystem(scene);
    this.shadows.setWorldBoundsOverride({ minX: this.bounds.x, minY: this.bounds.y,
      maxX: this.bounds.x + this.bounds.width, maxY: this.bounds.y + this.bounds.height });
    this.shadows.setTimeOfDay(this.timeOfDay);
    // Rewards stand on the base (raised, as base-owned turrets in a round); personal turrets on the ground.
    this.shadows.turretCasters.addSource(visit => { for (const { visual, raised } of this.turrets.values()) visit(visual.image, raised); });
    // Same fort presentation as a round: torches and fire bowls burn, the fort casts its shadow.
    bindBaseFortPresentation(this.bases, { lighting: this.lighting, shadow: this.shadows, gpuVfx: this.gpu, camera: scene.cameras.main });
    const surfaces = this.bases.getBases().flatMap(base => [...base.getShadowSurfaceCells()]);
    this.shadows.syncBaseShadows(surfaces);
    section('shadows+fort');
    // Editing needs an unobscured build surface, regardless of the gameplay fog preference.
    this.fx = new CameraPostFxController(scene, scene.cameras.main);
    const mapConfig = this.terrain ? resolveCoopDefenseMapConfig({ definitionId: this.terrain.definition.id }, null) : null;
    // The round's look as it starts: its time of day and the map's own grade.
    const grade: WorldGradeInputs = { skyState: resolveSkyState(this.timeOfDay), ...resolveMapWorldGrade(mapConfig),
      bossPhase: 0, localHpFraction: 1, gamePhase: 'ARENA' };
    this.fx.setBaseGrade(resolveBaseGrade(grade), grade);
    section('postfx');
    yield 'heavy';
    this.sunlight=new WorldSunlightPresentation(scene,{
      ground:this.arena.groundSurface,rocks:this.arena.rockVisualSystem,rockOverlays:this.arena.rockOverlaySurface,
      canopies:this.arena.canopyObjects,water:this.arena.waterSurface,wildlife:this.arena.wildlife,
      shadow:this.shadows,lighting:this.lighting,fog:null,postFx:this.fx,layout:this.layout,worldContext:this.world,
      structures:{setSunlight:(light)=>this.bases.setFortSunlight(light)},
    });
    section('sunlight');
    yield;
    // Enemy routes of the next round over the real terrain (Lagekarte); only maps with a mission.
    this.routePlanner = this.terrain && mapConfig ? new DeploymentRoutePlanner({ mapConfig, worldMetrics: this.world.metrics,
      layout: this.terrain.layout, bases: this.world.bases.filter((base) => !base.dormant),
      persistentBaseId: this.world.persistentBaseSite?.baseId ?? null,
      spawnFocusCell: this.terrain.definition.spawnFocusCell, detail: this.view }) : null;
    this.routes = this.routePlanner ? new RouteFlowPresentation(scene, this.lighting) : null;
    if (this.routes) this.sunlight.setActivityVoidDanger(this.routes.voidDanger);
    section('routes');
    yield 'heavy';
    this.sunlight.update(this.timeOfDay,0);
    section('sunlight-first-update');
    yield;
    this.syncObjects();
    section('sync-objects');
  }
  /** A round's reveal barriers (WorldPresentationFrameBinding) for this World, named for the loading run. */
  getRevealGates(view: WorldRect): Readonly<Record<string, boolean>> {
    return {
      'surface-chunks': ArenaBuilder.isSurfaceWorkingSetReady(this.arena, view),
      'shadow-chunks': this.shadows.isStaticReadyForView(view),
      'rock-formation': this.arena.rockVisualSystem?.getPreparationState().ready ?? true,
      // Needs a rendered frame; a hidden editor reaches it only once it shows.
      'sunlight': this.sunlight.isPrepared(),
      'gpu-shaders': this.gpu.isShaderWarmupComplete(),
    };
  }
  /** Texture memory of the chunked surfaces and the rock formation, for the loading run. */
  getDiagnostics(): { readonly chunkBytes: number; readonly formationBytes: number } {
    const surfaces = [this.arena.groundSurface?.getStats(), this.arena.rockOverlaySurface?.getStats(), this.shadows.getStaticSurfaceStats()];
    return { chunkBytes: surfaces.reduce((sum, stats) => sum + (stats?.allocatedPixels ?? 0) * 4, 0),
      formationBytes: this.arena.rockVisualSystem?.getFormationDiagnostics()?.textureBytes ?? 0 };
  }
  /** The site's anchor with the draft's orientation; the draft itself stays canonical. */
  get frame(): PersistentBaseFrame {
    return { anchor: this.anchor, quarterTurns: this.model.quarterTurns };
  }
  /** Map terrain that blocks a construction on this cell, for the conflict preview. */
  isCellBlocked(gridX: number, gridY: number): boolean {
    return this.blocked.has(`${gridX}:${gridY}`);
  }
  /** Another draft on the same terrain: an editor session over a World built ahead of it. */
  setModel(model: PersistentBaseEditorModel, color: number): void {
    this.model = model; this.color = color;
    this.syncObjects();
  }
  /** Teammates' constructions as the round would materialize them; drawn, never edited. */
  setMates(mates: readonly PersistentBaseEditorMateObject[]): void {
    this.mates = mates;
    this.syncObjects();
  }
  /**
   * Plans the next round's enemy routes with the draft as it stands and shows them. `null` without
   * map terrain or mission.
   */
  planRoutes(): DeploymentRoutePlan | null {
    if (!this.routePlanner || !this.routes) return null;
    const { outpostsDestroyed, bridgesDestroyed, teleportersOpen } = this.scenario;
    const cells = `${+outpostsDestroyed}${+bridgesDestroyed}${+teleportersOpen}|`
      + this.constructionCells.map(({ gridX, gridY }) => `${gridX}:${gridY}`).sort().join(',');
    if (this.lastPlan?.cells === cells) return this.lastPlan.plan;
    const plan = this.routePlanner.plan(this.constructionCells, this.scenario);
    this.lastPlan = { cells, plan };
    const toFlow = (dim: number) => plan.routes.filter((route) => route.points.length > 1)
      .map((route): RouteFlowRoute => ({ points: route.points, breach: route.breach !== null, strength: route.relevant ? 1 : dim }));
    const zones = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const route of plan.routes) if (route.relevant && route.zone) zones.set(`${route.zone.x}:${route.zone.y}`, route.zone);
    const { anchor, siteArea } = this;
    this.routes.setPlan({
      view: plan.mode === 'routes' ? toFlow(.4) : [], overview: toFlow(.75), zones: [...zones.values()], clip: this.view,
      isInsideBuildArea: (x, y) => isCellInsidePersistentBaseBuildArea(Math.floor(x / CELL_SIZE) - anchor.gridX,
        Math.floor(y / CELL_SIZE) - anchor.gridY, siteArea),
    });
    return plan;
  }
  /** What-if switches this map offers; `null` without routes. */
  get scenarioOptions(): DeploymentRouteScenarioOptions | null { return this.routePlanner?.scenarioOptions ?? null; }
  /** Replans the routes for a what-if; the round itself always starts with all switches off. */
  setScenario(scenario: DeploymentRouteScenario): DeploymentRoutePlan | null {
    this.scenario = scenario;
    return this.planRoutes();
  }
  /** The routes also flow over the situation map's minimap, in its panel space. */
  attachRouteMinimap(container: Phaser.GameObjects.Container, placement: { readonly originX: number; readonly originY: number; readonly unit: number }): void {
    this.routes?.attachMinimap(container, placement);
  }
  /** Update object identities in place; terrain, lighting and camera resources stay alive. */
  syncObjects(): void {
    const frame = this.frame;
    const objects: BaseEditorObject[] = [
      ...this.model.rewards.map(p => ({ kind: 'reward' as const, id: p.rewardId })),
      ...this.model.constructions.map(p => ({ kind: 'construction' as const, id: p.persistentId })),
    ];
    const walls = new Map<string, { gridX: number; gridY: number; tint: number; weapon?: TurretWeaponId; angle: number; color: number }>();
    const pedestals: SyncedPowerUpPedestal[] = [];
    const turretKeys = new Set<string>();
    const watchtowerKeys = new Set<string>();
    const place = (key: string, color: number, raised: boolean, appearance: {
      readonly wall: boolean; readonly watchtower?: boolean; readonly weapon?: TurretWeaponId; readonly powerUpDefId?: string;
      readonly tint: number; readonly gridX: number; readonly gridY: number;
      readonly footprint: readonly { readonly dx: number; readonly dy: number }[]; readonly angle: number;
    }): void => {
      const { gridX, gridY, angle } = appearance;
      const x = (gridX + .5) * CELL_SIZE, y = (gridY + .5) * CELL_SIZE;
      if (appearance.watchtower) {
        watchtowerKeys.add(key);
        let visual = this.watchtowers.get(key);
        if (!visual) { visual = new WatchtowerVisual(this.scene); this.watchtowers.set(key, visual); }
        visual.sync({ gridX, gridY, hp: 1, maxHp: 1 }, this.world.metrics);
      }
      if (appearance.wall) for (const cell of appearance.footprint) {
        const gx = gridX + cell.dx, gy = gridY + cell.dy;
        walls.set(gx + ',' + gy, { gridX: gx, gridY: gy, tint: appearance.tint, weapon: appearance.weapon, angle, color });
      }
      if (appearance.weapon) {
        turretKeys.add(key);
        let entry = this.turrets.get(key);
        if (!entry) {
          entry = { visual: createWorldTurretVisual(this.scene, appearance.weapon, x, y, color), raised };
          this.turrets.set(key, entry);
        }
        entry.raised = raised;
        syncWorldTurretVisualPose(entry.visual, key, appearance.weapon, x, y, angle, color, this.animations);
        syncWorldTurretFoundation(entry.visual, x, y, !raised);
      }
      if (appearance.powerUpDefId) {
        if (!this.pedestalIds.has(key)) this.pedestalIds.set(key, this.pedestalIds.size);
        pedestals.push({ id: this.pedestalIds.get(key)!, defId: appearance.powerUpDefId,
          x, y, ownerColor: color, hasPowerUp: true, nextRespawnAt: 0 });
      }
    };
    for (const object of objects) {
      const entry = this.model.getPosition(object)!;
      const appearance = getBaseEditorAppearance(this.model, object);
      if (!appearance) continue;
      const placed = toWorldFootprint(frame, entry.relativeGridX, entry.relativeGridY, appearance.footprint);
      place(baseEditorObjectKey(object), this.color, object.kind === 'reward', { ...appearance, tint: appearance.ownerTintStrength,
        gridX: placed.gridX, gridY: placed.gridY, footprint: placed.footprint,
        angle: appearance.watchtower ? 0 : toWorldAngle(frame, appearance.angle) });
    }
    for (const mate of this.mates) place(`mate:${mate.key}`, mate.color, false, mate);
    for (const [key, entry] of this.turrets) if (!turretKeys.has(key)) {
      destroyWorldTurretVisual(entry.visual); this.turrets.delete(key);
    }
    for (const [key, visual] of this.watchtowers) if (!watchtowerKeys.has(key)) { visual.destroy(); this.watchtowers.delete(key); }
    this.constructionCells = [...walls.values()].map(({ gridX, gridY }) => ({ gridX, gridY }));
    this.powerUps.syncPedestals(pedestals);
    this.powerUps.sync(pedestals.map(p => ({ uid: p.id, defId: p.defId, x: p.x, y: p.y })));
    const runtime: SyncedPlaceableRock[] = [];
    let wallsChanged = false;
    for (const [key, id] of this.wallIds) if (!walls.has(key) && this.arena.rockPhysicsProxies[id]?.active) {
      ArenaBuilder.destroyRockAndRetile(this.arena, this.layout.rocks, id);
      wallsChanged = true;
    }
    for (const [key, wall] of walls) {
      let id = this.wallIds.get(key);
      if (id === undefined) {
        id = this.layout.rocks.length;
        this.wallIds.set(key, id);
        this.layout.rocks.push({ gridX: wall.gridX, gridY: wall.gridY });
      }
      if (!this.arena.rockPhysicsProxies[id]?.active) {
        const proxy = ArenaBuilder.spawnRockAndRetile(this.scene, this.arena, this.layout.rocks, id,
          wall.color, wall.tint, 1, 1, { offsetX: 0, offsetY: 0, width: this.world.metrics.widthPx, height: this.world.metrics.heightPx });
        proxy.obstacleClass = 'low';
        wallsChanged = true;
      }
      this.arena.rockVisualStates.patch(id, { material: 'walls', ownerColor: wall.color, ownerTintStrength: wall.tint });
      runtime.push({ id, kind: wall.weapon ? 'turret' : 'rock', gridX: wall.gridX, gridY: wall.gridY,
        hp: 1, maxHp: 1, ownerId: 'local-editor', ownerColor: wall.color, angle: wall.angle,
        expiresAt: 0, warningStartsAt: 0, turretWeaponId: wall.weapon });
    }
    if (wallsChanged) {
      ArenaBuilder.refreshRockSurfaceTints(this.arena, this.layout);
      this.occluders.markDirty();
    }
    this.arena.rockVisualSystem?.flush();
    // Preserve finished shadow textures until replacement bakes are ready.
    if (wallsChanged || !this.shadowsInitialized) {
      this.shadows.rebuildStaticLayoutShadows(this.layout, { offsetX: 0, offsetY: 0, runtimeRocks: runtime,
        rockVisibilityPredicate: id => !!this.arena.rockPhysicsProxies[id]?.active }, true);
      this.shadowsInitialized = true;
    }
  }
  /** The editor reveals the entire World at once, after its asynchronous bakes finish. */
  isReadyForView(view: WorldRect): boolean {
    return ArenaBuilder.isSurfaceWorkingSetReady(this.arena, view)
      && this.shadows.isStaticReadyForView(view);
  }
  /** `bakeBudgetMs`: the frame budget while the World prepares hidden; otherwise the scheduler's own. */
  update(now: number, delta: number, view: WorldRect, bakeBudgetMs?: number): void {
    // Water masks are prepared over several frames, as in a round's presentation frame.
    this.arena.waterSurface?.prepareMasks();
    ArenaBuilder.updateSurfaceResidency(this.arena, view);
    this.shadows.updateStaticResidency(view);
    // Turret mesh shadows; there are no players, projectiles or trains in this World.
    this.shadows.syncDynamicShadows([], [], null);
    this.bridges?.sync(() => null, now);
    this.bases.syncLights();
    this.animations.update(delta);
    this.powerUps.updatePedestals(now);
    this.gpu.update(delta);
    this.presentationTimeMs+=Math.max(0,delta);
    this.powerUps.updatePresentation(this.presentationTimeMs);
    this.routes?.update(delta);
    this.sunlight.update(this.timeOfDay,this.presentationTimeMs);
    this.lighting.update();
    this.fx.update(delta);
    // Residency enqueues the same grass, gravel, detail and shadow bakes used by a map.
    // This standalone scene owns its own queue, so ArenaScene cannot service it.
    ChunkedRenderSurface.flushBakeBudget(this.scene, bakeBudgetMs);
  }
  destroy(): void {
    for (const visual of this.watchtowers.values()) visual.destroy();
    this.watchtowers.clear();
    this.routes?.destroy(); this.routePlanner?.destroy();
    this.sunlight?.destroy();
    this.fx?.destroy(); this.powerUps?.destroy(); this.gpu?.destroy();
    this.animations.clear();
    for (const { visual } of this.turrets.values()) destroyWorldTurretVisual(visual);
    this.bridges?.destroy();
    this.bases?.destroy(); this.shadows?.destroy(); this.lighting?.destroy();
    if (this.arena) ArenaBuilder.destroyDynamic(this.arena);
    this.background?.ground.destroy(); this.background?.macro.destroy();
  }

  /** Cells of the round's terrain that a construction cannot use: rocks, trunks, water, other bases. */
  private collectBlockedCells(): void {
    const layout = this.terrain!.layout;
    const add = (cell: { readonly gridX: number; readonly gridY: number }) => this.blocked.add(`${cell.gridX}:${cell.gridY}`);
    for (const rock of layout.rocks) add(rock);
    for (const tree of layout.trees) add(tree);
    for (const prop of layout.reactiveProps ?? []) add(prop);
    const decks = new Set<string>();
    for (const bridge of layout.bridges ?? []) {
      const width = bridge.axis === 'horizontal' ? bridge.spanCells : bridge.deckWidthCells;
      const height = bridge.axis === 'horizontal' ? bridge.deckWidthCells : bridge.spanCells;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) decks.add(`${bridge.gridX + x}:${bridge.gridY + y}`);
    }
    for (const water of layout.water ?? []) if (!decks.has(`${water.gridX}:${water.gridY}`)) add(water);
    const siteBaseId = this.world.persistentBaseSite?.baseId;
    for (const base of this.world.bases) if (base.id !== siteBaseId && !base.dormant) for (const cell of base.cells) add(cell);
  }
}

function cellRect(window: ArenaGridWindow): WorldRect {
  return { x: window.minX * CELL_SIZE, y: window.minY * CELL_SIZE,
    width: (window.maxX - window.minX + 1) * CELL_SIZE, height: (window.maxY - window.minY + 1) * CELL_SIZE };
}
