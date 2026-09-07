import type {
  CombatBoundaryAttachment,
  CombatRelationshipReadPort,
  CombatTargetReadPort,
  WorldCombatRequiredBindings,
} from './CombatCapabilities';
import type { CombatScope, CombatTargetRef } from './CombatScope';
import { isSameCombatScope } from './CombatScope';
import type { CombatDamagePort, CombatSupportPort } from './CombatMutation';
import { freezeTargetMutationOutcome } from './CombatMutation';

export type WorldCombatRuntimePhase = 'building' | 'active' | 'detached' | 'destroyed';

/**
 * World-owned lifecycle boundary for Combat. Concrete gameplay stays behind required neutral
 * ports; this owner makes build/bind/activate and stale teardown enforceable.
 */
export class WorldCombatRuntime {
  readonly scope: CombatScope;
  /** Stable public capabilities; retained references fail closed after detach/destroy. */
  readonly damage: CombatDamagePort = {
    applyDamage: (request) => {
      if (!this.accepts(request.target)) return freezeTargetMutationOutcome({
        kind: 'rejected', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'stale-scope',
      });
      return this.requireBindings().damage.applyDamage(request);
    },
  };
  readonly support: CombatSupportPort = {
    applySupport: (request) => {
      if (!this.accepts(request.target)) return freezeTargetMutationOutcome({
        kind: 'rejected', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'stale-scope',
      });
      return this.requireBindings().support.applySupport(request);
    },
  };
  readonly targetRead: CombatTargetReadPort = {
    resolveTarget: (target) => this.accepts(target)
      ? this.requireBindings().targetRead.resolveTarget(target)
      : null,
  };
  readonly relationships: CombatRelationshipReadPort = {
    resolveRelationship: (source, target) => this.accepts(target)
      ? this.requireBindings().relationships.resolveRelationship(source, target)
      : { relationship: 'neutral', canDamage: false, canSupport: false },
  };

  private currentPhase: WorldCombatRuntimePhase = 'building';
  private bindings: WorldCombatRequiredBindings | null = null;
  private attachmentToken: symbol | null = null;

  constructor(worldRevision: number, runtimeGeneration: number) {
    if (!Number.isSafeInteger(worldRevision) || worldRevision <= 0) {
      throw new RangeError('Combat world revision must be a positive safe integer');
    }
    if (!Number.isSafeInteger(runtimeGeneration) || runtimeGeneration <= 0) {
      throw new RangeError('Combat runtime generation must be a positive safe integer');
    }
    this.scope = Object.freeze({ worldRevision, runtimeGeneration });
  }

  get phase(): WorldCombatRuntimePhase {
    return this.currentPhase;
  }

  /** Explicitly closes the composition cycle before activation. */
  attachRequiredBindings(bindings: WorldCombatRequiredBindings): CombatBoundaryAttachment {
    if (this.currentPhase !== 'building') {
      throw new Error(`[WorldCombatRuntime] Cannot attach bindings while ${this.currentPhase}`);
    }
    if (this.bindings) {
      throw new Error('[WorldCombatRuntime] Required bindings are already attached');
    }
    const token = Symbol('combat-binding');
    this.bindings = bindings;
    this.attachmentToken = token;
    return {
      detach: () => { this.detachBindings(token); },
    };
  }

  /** Missing required ports are a visible construction failure, never an active no-op runtime. */
  activate(): void {
    if (this.currentPhase === 'active') return;
    if (this.currentPhase !== 'building') {
      throw new Error(`[WorldCombatRuntime] Cannot activate while ${this.currentPhase}`);
    }
    if (!this.bindings) {
      throw new Error('[WorldCombatRuntime] Cannot activate before required bindings are attached');
    }
    assertRequiredBindings(this.bindings);
    this.currentPhase = 'active';
  }

  /** Entry adapters use this guard before accepting work for a retained scope or target. */
  accepts(scopeOrTarget: CombatScope | CombatTargetRef): boolean {
    const scope = 'scope' in scopeOrTarget ? scopeOrTarget.scope : scopeOrTarget;
    return this.currentPhase === 'active' && isSameCombatScope(this.scope, scope);
  }

  destroy(): void {
    if (this.currentPhase === 'destroyed') return;
    this.currentPhase = 'destroyed';
    this.bindings = null;
    this.attachmentToken = null;
  }

  private requireBindings(): WorldCombatRequiredBindings {
    if (this.currentPhase !== 'active' || !this.bindings) {
      throw new Error(`[WorldCombatRuntime] Combat ports are unavailable while ${this.currentPhase}`);
    }
    return this.bindings;
  }

  private detachBindings(token: symbol): void {
    if (token !== this.attachmentToken) return;
    if (this.currentPhase === 'destroyed' || this.currentPhase === 'detached') return;
    const wasActive = this.currentPhase === 'active';
    this.bindings = null;
    this.attachmentToken = null;
    if (wasActive) this.currentPhase = 'detached';
  }
}

function assertRequiredBindings(bindings: WorldCombatRequiredBindings): void {
  const required: readonly [string, unknown][] = [
    ['damage.applyDamage', bindings.damage?.applyDamage],
    ['support.applySupport', bindings.support?.applySupport],
    ['targetRead.resolveTarget', bindings.targetRead?.resolveTarget],
    ['relationships.resolveRelationship', bindings.relationships?.resolveRelationship],
    ['reactions.onAcceptedHit', bindings.reactions?.onAcceptedHit],
    ['reactions.onDamageApplied', bindings.reactions?.onDamageApplied],
    ['reactions.onTerminalTransition', bindings.reactions?.onTerminalTransition],
  ];
  const missing = required.filter(([, value]) => typeof value !== 'function').map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`[WorldCombatRuntime] Missing required bindings: ${missing.join(', ')}`);
  }
}
