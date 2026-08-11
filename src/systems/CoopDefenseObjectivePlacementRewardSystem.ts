import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../config/coopDefenseMaps';
import { createCoopDefensePlaceablePedestalUtility } from '../loadout/CoopDefenseMissionUtility';
import type { PlaceablePedestalUtilityConfig } from '../loadout/LoadoutTypes';

export type CoopDefenseObjectivePlacementRewardState = 'locked' | 'available' | 'carried' | 'consumed' | 'cancelled';

export interface CoopDefenseObjectivePlacementRewardDeps {
  readonly isEligiblePlayer: (playerId: string) => boolean;
  readonly getBasePosition: (baseId: string) => { x: number; y: number } | null;
  readonly spawnMarker: (objectiveId: string, powerUpDefId: string, x: number, y: number) => boolean;
  readonly removeMarker: (objectiveId: string) => void;
  readonly spawnPickup: (objectiveId: string, powerUpDefId: string, x: number, y: number) => boolean;
  readonly overrideUtility: (playerId: string, config: PlaceablePedestalUtilityConfig) => boolean;
  readonly releaseUtilityOverride: (playerId: string) => void;
}

interface PlacementRewardRuntime {
  readonly objectiveId: string;
  readonly baseId: string;
  readonly powerUpDefId: string;
  state: CoopDefenseObjectivePlacementRewardState;
  carrierId: string | null;
}

/**
 * Host-only state machine for one-shot, team-wide placement rewards.
 *
 * The system intentionally owns neither pickup rendering nor the placed pedestal. It only owns
 * the grant lifecycle and delegates those two world operations to the existing PowerUpSystem and
 * PlacementSystem paths.
 */
export class CoopDefenseObjectivePlacementRewardSystem {
  private readonly rewards = new Map<string, PlacementRewardRuntime>();

  constructor(
    configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
    private readonly deps: CoopDefenseObjectivePlacementRewardDeps,
  ) {
    for (const config of configs) {
      const reward = config.rewards?.placeablePedestalOnComplete;
      if (!reward || config.type !== 'hold' || config.targets.length !== 1) continue;
      this.rewards.set(config.id, {
        objectiveId: config.id,
        baseId: config.targets[0],
        powerUpDefId: reward.powerUpDefId,
        state: 'locked',
        carrierId: null,
      });
    }
  }

  /** Shows the future reward location as soon as its Hold objective becomes active. */
  begin(objectiveId: string): boolean {
    const runtime = this.rewards.get(objectiveId);
    if (!runtime || runtime.state !== 'locked') return false;
    const position = this.deps.getBasePosition(runtime.baseId);
    return position !== null && this.deps.spawnMarker(objectiveId, runtime.powerUpDefId, position.x, position.y);
  }

  /** Completes a Hold exactly once and replaces its marker with a claimable team pickup. */
  activate(objectiveId: string): boolean {
    const runtime = this.rewards.get(objectiveId);
    if (!runtime || runtime.state !== 'locked') return false;
    const position = this.deps.getBasePosition(runtime.baseId);
    if (!position) return false;
    runtime.state = 'available';
    const spawned = this.deps.spawnPickup(objectiveId, runtime.powerUpDefId, position.x, position.y);
    if (!spawned) runtime.state = 'locked';
    return spawned;
  }

  /** Removes the pre-announced reward location if its Hold objective fails. */
  cancel(objectiveId: string): boolean {
    const runtime = this.rewards.get(objectiveId);
    if (!runtime || runtime.state !== 'locked') return false;
    this.deps.removeMarker(objectiveId);
    runtime.state = 'cancelled';
    return true;
  }

  /** Atomic claim: only one eligible active participant can transition to carried. */
  claim(objectiveId: string, playerId: string): boolean {
    const runtime = this.rewards.get(objectiveId);
    if (!runtime || runtime.state !== 'available' || !this.deps.isEligiblePlayer(playerId)) return false;
    const utility = createCoopDefensePlaceablePedestalUtility(objectiveId, runtime.powerUpDefId);
    if (!this.deps.overrideUtility(playerId, utility)) return false;
    runtime.state = 'carried';
    runtime.carrierId = playerId;
    return true;
  }

  /** Checks the host-side placement request without consuming the reward. */
  canPlace(objectiveId: string, playerId: string): boolean {
    const runtime = this.rewards.get(objectiveId);
    return runtime?.state === 'carried' && runtime.carrierId === playerId;
  }

  /** Consumes the team charge only after the pedestal was placed and registered successfully. */
  consume(objectiveId: string, playerId: string): boolean {
    const runtime = this.rewards.get(objectiveId);
    if (!runtime || runtime.state !== 'carried' || runtime.carrierId !== playerId) return false;
    runtime.state = 'consumed';
    runtime.carrierId = null;
    return true;
  }

  /** Death, spectator transition and disconnect all return an unconsumed reward to the base. */
  handlePlayerUnavailable(playerId: string): void {
    for (const runtime of this.rewards.values()) {
      if (runtime.state !== 'carried' || runtime.carrierId !== playerId) continue;
      this.deps.releaseUtilityOverride(playerId);
      runtime.state = 'available';
      runtime.carrierId = null;
      const position = this.deps.getBasePosition(runtime.baseId);
      if (position) this.deps.spawnPickup(runtime.objectiveId, runtime.powerUpDefId, position.x, position.y);
    }
  }

  getState(objectiveId: string): CoopDefenseObjectivePlacementRewardState | null {
    return this.rewards.get(objectiveId)?.state ?? null;
  }

  getCarrierId(objectiveId: string): string | null {
    return this.rewards.get(objectiveId)?.carrierId ?? null;
  }

  reset(): void {
    this.rewards.clear();
  }
}
