import type { EnergyShieldSystem } from '../systems/EnergyShieldSystem';
import type { ResourceSystem } from '../systems/ResourceSystem';
import type { TeslaDomeSystem } from '../systems/TeslaDomeSystem';
import type { LoadoutUseParams, LoadoutUseResult, WeaponSlot } from '../types';
import type { WeaponConfig } from './LoadoutConfig';

/** Read-only equipment view used by the concrete Tesla/Energy behavior. */
export interface SustainedWeaponLoadoutReadPort {
  getEquippedWeaponConfig(playerId: string, slot: WeaponSlot): WeaponConfig | undefined;
}

/** One host-resolved activation attempt for a sustained weapon. */
export interface SustainedWeaponActionRequest {
  readonly playerId: string;
  readonly slot: WeaponSlot;
  readonly config: WeaponConfig;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly nowMs: number;
  readonly playerColor: number;
  readonly params?: LoadoutUseParams;
}

/**
 * Small capability for the two sustained player weapons.
 *
 * Returning `null` means that the equipped weapon is not owned by this behavior and the normal
 * immediate-weapon path may continue. The concrete Tesla/Energy systems remain the effect-state
 * owners; this behavior only orchestrates their player-facing lifecycle.
 */
export interface SustainedWeaponBehaviorPort {
  claimWeaponAction(playerId: string, slot: WeaponSlot, nowMs: number, angle: number): void;
  activateWeapon(request: SustainedWeaponActionRequest): LoadoutUseResult | null;
  getMovementSlowFactor(playerId: string, nowMs: number): number | null;
  setTeslaDomeSystem(system: TeslaDomeSystem | null): void;
  setEnergyShieldSystem(system: EnergyShieldSystem | null): void;
  resetPlayer(playerId: string): void;
  removePlayer(playerId: string): void;
  destroy(): void;
}
