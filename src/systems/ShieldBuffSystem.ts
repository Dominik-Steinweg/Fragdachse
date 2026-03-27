import type { EnergyShieldWeaponFireConfig } from '../loadout/LoadoutConfig';
import type { ShieldBuffHudState } from '../types';

interface ShieldBuffState {
  value: number;
  lastGainAt: number;
  lastUpdatedAt: number;
}

export class ShieldBuffSystem {
  private readonly states = new Map<string, ShieldBuffState>();

  resetPlayer(playerId: string): void {
    this.states.delete(playerId);
  }

  removePlayer(playerId: string): void {
    this.states.delete(playerId);
  }

  addBlockedDamage(playerId: string, blockedDamage: number, fire: EnergyShieldWeaponFireConfig, now: number): void {
    const state = this.getOrCreateState(playerId, now);
    this.applyDecay(state, fire, now);
    state.value = Math.min(fire.buffMax, state.value + blockedDamage * fire.buffGainFactor);
    state.lastGainAt = now;
    state.lastUpdatedAt = now;
  }

  getPrimaryDamageMultiplier(playerId: string, fire: EnergyShieldWeaponFireConfig, now: number): number {
    const value = this.getBuffValue(playerId, fire, now);
    if (value <= 0 || fire.buffMax <= 0) return 1;
    return 1 + fire.buffMaxBonus * (value / fire.buffMax);
  }

  getBuffValue(playerId: string, fire: EnergyShieldWeaponFireConfig, now: number): number {
    const state = this.states.get(playerId);
    if (!state) return 0;
    this.applyDecay(state, fire, now);
    if (state.value <= 0.0001) {
      this.states.delete(playerId);
      return 0;
    }
    return state.value;
  }

  getHudState(playerId: string, fire: EnergyShieldWeaponFireConfig, visible: boolean, now: number): ShieldBuffHudState {
    const value = this.getBuffValue(playerId, fire, now);
    const multiplier = value > 0 ? 1 + fire.buffMaxBonus * (value / Math.max(1, fire.buffMax)) : 1;
    return {
      visible,
      defId: 'SHIELD_OVERCHARGE',
      value,
      maxValue: fire.buffMax,
      damageBonusPct: Math.max(0, Math.round((multiplier - 1) * 100)),
    };
  }

  private getOrCreateState(playerId: string, now: number): ShieldBuffState {
    let state = this.states.get(playerId);
    if (!state) {
      state = { value: 0, lastGainAt: now, lastUpdatedAt: now };
      this.states.set(playerId, state);
    }
    return state;
  }

  private applyDecay(state: ShieldBuffState, fire: EnergyShieldWeaponFireConfig, now: number): void {
    if (now <= state.lastUpdatedAt) return;
    if (state.value <= 0) {
      state.value = 0;
      state.lastUpdatedAt = now;
      return;
    }
    const decayStartAt = state.lastGainAt + fire.buffDecayDelayMs;
    if (now <= decayStartAt) {
      state.lastUpdatedAt = now;
      return;
    }
    const decayFrom = Math.max(state.lastUpdatedAt, decayStartAt);
    const deltaMs = now - decayFrom;
    if (deltaMs <= 0) {
      state.lastUpdatedAt = now;
      return;
    }
    state.value = Math.max(0, state.value - fire.buffDecayPerSecond * (deltaMs / 1000));
    state.lastUpdatedAt = now;
  }
}