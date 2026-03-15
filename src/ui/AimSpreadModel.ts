import type { WeaponConfig } from '../loadout/LoadoutConfig';
import { addDynamicSpread, decayDynamicSpread } from '../loadout/SpreadMath';
import type { PlayerAimNetState, WeaponSlot } from '../types';

interface DynamicSpreadState {
  weapon1: number;
  weapon2: number;
}

export interface ResolvedAimState {
  activeSlot: WeaponSlot;
  dynamicSpread: number;
  isMoving: boolean;
}

export class AimSpreadModel {
  private activeSlot: WeaponSlot = 'weapon1';
  private localIsMoving = false;
  private authoritativeAim: PlayerAimNetState | null = null;
  private lastAppliedRevision = -1;

  private readonly displayedDynamicSpread: DynamicSpreadState = {
    weapon1: 0,
    weapon2: 0,
  };

  private readonly lastPredictedShotAt: Record<WeaponSlot, number> = {
    weapon1: -Infinity,
    weapon2: -Infinity,
  };

  private readonly lastAuthoritativeDynamicSpread: DynamicSpreadState = {
    weapon1: 0,
    weapon2: 0,
  };

  constructor(
    private readonly getWeaponConfig: (slot: WeaponSlot) => WeaponConfig,
  ) {}

  setLocalMovement(isMoving: boolean): void {
    this.localIsMoving = isMoving;
  }

  setAuthoritativeState(state: PlayerAimNetState | undefined): void {
    this.authoritativeAim = state ?? null;
    if (!state || state.revision === this.lastAppliedRevision) return;

    const now = Date.now();
    this.syncLastShotAt('weapon1', state.weapon1DynamicSpread, now);
    this.syncLastShotAt('weapon2', state.weapon2DynamicSpread, now);

    this.displayedDynamicSpread.weapon1 = state.weapon1DynamicSpread;
    this.displayedDynamicSpread.weapon2 = state.weapon2DynamicSpread;
    this.lastAppliedRevision = state.revision;
  }

  notifyShot(slot: WeaponSlot, now = Date.now()): void {
    this.activeSlot = slot;

    const config = this.getWeaponConfig(slot);
    if (now - this.lastPredictedShotAt[slot] < config.cooldown) return;

    this.displayedDynamicSpread[slot] = addDynamicSpread(this.displayedDynamicSpread[slot], config);
    this.lastPredictedShotAt[slot] = now;
  }

  update(delta: number, now = Date.now()): void {
    this.displayedDynamicSpread.weapon1 = decayDynamicSpread(
      this.displayedDynamicSpread.weapon1,
      this.getWeaponConfig('weapon1'),
      delta,
      now - this.lastPredictedShotAt.weapon1,
    );
    this.displayedDynamicSpread.weapon2 = decayDynamicSpread(
      this.displayedDynamicSpread.weapon2,
      this.getWeaponConfig('weapon2'),
      delta,
      now - this.lastPredictedShotAt.weapon2,
    );
  }

  getResolvedState(): ResolvedAimState {
    return {
      activeSlot: this.activeSlot,
      dynamicSpread: this.displayedDynamicSpread[this.activeSlot],
      isMoving: this.authoritativeAim?.isMoving ?? this.localIsMoving,
    };
  }

  private syncLastShotAt(slot: WeaponSlot, nextDynamicSpread: number, now: number): void {
    const previous = this.lastAuthoritativeDynamicSpread[slot];
    if (nextDynamicSpread > previous) {
      this.lastPredictedShotAt[slot] = now;
    } else if (nextDynamicSpread <= 0) {
      this.lastPredictedShotAt[slot] = -Infinity;
    }
    this.lastAuthoritativeDynamicSpread[slot] = nextDynamicSpread;
  }
}