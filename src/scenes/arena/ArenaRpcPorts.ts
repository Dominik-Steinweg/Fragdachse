import type { PersistentBaseMoveRequest } from '../../persistentBase/PersistentBaseMove';
import type { PersistentBaseRewardPlacementRequest } from '../../persistentBase/PersistentBaseRewardTypes';
import type { PowerUpSystem } from '../../powerups/PowerUpSystem';
import type { LoadoutManager } from '../../loadout/LoadoutManager';
import type { BurrowSystem } from '../../systems/BurrowSystem';
import type { HostHeldActionSystem } from '../../systems/HostHeldActionSystem';
import type { ResourceSystem } from '../../systems/ResourceSystem';
import type { TranslocatorSystem } from '../../systems/TranslocatorSystem';
import type {
  ConstructionId,
  LoadoutToolRef,
  LoadoutUseParams,
  LoadoutUseResult,
} from '../../types';
import type { PlayerCapabilities } from '../../world/PlayerCapabilities';

export interface WorldParticipationRpcPort {
  handleRequest(playerId: string, join: boolean): boolean;
}

export interface PlayerCapabilitiesRpcPort {
  get(playerId: string): PlayerCapabilities;
}

export interface ConstructionRpcPort {
  placeInspectorConstruction(
    playerId: string,
    constructionId: ConstructionId,
    targetX: number,
    targetY: number,
    activityRevision?: number,
  ): LoadoutUseResult;
  useInspectorUtility(
    playerId: string,
    tool: LoadoutToolRef,
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    params?: LoadoutUseParams,
  ): LoadoutUseResult;
  dismantleConstruction(
    playerId: string,
    targetX: number,
    targetY: number,
    activityRevision?: number,
  ): LoadoutUseResult;
  dismantleAllOwnedConstructions(playerId: string, activityRevision?: number): LoadoutUseResult;
}

export interface PersistentBaseRpcPort {
  placeReward(playerId: string, request: PersistentBaseRewardPlacementRequest): LoadoutUseResult;
  moveObject(playerId: string, request: PersistentBaseMoveRequest): LoadoutUseResult;
}

/** RPC access to the current World-owned player/loadout systems, never to their Runtime owner. */
export interface PlayerLoadoutRpcPort {
  getBurrowSystem(): BurrowSystem | null;
  getLoadoutManager(): LoadoutManager | null;
  getTranslocatorSystem(): TranslocatorSystem | null;
  getResourceSystem(): ResourceSystem | null;
  getPowerUpSystem(): PowerUpSystem | null;
}

/** Host-held input lives and dies with the World player/loadout owner. */
export interface HeldActionRpcPort {
  getSystem(): HostHeldActionSystem | null;
}

export interface TrainRpcPort {
  markDestroyed(): void;
}
