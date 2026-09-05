import type { SyncedActiveHudBuff } from '../types';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import type {
  Ak47BehaviorPort,
  Ak47LoadoutReadPort,
  Ak47ShotPreparation,
} from '../loadout/Ak47BehaviorPort';
import type { ProjectileAk47HitContext } from '../projectile/ProjectileCombatPort';
import type { ProjectileLifecycleOutcome } from '../projectile/ProjectileGameplayPort';

interface Ak47CombatState {
  stacks: number;
  fireSuperiorityShotsAvailable: number;
  fireSuperiorityTotalShots: number;
  pendingFireSuperiorityShotIds: Set<number>;
  nextShotId: number;
  confirmedShotIds: Set<number>;
  refundedShotIds: Set<number>;
}

/**
 * World-owned stateful AK47 behavior.
 *
 * Loadout provides only the equipped config. This runtime owns progression, shot identity,
 * confirmed-hit bookkeeping, breakthrough refunds and the corresponding HUD projection.
 */
export class Ak47BehaviorRuntime implements Ak47BehaviorPort {
  private readonly states = new Map<string, Ak47CombatState>();
  private destroyed = false;

  constructor(private readonly loadout: Ak47LoadoutReadPort) {}

  prepareShot(playerId: string, config: WeaponConfig): Ak47ShotPreparation | null {
    if (this.destroyed || config.id !== 'AK47' || !config.ak47Focus) return null;

    const state = this.getOrCreateState(playerId);
    const focus = config.ak47Focus;
    const fireSuperiorityShot = state.fireSuperiorityShotsAvailable > 0;
    const fireControlRangeMultiplier = focus.fireControlEnabled > 0
      ? Math.max(0, 1 + state.stacks * focus.fireControlRangePerStack)
      : 1;
    const fireControlProjectileSpeedMultiplier = focus.fireControlEnabled > 0
      ? Math.max(0, 1 + state.stacks * focus.fireControlProjectileSpeedPerStack)
      : 1;
    const shotId = state.nextShotId++;

    return {
      shotId,
      fireSuperiorityShot,
      fireControlSpreadMultiplier: focus.fireControlEnabled > 0
        ? Math.max(0, 1 - state.stacks * focus.fireControlSpreadPerStack)
        : 1,
      shotConfig: {
        ...config,
        range: config.range * fireControlRangeMultiplier,
        fire: config.fire.type === 'projectile'
          ? { ...config.fire, projectileSpeed: config.fire.projectileSpeed * fireControlProjectileSpeedMultiplier }
          : config.fire,
        penetrationCount: fireSuperiorityShot ? 1_000_000 : config.penetrationCount,
        penetrationDamageRetention: fireSuperiorityShot ? 1 : config.penetrationDamageRetention,
        penetratesRocks: fireSuperiorityShot && (config.rockDamageMult ?? 0) > 0 ? 1 : 0,
        ak47ShotId: shotId,
        ak47DamageMultiplier: 1 + state.stacks * focus.damagePerStack,
        ak47FireSuperiorityShot: fireSuperiorityShot,
      },
    };
  }

  commitShot(playerId: string, shotId: number, fireSuperiorityShot: boolean): void {
    if (this.destroyed || !fireSuperiorityShot) return;
    const state = this.states.get(playerId);
    if (!state || state.pendingFireSuperiorityShotIds.has(shotId)) return;

    state.fireSuperiorityShotsAvailable = Math.max(0, state.fireSuperiorityShotsAvailable - 1);
    state.pendingFireSuperiorityShotIds.add(shotId);
  }

  registerProjectileHit(context: ProjectileAk47HitContext, nowMs: number): void {
    if (this.destroyed) return;
    const shotId = context.shotId;

    const focus = this.getAk47Config(context.ownerId)?.ak47Focus;
    if (!focus || this.getMaxStacks(focus) <= 0) return;

    const state = this.getOrCreateState(context.ownerId);
    if (state.confirmedShotIds.has(shotId)) return;
    state.confirmedShotIds.add(shotId);
    void nowMs;

    // Breakthrough ammunition does not start a second reward cycle while the magazine resolves.
    if (context.fireSuperiorityShot) return;

    const maxStacks = this.getMaxStacks(focus);
    state.stacks = Math.min(maxStacks, state.stacks + 1);
    if (
      state.stacks >= maxStacks
      && focus.fireSuperiorityShots > 0
      && !this.isFireSuperiorityPhaseActive(state)
    ) {
      const shotCount = Math.max(1, Math.round(focus.fireSuperiorityShots));
      state.fireSuperiorityShotsAvailable = shotCount;
      state.fireSuperiorityTotalShots = shotCount;
      state.stacks = maxStacks;
    }
  }

  resolveProjectile(outcome: ProjectileLifecycleOutcome): void {
    if (this.destroyed) return;
    if (outcome.kind !== 'resolved') return;
    const ak47 = outcome.reaction?.ak47;
    if (!ak47) return;
    const shotId = ak47.shotId;
    if (shotId === undefined) return;
    const state = this.states.get(outcome.provenance.allegiance.ownerId);
    if (!state) return;

    const didHit = ak47.hitConfirmed || state.confirmedShotIds.has(shotId);
    state.confirmedShotIds.delete(shotId);
    state.pendingFireSuperiorityShotIds.delete(shotId);
    if (ak47.fireSuperiorityShot && !this.isFireSuperiorityPhaseActive(state)) {
      state.fireSuperiorityTotalShots = 0;
      state.stacks = 0;
    } else if (!didHit && !this.isFireSuperiorityPhaseActive(state)) {
      state.stacks = 0;
    }
  }

  registerStrategicTargetHit(context: ProjectileAk47HitContext, enemyId: string): boolean {
    if (this.destroyed) return false;
    const shotId = context.shotId;
    if (!context.fireSuperiorityShot) return false;
    void enemyId;

    const state = this.states.get(context.ownerId);
    if (!state || !state.pendingFireSuperiorityShotIds.has(shotId)) return false;
    if (state.refundedShotIds.has(shotId)) return false;

    state.pendingFireSuperiorityShotIds.delete(shotId);
    state.fireSuperiorityShotsAvailable += 1;
    state.refundedShotIds.add(shotId);
    return true;
  }

  getHudBuffs(playerId: string, nowMs: number): readonly SyncedActiveHudBuff[] {
    if (this.destroyed) return [];
    const focus = this.getAk47Config(playerId)?.ak47Focus;
    const state = this.states.get(playerId);
    if (!focus || !state) return [];

    void nowMs;
    const result: SyncedActiveHudBuff[] = [];
    const maxStacks = this.getMaxStacks(focus);
    if (state.stacks > 0 && maxStacks > 0) {
      const damagePct = Math.round(state.stacks * focus.damagePerStack * 100);
      result.push({
        defId: 'AK47_FOCUS',
        remainingFrac: state.stacks / maxStacks,
        stacks: state.stacks,
        maxStacks,
        value: damagePct / 100,
      });
    }

    const pending = state.pendingFireSuperiorityShotIds.size;
    if (state.fireSuperiorityShotsAvailable > 0 || pending > 0) {
      result.push({
        defId: 'AK47_FIRE_SUPERIORITY',
        remainingFrac: (state.fireSuperiorityShotsAvailable + pending) / Math.max(1, state.fireSuperiorityTotalShots),
        availableCount: state.fireSuperiorityShotsAvailable,
        pendingCount: pending,
      });
    }
    return result;
  }

  isFireSuperiorityActive(playerId: string): boolean {
    return !this.destroyed
      && this.getAk47Config(playerId) !== null
      && this.isFireSuperiorityPhaseActive(this.states.get(playerId));
  }

  isFireSuperiorityAvailable(playerId: string): boolean {
    return !this.destroyed
      && this.getAk47Config(playerId) !== null
      && (this.states.get(playerId)?.fireSuperiorityShotsAvailable ?? 0) > 0;
  }

  isFocusAtMaxStacks(playerId: string): boolean {
    const focus = this.getAk47Config(playerId)?.ak47Focus;
    if (!focus || this.destroyed) return false;
    const maxStacks = this.getMaxStacks(focus);
    return maxStacks > 0 && (this.states.get(playerId)?.stacks ?? 0) >= maxStacks;
  }

  resetPlayer(playerId: string): void {
    if (this.destroyed) return;
    this.states.set(playerId, {
      stacks: 0,
      fireSuperiorityShotsAvailable: 0,
      fireSuperiorityTotalShots: 0,
      pendingFireSuperiorityShotIds: new Set<number>(),
      nextShotId: 1,
      confirmedShotIds: new Set<number>(),
      refundedShotIds: new Set<number>(),
    });
  }

  removePlayer(playerId: string): void {
    this.states.delete(playerId);
  }

  clear(): void {
    this.states.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear();
  }

  private getAk47Config(playerId: string): WeaponConfig | null {
    const config = this.loadout.getEquippedWeaponConfig(playerId, 'weapon2');
    return config?.id === 'AK47' ? config : null;
  }

  private getOrCreateState(playerId: string): Ak47CombatState {
    const current = this.states.get(playerId);
    if (current) return current;
    this.resetPlayer(playerId);
    return this.states.get(playerId)!;
  }

  private getMaxStacks(focus: NonNullable<WeaponConfig['ak47Focus']>): number {
    // Firepower and fire control share one hard cap. Fire control does not add another +5.
    return focus.maxStacks > 0 || focus.fireControlEnabled > 0 ? 5 : 0;
  }

  private isFireSuperiorityPhaseActive(state: Ak47CombatState | undefined): boolean {
    return !!state && (
      state.fireSuperiorityShotsAvailable > 0
      || state.pendingFireSuperiorityShotIds.size > 0
    );
  }
}
