import { ArenaBuilder, type ArenaBuilderResult } from '../arena/ArenaBuilder';
import type { RockHpRegistry } from '../arena/RockHpRegistry';
import type { ArenaLayout } from '../types';
import type { WorldIntegrityMutationResult, WorldRemovalCause } from './WorldIntegrityMutation';
import { worldCellCenter, type WorldMetrics } from './WorldMetrics';

export interface WorldRockRuntimeOptions {
  readonly registry: RockHpRegistry;
  readonly arena: ArenaBuilderResult;
  readonly layout: ArenaLayout;
  readonly metrics: WorldMetrics;
  readonly onIntegrityChanged?: (id: number, integrity: number) => void;
  readonly onBeforeDestroyedPresentation?: (id: number) => void;
  readonly onDestroyed?: (event: {
    readonly id: number;
    readonly cause: WorldRemovalCause;
    readonly attackerId?: string;
    readonly position: { readonly x: number; readonly y: number };
  }) => void;
}

/** Canonical writer for authored rock integrity and physical/grid removal. */
export class WorldRockRuntime {
  constructor(private readonly options: WorldRockRuntimeOptions) {}

  getPosition(id: number): { x: number; y: number } | null {
    const cell = this.options.layout.rocks[id];
    return cell ? worldCellCenter(this.options.metrics, cell.gridX, cell.gridY) : null;
  }

  commitDamage(id: number, damage: number, attackerId?: string): WorldIntegrityMutationResult {
    const result = this.options.registry.commitDamage(id, damage);
    if (result.kind !== 'applied') return result;
    try { this.options.onIntegrityChanged?.(id, result.state.integrity); }
    catch (error) { console.error('[WorldRockRuntime] Integrity presentation failed', error); }
    if (result.transition === 'destroyed') this.finalizeDestroyed(id, 'damage', attackerId);
    return result;
  }

  commitRepair(id: number, amount: number): WorldIntegrityMutationResult {
    const result = this.options.registry.commitRepair(id, amount);
    if (result.kind === 'applied' && result.actualAmount > 0) {
      try { this.options.onIntegrityChanged?.(id, result.state.integrity); }
      catch (error) { console.error('[WorldRockRuntime] Integrity presentation failed', error); }
    }
    return result;
  }

  remove(id: number, cause: Exclude<WorldRemovalCause, 'damage'> = 'removal'): boolean {
    const state = this.options.registry.readIntegrity(id);
    if (!state || state.destroyed) return false;
    this.options.registry.remove(id);
    this.finalizeDestroyed(id, cause);
    return true;
  }

  private finalizeDestroyed(id: number, cause: WorldRemovalCause, attackerId?: string): void {
    const cell = this.options.layout.rocks[id];
    if (!cell) return;
    // Presentation may observe the still-materialized rock, but cannot authorize cleanup.
    try { this.options.onBeforeDestroyedPresentation?.(id); }
    catch (error) { console.error('[WorldRockRuntime] Rock destruction presentation failed', error); }
    ArenaBuilder.destroyRockAndRetile(this.options.arena, this.options.layout.rocks, id);
    // RockRegistry uses remove as its removal-delta marker; the HP tombstone remains canonical.
    this.options.registry.remove(id);
    this.options.onDestroyed?.({
      id,
      cause,
      attackerId,
      position: worldCellCenter(this.options.metrics, cell.gridX, cell.gridY),
    });
  }
}

export function shouldDropRockArmor(
  coopDefense: boolean,
  cause: WorldRemovalCause,
  attackerClassId: string | null | undefined,
): boolean {
  return !coopDefense || (cause === 'damage' && attackerClassId === 'dachs_of_steel');
}
