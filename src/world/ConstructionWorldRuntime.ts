import * as Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem } from '../systems/CombatSystem';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { TargetStatusSystem } from '../systems/TargetStatusSystem';
import type { EnergyInjectorSystem } from '../systems/EnergyInjectorSystem';
import type { LoadoutUseParams, LoadoutUseResult, LoadoutToolRef, SyncedPlaceableRock, UtilityPlacementPreviewState, ConstructionId, ConstructionOwnership } from '../types';
import type { PlaceableUtilityConfig, TunnelUltimateConfig, UtilityConfig } from '../loadout/LoadoutConfig';
import { getUtilityConfigForMode } from '../loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../loadout/CoopDefenseLoadoutModifiers';
import type {
  CoopDefensePlayerModifierReadPort,
} from '../systems/CoopDefensePlayerModifierSystem';
import type { PlayerGameplayTunnelPlacementPort } from './WorldPlayerGameplayRuntime';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { PlayerCapabilities } from './PlayerCapabilities';
import type { PlayerGameplayActionPort } from './WorldPlayerGameplayRuntime';
import type { WorldScopedBinding } from './WorldRuntime';
import type { PersistentBaseWorldBinding } from './PersistentBaseWorldBinding';
import type { PersistentBaseAnchor, PersistentToolRef } from '../persistentBase/PersistentBaseTypes';
import type { PersistentBaseContributionStore } from '../persistentBase/PersistentBaseContributionStore';
import type { PersistentBaseRewardStore } from '../persistentBase/PersistentBaseRewardStore';
import type { PersistentBaseRewardId } from '../persistentBase/PersistentBaseRewardTypes';
import type { PersistentBaseBuildArea } from '../persistentBase/PersistentBaseCore';
import type { PersistentRestoreCandidate, PersistentRestoreToolDefinition } from '../persistentBase/PersistentBaseTools';
import {
  ConstructionReadinessRuntime,
  type ConstructionManagementAction,
  type ConstructionReadinessPort,
} from './ConstructionReadinessRuntime';
import {
  COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT,
  COOP_DEFENSE_DISMANTLE_RANGE,
  COOP_DEFENSE_CONSTRUCTION_IDS,
  getCoopDefenseConstructionDefinition,
  getConstructionIdForUtility,
  getUtilityIdForConstruction,
  getToolCapacityCost,
  normalizeConstructionId,
  resolveConstructionCapacity,
  type CoopDefenseConstructionDefinition,
} from '../config/coopDefenseConstructions';
import { getConstructionAccessContext, getActiveConstructionToolRefs, resolveConstructionAccess } from '../systems/ConstructionAccessResolver';

export interface ConstructionRewardPlacementRuntime {
  readonly canPlace: (objectiveId: string, playerId: string) => boolean;
  readonly consume: (objectiveId: string, playerId: string) => boolean;
}

export interface ConstructionPersistentBaseContext {
  readonly anchor: PersistentBaseAnchor;
  readonly buildArea: PersistentBaseBuildArea;
  readonly contributions: PersistentBaseContributionStore;
  readonly rewards: PersistentBaseRewardStore;
}

export interface ConstructionWorldRuntimeOptions {
  readonly scene: Phaser.Scene;
  readonly playerManager: PlayerManager;
  readonly combatSystem: CombatSystem;
  readonly placementSystem: PlacementSystem;
  readonly utilityAction: Pick<PlayerGameplayActionPort, 'useInspectorUtility' | 'setUtilityPlacementCapability'>;
  readonly targetStatusSystem: TargetStatusSystem | null;
  readonly energyInjectorSystem: EnergyInjectorSystem | null;
  readonly powerUpSystem: import('../powerups/PowerUpSystem').PowerUpSystem | null;
  readonly modifierReadPort: CoopDefensePlayerModifierReadPort | null;
  readonly tunnelPlacementPort: PlayerGameplayTunnelPlacementPort | null;
  readonly gameAudioSystem: GameAudioSystem;
  readonly getGameMode: () => import('../types').GameMode;
  readonly getPlayerCapabilities: (playerId: string) => PlayerCapabilities;
  readonly getCurrentLoadout: (playerId: string) => import('../types').LoadoutCommitSnapshot | null | undefined;
  readonly getPersistentBaseContext: () => ConstructionPersistentBaseContext | null;
  readonly persistentBaseBinding: PersistentBaseWorldBinding | null;
  readonly resolveOwnerId: (playerId: string) => string | null;
  readonly getLocalPlayerId: () => string;
  readonly isHost: () => boolean;
  readonly acceptsPersistentBaseMutation: (activityRevision?: number) => boolean;
  readonly mayManagePersistentBase: (playerId: string) => boolean;
  readonly getRewardPlacementRuntime: () => ConstructionRewardPlacementRuntime | null;
  readonly emitGridChanged: (event: {
    readonly reason: 'placeable_added' | 'placeable_removed' | 'placeables_batch_removed';
    readonly source: 'placeable_rock' | 'placeable_turret' | 'placeable_pedestal';
    readonly runtime?: SyncedPlaceableRock;
  }) => void;
  readonly relocatePresentation: (previous: SyncedPlaceableRock, next: SyncedPlaceableRock) => void;
  readonly reconcilePersistentBaseWorld: () => void;
  readonly publishImmediateContribution: (ownerId: string) => void;
  readonly persistRewards: () => void;
  readonly publishRewardSessionState: () => void;
  readonly publishUtilityCooldown: (playerId: string, until: number, key: string) => void;
  readonly recordConstructionBuilt: (playerId: string) => void;
  readonly onDestroy?: (runtime: ConstructionWorldRuntime) => void;
  readonly rockVisualHelper: {
    readonly gridToWorld: (gridX: number, gridY: number) => { x: number; y: number };
    readonly materializePlaceableRock: (runtime: SyncedPlaceableRock, playDust: boolean) => void;
    readonly removePlaceableRockVisual: (runtime: SyncedPlaceableRock, playDust: boolean) => void;
  };
}

/** World-scoped construction rules, persistent restore port and placement handlers. */
export class ConstructionWorldRuntime implements WorldScopedBinding, ConstructionReadinessPort {
  private destroyed = false;
  private readonly readiness = new ConstructionReadinessRuntime();

  constructor(private readonly options: ConstructionWorldRuntimeOptions) {}

  getActiveTools(playerId: string): readonly LoadoutToolRef[] {
    return getActiveConstructionToolRefs(getConstructionAccessContext(this.options.getGameMode(), this.options.getCurrentLoadout(playerId)));
  }

  getCapacity(playerId: string): number {
    return resolveConstructionCapacity({
      gameMode: this.options.getGameMode(),
      classId: this.options.getCurrentLoadout(playerId)?.coopDefenseClassId,
      modifiers: this.options.modifierReadPort?.getNumericStat(playerId, COOP_DEFENSE_CONSTRUCTION_CAPACITY_STAT) ?? 0,
    });
  }

  getOwnership(playerId: string): ConstructionOwnership {
    return playerId === this.options.getLocalPlayerId() ? 'host-persistent' : 'guest-session';
  }

  /** Player-in-World-Lifetime der world-owned Construction-Readiness. */
  attachPlayerReadiness(playerId: string): void {
    this.readiness.attachPlayer(playerId);
  }

  detachPlayerReadiness(playerId: string): void {
    this.readiness.detachPlayer(playerId);
  }

  resetPlayerReadiness(playerId: string): void {
    this.readiness.resetPlayer(playerId);
  }

  isConstructionOnCooldown(playerId: string, constructionId: ConstructionId, nowMs: number): boolean {
    return this.readiness.isConstructionOnCooldown(playerId, constructionId, nowMs);
  }

  markConstructionUsed(playerId: string, constructionId: ConstructionId, nowMs: number): number {
    return this.readiness.markConstructionUsed(playerId, constructionId, nowMs);
  }

  getManagementActionCooldownUntil(playerId: string, action: ConstructionManagementAction): number {
    return this.readiness.getManagementActionCooldownUntil(playerId, action);
  }

  isManagementActionOnCooldown(
    playerId: string,
    action: ConstructionManagementAction,
    nowMs: number,
  ): boolean {
    return this.readiness.isManagementActionOnCooldown(playerId, action, nowMs);
  }

  markManagementActionUsed(
    playerId: string,
    action: ConstructionManagementAction,
    nowMs: number,
  ): number {
    return this.readiness.markManagementActionUsed(playerId, action, nowMs);
  }

  resolveConstructionId(value: string | number | undefined): ConstructionId | null {
    return normalizeConstructionId(value);
  }

  getDefinition(value: string | number | undefined): CoopDefenseConstructionDefinition | null {
    const id = normalizeConstructionId(value);
    return id ? getCoopDefenseConstructionDefinition(id) : null;
  }

  getMuzzleOffset(value: string | number | undefined): number | undefined {
    const definition = this.getDefinition(value);
    return definition?.kind === 'turret' ? definition.muzzleOffset : undefined;
  }

  isMovableConstructionSource(playerId: string, source: SyncedPlaceableRock | undefined): boolean {
    return source !== undefined
      && source.ownership !== 'base-owned'
      && source.ownerId === playerId
      && normalizeConstructionId(source.constructionId) !== null
      && source.expiresAt <= 0;
  }

  placePlaceableRock(
    cfg: PlaceableUtilityConfig,
    playerId: string,
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    now: number,
    playerColor: number,
    params?: LoadoutUseParams,
  ): boolean {
    if (cfg.type === 'placeable_pedestal') {
      const rewardRuntime = this.options.getRewardPlacementRuntime();
      if (!rewardRuntime?.canPlace(cfg.rewardObjectiveId, playerId)) return false;
      const pedestal = this.options.placementSystem.tryPlaceRock(cfg, playerId, playerColor, originX, originY, targetX, targetY, now);
      if (!pedestal) return false;
      const world = this.options.rockVisualHelper.gridToWorld(pedestal.gridX, pedestal.gridY);
      const registered = this.options.powerUpSystem?.registerConstructionPedestal(
        pedestal.id, cfg.powerUpDefId, world.x, world.y, playerColor,
      ) ?? false;
      if (!registered || !rewardRuntime.consume(cfg.rewardObjectiveId, playerId)) {
        if (registered) this.options.powerUpSystem?.unregisterConstructionPedestal(pedestal.id);
        this.options.placementSystem.removeRock(pedestal.id);
        return false;
      }
      this.options.rockVisualHelper.materializePlaceableRock(pedestal, true);
      this.options.emitGridChanged({ reason: 'placeable_added', source: 'placeable_pedestal', runtime: pedestal });
      return true;
    }

    const constructionId = getConstructionIdForUtility(cfg.id);
    if (constructionId) {
      if (this.options.getPersistentBaseContext() && !this.options.acceptsPersistentBaseMutation(params?.activityRevision)) return false;
      const access = resolveConstructionAccess(
        constructionId,
        getConstructionAccessContext(this.options.getGameMode(), this.options.getCurrentLoadout(playerId)),
      );
      if (!access.allowed || !this.hasFreeCapacity(playerId, access.definition?.capacityCost ?? 0)) return false;
    }
    const rock = this.options.placementSystem.tryPlaceRock(
      cfg,
      playerId,
      playerColor,
      originX,
      originY,
      targetX,
      targetY,
      now,
      constructionId ? this.getOwnership(playerId) : undefined,
    );
    if (!rock) return false;
    this.options.rockVisualHelper.materializePlaceableRock(rock, true);
    this.registerNewPersistentPlaceable(
      rock,
      constructionId ? { kind: 'construction', id: constructionId } : { kind: 'utility', id: cfg.id },
      cfg.placeable.footprint,
    );
    this.options.emitGridChanged({
      reason: 'placeable_added',
      source: rock.kind === 'turret' ? 'placeable_turret' : 'placeable_rock',
      runtime: rock,
    });
    return true;
  }

  placeInspectorConstruction(
    playerId: string,
    constructionId: ConstructionId,
    targetX: number,
    targetY: number,
    hostNowMs: number,
    activityRevision?: number,
  ): LoadoutUseResult {
    const canonical = normalizeConstructionId(constructionId);
    if (!this.options.isHost() || !canonical) return { ok: false, reason: 'invalid' };
    if (this.options.getPersistentBaseContext() && !this.options.acceptsPersistentBaseMutation(activityRevision)) return { ok: false, reason: 'blocked' };
    if (!this.options.getPlayerCapabilities(playerId).canPlace) return { ok: false, reason: 'blocked' };
    const access = resolveConstructionAccess(canonical, getConstructionAccessContext(this.options.getGameMode(), this.options.getCurrentLoadout(playerId)));
    if (!access.allowed) return { ok: false, reason: access.reason === 'locked' ? 'invalid' : 'blocked' };
    const player = this.options.playerManager.getPlayer(playerId);
    if (!player || !player.active || !this.options.combatSystem.isAlive(playerId) || this.options.combatSystem.isBurrowed(playerId)) return { ok: false, reason: 'blocked' };
    const definition = getCoopDefenseConstructionDefinition(canonical);
    if (this.isConstructionOnCooldown(playerId, canonical, hostNowMs)) return { ok: false, reason: 'cooldown' };
    if (!this.hasFreeCapacity(playerId, definition.capacityCost)) return { ok: false, reason: 'capacity' };
    const hpMultiplier = definition.indestructible ? 1 : 1 + (this.options.modifierReadPort?.getPercentageStat(playerId, 'construction.maxHp') ?? 0);
    const utilityId = getUtilityIdForConstruction(canonical);
    const utilityConfig = utilityId ? this.getEffectiveUtilityConfig(playerId, canonical) : null;
    const construction = utilityConfig
      ? this.options.placementSystem.tryPlaceRock(utilityConfig, playerId, player.color, player.x, player.y, targetX, targetY, hostNowMs, this.getOwnership(playerId))
      : this.options.placementSystem.tryPlaceConstruction(definition, definition.maxHp * hpMultiplier, playerId, player.color, player.x, player.y, targetX, targetY, this.getOwnership(playerId));
    if (!construction) return { ok: false, reason: 'placement' };
    if (definition.kind === 'pedestal') {
      const world = this.options.rockVisualHelper.gridToWorld(construction.gridX, construction.gridY);
      const registered = this.options.powerUpSystem?.registerConstructionPedestal(construction.id, definition.powerUpDefId, world.x, world.y, player.color) ?? false;
      if (!registered) {
        this.options.placementSystem.removeRock(construction.id);
        return { ok: false, reason: 'placement' };
      }
    }
    const cooldownUntil = this.markConstructionUsed(playerId, canonical, hostNowMs);
    this.options.publishUtilityCooldown(playerId, cooldownUntil, canonical);
    this.options.rockVisualHelper.materializePlaceableRock(construction, true);
    this.registerNewPersistentPlaceable(construction, { kind: 'construction', id: canonical }, definition.footprint);
    this.options.emitGridChanged({
      reason: 'placeable_added',
      source: this.sourceFor(construction),
      runtime: construction,
    });
    this.options.recordConstructionBuilt(playerId);
    return { ok: true };
  }

  useInspectorUtility(
    playerId: string,
    tool: LoadoutToolRef,
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    params?: LoadoutUseParams,
  ): LoadoutUseResult {
    if (!this.options.isHost() || tool.kind !== 'utility') return { ok: false, reason: 'invalid' };
    const loadout = this.options.getCurrentLoadout(playerId);
    if (!loadout || loadout.coopDefenseClassId !== 'inspector_gadachs') return { ok: false, reason: 'blocked' };
    if (!(loadout.tools ?? []).some((entry) => entry.kind === 'utility' && (entry.id === tool.id || normalizeConstructionId(entry.id) === normalizeConstructionId(tool.id)))) return { ok: false, reason: 'blocked' };
    const config = getUtilityConfigForMode(tool.id, this.options.getGameMode()) as UtilityConfig | undefined;
    if (!config) return { ok: false, reason: 'invalid' };
    const constructionId = getConstructionIdForUtility(tool.id);
    if (constructionId && !resolveConstructionAccess(constructionId, getConstructionAccessContext(this.options.getGameMode(), loadout)).allowed) return { ok: false, reason: 'blocked' };
    if (getToolCapacityCost(tool) > 0 && !this.hasFreeCapacity(playerId, getToolCapacityCost(tool))) return { ok: false, reason: 'capacity' };
    return this.options.utilityAction.useInspectorUtility(playerId, tool, config, angle, targetX, targetY, now, params);
  }

  dismantleConstruction(
    playerId: string,
    targetX: number,
    targetY: number,
    hostNowMs: number,
    activityRevision?: number,
  ): LoadoutUseResult {
    if (!this.options.isHost() || !this.options.getPlayerCapabilities(playerId).canDismantle || !this.options.mayManagePersistentBase(playerId)) return { ok: false, reason: this.options.isHost() ? 'blocked' : 'invalid' };
    const player = this.options.playerManager.getPlayer(playerId);
    if (!player || !player.active || !this.options.combatSystem.isAlive(playerId) || this.options.combatSystem.isBurrowed(playerId)) return { ok: false, reason: 'blocked' };
    if (this.isManagementActionOnCooldown(playerId, 'dismantle', hostNowMs)) return { ok: false, reason: 'cooldown' };
    const cell = this.options.placementSystem.getClampedTargetCell(player.x, player.y, targetX, targetY, COOP_DEFENSE_DISMANTLE_RANGE);
    if (!cell) return { ok: false, reason: 'blocked' };
    const target = this.options.placementSystem.getRuntimeRockAt(cell.gridX, cell.gridY);
    const rewardId = target?.ownership === 'base-owned' ? target.persistentRewardId : undefined;
    const persistent = target !== undefined && this.options.getPersistentBaseContext()?.contributions.getRuntimeBindings().some((binding) => binding.runtimeId === target.id) === true;
    if ((rewardId !== undefined || persistent) && !this.options.acceptsPersistentBaseMutation(activityRevision)) return { ok: false, reason: 'blocked' };
    if (rewardId !== undefined && !this.options.getPersistentBaseContext()?.rewards.getState().placements.some((placement) => placement.rewardId === rewardId)) return { ok: false, reason: 'blocked' };
    const removed = this.options.placementSystem.removeRockAt(cell.gridX, cell.gridY, playerId, rewardId !== undefined ? 'base-owned' : this.getOwnership(playerId), rewardId !== undefined);
    if (!removed) return { ok: false, reason: 'blocked' };
    const cooldownUntil = this.markManagementActionUsed(playerId, 'dismantle', hostNowMs);
    this.options.publishUtilityCooldown(playerId, cooldownUntil, 'management:dismantle');
    this.finalizeDismantledConstruction(removed, true);
    this.options.gameAudioSystem.playSound('sfx_place_rock', cell.x, cell.y, playerId);
    this.options.emitGridChanged({ reason: 'placeable_removed', source: this.sourceFor(removed), runtime: removed });
    return { ok: true };
  }

  dismantleAllOwnedConstructions(playerId: string, activityRevision?: number): LoadoutUseResult {
    if (!this.options.isHost()) return { ok: false, reason: 'invalid' };
    if (this.options.getPersistentBaseContext() && !this.options.acceptsPersistentBaseMutation(activityRevision)) return { ok: false, reason: 'blocked' };
    if (!this.options.getPlayerCapabilities(playerId).canDismantle) return { ok: false, reason: 'blocked' };
    const player = this.options.playerManager.getPlayer(playerId);
    if (!this.options.mayManagePersistentBase(playerId) || !player?.active || !this.options.combatSystem.isAlive(playerId) || this.options.combatSystem.isBurrowed(playerId)) return { ok: false, reason: 'blocked' };
    const removed = this.options.placementSystem.removeOwnedConstructions(playerId, this.getOwnership(playerId));
    for (const construction of removed) this.finalizeDismantledConstruction(construction, false);
    if (removed.length > 0) {
      this.options.emitGridChanged({ reason: 'placeables_batch_removed', source: 'placeable_rock' });
      this.options.gameAudioSystem.playSound('sfx_place_rock', player.x, player.y, playerId);
    }
    return { ok: true };
  }

  finalizeDismantledConstruction(removed: SyncedPlaceableRock, playDust: boolean): void {
    const context = this.options.getPersistentBaseContext();
    if (removed.persistentRewardId !== undefined) {
      this.options.persistentBaseBinding?.onRewardRemoved(removed.persistentRewardId);
      if (context?.rewards.dismantleReward(removed.persistentRewardId)) {
        this.options.persistRewards();
        this.options.publishRewardSessionState();
        this.options.reconcilePersistentBaseWorld();
      }
      this.releaseRuntime(removed, playDust);
      return;
    }
    const ownerId = context?.contributions.getRuntimeBindings().find((binding) => binding.runtimeId === removed.id)?.ownerId;
    const removedBlueprint = context?.contributions.removeByRuntimeId(removed.id) === true;
    if (context && ownerId && removedBlueprint && !context.contributions.hasActiveMission) this.options.publishImmediateContribution(ownerId);
    this.releaseRuntime(removed, playDust);
  }

  releaseRuntime(removed: SyncedPlaceableRock, playDust: boolean): void {
    this.options.targetStatusSystem?.removeTarget({ targetType: 'construction', targetId: String(removed.id) });
    this.options.energyInjectorSystem?.removeTarget({ targetType: 'construction', targetId: String(removed.id) });
    if (removed.persistentRewardId !== undefined) this.options.powerUpSystem?.unregisterPersistentBaseRewardPedestal(removed.persistentRewardId);
    else if (removed.kind === 'pedestal') this.options.powerUpSystem?.unregisterConstructionPedestal(removed.id);
    this.options.rockVisualHelper.removePlaceableRockVisual(removed, playDust);
  }

  buildRestoreTools(playerId: string): readonly PersistentRestoreToolDefinition[] {
    const loadout = this.options.getCurrentLoadout(playerId);
    const accessContext = getConstructionAccessContext(this.options.getGameMode(), loadout);
    const modifiers = this.options.modifierReadPort?.getModifiers(playerId);
    const hpMultiplier = 1 + (this.options.modifierReadPort?.getPercentageStat(playerId, 'construction.maxHp') ?? 0);
    return COOP_DEFENSE_CONSTRUCTION_IDS.map((constructionId) => {
      const definition = getCoopDefenseConstructionDefinition(constructionId);
      const access = resolveConstructionAccess(constructionId, accessContext);
      const utilityId = getUtilityIdForConstruction(constructionId);
      let footprint = definition.footprint;
      let maxHp = definition.maxHp;
      if (utilityId) {
        const config = getUtilityConfigForMode(utilityId, this.options.getGameMode());
        if (config && 'placeable' in config) {
          const effective = modifiers ? applyCoopDefenseModifiersToUtilityConfig(config as PlaceableUtilityConfig, { additive: modifiers.additiveStats, percentage: modifiers.percentageStats }) as PlaceableUtilityConfig : config as PlaceableUtilityConfig;
          footprint = effective.placeable.footprint;
          maxHp = effective.placeable.maxHp;
        }
      }
      return {
        kind: 'construction',
        id: constructionId,
        footprint,
        capacityCost: definition.capacityCost,
        maxHp: utilityId ? maxHp : maxHp * (definition.indestructible ? 1 : hpMultiplier),
        unlocked: access.unlocked,
        active: access.active,
        unavailableReason: access.reason === 'class-not-allowed' || access.reason === 'mode-not-allowed' ? access.reason : undefined,
      };
    });
  }

  materializeRestoreCandidate(candidate: PersistentRestoreCandidate, ownerId: string, ownerColor: number, ownership: ConstructionOwnership): SyncedPlaceableRock | null {
    const constructionId = normalizeConstructionId(candidate.tool.id);
    if (!constructionId) return null;
    const utilityId = getUtilityIdForConstruction(constructionId);
    if (utilityId) {
      const config = getUtilityConfigForMode(utilityId, this.options.getGameMode());
      if (!config || !('placeable' in config)) return null;
      const modifiers = this.options.modifierReadPort?.getModifiers(ownerId);
      const modified = modifiers ? applyCoopDefenseModifiersToUtilityConfig(config as PlaceableUtilityConfig, { additive: modifiers.additiveStats, percentage: modifiers.percentageStats }) as PlaceableUtilityConfig : config as PlaceableUtilityConfig;
      const effective = { ...modified, id: utilityId, placeable: { ...modified.placeable, lifetimeMs: 0, maxHp: candidate.tool.maxHp } } as PlaceableUtilityConfig;
      const runtime = this.options.placementSystem.materializePersistentPlaceable(effective, candidate.gridX, candidate.gridY, candidate.blueprint.angle, ownerId, ownerColor, ownership);
      if (!runtime) return null;
      this.options.rockVisualHelper.materializePlaceableRock(runtime, false);
      return runtime;
    }
    const definition = getCoopDefenseConstructionDefinition(constructionId);
    const runtime = this.options.placementSystem.materializePersistentPlaceable({ ...definition, maxHp: candidate.tool.maxHp }, candidate.gridX, candidate.gridY, candidate.blueprint.angle, ownerId, ownerColor, ownership);
    if (!runtime) return null;
    if (definition.kind === 'pedestal') {
      const world = this.options.rockVisualHelper.gridToWorld(runtime.gridX, runtime.gridY);
      const registered = this.options.powerUpSystem?.registerConstructionPedestal(runtime.id, definition.powerUpDefId, world.x, world.y, ownerColor) ?? false;
      if (!registered) {
        this.options.placementSystem.removeRock(runtime.id);
        return null;
      }
    }
    this.options.rockVisualHelper.materializePlaceableRock(runtime, false);
    return runtime;
  }

  materializeRewardConstruction(
    constructionId: 'spore_turret' | 'rocket_turret',
    rewardId: PersistentBaseRewardId,
    gridX: number,
    gridY: number,
    angle: number,
    ownerId: string,
    ownerColor: number,
  ): SyncedPlaceableRock | null {
    return this.options.placementSystem.materializePersistentBaseReward(
      getCoopDefenseConstructionDefinition(constructionId),
      rewardId,
      gridX,
      gridY,
      angle,
      ownerId,
      ownerColor,
    );
  }

  registerNewPersistentPlaceable(runtime: SyncedPlaceableRock, tool: PersistentToolRef, footprint: readonly { readonly dx: number; readonly dy: number }[]): void {
    const context = this.options.getPersistentBaseContext();
    if (!context) return;
    const constructionId = normalizeConstructionId(runtime.constructionId) ?? normalizeConstructionId(tool.id);
    const normalizedTool: PersistentToolRef = constructionId ? { kind: 'construction', id: constructionId } : { ...tool };
    const ownerId = this.options.resolveOwnerId(runtime.ownerId);
    if (!ownerId) return;
    const registered = context.contributions.registerNew(ownerId, runtime, normalizedTool, footprint, context.anchor, context.buildArea);
    if (registered && !context.contributions.hasActiveMission) this.options.publishImmediateContribution(ownerId);
  }

  movePersonalConstruction(playerId: string, source: SyncedPlaceableRock, preview: UtilityPlacementPreviewState): LoadoutUseResult {
    const context = this.options.getPersistentBaseContext();
    const constructionId = normalizeConstructionId(source.constructionId);
    if (!context || !constructionId) return { ok: false, reason: 'blocked' };
    const footprint = getCoopDefenseConstructionDefinition(constructionId).footprint;
    const previous = { ...source };
    const relocated = this.options.placementSystem.relocateRock(source.id, preview.gridX, preview.gridY, preview.angle, footprint);
    if (!relocated) return { ok: false, reason: 'placement' };
    const binding = context.contributions.getRuntimeBindings().find((entry) => entry.runtimeId === source.id);
    if (binding && !context.contributions.moveConstruction(binding.ownerId, binding.blueprint.persistentId, { relativeGridX: preview.gridX - context.anchor.gridX, relativeGridY: preview.gridY - context.anchor.gridY, angle: preview.angle }, footprint, context.buildArea)) {
      this.options.placementSystem.relocateRock(source.id, previous.gridX, previous.gridY, previous.angle, footprint);
      return { ok: false, reason: 'placement' };
    }
    if (binding && !context.contributions.hasActiveMission) this.options.publishImmediateContribution(binding.ownerId);
    const targetWorld = this.options.rockVisualHelper.gridToWorld(relocated.gridX, relocated.gridY);
    if (previous.kind === 'pedestal') this.options.powerUpSystem?.repositionConstructionPedestal(source.id, targetWorld.x, targetWorld.y);
    this.options.relocatePresentation(previous, relocated);
    this.options.gameAudioSystem.playSound('sfx_place_rock', targetWorld.x, targetWorld.y, playerId);
    this.options.reconcilePersistentBaseWorld();
    return { ok: true };
  }

  placeTunnel(cfg: TunnelUltimateConfig, playerId: string, originX: number, originY: number, targetX: number, targetY: number, playerColor: number, params?: LoadoutUseParams): boolean {
    if (params?.tunnelStartGridX === undefined || params.tunnelStartGridY === undefined) return false;
    const placed = this.options.tunnelPlacementPort?.tryPlaceTunnel(cfg, playerId, playerColor, originX, originY, params.tunnelStartGridX, params.tunnelStartGridY, targetX, targetY) ?? false;
    if (placed) this.options.gameAudioSystem.playSound('sfx_place_dachstunnel', originX, originY, playerId);
    return placed;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.readiness.destroy();
    this.options.utilityAction.setUtilityPlacementCapability(null);
    this.options.onDestroy?.(this);
  }

  private hasFreeCapacity(playerId: string, capacityCost: number): boolean {
    return this.options.placementSystem.getUsedCapacity(playerId) + capacityCost <= this.getCapacity(playerId);
  }

  private getEffectiveUtilityConfig(playerId: string, constructionId: ConstructionId): PlaceableUtilityConfig | null {
    const utilityId = getUtilityIdForConstruction(constructionId);
    if (!utilityId) return null;
    const base = getUtilityConfigForMode(utilityId, this.options.getGameMode());
    if (!base || !('placeable' in base)) return null;
    const modifiers = this.options.modifierReadPort?.getModifiers(playerId);
    const effective = modifiers ? applyCoopDefenseModifiersToUtilityConfig(base as PlaceableUtilityConfig, { additive: modifiers.additiveStats, percentage: modifiers.percentageStats }) as PlaceableUtilityConfig : base as PlaceableUtilityConfig;
    return { ...effective, id: utilityId, placeable: { ...effective.placeable, lifetimeMs: 0 } } as PlaceableUtilityConfig;
  }

  private sourceFor(runtime: SyncedPlaceableRock): 'placeable_rock' | 'placeable_turret' | 'placeable_pedestal' {
    return runtime.kind === 'rock' ? 'placeable_rock' : runtime.kind === 'pedestal' ? 'placeable_pedestal' : 'placeable_turret';
  }
}
