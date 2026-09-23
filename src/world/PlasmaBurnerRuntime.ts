import { portalDamageMultiplier } from '../systems/PortalTraversal';
import type { PlasmaBurnerCombatPort } from '../combat/CombatCapabilities';
import type { PlasmaBurnerFireRequest, PlasmaBurnerOverloadNetState } from '../combat/plasmaBurner/PlasmaBurnerContracts';
import * as Overload from '../combat/plasmaBurner/PlasmaBurnerOverload';
import { accumulatePlasmaBurnerCharges } from '../combat/plasmaBurner/PlasmaBurnerChargeAccumulator';
import { resolvePlasmaBurnerStats, type PlasmaBurnerStats } from '../loadout/PlasmaBurnerConfig';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';
import { createSingleOwnerProvenance } from '../projectile/ProjectileSpawnRequest';

interface BurnerState {
  overload: Overload.PlasmaBurnerOverloadState;
  gesture: { lastAcceptedPulseMs: number; chainMemberKeys: string[]; lock: string | null; slotProgress: number[] };
  stats: PlasmaBurnerStats; intervalMs: number; spawnSequence: number;
}

/** Host-only World owner. Contact mutations are delegated to Combat; projectiles have their own lifetime. */
export class PlasmaBurnerRuntime {
  private readonly players = new Map<string, BurnerState>();
  private destroyed = false;
  constructor(private readonly combat: PlasmaBurnerCombatPort, private readonly projectiles: ProjectileSpawnPort) {}

  firePulse(req: PlasmaBurnerFireRequest): boolean {
    if (this.destroyed || !req.config.plasmaBurner || !Number.isFinite(req.nowMs)) return false;
    const stats = resolvePlasmaBurnerStats(req.config.plasmaBurner);
    let state = this.players.get(req.playerId);
    if (!state) {
      state = { overload: { q: 0, coverageEndMs: req.nowMs, decayedUntilMs: req.nowMs },
        gesture: { lastAcceptedPulseMs: -Infinity, chainMemberKeys: [], lock: null, slotProgress: [] },
        stats, intervalMs: req.config.cooldown, spawnSequence: 0 };
      this.players.set(req.playerId, state);
    }
    if (req.nowMs - state.gesture.lastAcceptedPulseMs < req.config.cooldown) return false;
    this.advancePlayer(state, req.nowMs);
    state.stats = stats; state.intervalMs = req.config.cooldown;
    const m = stats.overloadEnabled ? Overload.multiplier(state.overload) : 1;
    const outcome = this.combat.resolvePlasmaBurnerPulse({ ...req, stats, multiplier: m,
      chainMemberKeys: state.gesture.chainMemberKeys, lock: state.gesture.lock });
    if (!outcome.accepted || this.players.get(req.playerId) !== state) return outcome.accepted;
    state.gesture.lastAcceptedPulseMs = req.nowMs;
    state.gesture.chainMemberKeys = [...outcome.chainMemberKeys]; state.gesture.lock = outcome.lock;
    const effective = outcome.contacts.map(c => c.effectiveAmount > 0 && c.target.category !== 'environment');
    const weight = effective.reduce((sum, yes, i) => sum + (yes ? i === 0 ? 1 : stats.secondaryOverloadWeight : 0), 0);
    Overload.creditPulse(state.overload, req.nowMs, state.intervalMs, weight, stats);
    for (const slot of accumulatePlasmaBurnerCharges(state.gesture.slotProgress, effective, state.intervalMs, m, stats.chargeIntervalSeconds)) {
      const contact = outcome.contacts[slot];
      const factor = slot === 0 ? 1 : stats.secondaryFactor;
      const outward = Math.atan2(contact.target.y - req.y, contact.target.x - req.x) + Math.PI;
      const offset = ((state.spawnSequence++ % 5) - 2) * 18 * Math.PI / 180;
      this.projectiles.spawnProjectile({
        origin: { x: contact.target.x, y: contact.target.y, angle: outward + offset },
        flight: { speed: stats.chargeSpeed, size: stats.size, lifetimeMs: stats.chargeLifetimeMs, maxBounces: 0, isGrenade: false,
          collisionFilter: contact.target.kind === 'base' ? { sourceCarrierBaseId: contact.target.id } : undefined,
          homing: { targetPolicy: 'plasma_burner', maxTurnDegreesPerSecond: stats.chargeTurnDegreesPerSecond,
            maxTurnDegreesPerStep: 0, searchRadius: stats.chargeSearchRadius, acquireDelayMs: stats.outboundMs,
            retargetIntervalMs: 100, requireLineOfSight: true, excludeOwner: false, distanceWeight: 1, forwardWeight: 0,
            targetTypes: ['players', 'enemies', 'decoys', 'constructions', 'bases'] } },
        provenance: { ...createSingleOwnerProvenance(req.playerId, { weaponSourceId: req.config.id, sourceSlot: req.sourceSlot,
          lineage: { originTarget: { kind: contact.target.kind, id: contact.target.id } } }), portalDamage: contact.portalDamage },
        interaction: { support: { plasmaBurnerCharge: { damage: stats.chargeDamage * factor * portalDamageMultiplier(contact.portalDamage),
          heal: stats.chargeHeal * factor, sourceSlot: slot } } },
        presentation: { style: 'plasma_burner_charge', color: req.config.fire.type === 'hitscan' ? req.config.fire.supportEffect?.beamColor ?? 0x5cf58f : 0x5cf58f },
      });
    }
    return true;
  }

  update(now: number): void { if (!this.destroyed) for (const state of this.players.values()) this.advancePlayer(state, now); }
  private advancePlayer(state: BurnerState, now: number): void {
    Overload.advance(state.overload, now, state.stats);
    if (now > state.gesture.lastAcceptedPulseMs + state.intervalMs + state.stats.contactToleranceMs) {
      state.gesture.chainMemberKeys = []; state.gesture.lock = null; state.gesture.slotProgress = [];
    }
  }
  getState(id: string): PlasmaBurnerOverloadNetState | undefined {
    const state = this.players.get(id);
    return state?.stats.overloadEnabled ? { q: state.overload.q, qMax: state.stats.qMax,
      building: state.overload.coverageEndMs > state.overload.decayedUntilMs } : undefined;
  }
  endGesture(id: string, nowMs?: number): void {
    const state = this.players.get(id);
    if (state) {
      if (nowMs !== undefined) { Overload.advance(state.overload, nowMs, state.stats); Overload.creditPulse(state.overload, nowMs, state.intervalMs, 0, state.stats); }
      state.gesture.chainMemberKeys = []; state.gesture.lock = null; state.gesture.slotProgress = []; }
  }
  resetPlayer(id: string): void { this.players.delete(id); }
  clearAll(): void { this.players.clear(); }
  destroy(): void { this.destroyed = true; this.clearAll(); }
}
