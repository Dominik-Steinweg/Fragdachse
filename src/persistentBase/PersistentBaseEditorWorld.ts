import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import { getStoredGroundFogEnabled } from '../utils/localPreferences';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import { createWorldRuntimeContext, type WorldRuntimeContext } from '../world/WorldRuntimeContext';
import { ArenaBuilder, type ArenaBuilderResult } from '../arena/ArenaBuilder';
import { createArenaBackground } from '../arena/ArenaBackgroundRenderer';
import { ChunkedRenderSurface } from '../arena/chunks/ChunkedRenderSurface';
import { BaseManager } from '../entities/BaseManager';
import { createWorldTurretVisual, syncWorldTurretVisualPose, type WorldTurretVisual } from '../entities/WorldTurretVisual';
import { TurretAnimationController } from '../effects/TurretAnimationController';
import { LightingSystem } from '../effects/LightingSystem';
import { LightOccluderIndex } from '../effects/LightOccluderIndex';
import { ShadowSystem } from '../effects/ShadowSystem';
import { GroundFogSystem } from '../effects/groundFog/GroundFogSystem';
import { CameraPostFxController } from '../effects/postfx/CameraPostFxController';
import { resolveBaseGrade } from '../effects/postfx/worldGrade';
import { DEFAULT_LOBBY_TIME_OF_DAY_MINUTES, resolveSkyState } from '../effects/TimeOfDay';
import { GpuVfxSystem } from '../effects/gpu/GpuVfxSystem';
import { PowerUpRenderer } from '../powerups/PowerUpRenderer';
import type { ArenaLayout, SyncedPlaceableRock, SyncedPowerUpPedestal, TurretWeaponId } from '../types';
import { buildPersistentBaseCoreBaseConfig, getPersistentBaseBuildAreaExtentCells, type PersistentBaseBuildArea } from './PersistentBaseCore';
import type { BaseEditorObject, PersistentBaseEditorModel } from './PersistentBaseEditorModel';
import { baseEditorObjectKey, getBaseEditorAppearance } from './PersistentBaseEditorAppearance';

/** Two ground cells leave room for gravel edges, shadows and vegetation around the build area. */
export function getPersistentBaseEditorSize(area: PersistentBaseBuildArea): number {
  return (2 * (getPersistentBaseBuildAreaExtentCells(area) + 2) + 1) * CELL_SIZE;
}

/** A local, non-participating World. It never creates an Activity, player or network identity. */
export class PersistentBaseEditorWorld {
  readonly world: WorldRuntimeContext;
  readonly anchor: number;
  readonly size: number;
  private readonly arena: ArenaBuilderResult;
  private readonly bases: BaseManager;
  private readonly background: ReturnType<typeof createArenaBackground>;
  private readonly lighting: LightingSystem;
  private readonly shadows: ShadowSystem;
  private readonly fog: GroundFogSystem;
  private readonly fx: CameraPostFxController;
  private readonly powerUps: PowerUpRenderer;
  private readonly gpu: GpuVfxSystem;
  private readonly animations = new TurretAnimationController();
  private readonly turrets = new Map<string, WorldTurretVisual>();
  private readonly pedestalIds = new Map<string, number>();
  private readonly wallIds = new Map<string, number>();
  private readonly layout: ArenaLayout;
  private readonly occluders: LightOccluderIndex;
  private shadowsInitialized = false;
  private readonly timeOfDay = DEFAULT_LOBBY_TIME_OF_DAY_MINUTES;

  constructor(private readonly scene: Phaser.Scene, private readonly model: PersistentBaseEditorModel, private readonly color: number) {
    this.size = getPersistentBaseEditorSize(model.area);
    this.anchor = (this.size / CELL_SIZE - 1) / 2;
    const cells = this.anchor * 2 + 1;
    const viewport = { width: this.size, height: this.size };
    const site = { baseId: 'personal-base', anchor: { gridX: this.anchor, gridY: this.anchor } };
    const definition: WorldDefinition = { id: 'world:base-editor', metrics: { widthCells: cells, heightCells: cells },
      bases: [buildPersistentBaseCoreBaseConfig(site)], persistentBaseSite: site, terrain: {}, initialTimeOfDay: '08:00',
      actionPolicy: { combat: false }, participationPolicy: { selfAdmit: false }, presentationPolicy: { previewWithoutParticipation: true } };
    this.world = createWorldRuntimeContext({ definition, descriptor: {
      worldRevision: 1, definitionId: definition.id, seed: 20260524, generatorVersion: 1, layoutFingerprint: 'personal-editor',
      parameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: model.baseline.persistentBaseAreaStage,
        persistentBaseHealthRewards: model.baseline.persistentBaseHealthRewards } },
      metricsProfile: { arenaWidth: this.size, arenaHeight: this.size, arenaOffsetX: 0, arenaOffsetY: 0,
        arenaViewportWidth: viewport.width, arenaViewportHeight: viewport.height, usesDynamicCamera: true, showStaticArenaFrames: false } });
    this.background = createArenaBackground(scene, this.size / 2, this.size / 2, viewport.width, viewport.height);
    // Terrain is built once. Personal buildings enter through the normal runtime wall path.
    const layout = this.layout = { seed: this.world.descriptor.seed, rocks: [], trees: [], tracks: [], dirt: [], water: [], decals: [], powerUpPedestals: [] };
    this.arena = new ArenaBuilder(scene).buildDynamic(layout, { worldMetrics: this.world.metrics, presentation: true,
      enablePersistentBaseGravel: true, persistentBaseGravel: { anchor: site.anchor, buildArea: model.area, seed: layout.seed } });
    this.lighting = new LightingSystem(scene, viewport);
    this.lighting.setTimeOfDay(this.timeOfDay);
    this.lighting.setActive(true);
    this.bases = new BaseManager(scene, this.world.bases, this.world.metrics);
    this.bases.setLightingSystem(this.lighting);
    this.occluders = new LightOccluderIndex({ rocks: () => this.arena.rockPhysicsProxies,
      trunks: () => [], baseCells: () => this.bases.getObstacleRectangles(), baseGeneration: () => this.bases.getObstacleGeneration() });
    this.lighting.setOccluderIndex(this.occluders);
    this.gpu = new GpuVfxSystem(scene);
    this.powerUps = new PowerUpRenderer(scene);
    this.powerUps.setLightingSystem(this.lighting);
    this.powerUps.registerGpuVfx(this.gpu);
    this.shadows = new ShadowSystem(scene);
    this.shadows.setWorldBoundsOverride({ minX: 0, minY: 0, maxX: this.size, maxY: this.size });
    this.shadows.setTimeOfDay(this.timeOfDay);
    const surfaces = this.bases.getBases().flatMap(base => [...base.getSurfaceImages()]);
    this.shadows.syncBaseShadows(surfaces);
    this.fog = new GroundFogSystem(scene, { offsetX: 0, offsetY: 0, width: this.size, height: this.size }, layout.seed, []);
    this.fog.enabled = getStoredGroundFogEnabled();
    this.fog.terrain.setObstacle('base', this.bases.getObstacleRectangles().map(body => ({ gridX: Math.floor(body.x / CELL_SIZE), gridY: Math.floor(body.y / CELL_SIZE) })), true);
    this.fog.setSurfaceImages(surfaces);
    this.fx = new CameraPostFxController(scene, scene.cameras.main);
    this.fx.setBaseGrade(resolveBaseGrade({ skyState: resolveSkyState(this.timeOfDay), isVoidMap: false, bossPhase: 0, localHpFraction: 1, gamePhase: 'ARENA' }));
    this.syncObjects();
  }
  /** Update object identities in place; terrain, fog, lighting and camera resources stay alive. */
  syncObjects(): void {
    const objects: BaseEditorObject[] = [
      ...this.model.rewards.map(p => ({ kind: 'reward' as const, id: p.rewardId })),
      ...this.model.constructions.map(p => ({ kind: 'construction' as const, id: p.persistentId })),
    ];
    const walls = new Map<string, { gridX: number; gridY: number; tint: number; weapon?: TurretWeaponId; angle: number }>();
    const pedestals: SyncedPowerUpPedestal[] = [];
    const turretKeys = new Set<string>();
    for (const object of objects) {
      const entry = this.model.getPosition(object)!;
      const appearance = getBaseEditorAppearance(this.model, object);
      if (!appearance) continue;
      const key = baseEditorObjectKey(object);
      const gridX = this.anchor + entry.relativeGridX, gridY = this.anchor + entry.relativeGridY;
      const x = (gridX + .5) * CELL_SIZE, y = (gridY + .5) * CELL_SIZE;
      if (appearance.wall) for (const cell of appearance.footprint) {
        const gx = gridX + cell.dx, gy = gridY + cell.dy;
        walls.set(gx + ',' + gy, { gridX: gx, gridY: gy, tint: appearance.ownerTintStrength,
          weapon: appearance.weapon, angle: appearance.angle });
      }
      if (appearance.weapon) {
        turretKeys.add(key);
        let visual = this.turrets.get(key);
        if (!visual) {
          visual = createWorldTurretVisual(this.scene, appearance.weapon, x, y, this.color);
          this.turrets.set(key, visual);
        }
        syncWorldTurretVisualPose(visual, key, appearance.weapon, x, y, appearance.angle, this.color, this.animations);
      }
      if (appearance.powerUpDefId) {
        if (!this.pedestalIds.has(key)) this.pedestalIds.set(key, this.pedestalIds.size);
        pedestals.push({ id: this.pedestalIds.get(key)!, defId: appearance.powerUpDefId,
          x, y, ownerColor: this.color, hasPowerUp: true, nextRespawnAt: 0 });
      }
    }
    for (const [key, visual] of this.turrets) if (!turretKeys.has(key)) {
      visual.image.destroy(); visual.aura.destroy(); this.turrets.delete(key);
    }
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
          this.color, wall.tint, 1, 1, { offsetX: 0, offsetY: 0, width: this.size, height: this.size });
        proxy.obstacleClass = 'low';
        wallsChanged = true;
      }
      this.arena.rockVisualStates.patch(id, { material: 'walls', ownerColor: this.color, ownerTintStrength: wall.tint });
      runtime.push({ id, kind: wall.weapon ? 'turret' : 'rock', gridX: wall.gridX, gridY: wall.gridY,
        hp: 1, maxHp: 1, ownerId: 'local-editor', ownerColor: this.color, angle: wall.angle,
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
    this.fog.terrain.setObstacle('constructions', [...walls.values()], true);
  }
  update(now: number, delta: number, view: { x: number; y: number; width: number; height: number }): void {
    this.arena.groundSurface?.updateResidency(view);
    this.arena.rockOverlaySurface?.updateResidency(view);
    this.arena.rockVisualSystem?.updateVisibility(view);
    this.shadows.updateStaticResidency(view);
    this.bases.syncLights();
    this.animations.update(delta);
    this.powerUps.updatePedestals(now);
    this.gpu.update(delta);
    this.fog.update(delta, this.timeOfDay, view);
    this.lighting.update();
    this.fx.update(delta);
    // Residency enqueues the same grass, gravel, detail and shadow bakes used by a map.
    // This standalone scene owns its own queue, so ArenaScene cannot service it.
    ChunkedRenderSurface.flushBakeBudget(this.scene);
  }
  destroy(): void {
    this.fx.destroy(); this.fog.destroy(); this.powerUps.destroy(); this.gpu.destroy();
    this.animations.clear();
    for (const visual of this.turrets.values()) { visual.image.destroy(); visual.aura.destroy(); }
    this.bases.destroy(); this.shadows.destroy(); this.lighting.destroy();
    ArenaBuilder.destroyDynamic(this.arena);
    this.background.ground.destroy(); this.background.macro.destroy();
  }
}
