import { resolvePersistentRewardWorldCell } from '../persistentBase/PersistentBasePlacementRules';
import type { BaseManager } from '../entities/BaseManager';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { PowerUpSystem } from '../powerups/PowerUpSystem';
import type { ConstructionOwnership, SyncedPlaceableRock } from '../types';
import { COOP_DEFENSE_BASE_TURRET_OWNER_ID, TEAM_BLUE_COLOR } from '../config';
import type { PersistentBaseCellDomain } from '../persistentBase/PersistentBaseCore';
import { toWorldAngle, toWorldFootprint, type PersistentBaseFrame } from '../persistentBase/PersistentBaseFrame';
import { isPersistentBaseRewardCellAllowed, getPersistentBaseRewardFootprint } from '../persistentBase/PersistentBasePlacementRules';
import type { PersistentBaseContributionStore } from '../persistentBase/PersistentBaseContributionStore';
import type { PersistentBaseRewardStore } from '../persistentBase/PersistentBaseRewardStore';
import {
  getPersistentBaseRewardDefinition,
  isKnownPersistentBaseRewardId,
  type PersistentBaseRewardDefinition,
} from '../persistentBase/PersistentBaseRewardCatalog';
import type {
  PersistentBaseRewardId,
  PersistentBaseRewardPlacement,
} from '../persistentBase/PersistentBaseRewardTypes';
import {
  mergePersistentBaseComposite,
  type PersistentCompositeConflictReason,
  type PersistentCompositeTool,
} from '../persistentBase/PersistentBaseComposite';
import type { PersistentRestoreCandidate, PersistentRestoreToolDefinition } from '../persistentBase/PersistentBaseTools';
import type { WorldPersistentBaseSite } from './WorldRuntimeContext';
import type { PersistentBaseWorldBinding } from './PersistentBaseWorldBinding';

export interface PersistentBaseWorldMaterializerOptions {
  readonly binding: PersistentBaseWorldBinding;
  readonly contributions: PersistentBaseContributionStore;
  readonly rewards: PersistentBaseRewardStore;
  readonly placementSystem: PlacementSystem;
  readonly powerUpSystem: PowerUpSystem | null;
  readonly baseManager: BaseManager | null;
  readonly getSite: () => WorldPersistentBaseSite | null;
  readonly rockVisualHelper: {
    readonly gridToWorld: (gridX: number, gridY: number) => { x: number; y: number };
    readonly materializePlaceableRock: (runtime: SyncedPlaceableRock, playDust: boolean) => void;
  };
  readonly isHost: () => boolean;
  readonly getMissionRevision?: () => number | null;
  readonly getMapId: () => string | null;
  readonly getLocalOwnerId: () => string;
  readonly resolvePlayerIdForOwner: (ownerId: string) => string | null;
  readonly getPlayerColor: (playerId: string) => number;
  readonly construction: PersistentBaseConstructionPort;
  readonly emitRestoreAdded: (runtime: SyncedPlaceableRock) => void;
  readonly emitGridChanged: (source: 'placeable_rock' | 'placeable_turret') => void;
  readonly onDiagnosticEvent: (type: string, fields: Record<string, unknown>) => void;
}

/** Small bridge from PB materialization to the World-owned Construction runtime. */
export interface PersistentBaseConstructionPort {
  readonly getCapacity: (playerId: string) => number;
  /** Cheap revision marker for the build-dependent restore projection. */
  readonly getBuildRevision: (playerId: string) => string | number;
  readonly getOwnership: (playerId: string) => ConstructionOwnership;
  readonly resolveRestoreTools: (playerId: string) => readonly PersistentRestoreToolDefinition[];
  readonly materializeRestoreCandidate: (
    candidate: PersistentRestoreCandidate,
    playerId: string,
    ownerColor: number,
    ownership: ConstructionOwnership,
  ) => SyncedPlaceableRock | null;
  readonly materializeRewardConstruction: (
    constructionId: 'spore_turret' | 'rocket_turret' | 'watchtower',
    rewardId: PersistentBaseRewardId,
    gridX: number,
    gridY: number,
    angle: number,
    ownerId: string,
    ownerColor: number,
  ) => SyncedPlaceableRock | null;
  readonly releaseRuntime: (runtime: SyncedPlaceableRock, playDust: boolean) => void;
}

/**
 * World-owned reconciliation of persistent-base runtime objects.
 *
 * Room stores and the optional Activity transaction remain the source of desired state. This
 * collaborator only resolves that state into the current World and keeps its bindings there.
 */
export class PersistentBaseWorldMaterializer {
  private destroyed = false;
  private missionRevision: number | null = null;
  private readonly destroyedRewards = new Set<PersistentBaseRewardId>();

  /** Destruction is mission-local; stored placements and their reservations survive. */
  markRewardDestroyed(rewardId: PersistentBaseRewardId): void {
    this.refreshMissionScope();
    this.destroyedRewards.add(rewardId);
    this.options.binding.unbindRewardRuntime(rewardId);
  }

  private refreshMissionScope(): boolean {
    const revision = this.options.getMissionRevision?.() ?? null;
    if (revision !== null && revision !== this.missionRevision) {
      this.missionRevision = revision;
      this.destroyedRewards.clear();
      return true;
    }
    return false;
  }

  constructor(private readonly options: PersistentBaseWorldMaterializerOptions) {}

  reconcile(): void {
    if (this.destroyed || !this.options.isHost()) return;
    const site = this.bindingSite;
    if (!site) return;
    this.refreshMissionScope();
    this.reconcileRewards(site);
    this.reconcileComposite(site);
  }

  refreshForRelevantBuildChanges(): void {
    if (this.destroyed || !this.options.isHost()) return;
    const store = this.options.contributions;
    const signatures = this.options.binding.compositeSignatures;
    const next = new Map<string, string>();
    for (const ownerId of store.ownerIds) {
      const playerId = this.options.resolvePlayerIdForOwner(ownerId);
      if (!playerId) continue;
      // Revisions are player-local; reconnecting an owner through a different player must also refresh.
      next.set(ownerId, `${playerId}:${this.options.construction.getBuildRevision(playerId)}`);
    }
    let changed = this.refreshMissionScope() || next.size !== signatures.size;
    if (!changed) {
      for (const [ownerId, signature] of next) {
        if (signatures.get(ownerId) !== signature) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    signatures.clear();
    for (const [ownerId, signature] of next) signatures.set(ownerId, signature);
    this.reconcile();
  }

  materializeRewardPlacement(
    placement: PersistentBaseRewardPlacement,
    definition: PersistentBaseRewardDefinition = getPersistentBaseRewardDefinition(placement.rewardId),
  ): SyncedPlaceableRock | null {
    const site = this.bindingSite;
    if (this.destroyed || !site || !this.options.isHost()) return null;
    this.refreshMissionScope();
    return this.materializeReward(site, definition, placement);
  }

  releaseRewardRuntime(rewardId: PersistentBaseRewardId): void {
    const binding = this.options.binding.getRewardRuntime(rewardId);
    if (!binding) return;
    this.options.binding.unbindRewardRuntime(rewardId);
    this.options.powerUpSystem?.unregisterPersistentBaseRewardPedestal(rewardId);
    const runtime = this.options.placementSystem.removePersistentBaseReward(rewardId)
      ?? this.options.placementSystem.removeRock(binding.runtimeId);
    if (runtime) this.options.construction.releaseRuntime(runtime, false);
  }

  releasePersonalRuntimeForRewardConflict(runtimeId: number): void {
    if (this.destroyed) return;
    const binding = this.options.contributions.getRuntimeBindings()
      .find((candidate) => candidate.runtimeId === runtimeId);
    if (binding) this.options.contributions.releaseRuntimeBinding(runtimeId);
    const removed = this.options.placementSystem.removeRock(runtimeId);
    if (removed) this.options.construction.releaseRuntime(removed, false);
  }

  relocateRewardRuntime(rewardId: PersistentBaseRewardId, runtime: SyncedPlaceableRock): void {
    const current = this.options.binding.getRewardRuntime(rewardId);
    if (!current) return;
    this.options.binding.bindRewardRuntime(rewardId, {
      runtimeId: runtime.id,
      gridX: runtime.gridX,
      gridY: runtime.gridY,
    });
    if (runtime.kind === 'pedestal') {
      const world = this.options.rockVisualHelper.gridToWorld(runtime.gridX, runtime.gridY);
      this.options.powerUpSystem?.repositionPersistentBaseRewardPedestal(rewardId, world.x, world.y);
    }
  }

  onRewardRemoved(rewardId: PersistentBaseRewardId): void {
    this.releaseRewardRuntime(rewardId);
  }

  finalizeWorldRuntimeObjects(): void {
    if (this.destroyed) return;
    this.options.contributions.finalizeWorldRuntimeObjects(
      (runtimeId) => this.options.placementSystem.hasRuntimeRock(runtimeId),
    );
  }

  destroy(): void {
    this.destroyed = true;
  }

  private get bindingSite(): WorldPersistentBaseSite | null {
    return this.options.getSite();
  }

  private reconcileRewards(site: WorldPersistentBaseSite): void {
    const persistentBaseActive = this.isPersistentBaseRuntimeActive(site);
    if (!persistentBaseActive) this.removeRewardTurretsForBase(site.baseId);
    const desired = new Map(
      this.options.rewards.getState().placements.map((placement) => [placement.rewardId, placement]),
    );

    for (const [rewardId, binding] of [...this.options.binding.rewardRuntimes]) {
      const placement = desired.get(rewardId);
      const runtime = this.options.placementSystem.getRuntimeRock(binding.runtimeId);
      const cell = placement && isKnownPersistentBaseRewardId(placement.rewardId)
        ? this.resolveRewardCell(site, placement)
        : null;
      if (!placement || !runtime
        || (!persistentBaseActive && runtime.kind === 'turret')
        || binding.gridX !== cell?.gridX
        || binding.gridY !== cell?.gridY) {
        this.releaseRewardRuntime(rewardId);
      }
    }

    const occupiedRewardCells = new Set<string>();
    for (const placement of desired.values()) {
      if (!isKnownPersistentBaseRewardId(placement.rewardId)) continue;
      const definition = getPersistentBaseRewardDefinition(placement.rewardId);
      if (!persistentBaseActive && definition.category === 'baseTurret') continue;
      const cell = this.resolveRewardCell(site, placement);
      if (!cell || !this.isRewardPlacementInDomain(definition, site, placement)) continue;
      const cells = getPersistentBaseRewardFootprint(placement.rewardId).map(({ dx, dy }) => ({ gridX: cell.gridX + dx, gridY: cell.gridY + dy }));
      if (cells.some(c => occupiedRewardCells.has(cellKey(c.gridX, c.gridY)))) continue;
      for (const c of cells) occupiedRewardCells.add(cellKey(c.gridX, c.gridY));
      if (this.destroyedRewards.has(placement.rewardId)) continue;
      const binding = this.options.binding.getRewardRuntime(placement.rewardId);
      if (binding && this.options.placementSystem.hasRuntimeRock(binding.runtimeId)) continue;
      const occupants = new Map(cells.flatMap(c => {
        const rock = this.options.placementSystem.getRuntimeRockAt(c.gridX, c.gridY);
        return rock ? [[rock.id, rock] as const] : [];
      }));
      const contributions = this.options.contributions.getRuntimeBindings();
      if ([...occupants.values()].some(rock => rock.ownership === 'base-owned'
        || !contributions.some(entry => entry.runtimeId === rock.id))) continue;
      if (!this.options.placementSystem.canMaterializePersistentBaseRewardCell(cell.gridX, cell.gridY, true, undefined, placement.rewardId)) continue;
      for (const id of occupants.keys()) this.releasePersonalRuntimeForRewardConflict(id);
      this.materializeReward(site, definition, placement);
    }
  }

  /** Anker der World-Site, Ausrichtung aus dem Basisdokument des Hosts. */
  private frameFor(site: WorldPersistentBaseSite): PersistentBaseFrame {
    return { anchor: site.anchor, quarterTurns: this.options.rewards.getState().quarterTurns };
  }

  private reconcileComposite(site: WorldPersistentBaseSite): void {
    const store = this.options.contributions;
    const frame = this.frameFor(site);
    const reservedRewardCells = this.getRewardReservedCells(site);
    const toolCache = new Map<string, ReadonlyMap<string, PersistentRestoreToolDefinition>>();
    const resolveOwnerTools = (ownerId: string): ReadonlyMap<string, PersistentRestoreToolDefinition> => {
      const cached = toolCache.get(ownerId);
      if (cached) return cached;
      const playerId = this.options.resolvePlayerIdForOwner(ownerId);
      const tools = new Map<string, PersistentRestoreToolDefinition>();
      if (playerId) {
        for (const tool of this.options.construction.resolveRestoreTools(playerId)) tools.set(tool.id, tool);
      }
      toolCache.set(ownerId, tools);
      return tools;
    };
    const materializedCells = new Set<string>();
    for (const binding of store.getRuntimeBindings()) {
      const tool = resolveOwnerTools(binding.ownerId).get(binding.blueprint.tool.id);
      const placed = toWorldFootprint(frame, binding.blueprint.relativeGridX, binding.blueprint.relativeGridY,
        tool?.footprint ?? []);
      for (const offset of placed.footprint) materializedCells.add(cellKey(placed.gridX + offset.dx, placed.gridY + offset.dy));
    }
    const capacityMaxByOwner = new Map<string, number>();
    for (const ownerId of store.ownerIds) {
      const playerId = this.options.resolvePlayerIdForOwner(ownerId);
      if (playerId) capacityMaxByOwner.set(ownerId, this.resolveCapacity(playerId));
    }
    const hostOwnerId = this.options.getLocalOwnerId();
    const result = mergePersistentBaseComposite({
      frame,
      buildArea: site.buildArea,
      hostContribution: store.getContribution(hostOwnerId),
      guestContributions: store.getContributions().filter((entry) => entry.ownerId !== hostOwnerId),
      resolveTool: (ownerId, toolId): PersistentCompositeTool | null => {
        const tool = resolveOwnerTools(ownerId).get(toolId);
        if (!tool) return null;
        return {
          footprint: tool.footprint,
          capacityCost: tool.capacityCost,
          unavailableReason: resolveCompositeToolUnavailability(tool),
        };
      },
      capacityMaxByOwner,
      reservedCells: reservedRewardCells,
      isCellBlocked: (gridX, gridY) => !materializedCells.has(cellKey(gridX, gridY))
        && !this.options.placementSystem.canMaterializeCells([{ dx: 0, dy: 0 }], gridX, gridY),
    });

    // A bound runtime stays only on the cell its frame wants. After the host turned the base in the
    // lobby it is released here and materializes again on its turned cell below.
    const activeCells = new Map(result.active.map((entry) => [
      `${entry.ownerId}\u0000${entry.blueprint.persistentId}`,
      cellKey(entry.gridX, entry.gridY),
    ]));
    let dematerializedCount = 0;
    for (const binding of store.getRuntimeBindings()) {
      const desiredCell = activeCells.get(`${binding.ownerId}\u0000${binding.blueprint.persistentId}`);
      const runtime = this.options.placementSystem.getRuntimeRock(binding.runtimeId);
      if (desiredCell !== undefined && (!runtime || cellKey(runtime.gridX, runtime.gridY) === desiredCell)) continue;
      store.releaseRuntimeBinding(binding.runtimeId);
      const removed = this.options.placementSystem.removeRock(binding.runtimeId);
      if (!removed) continue;
      this.options.construction.releaseRuntime(removed, false);
      dematerializedCount += 1;
    }
    if (dematerializedCount > 0) this.options.emitGridChanged('placeable_rock');

    for (const entry of result.active) {
      if (store.isMaterialized(entry.ownerId, entry.blueprint.persistentId)) continue;
      const playerId = this.options.resolvePlayerIdForOwner(entry.ownerId);
      const tool = resolveOwnerTools(entry.ownerId).get(entry.blueprint.tool.id);
      if (!playerId || !tool) continue;
      const runtime = this.options.construction.materializeRestoreCandidate(
        { blueprint: entry.blueprint, tool, gridX: entry.gridX, gridY: entry.gridY, angle: entry.angle },
        playerId,
        this.options.getPlayerColor(playerId),
        this.options.construction.getOwnership(playerId),
      );
      if (!runtime) continue;
      store.registerRestored(entry.ownerId, entry.blueprint, runtime.id);
      this.options.emitRestoreAdded(runtime);
    }
    if (result.conflicts.length > 0) {
      this.options.onDiagnosticEvent('persistent-base:composite-conflicts', {
        mapId: this.options.getMapId(),
        count: result.conflicts.length,
      });
    }
  }

  private getRewardReservedCells(site: WorldPersistentBaseSite): Set<string> {
    const reserved = new Set<string>();
    for (const placement of this.options.rewards.getState().placements) {
      const definition = isKnownPersistentBaseRewardId(placement.rewardId)
        ? getPersistentBaseRewardDefinition(placement.rewardId)
        : null;
      const cell = definition && this.isRewardPlacementInDomain(definition, site, placement)
        ? this.resolveRewardCell(site, placement)
        : null;
      if (cell) for (const { dx, dy } of getPersistentBaseRewardFootprint(placement.rewardId)) reserved.add(cellKey(cell.gridX + dx, cell.gridY + dy));
    }
    return reserved;
  }

  private materializeReward(
    site: WorldPersistentBaseSite,
    definition: PersistentBaseRewardDefinition,
    placement: PersistentBaseRewardPlacement,
  ): SyncedPlaceableRock | null {
    if (this.destroyedRewards.has(placement.rewardId) || !this.isRewardPlacementInDomain(definition, site, placement)) return null;
    if (definition.category === 'baseTurret' && !this.isPersistentBaseRuntimeActive(site)) return null;
    const cell = this.resolveRewardCell(site, placement);
    if (!cell) return null;
    const angle = toWorldAngle(this.frameFor(site), placement.angle);
    const ownerId = COOP_DEFENSE_BASE_TURRET_OWNER_ID;
    const ownerColor = TEAM_BLUE_COLOR;
    let runtime: SyncedPlaceableRock | null = null;
    try {
      runtime = (definition.category === 'baseTurret' || definition.category === 'baseStructure')
        && definition.gameplaySource.kind === 'construction-definition'
        && definition.gameplaySource.constructionId
        ? this.options.construction.materializeRewardConstruction(
          definition.gameplaySource.constructionId,
          placement.rewardId,
          cell.gridX,
          cell.gridY,
          angle,
          ownerId,
          ownerColor,
        )
        : definition.category === 'basePedestal'
          ? this.options.placementSystem.materializePersistentBaseRewardPedestal(
            placement.rewardId,
            cell.gridX,
            cell.gridY,
            angle,
            ownerId,
            ownerColor,
          )
          : null;
    } catch {
      // A provider failure must not turn a committed reward into a partial world binding.
      return null;
    }
    if (!runtime) return null;

    const cleanup = (): void => {
      this.options.binding.unbindRewardRuntime(placement.rewardId);
      this.options.powerUpSystem?.unregisterPersistentBaseRewardPedestal(placement.rewardId);
      const removed = this.options.placementSystem.removeRock(runtime.id);
      if (removed) this.options.construction.releaseRuntime(removed, false);
    };
    try {
      if (definition.category === 'baseTurret') this.options.placementSystem.bindCarrierBase(runtime.id, site.baseId);
      if (definition.category === 'basePedestal') {
        if (definition.gameplaySource.kind !== 'power-up-definition') {
          cleanup();
          return null;
        }
        const world = this.options.rockVisualHelper.gridToWorld(cell.gridX, cell.gridY);
        const registered = this.options.powerUpSystem?.registerPersistentBaseRewardPedestal(
          placement.rewardId,
          definition.gameplaySource.powerUpDefId,
          world.x,
          world.y,
          definition.initialState.respawnMs,
          definition.initialState.spawnOnArenaStart,
          ownerColor,
        ) ?? false;
        if (!registered) {
          cleanup();
          return null;
        }
      }
      this.options.binding.bindRewardRuntime(placement.rewardId, {
        runtimeId: runtime.id,
        gridX: cell.gridX,
        gridY: cell.gridY,
      });
      // The visual helper is intentionally a construction port; the reward binding still owns
      // the decision and only presents a successfully bound runtime.
      this.options.rockVisualHelper.materializePlaceableRock(runtime, false);
      this.options.emitRestoreAdded(runtime);
      return runtime;
    } catch {
      cleanup();
      return null;
    }
  }

  private removeRewardTurretsForBase(baseId: string): void {
    const site = this.bindingSite;
    if (!site || site.baseId !== baseId) return;
    let removedCount = 0;
    for (const rock of this.options.placementSystem.getAllRuntimeRocks()) {
      if (rock.kind !== 'turret' || rock.ownership !== 'base-owned' || rock.persistentRewardId === undefined) continue;
      const binding = this.options.binding.getRewardRuntime(rock.persistentRewardId);
      if (binding?.runtimeId !== rock.id) continue;
      this.options.binding.unbindRewardRuntime(rock.persistentRewardId);
      const removed = this.options.placementSystem.removeRock(rock.id);
      if (!removed) continue;
      this.options.construction.releaseRuntime(removed, false);
      removedCount += 1;
    }
    for (const [rewardId, binding] of [...this.options.binding.rewardRuntimes]) {
      const runtime = this.options.placementSystem.getRuntimeRock(binding.runtimeId);
      if (!runtime || runtime.kind === 'turret') this.options.binding.unbindRewardRuntime(rewardId);
    }
    if (removedCount > 0) this.options.emitGridChanged('placeable_turret');
  }

  private isPersistentBaseRuntimeActive(site: WorldPersistentBaseSite): boolean {
    if (!this.options.baseManager) return true;
    const base = this.options.baseManager.getBase(site.baseId);
    return base !== undefined && !base.isInert();
  }

  private resolveRewardCell(
    site: WorldPersistentBaseSite,
    placement: Pick<PersistentBaseRewardPlacement, 'relativeGridX' | 'relativeGridY'> & { rewardId?: PersistentBaseRewardId },
  ): { gridX: number; gridY: number; domain: PersistentBaseCellDomain } | null {
    return resolvePersistentRewardWorldCell(this.frameFor(site), site.buildArea, placement);
  }

  private isRewardPlacementInDomain(
    definition: PersistentBaseRewardDefinition,
    site: WorldPersistentBaseSite,
    placement: PersistentBaseRewardPlacement,
  ): boolean {
    return isPersistentBaseRewardCellAllowed(
      definition.id,
      placement.relativeGridX,
      placement.relativeGridY,
      site.buildArea,
    );
  }

  private resolveCapacity(playerId: string): number {
    return this.options.construction.getCapacity(playerId);
  }
}

function cellKey(gridX: number, gridY: number): string {
  return `${gridX}:${gridY}`;
}

function resolveCompositeToolUnavailability(
  tool: PersistentRestoreToolDefinition,
): PersistentCompositeConflictReason | undefined {
  if (tool.unavailableReason === 'class-not-allowed') return 'class-not-allowed';
  if (tool.unavailableReason === 'mode-not-allowed') return 'mode-not-allowed';
  if (!tool.unlocked) return 'locked';
  if (tool.active === false) return 'not-in-loadout';
  return undefined;
}
