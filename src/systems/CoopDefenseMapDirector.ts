import type {
  CoopDefenseMapEncounterStart,
  ResolvedCoopDefenseMapEncounterConfig,
  ResolvedCoopDefenseMapEncounterGroupConfig,
} from '../config/coopDefenseMaps';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type {
  CoopDefenseEncounterPresentationPhase,
  CoopDefenseEncounterPresentationState,
} from '../types';

/** Ausfuehrungsschnitt des Directors zur bestehenden normalen Spawnlogik. */
export type CoopDefenseEncounterSpawnHandler = (
  enemyKind: CoopDefenseEnemyKind,
  count: number,
  originId?: string,
) => readonly string[] | void;

const DEFAULT_SPAWN_BACKSTOP_MS = 30_000;
const DEFAULT_TECHNICAL_STUCK_BACKSTOP_MS = 60_000;
/** Reine Präsentationszeit; sie verschiebt weder Trigger noch Spawn-Zeitpunkte. */
const ENCOUNTER_INCOMING_TELEGRAPH_MS = 900;
const ENCOUNTER_CLEARED_HOLD_MS = 800;

export type CoopDefenseMapDirectorMode = 'scheduled' | 'repel-assault';

export interface CoopDefenseMapDirectorOptions {
  /** A3: Clear wird ausschliesslich ueber die vom Encounter registrierten IDs bestimmt. */
  readonly mode?: CoopDefenseMapDirectorMode;
  readonly isEnemyActive?: (enemyId: string) => boolean;
  /** Semantic map-state query; the director never imports the owning gameplay systems. */
  readonly isEncounterStartSatisfied?: (start: CoopDefenseMapEncounterStart) => boolean;
  /** Generic provenance check for follow-up spawns such as deathSpawns. */
  readonly isEnemyOriginActive?: (originId: string) => boolean;
  /** Optional enumeration used by the technical-stuck backstop for inherited spawns. */
  readonly getActiveEnemyIdsForOrigin?: (originId: string) => readonly string[];
  /** Must only report a persistent, technically proven stuck state. */
  readonly isEnemyTechnicallyStuck?: (enemyId: string) => boolean;
  /** Removes a proven technical rest enemy without awarding a kill or creating follow-up spawns. */
  readonly removeEnemy?: (enemyId: string) => boolean;
  /** Long grace period for repeated zero-progress encounter spawns. */
  readonly spawnBackstopAfterMs?: number;
  /** Long grace period for a proven stuck active enemy. */
  readonly technicalStuckBackstopAfterMs?: number;
}

interface EncounterExecutionState {
  readonly encounterId: string;
  started: boolean;
  readonly groupsExecuted: boolean[];
  readonly groupSpawnedCounts: number[];
  readonly groupNoProgressMs: number[];
  readonly encounterEnemyIds: Set<string>;
  readonly technicallyStuckSinceMs: Map<string, number>;
  spawnBackstopped: boolean;
  startedAtMs: number;
  presentationIncomingStartedAtMs: number;
  clearedAtMs: number | null;
  cleared: boolean;
}

type RepelAssaultPhase = 'waiting' | 'active' | 'rest' | 'complete';

/**
 * Host-autoritärer Zeitplan fuer endliche Map-Encounter.
 *
 * Im `scheduled`-Modus bleibt die A2-Pipeline erhalten: jede Gruppe startet zu ihrem absoluten
 * Zeitpunkt. `repel-assault` aktiviert dagegen die fachlich andere Sequenz aus nur einem aktiven
 * Encounter, ID-basiertem Clear, authored Rest und dem naechsten Encounter.
 */
export class CoopDefenseMapDirector {
  private elapsedMs = 0;
  private readonly executionStates: EncounterExecutionState[];
  private readonly mode: CoopDefenseMapDirectorMode;
  private readonly isEnemyActive: ((enemyId: string) => boolean) | null;
  private readonly isEncounterStartSatisfied: ((start: CoopDefenseMapEncounterStart) => boolean) | null;
  private readonly isEnemyOriginActive: ((originId: string) => boolean) | null;
  private readonly getActiveEnemyIdsForOrigin: ((originId: string) => readonly string[]) | null;
  private readonly isEnemyTechnicallyStuck: ((enemyId: string) => boolean) | null;
  private readonly removeEnemy: ((enemyId: string) => boolean) | null;
  private readonly spawnBackstopAfterMs: number;
  private readonly technicalStuckBackstopAfterMs: number;
  private repelEncounterIndex = 0;
  private repelPhase: RepelAssaultPhase = 'waiting';
  private repelEncounterStartedAtMs = 0;
  private restUntilMs = 0;
  private assaultRepelled = false;
  private lastDeltaMs = 0;

  constructor(
    private readonly encounters: readonly ResolvedCoopDefenseMapEncounterConfig[],
    private readonly spawnGroup: CoopDefenseEncounterSpawnHandler,
    options: CoopDefenseMapDirectorOptions = {},
  ) {
    this.mode = options.mode ?? 'scheduled';
    this.isEnemyActive = options.isEnemyActive ?? null;
    this.isEncounterStartSatisfied = options.isEncounterStartSatisfied ?? null;
    this.isEnemyOriginActive = options.isEnemyOriginActive ?? null;
    this.getActiveEnemyIdsForOrigin = options.getActiveEnemyIdsForOrigin ?? null;
    this.isEnemyTechnicallyStuck = options.isEnemyTechnicallyStuck ?? null;
    this.removeEnemy = options.removeEnemy ?? null;
    this.spawnBackstopAfterMs = normalizeBackstopMs(options.spawnBackstopAfterMs, DEFAULT_SPAWN_BACKSTOP_MS);
    this.technicalStuckBackstopAfterMs = normalizeBackstopMs(
      options.technicalStuckBackstopAfterMs,
      DEFAULT_TECHNICAL_STUCK_BACKSTOP_MS,
    );
    this.executionStates = encounters.map((encounter) => ({
      encounterId: encounter.id,
      started: false,
      groupsExecuted: encounter.groups.map(() => false),
      groupSpawnedCounts: encounter.groups.map(() => 0),
      groupNoProgressMs: encounter.groups.map(() => 0),
      encounterEnemyIds: new Set<string>(),
      technicallyStuckSinceMs: new Map<string, number>(),
      spawnBackstopped: false,
      startedAtMs: 0,
      presentationIncomingStartedAtMs: 0,
      clearedAtMs: null,
      cleared: false,
    }));
  }

  /**
   * Fortschritt der aktiven Map-Zeit. Countdown-Zeit wird nicht angerechnet. Grosse Delta-Werte
   * werden nicht in einzelne Timer zerlegt; alle faelligen Gruppen werden in diesem Aufruf genau
   * einmal ausgefuehrt.
   */
  hostUpdate(deltaMs: number, countdownActive: boolean): number {
    if (countdownActive) return 0;

    this.lastDeltaMs = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    this.elapsedMs += this.lastDeltaMs;
    return this.mode === 'repel-assault'
      ? this.hostUpdateRepelAssault()
      : this.hostUpdateScheduled();
  }

  reset(): void {
    this.elapsedMs = 0;
    this.repelEncounterIndex = 0;
    this.repelPhase = 'waiting';
    this.repelEncounterStartedAtMs = 0;
    this.restUntilMs = 0;
    this.assaultRepelled = false;
    this.lastDeltaMs = 0;
    for (const state of this.executionStates) {
      state.started = false;
      state.groupsExecuted.fill(false);
      state.groupSpawnedCounts.fill(0);
      state.groupNoProgressMs.fill(0);
      state.encounterEnemyIds.clear();
      state.technicallyStuckSinceMs.clear();
      state.spawnBackstopped = false;
      state.startedAtMs = 0;
      state.presentationIncomingStartedAtMs = 0;
      state.clearedAtMs = null;
      state.cleared = false;
    }
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }

  hasStartedEncounter(encounterId: string): boolean {
    const index = this.findEncounterIndex(encounterId);
    return index >= 0 ? this.executionStates[index].started : false;
  }

  /** True once all groups of an Encounter were handed to the spawn path. */
  isEncounterSpawnComplete(encounterId: string): boolean {
    const index = this.findEncounterIndex(encounterId);
    if (index < 0) return false;
    const state = this.executionStates[index];
    return state.started && state.groupsExecuted.every(Boolean);
  }

  /** True only after all registered enemies of the Encounter have disappeared. */
  isEncounterCleared(encounterId: string): boolean {
    const index = this.findEncounterIndex(encounterId);
    return index >= 0 ? this.executionStates[index].cleared : false;
  }

  /** True only after the last mandatory `repel-assault` Encounter was cleared. */
  isAssaultRepelled(): boolean {
    return this.assaultRepelled;
  }

  getActiveEncounterId(): string | null {
    if (this.mode !== 'repel-assault' || this.repelPhase !== 'active') return null;
    return this.encounters[this.repelEncounterIndex]?.id ?? null;
  }

  getRestRemainingMs(): number {
    if (this.mode !== 'repel-assault' || this.repelPhase !== 'rest') return 0;
    return Math.max(0, this.restUntilMs - this.elapsedMs);
  }

  /**
   * Kleiner, zuverlässiger Präsentationsvertrag für HUD und Welt-Telegraph.
   * Er beschreibt nur den bereits autoritativ entschiedenen Encounter-Fortschritt;
   * Clients leiten daraus weder Trigger, Spawns noch Clear-Bedingungen ab.
   */
  getPresentationState(): CoopDefenseEncounterPresentationState | null {
    if (this.encounters.length === 0) return null;
    return this.mode === 'repel-assault'
      ? this.getRepelPresentationState()
      : this.getScheduledPresentationState();
  }

  private hostUpdateScheduled(): number {
    let executedGroupCount = 0;

    for (let encounterIndex = 0; encounterIndex < this.encounters.length; encounterIndex += 1) {
      const encounter = this.encounters[encounterIndex];
      const state = this.executionStates[encounterIndex];
      if (!state.started && this.canStartScheduledEncounter(encounterIndex)) {
        state.started = true;
        state.startedAtMs = this.getScheduledEncounterStartAtMs(encounterIndex);
        state.presentationIncomingStartedAtMs = this.getPresentationIncomingStartAtMs(encounterIndex);
      }
      if (!state.started) continue;

      for (let groupIndex = 0; groupIndex < encounter.groups.length; groupIndex += 1) {
        if (state.groupsExecuted[groupIndex]) continue;
        const group = encounter.groups[groupIndex];
        const groupStartAtMs = state.startedAtMs + Math.max(0, Math.floor(group.delayMs));
        if (this.elapsedMs < groupStartAtMs) continue;

        // Vor dem Callback markieren: Auch ein re-entrantes Host-Update oder ein Callback-Fehler
        // kann diese Gruppe nicht versehentlich zu einer periodischen Welle machen.
        this.spawnEncounterGroup(group, groupIndex, state);
        executedGroupCount += 1;
      }

      if (!state.cleared && this.isEncounterSpawnCompleteState(state) && this.isThreatCleared(state)) {
        state.cleared = true;
        state.clearedAtMs = this.elapsedMs;
      }
    }

    return executedGroupCount;
  }

  private hostUpdateRepelAssault(): number {
    let executedGroupCount = 0;

    while (true) {
      if (this.repelPhase === 'complete' || this.encounters.length === 0) return executedGroupCount;

      if (this.repelPhase === 'waiting') {
        if (!this.canStartRepelEncounter(this.repelEncounterIndex)) {
          return executedGroupCount;
        }
        this.beginRepelEncounter(this.repelEncounterIndex);
        continue;
      }

      if (this.repelPhase === 'rest') {
        if (this.elapsedMs < this.restUntilMs) return executedGroupCount;
        this.repelEncounterIndex += 1;
        this.repelPhase = 'waiting';
        continue;
      }

      const encounter = this.encounters[this.repelEncounterIndex];
      const state = this.executionStates[this.repelEncounterIndex];
      for (let groupIndex = 0; groupIndex < encounter.groups.length; groupIndex += 1) {
        if (state.groupsExecuted[groupIndex]) continue;
        const group = encounter.groups[groupIndex];
        if (this.elapsedMs < this.getRepelGroupStartAtMs(group)) continue;

        this.spawnEncounterGroup(group, groupIndex, state);
        executedGroupCount += 1;
      }

      this.applyTechnicalBackstop(state);
      if (!state.cleared && this.isEncounterSpawnCompleteState(state) && this.isThreatCleared(state)) {
        state.cleared = true;
        state.clearedAtMs = this.elapsedMs;
        if (this.repelEncounterIndex >= this.encounters.length - 1) {
          this.assaultRepelled = true;
          this.repelPhase = 'complete';
          return executedGroupCount;
        }

        this.repelPhase = 'rest';
        this.restUntilMs = this.elapsedMs + Math.max(0, Math.floor(encounter.restAfterMs));
        continue;
      }

      return executedGroupCount;
    }
  }

  private beginRepelEncounter(index: number): void {
    this.repelEncounterIndex = index;
    const state = this.executionStates[index];
    if (!state) {
      this.repelPhase = 'complete';
      this.assaultRepelled = this.encounters.length > 0;
      return;
    }
    state.started = true;
    state.startedAtMs = this.getRepelEncounterStartAtMs(this.encounters[index].start);
    state.presentationIncomingStartedAtMs = this.getPresentationIncomingStartAtMs(index);
    this.repelEncounterStartedAtMs = state.startedAtMs;
    this.repelPhase = 'active';
  }

  private getRepelGroupStartAtMs(group: ResolvedCoopDefenseMapEncounterGroupConfig): number {
    return this.repelEncounterStartedAtMs + Math.max(0, Math.floor(group.delayMs));
  }

  private canStartScheduledEncounter(index: number): boolean {
    const encounter = this.encounters[index];
    if (!encounter) return false;
    if (encounter.start.type === 'after-previous') {
      const previous = this.executionStates[index - 1];
      return index > 0
        && previous?.cleared === true
        && this.elapsedMs >= (previous.clearedAtMs ?? Number.POSITIVE_INFINITY)
          + this.encounters[index - 1].restAfterMs;
    }
    return this.isStartTriggerSatisfied(encounter.start);
  }

  private getScheduledEncounterStartAtMs(index: number): number {
    const encounter = this.encounters[index];
    if (!encounter) return this.elapsedMs;
    if (encounter.start.type === 'time') {
      return Math.max(0, Math.floor(encounter.start.atMs));
    }
    if (encounter.start.type === 'after-previous') {
      const previous = this.executionStates[index - 1];
      return (previous?.clearedAtMs ?? this.elapsedMs) + this.encounters[index - 1].restAfterMs;
    }
    return this.elapsedMs;
  }

  private canStartRepelEncounter(index: number): boolean {
    const encounter = this.encounters[index];
    if (!encounter) return false;
    if (encounter.start.type === 'after-previous') return index > 0;
    return this.isStartTriggerSatisfied(encounter.start);
  }

  private isStartTriggerSatisfied(start: CoopDefenseMapEncounterStart): boolean {
    if (start.type === 'time') return this.elapsedMs >= Math.max(0, Math.floor(start.atMs));
    if (start.type === 'after-previous') return false;
    return this.isEncounterStartSatisfied?.(start) === true;
  }

  private getRepelEncounterStartAtMs(start: CoopDefenseMapEncounterStart): number {
    return start.type === 'time'
      ? Math.max(0, Math.floor(start.atMs))
      : this.elapsedMs;
  }

  private getPresentationIncomingStartAtMs(index: number): number {
    const state = this.executionStates[index];
    if (!state) return this.elapsedMs;
    const start = this.encounters[index]?.start;
    // Zeit- und After-Previous-Encounter sind vorhersehbar und erhalten eine echte
    // Vorwarnung. Event-Trigger werden erst bei ihrer autoritativen Auslösung sichtbar.
    if (start?.type === 'time' || start?.type === 'after-previous') {
      return Math.max(0, state.startedAtMs - ENCOUNTER_INCOMING_TELEGRAPH_MS);
    }
    return this.elapsedMs;
  }

  private getScheduledPresentationState(): CoopDefenseEncounterPresentationState | null {
    for (let index = 0; index < this.executionStates.length; index += 1) {
      const state = this.executionStates[index];
      if (!state.started || state.cleared) continue;
      return this.createStartedPresentationState(index, state);
    }

    const pending = this.findPredictablePendingEncounter();
    if (pending && this.elapsedMs >= pending.startAtMs - ENCOUNTER_INCOMING_TELEGRAPH_MS
      && this.elapsedMs < pending.startAtMs) {
      return this.createPresentationState(
        pending.index,
        'incoming',
        pending.startAtMs - ENCOUNTER_INCOMING_TELEGRAPH_MS,
        pending.startAtMs,
      );
    }

    const latestCleared = this.findLatestClearedEncounter();
    if (!latestCleared) return null;
    const clearedAtMs = latestCleared.state.clearedAtMs ?? this.elapsedMs;
    if (this.elapsedMs < clearedAtMs + ENCOUNTER_CLEARED_HOLD_MS) {
      return this.createPresentationState(
        latestCleared.index,
        'cleared',
        clearedAtMs,
        clearedAtMs + ENCOUNTER_CLEARED_HOLD_MS,
      );
    }

    const nextIndex = latestCleared.index + 1;
    const next = this.encounters[nextIndex];
    if (next?.start.type === 'after-previous') {
      const nextStartAtMs = clearedAtMs + this.encounters[latestCleared.index].restAfterMs;
      return this.createPresentationState(
        nextIndex,
        'rest',
        clearedAtMs,
        nextStartAtMs,
      );
    }

    if (this.executionStates.every((entry) => entry.cleared)) {
      return this.createPresentationState(
        latestCleared.index,
        'complete',
        clearedAtMs + ENCOUNTER_CLEARED_HOLD_MS,
        null,
      );
    }
    return null;
  }

  private getRepelPresentationState(): CoopDefenseEncounterPresentationState | null {
    if (this.repelPhase === 'active') {
      const state = this.executionStates[this.repelEncounterIndex];
      return state?.started ? this.createStartedPresentationState(this.repelEncounterIndex, state) : null;
    }

    if (this.repelPhase === 'rest') {
      const nextIndex = this.repelEncounterIndex + 1;
      if (nextIndex >= this.encounters.length) return null;
      const previousClearedAtMs = this.executionStates[this.repelEncounterIndex]?.clearedAtMs ?? this.elapsedMs;
      if (this.elapsedMs < previousClearedAtMs + ENCOUNTER_CLEARED_HOLD_MS) {
        return this.createPresentationState(
          this.repelEncounterIndex,
          'cleared',
          previousClearedAtMs,
          previousClearedAtMs + ENCOUNTER_CLEARED_HOLD_MS,
        );
      }
      if (this.elapsedMs >= this.restUntilMs - ENCOUNTER_INCOMING_TELEGRAPH_MS
        && this.elapsedMs < this.restUntilMs) {
        return this.createPresentationState(
          nextIndex,
          'incoming',
          this.restUntilMs - ENCOUNTER_INCOMING_TELEGRAPH_MS,
          this.restUntilMs,
        );
      }
      return this.createPresentationState(
        nextIndex,
        'rest',
        previousClearedAtMs,
        this.restUntilMs,
      );
    }

    if (this.repelPhase === 'complete') {
      const lastIndex = this.executionStates.length - 1;
      const state = this.executionStates[lastIndex];
      const clearedAtMs = state?.clearedAtMs ?? this.elapsedMs;
      if (this.elapsedMs < clearedAtMs + ENCOUNTER_CLEARED_HOLD_MS) {
        return this.createPresentationState(
          lastIndex,
          'cleared',
          clearedAtMs,
          clearedAtMs + ENCOUNTER_CLEARED_HOLD_MS,
        );
      }
      return this.createPresentationState(
        lastIndex,
        'complete',
        clearedAtMs + ENCOUNTER_CLEARED_HOLD_MS,
        null,
      );
    }

    const pending = this.findPredictablePendingEncounter();
    if (pending && this.elapsedMs >= pending.startAtMs - ENCOUNTER_INCOMING_TELEGRAPH_MS
      && this.elapsedMs < pending.startAtMs) {
      return this.createPresentationState(
        pending.index,
        'incoming',
        pending.startAtMs - ENCOUNTER_INCOMING_TELEGRAPH_MS,
        pending.startAtMs,
      );
    }
    return null;
  }

  private createStartedPresentationState(
    index: number,
    state: EncounterExecutionState,
  ): CoopDefenseEncounterPresentationState {
    const incomingEndsAtMs = Math.max(
      state.presentationIncomingStartedAtMs + ENCOUNTER_INCOMING_TELEGRAPH_MS,
      state.startedAtMs + this.getFirstGroupDelayMs(index),
    );
    return this.createPresentationState(
      index,
      this.elapsedMs < incomingEndsAtMs ? 'incoming' : 'active',
      state.presentationIncomingStartedAtMs,
      incomingEndsAtMs,
    );
  }

  private createPresentationState(
    index: number,
    phase: CoopDefenseEncounterPresentationPhase,
    phaseStartedAtMs: number,
    phaseEndsAtMs: number | null,
  ): CoopDefenseEncounterPresentationState {
    return {
      encounterId: this.encounters[index]?.id ?? '',
      sequenceIndex: index + 1,
      sequenceCount: this.encounters.length,
      phase,
      phaseStartedAtMs: Math.max(0, phaseStartedAtMs),
      phaseEndsAtMs: phaseEndsAtMs === null ? null : Math.max(0, phaseEndsAtMs),
    };
  }

  private getFirstGroupDelayMs(index: number): number {
    const groups = this.encounters[index]?.groups ?? [];
    return groups.reduce(
      (minimum, group) => Math.min(minimum, Math.max(0, Math.floor(group.delayMs))),
      Number.POSITIVE_INFINITY,
    );
  }

  private findPredictablePendingEncounter(): { index: number; startAtMs: number } | null {
    for (let index = 0; index < this.encounters.length; index += 1) {
      const state = this.executionStates[index];
      const encounter = this.encounters[index];
      if (state.started) continue;
      if (encounter.start.type === 'time') {
        return { index, startAtMs: Math.max(0, Math.floor(encounter.start.atMs)) };
      }
      if (encounter.start.type === 'after-previous') {
        const previous = this.executionStates[index - 1];
        if (previous?.cleared && previous.clearedAtMs !== null) {
          return {
            index,
            startAtMs: previous.clearedAtMs + this.encounters[index - 1].restAfterMs,
          };
        }
      }
      // Event- und Base-Trigger haben keinen clientseitig vorhersagbaren Zeitpunkt.
      return null;
    }
    return null;
  }

  private findLatestClearedEncounter(): { index: number; state: EncounterExecutionState } | null {
    let latest: { index: number; state: EncounterExecutionState } | null = null;
    for (let index = 0; index < this.executionStates.length; index += 1) {
      const state = this.executionStates[index];
      if (!state.cleared) continue;
      if (!latest || (state.clearedAtMs ?? -1) > (latest.state.clearedAtMs ?? -1)) {
        latest = { index, state };
      }
    }
    return latest;
  }

  private spawnEncounterGroup(
    group: ResolvedCoopDefenseMapEncounterGroupConfig,
    groupIndex: number,
    state: EncounterExecutionState,
  ): void {
    const remainingCount = Math.max(0, group.count - state.groupSpawnedCounts[groupIndex]);
    if (remainingCount <= 0) {
      state.groupsExecuted[groupIndex] = true;
      return;
    }

    const spawnResult = this.spawnGroup(group.enemyKind, remainingCount, state.encounterId);
    // Older scheduled callbacks were void-returning. Preserve their once-only semantics while
    // treating an explicit [] as a real zero-spawn result that remains retryable.
    if (spawnResult === undefined) {
      state.groupSpawnedCounts[groupIndex] = group.count;
      state.groupsExecuted[groupIndex] = true;
      return;
    }

    const enemyIds = spawnResult;
    let spawnedCount = 0;
    for (const enemyId of enemyIds) {
      if (typeof enemyId !== 'string' || enemyId.length === 0 || state.encounterEnemyIds.has(enemyId)) continue;
      state.encounterEnemyIds.add(enemyId);
      spawnedCount += 1;
    }
    state.groupSpawnedCounts[groupIndex] = Math.min(group.count, state.groupSpawnedCounts[groupIndex] + spawnedCount);
    state.groupsExecuted[groupIndex] = state.groupSpawnedCounts[groupIndex] >= group.count;
    if (spawnedCount > 0) {
      state.groupNoProgressMs[groupIndex] = 0;
    } else if (!this.hasActiveOrigin(state)) {
      state.groupNoProgressMs[groupIndex] += this.lastDeltaMs;
      if (state.groupNoProgressMs[groupIndex] >= this.spawnBackstopAfterMs) {
        // This only abandons a group that has produced no progress for a long grace period and
        // has no live encounter provenance. It never removes or ignores a live enemy.
        state.groupsExecuted[groupIndex] = true;
        state.spawnBackstopped = true;
      }
    }
  }

  private isEncounterSpawnCompleteState(state: EncounterExecutionState): boolean {
    return state.started && state.groupsExecuted.every(Boolean);
  }

  private isThreatCleared(state: EncounterExecutionState): boolean {
    if (this.hasActiveOrigin(state)) return false;
    if (this.isEnemyActive) {
      for (const enemyId of state.encounterEnemyIds) {
        if (this.isEnemyActive(enemyId)) return false;
      }
    } else if (state.encounterEnemyIds.size > 0) {
      return false;
    }
    return state.encounterEnemyIds.size > 0 || state.spawnBackstopped;
  }

  private hasActiveOrigin(state: EncounterExecutionState): boolean {
    if (this.isEnemyOriginActive?.(this.getEncounterId(state)) === true) return true;
    return (this.getActiveEnemyIdsForOrigin?.(this.getEncounterId(state)).length ?? 0) > 0;
  }

  private applyTechnicalBackstop(state: EncounterExecutionState): void {
    if (!this.isEnemyTechnicallyStuck || !this.removeEnemy) return;
    const candidateIds = new Set(state.encounterEnemyIds);
    for (const enemyId of this.getActiveEnemyIdsForOrigin?.(this.getEncounterId(state)) ?? []) {
      candidateIds.add(enemyId);
    }

    for (const enemyId of candidateIds) {
      if (this.isEnemyActive && !this.isEnemyActive(enemyId)) {
        state.technicallyStuckSinceMs.delete(enemyId);
        continue;
      }
      if (!this.isEnemyTechnicallyStuck(enemyId)) {
        state.technicallyStuckSinceMs.delete(enemyId);
        continue;
      }
      const stuckSince = state.technicallyStuckSinceMs.get(enemyId) ?? this.elapsedMs;
      state.technicallyStuckSinceMs.set(enemyId, stuckSince);
      if (this.elapsedMs - stuckSince < this.technicalStuckBackstopAfterMs) continue;
      if (this.removeEnemy(enemyId)) state.technicallyStuckSinceMs.delete(enemyId);
    }
  }

  private getEncounterId(state: EncounterExecutionState): string {
    return state.encounterId;
  }

  private findEncounterIndex(encounterId: string): number {
    return this.encounters.findIndex((encounter) => encounter.id === encounterId);
  }
}

export type CoopDefenseMapDirectorGroup = ResolvedCoopDefenseMapEncounterGroupConfig;

function normalizeBackstopMs(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(0, Math.floor(value));
}
