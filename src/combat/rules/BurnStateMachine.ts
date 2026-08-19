import { BURN_TICK_INTERVAL_MS } from '../../config';
import type { BurnOrigin, GroundFireVisualStyle } from '../../types';

export const MAX_BURN_CATCH_UP_TICKS = 4;

export interface BurnStackBucket {
  expiresAt: number;
  damagePerTick: number;
  stackCount: number;
}

export interface BurnSourceState {
  attackerId: string;
  sourceKey: string;
  stacks: BurnStackBucket[];
  sourceId: string;
  origin: BurnOrigin;
  visualStyle: GroundFireVisualStyle;
}

export interface ActiveBurnSource {
  attackerId: string;
  sourceKey: string;
  sourceId: string;
  origin: BurnOrigin;
  visualStyle: GroundFireVisualStyle;
  stackCount: number;
  damagePerTick: number;
  tickIntervalMs: number;
  effectiveDamagePerSecond: number;
}

export interface ApplyBurnHitParams {
  targetId: string;
  attackerId: string;
  durationMs: number;
  damagePerTick: number;
  sourceKey: string;
  sourceId: string;
  origin?: BurnOrigin;
  visualStyle?: GroundFireVisualStyle;
  now: number;
}

export interface DueBurnContribution {
  targetId: string;
  attackerId: string;
  sourceId: string;
  sourceKey: string;
  damage: number;
  origin: BurnOrigin;
  visualStyle: GroundFireVisualStyle;
  tickAt: number;
}

/**
 * Phaser-unabhängiger Kern für Brand-Status, Stack-Buckets, Expiration und deterministische Ticks.
 *
 * Regeln:
 * - Jeder Brandtreffer erzeugt genau 1 Stack.
 * - Stacks mit identischem (expiresAt, damagePerTick) teilen sich einen Bucket.
 * - Expiration wird immer auf das Ende des globalen Brand-Ticks gerundet:
 *   `Math.ceil((now + durationMs) / BURN_TICK_INTERVAL_MS) * BURN_TICK_INTERVAL_MS`.
 * - Ticks sind global auf Vielfache von `BURN_TICK_INTERVAL_MS` ausgerichtet.
 * - Catch-up verarbeitet maximal `MAX_BURN_CATCH_UP_TICKS` Ticks und überspringt größeren Backlog.
 * - Gleichzeitig fällige Beiträge werden deterministisch sortiert:
 *   (1. Höherer Schaden zuerst, 2. attackerId lexikografisch, 3. sourceId lexikografisch).
 */
export class BurnStateMachine {
  private readonly burnStates: Map<string, Map<string, BurnSourceState>> = new Map();
  private nextBurnTickAt = 0;
  readonly tickIntervalMs: number;

  constructor(tickIntervalMs: number = BURN_TICK_INTERVAL_MS) {
    this.tickIntervalMs = tickIntervalMs;
  }

  /**
   * Wendet einen Brandtreffer auf ein Ziel an.
   * Gibt true zurück, wenn ein Stack erzeugt wurde.
   */
  applyHit(params: ApplyBurnHitParams): boolean {
    const {
      targetId,
      attackerId,
      durationMs,
      damagePerTick,
      sourceKey,
      sourceId,
      origin = 'generic',
      visualStyle = 'normal',
      now,
    } = params;

    if (durationMs <= 0 || damagePerTick <= 0 || !sourceId) {
      return false;
    }

    if (this.nextBurnTickAt <= 0) {
      this.nextBurnTickAt = Math.floor(now / this.tickIntervalMs) * this.tickIntervalMs
        + this.tickIntervalMs;
    }

    let targetState = this.burnStates.get(targetId);
    if (!targetState) {
      targetState = new Map();
      this.burnStates.set(targetId, targetState);
    }

    const keyedSource = `${attackerId}\u001f${sourceKey}`;
    let sourceState = targetState.get(keyedSource);
    if (!sourceState) {
      sourceState = {
        attackerId,
        sourceKey,
        stacks: [],
        sourceId,
        origin,
        visualStyle,
      };
      targetState.set(keyedSource, sourceState);
    } else {
      sourceState.visualStyle = visualStyle;
    }

    const expiresAt = Math.ceil((now + durationMs) / this.tickIntervalMs) * this.tickIntervalMs;
    const bucket = sourceState.stacks.find(
      (entry) => entry.expiresAt === expiresAt && entry.damagePerTick === damagePerTick,
    );
    if (bucket) {
      bucket.stackCount += 1;
    } else {
      sourceState.stacks.push({ expiresAt, damagePerTick, stackCount: 1 });
    }

    return true;
  }

  /**
   * Führt die Zeit bis `now` fort und erzeugt alle fälligen Schadensbeiträge.
   *
   * @param now Aktueller virtueller oder realer Zeitstempel in ms.
   * @param isTargetValid Optionaler Prädikatsfilter (z.B. Ziel am Leben und nicht eingegraben).
   *                      Ungültige Ziele werden bereinigt und erhalten keinen Schaden.
   */
  advanceTo(
    now: number,
    isTargetValid?: (targetId: string) => boolean,
  ): DueBurnContribution[] {
    if (this.nextBurnTickAt <= 0) {
      this.nextBurnTickAt = Math.floor(now / this.tickIntervalMs) * this.tickIntervalMs
        + this.tickIntervalMs;
    }

    const allContributions: DueBurnContribution[] = [];
    let processedTicks = 0;

    while (now >= this.nextBurnTickAt && processedTicks < MAX_BURN_CATCH_UP_TICKS) {
      const tickContributions = this.processTick(this.nextBurnTickAt, isTargetValid);
      for (const contrib of tickContributions) {
        allContributions.push(contrib);
      }
      this.nextBurnTickAt += this.tickIntervalMs;
      processedTicks += 1;
    }

    if (now >= this.nextBurnTickAt) {
      this.nextBurnTickAt = Math.floor(now / this.tickIntervalMs) * this.tickIntervalMs
        + this.tickIntervalMs;
    }

    this.pruneExpired(now);
    return allContributions;
  }

  private processTick(
    tickAt: number,
    isTargetValid?: (targetId: string) => boolean,
  ): DueBurnContribution[] {
    const tickContributions: DueBurnContribution[] = [];

    for (const [targetId, sourceStates] of [...this.burnStates]) {
      if (isTargetValid && !isTargetValid(targetId)) {
        this.clearTarget(targetId);
        continue;
      }

      const targetContributions: DueBurnContribution[] = [];
      for (const [sourceKey, state] of sourceStates) {
        state.stacks = state.stacks.filter((bucket) => bucket.expiresAt > tickAt);
        if (state.stacks.length === 0) {
          sourceStates.delete(sourceKey);
          continue;
        }

        const damage = state.stacks.reduce(
          (sum, bucket) => sum + bucket.damagePerTick * bucket.stackCount,
          0,
        );

        if (damage > 0) {
          targetContributions.push({
            targetId,
            attackerId: state.attackerId,
            sourceId: state.sourceId,
            sourceKey: state.sourceKey,
            damage,
            origin: state.origin,
            visualStyle: state.visualStyle,
            tickAt,
          });
        }
      }

      // Deterministische Sortierung: 1. Schaden absteigend, 2. attackerId, 3. sourceId
      targetContributions.sort((left, right) => (
        right.damage - left.damage
        || left.attackerId.localeCompare(right.attackerId)
        || left.sourceId.localeCompare(right.sourceId)
      ));

      for (const c of targetContributions) {
        tickContributions.push(c);
      }

      if (sourceStates.size === 0) {
        this.burnStates.delete(targetId);
      }
    }

    return tickContributions;
  }

  private pruneExpired(now: number): void {
    for (const [targetId, sourceStates] of this.burnStates) {
      for (const [sourceKey, state] of sourceStates) {
        state.stacks = state.stacks.filter((bucket) => bucket.expiresAt > now);
        if (state.stacks.length === 0) {
          sourceStates.delete(sourceKey);
        }
      }
      if (sourceStates.size === 0) {
        this.burnStates.delete(targetId);
      }
    }
  }

  getVisualState(
    targetId: string,
    now: number,
  ): { stackCount: number; visualStyle: GroundFireVisualStyle } {
    const sourceStates = this.burnStates.get(targetId);
    if (!sourceStates) return { stackCount: 0, visualStyle: 'normal' };

    let totalStacks = 0;
    let visualStyle: GroundFireVisualStyle = 'normal';

    for (const state of sourceStates.values()) {
      for (const bucket of state.stacks) {
        if (bucket.expiresAt <= now) continue;
        totalStacks += bucket.stackCount;
        if (state.visualStyle === 'void') visualStyle = 'void';
      }
    }

    return { stackCount: totalStacks, visualStyle };
  }

  getStackCount(targetId: string, now: number): number {
    return this.getVisualState(targetId, now).stackCount;
  }

  getActiveSources(targetId: string, now: number): ActiveBurnSource[] {
    const sourceStates = this.burnStates.get(targetId);
    if (!sourceStates) return [];

    const result: ActiveBurnSource[] = [];
    for (const state of sourceStates.values()) {
      const activeBuckets = state.stacks.filter((bucket) => bucket.expiresAt > now);
      const stackCount = activeBuckets.reduce((sum, bucket) => sum + bucket.stackCount, 0);
      if (stackCount <= 0) continue;

      const totalDamagePerTick = activeBuckets.reduce(
        (sum, bucket) => sum + bucket.damagePerTick * bucket.stackCount,
        0,
      );

      result.push({
        attackerId: state.attackerId,
        sourceKey: state.sourceKey,
        sourceId: state.sourceId,
        origin: state.origin,
        visualStyle: state.visualStyle,
        stackCount,
        damagePerTick: totalDamagePerTick / stackCount,
        tickIntervalMs: this.tickIntervalMs,
        effectiveDamagePerSecond: (totalDamagePerTick * 1000) / this.tickIntervalMs,
      });
    }

    return result;
  }

  hasTarget(targetId: string): boolean {
    return this.burnStates.has(targetId);
  }

  hasAnyActiveBurns(now?: number): boolean {
    if (this.burnStates.size === 0) return false;
    if (now === undefined) return true;

    for (const sourceStates of this.burnStates.values()) {
      for (const state of sourceStates.values()) {
        for (const bucket of state.stacks) {
          if (bucket.expiresAt > now) return true;
        }
      }
    }
    return false;
  }

  clearTarget(targetId: string): void {
    this.burnStates.delete(targetId);
  }

  clearByAttacker(attackerId: string): void {
    for (const [targetId, sourceStates] of this.burnStates) {
      for (const [sourceKey, state] of sourceStates) {
        if (state.attackerId === attackerId) {
          sourceStates.delete(sourceKey);
        }
      }
      if (sourceStates.size === 0) {
        this.burnStates.delete(targetId);
      }
    }
  }

  reset(nextBurnTickAt = 0): void {
    this.burnStates.clear();
    this.nextBurnTickAt = nextBurnTickAt;
  }

  getNextBurnTickAt(): number {
    return this.nextBurnTickAt;
  }
}
