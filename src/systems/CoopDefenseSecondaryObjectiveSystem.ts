import type {
  CoopDefenseMapEncounterStart,
  ResolvedCoopDefenseMapSecondaryObjectiveConfig,
} from '../config/coopDefenseMaps';
import type {
  CoopDefenseSecondaryObjectivePresentationState,
  CoopDefenseSecondaryObjectiveState,
} from '../types';

export interface CoopDefenseSecondaryObjectiveSystemOptions {
  readonly onObjectiveActivated?: (objectiveId: string) => void;
  /** Einzige Completion-Naht fuer authored Vollabschluss-Rewards. */
  readonly onObjectiveCompleted?: (objectiveId: string) => void;
  readonly onHoldFailed?: (objectiveId: string) => void;
  /** Meldet, ob ein dormant Objective aktuell den HUD-Fokus priorisiert übernehmen muss. */
  readonly isObjectivePriorityRequested?: (objectiveId: string) => boolean;
  /** Liefert ausschließlich den semantischen Clear-Zustand des Encounter-Owners. */
  readonly isEncounterCleared?: (encounterId: string) => boolean;
  /** Semantische Lifecycle-Naht fuer bewusst kleine externe Trigger wie Checkpoint/Defense. */
  readonly isExternalTriggerSatisfied?: (trigger: CoopDefenseMapEncounterStart) => boolean;
  /**
   * Reward-Anforderung eines erfolgreich gehaltenen Ziels. Das System kennt die Wirkung nicht; der
   * Aufrufer löst den authored Reward auf und stößt das zuständige System an.
   */
  readonly onHoldCompleted?: (objectiveId: string) => void;
}

/** Autoritativer, nur rundenlanger Reward-Zustand des Objective-Systems. */
export interface CoopDefenseSecondaryObjectiveRewardLedger {
  readonly epicGuaranteeCount: number;
}

interface SecondaryObjectiveRuntimeState {
  readonly config: ResolvedCoopDefenseMapSecondaryObjectiveConfig;
  readonly resolvedTargetIds: Set<string>;
  /** Hold-Ziele, die waehrend des Haltefensters zerstoert wurden. */
  readonly destroyedTargetIds: Set<string>;
  /** Ziele, an denen mindestens ein reward-berechtigter Teilnehmer mitgewirkt hat. */
  readonly creditedTargetIds: Set<string>;
  state: CoopDefenseSecondaryObjectiveState;
  stateChangedAtMs: number;
  holdEndsAtRoundMs: number | null;
}

/**
 * Host-autoritatives Fundament für optionale Coop-Defense-Nebenmissionen.
 *
 * Lebenszyklus und HUD-Fokus sind getrennt: Ein Objective kann nach dem Fokusverlust als aktives
 * Hintergrund-Objective weiterlaufen und Ziele zählen, während ein anderes den Fokus übernimmt.
 * Das System kennt weder Basen noch den Encounter-Director; die Welt meldet ausschließlich über
 * reportTargetDestroyed() and reportCarryDelivered() are the two explicit world seams. The
 * archetype owns which seam can advance it; Carry is never resolved through base destruction.
 */
export class CoopDefenseSecondaryObjectiveSystem {
  private elapsedMs = 0;
  private focusedObjectiveIndex: number | null = null;
  private epicGuaranteeCount = 0;
  private readonly isEncounterCleared: ((encounterId: string) => boolean) | null;
  private readonly isExternalTriggerSatisfied: ((trigger: CoopDefenseMapEncounterStart) => boolean) | null;
  private readonly onObjectiveActivated: ((objectiveId: string) => void) | null;
  private readonly onObjectiveCompleted: ((objectiveId: string) => void) | null;
  private readonly onHoldFailed: ((objectiveId: string) => void) | null;
  private readonly onHoldCompleted: ((objectiveId: string) => void) | null;
  private readonly isObjectivePriorityRequested: ((objectiveId: string) => boolean) | null;
  private readonly objectiveStates: SecondaryObjectiveRuntimeState[];

  constructor(
    objectives: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
    options: CoopDefenseSecondaryObjectiveSystemOptions = {},
  ) {
    this.isEncounterCleared = options.isEncounterCleared ?? null;
    this.isExternalTriggerSatisfied = options.isExternalTriggerSatisfied ?? null;
    this.onObjectiveActivated = options.onObjectiveActivated ?? null;
    this.onObjectiveCompleted = options.onObjectiveCompleted ?? null;
    this.onHoldFailed = options.onHoldFailed ?? null;
    this.onHoldCompleted = options.onHoldCompleted ?? null;
    this.isObjectivePriorityRequested = options.isObjectivePriorityRequested ?? null;
    this.objectiveStates = objectives.map((config) => ({
      config,
      resolvedTargetIds: new Set<string>(),
      destroyedTargetIds: new Set<string>(),
      creditedTargetIds: new Set<string>(),
      state: 'dormant',
      stateChangedAtMs: 0,
      holdEndsAtRoundMs: null,
    }));
  }

  /** Countdown-Zeit gehört wie beim MapDirector nicht zur authored Rundenzeit. */
  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive) return;
    this.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;

    // Vor der Fokusprüfung: Ein Hold, der sein Fenster erreicht, gibt den Slot noch in diesem Tick
    // frei, damit die Aktivierungsschleife unten ihn ohne Verzögerung weiterreichen kann.
    this.updateHoldObjectives();

    // Nur ein belegter Fokus-Slot blockiert die nächste Aktivierung; aktive Hintergrund-Objectives
    // bleiben unabhängig davon zählbar und werden nicht erneut fokussiert.
    if (this.focusedObjectiveIndex !== null) {
      this.updateFocusedObjective();
    }

    // Eine aktuell verpflichtende Defense darf den Fokus eines optionalen Objectives übernehmen,
    // bleibt aber an ihr eigenes authored Start-Trigger gebunden. Das verdrängte Objective bleibt
    // aktiv und damit als Hintergrund-Objective weiter zählbar.
    const prioritizedIndex = this.findPrioritizedDormantObjective();
    if (prioritizedIndex !== null) {
      const focusedState = this.focusedObjectiveIndex === null
        ? null
        : this.objectiveStates[this.focusedObjectiveIndex] ?? null;
      if (focusedState && this.isObjectivePriorityRequested?.(focusedState.config.id) === true) return;
      this.focusedObjectiveIndex = null;
      this.activateObjective(prioritizedIndex);
      return;
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
    this.epicGuaranteeCount = 0;
    for (const state of this.objectiveStates) {
      state.resolvedTargetIds.clear();
      state.destroyedTargetIds.clear();
      state.creditedTargetIds.clear();
      state.state = 'dormant';
      state.stateChangedAtMs = 0;
      state.holdEndsAtRoundMs = null;
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

  getRewardLedger(): CoopDefenseSecondaryObjectiveRewardLedger {
    return { epicGuaranteeCount: this.epicGuaranteeCount };
  }

  getEpicGuaranteeCount(): number {
    return this.epicGuaranteeCount;
  }

  /**
   * Host-only: Ein reward-berechtigter Teilnehmer hat an einem authored Missionsziel mitgewirkt.
   *
   * Der Bonus-XP eines Destroy-Ziels gehört dem Team der laufenden Runde. Ein Ziel, das
   * ausschließlich Schaden von Spectators oder Latejoinern erhält, bleibt Fortschritt – es bucht
   * aber keine XP, weil sonst ein Zuschauer die Rundenbelohnung des Teams erzeugen könnte. Die
   * Meldung ist bewusst idempotent und kennt weder Schadenshöhe noch Last-Hit.
   */
  reportTargetContribution(objectiveId: string, targetId: string): void {
    const state = this.findObjectiveState(objectiveId);
    if (!state || state.state !== 'active' || !state.config.targets.includes(targetId)) return;
    state.creditedTargetIds.add(targetId);
  }

  /**
   * Einzige Weltnaht für ein zerstörtes authored Missionsziel. Der Archetyp entscheidet die Wirkung:
   * Für Destroy ist die Zerstörung der Fortschritt, für Hold sinkt damit die Zahl der Überlebenden.
   * Rückgabe sind die dafür zu buchenden Team-XP – so kann ein authored `xpPerTarget` an einem Hold
   * nicht versehentlich zu einer Belohnung für den Verlust des Ziels werden.
   */
  reportTargetDestroyed(objectiveId: string, targetId: string): number {
    const state = this.findObjectiveState(objectiveId);
    if (!state || state.state !== 'active' || !state.config.targets.includes(targetId)) return 0;

    switch (state.config.type) {
      case 'destroy': {
        // Reihenfolge zählt: Erst die einmalige Auflösung, dann die Anrechnung. Ein zweiter
        // Zerstörungs-Callback für dasselbe Ziel bucht dadurch nie ein zweites Mal.
        if (!this.resolveTarget(state, targetId)) return 0;
        return state.creditedTargetIds.has(targetId) ? this.getTargetResolutionXp(objectiveId) : 0;
      }
      case 'hold':
        if (state.destroyedTargetIds.has(targetId)) return 0;
        state.destroyedTargetIds.add(targetId);
        if (this.getHoldSurvivorCount(state) < this.getRequiredSurvivors(state)) {
          this.failObjective(state);
        }
        return 0;
      default:
        // Carry löst seine Objekte über Abgabe auf, nicht über Zerstörung.
        return 0;
    }
  }

  /** Host-only delivery seam for Carry. The item id is the deduplication key. */
  reportCarryDelivered(objectiveId: string, itemId: string): boolean {
    const state = this.findObjectiveState(objectiveId);
    if (!state || state.state !== 'active' || state.config.type !== 'carry') return false;
    const accepted = this.resolveTarget(state, itemId);
    if (accepted && state.config.rewards?.itemMetaRewardOnComplete === true) {
      this.epicGuaranteeCount = Math.min(3, this.epicGuaranteeCount + 1);
    }
    return accepted;
  }

  /** Host-only Naht für Archetypen mit einer echten Fail-Bedingung. */
  reportObjectiveFailed(objectiveId: string): boolean {
    const state = this.findObjectiveState(objectiveId);
    if (!state || state.state !== 'active') return false;
    this.failObjective(state);
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

  /**
   * Zählt ein einmalig aufgelöstes authored Ziel. Die Meldung gilt für jedes aktive Objective,
   * auch wenn es nach Fokusverlust als Hintergrund-Objective weiterläuft.
   */
  private resolveTarget(state: SecondaryObjectiveRuntimeState, targetId: string): boolean {
    if (state.resolvedTargetIds.has(targetId)) return false;
    state.resolvedTargetIds.add(targetId);
    if (state.resolvedTargetIds.size >= state.config.targetGoal) this.completeObjective(state);
    return true;
  }

  /**
   * Hold kennt als einziger Archetyp einen zeitlichen Erfolg: Bei Erreichen von `holdUntil` müssen
   * mindestens `requiredSurvivors` Ziele noch leben. Sinkt die Zahl vorher darunter, scheitert die
   * Mission sofort; ohne authored Wert entspricht sie der Zahl aller Targets.
   */
  private updateHoldObjectives(): void {
    for (const state of this.objectiveStates) {
      if (state.state !== 'active' || state.config.type !== 'hold') continue;
      const reachedAuthoredEnd = state.config.holdUntil !== undefined
        && this.isTriggerSatisfied(state.config.holdUntil);
      const reachedRelativeEnd = state.holdEndsAtRoundMs !== null
        && this.elapsedMs >= state.holdEndsAtRoundMs;
      if (!reachedAuthoredEnd && !reachedRelativeEnd) continue;
      if (this.getHoldSurvivorCount(state) < this.getRequiredSurvivors(state)) {
        this.failObjective(state);
      } else {
        this.completeObjective(state);
        this.onHoldCompleted?.(state.config.id);
      }
    }
  }

  private getRequiredSurvivors(state: SecondaryObjectiveRuntimeState): number {
    return state.config.requiredSurvivors ?? state.config.targets.length;
  }

  private getHoldSurvivorCount(state: SecondaryObjectiveRuntimeState): number {
    return state.config.targets.length - state.destroyedTargetIds.size;
  }

  private findPrioritizedDormantObjective(): number | null {
    if (!this.isObjectivePriorityRequested) return null;
    for (let index = 0; index < this.objectiveStates.length; index += 1) {
      const state = this.objectiveStates[index];
      if (state.state !== 'dormant'
        || state.config.type !== 'hold'
        || !this.isObjectivePriorityRequested(state.config.id)
        || !this.isTriggerSatisfied(state.config.start)) continue;
      return index;
    }
    return null;
  }

  private activateObjective(index: number): void {
    const state = this.objectiveStates[index];
    if (!state || state.state !== 'dormant' || this.focusedObjectiveIndex !== null) return;
    state.state = 'active';
    state.stateChangedAtMs = this.elapsedMs;
    state.holdEndsAtRoundMs = state.config.type === 'hold' && state.config.holdDurationMs !== undefined
      ? this.elapsedMs + state.config.holdDurationMs
      : null;
    this.focusedObjectiveIndex = index;
    this.onObjectiveActivated?.(state.config.id);
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
    this.setTerminalState(state, 'completed');
  }

  private failObjective(state: SecondaryObjectiveRuntimeState): void {
    if (state.state !== 'active') return;
    this.setTerminalState(state, 'failed');
    if (state.config.type === 'hold') this.onHoldFailed?.(state.config.id);
  }

  private setTerminalState(
    state: SecondaryObjectiveRuntimeState,
    terminalState: 'completed' | 'failed',
  ): void {
    if (state.state !== 'active') return;
    state.state = terminalState;
    state.stateChangedAtMs = this.elapsedMs;
    const index = this.objectiveStates.indexOf(state);
    if (this.focusedObjectiveIndex === index) this.focusedObjectiveIndex = null;
    if (terminalState === 'completed') this.onObjectiveCompleted?.(state.config.id);
  }

  private isTriggerSatisfied(trigger: CoopDefenseMapEncounterStart): boolean {
    if (trigger.type === 'time') return this.elapsedMs >= Math.max(0, Math.floor(trigger.atMs));
    if (trigger.type === 'after-encounter') {
      return this.isEncounterCleared?.(trigger.encounterId) === true;
    }
    if (trigger.type === 'after-checkpoint' || trigger.type === 'after-defense') {
      return this.isExternalTriggerSatisfied?.(trigger) === true;
    }
    // Map validation rejects these for Objectives. Keeping the runtime fail-closed prevents a
    // malformed direct constructor call from activating an unsupported trigger.
    return false;
  }
}
