import type { CombatSource } from '../combat/CombatScope';
import type { CoopDefenseEnemyMortarConfig } from '../config/coopDefenseEnemies';
import type { SyncedMortarStrike } from '../types';

/** Captured at windup start; never resolved again through the source enemy's lifetime. */
export interface MortarStrike {
  readonly snapshot: SyncedMortarStrike;
  readonly damage: CoopDefenseEnemyMortarConfig;
  readonly source: CombatSource;
}

export interface CoopDefenseMortarImpactPort {
  readonly impact: (strike: MortarStrike, nowMs: number) => void;
}

/** Activity-owned deferred execution. Only committed strikes enter this owner. */
export class CoopDefenseMortarStrikeSystem {
  private readonly strikes = new Map<number, MortarStrike>();
  private nextId = 1;

  constructor(private readonly effects: CoopDefenseMortarImpactPort) {}

  allocateId(): number { return this.nextId++; }

  launch(strike: MortarStrike): void {
    this.strikes.set(strike.snapshot.id, strike);
  }

  hostUpdate(nowMs: number): void {
    for (const [id, strike] of this.strikes) {
      if (nowMs < strike.snapshot.impactAt) continue;
      // Remove before effects: a synchronous death hook or teardown cannot repeat the impact.
      this.strikes.delete(id);
      this.effects.impact(strike, nowMs);
    }
  }

  getSnapshot(): SyncedMortarStrike[] {
    return [...this.strikes.values()].map(strike => ({ ...strike.snapshot }));
  }

  clear(): void { this.strikes.clear(); }
}
