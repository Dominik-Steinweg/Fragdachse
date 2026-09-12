import type { WeaponConfig } from '../loadout/LoadoutConfig';
import { rocketMagazineCapacity } from '../loadout/RocketLauncherConfig';
import type { LoadoutUseResult, RocketMagazineInput, RocketMagazineState } from '../types';

interface Magazine {
  id: number; config: WeaponConfig; count: number; nextLoadAt: number; lastInputAt: number;
  angle: number; targetX: number; targetY: number; focused: boolean; held: boolean;
}

export interface RocketMagazinePort {
  getConfig(playerId: string): WeaponConfig | undefined;
  canAct(playerId: string, now: number): boolean;
  isOnCooldown(playerId: string, now: number): boolean;
  canPay(playerId: string, config: WeaponConfig): boolean;
  pay(playerId: string, config: WeaponConfig, now: number): void;
  fire(playerId: string, config: WeaponConfig, aim: { angle: number; targetX: number; targetY: number },
    count: number, focused: boolean, now: number): LoadoutUseResult;
}

/** World-owned held gesture and prepaid magazine. Only this owner creates salvo counts. */
export class RocketMagazineRuntime {
  private readonly magazines = new Map<string, Magazine>();
  private readonly latestIds = new Map<string, number>();
  private destroyed = false;
  constructor(private readonly port: RocketMagazinePort) {}

  input(playerId: string, input: RocketMagazineInput, angle: number, targetX: number, targetY: number, now: number): LoadoutUseResult {
    if (this.destroyed || !Number.isSafeInteger(input.id) || input.id <= 0
      || !['hold', 'release', 'cancel'].includes(input.phase) || typeof input.focused !== 'boolean'
      || ![angle, targetX, targetY, now].every(Number.isFinite)) return { ok: false, reason: 'invalid' };
    const latest = this.latestIds.get(playerId) ?? 0;
    if (input.id < latest) return { ok: false, reason: 'invalid' };
    if (input.phase === 'cancel') {
      this.latestIds.set(playerId, Math.max(latest, input.id));
      this.cancel(playerId);
      return { ok: true };
    }
    const config = this.port.getConfig(playerId);
    if (!config?.rocketLauncher?.magazineLevel || !this.port.canAct(playerId, now)) {
      this.cancel(playerId);
      this.latestIds.set(playerId, Math.max(latest, input.id));
      return { ok: false, reason: 'blocked' };
    }
    let state = this.magazines.get(playerId);
    if (!state || state.id !== input.id) {
      if (input.id <= latest || input.phase !== 'hold') return { ok: false, reason: 'invalid' };
      this.latestIds.set(playerId, input.id);
      state = { id: input.id, config, count: 0, nextLoadAt: now, lastInputAt: now,
        angle, targetX, targetY, focused: input.focused, held: true };
      this.magazines.set(playerId, state);
    }
    if (state.config !== config) { this.cancel(playerId); return { ok: false, reason: 'blocked' }; }
    Object.assign(state, { angle, targetX, targetY, focused: input.focused, lastInputAt: now });
    if (input.phase === 'release') {
      state.held = false;
      if (state.count > 0) this.shoot(playerId, state, now);
      this.magazines.delete(playerId);
    } else this.advance(playerId, state, now);
    return { ok: true };
  }

  update(now: number): void {
    for (const [playerId, state] of this.magazines) {
      if (!this.port.canAct(playerId, now) || this.port.getConfig(playerId) !== state.config || now - state.lastInputAt > 2000) {
        this.cancel(playerId); continue;
      }
      this.advance(playerId, state, now);
    }
  }

  getState(playerId: string): RocketMagazineState | undefined {
    const state = this.magazines.get(playerId);
    return state ? { id: state.id, loaded: state.count, capacity: rocketMagazineCapacity(state.config.rocketLauncher!),
      nextLoadAt: state.nextLoadAt, intervalMs: state.config.cooldown, focused: state.focused,
      canLoadNext: this.port.canPay(playerId, state.config) } : undefined;
  }

  /** Release prepaid rockets before an action changes position or blocks weapons. */
  releaseForAction(playerId: string, now: number): void {
    const state = this.magazines.get(playerId);
    if (!state) return;
    // Close the gesture first, including reentrant actions and delayed hold/release packets.
    this.magazines.delete(playerId);
    state.held = false;
    if (!this.destroyed && Number.isFinite(now) && this.port.canAct(playerId, now)
      && this.port.getConfig(playerId) === state.config && now - state.lastInputAt <= 2000
      && state.count > 0) this.shoot(playerId, state, now);
  }

  isHolding(playerId: string): boolean { return this.magazines.has(playerId); }
  cancel(playerId: string): void { this.magazines.delete(playerId); }
  cancelAll(): void { this.magazines.clear(); }
  removePlayer(playerId: string): void { this.cancel(playerId); this.latestIds.delete(playerId); }
  destroy(): void { this.destroyed = true; this.magazines.clear(); this.latestIds.clear(); }

  private advance(playerId: string, state: Magazine, now: number): void {
    if (!state.held || this.port.isOnCooldown(playerId, now)) return;
    if (!this.port.canPay(playerId, state.config)) {
      if (state.count > 0) this.shoot(playerId, state, now);
      return;
    }
    if (now < state.nextLoadAt) return;
    this.port.pay(playerId, state.config, now);
    if (this.magazines.get(playerId) !== state) return;
    state.count += 1;
    state.nextLoadAt = now + state.config.cooldown;
    if (state.count >= rocketMagazineCapacity(state.config.rocketLauncher!) || !this.port.canPay(playerId, state.config)) {
      this.shoot(playerId, state, now);
    }
  }

  private shoot(playerId: string, state: Magazine, now: number): void {
    const count = state.count;
    state.count = 0;
    state.nextLoadAt = now + state.config.cooldown;
    const result = this.port.fire(playerId, state.config, state, count, state.focused, now);
    if (!result.ok) this.cancel(playerId);
  }
}
