import type {
  CoopDefenseMapEncounterStart,
  ResolvedCoopDefenseMapSecondaryObjectiveConfig,
} from '../config/coopDefenseMaps';
import type {
  CoopDefenseSecondaryObjectivePresentationState,
  CoopDefenseSecondaryObjectiveState,
} from '../types';

export interface CoopDefenseSecondaryObjectiveSystemOptions {
  /** Liefert ausschließlich den semantischen Clear-Zustand des Encounter-Owners. */
  readonly isEncounterCleared?: (encounterId: string) => boolean;
}

interface SecondaryObjectiveRuntimeState {
  readonly config: ResolvedCoopDefenseMapSecondaryObjectiveConfig;
  readonly resolvedTargetIds: Set<string>;
  state: CoopDefenseSecondaryObjectiveState;
  stateChangedAtMs: number;
}

/**
 * Host-autoritatives Fundament für optionale Coop-Defense-Nebenmissionen.
 *
 * Das System kennt weder Basen noch den Encounter-Director. Es verwaltet nur den authored
 * Lebenszyklus und liest semantische Trigger über schmale Callbacks; die späteren Archetypen
 * melden ihre Weltauflösung über reportTargetResolved().
 */
export class CoopDefenseSecondaryObjectiveSystem {
  private elapsedMs = 0;
  private activeObjectiveIndex: number | null = null;
  private presentationObjectiveIndex: number | null = null;
  private readonly isEncounterCleared: ((encounterId: string) => boolean) | null;
  private readonly objectiveStates: SecondaryObjectiveRuntimeState[];

  constructor(
    objectives: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
    options: CoopDefenseSecondaryObjectiveSystemOptions = {},
  ) {
    this.isEncounterCleared = options.isEncounterCleared ?? null;
    this.objectiveStates = objectives.map((config) => ({
      config,
      resolvedTargetIds: new Set<string>(),
      state: 'dormant',
      stateChangedAtMs: 0,
    }));
  }

  /** Countdown-Zeit gehört wie beim MapDirector nicht zur authored Rundenzeit. */
  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive) return;
    this.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;

    // Ein bereits aktives Objective behält den Slot bis zu seinem Abschluss. Wird es in diesem
    // Frame resolved, darf ein gleichzeitig triggerfähiges Objective erst im nächsten Frame folgen.
    if (this.activeObjectiveIndex !== null) {
      this.updateActiveObjective(this.activeObjectiveIndex);
      return;
    }

    for (let index = 0; index < this.objectiveStates.length; index += 1) {
      const state = this.objectiveStates[index];
      if (state.state !== 'dormant' || !this.isTriggerSatisfied(state.config.start)) continue;
      this.activateObjective(index);
      this.updateActiveObjective(index);
      return;
    }
  }

  reset(): void {
    this.elapsedMs = 0;
    this.activeObjectiveIndex = null;
    this.presentationObjectiveIndex = null;
    for (const state of this.objectiveStates) {
      state.resolvedTargetIds.clear();
      state.state = 'dormant';
      state.stateChangedAtMs = 0;
    }
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }

  getActiveObjectiveId(): string | null {
    return this.activeObjectiveIndex === null
      ? null
      : this.objectiveStates[this.activeObjectiveIndex]?.config.id ?? null;
  }

  getObjectiveState(objectiveId: string): CoopDefenseSecondaryObjectiveState | null {
    return this.findObjectiveState(objectiveId)?.state ?? null;
  }

  /**
   * Meldet ein einmalig aufgelöstes authored Ziel. Die Meldung bleibt auch nach `resolved`
   * gültig, damit nachwirkende Destroy-/Carry-Ziele ihren Fortschritt weiterführen können.
   */
  reportTargetResolved(objectiveId: string, targetId: string): boolean {
    const state = this.findObjectiveState(objectiveId);
    if (!state || state.state === 'dormant' || state.state === 'failed') return false;
    if (!state.config.targets.includes(targetId) || state.resolvedTargetIds.has(targetId)) return false;

    state.resolvedTargetIds.add(targetId);
    if (state.state === 'active' && state.resolvedTargetIds.size >= state.config.targetGoal) {
      this.resolveObjective(state);
    }
    return true;
  }

  /** Host-only Naht für spätere Archetypen mit einer echten Fail-Bedingung. */
  reportObjectiveFailed(objectiveId: string): boolean {
    const state = this.findObjectiveState(objectiveId);
    if (!state || state.state !== 'active') return false;
    state.state = 'failed';
    state.stateChangedAtMs = this.elapsedMs;
    this.presentationObjectiveIndex = this.objectiveStates.indexOf(state);
    this.activeObjectiveIndex = null;
    return true;
  }

  /** Alias mit kürzerem Namen für zukünftige Hold-Fachlogik. */
  failObjective(objectiveId: string): boolean {
    return this.reportObjectiveFailed(objectiveId);
  }

  getPresentationState(): CoopDefenseSecondaryObjectivePresentationState | null {
    if (this.presentationObjectiveIndex === null) return null;
    const state = this.objectiveStates[this.presentationObjectiveIndex];
    if (!state) return null;
    return {
      objectiveId: state.config.id,
      type: state.config.type,
      state: state.state,
      progressCurrent: state.resolvedTargetIds.size,
      progressTotal: state.config.targets.length,
      stateChangedAtMs: state.stateChangedAtMs,
    };
  }

  private findObjectiveState(objectiveId: string): SecondaryObjectiveRuntimeState | null {
    return this.objectiveStates.find((state) => state.config.id === objectiveId) ?? null;
  }

  private activateObjective(index: number): void {
    const state = this.objectiveStates[index];
    if (!state || state.state !== 'dormant' || this.activeObjectiveIndex !== null) return;
    state.state = 'active';
    state.stateChangedAtMs = this.elapsedMs;
    this.activeObjectiveIndex = index;
    this.presentationObjectiveIndex = index;
  }

  private updateActiveObjective(index: number): void {
    const state = this.objectiveStates[index];
    if (!state || state.state !== 'active') return;
    if (state.resolvedTargetIds.size >= state.config.targetGoal
      || (state.config.activeUntil !== undefined && this.isTriggerSatisfied(state.config.activeUntil))) {
      this.resolveObjective(state);
    }
  }

  private resolveObjective(state: SecondaryObjectiveRuntimeState): void {
    if (state.state !== 'active') return;
    state.state = 'resolved';
    state.stateChangedAtMs = this.elapsedMs;
    this.presentationObjectiveIndex = this.objectiveStates.indexOf(state);
    this.activeObjectiveIndex = null;
  }

  private isTriggerSatisfied(trigger: CoopDefenseMapEncounterStart): boolean {
    if (trigger.type === 'time') return this.elapsedMs >= Math.max(0, Math.floor(trigger.atMs));
    if (trigger.type === 'after-encounter') {
      return this.isEncounterCleared?.(trigger.encounterId) === true;
    }
    // Map validation rejects these for Objectives. Keeping the runtime fail-closed prevents a
    // malformed direct constructor call from activating an unsupported trigger.
    return false;
  }
}
