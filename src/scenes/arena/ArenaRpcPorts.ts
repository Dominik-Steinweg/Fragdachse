import type { PersistentBaseMoveRequest } from '../../persistentBase/PersistentBaseMove';
import type { PersistentBaseRewardPlacementRequest } from '../../persistentBase/PersistentBaseRewardTypes';
import type {
  ConstructionId,
  HostHeldActionKind,
  LoadoutSlot,
  LoadoutToolRef,
  LoadoutUseParams,
  LoadoutUseResult,
} from '../../types';
import type { PlayerActionRequest } from '../../world/PlayerActionRuntime';
import type { UtilityConfig } from '../../loadout/LoadoutConfig';
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
    hostNowMs: number,
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
    hostNowMs: number,
    activityRevision?: number,
  ): LoadoutUseResult;
  dismantleAllOwnedConstructions(playerId: string, activityRevision?: number): LoadoutUseResult;
}

export interface PersistentBaseRpcPort {
  placeReward(playerId: string, request: PersistentBaseRewardPlacementRequest): LoadoutUseResult;
  moveObject(playerId: string, request: PersistentBaseMoveRequest, hostNowMs: number): LoadoutUseResult;
}

export interface HeldActionRpcIdentity {
  readonly toolRef?: LoadoutToolRef;
  readonly temporaryUtilityInstanceId?: string;
}

export interface HeldActionRpcResult {
  readonly elapsedMs: number;
  readonly chargeFraction: number;
}

/** RPC access to current World-owned player capabilities, never to their Runtime owner. */
export interface PlayerLoadoutRpcPort {
  handleBurrowRequest(playerId: string, wantsBurrowed: boolean): void;
  isBurrowed(playerId: string): boolean;
  isStunned(playerId: string): boolean;
  getTemporaryUtilityConfig(playerId: string, instanceId: string): UtilityConfig | null;
  getEquippedUtilityConfig(playerId: string): UtilityConfig | undefined;
  hasActiveTranslocatorPuck(playerId: string): boolean;
  /** World-owned semantic Player Action boundary for weapon and utility mutations. */
  usePlayerAction: (request: PlayerActionRequest) => LoadoutUseResult;
  startUtilityHeldAction(
    playerId: string,
    actionId: string,
    kind: HostHeldActionKind,
    hostNowMs: number,
    toolRef?: LoadoutToolRef,
    temporaryUtilityInstanceId?: string,
  ): boolean;
  useLoadout(
    slot: LoadoutSlot,
    playerId: string,
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    shotId?: number,
    params?: LoadoutUseParams,
    clientX?: number,
    clientY?: number,
  ): LoadoutUseResult;
  getAdrenaline(playerId: string): number;
  getAdrenalineRevision(playerId: string): number;
  tryPickupPowerUp(playerId: string, uid: number, playerX: number, playerY: number): boolean;
}

/** Host-held input lives and dies with the World player/loadout owner. */
export interface HeldActionRpcPort {
  start(
    playerId: string,
    actionId: string,
    kind: HostHeldActionKind,
    expectedDurationMs: number,
    hostNowMs: number,
    identity?: HeldActionRpcIdentity,
  ): boolean;
  cancel(playerId: string, actionId?: string): void;
  consume(
    playerId: string,
    actionId: string | undefined,
    kind: HostHeldActionKind,
    fullChargeDurationMs: number,
    hostNowMs: number,
    expectedIdentity?: HeldActionRpcIdentity,
  ): HeldActionRpcResult | null;
  clearPlayer(playerId: string): void;
}

export interface TrainRpcPort {
  markDestroyed(): void;
}
