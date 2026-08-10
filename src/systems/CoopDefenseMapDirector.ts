import type {
  ResolvedCoopDefenseMapEncounterConfig,
  ResolvedCoopDefenseMapEncounterGroupConfig,
} from '../config/coopDefenseMaps';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';

/** Ausfuehrungsschnitt des Directors zur bestehenden normalen Spawnlogik. */
export type CoopDefenseEncounterSpawnHandler = (
  enemyKind: CoopDefenseEnemyKind,
  count: number,
) => readonly string[] | void;

export type CoopDefenseMapDirectorMode = 'scheduled' | 'repel-assault';

export interface CoopDefenseMapDirectorOptions {
  /** A3: Clear wird ausschliesslich ueber die vom Encounter registrierten IDs bestimmt. */
  readonly mode?: CoopDefenseMapDirectorMode;
  readonly isEnemyActive?: (enemyId: string) => boolean;
}

interface EncounterExecutionState {
  started: boolean;
  readonly groupsExecuted: boolean[];
  readonly encounterEnemyIds: Set<string>;
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
  private repelEncounterIndex = 0;
  private repelPhase: RepelAssaultPhase = 'waiting';
  private repelEncounterStartedAtMs = 0;
  private restUntilMs = 0;
  private assaultRepelled = false;

  constructor(
    private readonly encounters: readonly ResolvedCoopDefenseMapEncounterConfig[],
    private readonly spawnGroup: CoopDefenseEncounterSpawnHandler,
    options: CoopDefenseMapDirectorOptions = {},
  ) {
    this.mode = options.mode ?? 'scheduled';
    this.isEnemyActive = options.isEnemyActive ?? null;
    this.executionStates = encounters.map((encounter) => ({
      started: false,
      groupsExecuted: encounter.groups.map(() => false),
      encounterEnemyIds: new Set<string>(),
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

    this.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
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
    for (const state of this.executionStates) {
      state.started = false;
      state.groupsExecuted.fill(false);
      state.encounterEnemyIds.clear();
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

  private hostUpdateScheduled(): number {
    let executedGroupCount = 0;

    for (let encounterIndex = 0; encounterIndex < this.encounters.length; encounterIndex += 1) {
      const encounter = this.encounters[encounterIndex];
      const state = this.executionStates[encounterIndex];
      const encounterStartAtMs = Math.max(0, Math.floor(encounter.startAtMs));

      if (!state.started && this.elapsedMs >= encounterStartAtMs) {
        state.started = true;
      }
      if (!state.started) continue;

      for (let groupIndex = 0; groupIndex < encounter.groups.length; groupIndex += 1) {
        if (state.groupsExecuted[groupIndex]) continue;
        const group = encounter.groups[groupIndex];
        const groupStartAtMs = encounterStartAtMs + Math.max(0, Math.floor(group.delayMs));
        if (this.elapsedMs < groupStartAtMs) continue;

        // Vor dem Callback markieren: Auch ein re-entrantes Host-Update oder ein Callback-Fehler
        // kann diese Gruppe nicht versehentlich zu einer periodischen Welle machen.
        state.groupsExecuted[groupIndex] = true;
        this.spawnEncounterGroup(group, state);
        executedGroupCount += 1;
      }
    }

    return executedGroupCount;
  }

  private hostUpdateRepelAssault(): number {
    let executedGroupCount = 0;

    while (true) {
      if (this.repelPhase === 'complete' || this.encounters.length === 0) return executedGroupCount;

      if (this.repelPhase === 'waiting') {
        const firstEncounter = this.encounters[0];
        if (this.elapsedMs < Math.max(0, Math.floor(firstEncounter.startAtMs))) {
          return executedGroupCount;
        }
        this.beginRepelEncounter(0);
        continue;
      }

      if (this.repelPhase === 'rest') {
        if (this.elapsedMs < this.restUntilMs) return executedGroupCount;
        this.beginRepelEncounter(this.repelEncounterIndex + 1);
        continue;
      }

      const encounter = this.encounters[this.repelEncounterIndex];
      const state = this.executionStates[this.repelEncounterIndex];
      for (let groupIndex = 0; groupIndex < encounter.groups.length; groupIndex += 1) {
        if (state.groupsExecuted[groupIndex]) continue;
        const group = encounter.groups[groupIndex];
        if (this.elapsedMs < this.getRepelGroupStartAtMs(group)) continue;

        state.groupsExecuted[groupIndex] = true;
        this.spawnEncounterGroup(group, state);
        executedGroupCount += 1;
      }

      if (!state.cleared && this.isEncounterSpawnCompleteState(state) && this.isThreatCleared(state)) {
        state.cleared = true;
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
    this.repelEncounterStartedAtMs = index === 0
      ? Math.max(0, Math.floor(this.encounters[index].startAtMs))
      : this.elapsedMs;
    this.repelPhase = 'active';
  }

  private getRepelGroupStartAtMs(group: ResolvedCoopDefenseMapEncounterGroupConfig): number {
    // Only the first Encounter has a map-time start in this mode. Later Encounters are sequenced
    // by Clear -> Rest -> Next; their A2 startAtMs values are intentionally not consulted.
    return this.repelEncounterStartedAtMs + Math.max(0, Math.floor(group.delayMs));
  }

  private spawnEncounterGroup(
    group: ResolvedCoopDefenseMapEncounterGroupConfig,
    state: EncounterExecutionState,
  ): void {
    const enemyIds = this.spawnGroup(group.enemyKind, group.count) ?? [];
    for (const enemyId of enemyIds) {
      if (typeof enemyId === 'string' && enemyId.length > 0) state.encounterEnemyIds.add(enemyId);
    }
  }

  private isEncounterSpawnCompleteState(state: EncounterExecutionState): boolean {
    return state.started && state.groupsExecuted.every(Boolean);
  }

  private isThreatCleared(state: EncounterExecutionState): boolean {
    if (state.encounterEnemyIds.size === 0 || !this.isEnemyActive) return false;
    for (const enemyId of state.encounterEnemyIds) {
      if (this.isEnemyActive(enemyId)) return false;
    }
    return true;
  }

  private findEncounterIndex(encounterId: string): number {
    return this.encounters.findIndex((encounter) => encounter.id === encounterId);
  }
}

export type CoopDefenseMapDirectorGroup = ResolvedCoopDefenseMapEncounterGroupConfig;
