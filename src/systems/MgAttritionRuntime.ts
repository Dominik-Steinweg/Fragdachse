import { combatTargetInstanceKey, type CombatTargetRef } from '../combat/CombatScope';
import type { MgTurretStats } from '../config/mgTurret';
import { MG_TURRET_RULES } from '../config/mgTurretRules';

export interface MgOwner {
  readonly id: string;
  readonly group: string;
  readonly stats: MgTurretStats;
}
export interface MgTarget {
  readonly ref: CombatTargetRef;
  readonly x: number;
  readonly y: number;
}
export interface MgVisualTarget {
  readonly target: CombatTargetRef;
  readonly expiresAt: number;
  readonly bleedUntil: number;
}
export interface MgTransfer {
  readonly sequence: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly createdAt: number;
}
export interface MgAttritionSnapshot {
  readonly targets: readonly MgVisualTarget[];
  readonly transfers: readonly MgTransfer[];
  readonly transferSequence: number;
}
export const emptyMgAttritionSnapshot = (): MgAttritionSnapshot => ({ targets: [], transfers: [], transferSequence: 0 });

interface Value { percent: number; expiresAt: number }
interface PersonalValue extends Value { ownerId: string }
interface NetworkValue extends Value {
  integratedAt: number;
  nextTickAt: number;
  pendingDamage: number;
}
interface TargetState {
  target: MgTarget;
  readonly personal: Map<string, PersonalValue>;
  readonly networks: Map<string, NetworkValue>;
}
interface NetworkRules {
  maximum: number;
  bleed: number;
  bleedOwner: string;
  transfer: number;
  representative: string;
}
export interface MgAttritionPorts {
  readonly targets: () => readonly MgTarget[];
  readonly canAffect: (ownerId: string, target: MgTarget) => boolean;
  /** Returns the unobstructed recipient contact point within the authored radius. */
  readonly transferContact: (from: MgTarget, to: MgTarget, radius: number) => { x: number; y: number; fromX?: number; fromY?: number } | null;
  readonly bleed: (target: CombatTargetRef, amount: number, ownerId: string, at: number) => void;
}

/** World-owned, renderer-free authority. Reads never mutate or advance combat. */
export class MgAttritionRuntime {
  private owners = new Map<string, MgOwner>();
  private networks = new Map<string, NetworkRules>();
  private readonly states = new Map<string, TargetState>();
  private transfers: MgTransfer[] = [];
  private transferSequence = 0;
  private generation = 0;
  private advancing = false;

  constructor(private readonly ports: MgAttritionPorts) {}

  setOwners(owners: readonly MgOwner[], now: number): void {
    // Settle time under the old rules before changing rates, attribution or membership.
    const generation = this.generation;
    this.settle(now);
    if (generation !== this.generation) return;
    const previous = this.owners;
    this.owners = new Map(owners.map(owner => [owner.id, owner]));
    const networks = new Map<string, NetworkRules>();
    for (const owner of [...owners].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!owner.stats.network) continue;
      const rules = networks.get(owner.group) ?? { maximum: 0, bleed: 0, bleedOwner: owner.id, transfer: 0, representative: owner.id };
      rules.maximum = Math.max(rules.maximum, owner.stats.maximumPercent);
      if (owner.stats.bleedLevel > rules.bleed) {
        rules.bleed = owner.stats.bleedLevel;
        rules.bleedOwner = owner.id;
      }
      rules.transfer = Math.max(rules.transfer, owner.stats.transferFraction);
      networks.set(owner.group, rules);
    }
    this.networks = networks;
    for (const [key, state] of this.states) {
      for (const [turret, value] of state.personal) {
        const owner = this.owners.get(value.ownerId);
        if (!owner || owner.stats.perHitPercent <= 0 || value.expiresAt <= now) {
          state.personal.delete(turret); continue;
        }
        if (owner.stats.network) {
          const old = state.networks.get(owner.group);
          if (!old || value.percent > old.percent || (value.percent === old.percent && value.expiresAt > old.expiresAt)) {
            state.networks.set(owner.group, this.networkValue(value.percent, value.expiresAt, now, old));
          }
          state.personal.delete(turret);
        } else value.percent = Math.min(value.percent, owner.stats.maximumPercent);
      }
      for (const [group, value] of state.networks) {
        const rules = networks.get(group);
        if (!rules) { state.networks.delete(group); continue; }
        // A changed BL1 contributor owns only future damage, never previously accrued damage.
        value.percent = Math.min(value.percent, rules.maximum);
      }
      // Leaving a network does not copy shared progress into fresh personal turrets.
      for (const owner of owners) {
        const old = previous.get(owner.id);
        if (old?.stats.network && (!owner.stats.network || old.group !== owner.group)) {
          for (const [turret, value] of state.personal) if (value.ownerId === owner.id) state.personal.delete(turret);
        }
      }
      if (!state.personal.size && !state.networks.size) this.states.delete(key);
    }
  }

  getPercent(ownerId: string, turretId: string, target: CombatTargetRef, now: number): number {
    const owner = this.owners.get(ownerId);
    const state = this.states.get(combatTargetInstanceKey(target));
    if (!owner || !state) return 0;
    const value = owner.stats.network ? state.networks.get(owner.group) : state.personal.get(turretId);
    return value && value.expiresAt > now && (!('ownerId' in value) || value.ownerId === ownerId) ? value.percent : 0;
  }

  /** Called only after a positive, direct personal-MG damage receipt, including lethal hits. */
  hit(ownerId: string, turretId: string, target: MgTarget, now: number): void {
    const owner = this.owners.get(ownerId);
    if (!owner || owner.stats.perHitPercent <= 0) return;
    const state = this.state(target);
    if (owner.stats.network) {
      const rules = this.networks.get(owner.group);
      if (!rules) return;
      this.addNetwork(state, owner.group, owner.stats.perHitPercent, rules.maximum, now);
    } else {
      const old = state.personal.get(turretId);
      state.personal.set(turretId, { ownerId, percent: Math.min(owner.stats.maximumPercent,
        (old && old.expiresAt > now ? old.percent : 0) + owner.stats.perHitPercent),
      expiresAt: now + MG_TURRET_RULES.durationMs });
    }
  }

  /** Consumes before delivery: any reentrant or duplicate death cannot transfer twice. */
  death(target: MgTarget, now: number): void {
    const key = combatTargetInstanceKey(target.ref);
    const state = this.states.get(key);
    if (!state) return;
    this.states.delete(key);
    const targets = [...this.ports.targets()].sort((a, b) => combatTargetInstanceKey(a.ref).localeCompare(combatTargetInstanceKey(b.ref)));
    for (const [group, value] of state.networks) {
      const rules = this.networks.get(group);
      if (!rules || rules.transfer <= 0 || value.expiresAt <= now) continue;
      for (const recipient of targets) {
        if (combatTargetInstanceKey(recipient.ref) === key || !this.ports.canAffect(rules.representative, recipient)) continue;
        const contact = this.ports.transferContact(target, recipient, MG_TURRET_RULES.transferRadius);
        if (!contact) continue;
        this.addNetwork(this.state(recipient), group, value.percent * rules.transfer, rules.maximum, now);
        this.transfers.push({ sequence: ++this.transferSequence, fromX: contact.fromX ?? target.x, fromY: contact.fromY ?? target.y,
          toX: contact.x, toY: contact.y, createdAt: now });
      }
    }
  }

  advance(now: number): void {
    if (this.advancing) return;
    this.advancing = true;
    const generation = this.generation;
    try {
      const live = new Map(this.ports.targets().map(target => [combatTargetInstanceKey(target.ref), target]));
      for (const [key, state] of this.states) {
        const target = live.get(key);
        if (!target) { this.states.delete(key); continue; }
        state.target = target;
        for (const [turret, value] of state.personal) if (value.expiresAt <= now) state.personal.delete(turret);
      }
      // Chronological dispatch also includes values created by a death during this advance.
      // Processing an entire target up to `now` first would overcharge later chain recipients.
      while (this.generation === generation) {
        let earliest = Infinity;
        let batch: { key: string; state: TargetState; group: string; value: NetworkValue; order: string }[] = [];
        for (const [key, state] of this.states) for (const [group, value] of state.networks) {
          const at = Math.min(value.nextTickAt, value.expiresAt);
          if (at > now || at > earliest) continue;
          if (at < earliest) { earliest = at; batch = []; }
          batch.push({ key, state, group, value, order: `${key}/${group}` });
        }
        if (!batch.length) break;
        batch.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
        for (const { key, state, group, value } of batch) {
          if (this.generation !== generation) break;
          if (this.states.get(key) !== state || state.networks.get(group) !== value
            || Math.min(value.nextTickAt, value.expiresAt) !== earliest) continue;
          const rules = this.networks.get(group);
          if (!rules) { state.networks.delete(group); continue; }
          this.integrate(value, rules, earliest);
          if (value.nextTickAt <= earliest) value.nextTickAt += MG_TURRET_RULES.bleedTickMs;
          this.flush(state, value, rules, earliest);
          if (this.states.get(key) === state && state.networks.get(group) === value && value.expiresAt <= earliest) state.networks.delete(group);
        }
      }
      for (const [key, state] of this.states) {
        for (const [group, value] of state.networks) {
          const rules = this.networks.get(group);
          if (rules) this.integrate(value, rules, Math.min(now, value.expiresAt));
        }
        if (!state.personal.size && !state.networks.size) this.states.delete(key);
      }
      this.transfers = this.transfers.filter(event => now - event.createdAt < 500);
    } finally { this.advancing = false; }
  }

  /** Rate/membership changes settle fractional damage without resetting the regular tick clock. */
  settle(now: number): void {
    this.advance(now);
    const generation = this.generation;
    for (const [key, state] of [...this.states]) for (const [group, value] of [...state.networks]) {
      if (this.generation !== generation) return;
      if (this.states.get(key) !== state || state.networks.get(group) !== value) continue;
      const rules = this.networks.get(group);
      if (rules) this.flush(state, value, rules, now);
    }
  }

  snapshot(now: number): MgAttritionSnapshot {
    const targets: MgVisualTarget[] = [];
    for (const state of this.states.values()) {
      let expiresAt = 0, bleedUntil = 0;
      for (const value of state.personal.values()) expiresAt = Math.max(expiresAt, value.expiresAt);
      for (const [group, value] of state.networks) {
        expiresAt = Math.max(expiresAt, value.expiresAt);
        if ((this.networks.get(group)?.bleed ?? 0) > 0 && value.percent > 0) bleedUntil = Math.max(bleedUntil, value.expiresAt);
      }
      if (expiresAt > now) targets.push({ target: state.target.ref, expiresAt, bleedUntil });
    }
    return { targets, transfers: this.transfers.filter(event => now - event.createdAt < 500), transferSequence: this.transferSequence };
  }

  clear(): void {
    this.generation++;
    this.states.clear(); this.owners.clear(); this.networks.clear(); this.transfers = [];
    // Keep the cursor monotone across Activity resets within the same World.
  }

  private state(target: MgTarget): TargetState {
    const key = combatTargetInstanceKey(target.ref);
    let state = this.states.get(key);
    if (!state) { state = { target, personal: new Map(), networks: new Map() }; this.states.set(key, state); }
    state.target = target;
    return state;
  }
  private networkValue(percent: number, expiresAt: number, now: number, old?: NetworkValue): NetworkValue {
    return { percent, expiresAt, integratedAt: now,
      nextTickAt: old && old.expiresAt > now ? old.nextTickAt : now + MG_TURRET_RULES.bleedTickMs,
      pendingDamage: old?.pendingDamage ?? 0 };
  }
  private addNetwork(state: TargetState, group: string, increment: number, maximum: number, now: number): void {
    if (increment <= 0) return;
    const old = state.networks.get(group);
    const rules = this.networks.get(group)!;
    if (old) this.integrate(old, rules, Math.min(now, old.expiresAt));
    const active = old && old.expiresAt > now ? old : undefined;
    if (active) {
      active.percent = Math.min(maximum, active.percent + increment);
      active.expiresAt = now + MG_TURRET_RULES.durationMs;
      return;
    }
    state.networks.set(group, this.networkValue(Math.min(maximum, increment), now + MG_TURRET_RULES.durationMs, now));
  }
  private integrate(value: NetworkValue, rules: NetworkRules, until: number): void {
    if (until <= value.integratedAt) return;
    value.pendingDamage += (until - value.integratedAt) / 1000 * value.percent / 100 * rules.bleed;
    value.integratedAt = until;
  }
  private flush(state: TargetState, value: NetworkValue, rules: NetworkRules, at: number): void {
    const amount = value.pendingDamage;
    value.pendingDamage = 0;
    if (amount > 0) this.ports.bleed(state.target.ref, amount, rules.bleedOwner, at);
  }
}
