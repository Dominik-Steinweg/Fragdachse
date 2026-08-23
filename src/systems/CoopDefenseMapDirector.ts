import type {
  CoopDefenseMapEncounterStart,
  CoopDefenseMapSpawnAreaConfig,
  ResolvedCoopDefenseMapEncounterConfig,
  ResolvedCoopDefenseMapEncounterGroupConfig,
} from '../config/coopDefenseMaps';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type {
  CoopDefenseEncounterPresentationPhase,
  CoopDefenseEncounterPresentationState,
  SpawnFront,
} from '../types';
import { DEFAULT_SPAWN_FRONT } from '../utils/spawnFront';

/** Ausfuehrungsschnitt des Directors zur bestehenden normalen Spawnlogik. */
export type CoopDefenseEncounterSpawnHandler = (
  enemyKind: CoopDefenseEnemyKind,
  count: number,
  originId?: string,
  front?: SpawnFront,
  spawnArea?: CoopDefenseMapSpawnAreaConfig,
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
  /** Scheduled-Encounter sind Support-Inhalt; nur `repel-assault` darf dauerhaft complete zeigen. */
  readonly showComplete?: boolean;
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
  /** Injectable random source for deterministic tests; production uses Math.random. */
  readonly random?: () => number;
  /** Long grace period for repeated zero-progress encounter spawns. */
  readonly spawnBackstopAfterMs?: number;
  /** Long grace period for a proven stuck active enemy. */
  readonly technicalStuckBackstopAfterMs?: number;
  /** Low-cost semantic hook; it must not influence scheduling or gameplay. */
  readonly onDiagnosticEvent?: (type: string, fields: Record<string, unknown>) => void;
}

interface EncounterExecutionState {
  readonly encounterId: string;
  started: boolean;
  readonly groupsExecuted: boolean[];
  readonly groupSpawnedCounts: number[];
  readonly groupNoProgressMs: number[];
  /** Absolute host times for each individual spawn in a group, in execution order. */
  readonly groupSpawnAtMs: number[][];
  readonly encounterEnemyIds: Set<string>;
  /**
   * Nur für die Fortschrittsanzeige. Bewusst getrennt von `encounterEnemyIds`: Hier landen
   * zusätzlich die per Death-Spawn geerbten Gegner, die keine Encounter-Registrierung tragen
   * und die Clear-Bedingung deshalb nicht mitbestimmen dürfen.
   */
  readonly progressEnemyIds: Set<string>;
  readonly technicallyStuckSinceMs: Map<string, number>;
  spawnBackstopped: boolean;
  startedAtMs: number;
  presentationIncomingStartedAtMs: number;
  firstGroupSpawnedAtMs: number | null;
  clearedAtMs: number | null;
  cleared: boolean;
}

interface EncounterEnemyProgress {
  readonly defeated: number;
  readonly total: number;
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
  private readonly showComplete: boolean;
  private readonly isEnemyActive: ((enemyId: string) => boolean) | null;
  private readonly isEncounterStartSatisfied: ((start: CoopDefenseMapEncounterStart) => boolean) | null;
  private readonly isEnemyOriginActive: ((originId: string) => boolean) | null;
  private readonly getActiveEnemyIdsForOrigin: ((originId: string) => readonly string[]) | null;
  private readonly isEnemyTechnicallyStuck: ((enemyId: string) => boolean) | null;
  private readonly removeEnemy: ((enemyId: string) => boolean) | null;
  private readonly random: () => number;
  private readonly spawnBackstopAfterMs: number;
  private readonly technicalStuckBackstopAfterMs: number;
  private readonly onDiagnosticEvent: ((type: string, fields: Record<string, unknown>) => void) | null;
  private repelEncounterIndex = 0;
  private repelPhase: RepelAssaultPhase = 'waiting';
  private restUntilMs = 0;
  private assaultRepelled = false;
  private lastDeltaMs = 0;

  constructor(
    private readonly encounters: readonly ResolvedCoopDefenseMapEncounterConfig[],
    private readonly spawnGroup: CoopDefenseEncounterSpawnHandler,
    options: CoopDefenseMapDirectorOptions = {},
  ) {
    this.mode = options.mode ?? 'scheduled';
    this.showComplete = options.showComplete ?? true;
    this.isEnemyActive = options.isEnemyActive ?? null;
    this.isEncounterStartSatisfied = options.isEncounterStartSatisfied ?? null;
    this.isEnemyOriginActive = options.isEnemyOriginActive ?? null;
    this.getActiveEnemyIdsForOrigin = options.getActiveEnemyIdsForOrigin ?? null;
    this.isEnemyTechnicallyStuck = options.isEnemyTechnicallyStuck ?? null;
    this.removeEnemy = options.removeEnemy ?? null;
    this.random = options.random ?? Math.random;
    this.spawnBackstopAfterMs = normalizeBackstopMs(options.spawnBackstopAfterMs, DEFAULT_SPAWN_BACKSTOP_MS);
    this.technicalStuckBackstopAfterMs = normalizeBackstopMs(
      options.technicalStuckBackstopAfterMs,
      DEFAULT_TECHNICAL_STUCK_BACKSTOP_MS,
    );
    this.onDiagnosticEvent = options.onDiagnosticEvent ?? null;
    this.executionStates = encounters.map((encounter) => ({
      encounterId: encounter.id,
      started: false,
      groupsExecuted: encounter.groups.map(() => false),
      groupSpawnedCounts: encounter.groups.map(() => 0),
      groupNoProgressMs: encounter.groups.map(() => 0),
      groupSpawnAtMs: encounter.groups.map(() => []),
      encounterEnemyIds: new Set<string>(),
      progressEnemyIds: new Set<string>(),
      technicallyStuckSinceMs: new Map<string, number>(),
      spawnBackstopped: false,
      startedAtMs: 0,
      presentationIncomingStartedAtMs: 0,
      firstGroupSpawnedAtMs: null,
      clearedAtMs: null,
      cleared: false,
    }));
  }

  /**
   * Fortschritt der aktiven Map-Zeit. Countdown-Zeit wird nicht angerechnet. Grosse Delta-Werte
   * werden nicht in einzelne Timer zerlegt; faellige Einzelspawns werden in diesem Aufruf
   * hoechstens einmal je Gruppe ausgefuehrt.
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
    this.restUntilMs = 0;
    this.assaultRepelled = false;
    this.lastDeltaMs = 0;
    for (const state of this.executionStates) {
      state.started = false;
      state.groupsExecuted.fill(false);
      state.groupSpawnedCounts.fill(0);
      state.groupNoProgressMs.fill(0);
      for (const spawnAtMs of state.groupSpawnAtMs) spawnAtMs.length = 0;
      state.encounterEnemyIds.clear();
      state.progressEnemyIds.clear();
      state.technicallyStuckSinceMs.clear();
      state.spawnBackstopped = false;
      state.startedAtMs = 0;
      state.presentationIncomingStartedAtMs = 0;
      state.firstGroupSpawnedAtMs = null;
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
        this.initializeGroupSpawnSchedule(encounter, state);
        this.onDiagnosticEvent?.('encounter:start', {
          encounterId: state.encounterId,
          sequenceIndex: encounterIndex,
          sequenceCount: this.encounters.length,
        });
      }
      if (!state.started) continue;
      if (!state.cleared) this.trackProgressEnemies(state);

      for (let groupIndex = 0; groupIndex < encounter.groups.length; groupIndex += 1) {
        if (state.groupsExecuted[groupIndex]) continue;
        const group = encounter.groups[groupIndex];
        if (this.elapsedMs < this.getNextGroupSpawnAtMs(group, groupIndex, state)) continue;

        // Vor dem Callback markieren: Auch ein re-entrantes Host-Update oder ein Callback-Fehler
        // kann diese Gruppe nicht versehentlich zu einer periodischen Welle machen.
        this.spawnEncounterGroup(group, groupIndex, state);
        executedGroupCount += 1;
      }

      if (!state.cleared && this.isEncounterSpawnCompleteState(state) && this.isThreatCleared(state)) {
        state.cleared = true;
        state.clearedAtMs = this.elapsedMs;
        this.onDiagnosticEvent?.('encounter:end', {
          encounterId: state.encounterId,
          sequenceIndex: encounterIndex,
          durationMs: Math.max(0, state.clearedAtMs - state.startedAtMs),
        });
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
      this.trackProgressEnemies(state);
      for (let groupIndex = 0; groupIndex < encounter.groups.length; groupIndex += 1) {
        if (state.groupsExecuted[groupIndex]) continue;
        const group = encounter.groups[groupIndex];
        if (this.elapsedMs < this.getNextGroupSpawnAtMs(group, groupIndex, state)) continue;

        this.spawnEncounterGroup(group, groupIndex, state);
        executedGroupCount += 1;
      }

      this.applyTechnicalBackstop(state);
      if (!state.cleared && this.isEncounterSpawnCompleteState(state) && this.isThreatCleared(state)) {
        state.cleared = true;
        state.clearedAtMs = this.elapsedMs;
        this.onDiagnosticEvent?.('encounter:end', {
          encounterId: state.encounterId,
          sequenceIndex: this.repelEncounterIndex,
          durationMs: Math.max(0, state.clearedAtMs - state.startedAtMs),
        });
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
    this.initializeGroupSpawnSchedule(this.encounters[index], state);
    this.repelPhase = 'active';
    this.onDiagnosticEvent?.('encounter:start', {
      encounterId: state.encounterId,
      sequenceIndex: index,
      sequenceCount: this.encounters.length,
    });
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
    const pending = this.findPredictablePendingEncounter();
    if (pending && this.elapsedMs >= pending.startAtMs - ENCOUNTER_INCOMING_TELEGRAPH_MS
      && this.elapsedMs < pending.startAtMs) {
      return this.createPresentationState(
        pending.index,
        'incoming',
        pending.startAtMs - ENCOUNTER_INCOMING_TELEGRAPH_MS,
        pending.startAtMs,
        null,
        undefined,
        pending.startAtMs,
      );
    }

    // Scheduled-Maps dürfen unabhängige Encounter überlappen. Der zuletzt gestartete
    // Encounter ist für die Präsentation relevanter als ein älterer, noch laufender.
    const newestStarted = this.findNewestStartedEncounter();
    if (newestStarted) return this.createStartedPresentationState(newestStarted.index, newestStarted.state);

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

    if (this.showComplete && this.executionStates.every((entry) => entry.cleared)) {
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
          null,
          undefined,
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
        null,
        undefined,
        pending.startAtMs,
      );
    }
    return null;
  }

  private createStartedPresentationState(
    index: number,
    state: EncounterExecutionState,
  ): CoopDefenseEncounterPresentationState {
    const firstGroupStartAtMs = state.startedAtMs + this.getFirstGroupDelayMs(index);
    if (state.firstGroupSpawnedAtMs !== null) {
      return this.createPresentationState(
        index,
        'active',
        state.firstGroupSpawnedAtMs,
        null,
        this.getEncounterEnemyProgress(index, state),
        this.isEncounterSpawnCompleteState(state),
      );
    }

    return this.createPresentationState(
      index,
      'incoming',
      state.presentationIncomingStartedAtMs,
      firstGroupStartAtMs,
      null,
      false,
    );
  }

  private createPresentationState(
    index: number,
    phase: CoopDefenseEncounterPresentationPhase,
    phaseStartedAtMs: number,
    phaseEndsAtMs: number | null,
    enemyProgress: EncounterEnemyProgress | null = null,
    spawnComplete: boolean | undefined = undefined,
    encounterStartAtMs: number | undefined = undefined,
  ): CoopDefenseEncounterPresentationState {
    return {
      encounterId: this.encounters[index]?.id ?? '',
      sequenceIndex: index + 1,
      sequenceCount: this.encounters.length,
      phase,
      phaseStartedAtMs: Math.max(0, phaseStartedAtMs),
      phaseEndsAtMs: phaseEndsAtMs === null ? null : Math.max(0, phaseEndsAtMs),
      encounterFronts: this.getEncounterFronts(index),
      fronts: this.getPresentationFronts(index, encounterStartAtMs),
      ...(spawnComplete === undefined ? {} : { spawnComplete }),
      ...(enemyProgress === null
        ? {}
        : { enemiesDefeated: enemyProgress.defeated, enemiesTotal: enemyProgress.total }),
    };
  }

  /**
   * Stable identity of an encounter: every authored group contributes its front immediately,
   * regardless of delayMs or the live telegraph window. The authored group order is preserved.
   */
  private getEncounterFronts(index: number): SpawnFront[] {
    const encounter = this.encounters[index];
    if (!encounter) return [DEFAULT_SPAWN_FRONT];

    const fronts: SpawnFront[] = [];
    for (const group of encounter.groups) {
      const front = group.front ?? DEFAULT_SPAWN_FRONT;
      if (!fronts.includes(front)) fronts.push(front);
    }
    return fronts.length > 0 ? fronts : [DEFAULT_SPAWN_FRONT];
  }

  /**
   * Returns only fronts that have spawned or are close enough to their authored group arrival to
   * be useful as a telegraph. This keeps a delayed south group from being advertised together
   * with an opening west group for the entire encounter.
   */
  private getPresentationFronts(index: number, encounterStartAtMs?: number): SpawnFront[] {
    const encounter = this.encounters[index];
    if (!encounter) return [DEFAULT_SPAWN_FRONT];
    const state = this.executionStates[index];
    const startAtMs = encounterStartAtMs
      ?? (state?.started ? state.startedAtMs : this.elapsedMs);
    const fronts: SpawnFront[] = [];
    for (let groupIndex = 0; groupIndex < encounter.groups.length; groupIndex += 1) {
      const group = encounter.groups[groupIndex];
      const groupStartAtMs = startAtMs + Math.max(0, Math.floor(group.delayMs ?? 0));
      const groupHasSpawned = state?.groupSpawnedCounts[groupIndex] > 0;
      if (!groupHasSpawned && groupStartAtMs > this.elapsedMs + ENCOUNTER_INCOMING_TELEGRAPH_MS) continue;
      const front = group.front ?? DEFAULT_SPAWN_FRONT;
      if (!fronts.includes(front)) fronts.push(front);
    }
    if (fronts.length > 0) return fronts;
    const firstFront = encounter.groups[0]?.front ?? DEFAULT_SPAWN_FRONT;
    return [firstFront];
  }

  /**
   * Übernimmt geerbte Gegner (Death-Spawns) in die Fortschrittsmenge. Sie müssen beim ersten
   * Sichten erfasst werden, sonst wären sie später weder als lebend noch als erledigt zählbar.
   */
  private trackProgressEnemies(state: EncounterExecutionState): void {
    for (const enemyId of this.getActiveEnemyIdsForOrigin?.(state.encounterId) ?? []) {
      if (typeof enemyId !== 'string' || enemyId.length === 0) continue;
      state.progressEnemyIds.add(enemyId);
    }
  }

  /**
   * Bekämpfungsfortschritt des laufenden Encounters. `total` ist das Maximum aus geplanter
   * Gruppenstärke und tatsächlich gesehenen Gegnern – Death-Spawns dürfen den Balken sonst
   * über sein eigenes Ziel hinaus füllen. Ohne Lebendtest oder registrierte Gegner gibt es
   * bewusst keine Zahl statt einer geratenen.
   */
  private getEncounterEnemyProgress(
    index: number,
    state: EncounterExecutionState,
  ): EncounterEnemyProgress | null {
    if (!this.isEnemyActive || state.progressEnemyIds.size === 0) return null;

    let active = 0;
    for (const enemyId of state.progressEnemyIds) {
      if (this.isEnemyActive(enemyId)) active += 1;
    }
    const planned = this.encounters[index]?.groups.reduce(
      (sum, group) => sum + Math.max(0, Math.floor(group.count)),
      0,
    ) ?? 0;
    const total = Math.max(planned, state.progressEnemyIds.size, 1);
    return { defeated: Math.min(total, state.progressEnemyIds.size - active), total };
  }

  private getFirstGroupDelayMs(index: number): number {
    const groups = this.encounters[index]?.groups ?? [];
    return groups.reduce(
      (minimum, group) => Math.min(minimum, Math.max(0, Math.floor(group.delayMs ?? 0))),
      Number.POSITIVE_INFINITY,
    );
  }

  private findNewestStartedEncounter(): { index: number; state: EncounterExecutionState } | null {
    let newest: { index: number; state: EncounterExecutionState } | null = null;
    for (let index = 0; index < this.executionStates.length; index += 1) {
      const state = this.executionStates[index];
      if (!state.started || state.cleared) continue;
      if (!newest
        || state.startedAtMs > newest.state.startedAtMs
        || (state.startedAtMs === newest.state.startedAtMs && index > newest.index)) {
        newest = { index, state };
      }
    }
    return newest;
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

    const staggerMs = Math.max(0, Math.floor(group.spawnStaggerMs ?? 0));
    // Legacy void-returning handlers still receive the complete remainder. The production
    // EnemyManager path returns IDs and therefore uses the individual staggered calls below.
    const spawnCount = staggerMs > 0 ? 1 : remainingCount;
    const front = group.front ?? DEFAULT_SPAWN_FRONT;
    // Ein authored Spawnbereich ersetzt das Frontband; ohne ihn bleibt der bestehende
    // Aufrufpfad inklusive des Weglassens der Standardfront unveraendert.
    const spawnResult = group.spawnArea
      ? this.spawnGroup(group.enemyKind, spawnCount, state.encounterId, front, group.spawnArea)
      : front === DEFAULT_SPAWN_FRONT
        ? this.spawnGroup(group.enemyKind, spawnCount, state.encounterId)
        : this.spawnGroup(group.enemyKind, spawnCount, state.encounterId, front);
    // Older scheduled callbacks were void-returning. Preserve their once-only semantics while
    // treating an explicit [] as a real zero-spawn result that remains retryable.
    if (spawnResult === undefined) {
      state.groupSpawnedCounts[groupIndex] = staggerMs > 0
        ? Math.min(group.count, state.groupSpawnedCounts[groupIndex] + spawnCount)
        : group.count;
      state.groupsExecuted[groupIndex] = state.groupSpawnedCounts[groupIndex] >= group.count;
      if (group.count > 0 && state.firstGroupSpawnedAtMs === null) {
        state.firstGroupSpawnedAtMs = this.elapsedMs;
      }
      this.onDiagnosticEvent?.('wave:spawn', {
        encounterId: state.encounterId,
        groupIndex,
        enemyKind: group.enemyKind,
        count: spawnCount,
        front,
      });
      return;
    }

    const enemyIds = spawnResult;
    let spawnedCount = 0;
    for (const enemyId of enemyIds) {
      if (typeof enemyId !== 'string' || enemyId.length === 0 || state.encounterEnemyIds.has(enemyId)) continue;
      state.encounterEnemyIds.add(enemyId);
      state.progressEnemyIds.add(enemyId);
      spawnedCount += 1;
    }
    state.groupSpawnedCounts[groupIndex] = Math.min(group.count, state.groupSpawnedCounts[groupIndex] + spawnedCount);
    state.groupsExecuted[groupIndex] = state.groupSpawnedCounts[groupIndex] >= group.count;
    if (spawnedCount > 0) {
      if (state.firstGroupSpawnedAtMs === null) state.firstGroupSpawnedAtMs = this.elapsedMs;
      state.groupNoProgressMs[groupIndex] = 0;
      this.onDiagnosticEvent?.('wave:spawn', {
        encounterId: state.encounterId,
        groupIndex,
        enemyKind: group.enemyKind,
        count: spawnedCount,
        front,
      });
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

  private initializeGroupSpawnSchedule(
    encounter: ResolvedCoopDefenseMapEncounterConfig,
    state: EncounterExecutionState,
  ): void {
    for (let groupIndex = 0; groupIndex < encounter.groups.length; groupIndex += 1) {
      const group = encounter.groups[groupIndex];
      const groupStartAtMs = state.startedAtMs + Math.max(0, Math.floor(group.delayMs ?? 0));
      const staggerMs = Math.max(0, Math.floor(group.spawnStaggerMs ?? 0));
      const offsets = [0];
      for (let spawnIndex = 1; spawnIndex < group.count; spawnIndex += 1) {
        offsets.push(this.getRandomSpawnOffsetMs(staggerMs));
      }
      offsets.sort((left, right) => left - right);
      state.groupSpawnAtMs[groupIndex].push(
        ...offsets.map((offsetMs) => groupStartAtMs + offsetMs),
      );
    }
  }

  private getNextGroupSpawnAtMs(
    group: ResolvedCoopDefenseMapEncounterGroupConfig,
    groupIndex: number,
    state: EncounterExecutionState,
  ): number {
    const nextSpawnAtMs = state.groupSpawnAtMs[groupIndex]?.[state.groupSpawnedCounts[groupIndex]]
      ?? state.startedAtMs + Math.max(0, Math.floor(group.delayMs ?? 0));
    return nextSpawnAtMs;
  }

  private getRandomSpawnOffsetMs(staggerMs: number): number {
    if (staggerMs <= 0) return 0;
    const randomValue = this.random();
    const normalizedRandom = Number.isFinite(randomValue)
      ? Math.min(1, Math.max(0, randomValue))
      : 0;
    return Math.min(staggerMs, Math.floor(normalizedRandom * (staggerMs + 1)));
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
