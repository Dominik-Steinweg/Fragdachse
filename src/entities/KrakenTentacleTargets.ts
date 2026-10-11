import type { BossTargetRef, CombatPartContactReadPort, CombatPartContactSnapshot, CombatPartIdentity, CombatPartStatusPort } from '../combat/CombatPartContact';
import { isSameCombatTargetInstance } from '../combat/CombatScope';
import type { KrakenBossConfig } from '../config/krakenBoss';
import type { KrakenTentacleState } from '../systems/KrakenState';

/** Activity-owned physical contacts. HP and damage commits belong exclusively to the boss. */
export class KrakenTentacleTargets implements CombatPartContactReadPort, CombatPartStatusPort {
  private readonly parts = new Map<string, KrakenTentacleState>();
  private readonly disabled = new Set<string>();

  constructor(private readonly profiles: KrakenBossConfig['hitboxProfiles'],
    private readonly isBossAlive: (boss: BossTargetRef) => boolean,
    private readonly onStatus: (identity: CombatPartIdentity, status: 'stun' | 'slow' | 'burn', untilMs: number) => boolean,
    private readonly now: () => number) {}

  sync(parts: readonly KrakenTentacleState[]): void {
    this.parts.clear();
    for (const part of parts) this.parts.set(part.contact.contactId, structuredClone(part));
    for (const id of this.disabled) if (!this.parts.has(id)) this.disabled.delete(id);
  }

  invalidate(contactId: string): void { this.disabled.add(contactId); }
  clear(): void { this.parts.clear(); this.disabled.clear(); }

  getContacts(nowMs: number): readonly CombatPartContactSnapshot[] {
    return [...this.parts.values()].flatMap(part => {
      const snapshot = this.snapshot(part, nowMs);
      return snapshot ? [snapshot] : [];
    });
  }

  resolveContact(identity: CombatPartIdentity, contactId: string, nowMs: number): CombatPartContactSnapshot | null {
    const part = this.parts.get(contactId), current = part?.contact.identity;
    if (!part || !current || !isSameCombatTargetInstance(identity.boss, current.boss)
      || identity.partId !== current.partId || identity.partGeneration !== current.partGeneration
      || identity.cycleId !== current.cycleId) return null;
    return this.snapshot(part, nowMs);
  }

  applyPartStatus(identity: CombatPartIdentity, status: 'stun' | 'slow' | 'burn', untilMs: number): boolean {
    const now = this.now();
    if (!Number.isFinite(untilMs) || untilMs <= now) return false;
    const part = [...this.parts.values()].find(p => p.contact.identity.partId === identity.partId);
    if (!part || !this.resolveContact(identity, part.contact.contactId, now)) return false;
    return this.onStatus(identity, status, untilMs);
  }

  private snapshot(part: KrakenTentacleState, now: number): CombatPartContactSnapshot | null {
    const c = part.contact;
    if (this.disabled.has(c.contactId) || !this.isBossAlive(c.identity.boss) || now < c.targetableFrom || now >= c.targetableUntil) return null;
    const profile = this.profiles.find(p => p.id === c.hitboxProfileId);
    if (!profile) return null;
    const phase = part.phase === 'retract' || now >= part.retractAt ? 'retract'
      : now >= (part.claw.attack?.strikeAt ?? Infinity) ? 'slam' : now >= part.hoverAt ? 'hover' : 'rise';
    return { contact: structuredClone(c), shapes: structuredClone(profile[phase]) };
  }
}
