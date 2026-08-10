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
 * Lebenszyklus und HUD-Fokus sind getrennt: Ein Objective kann nach dem Fokusverlust als aktives
 * Hintergrund-Objective weiterlaufen und Ziele zählen, während ein anderes den Fokus übernimmt.
 * Das System kennt weder Basen noch den Encounter-Director; spätere Archetypen melden ihre
 * Weltauflösung über reportTargetResolved().
 */
export class CoopDefenseSecondaryObjectiveSystem {
  private elapsedMs = 0;
  private focusedObjectiveIndex: number | null = null;
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

    // Nur ein belegter Fokus-Slot blockiert die nächste Aktivierung; aktive Hintergrund-Objectives
    // bleiben unabhängig davon zählbar und werden nicht erneut fokussiert.
    if (this.focusedObjectiveIndex !== null) {
      this.updateFocusedObjective();
    }
    if (this.focusedObjectiveIndex !== null) {
      return;
    }

    for (let index = 0; index < this.objectiveStates.length; index += 1) {
      const state = this.objectiveStates[index];
      if (state.state !== 'dormant' || !this.isTriggerSatisfied(state.config.start)) continue;
      this.activateObjective(index);
      return;
    }
  }

  reset(): void {
    this.elapsedMs = 0;
    this.focusedObjectiveIndex = null;
    for (const state of this.objectiveStates) {
      state.resolvedTargetIds.clear();
      state.state = 'dormant';
      state.stateChangedAtMs = 0;
    }
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }

  getFocusedObjectiveId(): string | null {
    return this.focusedObjectiveIndex === null
      ? null
      : this.objectiveStates[this.focusedObjectiveIndex]?.config.id ?? null;
  }

  getObjectiveState(objectiveId: string): CoopDefenseSecondaryObjectiveState | null {
    return this.findObjectiveState(objectiveId)?.state ?? null;
  }

  getTargetResolutionXp(objectiveId: string): number {
    const value = this.findObjectiveState(objectiveId)?.config.rewards?.xpPerTarget;
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  /**
   * Meldet ein einmalig aufgelöstes authored Ziel. Die Meldung gilt für jedes aktive Objective,
   * auch wenn es nach Fokusverlust als Hintergrund-Objective weiterläuft.
   */
  reportTargetResolved(objectiveId: string, targetId: string): boolean {
    const state = this.findObjectiveState(objectiveId);
    if (!state || state.state !== 'active') return false;
    if (!state.config.targets.includes(targetId) || state.resolvedTargetIds.has(targetId)) return false;

    state.resolvedTargetIds.add(targetId);
    if (state.resolvedTargetIds.size >= state.config.targetGoal) this.completeObjective(state);
    return true;
  }

  /** Host-only Naht für spätere Archetypen mit einer echten Fail-Bedingung. */
  reportObjectiveFailed(objectiveId: string): boolean {
    const state = this.findObjectiveState(objectiveId);
    if (!state || state.state !== 'active') return false;
    state.state = 'failed';
    state.stateChangedAtMs = this.elapsedMs;
    const index = this.objectiveStates.indexOf(state);
    if (this.focusedObjectiveIndex === index) this.focusedObjectiveIndex = null;
    return true;
  }

  getPresentationState(): CoopDefenseSecondaryObjectivePresentationState {
    return this.objectiveStates
      .map((state, index) => ({ state, index }))
      .filter(({ state }) => state.state !== 'dormant')
      .map(({ state, index }) => ({
        objectiveId: state.config.id,
        type: state.config.type,
        state: state.state,
        focused: this.focusedObjectiveIndex === index,
        progressCurrent: state.resolvedTargetIds.size,
        progressTotal: state.config.targetGoal,
        stateChangedAtMs: state.stateChangedAtMs,
      }));
  }

  private findObjectiveState(objectiveId: string): SecondaryObjectiveRuntimeState | null {
    return this.objectiveStates.find((state) => state.config.id === objectiveId) ?? null;
  }

  private activateObjective(index: number): void {
    const state = this.objectiveStates[index];
    if (!state || state.state !== 'dormant' || this.focusedObjectiveIndex !== null) return;
    state.state = 'active';
    state.stateChangedAtMs = this.elapsedMs;
    this.focusedObjectiveIndex = index;
  }

  private updateFocusedObjective(): void {
    if (this.focusedObjectiveIndex === null) return;
    const state = this.objectiveStates[this.focusedObjectiveIndex];
    if (!state || state.state !== 'active') {
      this.focusedObjectiveIndex = null;
      return;
    }
    if (state.config.focusUntil !== undefined && this.isTriggerSatisfied(state.config.focusUntil)) {
      // Fokusverlust ist kein Lebenszykluswechsel; stateChangedAtMs bleibt unverändert.
      this.focusedObjectiveIndex = null;
    }
  }

  private completeObjective(state: SecondaryObjectiveRuntimeState): void {
    if (state.state !== 'active') return;
    state.state = 'completed';
    state.stateChangedAtMs = this.elapsedMs;
    const index = this.objectiveStates.indexOf(state);
    if (this.focusedObjectiveIndex === index) this.focusedObjectiveIndex = null;
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
