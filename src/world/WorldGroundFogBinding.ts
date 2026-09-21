import type * as Phaser from 'phaser';
import type { GroundFogSystem } from '../effects/groundFog/GroundFogSystem';
import type { BaseManager } from '../entities/BaseManager';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import type { ArenaLayout } from '../types';
import type { EffectSystem } from '../effects/EffectSystem';
import type { ProjectilePresentationRuntime } from '../projectile/ProjectilePresentationRuntime';
import { ARENA_MAP_GRID_CHANGED_EVENT, type ArenaMapGridChangedEvent } from '../scenes/arena/ArenaEvents';

/** Active World wiring, detached before the presentation enters a frozen handoff. */
export class WorldGroundFogBinding {
  private generation = -1;
  private readonly pending = new Map<string, ArenaMapGridChangedEvent>();
  private readonly placeableIds = new Set<number>();
  private resyncPlaceables = true;
  private projectileOwner: ProjectilePresentationRuntime | null = null;
  private releaseProjectile: (() => void) | null = null;
  private readonly releaseExplosion: () => void;
  private readonly releaseCombat: () => void;
  private destroyed = false;
  private readonly listener = (event: ArenaMapGridChangedEvent): void => {
    if (event.source === 'placeable_pedestal') return;
    if (event.removedObstacles) {
      for (const cell of event.removedObstacles) this.pending.set(`construction:${cell.id}`,
        { reason: 'placeable_removed', source: 'placeable_rock', obstacleId: cell.id, gridX: cell.gridX, gridY: cell.gridY });
      return;
    }
    if (event.obstacleId === undefined) this.resyncPlaceables = true;
    else this.pending.set(`${event.source === 'static_rock' ? 'rock' : 'construction'}:${event.obstacleId}`, event);
  };
  constructor(private readonly scene: Phaser.Scene, readonly fog: GroundFogSystem,
    layout: ArenaLayout, arena: ArenaBuilderResult, effects: Pick<EffectSystem, 'bindGroundFogExplosion' | 'bindGroundFogCombat'>) {
    layout.rocks.forEach((cell, id) => {
      if (arena.rockPhysicsProxies[id]?.active) fog.terrain.setObstacle(`rock:${id}`, [cell], true);
      else fog.terrain.markOpened([cell]);
    });
    scene.game.events.on(ARENA_MAP_GRID_CHANGED_EVENT, this.listener);
    this.releaseExplosion = effects.bindGroundFogExplosion((x, y, radius, style) => fog.addExplosion(x, y, radius, style));
    this.releaseCombat = effects.bindGroundFogCombat({
      hitscan: (x, y, endX, endY, thickness) => fog.addHitscan(x, y, endX, endY, thickness),
      melee: (x, y, angle, arc, range) => fog.addMelee(x, y, angle, arc, range),
    });
  }
  sync(placement: Pick<PlacementSystem, 'getAllRuntimeRocks'> | null, bases: BaseManager | null,
    projectiles: ProjectilePresentationRuntime | null): void {
    if (this.destroyed) return;
    if (this.projectileOwner !== projectiles) {
      this.releaseProjectile?.(); this.projectileOwner = projectiles;
      this.releaseProjectile = projectiles?.bindGroundFogSegments((s, size, style, id) => this.fog.addProjectile(s, size, style, id)) ?? null;
    }
    for (const event of this.pending.values()) {
      if (event.source === 'static_rock') this.fog.terrain.removeObstacle(`rock:${event.obstacleId}`);
      else if (event.reason === 'placeable_added' && event.collisionMode !== 'none'
        && event.gridX !== undefined && event.gridY !== undefined) {
        this.fog.terrain.setObstacle(`construction:${event.obstacleId}`, [{ gridX: event.gridX, gridY: event.gridY }]);
        this.placeableIds.add(event.obstacleId!);
      } else { this.fog.terrain.removeObstacle(`construction:${event.obstacleId}`); this.placeableIds.delete(event.obstacleId!); }
    }
    this.pending.clear();
    if (this.resyncPlaceables) {
      // Batch fallbacks diff only constructed objects, never the static world grid.
      const next = new Set<number>();
      for (const rock of placement?.getAllRuntimeRocks() ?? []) if (rock.kind !== 'pedestal' && rock.collisionMode !== 'none') {
        next.add(rock.id); this.fog.terrain.setObstacle(`construction:${rock.id}`, [rock]);
      }
      for (const id of this.placeableIds) if (!next.has(id)) this.fog.terrain.removeObstacle(`construction:${id}`);
      this.placeableIds.clear(); for (const id of next) this.placeableIds.add(id);
      this.resyncPlaceables = false;
    }
    if (bases && this.generation !== bases.getObstacleGeneration()) {
      const baseline = this.generation < 0; this.generation = bases.getObstacleGeneration();
      for (const base of bases.getBases()) {
        this.fog.terrain.setObstacle(`base:${base.id}`, base.isInert() ? [] : base.spec.cells, baseline);
        if (baseline && base.isInert()) this.fog.terrain.markOpened(base.spec.cells);
      }
    }
  }
  destroy(): void {
    if (this.destroyed) return; this.destroyed = true;
    this.scene.game.events.off(ARENA_MAP_GRID_CHANGED_EVENT, this.listener);
    this.releaseExplosion(); this.releaseCombat(); this.releaseProjectile?.(); this.projectileOwner = null;
    this.pending.clear(); this.placeableIds.clear(); this.fog.freeze();
  }
}
