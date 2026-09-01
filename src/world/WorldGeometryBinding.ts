import * as Phaser from 'phaser';
import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import type { BaseSpec } from '../arena/BaseRegistry';
import { CELL_SIZE } from '../config';
import { FireObstacleIndex } from '../effects/FireObstacleIndex';
import { GROUND_FIRE_CELL_SIZE, type FireSystem } from '../effects/FireSystem';
import { LightOccluderIndex } from '../effects/LightOccluderIndex';
import type { LeafBlowerRenderer } from '../effects/LeafBlowerRenderer';
import type { LightingSystem } from '../effects/LightingSystem';
import type { BaseManager } from '../entities/BaseManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import {
  ARENA_MAP_GRID_CHANGED_EVENT,
  type ArenaMapGridChangedEvent,
} from '../scenes/arena/ArenaEvents';
import type { CombatSystem } from '../systems/CombatSystem';
import type { DecoySystem } from '../systems/DecoySystem';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { ArenaLayout } from '../types';
import type { WorldMaterialization } from './WorldMaterialization';
import type { WorldRuntimeContext } from './WorldRuntimeContext';
import type { WorldScopedBinding } from './WorldRuntime';

export interface WorldGeometryBindingInput {
  readonly scene: Phaser.Scene;
  readonly world: WorldRuntimeContext;
  readonly layout: ArenaLayout;
  readonly bases: readonly BaseSpec[];
  readonly arena: ArenaBuilderResult;
  readonly placement: PlacementSystem;
  readonly baseManager: BaseManager | null;
  readonly presentationRequired: boolean;
  readonly playerManager: PlayerManager;
  readonly combatSystem: CombatSystem;
  readonly decoySystem: DecoySystem;
  readonly projectileManager: ProjectileManager;
  readonly hostPhysics: HostPhysicsSystem;
  readonly fireSystem: FireSystem;
  readonly leafBlower: LeafBlowerRenderer;
  readonly lighting: LightingSystem;
  readonly isCaptureTheBeer: boolean;
  readonly getBarrierCellBlocked: (gridX: number, gridY: number) => boolean;
  readonly onDestroy?: (binding: WorldGeometryBinding) => void;
}

/**
 * World-scoped Bindung der scene-langlebigen Geometrie-Consumer.
 *
 * Sie besitzt keine Domain-Systeme. Sie installiert deren World-Sicht und loest dieselben
 * Referenzen beim Runtime-Teardown symmetrisch wieder, bevor die Materialisierung faellt.
 */
export class WorldGeometryBinding implements WorldScopedBinding {
  private readonly fireObstacles: FireObstacleIndex;
  private readonly gridListener: (event: ArenaMapGridChangedEvent) => void;
  private destroyed = false;

  constructor(private readonly input: WorldGeometryBindingInput) {
    const {
      scene,
      world,
      layout,
      bases,
      arena,
      placement,
      baseManager,
      presentationRequired,
      playerManager,
      combatSystem,
      decoySystem,
      projectileManager,
      hostPhysics,
      fireSystem,
      leafBlower,
    } = input;

    playerManager.setVisualsEnabledResolver(() => presentationRequired);
    playerManager.setWorldGeometry({
      metrics: world.metrics,
      bases,
      captureTheBeerBasesActive: input.isCaptureTheBeer,
      spawnExclusionZones: world.definition?.spawnExclusionZones,
      spawnFocusCell: world.definition?.spawnFocusCell,
    });
    playerManager.setLayout(layout);
    combatSystem.setWorldMetrics(world.metrics);
    decoySystem.setWorldMetrics(world.metrics);
    scene.physics.world.setBounds(
      world.metrics.offsetX,
      world.metrics.offsetY,
      world.metrics.widthPx,
      world.metrics.heightPx,
    );
    leafBlower.setTerrainMaterialLayout(layout, bases.flatMap((base) => base.cells));

    projectileManager.setRockGroup(arena.rockGroup, arena.rockPhysicsProxies, arena.trunkGroup);
    projectileManager.setBaseGroup(baseManager?.getBaseGroup() ?? null);
    decoySystem.setObstacleGroups(arena.rockGroup, arena.trunkGroup);
    combatSystem.setArenaObstacles(arena.rockPhysicsProxies, arena.trunkBodies);
    combatSystem.setBaseObstacles(baseManager?.getObstacleRectangles() ?? null);
    projectileManager.setObstacleIndex(combatSystem.getObstacleIndex());
    combatSystem.setBaseManager(baseManager);

    hostPhysics.setRockGroup(arena.rockGroup, arena.trunkGroup);
    hostPhysics.setBaseGroup(baseManager?.getBaseGroup() ?? null);
    hostPhysics.setWorldMetrics(world.metrics);
    hostPhysics.setMovementBlockedCellResolver((gridX, gridY) => {
      const rockId = arena.rockGrid.getIndex(gridX, gridY);
      if (rockId >= 0 && arena.rockPhysicsProxies[rockId]?.active === true) return true;
      if (baseManager?.isMovementBlockedCell(gridX, gridY) === true) return true;
      return input.getBarrierCellBlocked(gridX, gridY);
    });

    this.fireObstacles = new FireObstacleIndex({
      width: Math.ceil((world.metrics.offsetX + world.metrics.widthPx) / GROUND_FIRE_CELL_SIZE),
      height: Math.ceil((world.metrics.offsetY + world.metrics.heightPx) / GROUND_FIRE_CELL_SIZE),
      fireCellSize: GROUND_FIRE_CELL_SIZE,
      worldOriginX: world.metrics.offsetX,
      worldOriginY: world.metrics.offsetY,
      worldCellSize: CELL_SIZE,
    });
    this.rebuildFireObstacles();
    this.gridListener = (event) => { this.handleGridChange(event); };
    scene.game.events.on(ARENA_MAP_GRID_CHANGED_EVENT, this.gridListener);
    fireSystem.setGroundResolvers(
      (bounds) => this.fireObstacles.isCellBlocked(
        Math.floor(bounds.centerX / GROUND_FIRE_CELL_SIZE),
        Math.floor(bounds.centerY / GROUND_FIRE_CELL_SIZE),
      ),
      (startX, startY, endX, endY) => this.hasFireLineOfSight(startX, startY, endX, endY),
      () => this.fireObstacles.revision,
    );
  }

  /** Aktualisiert den world-lokalen Brandhindernisindex bei einer aktivierten Basis. */
  setBase(baseId: string, bounds: readonly Phaser.Geom.Rectangle[]): void {
    if (this.destroyed) return;
    this.fireObstacles.setBase(baseId, bounds);
  }

  /** Entfernt eine zerstoerte Basis aus dem world-lokalen Brandhindernisindex. */
  removeBase(baseId: string): void {
    if (this.destroyed) return;
    this.fireObstacles.removeBase(baseId);
  }

  /** Aktualisiert world-scoped Feuer-/LoS-Hindernisse nach einem Activity-Base-Overlay. */
  syncBaseObstacles(): void {
    if (this.destroyed) return;
    for (const base of this.input.baseManager?.getBases() ?? []) {
      if (base.isInert()) this.fireObstacles.removeBase(base.id);
      else this.fireObstacles.setBase(
        base.id,
        base.getCellBodies().map((body) => body.getBounds()),
      );
    }
  }

  /** Bindet den reinen Presentation-Index, sobald Activity-Barrieren materialisiert sind. */
  attachLightOccluders(
    materialization: WorldMaterialization,
    getBarrierObstacles: () => readonly Phaser.GameObjects.Rectangle[] | null,
  ): LightOccluderIndex | null {
    // Ein totes Binding darf keine scene-langlebigen Consumer mehr anfassen: eine bereits
    // nachfolgende World kann ihren eigenen Occluder-Index installiert haben.
    if (this.destroyed) return null;
    if (!this.input.presentationRequired) {
      materialization.setLightOccluders(null);
      this.input.lighting.setOccluderIndex(null);
      return null;
    }
    const index = new LightOccluderIndex({
      rocks: () => this.input.arena.rockPhysicsProxies,
      trunks: () => this.input.arena.trunkBodies,
      baseCells: () => this.input.baseManager?.getObstacleRectangles() ?? null,
      barrierCells: getBarrierObstacles,
      baseGeneration: () => this.input.baseManager?.getObstacleGeneration() ?? 0,
    });
    materialization.setLightOccluders(index);
    this.input.lighting.setOccluderIndex(index);
    return index;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const {
      scene,
      playerManager,
      combatSystem,
      decoySystem,
      projectileManager,
      hostPhysics,
      fireSystem,
      leafBlower,
      lighting,
    } = this.input;
    scene.game.events.off(ARENA_MAP_GRID_CHANGED_EVENT, this.gridListener);
    this.fireObstacles.reset();
    fireSystem.setGroundResolvers(null, null);
    lighting.setOccluderIndex(null);
    leafBlower.setTerrainMaterialLayout(null);
    hostPhysics.setMovementBlockedCellResolver(null);
    hostPhysics.setWorldMetrics(null);
    hostPhysics.setBaseGroup(null);
    hostPhysics.setRockGroup(null, null);
    projectileManager.setObstacleIndex(null);
    projectileManager.setBaseGroup(null);
    projectileManager.setRockGroup(null, null, null);
    decoySystem.setObstacleGroups(null, null);
    decoySystem.setWorldMetrics(null);
    combatSystem.setBaseManager(null);
    combatSystem.setBaseObstacles(null);
    combatSystem.setArenaObstacles(null, null);
    combatSystem.setWorldMetrics(null);
    playerManager.setWorldGeometry(null);
    this.input.onDestroy?.(this);
  }

  private rebuildFireObstacles(): void {
    const { arena, placement, baseManager } = this.input;
    this.fireObstacles.reset();
    for (let rockId = 0; rockId < arena.rockPhysicsProxies.length; rockId += 1) {
      const rock = arena.rockPhysicsProxies[rockId];
      if (rock?.active) this.fireObstacles.addStaticRock(rockId, rock.getBounds());
    }
    for (const rock of placement.getAllRuntimeRocks()) {
      if (rock.kind !== 'pedestal' && rock.collisionMode !== 'none') {
        this.fireObstacles.addPlaceableRock(rock.id, rock.gridX, rock.gridY);
      }
    }
    for (const trunk of arena.trunkBodies) {
      if (trunk?.active) this.fireObstacles.addLineOfSightBounds(trunk.getBounds());
    }
    for (const base of baseManager?.getBases() ?? []) {
      if (!base.isInert()) {
        this.fireObstacles.setBase(
          base.id,
          base.getCellBodies().map((body) => body.getBounds()),
        );
      }
    }
  }

  private handleGridChange(event: ArenaMapGridChangedEvent): void {
    if (this.destroyed || event.source === 'placeable_pedestal') return;
    if (event.source === 'static_rock'
      && event.reason === 'static_rock_destroyed'
      && event.obstacleId !== undefined) {
      this.fireObstacles.removeStaticRock(event.obstacleId);
      return;
    }
    if ((event.reason === 'placeable_added'
      || event.reason === 'placeable_removed'
      || event.reason === 'placeable_expired')
      && event.obstacleId !== undefined
      && event.gridX !== undefined
      && event.gridY !== undefined) {
      if (event.reason === 'placeable_added') {
        if (event.collisionMode !== 'none') {
          this.fireObstacles.addPlaceableRock(event.obstacleId, event.gridX, event.gridY);
        }
      } else {
        this.fireObstacles.removePlaceableRock(event.obstacleId);
      }
      return;
    }
    this.rebuildFireObstacles();
  }

  private hasFireLineOfSight(startX: number, startY: number, endX: number, endY: number): boolean {
    const dx = endX - startX;
    const dy = endY - startY;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / GROUND_FIRE_CELL_SIZE));
    for (let step = 1; step < steps; step += 1) {
      const t = step / steps;
      const gridX = Math.floor((startX + dx * t) / GROUND_FIRE_CELL_SIZE);
      const gridY = Math.floor((startY + dy * t) / GROUND_FIRE_CELL_SIZE);
      if (this.fireObstacles.hasLineOfSightObstacle(gridX, gridY)) return false;
    }
    return true;
  }
}
