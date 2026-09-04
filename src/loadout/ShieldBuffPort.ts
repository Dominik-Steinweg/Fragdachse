import type { EnergyShieldWeaponFireConfig } from './LoadoutConfig';
import type { ShieldBuffHudState } from '../types';

/** Read-only Shield-Buff-Sicht für Loadout-/HUD-/Damage-Consumer. */
export interface ShieldBuffReadPort {
  getPrimaryDamageMultiplier(playerId: string, fire: EnergyShieldWeaponFireConfig, now: number): number;
  getHudState(playerId: string, fire: EnergyShieldWeaponFireConfig, visible: boolean, now: number): ShieldBuffHudState;
}

/** Player-in-World-Lifecycle für den World-owned Shield-Buff-State. */
export interface ShieldBuffLifecyclePort {
  resetPlayer(playerId: string): void;
  removePlayer(playerId: string): void;
}

export type ShieldBuffPort = ShieldBuffReadPort & ShieldBuffLifecyclePort;
