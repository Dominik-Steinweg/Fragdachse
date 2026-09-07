import type {
  CombatDamageMutationOutcome,
  CombatTerminalFacts,
  CombatantVitalsSnapshot,
  CombatSupportMutationOutcome,
  TargetDamageMutationRequest,
  TargetSupportMutationRequest,
} from './CombatMutation';
import { freezeTargetMutationOutcome } from './CombatMutation';
import type { CombatScope, CombatTargetRef } from './CombatScope';
import { isSameCombatScope, isSameCombatTargetInstance } from './CombatScope';
import type {
  CombatVitalsReadPort,
  PlayerCombatLifePort,
  PlayerRespawnCommitPort,
} from './CombatCapabilities';

interface PlayerVitalsRecord {
  readonly playerId: string;
  readonly entityGeneration: number;
  lifeRevision: number;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  alive: boolean;
}

export interface PlayerVitalsOwnerOptions {
  readonly resolveMaxHp: (playerId: string) => number;
  readonly resolveMaxArmor: (playerId: string) => number;
  readonly captureTerminalFacts: (target: CombatTargetRef) => CombatTerminalFacts;
}

/** Phaser-free canonical writer for one World's Player combatant state. */
export class PlayerVitalsOwner implements
  CombatVitalsReadPort,
  PlayerCombatLifePort,
  PlayerRespawnCommitPort {
  private readonly records = new Map<string, PlayerVitalsRecord>();
  private readonly nextEntityGeneration = new Map<string, number>();
  private active = true;

  constructor(
    readonly scope: CombatScope,
    private readonly options: PlayerVitalsOwnerOptions,
  ) {}

  attachPlayer(request: { readonly playerId: string; readonly entityGeneration: number }): void {
    if (!this.active) throw new Error('[PlayerVitalsOwner] Cannot attach after World teardown');
    if (!Number.isSafeInteger(request.entityGeneration) || request.entityGeneration <= 0) {
      throw new RangeError('Player entity generation must be a positive safe integer');
    }
    if (this.records.has(request.playerId)) {
      throw new Error(`[PlayerVitalsOwner] Player ${request.playerId} is already attached`);
    }
    const maxHp = this.resolveMaxHp(request.playerId);
    this.records.set(request.playerId, {
      playerId: request.playerId,
      entityGeneration: request.entityGeneration,
      lifeRevision: 0,
      hp: 0,
      maxHp,
      armor: 0,
      maxArmor: this.resolveMaxArmor(request.playerId),
      alive: false,
    });
    this.nextEntityGeneration.set(
      request.playerId,
      Math.max(this.nextEntityGeneration.get(request.playerId) ?? 1, request.entityGeneration + 1),
    );
  }

  attachAndBeginInitialLife(playerId: string): CombatTargetRef {
    const entityGeneration = this.nextEntityGeneration.get(playerId) ?? 1;
    this.attachPlayer({ playerId, entityGeneration });
    return this.beginLife({ playerId, entityGeneration, lifeRevision: 1 });
  }

  beginLife(request: {
    readonly playerId: string;
    readonly entityGeneration: number;
    readonly lifeRevision: number;
  }): CombatTargetRef {
    const record = this.records.get(request.playerId);
    if (!record || record.entityGeneration !== request.entityGeneration) {
      throw new Error(`[PlayerVitalsOwner] Player ${request.playerId} is not attached to this instance`);
    }
    if (record.alive) {
      throw new Error(`[PlayerVitalsOwner] Player ${request.playerId} already has an active life`);
    }
    if (!Number.isSafeInteger(request.lifeRevision) || request.lifeRevision <= record.lifeRevision) {
      throw new RangeError('Player life revision must advance monotonically');
    }
    record.lifeRevision = request.lifeRevision;
    record.maxHp = this.resolveMaxHp(request.playerId);
    record.maxArmor = this.resolveMaxArmor(request.playerId);
    record.hp = record.maxHp;
    record.armor = 0;
    record.alive = true;
    return this.targetFor(record);
  }

  commitRespawn(playerId: string, previousLifeRevision: number): CombatTargetRef | null {
    if (!this.active) return null;
    const record = this.records.get(playerId);
    if (!record || record.alive || record.lifeRevision !== previousLifeRevision) return null;
    return this.beginLife({
      playerId,
      entityGeneration: record.entityGeneration,
      lifeRevision: previousLifeRevision + 1,
    });
  }

  endLife(target: CombatTargetRef): void {
    const record = this.resolveRecord(target);
    if (!record || !record.alive) return;
    record.hp = 0;
    record.armor = 0;
    record.alive = false;
  }

  endCurrentLife(playerId: string): CombatTargetRef | null {
    const target = this.getTargetRef(playerId);
    if (!target) return null;
    this.endLife(target);
    return target;
  }

  detachPlayer(playerId: string, entityGeneration: number): void {
    const record = this.records.get(playerId);
    if (!record || record.entityGeneration !== entityGeneration) return;
    this.records.delete(playerId);
  }

  detachCurrentPlayer(playerId: string): void {
    const record = this.records.get(playerId);
    if (record) this.detachPlayer(playerId, record.entityGeneration);
  }

  hasAttachedPlayers(): boolean {
    return this.records.size > 0;
  }

  destroy(): void {
    if (!this.active) return;
    this.active = false;
    this.records.clear();
  }

  getTargetRef(playerId: string): CombatTargetRef | null {
    const record = this.records.get(playerId);
    return record ? this.targetFor(record) : null;
  }

  readVitals(target: CombatTargetRef): CombatantVitalsSnapshot | null {
    const record = this.resolveRecord(target);
    return record ? this.snapshot(record) : null;
  }

  readCurrent(playerId: string): CombatantVitalsSnapshot | null {
    const record = this.records.get(playerId);
    return record ? this.snapshot(record) : null;
  }

  commitDamage(request: TargetDamageMutationRequest): CombatDamageMutationOutcome {
    const rejected = this.validateTarget(request);
    if (rejected) return rejected;
    const record = this.records.get(String(request.target.id))!;
    const amount = request.damage.amount;
    if (!Number.isFinite(amount) || amount < 0) {
      return freezeTargetMutationOutcome({
        kind: 'rejected', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'invalid-value',
      });
    }
    if (amount === 0) {
      return freezeTargetMutationOutcome({
        kind: 'accepted-no-effect', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'zero-effect', resultingState: this.snapshot(record),
      });
    }

    const armorLost = Math.min(record.armor, amount);
    const hpLost = Math.min(record.hp, Math.max(0, amount - armorLost));
    record.armor -= armorLost;
    record.hp -= hpLost;
    if (record.hp === 0) record.alive = false;
    const base = {
      kind: 'damage-applied' as const,
      outcomeId: request.outcomeId,
      target: request.target,
      source: request.source,
      damage: request.damage,
      actualDamage: armorLost + hpLost,
      hpLost,
      armorLost,
      integrityLost: 0,
      resultingState: this.snapshot(record),
    };
    return record.alive
      ? freezeTargetMutationOutcome({ ...base, transition: { kind: 'none' }, rescueHealing: 0 })
      : freezeTargetMutationOutcome({
        ...base,
        transition: { kind: 'dead', facts: this.options.captureTerminalFacts(request.target) },
      });
  }

  commitSupport(request: TargetSupportMutationRequest): CombatSupportMutationOutcome {
    const rejected = this.validateTarget(request);
    if (rejected) return rejected;
    const record = this.records.get(String(request.target.id))!;
    if (!Number.isFinite(request.amount) || request.amount < 0) {
      return freezeTargetMutationOutcome({
        kind: 'rejected', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'invalid-value',
      });
    }
    if (request.supportKind === 'repair') {
      return freezeTargetMutationOutcome({
        kind: 'rejected', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'not-eligible',
      });
    }
    const beforeHp = record.hp;
    const beforeArmor = record.armor;
    record.maxHp = this.resolveMaxHp(record.playerId);
    record.maxArmor = this.resolveMaxArmor(record.playerId);
    if (request.supportKind === 'cap-adjustment') {
      record.hp = Math.min(record.hp, record.maxHp);
      record.armor = Math.min(record.armor, record.maxArmor);
    } else if (request.supportKind === 'heal' || request.supportKind === 'hp-regeneration') {
      record.hp = Math.min(record.maxHp, record.hp + request.amount);
    } else if (request.supportKind === 'armor' || request.supportKind === 'armor-regeneration') {
      record.armor = Math.min(record.maxArmor, record.armor + request.amount);
    } else if (request.supportKind === 'armor-loss') {
      record.armor = Math.max(0, record.armor - request.amount);
    }
    const actualAmount = request.supportKind === 'armor-loss'
      ? beforeArmor - record.armor
      : Math.max(record.hp - beforeHp, record.armor - beforeArmor, 0);
    if (actualAmount === 0) {
      return freezeTargetMutationOutcome({
        kind: 'accepted-no-effect', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'zero-effect', resultingState: this.snapshot(record),
      });
    }
    return freezeTargetMutationOutcome({
      kind: 'support-applied', outcomeId: request.outcomeId, target: request.target,
      source: request.source, supportKind: request.supportKind, actualAmount,
      resultingState: this.snapshot(record), revived: false,
    });
  }

  private validateTarget(request: TargetDamageMutationRequest | TargetSupportMutationRequest) {
    if (!this.active) {
      return freezeTargetMutationOutcome({
        kind: 'rejected' as const, outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'stale-scope' as const,
      });
    }
    if (!isSameCombatScope(request.target.scope, this.scope)) {
      return freezeTargetMutationOutcome({
        kind: 'rejected' as const, outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'stale-scope' as const,
      });
    }
    const record = request.target.kind === 'player'
      ? this.records.get(request.target.id)
      : undefined;
    if (!record) {
      return freezeTargetMutationOutcome({
        kind: 'rejected' as const, outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'target-missing' as const,
      });
    }
    if (!isSameCombatTargetInstance(request.target, this.targetFor(record))) {
      return freezeTargetMutationOutcome({
        kind: 'rejected' as const, outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'stale-target' as const,
      });
    }
    if (!record.alive) {
      return freezeTargetMutationOutcome({
        kind: 'rejected' as const, outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'target-dead' as const,
      });
    }
    return null;
  }

  private resolveRecord(target: CombatTargetRef): PlayerVitalsRecord | null {
    if (!this.active || !isSameCombatScope(target.scope, this.scope) || target.kind !== 'player') return null;
    const record = this.records.get(target.id);
    return record && isSameCombatTargetInstance(target, this.targetFor(record)) ? record : null;
  }

  private targetFor(record: PlayerVitalsRecord): CombatTargetRef {
    return Object.freeze({
      kind: 'player' as const,
      id: record.playerId,
      scope: this.scope,
      instance: Object.freeze({
        entityGeneration: record.entityGeneration,
        lifeRevision: record.lifeRevision,
      }),
    });
  }

  private snapshot(record: PlayerVitalsRecord): CombatantVitalsSnapshot {
    return Object.freeze({
      kind: 'combatant' as const,
      hp: record.hp,
      maxHp: record.maxHp,
      armor: record.armor,
      maxArmor: record.maxArmor,
      alive: record.alive,
    });
  }

  private resolveMaxHp(playerId: string): number {
    const value = this.options.resolveMaxHp(playerId);
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
  }

  private resolveMaxArmor(playerId: string): number {
    const value = this.options.resolveMaxArmor(playerId);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }
}
