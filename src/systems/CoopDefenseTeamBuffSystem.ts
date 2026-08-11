import {
  COOP_DEFENSE_TEAM_BUFF_DEFAULTS,
  type CoopDefenseMapTeamBuffRewardConfig,
} from '../config/coopDefenseMaps';
import type { SyncedActiveHudBuff } from '../types';

/**
 * Host-only, round-local team buff. There is deliberately one shared end timestamp and no
 * player-owned activation state: eligibility and life are resolved at the point of use.
 */
export class CoopDefenseTeamBuffSystem {
  private activationConsumed = false;
  private buffEndsAt: number | null = null;
  private buff: ResolvedTeamBuff | null = null;

  activate(reward: CoopDefenseMapTeamBuffRewardConfig, now = Date.now()): boolean {
    if (this.activationConsumed || this.buffEndsAt !== null) return false;

    const durationMs = resolvePositiveNumber(reward.durationMs, COOP_DEFENSE_TEAM_BUFF_DEFAULTS.durationMs);
    if (durationMs <= 0) return false;

    this.activationConsumed = true;
    this.buff = {
      defId: reward.defId,
      durationMs,
      hpRegenPerSecond: resolveNonNegativeNumber(
        reward.hpRegenPerSecond,
        COOP_DEFENSE_TEAM_BUFF_DEFAULTS.hpRegenPerSecond,
      ),
      adrenalineRegenMultiplier: resolvePositiveNumber(
        reward.adrenalineRegenMultiplier,
        COOP_DEFENSE_TEAM_BUFF_DEFAULTS.adrenalineRegenMultiplier,
      ),
    };
    this.buffEndsAt = now + durationMs;
    return true;
  }

  isActive(now = Date.now()): boolean {
    return this.buff !== null && this.buffEndsAt !== null && now < this.buffEndsAt;
  }

  getBuffEndsAt(): number | null {
    return this.buffEndsAt;
  }

  getHpRegenBonus(now = Date.now(), eligible = true, alive = true): number {
    return eligible && alive && this.isActive(now) ? this.buff?.hpRegenPerSecond ?? 0 : 0;
  }

  getAdrenalineRegenMultiplier(now = Date.now(), eligible = true, alive = true): number {
    return eligible && alive && this.isActive(now)
      ? this.buff?.adrenalineRegenMultiplier ?? 1
      : 1;
  }

  getHudBuff(now = Date.now(), eligible = true, alive = true): SyncedActiveHudBuff | null {
    if (!eligible || !alive || !this.isActive(now) || !this.buff || this.buffEndsAt === null) return null;
    return {
      defId: this.buff.defId,
      remainingFrac: clamp01((this.buffEndsAt - now) / this.buff.durationMs),
      valueText: `+${formatNumber(this.buff.hpRegenPerSecond)} HP/s · +${formatPercent(this.buff.adrenalineRegenMultiplier - 1)} ADR`,
      intensity: 1,
    };
  }

  reset(): void {
    this.activationConsumed = false;
    this.buffEndsAt = null;
    this.buff = null;
  }
}

interface ResolvedTeamBuff {
  readonly defId: string;
  readonly durationMs: number;
  readonly hpRegenPerSecond: number;
  readonly adrenalineRegenMultiplier: number;
}

function resolvePositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveNonNegativeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
